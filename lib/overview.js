import { execute, cfg } from './composio.js';
import { createHash } from 'node:crypto';

// Generalidades de GA4 para un rango (y el periodo anterior del mismo largo).
// Usuarios de un rango se piden a GA4 por rango completo (no se suman días), así las cifras son las de GA4.
const n = v => Number(v) || 0;
const addD = (s, k) => new Date(Date.parse(s + 'T12:00Z') + k * 864e5).toISOString().slice(0, 10);
export const prevRange = (from, to) => { const len = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1, pTo = addD(from, -1); return [addD(pTo, -(len - 1)), pTo]; };
const pathOf = u => { try { return u ? new URL(u).pathname : null; } catch { return null; } };

async function run(args) {
  const r = await execute('GOOGLE_ANALYTICS_RUN_REPORT', cfg().userId, { property: cfg().property, ...args });
  if (r.successful === false) throw new Error('GA4: ' + (r.error || 'falló la consulta'));
  return (r.data?.rows || []).map(x => ({ d: (x.dimensionValues || []).map(v => v.value), m: (x.metricValues || []).map(v => n(v.value)) }));
}
const M = (...names) => names.map(name => ({ name }));
const D = (...names) => names.map(name => ({ name }));
const desc = metricName => [{ metric: { metricName }, desc: true }];
const isPrev = d => d[d.length - 1] === 'date_range_1';

export const brandsKey = brands => createHash('sha1').update(JSON.stringify(brands.map(b => [b.id, b.landing_url, b.store_url, b.product_paths]))).digest('hex').slice(0, 10);

export async function overview(from, to, brands) {
  const [pFrom, pTo] = prevRange(from, to);
  const cur = { startDate: from, endDate: to }, DR = [cur, { startDate: pFrom, endDate: pTo }];
  const B = brands.map(b => ({ ...b, lp: pathOf(b.landing_url), sp: pathOf(b.store_url), pp: (b.product_paths || []).map(p => pathOf(p) || p) }));
  const prefixes = [...new Set(B.flatMap(b => [b.lp, b.sp]).filter(Boolean))], products = [...new Set(B.flatMap(b => b.pp))];
  const brandFilter = { orGroup: { expressions: [
    ...prefixes.map(value => ({ filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value } } })),
    ...(products.length ? [{ filter: { fieldName: 'pagePath', inListFilter: { values: products } } }] : []),
  ] } };
  const [tot, daily, city, land, chan, pages, prods] = await Promise.all([
    run({ dateRanges: DR, metrics: M('activeUsers', 'newUsers', 'totalUsers') }),
    run({ dateRanges: [cur], dimensions: D('date'), metrics: M('activeUsers', 'newUsers'), limit: 400 }),
    run({ dateRanges: DR, dimensions: D('city'), metrics: M('activeUsers'), orderBys: desc('activeUsers'), limit: 80 }),
    run({ dateRanges: DR, dimensions: D('landingPage'), metrics: M('activeUsers', 'newUsers', 'sessions', 'engagedSessions'), orderBys: desc('activeUsers'), limit: 250 }),
    run({ dateRanges: DR, dimensions: D('firstUserDefaultChannelGroup'), metrics: M('activeUsers', 'newUsers'), limit: 60 }),
    prefixes.length || products.length ? run({ dateRanges: DR, dimensions: D('pagePath'), metrics: M('activeUsers'), dimensionFilter: brandFilter, limit: 10000 }) : [],
    run({ dateRanges: [cur], dimensions: D('pagePath'), metrics: M('activeUsers'), dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/producto/' } } }, orderBys: desc('activeUsers'), limit: 1500 }),
  ]);
  const T = k => { const r = tot.find(x => (k === 'prev') === isPrev(x.d)) || { m: [0, 0, 0] }; return { active: r.m[0], new: r.m[1], total: r.m[2] }; };
  const totals = { cur: T('cur'), prev: T('prev') };

  // Ciudades: las 9 principales con nombre; el resto (incluye "(not set)" y códigos) en "Otras"
  // Ciudades: [nombre, usuarios, usuarios periodo anterior]; 9 con nombre y el resto en "Otras"
  const cm = new Map();
  for (const r of city) { const k = r.d[0], e = cm.get(k) || [k, 0, 0]; e[isPrev(r.d) ? 2 : 1] += r.m[0]; cm.set(k, e); }
  const named = [...cm.values()].filter(c => c[0] && c[0] !== '(not set)' && !/^\d+$/.test(c[0])).sort((a, b) => b[1] - a[1]).slice(0, 9);
  const cities = [...named, ['Otras', Math.max(0, totals.cur.active - named.reduce((a, c) => a + c[1], 0)), Math.max(0, totals.prev.active - named.reduce((a, c) => a + c[2], 0))]];
  // Páginas de destino: [ruta, activos, nuevos, sesiones, sesiones con interacción, activos antes, nuevos antes, sesiones antes]
  const lm = new Map();
  for (const r of land) { const k = r.d[0] || '(not set)', e = lm.get(k) || [k, 0, 0, 0, 0, 0, 0, 0]; if (isPrev(r.d)) { e[5] += r.m[0]; e[6] += r.m[1]; e[7] += r.m[2]; } else { e[1] += r.m[0]; e[2] += r.m[1]; e[3] += r.m[2]; e[4] += r.m[3]; } lm.set(k, e); }
  const landing = [...lm.values()].filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 60);

  const chMap = new Map();
  for (const r of chan) { const k = r.d[0] || '(not set)', e = chMap.get(k) || [k, 0, 0, 0, 0]; if (isPrev(r.d)) { e[3] += r.m[0]; e[4] += r.m[1]; } else { e[1] += r.m[0]; e[2] += r.m[1]; } chMap.set(k, e); }

  // Marcas: usuarios en la landing y en la tienda (URL de categoría), actual y anterior; el total es la suma de ambos
  const brandsOut = B.map(b => {
    const o = { id: b.id, name: b.name, color: b.color, landing: 0, store: 0, pLanding: 0, pStore: 0, hasLanding: !!b.lp, hasStore: !!b.sp };
    for (const r of pages) {
      const p = r.d[0], prev = isPrev(r.d);
      if (b.lp && p.toLowerCase().startsWith(b.lp.toLowerCase())) o[prev ? 'pLanding' : 'landing'] += r.m[0];
      else if (b.sp && p.startsWith(b.sp)) o[prev ? 'pStore' : 'store'] += r.m[0];
    }
    return o;
  });

  return {
    range: { from, to, pFrom, pTo }, totals,
    daily: daily.map(r => [`${r.d[0].slice(0, 4)}-${r.d[0].slice(4, 6)}-${r.d[0].slice(6)}`, r.m[0], r.m[1]]).sort((a, b) => a[0] < b[0] ? -1 : 1),
    cities, landing,
    channels: [...chMap.values()].sort((a, b) => b[1] - a[1]),
    brands: brandsOut,
    productPages: prods.map(r => [r.d[0], r.m[0]]),
    at: new Date().toISOString(),
  };
}
