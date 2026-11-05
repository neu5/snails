import { resolve } from 'node:path';
import { buildApp } from './app';
import { openDb } from './db';
import { DevMailer, ResendMailer, type Mailer } from './mail';

const port = Number(process.env.PORT ?? 8787);
const publicUrl = (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const apiKey = process.env.RESEND_API_KEY;
const mailer: Mailer = apiKey ? new ResendMailer(apiKey, process.env.MAIL_FROM ?? 'Snails <onboarding@resend.dev>') : new DevMailer();

if (!process.env.DATABASE_URL) console.log('No DATABASE_URL: using an in-memory Postgres (PGlite); data is lost on restart.');
if (!apiKey) console.log('No RESEND_API_KEY: emails are printed here and listed at /api/dev/outbox.');

const app = await buildApp({
  db: await openDb(),
  mailer,
  publicUrl,
  dev: !apiKey,
  staticDir: resolve(import.meta.dirname, '../dist'),
});
await app.listen({ port, host: '0.0.0.0' });
console.log(`Snails server on :${port}, links point to ${publicUrl}`);
