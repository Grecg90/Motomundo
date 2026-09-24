import { composio, route, USER_ID } from '../lib/composio.js';

// Inicia OAuth y devuelve la URL a la que hay que redirigir
export default route((body) => {
  if (!process.env.COMPOSIO_AUTH_CONFIG_ID) throw new Error('Falta COMPOSIO_AUTH_CONFIG_ID en las variables de entorno');
  return composio('/connected_accounts', {
    method: 'POST',
    body: JSON.stringify({ auth_config: { id: process.env.COMPOSIO_AUTH_CONFIG_ID }, connection: { user_id: body.userId || USER_ID } }),
  });
});
