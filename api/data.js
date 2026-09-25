import { selectAll } from '../lib/supabase.js';
import { route } from '../lib/composio.js';

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// GET /api/data?meta=1          → rango disponible y última sincronización
// GET /api/data?from=…&to=…      → filas diarias compactas: { s: [textos], r: [[fecha, c, s, m, t, x, h, p, usuarios, ev1, ev2]] }
export default route(async (_, q) => {
  if (q.meta) {
    const [first] = await selectAll('ga4_utm_daily', 'select=date&order=date.asc&limit=1');
    const [last] = await selectAll('ga4_utm_daily', 'select=date&order=date.desc&limit=1');
    const [sync] = await selectAll('ga4_sync_log', 'select=ran_at&order=ran_at.desc&limit=1');
    return { minDate: first?.date || null, maxDate: last?.date || null, lastSync: sync?.ran_at || null };
  }
  if (!isDate(q.from) || !isDate(q.to)) throw new Error('Parámetros from/to inválidos (YYYY-MM-DD)');
  const rows = await selectAll('ga4_utm_daily',
    `select=date,campaign,source,medium,term,content,host,landing_page,users,cotiza_producto,cotizacion_credito&date=gte.${q.from}&date=lte.${q.to}&order=date`);
  const s = [], idx = new Map(), i = v => (idx.has(v) ? idx.get(v) : (idx.set(v, s.length), s.push(v), s.length - 1));
  return { s, r: rows.map(r => [r.date, i(r.campaign), i(r.source), i(r.medium), i(r.term), i(r.content), i(r.host), i(r.landing_page),
    r.users, r.cotiza_producto, r.cotizacion_credito]) };
});
