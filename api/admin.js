import { loadConfig, execute, cfg } from '../lib/composio.js';

// Solo administradores: revisa la conexión Composio → GA4 y lista las propiedades disponibles para el panel.
// La sesión se valida contra Supabase con el token del usuario; las llaves nunca salen del servidor.
async function isAdmin(token) {
  if (!token) return false;
  const h = { apikey: process.env.SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/my_role`, { method: 'POST', headers: h, body: '{}' });
  return r.ok && (await r.json()) === 'admin';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
  if (!(await isAdmin(token).catch(() => false))) return res.status(403).json({ error: 'Solo el administrador' });
  const t0 = Date.now();
  try {
    await loadConfig();
    const c = cfg();
    const r = await execute('GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES', c.userId, {});
    if (r.successful === false) throw new Error('GA4: ' + (r.error || 'Composio no pudo leer las cuentas'));
    const properties = (r.data?.accountSummaries || []).flatMap(a => (a.propertySummaries || []).map(p => ({ id: p.property, name: p.displayName, account: a.displayName })));
    res.status(200).json({
      ok: true, ms: Date.now() - t0, key_source: c.source, user_id: c.userId, property: c.property,
      property_ok: properties.some(p => p.id === c.property), properties,
    });
  } catch (err) {
    res.status(200).json({ ok: false, ms: Date.now() - t0, error: String(err.message || err).slice(0, 300) });
  }
}
