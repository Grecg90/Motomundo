# Duplicar la plataforma para otra marca

Guía para montar una copia independiente (por ejemplo Ultramotor, Jetstereo u Outlet) sin reescribir nada.
Cada copia tiene **su propio** Supabase y **su propio** proyecto de Vercel; el código es el mismo repositorio.

## Qué hay en el paquete

| Carpeta / archivo | Qué es |
|---|---|
| `public/` | La aplicación web (una sola página) + `sw.js` (avisos) + `manifest.json` |
| `public/config.js` | URL y llave **pública** de Supabase de esta copia |
| `api/sync.js` | Sincronización diaria GA4 → Supabase (8 a. m. y 2 p. m. hora Honduras) |
| `api/admin.js` | Prueba de conexión Composio → GA4 para el panel (solo admin) |
| `lib/` | Cliente de Composio y consulta de GA4 |
| `supabase/schema.sql` | Base de datos completa: tablas, seguridad RLS, funciones, tiempo real, limpieza de 7 días |
| `supabase/functions/` | Funciones del servidor: `admin-users`, `app-config`, `ga4-ingest` |
| `vercel.json` | Horarios (cron) y cabeceras de seguridad |

## Pasos

1. **Supabase**: crear un proyecto nuevo.
   - SQL Editor → pegar y ejecutar `supabase/schema.sql`.
   - Desplegar las 3 funciones de `supabase/functions/` con **Verify JWT desactivado** (cada una valida la sesión o el secreto por dentro).
   - Authentication → Sign In / Providers: desactivar registro público y acceso anónimo; confirmar correo activo; contraseña mínima 8 con mayúsculas, minúsculas y números.
   - Authentication → URL Configuration: `Site URL` = la URL de la nueva app.
2. **Código**: en `public/config.js` poner la URL y la llave publicable del nuevo Supabase, y en `vercel.json` reemplazar el dominio `*.supabase.co` de la política de seguridad (`img-src` y `connect-src`).
3. **Vercel**: crear un proyecto desde este repositorio con estas variables (las dos últimas como *Sensitive*):
   - `SUPABASE_URL` y `SUPABASE_KEY` (llave publicable).
   - `SYNC_SECRET`: el valor de `select value from private.config where key = 'sync_secret';` en el SQL Editor del nuevo Supabase.
   - `CRON_SECRET`: una cadena larga al azar.
4. **Primer administrador** (el registro público está bloqueado):
   - SQL Editor: `select public.allow_invite('correo@empresa.com');`
   - Authentication → Users → *Invite user* con ese correo.
   - SQL Editor: `insert into public.profiles (id, email, full_name, role) select id, email, 'Nombre', 'admin' from auth.users where email = 'correo@empresa.com';`
5. **Panel de Configuración** (entrando como admin): URL de la app, marca, colores, logo y favicon; llave y usuario de Composio; propiedad GA4 (botón *Probar conexión y cargar propiedades*); llave de Resend y remitente.
   - GA4 se conecta primero en Composio (cuenta de Google autorizada para el `user_id` que pongas).
6. Probar con *Revisar todo* en Configuración: todos los indicadores en verde.

## Dónde vive cada secreto

- Llaves de Composio y Resend, secreto de sincronización y llaves de los avisos push: esquema `private` de Supabase (no expuesto por la API; solo lo leen las funciones del servidor).
- `SYNC_SECRET` y `CRON_SECRET`: variables *Sensitive* de Vercel.
- En el navegador solo existe la llave **publicable** de Supabase, que no da acceso a nada sin sesión (RLS).
