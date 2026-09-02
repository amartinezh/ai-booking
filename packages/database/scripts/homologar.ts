/**
 * Empareja el catálogo del hospital con las entidades de AgenIA y escribe
 * `MirrorEntityMap`.
 *
 * ═══ Por qué existe ═══
 * `MirrorEntityMap` dice qué médico de AgenIA es cuál del hospital. Cinco
 * piezas del motor la leen y NINGUNA la escribía: sin esas filas no se genera
 * un solo cupo, no sale ni entra una sola cita, y —lo más traicionero— con el
 * espejo encendido `buildDoctorFilter()` devuelve `id: { in: [] }` y el chatbot
 * deja de ofrecer citas a todo el mundo, sin un solo error en el log.
 *
 * El catálogo llega por `POST /mirror/catalog` (el agente lo lee del HIS,
 * porque la API no lo alcanza) y queda en `MirrorCatalogEntry` como CANDIDATO.
 * Esto es lo que convierte candidatos en equivalencias.
 *
 * ═══ Las decisiones que implementa ═══
 * · Médicos: se emparejan por CÉDULA. Una cédula repetida NO se resuelve sola
 *   —en el hospital las agendas funcionales comparten documentos de relleno
 *   ('77123456789', '123456')— y queda para revisión manual.
 * · Los médicos del HIS que AgenIA no tiene SE CREAN, con email de marcador de
 *   posición y una contraseña aleatoria que nadie conoce: nadie puede entrar
 *   hasta que un administrador la restablezca. Una contraseña por defecto
 *   conocida sería una puerta abierta en treinta cuentas.
 * · Entran con `whatsappBookingEnabled = false` EXPLÍCITO. El schema tiene
 *   `@default(true)`, así que sin esto cada médico homologado quedaría vendible
 *   al instante — lo contrario del piloto gradual que pidió el hospital.
 * · A cada médico se le asigna su SERVICIO DOMINANTE (el de más citas en 90
 *   días, que el driver calcula y manda en el catálogo). Es la opción C: como
 *   el 72% de los turnos del hospital mezcla servicios y nada en el HIS dice de
 *   cuál es un cupo, AgenIA ofrece de cada médico uno solo — elegido a
 *   propósito y visible, no a dedo.
 * · NUNCA se borra una equivalencia. Un médico que desaparece del HIS se
 *   reporta y se deja de ofrecer; borrarla perdería el rastro de las citas ya
 *   espejadas.
 *
 * Uso:
 *   pnpm --filter @agenia/database exec tsx scripts/homologar.ts <organizationId>
 *   # por defecto NO escribe: muestra la lista y sale. --aplicar la escribe.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = (m[2] ?? '').replace(/^['"]|['"]$/g, '');
  }
}
loadEnvFile(path.resolve(__dirname, '../../../apps/api/.env'));

import { PrismaClient } from '@prisma/client';

/** Dominio de los correos de marcador de posición de los médicos importados. */
const DOMINIO = process.env.HOMOLOGAR_DOMINIO ?? 'hsvpanserma.com';

type Extra = Record<string, string>;

interface Propuesta {
  externalKey: string;
  label: string;
  extra: Extra;
  accion: 'ENLAZAR' | 'CREAR' | 'REVISAR' | 'YA';
  agenIAId?: string;
  detalle: string;
}

