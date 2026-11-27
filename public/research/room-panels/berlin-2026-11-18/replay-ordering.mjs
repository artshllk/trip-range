import {readFile} from 'node:fs/promises';
export const SPATIAL_RULE='nearest-remaining-plus-50m-id-v1';
const codepointOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function distanceMetres(a, b) {
  if (![a?.latitude, a?.longitude, b?.latitude, b?.longitude].every(Number.isFinite)
    || Math.abs(a.latitude) > 90 || Math.abs(b.latitude) > 90
    || Math.abs(a.longitude) > 180 || Math.abs(b.longitude) > 180) return null;
  const rad = x => x * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
// Unknown eligibility remains in the order. Never skip a nearer unknown to fill eight slots.
export function spatialOrder(candidates, centre, target = 8) {
  const ids = candidates.map(p => p.property_id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
    throw new Error('Every candidate needs a unique immutable property_id.');
  const rows = candidates.map(p => ({ ...p, computed_distance_metres: distanceMetres(centre, p.coordinates) }));
  const eligiblePool = rows.filter(p => p.eligibility !== 'excluded');
  const unresolved = eligiblePool.filter(p => p.computed_distance_metres === null).map(p => p.property_id);
  const located = eligiblePool.filter(p => p.computed_distance_metres !== null && p.computed_distance_metres <= 2000)
    .sort((a, b) => a.computed_distance_metres - b.computed_distance_metres || codepointOrder(a.property_id, b.property_id));
  located.forEach((row, index) => { row.distance_only_rank = index + 1; });
  const order = [], tie_groups = [], unknowns = new Set(unresolved);
  while (located.length) {
    const nearest = located[0].computed_distance_metres;
    const window = located.filter(row => row.computed_distance_metres <= nearest + 50);
    const byId = [...window].sort((a, b) => codepointOrder(a.property_id, b.property_id));
    const winner = byId[0];
    const rank = order.length + 1;
    if (rank <= target) {
      for (const row of window) if (row.eligibility !== 'eligible') unknowns.add(row.property_id);
    }
    tie_groups.push({ id: rank, min_metres: nearest, max_metres: window.at(-1).computed_distance_metres,
      distance_order: window.map(row => row.property_id), member_ids: byId.map(row => row.property_id),
      selected_id: winner.property_id, tie_applied: window.length > 1, order_changed: winner !== window[0] });
    order.push({ ...winner, tie_group: rank, tie_key: winner.property_id, spatial_rank: rank });
    located.splice(located.indexOf(winner), 1);
  }
  const selected = order.slice(0, target), blockers = [...unknowns];
  return { rule: SPATIAL_RULE, rows, order, tie_groups, blockers,
    ready: selected.length === target && blockers.length === 0, selected_ids: selected.map(p => p.property_id) };
}

const root=new URL('./',import.meta.url);
const read=async n=>JSON.parse(await readFile(new URL(n,root),'utf8'));
const [audit,manifest,panel]=await Promise.all(['candidates.json','frame-manifest.json','panel.json'].map(read));
console.log(JSON.stringify(spatialOrder(audit.candidates,manifest.central_point,panel.properties.length),null,2));
