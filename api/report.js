import { execute, route, USER_ID } from '../lib/composio.js';

// Últimos 7 días por "Grupo predeterminado de canales de la sesión"
export default route((body) =>
  execute('GOOGLE_ANALYTICS_RUN_REPORT', body.userId || USER_ID, {
    property: body.property || process.env.GA4_PROPERTY || 'properties/349018417',
    dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagedSessions' }, { name: 'engagementRate' }],
    orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
    metricAggregations: ['TOTAL'],
  }));
