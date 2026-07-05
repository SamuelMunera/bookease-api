const { PrismaClient } = require('@prisma/client');

// En serverless (Vercel) DATABASE_URL debe apuntar al pooler con
// pgbouncer=true&connection_limit=1; de lo contrario cada invocación abre
// conexiones directas y agota el límite de Postgres. No lanzamos: solo
// advertimos para no romper entornos locales ni el arranque.
const isServerless = process.env.NODE_ENV === 'production' || process.env.VERCEL;
if (isServerless && !String(process.env.DATABASE_URL || '').includes('pgbouncer=true')) {
  console.warn(
    '[database] ADVERTENCIA: DATABASE_URL no contiene "pgbouncer=true" en un entorno ' +
    'serverless/producción. Se recomienda usar el pooler con ' +
    '"?pgbouncer=true&connection_limit=1" para evitar agotar las conexiones.'
  );
}

const prisma = new PrismaClient();

module.exports = prisma;
