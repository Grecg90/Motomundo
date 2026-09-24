import { execute, route, USER_ID } from '../lib/composio.js';

// Reporte simple: usuarios, sesiones y vistas por día
export default route((body) =>
  execute('GOOGLE_ANALYTICS_BATCH_RUN_REPORTS', body.userId || USER_ID, {
    property: body.property,
    requests: [{
      dateRanges: [{ startDate: body.startDate || '7daysAgo', endDate: body.endDate || 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    }],
  }));
