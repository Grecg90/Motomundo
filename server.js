import http from 'node:http';
import { readFile } from 'node:fs/promises';

const API = 'https://backend.composio.dev/api/v3';
const { COMPOSIO_API_KEY, COMPOSIO_AUTH_CONFIG_ID, COMPOSIO_USER_ID = 'default', PORT = 3000 } = process.env;

async function composio(path, options = {}) {
  if (!COMPOSIO_API_KEY) throw new Error('Falta COMPOSIO_API_KEY en .env');
  const res = await fetch(API + path, {
    ...options,
    headers: { 'x-api-key': COMPOSIO_API_KEY, 'content-type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Composio ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const execute = (slug, userId, args) =>
  composio(`/tools/execute/${slug}`, { method: 'POST', body: JSON.stringify({ user_id: userId, arguments: args }) });

const routes = {
  // Estado de conexiones GA4 del usuario
  'GET /api/status': (_, q) =>
    composio(`/connected_accounts?toolkit_slugs=google_analytics&user_ids=${encodeURIComponent(q.get('userId') || COMPOSIO_USER_ID)}`),

  // Inicia OAuth y devuelve la URL a la que hay que redirigir
  'POST /api/connect': (body) => {
    if (!COMPOSIO_AUTH_CONFIG_ID) throw new Error('Falta COMPOSIO_AUTH_CONFIG_ID en .env');
    return composio('/connected_accounts', {
      method: 'POST',
      body: JSON.stringify({ auth_config: { id: COMPOSIO_AUTH_CONFIG_ID }, connection: { user_id: body.userId || COMPOSIO_USER_ID } }),
    });
  },

  // Lista cuentas y propiedades GA4
  'POST /api/properties': (body) =>
    execute('GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES', body.userId || COMPOSIO_USER_ID, { pageSize: 200 }),

  // Reporte simple: usuarios, sesiones y vistas por día
  'POST /api/report': (body) =>
    execute('GOOGLE_ANALYTICS_BATCH_RUN_REPORTS', body.userId || COMPOSIO_USER_ID, {
      property: body.property,
      requests: [{
        dateRanges: [{ startDate: body.startDate || '7daysAgo', endDate: body.endDate || 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }],
    }),
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = routes[`${req.method} ${url.pathname}`];
  try {
    if (handler) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const data = await handler(raw ? JSON.parse(raw) : {}, url.searchParams);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    } else if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(await readFile('public/index.html'));
    } else {
      res.writeHead(404).end('Not found');
    }
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, () => console.log(`Panel GA4 en http://localhost:${PORT}`));
