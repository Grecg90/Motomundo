// Administración de usuarios (solo admin) y recuperación de contraseña (pública, con límite).
// Los secretos (llave de servicio, Resend) viven en el servidor; nunca llegan al navegador.
// La URL de la app y el nombre de la marca salen del panel de configuración (tabla app_settings).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['admin', 'subgerente', 'jefe', 'especialista'];
const ROLE_NAME: Record<string, string> = { admin: 'Jefe Web (administrador)', subgerente: 'Subgerente', jefe: 'Jefe de canal', especialista: 'Especialista' };
const CANALES = ['Directos', 'Redes', 'Pauta'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

let APP = '', NAME = '', RED = '#d71920', DARK = '#0d0e10', LOGO = '';
async function loadSettings() {
  const { data: st } = await sb.from('app_settings').select('app_url, brand_name, app_name, color_primary, color_dark, favicon_url').eq('id', 1).single();
  APP = st?.app_url || ''; NAME = `${st?.brand_name || ''} ${st?.app_name || ''}`.trim();
  RED = st?.color_primary || RED; DARK = st?.color_dark || DARK; LOGO = st?.favicon_url || `${APP}/favicon-512.png`;
}

async function log(user: { id?: string; name?: string; role?: string } | null, action: string, entity_id: string, summary: string, detail = {}) {
  await sb.from('activity_log').insert({ user_id: user?.id ?? null, user_name: user?.name ?? 'Sistema', user_role: user?.role ?? '', action, entity: action.split('.')[0], entity_id, summary, detail });
}
async function passwordLink(email: string, type: 'invite' | 'recovery', data?: Record<string, unknown>) {
  // El registro público está bloqueado: se autoriza este correo por 10 minutos para crear la cuenta invitada
  if (type === 'invite') { const { error: e } = await sb.rpc('allow_invite', { p_email: email }); if (e) throw new Error(e.message); }
  const { data: r, error } = await sb.auth.admin.generateLink({ type, email, options: data ? { data } : undefined });
  if (error) throw new Error(error.message);
  return { link: `${APP}/#/crear-contrasena?th=${r.properties.hashed_token}&t=${type}`, user: r.user };
}

// ----- Correo (Resend) -----
async function sendMail(to: string, subject: string, title: string, intro: string, cta: string, link: string) {
  const [{ data: key }, { data: from }] = await Promise.all([sb.rpc('get_secret', { p_key: 'resend_api_key' }), sb.rpc('get_secret', { p_key: 'mail_from' })]);
  if (!key) return { sent: false, error: 'Correo no configurado' };
  const html = `<!doctype html><html><body style="margin:0;background:#f0f1f3;font-family:Arial,Helvetica,sans-serif;color:#17181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden">
  <tr><td style="background:${DARK};padding:18px 28px;color:#fff;font-size:17px;font-weight:bold"><img src="${esc(LOGO)}" width="32" height="32" alt="" style="vertical-align:middle;margin-right:10px">${esc(NAME)}</td></tr>
  <tr><td style="padding:28px"><h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1><p style="font-size:15px;line-height:1.55;color:#3d4047;margin:0 0 22px">${intro}</p>
  <a href="${link}" style="display:inline-block;background:${RED};color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">${esc(cta)}</a>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#f0f1f3;border-radius:10px"><tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#3d4047">
    <b style="color:#17181b">Importante</b><br>
    &bull; El enlace <b>vence en 24 horas</b> y es de un solo uso.<br>
    &bull; La contraseña debe tener <b>mínimo 8 caracteres</b>, con <b>mayúsculas, minúsculas y números</b>.<br>
    &bull; Tendrás que escribirla dos veces para confirmarla.
  </td></tr></table>
  <p style="font-size:12px;color:#6a6e77;line-height:1.5;margin:18px 0 0">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all;color:${RED}">${link}</span></p>
  <p style="font-size:12px;color:#6a6e77;line-height:1.5;margin:12px 0 0">Si no esperabas este correo, ignóralo: nadie podrá entrar sin este enlace.</p></td></tr>
  </table></td></tr></table></body></html>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: from || `${NAME} <onboarding@resend.dev>`, to: [to], subject, html }),
  });
  if (r.ok) return { sent: true };
  const j = await r.json().catch(() => ({}));
  console.error('resend', r.status, j);
  return { sent: false, error: r.status === 403 ? 'Sin dominio propio en Resend solo se puede enviar al correo del administrador' : 'No se pudo enviar el correo' };
}
const inviteMail = (to: string, name: string, role: string, link: string) => sendMail(to, `Tu acceso a ${NAME}`, `Hola ${name || ''}`.trim(),
  `Te crearon un usuario en <b>${esc(NAME)}</b> con el rol <b>${esc(ROLE_NAME[role] || role)}</b>. Entra al enlace para crear tu contraseña.`, 'Crear mi contraseña', link);
const recoveryMail = (to: string, name: string, link: string) => sendMail(to, `Recupera tu contraseña de ${NAME}`, `Hola ${name || ''}`.trim(),
  'Recibimos una solicitud para cambiar tu contraseña. Entra al enlace para crear una nueva.', 'Crear nueva contraseña', link);
const emailChangedMail = (to: string, name: string, link: string) => sendMail(to, `Tu correo de acceso a ${NAME} cambió`, `Hola ${name || ''}`.trim(),
  `El administrador actualizó tu correo de acceso a <b>${esc(to)}</b>. Desde ahora entras con este correo. Usa el enlace para definir tu contraseña.`, 'Definir mi contraseña', link);

Deno.serve(async (req) => {
  await loadSettings();
  const cors = { 'access-control-allow-origin': APP, 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    // ----- Pública: recuperar contraseña (respuesta idéntica exista o no el correo; máx. 3 por hora) -----
    if (action === 'forgot') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL.test(email)) return json({ ok: true });
      const { data: p } = await sb.from('profiles').select('id, full_name, active').eq('email', email).maybeSingle();
      if (p?.active) {
        const since = new Date(Date.now() - 3600e3).toISOString();
        const { count } = await sb.from('activity_log').select('id', { count: 'exact', head: true }).eq('action', 'auth.recuperar_solicitud').eq('entity_id', p.id).gte('at', since);
        if ((count || 0) < 3) {
          const { link } = await passwordLink(email, 'recovery');
          const mail = await recoveryMail(email, p.full_name, link);
          await log({ id: p.id, name: p.full_name || email, role: '' }, 'auth.recuperar_solicitud', p.id, email, { email, correo_enviado: mail.sent });
        }
      }
      return json({ ok: true });
    }

    // ----- Solo administrador -----
    const token = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: 'Sesión inválida' }, 401);
    const { data: me } = await sb.from('profiles').select('id, full_name, email, role, active').eq('id', u.user.id).maybeSingle();
    if (!me?.active || me.role !== 'admin') return json({ error: 'Solo el administrador puede hacer esto' }, 403);
    const actor = { id: me.id, name: me.full_name || me.email, role: me.role };
    const uid = String(body.user_id || '');
    if (['link', 'update', 'delete'].includes(action) && !UUID.test(uid)) return json({ error: 'Usuario inválido' }, 400);

    if (action === 'invite') {
      const email = String(body.email || '').trim().toLowerCase(), full_name = String(body.full_name || '').trim().slice(0, 120);
      const role = String(body.role), canal = body.canal ? String(body.canal) : null;
      if (!EMAIL.test(email)) return json({ error: 'Correo inválido' }, 400);
      if (!full_name) return json({ error: 'Falta el nombre' }, 400);
      if (!ROLES.includes(role)) return json({ error: 'Rol inválido' }, 400);
      if (role === 'jefe' && !CANALES.includes(canal || '')) return json({ error: 'El jefe necesita un canal' }, 400);
      const { data: exists } = await sb.from('profiles').select('id').eq('email', email).maybeSingle();
      if (exists) return json({ error: 'Ya existe un usuario con ese correo' }, 409);
      const { link, user } = await passwordLink(email, 'invite', { full_name });
      await sb.from('profiles').upsert({ id: user.id, email, full_name, role, canal: canal && CANALES.includes(canal) ? canal : null, active: true });
      const mail = await inviteMail(email, full_name, role, link);
      await log(actor, 'usuario.crear', user.id, full_name || email, { email, role, canal, correo_enviado: mail.sent });
      return json({ link, id: user.id, emailed: mail.sent, email_error: mail.error });
    }
    if (action === 'link') {
      const { data: p } = await sb.from('profiles').select('email, full_name, role').eq('id', uid).single();
      if (!p) return json({ error: 'Usuario no encontrado' }, 404);
      const { data: au } = await sb.auth.admin.getUserById(uid);
      const pending = !au?.user?.last_sign_in_at;
      // Para cuentas ya confirmadas (p. ej. tras un cambio de correo) se usa recuperación, que sirve igual para definir contraseña
      const type = pending && !au?.user?.email_confirmed_at ? 'invite' : 'recovery';
      const { link } = await passwordLink(p.email, type);
      const mail = body.send ? (pending ? await inviteMail(p.email, p.full_name, p.role, link) : await recoveryMail(p.email, p.full_name, link)) : { sent: false };
      await log(actor, pending ? 'usuario.reenviar_invitacion' : 'usuario.enlace_recuperacion', uid, p.full_name || p.email, { correo_enviado: mail.sent });
      return json({ link, pending, emailed: mail.sent, email_error: (mail as { error?: string }).error });
    }
    if (action === 'update') {
      const { data: before } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (!before) return json({ error: 'Usuario no encontrado' }, 404);
      const patch: Record<string, unknown> = {};
      if (body.role !== undefined) { if (!ROLES.includes(body.role)) return json({ error: 'Rol inválido' }, 400); patch.role = body.role; }
      if (body.canal !== undefined) patch.canal = CANALES.includes(body.canal) ? body.canal : null;
      if (body.full_name !== undefined) { const n = String(body.full_name).trim().slice(0, 120); if (!n) return json({ error: 'El nombre no puede quedar vacío' }, 400); patch.full_name = n; }
      if (body.active !== undefined) patch.active = !!body.active;
      let newEmail = '';
      if (body.email !== undefined) {
        newEmail = String(body.email).trim().toLowerCase();
        if (!EMAIL.test(newEmail)) return json({ error: 'Correo inválido' }, 400);
        if (newEmail === before.email) newEmail = '';
        else {
          const { data: dup } = await sb.from('profiles').select('id').eq('email', newEmail).maybeSingle();
          if (dup) return json({ error: 'Ya existe un usuario con ese correo' }, 409);
          if (uid === me.id) return json({ error: 'Para cambiar tu propio correo pídelo a otro administrador' }, 400);
        }
      }
      if (uid === me.id && ((patch.role && patch.role !== 'admin') || patch.active === false)) return json({ error: 'No puedes quitarte el rol de admin ni desactivarte' }, 400);
      if (patch.role === 'jefe' && !(patch.canal ?? before.canal)) return json({ error: 'El jefe necesita un canal' }, 400);
      if (!Object.keys(patch).length && !newEmail) return json(before);

      // 1) Correo de acceso (Auth) — si falla, no se toca nada más
      if (newEmail) {
        const { error: e1 } = await sb.auth.admin.updateUserById(uid, { email: newEmail, email_confirm: true, user_metadata: { full_name: patch.full_name ?? before.full_name } });
        if (e1) { console.error(e1); return json({ error: e1.message.includes('already') ? 'Ese correo ya está registrado' : 'No se pudo cambiar el correo' }, 400); }
        patch.email = newEmail;
      }
      // 2) Perfil (queda siempre igual al acceso)
      const { data: p, error } = await sb.from('profiles').update(patch).eq('id', uid).select().single();
      if (error) throw error;
      if (patch.active !== undefined) await sb.auth.admin.updateUserById(uid, { ban_duration: patch.active ? 'none' : '876000h' });
      // 3) Correo nuevo: se cierran sus sesiones y se genera enlace para definir contraseña (si falla, el cambio ya quedó hecho)
      let link = '', mail: { sent: boolean; error?: string } = { sent: false };
      if (newEmail) {
        await sb.auth.admin.signOut(uid).catch(() => {});
        try {
          ({ link } = await passwordLink(newEmail, 'recovery'));
          mail = await emailChangedMail(newEmail, String(p.full_name), link);
        } catch (e) { console.error(e); }
      }
      const changes: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) changes[k] = { antes: before[k] ?? null, ahora: patch[k] ?? null };
      await log(actor, patch.active === false ? 'usuario.desactivar' : patch.active === true ? 'usuario.activar' : 'usuario.editar', uid, p.full_name || p.email, changes);
      return json({ ...p, link: link || undefined, emailed: mail.sent, email_error: mail.error });
    }
    if (action === 'delete') {
      if (uid === me.id) return json({ error: 'No puedes eliminar tu propio usuario' }, 400);
      const { data: p } = await sb.from('profiles').select('email, full_name').eq('id', uid).single();
      const { error } = await sb.auth.admin.deleteUser(uid);
      if (error) throw error;
      await log(actor, 'usuario.eliminar', uid, p?.full_name || p?.email || '', { email: p?.email });
      return json({ ok: true });
    }
    if (action === 'list') {
      const { data: ps } = await sb.from('profiles').select('*').order('created_at');
      const { data: au } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const last = new Map((au?.users || []).map((x) => [x.id, x.last_sign_in_at]));
      return json((ps || []).map((p) => ({ ...p, last_sign_in_at: last.get(p.id) || null, pending: !last.get(p.id) })));
    }
    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Ocurrió un error en el servidor' }, 500);
  }
});
