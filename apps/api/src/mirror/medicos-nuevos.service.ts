import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '@agenia/database';
import {
  SYNC_AUDIT_DIRECTION,
  TITULO_EXCEPCION,
  cedulaNormalizada,
  claveExcepcion,
  evaluarMedicoNuevo,
  puedeHomologarseConBoton,
  puedeHomologarseSolo,
  severidadPorCercania,
  type EvaluacionMedicoNuevo,
  type ServicioDeAgenIA,
} from '@agenia/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MirrorExceptionsService } from './mirror-exceptions.service';
import type { HisAppointmentSnapshot } from './mirror-reconciliation.service';

/**
 * 🩺 Médicos del hospital que AgenIA todavía no conoce (2026-10-24).
 *
 * La médica de código RU68 volvió a tener turnos de medicina general sin estar en
 * AgenIA: sus pacientes no recibían recordatorio y lo único que lo decía era un
 * ERROR en el registro de la API, cada noche. Ahora, con la foto de citas que sube
 * el agente para la reconciliación:
 *
 *  - un médico con citas próximas de un servicio que AgenIA maneja y sin homologar
 *    abre un caso en la Bandeja (`MEDICO_SIN_HOMOLOGAR`), con un botón para que el
 *    administrador lo cree y homologue;
 *  - si la clínica lo pidió (Configuración, apagado de fábrica) y cumple TODAS las
 *    reglas (`evaluarMedicoNuevo`), AgenIA lo hace sola y deja un caso informativo
 *    (`MEDICO_AGREGADO_AUTO`) para que una persona lo revise;
 *  - el caso se cierra solo cuando el médico queda homologado (por cualquier vía) o
 *    ya no tiene esas citas.
 *
 * El alta es la de `packages/database/scripts/homologar.ts`: correo de marcador y una
 * contraseña aleatoria que nadie conoce (nadie puede entrar con esa cuenta), su
 * servicio principal, y la marca de origen MIRROR para que NADA vuelva al hospital.
 */

export type ViaHomologacion = 'BANDEJA' | 'AUTOMATICO';

export type ResultadoHomologacion =
  | { ok: true; accion: 'CREAR' | 'ENLAZAR'; doctorId: string; nombre: string }
  | {
      ok: false;
      codigo: 'NO_ESTA' | 'YA_HOMOLOGADO' | 'BLOQUEADO' | 'ADVERTENCIAS';
      motivo: string;
    };

interface Pendiente {
  citas: number;
  primera: Date;
}

const ESTADOS_ACTIVOS = ['ABIERTA', 'EN_REVISION'];

@Injectable()
export class MedicosNuevosService {
  private readonly logger = new Logger(MedicosNuevosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exceptions: MirrorExceptionsService,
  ) {}