const norm = (s: string | null | undefined) =>
  (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

async function main() {
  const prisma = new PrismaClient();
  const aplicar = process.argv.includes('--aplicar');
  const orgId = process.argv.slice(2).find((a) => !a.startsWith('--'));

  if (!orgId) {
    const orgs = await prisma.hospitalMirrorConfig.findMany({
      select: { organizationId: true, driverKey: true },
    });
    console.log('Organizaciones con espejo configurado:');
    for (const o of orgs) console.log(`   ${o.organizationId}  ${o.driverKey}`);
    await prisma.$disconnect();
    return;
  }

  const catalogo = await prisma.mirrorCatalogEntry.findMany({
    where: { organizationId: orgId },
    orderBy: [{ entityType: 'asc' }, { externalKey: 'asc' }],
  });
  if (catalogo.length === 0) {
    console.log(
      'No hay catálogo todavía. El agente lo sube en su bucle de catálogo\n' +
        '(unos segundos tras arrancar). Sin él no hay nada que emparejar.',
    );
    await prisma.$disconnect();
    return;
  }

  const mapas = await prisma.mirrorEntityMap.findMany({
    where: { organizationId: orgId },
  });
  const yaPorClave = new Map(mapas.map((m) => [`${m.entityType}|${m.externalKey}`, m]));
  const yaPorAgenIA = new Map(mapas.map((m) => [`${m.entityType}|${m.agenIAId}`, m]));

  // ── SERVICIOS ────────────────────────────────────────────────────────────
  const servHis = catalogo.filter((c) => c.entityType === 'SERVICE');
  const servAgenIA = await prisma.medicalService.findMany({
    where: { organizationId: orgId },
  });
  const servPorNombre = new Map(
    servAgenIA.map((s) => [s.name.trim().toLowerCase(), s]),
  );

  const propServ: Propuesta[] = servHis.map((c) => {
    const extra = (c.extra ?? {}) as Extra;
    if (yaPorClave.has(`SERVICE|${c.externalKey}`)) {
      return { externalKey: c.externalKey, label: c.label, extra, accion: 'YA', detalle: 'ya homologado' };
    }
    const igual = servPorNombre.get(c.label.trim().toLowerCase());
    if (igual && !yaPorAgenIA.has(`SERVICE|${igual.id}`)) {
      return {
        externalKey: c.externalKey, label: c.label, extra,
        accion: 'ENLAZAR', agenIAId: igual.id,
        detalle: `coincide por nombre con "${igual.name}"`,
      };
    }
    return {
      externalKey: c.externalKey, label: c.label, extra,
      accion: 'CREAR',
      detalle: `se creará como servicio de AgenIA (${extra.citas90d ?? '0'} citas/90d)`,
    };
  });

  // ── MÉDICOS ──────────────────────────────────────────────────────────────
  const medHis = catalogo.filter((c) => c.entityType === 'DOCTOR');
  const medAgenIA = await prisma.doctorProfile.findMany({
    where: { organizationId: orgId },
    select: { id: true, cedula: true, fullName: true },
  });
  const porCedula = new Map<string, typeof medAgenIA>();
  for (const d of medAgenIA) {
    const c = norm(d.cedula);
    if (!c) continue;
    porCedula.set(c, [...(porCedula.get(c) ?? []), d]);
  }
  // Cédulas que el HIS repite entre varios médicos: no se resuelven solas.
  const vecesEnHis = new Map<string, number>();
  for (const c of medHis) {
    const ced = norm(((c.extra ?? {}) as Extra).cedula);
    if (ced) vecesEnHis.set(ced, (vecesEnHis.get(ced) ?? 0) + 1);
  }

  const propMed: Propuesta[] = medHis.map((c) => {
    const extra = (c.extra ?? {}) as Extra;
    const base = { externalKey: c.externalKey, label: c.label, extra };
    if (yaPorClave.has(`DOCTOR|${c.externalKey}`)) {
      return { ...base, accion: 'YA', detalle: 'ya homologado' };
    }
    const ced = norm(extra.cedula);
    if (!ced) return { ...base, accion: 'REVISAR', detalle: 'sin cédula en el HIS' };
    if ((vecesEnHis.get(ced) ?? 0) > 1) {
      return {
        ...base, accion: 'REVISAR',
        detalle: `su cédula se repite en ${vecesEnHis.get(ced)} médicos del HIS (documento de relleno)`,
      };
    }
    const candidatos = (porCedula.get(ced) ?? []).filter(
      (d) => !yaPorAgenIA.has(`DOCTOR|${d.id}`),
    );
    if (candidatos.length === 1) {
      return {
        ...base, accion: 'ENLAZAR', agenIAId: candidatos[0].id,
        detalle: `cédula coincide con "${candidatos[0].fullName}"`,
      };
    }
    if (candidatos.length > 1) {
      return { ...base, accion: 'REVISAR', detalle: `${candidatos.length} médicos de AgenIA con esa cédula` };
    }
    return { ...base, accion: 'CREAR', detalle: 'no existe en AgenIA' };
  });

  // ── Informe ──────────────────────────────────────────────────────────────
  const pinta = (titulo: string, props: Propuesta[]) => {
    console.log(`\n═══ ${titulo} (${props.length}) ═══`);
    for (const orden of ['YA', 'ENLAZAR', 'CREAR', 'REVISAR'] as const) {
      const grupo = props.filter((p) => p.accion === orden);
      if (grupo.length === 0) continue;
      console.log(`\n  ${orden} — ${grupo.length}`);
      for (const p of grupo) {
        const dom = p.extra.servicioDominante
          ? `  [servicio ${p.extra.servicioDominante} × ${p.extra.citasDelDominante} de ${p.extra.serviciosDistintos}]`
          : '';
        console.log(`    ${p.externalKey.padEnd(10)} ${p.label.slice(0, 44).padEnd(46)} ${p.detalle}${dom}`);
      }
    }
  };
  pinta('SERVICIOS', propServ);
  pinta('MÉDICOS', propMed);

  const aEscribir = [...propServ, ...propMed].filter((p) => p.accion !== 'YA' && p.accion !== 'REVISAR');
  const aRevisar = [...propServ, ...propMed].filter((p) => p.accion === 'REVISAR');
  console.log(
    `\n${aEscribir.length} equivalencia(s) por escribir, ${aRevisar.length} para revisar a mano.`,
  );

  if (!aplicar) {
    console.log('\n(sin --aplicar no se escribió nada: esta lista es para que alguien la mire)');
    await prisma.$disconnect();
    return;
  }

  // ── Escritura ────────────────────────────────────────────────────────────
  let creadosServ = 0, creadosMed = 0, enlazados = 0;

  for (const p of propServ) {
    if (p.accion === 'YA' || p.accion === 'REVISAR') continue;
    let agenIAId = p.agenIAId;
    if (p.accion === 'CREAR') {
      const s = await prisma.medicalService.create({
        data: { name: p.label.slice(0, 120), organizationId: orgId },
      });
      agenIAId = s.id;
      creadosServ++;
    }
    await prisma.mirrorEntityMap.create({
      data: {
        organizationId: orgId, entityType: 'SERVICE',
        agenIAId: agenIAId!, externalKey: p.externalKey, externalLabel: p.label,
      },
    });
    enlazados++;
  }

  // El servicio de cada médico sale de su dominante, ya homologado arriba.
  const servPorClaveHis = new Map(
    (await prisma.mirrorEntityMap.findMany({
      where: { organizationId: orgId, entityType: 'SERVICE' },
    })).map((m) => [m.externalKey, m.agenIAId]),
  );

  let n = 1;
  for (const p of propMed) {
    if (p.accion === 'YA' || p.accion === 'REVISAR') continue;
    let agenIAId = p.agenIAId;

    if (p.accion === 'CREAR') {
      // Contraseña aleatoria que NADIE conoce: el médico no puede entrar hasta
      // que un administrador la restablezca. Una por defecto conocida sería
      // una puerta abierta en treinta cuentas.
      const inservible = crypto.randomBytes(32).toString('hex');
      let email = `medico${n}@${DOMINIO}`;
      while (await prisma.user.findUnique({ where: { email } })) {
        n++;
        email = `medico${n}@${DOMINIO}`;
      }
      const user = await prisma.user.create({
        data: { email, password: inservible, role: 'DOCTOR', organizationId: orgId },
      });
      const d = await prisma.doctorProfile.create({
        data: {
          cedula: p.extra.cedula ?? p.externalKey,
          fullName: p.label,
          organizationId: orgId,
          userId: user.id,
          // 🚦 EXPLÍCITO. El schema tiene @default(true): sin esto, cada médico
          // importado quedaría vendible por WhatsApp al instante.
          whatsappBookingEnabled: false,
          serviceId: servPorClaveHis.get(p.extra.servicioDominante ?? '') ?? null,
        },
      });
      agenIAId = d.id;
      creadosMed++;
      n++;
    } else if (p.extra.servicioDominante) {
      // Ya existía: se le fija el servicio dominante si no tenía.
      const actual = await prisma.doctorProfile.findUnique({
        where: { id: agenIAId! }, select: { serviceId: true },
      });
      if (!actual?.serviceId) {
        await prisma.doctorProfile.update({
          where: { id: agenIAId! },
          data: { serviceId: servPorClaveHis.get(p.extra.servicioDominante) ?? null },
        });
      }
    }

    await prisma.mirrorEntityMap.create({
      data: {
        organizationId: orgId, entityType: 'DOCTOR',
        agenIAId: agenIAId!, externalKey: p.externalKey, externalLabel: p.label,
      },
    });
    enlazados++;
  }

  console.log(
    `\n✓ ${enlazados} equivalencia(s) escritas. ` +
      `${creadosServ} servicio(s) y ${creadosMed} médico(s) creados en AgenIA.`,
  );
  if (creadosMed > 0) {
    console.log(
      `\n  Los ${creadosMed} médicos nuevos entraron con whatsappBookingEnabled=false\n` +
        '  y una contraseña aleatoria que nadie conoce. Para que puedan entrar y\n' +
        '  recibir reservas hay que ponerles email y contraseña desde el dashboard,\n' +
        '  y activarlos uno a uno.',
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
