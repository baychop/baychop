// Bay Chop forecast engine v2 (unchanged maths from the validated Kemah tool).
const GB = (() => {
  const HR = 3.6e6, H0 = Date.UTC(2012, 9, 1) / HR;          // training time origin (epoch hours)
  const WIN = [[0,3],[3,6],[6,12],[12,24],[24,48],[48,96]];
  const HIST = 34 * 24, FUT = 168;
  const ymd = d => d.toISOString().slice(0,10).replace(/-/g,'');
  const J = async (u) => { let last; const urls = [u, u]; if (u.includes('//waterservices.usgs.gov')) urls.push(u.replace('//waterservices', '//nwis.waterservices'));
    for (const x of urls) { try { const r = await fetch(x, typeof process !== 'undefined' ? { headers: { 'User-Agent': 'baychop-forecast-job (Bay Chop water level forecast)', 'Accept': 'application/json' } } : undefined); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } catch (err) { last = err; await new Promise(z => setTimeout(z, 800)); } }
    throw new Error(last && last.message ? last.message : 'request blocked'); };
  const noaaT = s => Math.floor(Date.parse(s.replace(' ','T') + ':00Z') / HR);
  const NOAA = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?time_zone=gmt&units=english&format=json&application=baychop';

  async function load(log) {
    const now = Date.now(), hNow = Math.floor(now / HR), base = hNow - HIST, len = HIST + FUT + 2;
    const mk = () => new Float64Array(len).fill(NaN);
    const A = { base, hNow, len, k: mk(), clp: mk(), eph: mk(), epp: mk(), u: mk(), v: mk(), p: mk(), lq: mk(), isFc: new Uint8Array(len), src: {} };
    const b = ymd(new Date(base * HR)), e = ymd(new Date(now)), e8 = ymd(new Date(now + 8 * 864e5));
    const put = (arr, h, val) => { const i = h - base; if (i >= 0 && i < len && isFinite(val)) arr[i] = val; };
    const jobs = [];
    // 1. Kemah gauge, Seaward series (302777), hourly means
    jobs.push((async () => {
      const j = await J('https://waterservices.usgs.gov/nwis/iv/?format=json&sites=08077637&parameterCd=63158&period=P35D');
      const vals = j.value.timeSeries.flatMap(ts => ts.values).filter(v => v.method && v.method[0] && (v.method[0].methodID === 302777 || /seaward/i.test(v.method[0].methodDescription || '')));
      const src = vals.length ? vals[0].value : j.value.timeSeries[0].values[0].value;
      const S = new Map();
      for (const r of src) { const x = parseFloat(r.value); if (!isFinite(x) || x < -50) continue; const h = Math.floor(Date.parse(r.dateTime) / HR); const o = S.get(h) || [0,0]; o[0] += x; o[1]++; S.set(h, o); A.lastObs = { t: Date.parse(r.dateTime), v: x }; }
      for (const [h, o] of S) if (h < hNow || o[1] >= 2) put(A.k, h, o[0] / o[1]);
      A.src.gauge = 'ok';
    })().catch(err => { A.src.gauge = 'FAILED: ' + err.message; }));
    // 2. NOAA tide predictions (Clear Lake, Eagle Point), hourly, MSL
    for (const [st, key] of [['8770933','clp'],['8771013','epp']]) jobs.push((async () => {
      const j = await J(`${NOAA}&product=predictions&interval=h&datum=MSL&station=${st}&begin_date=${b}&end_date=${e8}`);
      for (const r of j.predictions || []) put(A[key], noaaT(r.t), parseFloat(r.v));
      A.src[key] = 'ok';
    })().catch(err => { A.src[key] = 'FAILED: ' + err.message; }));
    // 3. Eagle Point observed level (6-min preliminary -> hourly mean). 31-day request limit -> two calls
    jobs.push((async () => {
      const mid = ymd(new Date(now - 17 * 864e5)); const S = new Map();
      for (const [x, y] of [[b, mid], [mid, e]]) { const j = await J(`${NOAA}&product=water_level&datum=MSL&station=8771013&begin_date=${x}&end_date=${y}`);
        for (const r of j.data || []) { const v = parseFloat(r.v); if (!isFinite(v)) continue; const h = noaaT(r.t); const o = S.get(h) || [0,0]; o[0] += v; o[1]++; S.set(h, o); } }
      for (const [h, o] of S) put(A.eph, h, o[0] / o[1]);
      A.src.eaglePoint = 'ok';
    })().catch(err => { A.src.eaglePoint = 'FAILED: ' + err.message; }));
    // 4. Observed wind + pressure: Eagle Point first, Pier 21 fills gaps
    jobs.push((async () => {
      for (const st of ['8771013','8771450']) {
        try { const j = await J(`${NOAA}&product=wind&interval=h&station=${st}&begin_date=${b}&end_date=${e}`);
          for (const r of j.data || []) { const s = parseFloat(r.s) * 1.15078, d = parseFloat(r.d), i = noaaT(r.t) - base; if (isFinite(s) && isFinite(d) && i >= 0 && i < len && !isFinite(A.u[i])) { const a = d * Math.PI / 180; A.u[i] = -s * Math.sin(a); A.v[i] = -s * Math.cos(a); } } } catch (err) {}
        try { const j = await J(`${NOAA}&product=air_pressure&interval=h&station=${st === '8771013' ? '8771450' : '8771013'}&begin_date=${b}&end_date=${e}`);
          for (const r of j.data || []) { const v = parseFloat(r.v), i = noaaT(r.t) - base; if (isFinite(v) && i >= 0 && i < len && !isFinite(A.p[i])) A.p[i] = 1013 - v; } } catch (err) {}
      }
      A.src.obsWind = 'ok';
    })());
    // 5. Trinity River at Romayor, daily mean flow
    jobs.push((async () => {
      const j = await J('https://waterservices.usgs.gov/nwis/dv/?format=json&sites=08066500&parameterCd=00060&statCd=00003&period=P45D');
      for (const r of j.value.timeSeries[0].values[0].value) { const q = parseFloat(r.value); if (!(q > 0)) continue; const h0 = Math.floor(Date.parse(r.dateTime.slice(0,10) + 'T06:00:00Z') / HR); for (let h = h0; h < h0 + 24; h++) put(A.lq, h, Math.log10(q)); }
      A.src.river = 'ok';
    })().catch(err => { A.src.river = 'FAILED: ' + err.message; }));
    // 6. Forecast wind (NWS grid, Eagle Point cell) and pressure (Open-Meteo / GFS)
    const F = { u: new Map(), v: new Map(), p: new Map(), pPast: new Map(), ou: new Map(), ov: new Map() };
    jobs.push((async () => {
      const g = await J('https://api.weather.gov/gridpoints/HGX/80,82'); const P = g.properties;
      const expand = (vals) => { const m = new Map(); for (const x of vals) { const [t, dur] = x.validTime.split('/'); const h0 = Math.floor(Date.parse(t) / HR); const D = /P(?:(\d+)D)?(?:T(\d+)H)?/.exec(dur); const n = (+(D[1] || 0)) * 24 + (+(D[2] || 0)) || 1; for (let h = h0; h < h0 + n; h++) m.set(h, x.value); } return m; };
      const ws = expand(P.windSpeed.values), wd = expand(P.windDirection.values); const k = /km/.test(P.windSpeed.uom) ? 0.621371 : 1;
      for (const [h, s] of ws) { const d = wd.get(h); if (d == null || s == null) continue; const a = d * Math.PI / 180; F.u.set(h, -s * k * Math.sin(a)); F.v.set(h, -s * k * Math.cos(a)); }
      A.src.nwsWind = 'ok';
    })().catch(err => { A.src.nwsWind = 'FAILED: ' + err.message; }));
    jobs.push((async () => {
      const m = await J('https://api.open-meteo.com/v1/forecast?latitude=29.4813&longitude=-94.9172&hourly=pressure_msl,wind_speed_10m,wind_direction_10m&wind_speed_unit=mph&timezone=GMT&forecast_days=8&past_days=35');
      m.hourly.time.forEach((t, i) => { const h = Math.floor(Date.parse(t + ':00Z') / HR); const p = m.hourly.pressure_msl[i], s = m.hourly.wind_speed_10m[i], d = m.hourly.wind_direction_10m[i];
        if (p != null) { F.p.set(h, 1013 - p); if (h <= hNow) F.pPast.set(h, 1013 - p); }
        if (s != null && d != null) { const a = d * Math.PI / 180; F.ou.set(h, -s * Math.sin(a)); F.ov.set(h, -s * Math.cos(a)); } });
      A.src.gfsPressure = 'ok';
    })().catch(err => { A.src.gfsPressure = 'FAILED: ' + err.message; }));
    await Promise.all(jobs);
    // merge forecasts into driver arrays after the last observation
    // stand-ins when an observation feed is down: model-analysis wind/pressure for history, typical river flow
    A.standIn = [];
    const cnt = a => { let n = 0; for (let i = 0; i <= HIST; i++) if (isFinite(a[i])) n++; return n; };
    if (cnt(A.u) < HIST * 0.5 && F.ou.size) { for (let i = 0; i <= HIST; i++) if (!isFinite(A.u[i])) { const u = F.ou.get(base + i); if (u != null) { A.u[i] = u; A.v[i] = F.ov.get(base + i); } } A.standIn.push('observed wind (using GFS analysis)'); }
    if (cnt(A.p) < HIST * 0.5 && F.p.size) { for (let i = 0; i <= HIST; i++) if (!isFinite(A.p[i])) { const p = F.p.get(base + i); if (p != null) A.p[i] = p; } A.standIn.push('observed pressure (using GFS analysis)'); }
    if (cnt(A.lq) === 0) { A.lq.fill(3.5); A.standIn.push('Trinity River flow (using a typical value)'); }
    let lastW = -1, lastP = -1; for (let i = 0; i < len; i++) { if (isFinite(A.u[i])) lastW = i; if (isFinite(A.p[i])) lastP = i; }
    let off = 0, n = 0; for (const [h, v] of F.pPast) { const i = h - base; if (i >= 0 && isFinite(A.p[i])) { off += A.p[i] - v; n++; } } off = n ? off / n : 0;   // station-vs-model pressure offset
    A.pOff = off;
    A.windFc = F.u.size ? 'NWS' : (F.ou.size ? 'GFS' : 'none');
    for (let i = 0; i < len; i++) { const h = base + i;
      if (i > lastW) { let u = F.u.get(h), v = F.v.get(h); if (u == null) { u = F.ou.get(h); v = F.ov.get(h); } if (u != null) { A.u[i] = u; A.v[i] = v; A.isFc[i] = 1; } }
      if (i > lastP) { const p = F.p.get(h); if (p != null) A.p[i] = p + off; else if (lastP >= 0) A.p[i] = A.p[lastP]; }
      if (!isFinite(A.lq[i]) && i > 0) A.lq[i] = A.lq[i - 1]; }
    for (const key of ['u','v','p']) { let last = -1; for (let i = 0; i < len; i++) if (isFinite(A[key][i])) { if (last >= 0 && i - last > 1 && i - last <= 7) for (let j = last + 1; j < i; j++) A[key][j] = A[key][last] + (A[key][i] - A[key][last]) * (j - last) / (i - last); last = i; } }
    return A;
  }

  function run(A, MODEL) {
    const { base, len } = A, beta = MODEL.beta;
    const sx = new Float64Array(len), sy = new Float64Array(len);
    for (let i = 0; i < len; i++) { const w = Math.hypot(A.u[i], A.v[i]); sx[i] = A.u[i] * w / 10; sy[i] = A.v[i] * w / 10; }
    const pre = a => { const S = new Float64Array(len + 1), C = new Float64Array(len + 1); for (let i = 0; i < len; i++) { const ok = isFinite(a[i]); S[i+1] = S[i] + (ok ? a[i] : 0); C[i+1] = C[i] + (ok ? 1 : 0); } return { S, C }; };
    const wm = (P, a, b, frac = 0.7) => { if (b >= len) return NaN; const lo = Math.max(a + 1, 0); const n = P.C[b+1] - P.C[lo]; if (n < frac * (b - a) || n === 0) return NaN; return (P.S[b+1] - P.S[lo]) / n; };
    const P = { u: pre(A.u), v: pre(A.v), sx: pre(sx), sy: pre(sy), p: pre(A.p), lq: pre(A.lq) };
    const f = new Float64Array(len).fill(NaN);
    for (let i = 96; i < len; i++) { const t = base + i - H0, a = 2 * Math.PI * ((base + i) % 8766) / 8766;
      const x = [1, Math.sin(a), Math.cos(a), Math.sin(2*a), Math.cos(2*a), t / 8766];
      for (const [a0, b0] of WIN) for (const k of ['u','v','sx','sy']) x.push(wm(P[k], i - b0, i - a0));
      x.push(wm(P.p, i - 6, i), wm(P.p, i - 30, i - 6), wm(P.lq, i - 120, i, 0.3));
      let s = 0; for (let j = 0; j < x.length; j++) s += x[j] * beta[j]; f[i] = s; }
    // Seaward-gauge tide = fitted filter on NOAA's Clear Lake + Eagle Point harmonic predictions
    const TD = MODEL.tide, tide = new Float64Array(len).fill(NaN);
    for (let i = 3; i < len - 3; i++) { let s = 0, j = 0; for (const l of TD.clpLags) s += TD.c[j++] * A.clp[i + l]; for (const l of TD.eppLags) s += TD.c[j++] * A.epp[i + l]; tide[i] = s; }
    const Rk = new Float64Array(len), e = new Float64Array(len), G = new Float64Array(len);
    for (let i = 0; i < len; i++) { Rk[i] = A.k[i] - tide[i]; e[i] = Rk[i] - f[i]; G[i] = (A.eph[i] - A.epp[i]) - Rk[i]; }
    let i0 = -1; for (let i = len - 1; i >= 0; i--) if (isFinite(e[i])) { i0 = i; break; }
    if (i0 < 0) { const has = a => { for (let i = 0; i < len; i++) if (isFinite(a[i])) return true; return false; };
      const miss = []; if (!has(A.k)) miss.push('the Kemah gauge'); if (!has(A.clp) || !has(A.epp)) miss.push('NOAA tide predictions'); if (!has(A.u)) miss.push('wind'); if (!has(A.p)) miss.push('pressure');
      const err = new Error(miss.length ? 'Missing: ' + miss.join(', ') + '.' : 'The feeds loaded but do not overlap in time.'); err.allDown = miss.length >= 4; err.src = A.src; throw err; }
    const Pe = pre(e), PR = pre(Rk), PG = pre(G);
    const B = wm(Pe, i0 - 720, i0, 0.4), Rb = wm(PR, i0 - 720, i0, 0.4), Gb = wm(PG, i0 - 720, i0, 0.4);
    if (!isFinite(B)) throw new Error('Less than 12 days of overlapping gauge, wind and pressure history; the 30-day baseline cannot be set.');
    const e0 = e[i0]; let e12 = e[i0 - 12]; if (!isFinite(e12)) e12 = e0; let g0 = G[i0] - Gb; if (!isFinite(g0)) g0 = 0;
    const LD = MODEL.leads, lerp = (L, tab, z) => { if (L <= LD[0]) { const w = L / LD[0]; return tab[0].map((v, j) => z[j] * (1 - w) + v * w); } for (let k = 1; k < LD.length; k++) if (L <= LD[k]) { const w = (L - LD[k-1]) / (LD[k] - LD[k-1]); return tab[k-1].map((v, j) => v * (1 - w) + tab[k][j] * w); } return tab[tab.length - 1]; };
    const Phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
    const out = [];
    for (let L = 1; L <= FUT; L++) { const i = i0 + L; if (i >= len || !isFinite(f[i]) || !isFinite(tide[i])) break;
      const b = lerp(L, MODEL.s2, MODEL.zero.s2); const R = f[i] + B + b[0] + b[1] * (e0 - B) + b[2] * g0 + b[3] * (e0 - e12);
      const an = R - Rb, bin = an > -0.25 ? 0 : an > -0.75 ? 1 : 2; const band = lerp(L, MODEL.band[bin], MODEL.zero.band);
      out.push({ t: (base + i) * HR, L, level: R + tide[i], tide: tide[i] + Rb, q68: band[0], q90: band[1], sd: band[2], bin,
        windMph: Math.hypot(A.u[i], A.v[i]), windFrom: (Math.atan2(-A.u[i], -A.v[i]) * 180 / Math.PI + 360) % 360 }); }
    const hist = []; for (let i = Math.max(0, i0 - 72); i <= i0; i++) if (isFinite(A.k[i])) hist.push({ t: (base + i) * HR, level: A.k[i], tide: tide[i] + Rb, fit: f[i] + B + tide[i] });
    return { t0: (base + i0) * HR, now: { level: A.k[i0], surge: Rk[i0] - Rb, offset: Rb, e0: e0 - B, g0 }, fc: out, hist, src: A.src, windFc: A.windFc, lastObs: A.lastObs, standIn: A.standIn || [] };
  }
  return { load, run };
})();
export const load = GB.load, run = GB.run;
