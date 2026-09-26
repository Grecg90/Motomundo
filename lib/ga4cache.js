import { loadConfig } from './composio.js';
import { overview, brandsKey } from './overview.js';

// Caché 24 h por rango en Supabase (vía la función ga4-ingest con el secreto de sincronización)
export const ingest = async body => {
  const r = await fetch(`${process.env.SUPABASE_URL}/functions/v1/ga4-ingest`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: process.env.SUPABASE_KEY, 'x-sync-secret': process.env.SYNC_SECRET },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return r.json();
};
export async function cachedOverview(from, to, { force = false } = {}) {
  const c = await loadConfig();
  const key = `ov2|${from}|${to}|${brandsKey(c.brands || [])}`;
  if (!force) { const hit = await ingest({ action: 'cache_get', key }); if (hit.hit) return { ...hit.data, cached: true }; }
  const data = await overview(from, to, c.brands || []);
  await ingest({ action: 'cache_put', key, data }).catch(() => {});
  return data;
}