  /**
   * Con la foto del hospital: cierra los casos que ya no aplican, homologa sola lo
   * que la clínica le permitió y abre un caso por cada médico que queda pendiente.
   */
  async revisar(
    organizationId: string,
    snapshot: HisAppointmentSnapshot[],
    ahora: Date = new Date(),
  ): Promise<{ pendientes: string[]; agregados: string[] }> {
    const config = await this.prisma.hospitalMirrorConfig.findUnique({
      where: { organizationId },
      select: {
        enabled: true,
        autoHomologateDoctors: true,
        autoHomologateWhatsappOn: true,
      },
    });
    if (!config?.enabled) return { pendientes: [], agregados: [] };

    const [servicios, homologados] = await Promise.all([
      this.serviciosPorClaveHis(organizationId),
      this.prisma.mirrorEntityMap.findMany({
        where: { organizationId, entityType: 'DOCTOR' },
        select: { externalKey: true },
      }),
    ]);
    const yaEstan = new Set(homologados.map((m) => m.externalKey));

    // Médicos sin homologar con citas PRÓXIMAS de un servicio activo.
    const pendientes = new Map<string, Pendiente>();
    for (const c of snapshot) {
      if (!c.serviceExternalKey || yaEstan.has(c.doctorExternalKey)) continue;
      if (!servicios.get(c.serviceExternalKey)?.activo) continue;
      const inicio = new Date(c.startTimeIso);
      if (Number.isNaN(inicio.getTime()) || inicio <= ahora) continue;
      const p = pendientes.get(c.doctorExternalKey);
      if (!p) {
        pendientes.set(c.doctorExternalKey, { citas: 1, primera: inicio });
      } else {
        p.citas++;
        if (inicio < p.primera) p.primera = inicio;
      }
    }

    await this.cerrarLosQueYaNoAplican(
      organizationId,
      new Set(pendientes.keys()),
      yaEstan,
      ahora,
    );
    if (pendientes.size === 0) return { pendientes: [], agregados: [] };

    const evaluaciones = await this.evaluar(organizationId, [
      ...pendientes.keys(),
    ]);
    const agregados: string[] = [];
    const quedan: string[] = [];

    for (const [externalKey, p] of pendientes) {
      const ev = evaluaciones.get(externalKey);
      if (config.autoHomologateDoctors && ev && puedeHomologarseSolo(ev)) {
        const r = await this.homologar(
          organizationId,
          externalKey,
          {
            whatsappOn: config.autoHomologateWhatsappOn,
            actor: 'AgenIA (homologación automática)',
            via: 'AUTOMATICO',
          },
          ahora,
        );
        if (r.ok) {
          agregados.push(externalKey);
          await this.exceptions.registrar(
            organizationId,
            {
              kind: 'MEDICO_AGREGADO_AUTO',
              dedupeKey: claveExcepcion.medicoAgregadoAuto(externalKey),
              // Con WhatsApp OFF falta una decisión; con ON, solo revisar.
              severity: config.autoHomologateWhatsappOn ? 'BAJA' : 'MEDIA',
              title: TITULO_EXCEPCION.MEDICO_AGREGADO_AUTO,
              entityType: 'DOCTOR',
              entityId: r.doctorId,
              doctorId: r.doctorId,
              meta: this.meta(externalKey, ev, p, {
                whatsappOn: config.autoHomologateWhatsappOn,
                accion: r.accion,
              }),
            },
            ahora,
          );
          continue;
        }
      }
      quedan.push(externalKey);
      await this.exceptions.registrar(
        organizationId,
        {
          kind: 'MEDICO_SIN_HOMOLOGAR',
          dedupeKey: claveExcepcion.medicoSinHomologar(externalKey),
          severity: severidadPorCercania(
            'MEDIA',
            (p.primera.getTime() - ahora.getTime()) / 60_000,
          ),
          title: TITULO_EXCEPCION.MEDICO_SIN_HOMOLOGAR,
          entityType: 'DOCTOR_HIS',
          entityId: externalKey,
          meta: this.meta(externalKey, ev, p),
        },
        ahora,
      );
    }

    if (quedan.length > 0) {
      this.logger.warn(
        `Médicos del hospital con citas que AgenIA aún no tiene (org ${organizationId}): ` +
          quedan
            .map((k) => `${k}=${pendientes.get(k)?.citas ?? 0}`)
            .join(', ') +
          '. Quedaron en la Bandeja.',
      );
    }
    return { pendientes: quedan, agregados };
  }

