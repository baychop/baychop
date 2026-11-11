// Hourly job: fetch the agency feeds, run the model, write data/forecast.json, append to the archive.
// If anything essential fails, exit non-zero and leave the last good forecast in place.
import { load, run } from '../engine.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'model.json'), 'utf8'));
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r0 = x => (Number.isFinite(x) ? Math.round(x) : null);

export function pack(RES, issued) {
  const fc = RES.fc, hist = RES.hist;
  return {
    v: 2, model: MODEL.version, issued, t0: RES.t0, stepMs: 3600000,
    chartDatumOffsetFt: MODEL.chartDatumOffsetFt,
    now: { level: r2(RES.now.level), vsTideTable: r2(RES.now.surge), obsTime: RES.lastObs ? RES.lastObs.t : null },
    fc: { level: fc.map(o => r2(o.level)), tide: fc.map(o => r2(o.tide)), q68: fc.map(o => r2(o.q68)), q90: fc.map(o => r2(o.q90)),
          mph: fc.map(o => r0(o.windMph)), from: fc.map(o => r0(o.windFrom)) },
    hist: { t: hist.map(o => o.t), level: hist.map(o => r2(o.level)), tide: hist.map(o => r2(o.tide)) },
    feeds: RES.src, windForecast: RES.windFc, standIn: RES.standIn
  };
}

async function main() {
  const issued = Date.now();
  const A = await load();
  const RES = run(A, MODEL);                       // throws if the gauge or tide predictions are missing
  if (RES.fc.length < 48) throw new Error('Forecast shorter than 48 hours (' + RES.fc.length + '); keeping the previous one.');
  if (issued - RES.t0 > 6 * 3600000) throw new Error('Latest usable gauge hour is more than 6 hours old; keeping the previous forecast.');
  const out = pack(RES, issued);
  fs.mkdirSync(path.join(ROOT, 'data', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'forecast.json'), JSON.stringify(out));
  // Archive: one line per run, so issued forecasts can later be scored against what happened.
  const at = L => { const o = RES.fc[L - 1]; return o ? [r2(o.level), r2(o.tide), r0(o.windMph), r0(o.windFrom)] : null; };
  const rec = { issued, t0: RES.t0, obs: r2(RES.now.level), wind: RES.windFc, leads: Object.fromEntries(MODEL.leads.map(L => [L, at(L)])) };
  const month = new Date(issued).toISOString().slice(0, 7);
  fs.appendFileSync(path.join(ROOT, 'data', 'archive', month + '.jsonl'), JSON.stringify(rec) + '\n');
  console.log('Forecast written:', RES.fc.length, 'hours from', new Date(RES.t0).toISOString(), '| gauge', out.now.level, 'ft | feeds', JSON.stringify(RES.src));
}
if (process.argv[1] && process.argv[1].endsWith('forecast.mjs')) main().catch(err => { console.error('FORECAST FAILED:', err.message, err.src ? JSON.stringify(err.src) : ''); process.exit(1); });
