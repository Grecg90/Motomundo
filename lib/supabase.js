// Cliente mínimo de Supabase (REST) sin dependencias
const URL_ = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_KEY;

async function sb(path, options = {}) {
  if (!URL_() || !KEY()) throw new Error('Faltan SUPABASE_URL / SUPABASE_KEY en las variables de entorno');
  const res = await fetch(URL_() + path, {
    ...options,
    headers: { apikey: KEY(), authorization: `Bearer ${KEY()}`, 'content-type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${JSON.stringify(body)}`);
  return { body, res };
}

export const rpc = (fn, args) => sb(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }).then(r => r.body);

// Lee todas las filas paginando de 1000 en 1000
export async function selectAll(table, query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { body } = await sb(`/rest/v1/${table}?${query}`, { headers: { range: `${from}-${from + 999}` } });
    out.push(...body);
    if (body.length < 1000) return out;
  }
}