  /**
   * Crea (o enlaza, si ya existe con su cédula) y homologa a un médico del catálogo
   * del hospital. La usan el botón de la Bandeja y el modo automático: las mismas
   * reglas para los dos, salvo que una persona puede pasar por encima de las
   * advertencias (las ve antes de pulsar).
   */
  async homologar(
    organizationId: string,
    externalKey: string,
    opts: { whatsappOn: boolean; actor: string; via: ViaHomologacion },
    ahora: Date = new Date(),
  ): Promise<ResultadoHomologacion> {
    const ya = await this.prisma.mirrorEntityMap.findFirst({
      where: { organizationId, entityType: 'DOCTOR', externalKey },
      select: { id: true },
    });
    if (ya) {
      await this.cerrarCaso(
        organizationId,
        externalKey,
        'El médico ya estaba homologado en AgenIA.',
        ahora,
      );
      return {
        ok: false,
        codigo: 'YA_HOMOLOGADO',
        motivo: 'Ese médico ya está homologado en AgenIA.',
      };
    }

    const ev = (await this.evaluar(organizationId, [externalKey])).get(
      externalKey,
    );
    if (!ev) {
      return {
        ok: false,
        codigo: 'NO_ESTA',
        motivo:
          'Ese médico no está en el catálogo que sube el agente del hospital: no hay con qué crearlo.',
      };
    }
    if (!puedeHomologarseConBoton(ev)) {
      return { ok: false, codigo: 'BLOQUEADO', motivo: ev.bloqueos.join(' ') };
    }
    if (opts.via === 'AUTOMATICO' && !puedeHomologarseSolo(ev)) {
      return {
        ok: false,
        codigo: 'ADVERTENCIAS',
        motivo: ev.advertencias.join(' '),
      };
    }

    let doctorId: string;
    try {
      doctorId = await this.prisma.$transaction(async (tx) => {
        // Nace del hospital: el evento del outbox nace entregado y nunca vuelve a él.
        await tx.$executeRawUnsafe(`SET LOCAL agenia.sync_origin = 'MIRROR'`);
        let id: string;
        if (ev.accion === 'ENLAZAR' && ev.doctorIdExistente) {
          id = ev.doctorIdExistente;
          await tx.doctorProfile.update({
            where: { id },
            data: {
              whatsappBookingEnabled: opts.whatsappOn,
              ...(ev.servicio ? { serviceId: ev.servicio.id } : {}),
            },
          });
        } else {
          const user = await tx.user.create({
            data: {
              email: await this.correoDeMarcador(organizationId),
              // Una contraseña que nadie conoce: no es un hash, así que ninguna
              // clave entra. Un administrador le pone correo y clave si hace falta.
              password: crypto.randomBytes(32).toString('hex'),
              role: 'DOCTOR',
              organizationId,
            },
          });
          const d = await tx.doctorProfile.create({
            data: {
              cedula: ev.cedula as string,
              fullName: ev.nombre,
              organizationId,
              userId: user.id,
              // 🚦 EXPLÍCITO: el schema tiene @default(true).
              whatsappBookingEnabled: opts.whatsappOn,
              isFunctionalAgenda: false,
              serviceId: ev.servicio?.id ?? null,
            },
          });
          id = d.id;
        }
        await tx.mirrorEntityMap.create({
          data: {
            organizationId,
            entityType: 'DOCTOR',
            agenIAId: id,
            externalKey,
            externalLabel: ev.nombre,
          },
        });
        await tx.syncAudit.create({
          data: {
            organizationId,
            direction: SYNC_AUDIT_DIRECTION.CONFIG,
            entityType: 'DoctorProfile',
            entityId: id,
            op: 'DOCTOR_HOMOLOGATED',
            outcome: 'OK',
            detail:
              `Médico ${externalKey} (${ev.nombre}) ${ev.accion === 'ENLAZAR' ? 'enlazado al que ya tenía su cédula' : 'creado'} y homologado ` +
              `${opts.via === 'AUTOMATICO' ? 'automáticamente' : 'desde la Bandeja'} por ${opts.actor}: ` +
              `servicio ${ev.servicio?.nombre ?? 'sin servicio'}, WhatsApp ${opts.whatsappOn ? 'ON' : 'OFF'}. ` +
              'Nada se escribió en el hospital.',
          },
        });
        return id;
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          ok: false,
          codigo: 'YA_HOMOLOGADO',
          motivo:
            'Otra persona lo homologó mientras tanto: recarga la página para verlo.',
        };
      }
      throw error;
    }

    await this.cerrarCaso(
      organizationId,
      externalKey,
      opts.via === 'AUTOMATICO'
        ? 'AgenIA lo creó y homologó sola (homologación automática en Configuración).'
        : `Creado y homologado desde la Bandeja por ${opts.actor}.`,
      ahora,
    );
    this.logger.log(
      `Médico ${externalKey} homologado (${opts.via}, org ${organizationId}, WhatsApp ${opts.whatsappOn ? 'ON' : 'OFF'}).`,
    );
    return { ok: true, accion: ev.accion!, doctorId, nombre: ev.nombre };
  }

  // ─────────────────────────────────────────────────────────────

  /** Las reglas de cada médico del catálogo; los que no están en él no aparecen. */
  private async evaluar(
    organizationId: string,
    externalKeys: string[],
  ): Promise<Map<string, EvaluacionMedicoNuevo>> {
    const [catalogo, doctores, mapas, servicios] = await Promise.all([
      this.prisma.mirrorCatalogEntry.findMany({
        where: { organizationId, entityType: 'DOCTOR' },
        select: { externalKey: true, label: true, extra: true },
      }),
      this.prisma.doctorProfile.findMany({
        where: { organizationId },
        select: { id: true, cedula: true, fullName: true },
      }),
      this.prisma.mirrorEntityMap.findMany({
        where: { organizationId, entityType: 'DOCTOR' },
        select: { agenIAId: true, externalKey: true },
      }),
      this.serviciosPorClaveHis(organizationId),
    ]);
    const vecesCedula = new Map<string, number>();
    for (const c of catalogo) {
      const ced = cedulaNormalizada(
        (c.extra as Record<string, unknown> | null)?.cedula,
      );
      if (ced) vecesCedula.set(ced, (vecesCedula.get(ced) ?? 0) + 1);
    }
    const claveDe = new Map(mapas.map((m) => [m.agenIAId, m.externalKey]));

    const out = new Map<string, EvaluacionMedicoNuevo>();
    for (const c of catalogo) {
      if (!externalKeys.includes(c.externalKey)) continue;
      const ced = cedulaNormalizada(
        (c.extra as Record<string, unknown> | null)?.cedula,
      );
      out.set(
        c.externalKey,
        evaluarMedicoNuevo(
          {
            externalKey: c.externalKey,
            label: c.label,
            extra: c.extra as Record<string, unknown> | null,
          },
          {
            vecesCedulaEnCatalogo: vecesCedula,
            medicosConLaCedula: ced
              ? doctores
                  .filter((d) => cedulaNormalizada(d.cedula) === ced)
                  .map((d) => ({
                    id: d.id,
                    fullName: d.fullName,
                    homologadoComo: claveDe.get(d.id) ?? null,
                  }))
              : [],
            servicioDeClaveHis: servicios,
          },
        ),
      );
    }
    return out;
  }

