// General v9 rule: eligibility/exhaustion determines size; never select on price.
export const SIZE_POLICY = 'v9-exhausted-frame-2026-11-18';
export const STANDARD_PROPERTIES = 8;
export const MIN_FROZEN_PROPERTIES = 6;
export const SIZE_NOTICE = 'This panel uses fewer than eight properties. Its estimate carries wider uncertainty; the size of that difference has not been measured. The planning band is provisional editorial guidance, not a calibrated confidence interval or a guarantee of bookable prices.';
export function sampleBand(weekday, weekend, planned = 8) {
  if (!Number.isInteger(planned) || planned < 6 || planned > 8 || ![weekday,weekend].every(n=>Number.isInteger(n)&&n>=0&&n<=planned)) throw Error('Invalid panel/contributing counts.');
  const minimum = Math.min(weekday,weekend);
  return { releasable: minimum >= 4, band_percent: minimum >= 4 ? 25 + (8-minimum)*5 : null,
    weekday,weekend,planned_per_type:planned,minimum_per_type:4,provisional:true,calibrated:false };
}
export function sizeErrors(audit, selectedIds, decision, frameIds) {
  const errors=[], rows=audit?.candidates??[], ids=rows.map(p=>p.property_id), selected=new Set(selectedIds);
  const eligible=rows.filter(p=>p.eligibility==='eligible').map(p=>p.property_id);
  if(!Array.isArray(frameIds)||ids.length!==frameIds.length||new Set(ids).size!==ids.length||ids.some(id=>!frameIds.includes(id))) errors.push('Size decision requires every frozen frame object exactly once.');
  if(selected.size!==selectedIds.length||selectedIds.some(id=>!eligible.includes(id))) errors.push('Selected IDs must be unique eligible frame members.');
  if(selected.size<MIN_FROZEN_PROPERTIES||selected.size>STANDARD_PROPERTIES) errors.push('Supported frozen panel sizes are six, seven or eight.');
  if(decision?.policy!==SIZE_POLICY||decision?.properties!==selected.size||decision?.standard_properties!==8||decision?.radius_metres!==2000||decision?.classification_maximum_age_months!==36) errors.push('Size decision must preserve v9 radius, classification ceiling and actual count.');
  if(selected.size<8){
    if(decision?.basis!=='frame_exhausted'||!decision?.reason?.trim()||!decision?.approved_date) errors.push('Reduced panel requires recorded exhausted-frame reason and decision date.');
    if(eligible.length!==selected.size||eligible.some(id=>!selected.has(id))) errors.push('Do not omit eligible candidates to create a reduced panel.');
    if(rows.some(p=>!['eligible','excluded'].includes(p.eligibility)||!p.decision_reason?.trim())) errors.push('Exhaustion requires a recorded decision for every candidate; unknowns cannot be skipped.');
    if(decision?.limitation_notice!==SIZE_NOTICE) errors.push('Reduced panel must carry the provisional sample-size limitation.');
  }
  if(selected.size>=6&&selected.size<=8&&decision?.planned_band_percent!==sampleBand(selected.size,selected.size,selected.size).band_percent) errors.push('Planned band differs from sample-size table.');
  return errors;
}
export function resultContext(panel, schedule, counts) {
  if(!schedule?.observation_date||!schedule?.weekday?.check_in||!schedule?.weekday?.check_out||!schedule?.weekend?.check_in||!schedule?.weekend?.check_out) throw Error('Actual collection and both stay intervals are required beside a result.');
  const band=sampleBand(counts.weekday,counts.weekend,panel.properties.length);
  return {collection_date:schedule.observation_date,weekday_stay:{...schedule.weekday},weekend_stay:{...schedule.weekend},
    comparison_notice:'Cities collected on different dates also have different stay weeks. City and week are confounded; identical seasonality is not established.',
    sample_size_notice:panel.size_decision.limitation_notice,...band};
}
