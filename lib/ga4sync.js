import { execute, cfg } from './composio.js';

export const EVENTS = ['Cotiza_Producto', 'Cotización_Crédito'];
const DIMS = ['date', 'sessionCampaignName', 'sessionSource', 'sessionMedium', 'sessionManualTerm',
  'sessionManualAdContent', 'hostName', 'landingPage'];
// Solo tráfico con utm_campaign (excluye "(organic)", "(direct)", "(referral)", "(not set)")
const WITH_UTM = { notExpression: { filter: { fieldName: 'sessionCampaignName', stringFilter: { matchType: 'BEGINS_WITH', value: '(' } } } };

async function report(from, to, extraDims, metric, filter) {
  const r = await execute('GOOGLE_ANALYTICS_RUN_REPORT', cfg().userId, {
    property: cfg().property,
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [...DIMS, ...extraDims].map(name => ({ name })),
    metrics: [{ name: metric }],
    dimensionFilter: filter,
    limit: 100000,
  });
  if (r.successful === false) throw new Error('GA4: ' + (r.error || 'falló la consulta'));
  return (r.data?.rows || []).map(x => [x.dimensionValues.map(v => v.value), Number(x.metricValues[0].value)]);
}

// Devuelve filas diarias por UTM: usuarios + veces que se accionó cada evento
export async function fetchDaily(from, to) {
  const [users, events] = await Promise.all([
    report(from, to, [], 'activeUsers', WITH_UTM),
    report(from, to, ['eventName'], 'eventCount',
      { andGroup: { expressions: [WITH_UTM, { filter: { fieldName: 'eventName', inListFilter: { values: EVENTS } } }] } }),
  ]);
  const M = new Map();
  // El dominio (hostName) se guarda aparte: una misma UTM puede partirse en varios; nos quedamos con el principal
  const row = ([d, campaign, source, medium, term, content, host, landing_page]) => {
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    const k = [date, campaign, source, medium, term, content, landing_page].join('\u0001');
    let r = M.get(k);
    if (!r) M.set(k, r = { date, campaign, source, medium, term, content, landing_page, host, users: 0, cotiza_producto: 0, cotizacion_credito: 0, _hu: -1 });
    return r;
  };
  for (const [dv, n] of users) {
    const r = row(dv); r.users += n;
    if (n > r._hu) { r._hu = n; r.host = dv[6]; }
  }
  for (const [dv, n] of events) {
    const r = row(dv);
    if (dv[8] === EVENTS[0]) r.cotiza_producto += n; else r.cotizacion_credito += n;
    if (r._hu < 0) r.host = dv[6];
  }
  return [...M.values()].map(({ _hu, ...r }) => r);
}
