/* Bay Chop page script. Reads data/forecast.json and data/alerts.json (written hourly by the job). Never calls the agencies itself. */
(() => {
  'use strict';
  const HR = 3600000, TZ = 'America/Chicago', SKILL_H = 96;   // beyond 96 h the forecast is shown as an outlook
  const $ = id => document.getElementById(id);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const loc = t => { const o = {}; for (const p of parts.formatToParts(t)) o[p.type] = p.value; return { key: o.year + '-' + o.month + '-' + o.day, hour: +o.hour % 24 }; };
  const fmt = (t, opt) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TZ }, opt)).format(t);
  const dayHour = t => fmt(t, { weekday: 'long', hour: 'numeric' });
  const shortDayHour = t => fmt(t, { weekday: 'short', hour: 'numeric' });
  const compass = d => ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d / 22.5) % 16];
  const signed = (x, n = 1) => { const a = Math.abs(x).toFixed(n); return (+a === 0 ? '' : x > 0 ? '+' : '−') + a; };
  const cls = d => d <= -1.5 ? 'c-lo4' : d <= -1 ? 'c-lo3' : d <= -0.5 ? 'c-lo2' : d <= -0.25 ? 'c-lo1' : d < 0.25 ? '' : d < 0.5 ? 'c-hi1' : d < 1 ? 'c-hi2' : d < 1.5 ? 'c-hi3' : 'c-hi4';

  let F = null, rows = [], sel = null, units = 'gauge';
  try { const u = localStorage.getItem('baychop_units'); if (u === 'chart' || u === 'gauge') units = u; } catch (e) {}
  const lv = x => units === 'chart' ? x - F.chartDatumOffsetFt : x;
  const unitName = () => units === 'chart' ? 'ft above chart datum' : 'ft on the gauge';

  function build(d) {
    F = d; rows = [];
    const now = Date.now();
    d.hist.t.forEach((t, i) => rows.push({ t, level: d.hist.level[i], tide: d.hist.tide[i], obs: true }));
    d.fc.level.forEach((v, i) => rows.push({ t: d.t0 + (i + 1) * HR, lead: i + 1, level: v, tide: d.fc.tide[i], q68: d.fc.q68[i], q90: d.fc.q90[i], mph: d.fc.mph[i], from: d.fc.from[i], outlook: i + 1 > SKILL_H }));
    rows.forEach(r => { r.dev = r.level - r.tide; r.loc = loc(r.t); });
    const fc = rows.filter(r => !r.obs && r.t + HR > now);
    sel = fc[0] || rows[rows.length - 1];
    return fc;
  }

  function headline(fc) {
    const near = fc.filter(r => !r.outlook);
    if (!near.length) { $('lede').textContent = 'No current forecast is available.'; $('sub').textContent = ''; return; }
    const lo = near.reduce((a, b) => (b.dev < a.dev ? b : a)), hi = near.reduce((a, b) => (b.dev > a.dev ? b : a));
    const last = near[near.length - 1];
    let s;
    if (lo.dev <= -0.5 && -lo.dev >= hi.dev) s = 'Water is forecast to run ' + (-lo.dev).toFixed(1) + ' ft below the tide table around ' + dayHour(lo.t) + ', with ' + compass(lo.from) + ' wind near ' + lo.mph + ' mph.';
    else if (hi.dev >= 0.5) s = 'Water is forecast to run ' + hi.dev.toFixed(1) + ' ft above the tide table around ' + dayHour(hi.t) + ', with ' + compass(hi.from) + ' wind near ' + hi.mph + ' mph.';
    else s = 'Water should stay within ' + Math.max(-lo.dev, hi.dev, 0.1).toFixed(1) + ' ft of the tide table through ' + fmt(last.t, { weekday: 'long' }) + '.';
    $('lede').textContent = s;
    const low = near.reduce((a, b) => (b.level < a.level ? b : a));
    $('sub').innerHTML = 'Lowest water in the next four days: <strong>' + lv(low.level).toFixed(1) + ' ' + unitName() + '</strong> around ' + dayHour(low.t) +
      ', likely between ' + lv(low.level - low.q68).toFixed(1) + ' and ' + lv(low.level + low.q68).toFixed(1) + '. The tide table alone gives ' + lv(low.tide).toFixed(1) + '. ' +
      'The Kemah gauge last read <strong>' + lv(F.now.level).toFixed(2) + ' ft</strong>, ' + (Math.abs(F.now.vsTideTable) < 0.05 ? 'level with' : Math.abs(F.now.vsTideTable).toFixed(1) + ' ft ' + (F.now.vsTideTable > 0 ? 'above' : 'below')) + ' the tide table. ' +
      'Forecast issued ' + fmt(F.issued, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) + '.';
  }

  function notice() {
    const age = (Date.now() - F.issued) / HR, msgs = [];
    if (age > 36) msgs.push('This forecast is ' + Math.round(age) + ' hours old and should not be used. The hourly update has stopped; the data feeds may be down.');
    else if (age > 3) msgs.push('This forecast has not updated for ' + Math.round(age) + ' hours. It does not include anything the gauge or the wind forecast has done since.');
    if (F.standIn && F.standIn.length) msgs.push('A data feed was down for this run, so a stand-in was used for: ' + F.standIn.join(', ') + '.');
    if (F.windForecast && F.windForecast !== 'NWS') msgs.push('The National Weather Service wind forecast was unavailable; this run uses ' + F.windForecast + ' model wind instead.');
    const n = $('notice'); n.hidden = !msgs.length; n.textContent = msgs.join(' ');
  }

  function grid() {
    const g = $('grid'); g.innerHTML = '';
    const head = document.createElement('div'); g.appendChild(head);
    for (let h = 0; h < 24; h++) { const e = document.createElement('div'); e.className = 'hr'; e.textContent = h % 3 ? '' : (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'); g.appendChild(e); }
    const todayKey = loc(Date.now()).key;
    const keys = [...new Set(rows.map(r => r.loc.key))].filter(k => k >= todayKey);
    const byKey = new Map(); rows.forEach(r => byKey.set(r.loc.key + '|' + r.loc.hour, r));
    keys.forEach(k => {
      const any = rows.find(r => r.loc.key === k), lab = document.createElement('div'); lab.className = 'day';
      const allOut = rows.filter(r => r.loc.key === k).every(r => r.outlook);
      lab.innerHTML = '<span class="l">' + fmt(any.t, { weekday: 'short', month: 'short', day: 'numeric' }) + '</span><span class="s">' + fmt(any.t, { weekday: 'short' }) + ' ' + fmt(any.t, { day: 'numeric' }) + '</span>' + (k === todayKey ? '<small>today</small>' : allOut ? '<small>outlook</small>' : '');
      g.appendChild(lab);
      for (let h = 0; h < 24; h++) {
        const r = byKey.get(k + '|' + h), b = document.createElement(r ? 'button' : 'div');
        if (!r) { b.className = 'cell none'; g.appendChild(b); continue; }
        b.type = 'button'; b.className = 'cell ' + cls(r.dev) + (r.outlook ? ' outlook' : '') + (r.obs ? ' obs' : '');
        b.innerHTML = '<span>' + (Math.abs(r.dev) < 0.05 ? '0' : signed(r.dev).replace('0.', '.')) + '</span>';
        b.setAttribute('aria-label', dayHour(r.t) + ': ' + (r.obs ? 'observed ' : 'forecast ') + signed(r.dev) + ' ft against the tide table');
        b.setAttribute('aria-pressed', r === sel ? 'true' : 'false');
        b.addEventListener('click', () => { sel = r; g.querySelectorAll('[aria-pressed="true"]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); pick(); });
        g.appendChild(b);
      }
    });
  }

  function pick() {
    const r = sel; if (!r) return;
    const item = (k, v) => '<dl><dt>' + k + '</dt><dd>' + v + '</dd></dl>';
    $('pick').innerHTML = '<h2>' + fmt(r.t, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric' }) + (r.obs ? ', observed' : r.outlook ? ', outlook only' : ', forecast') + '</h2>' +
      item(r.obs ? 'Gauge reading' : 'Forecast level', lv(r.level).toFixed(2) + ' <small>' + unitName() + '</small>') +
      item('Tide table', lv(r.tide).toFixed(2) + ' <small>ft</small>') +
      item('Difference', signed(r.dev, 2) + ' <small>ft</small>') +
      (r.obs ? '' : item('Likely range (2 in 3)', lv(r.level - r.q68).toFixed(1) + ' to ' + lv(r.level + r.q68).toFixed(1) + ' <small>ft</small>') +
        item('Wider range (9 in 10)', lv(r.level - r.q90).toFixed(1) + ' to ' + lv(r.level + r.q90).toFixed(1) + ' <small>ft</small>') +
        item('Forecast wind', compass(r.from) + ' ' + r.mph + ' <small>mph</small>'));
  }

  function chart() {
    const W = 1000, H = 340, m = { l: 44, r: 12, t: 16, b: 40 }, now = Date.now();
    const pts = rows.filter(r => r.t >= F.t0 - 24 * HR), fc = pts.filter(r => !r.obs);
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    let lo = Infinity, hi = -Infinity; pts.forEach(r => { lo = Math.min(lo, lv(r.level - (r.q90 || 0)), lv(r.tide)); hi = Math.max(hi, lv(r.level + (r.q90 || 0)), lv(r.tide)); });
    lo = Math.floor(lo * 2) / 2; hi = Math.ceil(hi * 2) / 2;
    const X = t => m.l + (t - t0) / (t1 - t0) * (W - m.l - m.r), Y = v => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
    const path = (a, f) => a.map((r, i) => (i ? 'L' : 'M') + X(r.t).toFixed(1) + ' ' + Y(f(r)).toFixed(1)).join('');
    const band = q => path(fc, r => lv(r.level + r[q])) + fc.slice().reverse().map(r => 'L' + X(r.t).toFixed(1) + ' ' + Y(lv(r.level - r[q])).toFixed(1)).join('') + 'Z';
    let s = '';
    const tOut = F.t0 + SKILL_H * HR;
    if (tOut < t1) s += '<rect x="' + X(tOut) + '" y="' + m.t + '" width="' + (X(t1) - X(tOut)) + '" height="' + (H - m.t - m.b) + '" fill="var(--flat)" opacity=".55"/><text x="' + (X(tOut) + 6) + '" y="' + (m.t + 14) + '">outlook</text>';
    for (let v = lo; v <= hi + 1e-9; v += 0.5) s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--rule)" stroke-width="1"/><text x="' + (m.l - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v.toFixed(1) + '</text>';
    let prev = null; pts.forEach(r => { if (r.loc.key !== prev && r.loc.hour === 0) { s += '<line x1="' + X(r.t) + '" x2="' + X(r.t) + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="var(--rule)"/><text x="' + (X(r.t) + 5) + '" y="' + (H - m.b + 18) + '">' + fmt(r.t, { weekday: 'short', day: 'numeric' }) + '</text>'; } prev = r.loc.key; });
    s += '<path d="' + band('q90') + '" fill="var(--band90)"/><path d="' + band('q68') + '" fill="var(--band68)"/>';
    s += '<path d="' + path(pts, r => lv(r.tide)) + '" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/>';
    s += '<path d="' + path(pts.filter(r => r.obs), r => lv(r.level)) + '" fill="none" stroke="var(--ink)" stroke-width="2.2"/>';
    s += '<path d="' + path([pts.filter(r => r.obs).pop()].concat(fc).filter(Boolean), r => lv(r.level)) + '" fill="none" stroke="var(--hi3)" stroke-width="2.4"/>';
    if (now > t0 && now < t1) s += '<line x1="' + X(now) + '" x2="' + X(now) + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="var(--caution)" stroke-width="1.5"/><text x="' + (X(now) + 5) + '" y="' + (H - m.b - 6) + '" style="fill:var(--caution)">now</text>';
    const c = $('chart'); c.setAttribute('viewBox', '0 0 ' + W + ' ' + H); c.innerHTML = s;
    $('chartUnits').textContent = unitName();
  }

  function lows(fc) {
    const out = [];
    for (let i = 0; i < fc.length; i++) { let ok = true; for (let j = Math.max(0, i - 4); j <= Math.min(fc.length - 1, i + 4); j++) if (fc[j].level < fc[i].level) { ok = false; break; } if (ok && i > 0 && i < fc.length - 1 && (!out.length || fc[i].t - out[out.length - 1].t > 6 * HR)) out.push(fc[i]); }
    $('lows').tBodies[0].innerHTML = out.map(r => '<tr class="' + (r.outlook ? 'outlook' : '') + '"><td>' + shortDayHour(r.t) + (r.outlook ? ' (outlook)' : '') + '</td><td class="r">' + lv(r.level).toFixed(1) + '</td><td class="r">' + lv(r.tide).toFixed(1) + '</td><td class="r"><span class="chip ' + cls(r.dev) + '">' + signed(r.dev) + '</span></td><td class="r">' + lv(r.level - r.q68).toFixed(1) + ' to ' + lv(r.level + r.q68).toFixed(1) + '</td><td>' + compass(r.from) + ' ' + r.mph + ' mph</td></tr>').join('') || '<tr><td colspan="6">No low waters in the forecast window.</td></tr>';
    $('lowsUnits').textContent = unitName();
  }

  /* ---- weather discussion: written from this run's wind and water levels ---- */
  const regime = f => (f >= 300 || f < 60) ? 'north' : f < 120 ? 'east' : f < 200 ? 'south' : 'west';
  const vec = a => { let u = 0, v = 0, s = 0; a.forEach(r => { const x = r.from * Math.PI / 180; u += -Math.sin(x) * r.mph; v += -Math.cos(x) * r.mph; s += r.mph; }); return { mph: s / a.length, from: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360 }; };
  const hourOf = t => fmt(t, { hour: 'numeric' });
  const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function weather(fc) {
    const box = $('wx'), syn = $('wxSynopsis');
    $('wxUnits').textContent = unitName();
    const ok = fc.filter(r => r.mph != null && r.from != null);
    if (ok.length < 6) { syn.textContent = 'No wind forecast is available for this run, so there is no discussion. Use the forecasters\' links below.'; box.innerHTML = ''; return; }
    const near = ok.filter(r => !r.outlook), base = near.length ? near : ok;
    // synopsis
    const d1 = vec(ok.slice(0, 24)), out = [];
    out.push('Wind over the next 24 hours averages ' + compass(d1.from) + ' near ' + Math.round(d1.mph) + ' mph.');
    let turn = null;
    for (let i = 6; i < base.length - 2; i++) { const before = regime(vec(base.slice(i - 6, i)).from); if (before !== 'north' && [0, 1, 2].every(k => regime(base[i + k].from) === 'north' && base[i + k].mph >= 12)) { turn = i; break; } }
    const pk = base.reduce((a, b) => (b.mph > a.mph ? b : a));
    if (turn != null) { const after = base.slice(turn, turn + 24), p2 = after.reduce((a, b) => (b.mph > a.mph ? b : a)); out.push('It turns north around ' + dayHour(base[turn].t) + ' and builds to about ' + p2.mph + ' mph by ' + dayHour(p2.t) + '. A turn like that usually marks a front.'); }
    else out.push('No sharp turn to north wind is in the next four days. The strongest wind is ' + compass(pk.from) + ' near ' + pk.mph + ' mph around ' + dayHour(pk.t) + '.');
    const lo = base.reduce((a, b) => (b.dev < a.dev ? b : a)), hi = base.reduce((a, b) => (b.dev > a.dev ? b : a));
    const below = 'as much as ' + (-lo.dev).toFixed(1) + ' ft below it around ' + dayHour(lo.t), above = 'as much as ' + hi.dev.toFixed(1) + ' ft above it around ' + dayHour(hi.t);
    if (lo.dev <= -0.5 && hi.dev >= 0.5) out.push('Against the tide table, the water is forecast to run ' + (lo.t < hi.t ? below + ', then ' + above : above + ', then ' + below) + '.');
    else if (lo.dev <= -0.5) out.push('Against the tide table, the water is forecast to run ' + below + '.');
    else if (hi.dev >= 0.5) out.push('Against the tide table, the water is forecast to run ' + above + '.');
    else out.push('The water should stay within ' + Math.max(-lo.dev, hi.dev, 0.1).toFixed(1) + ' ft of the tide table.');
    syn.textContent = out.join(' ') + ' Issued ' + fmt(F.issued, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) + '.';
    // day by day
    const days = []; ok.forEach(r => { let d = days[days.length - 1]; if (!d || d.key !== r.loc.key) { d = { key: r.loc.key, rows: [] }; days.push(d); } d.rows.push(r); });
    const todayKey = loc(Date.now()).key;
    box.innerHTML = days.filter(d => d.rows.length >= (d.key === loc(Date.now()).key ? 3 : 12)).slice(0, 8).map(d => {
      const R = d.rows, w = vec(R), mx = R.reduce((a, b) => (b.mph > a.mph ? b : a)), mn = R.reduce((a, b) => (b.mph < a.mph ? b : a)), third = Math.max(1, Math.floor(R.length / 3));
      const a = regime(vec(R.slice(0, third)).from), b = regime(vec(R.slice(-third)).from);
      let wind;
      if (mx.mph < 8) wind = 'Light, under 8 mph';
      else if (a !== b && R.length >= 9) { let at = R.findIndex((r, i) => i > 0 && regime(r.from) === b && R.slice(i, i + 3).every(q => regime(q.from) === b)); wind = a.charAt(0).toUpperCase() + a.slice(1) + ', turning ' + b + (at > 0 ? ' near ' + hourOf(R[at].t) : '') + '. Peak ' + mx.mph + ' mph from the ' + compass(mx.from); }
      else wind = compass(w.from) + ' ' + (mn.mph === mx.mph ? mx.mph : mn.mph + ' to ' + mx.mph) + ' mph';
      const dLo = R.reduce((x, y) => (y.dev < x.dev ? y : x)), dHi = R.reduce((x, y) => (y.dev > x.dev ? y : x)), ext = -dLo.dev >= dHi.dev ? dLo : dHi;
      const low = R.reduce((x, y) => (y.level < x.level ? y : x)), allOut = R.every(r => r.outlook);
      let txt = Math.abs(ext.dev) < 0.25 ? 'Water stays close to the tide table.' : 'Water runs up to ' + Math.abs(ext.dev).toFixed(1) + ' ft ' + (ext.dev < 0 ? 'below' : 'above') + ' the tide table, around ' + hourOf(ext.t) + '.';
      txt += ' Lowest ' + lv(low.level).toFixed(1) + ' ft at ' + hourOf(low.t) + '; the tide table alone gives ' + lv(low.tide).toFixed(1) + '.';
      if (allOut) txt += ' Outlook only.';
      const label = d.key === todayKey ? 'Today' : fmt(R[0].t, { weekday: 'short', month: 'short', day: 'numeric' });
      return '<div class="wxday' + (allOut ? ' outlook' : '') + '"><div class="d">' + esc(label) + (d.key === todayKey && R.length < 20 ? '<small>rest of day</small>' : '') + '</div><div class="w">' + esc(wind) + '</div><div><span class="chip ' + cls(ext.dev) + '">' + signed(ext.dev) + '</span></div><div class="t">' + esc(txt) + '</div></div>';
    }).join('');
  }

  /* ---- alerts: read from data/alerts.json, written hourly by the job ---- */
  let ALERTS = null, alertErr = null;
  const until = a => a.ends || a.expires || null;
  const live = () => (ALERTS && Array.isArray(ALERTS.items) ? ALERTS.items.filter(a => { const u = until(a); return !u || u > Date.now(); }) : []);
  const span = a => { const o = { weekday: 'short', hour: 'numeric', minute: '2-digit' }, u = until(a); return (a.onset && a.onset > Date.now() ? fmt(a.onset, o) + ' to ' : 'Until ') + (u ? fmt(u, o) : 'further notice'); };
  const serious = a => a.severity === 'Extreme' || a.severity === 'Severe';
  const el = (tag, c, text) => { const e = document.createElement(tag); if (c) e.className = c; if (text != null) e.textContent = text; return e; };

  function alerts() {
    const list = $('alertList'), st = $('alertStatus'), cnt = $('alertCount'), strip = $('alertStrip'), items = live();
    list.innerHTML = '';
    cnt.hidden = !items.length; cnt.textContent = items.length; cnt.setAttribute('aria-label', items.length + ' in force');
    strip.hidden = !items.length;
    if (items.length) { strip.className = 'alertstrip' + (serious(items[0]) ? ' sev' : ''); strip.textContent = items[0].event + ' ' + span(items[0]).replace(/^Until/, 'until') + (items.length > 1 ? ', and ' + (items.length - 1) + ' more' : '') + '. View alerts'; }
    if (!ALERTS) { st.textContent = 'The alert list could not be loaded' + (alertErr ? ' (' + alertErr + ')' : '') + '. This does not mean there are no alerts. Check the National Weather Service links below.'; return; }
    const age = (Date.now() - ALERTS.checked) / HR, when = fmt(ALERTS.checked, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    let s = items.length ? items.length + (items.length === 1 ? ' alert is' : ' alerts are') + ' in force for Galveston Bay or the Clear Lake entrance.' : 'No National Weather Service alerts are in force for Galveston Bay or the Clear Lake entrance.';
    s += ' Checked ' + when + '.';
    if (!ALERTS.ok) s = 'The last alert check at ' + when + ' did not complete, so this list may be missing alerts. ' + (items.length ? 'Showing what is on file. ' : '') + 'Check the National Weather Service links below.';
    else if (age > 3) s += ' That check is ' + Math.round(age) + ' hours old; newer alerts will not show here. Check the National Weather Service links below.';
    st.textContent = s;
    items.forEach(a => {
      const card = el('article', 'alert' + (serious(a) ? ' sev' : ''));
      const head = el('div', 'ah'); head.appendChild(el('h2', '', a.event)); head.appendChild(el('span', 'src', 'NWS')); card.appendChild(head);
      card.appendChild(el('p', 'when', span(a) + (a.area ? '. ' + a.area : '')));
      if (a.description || a.instruction) { const d = el('details'); d.appendChild(el('summary', '', 'Full text')); if (a.description) d.appendChild(el('p', 'body', a.description)); if (a.instruction) d.appendChild(el('p', 'body', a.instruction)); card.appendChild(d); }
      list.appendChild(card);
    });
  }

  /* ---- menu bar: three views in one page ---- */
  const VIEWS = ['forecast', 'weather', 'alerts'];
  function route(scroll) {
    const h = location.hash.replace('#', ''), v = VIEWS.includes(h) ? h : 'forecast';
    VIEWS.forEach(k => { $('view-' + k).hidden = k !== v; });
    document.querySelectorAll('.mast nav a[data-view]').forEach(a => { if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (scroll) { const target = h && !VIEWS.includes(h) ? document.getElementById(h) : null; if (target) target.scrollIntoView(); else window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', () => route(true));
  route(false);

  function render() { const fc = rows.filter(r => !r.obs && r.t + HR > Date.now()); headline(fc); notice(); grid(); pick(); chart(); lows(fc); weather(fc);
    document.querySelectorAll('.units button').forEach(b => b.setAttribute('aria-pressed', b.dataset.u === units ? 'true' : 'false')); }

  document.querySelectorAll('.units button').forEach(b => b.addEventListener('click', () => { units = b.dataset.u; try { localStorage.setItem('baychop_units', units); } catch (e) {} render(); }));

  (async () => {
    try {
      let a = window.BAYCHOP_ALERTS || null;
      if (!a) { const r = await fetch('data/alerts.json?h=' + Math.floor(Date.now() / 6e5), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); a = await r.json(); }
      if (!a || typeof a.checked !== 'number') throw new Error('unreadable file');
      ALERTS = a;
    } catch (err) { alertErr = err.message; }
    alerts();
    setInterval(alerts, 5 * 60000);   // drop alerts as they end, without a reload
  })();

  (async () => {
    try {
      let d = window.BAYCHOP_SNAPSHOT || null;
      if (!d) { const r = await fetch('data/forecast.json?h=' + Math.floor(Date.now() / 6e5), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); d = await r.json(); }
      build(d); render();
    } catch (err) {
      $('lede').textContent = 'The forecast could not be loaded.';
      $('sub').textContent = 'The stored forecast file did not open (' + err.message + '). Reload the page in a minute. Until it loads, use the tide table and the live gauge linked below.';
      $('wxSynopsis').textContent = 'The forecast could not be loaded, so there is no discussion. Use the forecasters\' links below.';
    }
  })();
})();
