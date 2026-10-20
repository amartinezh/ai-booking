/**
 * Corre el examen del asistente de soporte contra un modelo de verdad
 * (docs/PLAN_BOT_SOPORTE.md §7). GASTA TOKENS del proveedor que se le dé.
 *
 * Con una clave en la mano (en el equipo de desarrollo):
 *
 *   EXAMEN_PROVEEDOR=GEMINI|CHATGPT|CLAUDE \
 *   EXAMEN_API_KEY=… EXAMEN_MODELO=gemini-2.5-flash \
 *   [EXAMEN_CASOS=como-abrir-cupos,falla-recordatorios] [EXAMEN_SALIDA=reporte.json] \
 *   pnpm --filter api examen:soporte
 *
 * Con la IA que ya tiene configurada una clínica (en el servidor, dentro del
 * contenedor de la API: nadie copia ni ve la clave; la descifra la API con su
 * ENCRYPTION_KEY y es exactamente la que usará el asistente). Gasta tokens de
 * esa clínica (docs/ASISTENTE_SOPORTE.md §1):
 *
 *   EXAMEN_CLINICA=<organizationId> node apps/api/dist/support-bot/examen/examen.cli.js
 *
 * Imprime cada caso y el resumen, deja el reporte en JSON y sale con código 1 si
 * no aprueba. La clave nunca se imprime.
 */
import { writeFileSync } from 'fs';
import { CryptoService } from '../../common/crypto/crypto.service';
import { LlmFactoryService } from '../../llm/llm-factory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatGptProvider } from '../../llm/providers/chatgpt.provider';
import { ClaudeProvider } from '../../llm/providers/claude.provider';
import { GeminiProvider } from '../../llm/providers/gemini.provider';
import type { LLMProvider } from '../../llm/interfaces/llm-provider.interface';
import { SupportBotKnowledgeService } from '../support-bot-knowledge.service';
import { correrExamen, UMBRAL_TEMAS } from './examen';
import { CASOS_DEL_EXAMEN } from './preguntas';

/** La IA configurada de una clínica, como la usaría el asistente. */
async function proveedorDeLaClinica(
  organizationId: string,
): Promise<LLMProvider> {
  const prisma = new PrismaService();
  const cipher = new CryptoService();
  cipher.onModuleInit();
  try {
    const p = await new LlmFactoryService(prisma, cipher).forOrgOrNull(
      organizationId,
    );
    if (!p) {
      throw new Error(
        'Esa clínica no tiene IA configurada (Configuración › Integración de IA).',
      );
    }
    return p;
  } finally {
    await prisma.$disconnect();
  }
}

function proveedor(): LLMProvider {
  const nombre = (process.env.EXAMEN_PROVEEDOR ?? '').trim().toUpperCase();
  const apiKey = process.env.EXAMEN_API_KEY?.trim() ?? '';
  const model = process.env.EXAMEN_MODELO?.trim() ?? '';
  if (!apiKey) throw new Error('Falta EXAMEN_API_KEY.');
  if (nombre === 'GEMINI') return new GeminiProvider({ apiKey, model });
  if (nombre === 'CHATGPT') return new ChatGptProvider({ apiKey, model });
  if (nombre === 'CLAUDE') return new ClaudeProvider({ apiKey, model });
  throw new Error('EXAMEN_PROVEEDOR debe ser GEMINI, CHATGPT o CLAUDE.');
}

async function main(): Promise<void> {
  const clinica = process.env.EXAMEN_CLINICA?.trim();
  const p = clinica ? await proveedorDeLaClinica(clinica) : proveedor();
  const solo = (process.env.EXAMEN_CASOS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const casos = solo.length
    ? CASOS_DEL_EXAMEN.filter((c) => solo.includes(c.id))
    : CASOS_DEL_EXAMEN;
  console.log(
    `Examen del asistente de soporte: ${casos.length} casos con ${p.name} (${
      clinica
        ? `la IA configurada de la clínica ${clinica}`
        : (process.env.EXAMEN_MODELO ?? 'modelo por defecto')
    }).\n`,
  );

  const { resultados, resumen } = await correrExamen({
    conversar: (pet) => p.conversar(pet),
    conocimiento: new SupportBotKnowledgeService(),
    casos,
    alTerminarCaso: (r) => {
      console.log(`${r.ok ? '✓' : '✗'} ${r.id} (${r.ms} ms)`);
      for (const f of [
        ...r.violaciones.map((v) => `VIOLACIÓN: ${v}`),
        ...r.fallas,
      ])
        console.log(`    ${f}`);
    },
  });

  console.log('\n── Resumen ──');
  console.log(`Aprobados: ${resumen.aprobados}/${resumen.total}`);
  console.log(
    `Temas correctos: ${resumen.temas.ok}/${resumen.temas.total} (${Math.round(resumen.temas.proporcion * 100)} %, mínimo ${UMBRAL_TEMAS * 100} %)`,
  );
  console.log(
    `Ilegibles: ${resumen.ilegibles} · Violaciones: ${resumen.violaciones}`,
  );
  for (const [cat, c] of Object.entries(resumen.porCategoria))
    console.log(`  ${cat}: ${c.aprobados}/${c.total}`);
  console.log(
    `Tokens: entrada ${resumen.tokens.entrada} (de caché ${resumen.tokens.cache}), salida ${resumen.tokens.salida} · ${resumen.msPromedio} ms por respuesta`,
  );
  console.log(resumen.aprobado ? '\nAPROBADO' : '\nNO APROBADO');

  const salida =
    process.env.EXAMEN_SALIDA?.trim() ||
    `examen-soporte-${p.name.toLowerCase()}.json`;
  writeFileSync(
    salida,
    JSON.stringify(
      {
        proveedor: p.name,
        modelo: clinica ? null : (process.env.EXAMEN_MODELO ?? null),
        clinica: clinica ?? null,
        resumen,
        resultados,
      },
      null,
      2,
    ),
  );
  console.log(`Reporte: ${salida}`);
  process.exitCode = resumen.aprobado ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 2;
});
