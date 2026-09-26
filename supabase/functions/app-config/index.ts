// Panel de configuración (solo admin): marca, GA4, Composio y Resend.
// Las llaves se guardan en el esquema privado y NUNCA se devuelven al navegador: solo se informa si están configuradas.
import { createClient } from 'npm:@supabase/supabase-js@2';
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const HEX = /^#[0-9a-fA-F]{6}$/, EMAIL = /^[^@\s<>]{1,64}@[^@\s<>]{1,190}\.[^@\s<>]{2,}$/;
const FIELDS: Record<string, (v: string) => boolean> = {
  brand_name: (v) => v.length >= 1 && v.length <= 60,
  app_name: (v) => v.length >= 1 && v.length <= 60,
  app_url: (v) => /^https:\/\/[^/\s]+$/.test(v),
  color_primary: (v) => HEX.test(v),
  color_dark: (v) => HEX.test(v),
  logo_url: (v) => v === '' || /^https:\/\/\S+$/.test(v),
  favicon_url: (v) => v === '' || /^https:\/\/\S+$/.test(v),
  ga4_property: (v) => /^properties\/\d+$/.test(v),
  composio_user_id: (v) => /^[\w.@-]{1,120}$/.test(v),
  mail_from_name: (v) => v.length >= 1 && v.length <= 80 && !/[<>"\r\n]/.test(v),
};

Deno.serve(async (req) => {
  const { data: st } = await sb.from('app_settings').select('*').eq('id', 1).single();
  const cors = { 'access-control-allow-origin': st?.app_url || '', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: 'Sesión inválida' }, 401);
    const { data: me } = await sb.from('profiles').select('id, full_name, email, role, active').eq('id', u.user.id).maybeSingle();
    if (!me?.active || me.role !== 'admin') return json({ error: 'Solo el administrador puede hacer esto' }, 403);
    const log = (action: string, summary: string, detail = {}) => sb.from('activity_log').insert({ user_id: me.id, user_name: me.full_name || me.email, user_role: me.role, action, entity: 'config', entity_id: 'app', summary, detail });
    const secretSet = async (k: string) => !!(await sb.rpc('get_secret', { p_key: k })).data;
    const mailFrom = async () => (await sb.rpc('get_secret', { p_key: 'mail_from' })).data as string | null;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'get') {
      const from = await mailFrom();
      return json({ settings: st, secrets: { composio_api_key: await secretSet('composio_api_key'), resend_api_key: await secretSet('resend_api_key') },
        mail_from: from ? (from.match(/<([^>]+)>/)?.[1] || from) : '' });
    }
    if (action === 'save') {
      const patch: Record<string, unknown> = {}, changes: Record<string, unknown> = {};
      for (const [k, ok] of Object.entries(FIELDS)) {
        if (body.settings?.[k] === undefined) continue;
        const v = String(body.settings[k]).trim();
        if (!ok(v)) return json({ error: `Valor inválido en ${k}` }, 400);
        const nv = v === '' ? null : v;
        if (nv !== st[k]) { patch[k] = nv; changes[k] = { antes: st[k], ahora: nv }; }
      }
      // Remitente del correo: "Nombre <correo>"
      if (body.mail_from !== undefined) {
        const addr = String(body.mail_from).trim();
        if (addr && !EMAIL.test(addr)) return json({ error: 'Correo remitente inválido' }, 400);
        const cur = await mailFrom(); const curAddr = cur ? (cur.match(/<([^>]+)>/)?.[1] || cur) : '';
        const name = String(patch.mail_from_name ?? st.mail_from_name);
        if (addr !== curAddr || patch.mail_from_name) {
          await sb.rpc('set_secret', { p_key: 'mail_from', p_value: addr ? `${name} <${addr}>` : '' });
          if (addr !== curAddr) changes.mail_from = { antes: curAddr || '(predeterminado)', ahora: addr || '(predeterminado)' };
        }
      }
      // Mapa de canales: { "m:<medio>": canal, "s:<fuente>": canal }
      if (body.channel_map !== undefined) {
        const cm = body.channel_map, CAN = ['Pauta', 'Directos', 'Redes', 'Otros'];
        if (!cm || typeof cm !== 'object' || Array.isArray(cm)) return json({ error: 'Mapa de canales inválido' }, 400);
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(cm)) {
          if (!/^[ms]:.{1,80}$/.test(k) || !CAN.includes(String(v))) return json({ error: `Mapa de canales inválido en ${k}` }, 400);
          clean[k] = String(v);
        }
        if (Object.keys(clean).length > 400) return json({ error: 'Demasiadas reglas en el mapa' }, 400);
        if (JSON.stringify(clean) !== JSON.stringify(st.channel_map || {})) { patch.channel_map = clean; changes.channel_map = { antes: `${Object.keys(st.channel_map || {}).length} reglas`, ahora: `${Object.keys(clean).length} reglas` }; }
      }
      if (Object.keys(patch).length) {
        const { error } = await sb.from('app_settings').update({ ...patch, updated_at: new Date().toISOString(), updated_by: me.id }).eq('id', 1);
        if (error) throw error;
      }
      if (Object.keys(changes).length) await log('config.editar', 'Configuración', changes);
      const { data: now } = await sb.from('app_settings').select('*').eq('id', 1).single();
      return json({ settings: now });
    }
    if (action === 'secret') {
      const key = String(body.key || ''), value = String(body.value ?? '').trim();
      if (!['composio_api_key', 'resend_api_key'].includes(key)) return json({ error: 'Llave no permitida' }, 400);
      if (value && (value.length < 10 || value.length > 300 || /\s/.test(value))) return json({ error: 'La llave no tiene un formato válido' }, 400);
      if (key === 'composio_api_key' && value) {
        const r = await fetch('https://backend.composio.dev/api/v3/auth_configs?limit=1', { headers: { 'x-api-key': value } });
        if (r.status === 401) return json({ error: 'Composio rechazó esa llave' }, 400);
      }
      // Resend: una llave de solo envío no puede validarse sin enviar; se prueba con "Enviar correo de prueba"
      await sb.rpc('set_secret', { p_key: key, p_value: value });
      await log('config.llave', key === 'composio_api_key' ? 'Llave de Composio' : 'Llave de Resend', { accion: value ? 'reemplazada' : 'eliminada' });
      return json({ ok: true, set: !!value });
    }
    if (action === 'test_resend') {
      const key = (await sb.rpc('get_secret', { p_key: 'resend_api_key' })).data;
      if (!key) return json({ ok: false, error: 'No hay llave de Resend configurada' });
      const name = `${st.brand_name} ${st.app_name}`;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: (await mailFrom()) || `${name} <onboarding@resend.dev>`, to: [me.email], subject: `Prueba de correo · ${name}`,
          html: `<p style="font-family:Arial,sans-serif">El correo de <b>${name}</b> funciona correctamente.</p>` }),
      });
      const j = await r.json().catch(() => ({}));
      return json(r.ok ? { ok: true, to: me.email } : { ok: false, error: j.message || `Resend respondió ${r.status}` });
    }
    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Ocurrió un error en el servidor' }, 500);
  }
});
