# Motomundo · Panel de prueba GA4 vía Composio

Panel mínimo (Node ≥ 20.6, sin dependencias) para verificar que podemos traer datos de GA4 a través de Composio.

```bash
cp .env.example .env   # rellena COMPOSIO_API_KEY y COMPOSIO_USER_ID
npm start              # http://localhost:3000
```

Flujo: **Comprobar** conexión → (opcional) **Conectar GA4** vía OAuth → **Listar propiedades** → **Traer datos** (usuarios activos, sesiones y vistas por día).

Herramientas de Composio usadas: `GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES`, `GOOGLE_ANALYTICS_BATCH_RUN_REPORTS`.
