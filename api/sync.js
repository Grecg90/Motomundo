import { timingSafeEqual } from 'node:crypto';
import { fetchDaily } from '../lib/ga4sync.js';
import { loadConfig } from '../lib/composio.js';

// Fecha de Honduras (UTC-6) desplazada n días
const hnDate = (n = 0) => new Date(Date.now() - 6 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const addD = (s, n) => new Date(Date.parse(s + 'T12:00Z') + n * 864e5).toISOString().slice(0, 10);

// Descarga de GA4 y guarda en Supabase, día por día.
// - Cron diario (vercel.json): últimos 3 días hasta ayer (GA4 a veces completa datos con retraso)
// - Segundo pase 2 p. m. (?pase=tarde): mismos días, ya con GA4 más procesado; sin aviso push
// - Manual: /api/sync?from=2026-09-01&to=2026-09-24 con el header Authorization: Bearer <CRON_SECRET>
export default async function handler(req, res) {
  const auth = req.headers.authorization || '', expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return res.status(401).json({ error: 'no autorizado' });
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if ((req.query.from && !isDate(req.query.from)) || (req.query.to && !isDate(req.query.to))) return res.status(400).json({ error: 'fechas inválidas' });
  try {
    await loadConfig();
    const to = req.query.to || hnDate(-1), from = req.query.from || addD(to, -2);
    const rows = await fetchDaily(from, to);
    const byDay = new Map();
    for (const r of rows) (byDay.get(r.date) || byDay.set(r.date, []).get(r.date)).push(r);
    const result = {};
    for (let d = from; d <= to; d = addD(d, 1)) {
      result[d] = await ingest(d, byDay.get(d) || []);
    }
    // Aviso push al dispositivo solo en la corrida diaria automática
    const push = req.query.from || req.query.pase ? null : await callIngest({ action: 'notify' }).catch(e => ({ error: e.message }));
    res.status(200).json({ from, to, rows: rows.length, porDia: result, push });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falló la sincronización' });
  }
}

// Envía las filas a la función ga4-ingest de Supabase, que escribe con la llave de servicio
const ingest = (day, rows) => callIngest({ from: day, to: day, rows }).then(j => j.rows);
async function callIngest(payload) {
  const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/ga4-ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: process.env.SUPABASE_KEY, 'x-sync-secret': process.env.SYNC_SECRET },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${j.error || ''}`);
  return j;
}
