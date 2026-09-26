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
    run({ dateRanges: [cur], dimensions: D('city'), metrics: M('activeUsers'), orderBys: desc('activeUsers'), limit: 30 }),
    run({ dateRanges: [cur], dimensions: D('landingPage'), metrics: M('activeUsers', 'newUsers'), orderBys: desc('activeUsers'), limit: 40 }),
    run({ dateRanges: DR, dimensions: D('firstUserDefaultChannelGroup'), metrics: M('activeUsers', 'newUsers'), limit: 60 }),
    prefixes.length || products.length ? run({ dateRanges: DR, dimensions: D('pagePath'), metrics: M('activeUsers'), dimensionFilter: brandFilter, limit: 10000 }) : [],
    run({ dateRanges: [cur], dimensions: D('pagePath'), metrics: M('activeUsers'), dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/producto/' } } }, orderBys: desc('activeUsers'), limit: 1500 }),
  ]);
  const T = k => { const r = tot.find(x => (k === 'prev') === isPrev(x.d)) || { m: [0, 0, 0] }; return { active: r.m[0], new: r.m[1], total: r.m[2] }; };
  const totals = { cur: T('cur'), prev: T('prev') };

  // Ciudades: las 9 principales con nombre; el resto (incluye "(not set)" y códigos) en "Otras"
  const named = city.filter(c => c.d[0] && c.d[0] !== '(not set)' && !/^\d+$/.test(c.d[0])).slice(0, 9).map(c => [c.d[0], c.m[0]]);
  const cities = [...named, ['Otras', Math.max(0, totals.cur.active - named.reduce((a, c) => a + c[1], 0))]];

  const chMap = new Map();
  for (const r of chan) { const k = r.d[0] || '(not set)', e = chMap.get(k) || [k, 0, 0, 0, 0]; if (isPrev(r.d)) { e[3] += r.m[0]; e[4] += r.m[1]; } else { e[1] += r.m[0]; e[2] += r.m[1]; } chMap.set(k, e); }

  const brandsOut = B.map(b => {
    const mine = p => (b.lp && (p === b.lp || p.startsWith(b.lp))) || (b.sp && p.startsWith(b.sp)) || b.pp.includes(p);
    let u = 0, pu = 0; const cats = new Set(), seen = new Set();
    for (const r of pages) {
      const p = r.d[0]; if (!mine(p)) continue;
      if (isPrev(r.d)) pu += r.m[0]; else { u += r.m[0]; if (b.sp && p.startsWith(b.sp) && p !== b.sp && r.m[0]) cats.add(p); if (b.pp.includes(p) && r.m[0]) seen.add(p); }
    }
    return { id: b.id, name: b.name, color: b.color, users: u, prev: pu, products: b.pp.length, productsSeen: seen.size, categories: cats.size };
  });

  return {
    range: { from, to, pFrom, pTo }, totals,
    daily: daily.map(r => [`${r.d[0].slice(0, 4)}-${r.d[0].slice(4, 6)}-${r.d[0].slice(6)}`, r.m[0], r.m[1]]).sort((a, b) => a[0] < b[0] ? -1 : 1),
    cities, landing: land.map(r => [r.d[0], r.m[0], r.m[1]]),
    channels: [...chMap.values()].sort((a, b) => b[1] - a[1]),
    brands: brandsOut,
    productPages: prods.map(r => [r.d[0], r.m[0]]),
    at: new Date().toISOString(),
  };
}
