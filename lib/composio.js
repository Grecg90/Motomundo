const API = 'https://backend.composio.dev/api/v3';

export const USER_ID = process.env.COMPOSIO_USER_ID || 'default';

export async function composio(path, options = {}) {
  if (!process.env.COMPOSIO_API_KEY) throw new Error('Falta COMPOSIO_API_KEY en las variables de entorno');
  const res = await fetch(API + path, {
    ...options,
    headers: { 'x-api-key': process.env.COMPOSIO_API_KEY, 'content-type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Composio ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

export const execute = (slug, userId, args) =>
  composio(`/tools/execute/${slug}`, { method: 'POST', body: JSON.stringify({ user_id: userId, arguments: args }) });

// Envuelve un handler de Vercel con manejo de errores JSON
export const route = (fn) => async (req, res) => {
  try {
    res.status(200).json(await fn(req.body || {}, req.query || {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
