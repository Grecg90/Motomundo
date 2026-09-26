import { cachedOverview } from '../lib/ga4cache.js';

// Generalidades GA4 para el rango elegido. Solo usuarios activos (sesión validada con Supabase).
// Resultado en caché 24 h por rango (Supabase, vía ga4-ingest); las llaves nunca salen del servidor.
async function roleOf(token) {
  if (!token) return null;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/my_role`, { method: 'POST', headers: { apikey: process.env.SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  return r.ok ? r.json() : null;
}
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const role = await roleOf((req.headers.authorization || '').replace(/^Bearer /i, '')).catch(() => null);
  if (!role) return res.status(403).json({ error: 'Sesión inválida' });
  const { from, to, force } = req.body || {};
  if (!isDate(from) || !isDate(to) || from > to || Date.parse(to) - Date.parse(from) > 400 * 864e5) return res.status(400).json({ error: 'Rango inválido' });
  try { res.status(200).json(await cachedOverview(from, to, { force: !!force && role === 'admin' })); }
  catch (e) { console.error(e); res.status(502).json({ error: 'No se pudo consultar GA4' }); }
}
