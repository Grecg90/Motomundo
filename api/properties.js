import { execute, route, USER_ID } from '../lib/composio.js';

// Lista cuentas y propiedades GA4
export default route((body) =>
  execute('GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES', body.userId || USER_ID, { pageSize: 200 }));
