import { composio, route, USER_ID } from '../lib/composio.js';

// Estado de conexiones GA4 del usuario
export default route((_, q) =>
  composio(`/connected_accounts?toolkit_slugs=google_analytics&user_ids=${encodeURIComponent(q.userId || USER_ID)}`));
