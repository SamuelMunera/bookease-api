// Remediación one-off: hasta el commit 1221312 (2026-07-05) el editor de
// disponibilidad del panel de profesional guardaba TODO como override semanal
// (ScheduleOverride); el horario recurrente (Schedule) nunca se escribía.
// Resultado: profesionales con sus horas reales solo en semanas pasadas y
// cero filas recurrentes, por lo que toda semana nueva aparece cerrada.
//
// Este script promueve, por cada profesional SIN filas Schedule pero CON
// overrides, la semana de override más reciente que tenga al menos un día
// activo hacia la tabla Schedule. No borra ningún override (quedan como
// historial y las semanas pasadas no tapan semanas futuras).
//
// Uso (desde la raíz de bookease-api):
//   node scripts/promote-overrides-to-schedule.js           dry-run (defecto)
//   node scripts/promote-overrides-to-schedule.js --apply   escribe en la BD
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const prisma = require('../src/config/database');

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en la BD)' : 'DRY-RUN (no escribe nada)'}\n`);

  const overrides = await prisma.scheduleOverride.findMany({
    orderBy: [{ professionalId: 'asc' }, { weekStart: 'desc' }, { dayOfWeek: 'asc' }],
  });
  if (overrides.length === 0) {
    console.log('No hay overrides en la BD; nada que hacer.');
    return;
  }

  const byPro = new Map();
  for (const o of overrides) {
    if (!byPro.has(o.professionalId)) byPro.set(o.professionalId, []);
    byPro.get(o.professionalId).push(o);
  }

  const proIds = [...byPro.keys()];
  const [schedules, pros] = await Promise.all([
    prisma.schedule.findMany({ where: { professionalId: { in: proIds } }, select: { professionalId: true } }),
    prisma.professional.findMany({ where: { id: { in: proIds } }, select: { id: true, name: true } }),
  ]);
  const withSchedule = new Set(schedules.map((s) => s.professionalId));
  const nameOf = new Map(pros.map((p) => [p.id, p.name]));

  let promoted = 0;
  let skippedHasSchedule = 0;
  let skippedNoActive = 0;

  for (const [proId, rows] of byPro) {
    const label = `${nameOf.get(proId) ?? '(sin nombre)'} <${proId}>`;
    if (withSchedule.has(proId)) {
      skippedHasSchedule++;
      console.log(`- ${label}: ya tiene Schedule recurrente, se omite.`);
      continue;
    }

    // rows viene ordenado weekStart desc, así que la primera semana con algún
    // día activo es la más reciente con horario real.
    const weeks = new Map();
    for (const r of rows) {
      const key = r.weekStart.toISOString().slice(0, 10);
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(r);
    }
    const targetKey = [...weeks.keys()].find((k) => weeks.get(k).some((d) => d.isActive));
    if (!targetKey) {
      skippedNoActive++;
      console.log(`- ${label}: ningún override con días activos, se omite (revisar a mano).`);
      continue;
    }

    const days = weeks.get(targetKey);
    const activeCount = days.filter((d) => d.isActive).length;
    console.log(`- ${label}: promover semana ${targetKey} → Schedule (${days.length} fila(s), ${activeCount} día(s) activo(s)).`);
    for (const d of days) {
      const desc = d.isActive
        ? `${d.startTime}-${d.endTime}${d.scheduleType === 'part_time' ? ` y ${d.secondStartTime}-${d.secondEndTime}` : ''}`
        : 'inactivo';
      console.log(`    dow=${d.dayOfWeek}: ${desc}`);
    }

    if (APPLY) {
      const ops = days.map((d) => {
        const data = {
          startTime: d.startTime,
          endTime: d.endTime,
          isActive: d.isActive,
          scheduleType: d.scheduleType ?? 'fulltime',
          secondStartTime: d.secondStartTime ?? null,
          secondEndTime: d.secondEndTime ?? null,
        };
        return prisma.schedule.upsert({
          where: { professionalId_dayOfWeek: { professionalId: proId, dayOfWeek: d.dayOfWeek } },
          update: data,
          create: { professionalId: proId, dayOfWeek: d.dayOfWeek, ...data },
        });
      });
      await prisma.$transaction(ops);
    }
    promoted++;
  }

  console.log(`\nResumen: ${promoted} profesional(es) ${APPLY ? 'promovido(s)' : 'a promover'}, ` +
    `${skippedHasSchedule} con Schedule existente, ${skippedNoActive} sin días activos.`);
  if (!APPLY) console.log('Dry-run: no se escribió nada. Ejecuta con --apply para aplicar.');
}

main()
  .catch((err) => {
    console.error('Error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
