# Motomundo · Panel de prueba GA4 vía Composio

Panel mínimo desplegado en Vercel para verificar que podemos traer datos de GA4 a través de Composio.

- `public/index.html` — el panel
- `api/*.js` — funciones serverless que llaman a Composio (la API key nunca llega al navegador)

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Descripción |
|---|---|
| `COMPOSIO_API_KEY` | API key de Composio |
| `COMPOSIO_USER_ID` | User ID dueño de la conexión GA4 en Composio |
| `COMPOSIO_AUTH_CONFIG_ID` | Opcional, solo para crear conexiones nuevas |

Cada push a la rama vinculada redepliega automáticamente.

Flujo: **Comprobar** conexión → **Listar propiedades** → **Traer datos** (usuarios activos, sesiones y vistas por día).
