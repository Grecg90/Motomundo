import { fetchDaily } from '../lib/ga4sync.js';
import { rpc } from '../lib/supabase.js';

// Fecha de Honduras (UTC-6) desplazada n días
const hnDate = (n = 0) => new Date(Date.now() - 6 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const addD = (s, n) => new Date(Date.parse(s + 'T12:00Z') + n * 864e5).toISOString().slice(0, 10);

// Descarga de GA4 y guarda en Supabase, día por día.
// - Cron diario (vercel.json): últimos 3 días hasta ayer (GA4 a veces completa datos con retraso)
// - Manual: /api/sync?from=2026-09-01&to=2026-09-24 con el header Authorization: Bearer <CRON_SECRET>
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'no autorizado' });
  try {
    const to = req.query.to || hnDate(-1), from = req.query.from || addD(to, -2);
    const rows = await fetchDaily(from, to);
    const byDay = new Map();
    for (const r of rows) (byDay.get(r.date) || byDay.set(r.date, []).get(r.date)).push(r);
    const result = {};
    for (let d = from; d <= to; d = addD(d, 1)) {
      result[d] = await rpc('ga4_sync_upsert', { p_secret: process.env.SYNC_SECRET, p_from: d, p_to: d, p_rows: byDay.get(d) || [] });
    }
    res.status(200).json({ from, to, rows: rows.length, porDia: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