  /** El servicio de AgenIA de cada código de servicio del hospital. */
  private async serviciosPorClaveHis(
    organizationId: string,
  ): Promise<Map<string, ServicioDeAgenIA>> {
    const [mapas, servicios] = await Promise.all([
      this.prisma.mirrorEntityMap.findMany({
        where: { organizationId, entityType: 'SERVICE' },
        select: { agenIAId: true, externalKey: true },
      }),
      this.prisma.medicalService.findMany({
        where: { organizationId },
        select: { id: true, name: true, isActive: true },
      }),
    ]);
    const porId = new Map(servicios.map((s) => [s.id, s]));
    const out = new Map<string, ServicioDeAgenIA>();
    for (const m of mapas) {
      const s = porId.get(m.agenIAId);
      if (s)
        out.set(m.externalKey, {
          id: s.id,
          nombre: s.name,
          activo: s.isActive,
        });
    }
    return out;
  }

  /** `medicoN@<dominio>` como los de homologar.ts, con el dominio que ya usa la clínica. */
  private async correoDeMarcador(organizationId: string): Promise<string> {
    const usados = await this.prisma.user.findMany({
      where: { organizationId, email: { startsWith: 'medico' } },
      select: { email: true },
    });
    let dominio = process.env.HOMOLOGAR_DOMINIO ?? '';
    let mayor = 0;
    for (const u of usados) {
      const m = /^medico(\d+)@(.+)$/.exec(u.email);
      if (!m) continue;
      mayor = Math.max(mayor, Number(m[1]));
      if (!dominio) dominio = m[2];
    }
    if (!dominio) dominio = 'medicos.agenia.local';
    for (let n = mayor + 1; ; n++) {
      const email = `medico${n}@${dominio}`;
      if (!(await this.prisma.user.findUnique({ where: { email } })))
        return email;
    }
  }

  private meta(
    externalKey: string,
    ev: EvaluacionMedicoNuevo | undefined,
    p: Pendiente,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      externalKey,
      nombre: ev?.nombre ?? null,
      cargo: ev?.cargo ?? null,
      // La cédula del médico, solo el final: basta para reconocerlo.
      cedulaFinal: ev?.cedula ? ev.cedula.slice(-4) : null,
      servicio: ev?.servicio?.nombre ?? null,
      citas: p.citas,
      primeraIso: p.primera.toISOString(),
      enCatalogo: !!ev,
      bloqueos: ev
        ? ev.bloqueos
        : ['No está en el catálogo que sube el agente del hospital.'],
      advertencias: ev?.advertencias ?? [],
      ...extra,
    };
  }

  private async cerrarCaso(
    organizationId: string,
    externalKey: string,
    nota: string,
    ahora: Date,
  ): Promise<void> {
    const caso = await this.prisma.syncException.findFirst({
      where: {
        organizationId,
        dedupeKey: claveExcepcion.medicoSinHomologar(externalKey),
        status: { in: ESTADOS_ACTIVOS },
      },
      select: { id: true },
    });
    if (caso)
      await this.exceptions.autoResolver(organizationId, caso.id, nota, ahora);
  }

  private async cerrarLosQueYaNoAplican(
    organizationId: string,
    pendientes: Set<string>,
    yaEstan: Set<string>,
    ahora: Date,
  ): Promise<void> {
    const abiertos = await this.prisma.syncException.findMany({
      where: {
        organizationId,
        kind: 'MEDICO_SIN_HOMOLOGAR',
        status: { in: ESTADOS_ACTIVOS },
      },
      select: { id: true, entityId: true },
    });
    for (const c of abiertos) {
      if (!c.entityId || pendientes.has(c.entityId)) continue;
      await this.exceptions.autoResolver(
        organizationId,
        c.id,
        yaEstan.has(c.entityId)
          ? 'El médico ya está homologado en AgenIA.'
          : 'Ya no tiene citas próximas de un servicio que AgenIA maneja.',
        ahora,
      );
    }
  }
}
