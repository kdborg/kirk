/* Roundtable Ledger: read a ledger.sqlite file and score it in the browser.
   A line-for-line port of load_game() and compute() in server.py (games as timelines of events), so a static website can show the same
   reports with nothing but this file, index.html and ledger.sqlite. Works with sql.js (SQLite compiled to
   WebAssembly). Read-only: it never writes to the database. */
(function (root) {
  'use strict';
  const SETS = {
    fry:       {label: "Fry's points (from her video)", burn: .47, first: .40, again: .33, stayed: -1.28, named: -1.69},
    all:       {label: 'All 20 English-language seasons', burn: .05, first: .20, again: .02, stayed: -.50, named: -.12},
    world: {label: 'All 44 completed seasons worldwide', burn: .16, first: .20, again: -.15, stayed: -.48, named: -.18},
    UK:        {label: 'UK seasons (incl. Celebrity)', burn: .43, first: .38, again: -.54, stayed: -.80, named: -.34},
    US:        {label: 'US seasons', burn: -.57, first: .34, again: -.23, stayed: -1.64, named: .70},
    Australia: {label: 'Australian seasons', burn: -1.36, first: .12, again: .50, stayed: -.37, named: 0},
    Canada:    {label: 'Canadian seasons', burn: -.89, first: .38, again: 0, stayed: -.90, named: -.38},
    NZ:        {label: 'New Zealand seasons', burn: .83, first: -.03, again: 2.12, stayed: -.30, named: -.77},
    Ireland:   {label: 'Irish seasons', burn: .15, first: -.10, again: -.44, stayed: .30, named: 1.03},
    Germany: {label: 'German seasons', burn: .65, first: .34, again: -.32, stayed: -1.42, named: -.32},
    Sweden: {label: 'Swedish seasons', burn: .27, first: .47, again: -1.04, stayed: -.93, named: .00},
    Finland: {label: 'Finnish seasons', burn: -.11, first: .13, again: .80, stayed: -.88, named: -.05},
    Spain: {label: 'Spanish seasons', burn: .71, first: .09, again: .00, stayed: -.20, named: .00},
    Czechia: {label: 'Czech seasons', burn: .00, first: .33, again: .18, stayed: -1.31, named: .00},
    India: {label: 'Indian seasons', burn: .42, first: -.16, again: .00, stayed: .36, named: 1.81},
    Romania: {label: 'Romanian season', burn: .80, first: .41, again: -.41, stayed: -.77, named: .00},
    Greece: {label: 'Greek season', burn: .00, first: -.28, again: .45, stayed: .63, named: .00},
    Bulgaria: {label: 'Bulgarian season', burn: .00, first: .18, again: .00, stayed: -.34, named: .00},
    Portugal: {label: 'Portuguese season', burn: -.43, first: .00, again: .00, stayed: .00, named: .00},
  };
  const EXTRA = {breakfast: -1.73, seating: -1.91, revenge: 1.49};
  const EXTRA_DEFAULT_ON = {breakfast: true, seating: true, revenge: false};
  const CLUES = ['burn', 'first', 'again', 'stayed', 'named', 'breakfast', 'seating', 'revenge'];
  const RULE_DEFAULTS = {startTraitors: null, sameGroup: true, adjacent: true, breakfastTogether: true, carTogether: true};
  const MAX_GROUPS = 400000;

  function rows(db, sql, params) {
    const st = db.prepare(sql); const out = [];
    try { if (params) st.bind(params); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
    return out;
  }
  const hasCol = (db, table, col) => rows(db, `PRAGMA table_info(${table})`).some(r => r.name === col);
  const hasTable = (db, table) => rows(db, "SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?", [table]).length > 0;

  function listGames(db) {
    return rows(db, 'SELECT id, name, is_example FROM games ORDER BY is_example, name COLLATE NOCASE')
      .map(r => ({id: String(r.id), name: r.name, example: !!r.is_example}));
  }

  const KINDS = {traitors: 'Traitors chosen', murder: 'Murder', breakfast: 'Breakfast', mission: 'Mission',
                 recruit: 'Recruitment', roundtable: 'Roundtable', left: 'Left the game', note: 'Note'};
  const FIELDS = {
    traitors: {players: []}, murder: {players: []}, recruit: {players: []}, breakfast: {groups: {}},
    mission: {title: '', shields: [], dagger: '', cars: {}},
    roundtable: {seats: [], votes: {}, revote: {}, moreRevotes: [], dagger: '', banished: '', role: '', chance: false, final: false},
    left: {players: [], roles: {}}, note: {},
  };

  function revoteBallots(src) {
    const out = [['revote', src.revote || {}]];
    (src.moreRevotes || []).forEach((m, i) => out.push([`revote${i + 3}`, m || {}]));
    return out.filter(([, m]) => Object.values(m).some(Boolean));
  }
  /* Votes per target; the dagger holder's vote counts twice. */
  function tally(ballot, dagger) {
    const t = {};
    Object.entries(ballot || {}).forEach(([v, x]) => { if (x) t[x] = (t[x] || 0) + (v === dagger ? 2 : 1); });
    return t;
  }
  function banishedRole(g, ev, known) {
    const b = ev.banished;
    if (!b) return '';
    if (b in known) return 'Traitor';
    if (!g.hasTraitors) return ev.role || 'Faithful';
    return 'Faithful';
  }
  function annotate(g) {
    g.hasTraitors = g.events.some(e => e.kind === 'traitors' && (e.players || []).length);
    const known = {};
    g.events.forEach(ev => {
      if (ev.kind === 'traitors' || ev.kind === 'recruit') (ev.players || []).forEach(p => { if (!(p in known)) known[p] = ev.seq; });
      else if (ev.kind === 'roundtable') {
        ev.role = banishedRole(g, ev, known);
        ev.tallies = [ev.votes || {}].concat(revoteBallots(ev).map(x => x[1])).map(m => tally(m, ev.dagger));
      }
    });
  }
  function loadRules(rulesText, events) {
    let r = {};
    try { r = JSON.parse(rulesText || '{}') || {}; } catch (e) { r = {}; }
    const rules = Object.assign({}, RULE_DEFAULTS);
    Object.keys(r).forEach(k => { if (k in RULE_DEFAULTS) rules[k] = r[k]; });
    const first = events.find(e => e.kind === 'traitors');
    const recorded = first ? (first.players || []).length : 0;
    rules.startTraitorsUsed = parseInt(rules.startTraitors || recorded || 3, 10);
    return rules;
  }

  /* A player's headshot (stored in the database) as a URL the page can show; cached so it's made once per photo. */
  const PHOTO_URLS = {};
  function photoUrl(r) {
    if (!r.photo || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return '';
    const key = r.id + ':' + r.photo.length;
    if (!PHOTO_URLS[key]) PHOTO_URLS[key] = URL.createObjectURL(new Blob([r.photo], {type: r.photo_type || 'image/jpeg'}));
    return PHOTO_URLS[key];
  }
  function loadGame(db, gid) {
    const g = rows(db, 'SELECT * FROM games WHERE id=?', [gid])[0];
    if (!g) throw new Error("That game doesn't exist.");
    if (!hasTable(db, 'events')) throw new Error('This database is from before the timeline. Open it once in the app (python3 server.py) to convert it, then upload it again.');
    const grpCol = hasCol(db, 'players', 'grp'), jobCol = hasCol(db, 'players', 'job'), photoCol = hasCol(db, 'players', 'photo');
    const players = rows(db, `SELECT id, name${grpCol ? ', grp' : ''}${jobCol ? ', job' : ''}${photoCol ? ', photo, photo_type' : ''} FROM players WHERE game_id=? ORDER BY sort, id`, [gid])
      .map(r => ({id: String(r.id), name: r.name, group: r.grp || '', job: r.job || '', photo: photoUrl(r)}));
    const pts = {}; rows(db, 'SELECT * FROM points WHERE game_id=?', [gid]).forEach(r => { pts[r.clue] = r; });
    const points = {}, extras = {};
    CLUES.forEach(c => { points[c] = c in pts ? pts[c].value : (c in EXTRA ? EXTRA[c] : SETS.fry[c]); });
    Object.keys(EXTRA).forEach(c => { extras[c] = c in pts ? !!pts[c].enabled : EXTRA_DEFAULT_ON[c]; });
    const events = rows(db, 'SELECT * FROM events WHERE game_id=? ORDER BY seq, id', [gid]).map((r, i) => {
      const ev = {id: String(r.id), seq: i + 1, episode: r.episode == null ? null : r.episode, kind: r.kind};
      Object.assign(ev, JSON.parse(JSON.stringify(FIELDS[r.kind] || {})), {note: ''}, JSON.parse(r.data || '{}'));
      return ev;
    });
    const out = {id: String(g.id), name: g.name, example: !!g.is_example, source: g.source || '', pointSet: g.point_set,
                 points, extras, players, events, created: g.created};
    annotate(out);
    out.rules = loadRules(g.rules, events);
    return out;
  }

  function setKeys(g) { const keys = Object.keys(SETS); return g.pointSet === 'custom' ? ['custom'].concat(keys) : keys; }
  function setLabel(g, key) { return key === 'custom' ? "This game's custom points" : (SETS[key] || SETS.fry).label; }
  function pointsFor(g, key) {
    if (!key || key === 'custom' || !(key in SETS)) return Object.assign({}, g.points);
    const p = {}; Object.keys(SETS[key]).forEach(k => { if (k !== 'label') p[k] = SETS[key][k]; });
    Object.keys(EXTRA).forEach(k => { p[k] = (k in g.points) ? g.points[k] : EXTRA[k]; });
    return p;
  }

  function comb(n, k) { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }
  function* combinations(arr, k) {
    const n = arr.length; if (k > n) return; const idx = Array.from({length: k}, (_, i) => i);
    while (true) {
      yield idx.map(i => arr[i]);
      let i = k - 1; while (i >= 0 && idx[i] === i + n - k) i--;
      if (i < 0) return; idx[i]++; for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
  }
  const pyRound = (v, d) => { const f = Math.pow(10, d); return Math.round(v * f) / f; };
  const pySort = a => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

  function shortNames(players) {
    const first = {};
    players.forEach(p => { const w = p.name.split(/\s+/).filter(Boolean); const f = w.length ? w[0] : p.name; (first[f] = first[f] || []).push(p); });
    const out = {};
    Object.entries(first).forEach(([f, ps]) => ps.forEach(p => {
      const parts = p.name.replace(/"[^"]*"|“[^”]*”/g, ' ').split(/\s+/).filter(Boolean);
      out[p.id] = (ps.length === 1 || parts.length < 2) ? f : `${f} ${parts[parts.length - 1][0]}.`;
    }));
    return out;
  }
  function eventLabel(ev, nm) {
    const names = ids => ids.map(i => nm[i] || '?').join(', ');
    switch (ev.kind) {
      case 'murder': return (ev.players || []).length ? `${names(ev.players)} murdered` : 'Murder (nobody picked yet)';
      case 'roundtable': return ev.banished ? `${nm[ev.banished] || '?'} banished` : 'Roundtable, nobody banished yet';
      case 'left': return (ev.players || []).length ? `${names(ev.players)} left` : 'Left the game (nobody picked yet)';
      case 'recruit': return `${names(ev.players || [])} recruited`;
      default: return KINDS[ev.kind] || ev.kind;
    }
  }

  function possibleGroups(g, at, inPlay, score, out, known) {
    const rules = g.rules || RULE_DEFAULTS;
    const start = parseInt(rules.startTraitorsUsed || 3, 10);
    const evs = g.events.filter(e => e.seq <= at);
    const recruits = evs.reduce((a, e) => a + (e.kind === 'recruit' ? (e.players || []).length : 0), 0);
    const traitorsOut = Object.values(out).filter(o => o.role === 'Traitor').length;
    const k = Math.max(0, Math.min(inPlay.length, start + recruits - traitorsOut));
    const res = {size: k, start: g.players.length >= start ? comb(g.players.length, start) : 0,
                 facts: inPlay.length ? comb(inPlay.length, k) : 0, count: 0, chance: {}, top: [],
                 ruledOut: {sameGroup: 0, breakfast: 0, car: 0, adjacent: 0}, capped: false};
    if (k === 0) { inPlay.forEach(p => { res.chance[p] = 0; }); return res; }
    if (res.facts > MAX_GROUPS) { res.capped = true; return res; }
    const grp = {}; g.players.forEach(p => { grp[p.id] = (p.group || '').trim().toLowerCase(); });
    const rec = evs.filter(e => e.kind === 'recruit').map(e => e.seq);
    const cut = rec.length ? Math.max(...rec) : 0;
    if (cut) res.sightingsFrom = {after: cut};
    const seen = evs.filter(e => e.seq > cut);
    const togetherSets = (kind, field) => {
      const sets = [];
      seen.forEach(e => {
        if (e.kind !== kind) return;
        const groups = {};
        Object.entries(e[field] || {}).forEach(([p, no]) => { if ((parseInt(no, 10) || 0) > 0) (groups[parseInt(no, 10)] = groups[parseInt(no, 10)] || new Set()).add(p); });
        Object.values(groups).forEach(v => { if (v.size >= 3) sets.push(v); });
      });
      return sets;
    };
    const bfSets = rules.breakfastTogether ? togetherSets('breakfast', 'groups') : [];
    const carSets = rules.carTogether ? togetherSets('mission', 'cars') : [];
    const triples = [];
    if (rules.adjacent) seen.forEach(e => {
      const st = e.kind === 'roundtable' ? (e.seats || []) : [], L = st.length;
      if (L >= 3) for (let i = 0; i < L; i++) triples.push([st[i], st[(i + 1) % L], st[(i + 2) % L]]);
    });
    const reason = combo => {
      if (k < 3) return null;
      const cs = new Set(combo);
      if (rules.sameGroup) {
        const labels = combo.map(p => grp[p] || '').filter(Boolean), c = {};
        labels.forEach(l => { c[l] = (c[l] || 0) + 1; });
        if (Object.values(c).some(x => x >= 3)) return 'sameGroup';
      }
      const meets = sets => sets.some(t => { let m = 0; t.forEach(p => { if (cs.has(p)) m++; }); return m >= 3; });
      if (meets(bfSets)) return 'breakfast';
      if (meets(carSets)) return 'car';
      if (triples.length && triples.some(t => [...new Set(t)].every(p => cs.has(p)))) return 'adjacent';
      return null;
    };
    const weights = [], kept = [];
    for (const combo of combinations(pySort(inPlay), k)) {
      const why = reason(combo);
      if (why) { res.ruledOut[why] += 1; continue; }
      kept.push(combo); weights.push(combo.reduce((a, p) => a + score[p], 0));
    }
    const actual = pySort(inPlay.filter(p => p in known && known[p].at <= at));
    if (actual.length === k && k > 0) res.recordedRuledOut = reason(actual);
    res.count = kept.length;
    if (!kept.length) { inPlay.forEach(p => { res.chance[p] = 0; }); return res; }
    const m = Math.max(...weights), ws = weights.map(w => Math.exp(w - m)), tot = ws.reduce((a, b) => a + b, 0);
    const chance = {}; inPlay.forEach(p => { chance[p] = 0; });
    kept.forEach((combo, i) => combo.forEach(p => { chance[p] += ws[i] / tot; }));
    Object.keys(chance).forEach(p => { res.chance[p] = pyRound(chance[p], 4); });
    const r9 = v => Math.round(v * 1e9) / 1e9;
    const order = kept.map((_, i) => i).sort((a, b) => (r9(weights[b]) - r9(weights[a])) || (a - b)).slice(0, 5);   // ties keep list order
    res.top = order.map(i => ({members: kept[i], points: pyRound(weights[i], 2), share: pyRound(ws[i] / tot, 4)}));
    return res;
  }

  function compute(g, points) {
    const pts = points || g.points, P = g.players, extras = g.extras;
    const name = {}, score = {}, log = {};
    P.forEach(p => { name[p.id] = p.name; score[p.id] = 0; log[p.id] = []; });
    const short = shortNames(P);
    const out = {}, lastGroups = [], bfDone = new Set(), snaps = [];
    let ballots = [], rt = 0;
    const known = {};
    const add = (p, v, label, ev, key) => { if (!(p in score)) return; v = +(v || 0); score[p] += v; log[p].push({at: ev.seq, ep: ev.episode, label, v, key}); };
    const snap = (ev, label, mark) => {
      const inPlay = P.map(p => p.id).filter(id => !(id in out));
      const rank = {}; inPlay.forEach(i => { rank[i] = 1 + inPlay.filter(o => score[o] > score[i] + 1e-9).length; });
      Object.entries(out).forEach(([p, o]) => { if (!o.role && p in known) o.role = 'Traitor'; });
      const tr = inPlay.filter(p => p in known), fa = inPlay.filter(p => !(p in known));
      let auc = null;
      if (tr.length && fa.length && Object.keys(known).length) {
        let s = 0; tr.forEach(t => fa.forEach(f => { s += (score[t] > score[f] + 1e-9 ? 1 : 0) + .5 * (Math.abs(score[t] - score[f]) <= 1e-9 ? 1 : 0); }));
        auc = s / (tr.length * fa.length);
      }
      const poss = possibleGroups(g, ev.seq, inPlay, score, out, known);
      const sc = {}; Object.keys(score).forEach(k => { sc[k] = pyRound(score[k], 4); });
      snaps.push({n: snaps.length + 1, at: ev.seq, ep: ev.episode, kind: ev.kind, label, short: mark, score: sc, rank, groups: poss,
                  traitors: tr, accuracy: auc, inPlay, out: JSON.parse(JSON.stringify(out)), rt});
    };
    let lastSnapped = null;
    g.events.forEach(ev => {
      const k = ev.kind, at = ev.seq;
      let mark = null;
      if (k === 'traitors') (ev.players || []).forEach(p => { if (!(p in known)) known[p] = {at, kind: 'original'}; });
      else if (k === 'recruit') (ev.players || []).forEach(p => { if (!(p in known)) known[p] = {at, kind: 'recruited'}; });
      else if (k === 'murder') {
        const nw = (ev.players || []).filter(p => !(p in out));
        nw.forEach(p => { out[p] = {at, ep: ev.episode, how: 'murdered', role: 'Faithful'}; });
        if (nw.length) mark = 'M · ' + nw.map(p => short[p] || '?').join(', ');
      } else if (k === 'breakfast') {
        const bf = Object.entries(ev.groups || {}).filter(([p, gn]) => (parseInt(gn, 10) || 0) > 0 && !(p in out)).map(([p, gn]) => [p, parseInt(gn, 10)]);
        if (bf.length) { const mx = Math.max(...bf.map(x => x[1])); lastGroups.push({at, ep: ev.episode, members: bf.filter(x => x[1] === mx).map(x => x[0])}); }
      } else if (k === 'roundtable') {
        const fb = Object.entries(ev.votes || {}).filter(([v, t]) => t && !(v in out));
        const res = revoteBallots(ev);
        let rv = []; res.forEach(([, m]) => Object.entries(m).forEach(([v, t]) => { if (t && !(v in out)) rv.push([v, t]); }));
        if (!rv.length) rv = null;
        const lastRv = res.length ? Object.entries(res[res.length - 1][1]).filter(([v, t]) => t && !(v in out)) : [];
        const T = ev.banished;
        const role = banishedRole(g, ev, known);
        const shown = ev.final ? '' : role;   // banishments in the final don't reveal the role, so no clue fires on them
        if (fb.length) {
          rt += 1;
          const earlier = ballots.slice();
          ballots = ballots.concat(fb.map(([v, t]) => ({at, rt, voter: v, target: t})));
          if (rv) ballots = ballots.concat(rv.map(([v, t]) => ({at, rt, voter: v, target: t, re: true})));
          if (rt <= 3) {
            const c = {}; fb.forEach(([, t]) => { c[t] = (c[t] || 0) + 1; });
            fb.forEach(([v, t]) => { if (c[t] === 1) add(v, pts.burn, `Early burn vote on ${name[t] || '?'}`, ev, 'burn'); });
          }
          if (T && shown === 'Traitor') {
            const tn = name[T] || '?', dec = lastRv.length ? lastRv : fb;
            dec.forEach(([v, t]) => {
              if (v === T) return;
              if (t === T) {
                const before = earlier.some(b => b.voter === v && b.target === T);
                if (before) add(v, pts.again, `Piled on ${tn} (had voted for them before)`, ev, 'again');
                else add(v, pts.first, `Piled on ${tn} (first time)`, ev, 'first');
              } else add(v, pts.stayed, `Stayed out of the pile-on on ${tn}`, ev, 'stayed');
            });
            const present = new Set(fb.map(x => x[0]).concat(dec.map(x => x[0]))); present.delete(T);
            const frm = known[T].kind === 'recruited' ? known[T].at : 0;
            const tv = new Set(earlier.filter(b => b.voter === T && b.at >= frm).map(b => b.target));
            pySort([...present]).forEach(p => { if (tv.has(p)) add(p, pts.named, `${tn} had voted for them before`, ev, 'named'); });
            if (extras.revenge) {
              const tb = dec.find(x => x[0] === T);
              if (tb) { const p = tb[1], pv = dec.find(x => x[0] === p); if (pv && pv[1] === T) add(p, pts.revenge, `${tn} voted for them on the way out`, ev, 'revenge'); }
            }
            const seats = ev.seats || [];
            if (extras.seating && seats.length > 2 && seats.includes(T)) {
              const i = seats.indexOf(T), L = seats.length;
              [...new Set([seats[(i - 1 + L) % L], seats[(i + 1) % L]])].forEach(p => { if (p !== T && !(p in out)) add(p, pts.seating, `Sat next to ${tn}`, ev, 'seating'); });
            }
            if (extras.breakfast) lastGroups.forEach(lg => {
              if (lg.members.includes(T)) lg.members.forEach(p => {
                const key = T + '|' + p;
                if (p !== T && !bfDone.has(key) && !(p in out)) { bfDone.add(key); add(p, pts.breakfast, `Last to breakfast with ${tn}` + (lg.ep ? ` (episode ${lg.ep})` : ''), ev, 'breakfast'); }
              });
            });
          }
        }
        if (T && !(T in out)) { out[T] = {at, ep: ev.episode, how: 'banished', role, hidden: !!ev.final}; mark = 'B · ' + (short[T] || '?'); }
      } else if (k === 'left') {
        const nw = (ev.players || []).filter(p => !(p in out));
        nw.forEach(p => { out[p] = {at, ep: ev.episode, how: 'left', role: (ev.roles || {})[p] || ''}; });
        if (nw.length) mark = 'L · ' + nw.map(p => short[p] || '?').join(', ');
      }
      if (mark) { snap(ev, eventLabel(ev, name), mark); lastSnapped = at; }
    });
    const E = g.events;
    if (E.length && lastSnapped !== E[E.length - 1].seq) {
      const ev = E[E.length - 1];
      const shown = [...E].reverse().find(e => e.kind !== 'note') || ev;
      if (shown.seq > (lastSnapped || 0)) snap(ev, 'Latest: ' + eventLabel(shown, name), 'Now');
    }
    return {snaps, log, out, rt, known, rules: g.rules};
  }


  /* ---------------- the Keys: a separate checklist, not Turing points (port of compute_keys in server.py) ---------------- */
  const KEYS = [
    ['lastvote', "No banished Traitor's last vote went to them"],
    ['murdered', 'They have never voted at a roundtable for someone the Traitors murdered that night'],
    ['burn', "They didn't cast a lone vote in the first three roundtables"],
    ['victim', "No murder victim's last vote was for them"],
    ['stayed', 'They have stayed out of a pile-on on a banished Traitor'],
    ['piled', "They haven't voted to banish a Traitor on the night they went"],
    ['lone', 'They have never cast a lone vote'],
  ];
  const KEY_RATES = {0: [192, .08], 1: [1521, .18], 2: [1172, .20], 3: [649, .29], 4: [285, .27], 5: [43, .58], 6: [5, .80]};
  function computeKeys(g) {
    const P = g.players, name = {}, short = shortNames(P), broke = {};
    P.forEach(p => { name[p.id] = p.name; broke[p.id] = {}; });
    const out = {}, snaps = [], lastVote = {};
    let ballots = [], rt = 0;
    const nm = id => name[id] || '?';
    const mark = (p, key, ev, why) => { if (p in broke && !(key in broke[p])) broke[p][key] = {at: ev.seq, ep: ev.episode, why}; };
    const falseKeys = p => KEYS.map(k => k[0]).filter(k => (k !== 'stayed' && k in broke[p]) || (k === 'stayed' && !(k in broke[p])));
    const snap = (ev, label, m) => {
      const inPlay = P.map(p => p.id).filter(id => !(id in out)), f = {};
      inPlay.forEach(p => { f[p] = falseKeys(p); });
      snaps.push({n: snaps.length + 1, at: ev.seq, ep: ev.episode, label, short: m, inPlay, false: f, out: JSON.parse(JSON.stringify(out))});
    };
    let lastSnapped = null;
    g.events.forEach(ev => {
      const k = ev.kind, seq = ev.seq; let m = null;
      if (k === 'murder' && (ev.players || []).length) {
        const victims = ev.players.filter(p => !(p in out));
        victims.forEach(v => { if (v in lastVote) mark(lastVote[v], 'victim', ev, `${nm(v)}'s last vote was for them, then ${nm(v)} was murdered`); });
        ballots.forEach(b => { if (b.rt === rt && victims.includes(b.target)) mark(b.voter, 'murdered', ev, `Voted for ${nm(b.target)}, who was then murdered`); });
        victims.forEach(v => { out[v] = {at: seq, ep: ev.episode, how: 'murdered', role: 'Faithful'}; });
        if (victims.length) m = 'M · ' + victims.map(p => short[p] || '?').join(', ');
      } else if (k === 'roundtable' && ev.votes && Object.keys(ev.votes).length) {
        const fb = Object.entries(ev.votes).filter(([v, t]) => t && !(v in out));
        const res = revoteBallots(ev);
        const last = res.length ? Object.entries(res[res.length - 1][1]).filter(([v, t]) => t && !(v in out)) : [];
        if (fb.length) {
          rt += 1;
          const cnt = {}; fb.forEach(([, t]) => { cnt[t] = (cnt[t] || 0) + 1; });
          fb.forEach(([v, t]) => {
            lastVote[v] = t;
            if (cnt[t] === 1) { mark(v, 'lone', ev, `Lone vote for ${nm(t)}`); if (rt <= 3) mark(v, 'burn', ev, `Lone vote for ${nm(t)} at roundtable ${rt}`); }
          });
          last.forEach(([v, t]) => { lastVote[v] = t; });
          const B = ev.banished;
          if (B && ev.role === 'Traitor' && !ev.final) {   // roles aren't revealed in the final
            const bn = nm(B), dec = last.length ? last : fb;
            dec.forEach(([v, t]) => { if (v === B) return; if (t === B) mark(v, 'piled', ev, `Voted to banish ${bn}, a Traitor`); else mark(v, 'stayed', ev, `Voted for ${nm(t)} when ${bn}, a Traitor, was banished`); });
            const d = dec.find(x => x[0] === B) || fb.find(x => x[0] === B);
            if (d && d[1]) mark(d[1], 'lastvote', ev, `${bn}, a banished Traitor, cast their last vote for them`);
          }
          ballots = ballots.concat(fb.map(([v, t]) => ({rt, voter: v, target: t})));
        }
      }
      if (k === 'roundtable') {
        const B = ev.banished;
        if (B && !(B in out)) { out[B] = {at: seq, ep: ev.episode, how: 'banished', role: ev.role || '', hidden: !!ev.final}; m = 'B · ' + (short[B] || '?'); }
      } else if (k === 'left') {
        const nw = (ev.players || []).filter(p => !(p in out));
        nw.forEach(p => { out[p] = {at: seq, ep: ev.episode, how: 'left', role: (ev.roles || {})[p] || ''}; });
        if (nw.length) m = 'L · ' + nw.map(p => short[p] || '?').join(', ');
      }
      if (m) { snap(ev, eventLabel(ev, name), m); lastSnapped = seq; }
    });
    const E = g.events;
    if (E.length && lastSnapped !== E[E.length - 1].seq) {
      const shown = [...E].reverse().find(e => e.kind !== 'note') || E[E.length - 1];
      if (shown.seq > (lastSnapped || 0)) snap(E[E.length - 1], 'Latest: ' + eventLabel(shown, name), 'Now');
    }
    const known = new Set(); E.forEach(e => { if (e.kind === 'traitors' || e.kind === 'recruit') (e.players || []).forEach(p => known.add(p)); });
    const rates = {}; Object.entries(KEY_RATES).forEach(([n, [c, r]]) => { rates[n] = {count: c, traitor: r}; });
    return {keys: KEYS.map(([id, text]) => ({id, text})), rates, snaps, changes: broke, traitors: pySort([...known])};
  }
  function keysGame(db, gid) { return computeKeys(loadGame(db, gid)); }

  function scoreGame(db, gid, setKey) {
    const g = loadGame(db, gid);
    const key = setKeys(g).includes(setKey) ? setKey : g.pointSet;
    const R = compute(g, pointsFor(g, key));
    R.set = key; R.sets = setKeys(g).map(k => ({key: k, label: setLabel(g, k)}));
    return R;
  }

  root.LedgerCore = {SETS, EXTRA, KINDS, FIELDS, listGames, loadGame, compute, scoreGame, pointsFor, setKeys, setLabel, revoteBallots, tally, eventLabel, shortNames, computeKeys, keysGame};
  if (typeof module !== 'undefined') module.exports = root.LedgerCore;
})(typeof window !== 'undefined' ? window : globalThis);
