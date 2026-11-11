// Hourly job, first step: copy the National Weather Service alerts in force for Galveston Bay into data/alerts.json.
// The page reads that file; it never calls the agency itself. This step never fails the job: if the check
// does not complete, the file says so and the page tells the reader to use the official source.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'alerts.json');
const API = 'https://api.weather.gov/alerts/active';
// Two questions cover the bay: the Galveston Bay marine zone (small craft, gale, low water, dense fog, marine weather)
// and the land point at the Clear Lake entrance (coastal flood, tropical, tornado, severe thunderstorm).
export const QUERIES = [
  ['bay', API + '?zone=GMZ335'],
  ['kemah', API + '?point=29.5436,-95.0205']
];
const RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
const ms = s => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

export function tidy(features) {
  const seen = new Set(), out = [];
  for (const f of features || []) {
    const p = (f && f.properties) || {};
    if (!p.event || seen.has(p.id || f.id)) continue;
    if (p.status && p.status !== 'Actual') continue;            // drop tests and exercises
    if (p.messageType === 'Cancel') continue;
    seen.add(p.id || f.id);
    out.push({
      id: clip(p.id || f.id, 200), event: clip(p.event, 120), severity: clip(p.severity, 20) || 'Unknown',
      headline: clip(p.headline, 400), area: clip(p.areaDesc, 300), sender: clip(p.senderName, 80) || 'National Weather Service',
      onset: ms(p.onset) || ms(p.effective), ends: ms(p.ends), expires: ms(p.expires),
      description: clip(p.description, 4000), instruction: clip(p.instruction, 2000)
    });
  }
  const r = a => (a.severity in RANK ? RANK[a.severity] : 4);
  return out.sort((a, b) => r(a) - r(b) || (a.onset || 0) - (b.onset || 0));
}

async function ask(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'baychop-forecast-job (Bay Chop water level forecast)', 'Accept': 'application/geo+json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j.features)) throw new Error('unexpected reply');
      return j.features;
    } catch (err) { last = err; await new Promise(z => setTimeout(z, 1500)); }
  }
  throw last;
}

async function main() {
  const checked = Date.now(), sources = {}, features = [];
  for (const [name, url] of QUERIES) {
    try { features.push(...await ask(url)); sources[name] = 'ok'; }
    catch (err) { sources[name] = 'FAILED: ' + (err && err.message ? err.message : 'request failed'); }
  }
  const ok = Object.values(sources).every(v => v === 'ok');
  let prev = null; try { prev = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
  const anyOk = Object.values(sources).some(v => v === 'ok');
  const out = anyOk
    ? { v: 1, checked, ok, lastGood: ok ? checked : (prev && prev.lastGood) || null, sources, items: tidy(features) }
    : { v: 1, checked, ok: false, lastGood: (prev && prev.lastGood) || null, sources, items: (prev && prev.items) || [] };   // nothing answered: keep the last list, flagged
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(out));
  console.log('Alerts written:', out.items.length, 'in force | sources', JSON.stringify(sources));
}
if (process.argv[1] && process.argv[1].endsWith('alerts.mjs')) main().catch(err => { console.error('ALERT CHECK FAILED:', err.message); });
