const API = 'https://backend.composio.dev/api/v3';

// Configuración efectiva: la del panel (Supabase, esquema privado) y, si no hay, las variables de entorno de Vercel
const CFG = { key: process.env.COMPOSIO_API_KEY, userId: process.env.COMPOSIO_USER_ID || 'default', property: process.env.GA4_PROPERTY || 'properties/349018417', source: 'vercel' };
export const cfg = () => CFG;
export async function loadConfig() {
  const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/ga4-ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: process.env.SUPABASE_KEY, 'x-sync-secret': process.env.SYNC_SECRET },
    body: JSON.stringify({ action: 'config' }),
  });
  if (!res.ok) throw new Error(`No se pudo leer la configuración (Supabase ${res.status})`);
  const j = await res.json();
  if (j.composio_api_key) { CFG.key = j.composio_api_key; CFG.source = 'panel'; }
  if (j.composio_user_id) CFG.userId = j.composio_user_id;
  if (j.ga4_property) CFG.property = j.ga4_property;
  return CFG;
}

export async function composio(path, options = {}) {
  if (!CFG.key) throw new Error('Falta la llave de Composio (configúrala en el panel)');
  const res = await fetch(API + path, {
    ...options,
    headers: { 'x-api-key': CFG.key, 'content-type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Composio ${res.status}: ${body?.error?.message || body?.message || 'error'}`);
  return body;
}

export const execute = (slug, userId, args) =>
  composio(`/tools/execute/${slug}`, { method: 'POST', body: JSON.stringify({ user_id: userId, arguments: args, version: 'latest' }) });

// Envuelve un handler de Vercel con manejo de errores JSON
export const route = (fn) => async (req, res) => {
  try {
    res.status(200).json(await fn(req.body || {}, req.query || {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
