// Puente servidor ↔ Supabase para la sincronización diaria (Vercel /api/sync) y los avisos push.
// Acciones con header x-sync-secret (secreto en el esquema privado):
//   (sin action)        guarda las filas diarias de GA4
//   { action:'config' } devuelve la configuración de Composio/GA4 guardada en el panel
//   { action:'notify' } envía el aviso push de "reporte actualizado"
// Acción con sesión de usuario activo:
//   { action:'pubkey' } devuelve la llave pública VAPID (la privada nunca sale de aquí)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const secretOf = async (k: string) => (await sb.rpc('get_secret', { p_key: k })).data as string | null;

async function vapid() {
  let pub = await secretOf('vapid_public'), priv = await secretOf('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await sb.rpc('set_secret_once', { p_key: 'vapid_private', p_value: k.privateKey });
    await sb.rpc('set_secret_once', { p_key: 'vapid_public', p_value: k.publicKey });
    pub = await secretOf('vapid_public'); priv = await secretOf('vapid_private');
  }
  return { pub: pub!, priv: priv! };
}

Deno.serve(async (req) => {
  const { data: st } = await sb.from('app_settings').select('*').eq('id', 1).single();
  const cors = { 'access-control-allow-origin': st?.app_url || '', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...cors } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'pubkey') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: 'no autorizado' }, 401);
    const { data: p } = await sb.from('profiles').select('active').eq('id', u.user.id).single();
    if (!p?.active) return json({ error: 'no autorizado' }, 401);
    return json({ key: (await vapid()).pub });
  }

  const secret = await secretOf('sync_secret');
  const given = req.headers.get('x-sync-secret') || '';
  if (!secret || given.length !== secret.length || given !== secret) return json({ error: 'no autorizado' }, 401);

  if (body.action === 'config') {
    const { data: brands } = await sb.from('brands').select('id,name,color,landing_url,store_url,product_paths').order('sort');
    return json({ composio_api_key: await secretOf('composio_api_key'), composio_user_id: st.composio_user_id, ga4_property: st.ga4_property, brands: brands || [] });
  }
  // Caché de reportes GA4 por rango (evita consultar GA4 en cada visita)
  if (body.action === 'cache_get') {
    const { data } = await sb.from('ga4_cache').select('data, created_at').eq('key', String(body.key)).maybeSingle();
    const fresh = data && Date.now() - Date.parse(data.created_at) < 24 * 3600e3;
    return json(fresh ? { hit: true, data: data.data, at: data.created_at } : { hit: false });
  }
  if (body.action === 'cache_put') {
    if (typeof body.key !== 'string' || body.key.length > 200 || !body.data) return json({ error: 'datos inválidos' }, 400);
    await sb.from('ga4_cache').upsert({ key: body.key, data: body.data, created_at: new Date().toISOString() });
    return json({ ok: true });
  }
  if (body.action === 'cache_clear') {
    await sb.from('ga4_cache').delete().neq('key', '');
    return json({ ok: true });
  }

  if (body.action === 'notify') {
    const { pub, priv } = await vapid();
    webpush.setVapidDetails('mailto:ricardo.recg@gmail.com', pub, priv);
    const { data: subs } = await sb.from('push_subscriptions').select('endpoint,p256dh,auth,user_id');
    const { data: act } = await sb.from('profiles').select('id').eq('active', true);
    const ok = new Set((act || []).map((r) => r.id));
    const payload = JSON.stringify({ title: 'Reporte actualizado', body: String(body.text || `Ya están los datos de GA4 de ayer en ${st.brand_name} ${st.app_name}.`).slice(0, 200) });
    let sent = 0; const drop: string[] = [];
    await Promise.all((subs || []).filter((s) => ok.has(s.user_id)).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 43200 }); sent++; }
      catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) drop.push(s.endpoint); }
    }));
    if (drop.length) await sb.from('push_subscriptions').delete().in('endpoint', drop);
    return json({ sent, dropped: drop.length });
  }

  const { from, to, rows } = body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Array.isArray(rows)) return json({ error: 'datos inválidos' }, 400);
  const { data, error } = await sb.rpc('ga4_sync_upsert', { p_secret: secret, p_from: from, p_to: to, p_rows: rows });
  if (error) return json({ error: error.message }, 500);
  return json({ rows: data });
});
