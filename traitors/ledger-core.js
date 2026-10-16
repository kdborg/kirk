/* Roundtable Ledger: read a ledger.sqlite file and score it in the browser.
   A line-for-line port of load_game() and compute() in server.py, so a static website can show the same
   reports with nothing but this file, index.html and ledger.sqlite. Works with sql.js (SQLite compiled to
   WebAssembly). Read-only: it never writes to the database. */
(function (root) {
  'use strict';
  const SETS = {
    fry:       {label: "Fry's points (from her video)", burn: .47, first: .40, again: .33, stayed: -1.28, named: -1.69},
    all:       {label: 'All 20 English-language seasons', burn: .05, first: .20, again: .02, stayed: -.50, named: -.12},
    UK:        {label: 'UK seasons (incl. Celebrity)', burn: .43, first: .38, again: -.54, stayed: -.80, named: -.34},
    US:        {label: 'US seasons', burn: -.57, first: .34, again: -.23, stayed: -1.64, named: .70},
    Australia: {label: 'Australian seasons', burn: -1.36, first: .12, again: .50, stayed: -.37, named: 0},
    Canada:    {label: 'Canadian seasons', burn: -.89, first: .38, again: 0, stayed: -.90, named: -.38},
    NZ:        {label: 'New Zealand seasons', burn: .83, first: -.03, again: 2.12, stayed: -.30, named: -.77},
    Ireland:   {label: 'Irish seasons', burn: .15, first: -.10, again: -.44, stayed: .30, named: 1.03},
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

  function putBallot(rd, ballot, voter, target) {
    if (ballot === 'first') rd.votes[voter] = target;
    else if (ballot === 'revote') rd.revote[voter] = target;
    else {
      const i = parseInt(ballot.slice(6) || '3', 10) - 3;
      rd.moreRevotes = rd.moreRevotes || [];
      while (rd.moreRevotes.length <= i) rd.moreRevotes.push({});
      rd.moreRevotes[i][voter] = target;
    }
  }
  function revoteBallots(src) {
    const out = [['revote', src.revote || {}]];
    (src.moreRevotes || []).forEach((m, i) => out.push([`revote${i + 3}`, m || {}]));
    return out.filter(([, m]) => Object.values(m).some(Boolean));
  }

  function traitorTimeline(episodes) {
    const known = {};
    [...episodes].sort((a, b) => a.n - b.n).forEach(e => {
      (e.traitors || []).forEach(p => { if (!(p in known)) known[p] = [e.n, 'original', e.n]; });
      (e.recruits || []).forEach(p => {
        const tm = (e.recruitTiming || {})[p] || 'after';
        if (!(p in known)) known[p] = [tm === 'before' ? e.n : e.n + 1, 'recruited', e.n];
      });
    });
    return known;
  }
  function deriveRoles(episodes) {
    const known = traitorTimeline(episodes), any = Object.keys(known).length > 0;
    episodes.forEach(e => {
      (e.extraRounds || []).forEach(xr => {
        if (any && xr.banished) { const k = known[xr.banished]; xr.role = (k && k[0] <= e.n) ? 'Traitor' : 'Faithful'; }
        else if (xr.banished && !xr.role) xr.role = 'Faithful';
      });
      e.roleSource = 'stored';
      if (any && e.banished) {
        const k = known[e.banished];
        e.role = (k && k[0] <= e.n) ? 'Traitor' : 'Faithful';
        e.roleSource = 'records';
        e.recruitedEp = (k && k[1] === 'recruited') ? k[0] : null;
      } else if (e.banished && !e.role) { e.role = 'Faithful'; e.roleSource = 'default'; }
    });
  }
  function loadRules(rulesText, episodes) {
    let r = {};
    try { r = JSON.parse(rulesText || '{}') || {}; } catch (e) { r = {}; }
    const rules = Object.assign({}, RULE_DEFAULTS);
    Object.keys(r).forEach(k => { if (k in RULE_DEFAULTS) rules[k] = r[k]; });
    const first = episodes.find(e => e.n === 1);
    const recorded = first ? (first.traitors || []).length : 0;
    rules.startTraitorsUsed = parseInt(rules.startTraitors || recorded || 3, 10);
    return rules;
  }

  function loadGame(db, gid) {
    const g = rows(db, 'SELECT * FROM games WHERE id=?', [gid])[0];
    if (!g) throw new Error("That game doesn't exist.");
    const grpCol = hasCol(db, 'players', 'grp');
    const players = rows(db, `SELECT id, name${grpCol ? ', grp' : ''} FROM players WHERE game_id=? ORDER BY sort, id`, [gid])
      .map(r => ({id: String(r.id), name: r.name, group: r.grp || ''}));
    const pts = {}; rows(db, 'SELECT * FROM points WHERE game_id=?', [gid]).forEach(r => { pts[r.clue] = r; });
    const points = {}, extras = {};
    CLUES.forEach(c => { points[c] = c in pts ? pts[c].value : (c in EXTRA ? EXTRA[c] : SETS.fry[c]); });
    Object.keys(EXTRA).forEach(c => { extras[c] = c in pts ? !!pts[c].enabled : EXTRA_DEFAULT_ON[c]; });
    const hasRound = hasCol(db, 'votes', 'round'), hasExtra = hasTable(db, 'extra_rounds'), hasCars = hasTable(db, 'cars');
    const episodes = rows(db, 'SELECT * FROM episodes WHERE game_id=? ORDER BY n', [gid]).map(e => {
      const eid = e.id, q = sql => rows(db, sql, [eid]), S = v => String(v);
      const ep = {
        n: e.n,
        murdered: q('SELECT player_id FROM murders WHERE episode_id=?').map(r => S(r.player_id)),
        left: [], leftRoles: {},
        shields: q('SELECT player_id FROM shields WHERE episode_id=?').map(r => S(r.player_id)),
        breakfast: {}, cars: {},
        seats: q('SELECT player_id FROM seating WHERE episode_id=? ORDER BY seat_no').map(r => S(r.player_id)),
        votes: {}, revote: {}, moreRevotes: [],
        banished: e.banished_id ? S(e.banished_id) : '',
        role: e.banished_role || '',
        recruitedEp: e.recruited_ep, notes: e.notes || '',
        traitors: [], recruits: [], recruitTiming: {},
      };
      q('SELECT player_id, group_no FROM breakfast WHERE episode_id=?').forEach(r => { ep.breakfast[S(r.player_id)] = r.group_no; });
      if (hasCars) q('SELECT player_id, car_no FROM cars WHERE episode_id=?').forEach(r => { ep.cars[S(r.player_id)] = r.car_no; });
      q('SELECT player_id, kind, timing FROM traitor_marks WHERE episode_id=?').forEach(r => {
        if (r.kind === 'original') ep.traitors.push(S(r.player_id));
        else { ep.recruits.push(S(r.player_id)); ep.recruitTiming[S(r.player_id)] = r.timing; }
      });
      q('SELECT player_id, role FROM departures WHERE episode_id=?').forEach(r => { ep.left.push(S(r.player_id)); ep.leftRoles[S(r.player_id)] = r.role || ''; });
      ep.isFinal = 'is_final' in e ? !!e.is_final : false;
      const extra = {};
      const blank = rnd => ({round: rnd, votes: {}, revote: {}, moreRevotes: [], banished: '', role: ''});
      if (hasExtra) q('SELECT round, banished_id, banished_role FROM extra_rounds WHERE episode_id=? ORDER BY round').forEach(r => {
        extra[r.round] = Object.assign(blank(r.round), {banished: r.banished_id ? S(r.banished_id) : '', role: r.banished_role || ''});
      });
      q(`SELECT ${hasRound ? 'round' : '1 AS round'}, ballot, voter_id, target_id FROM votes WHERE episode_id=?`).forEach(r => {
        const rd = r.round === 1 ? ep : (extra[r.round] = extra[r.round] || blank(r.round));
        putBallot(rd, r.ballot, S(r.voter_id), S(r.target_id));
      });
      ep.extraRounds = Object.keys(extra).map(Number).sort((a, b) => a - b).map(k => extra[k]);
      return ep;
    });
    deriveRoles(episodes);
    return {id: String(g.id), name: g.name, example: !!g.is_example, source: g.source || '', pointSet: g.point_set,
            points, extras, players, episodes, created: g.created, rules: loadRules(g.rules, episodes)};
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

  function possibleGroups(g, n, inPlay, score, out, known) {
    const rules = g.rules || RULE_DEFAULTS;
    const start = parseInt(rules.startTraitorsUsed || 3, 10);
    const eps = g.episodes.filter(e => e.n <= n);
    const recruits = eps.reduce((a, e) => a + (e.recruits || []).length, 0);
    const traitorsOut = Object.values(out).filter(o => o.role === 'Traitor').length;
    const k = Math.max(0, Math.min(inPlay.length, start + recruits - traitorsOut));
    const res = {size: k, start: g.players.length >= start ? comb(g.players.length, start) : 0,
                 facts: inPlay.length ? comb(inPlay.length, k) : 0, count: 0, chance: {}, top: [],
                 ruledOut: {sameGroup: 0, breakfast: 0, car: 0, adjacent: 0}, capped: false};
    if (k === 0) { inPlay.forEach(p => { res.chance[p] = 0; }); return res; }
    if (res.facts > MAX_GROUPS) { res.capped = true; return res; }
    const grp = {}; g.players.forEach(p => { grp[p.id] = (p.group || '').trim().toLowerCase(); });
    const marks = Object.values(known || {}).filter(v => v[1] === 'recruited' && v[2] <= n);
    const dayCut = marks.length ? Math.max(...marks.map(v => v[2] + 1)) : 0;
    const seatCut = marks.length ? Math.max(...marks.map(v => v[0])) : 0;
    const seatings = eps.filter(e => (e.seats || []).length >= 3 && e.n >= seatCut).map(e => e.seats);
    res.sightingsFrom = {breakfastCars: dayCut || 1, roundtable: seatCut || 1};
    const togetherSets = key => {
      const outSets = [];
      eps.forEach(e => {
        if (e.n < dayCut) return;
        const groups = {};
        Object.entries(e[key] || {}).forEach(([p, no]) => { if ((parseInt(no, 10) || 0) > 0) (groups[parseInt(no, 10)] = groups[parseInt(no, 10)] || new Set()).add(p); });
        Object.values(groups).forEach(v => { if (v.size >= 3) outSets.push(v); });
      });
      return outSets;
    };
    const bfSets = rules.breakfastTogether ? togetherSets('breakfast') : [];
    const carSets = rules.carTogether ? togetherSets('cars') : [];
    const triples = [];
    if (rules.adjacent) seatings.forEach(st => { const L = st.length; for (let i = 0; i < L; i++) triples.push([st[i], st[(i + 1) % L], st[(i + 2) % L]]); });
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
      if (triples.length && triples.some(t => new Set(t).size <= cs.size && [...new Set(t)].every(p => cs.has(p)))) return 'adjacent';
      return null;
    };
    const weights = [], kept = [];
    for (const combo of combinations(pySort(inPlay), k)) {
      const why = reason(combo);
      if (why) { res.ruledOut[why] += 1; continue; }
      kept.push(combo); weights.push(combo.reduce((a, p) => a + score[p], 0));
    }
    const actual = pySort(inPlay.filter(p => known && p in known && known[p][2] <= n));
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
    const out = {}, lastGroups = [], bfDone = new Set(), snaps = [];
    let ballots = [], rt = 0;
    const known = {};
    const add = (p, v, label, n, key) => { if (!(p in score)) return; v = +(v || 0); score[p] += v; log[p].push({n, label, v, key}); };
    const tl = traitorTimeline(g.episodes);
    [...g.episodes].sort((a, b) => a.n - b.n).forEach(e => {
      const n = e.n;
      (e.traitors || []).forEach(p => { if (!(p in known)) known[p] = {marked: n, from: n, kind: 'original'}; });
      (e.recruits || []).forEach(p => {
        const tm = (e.recruitTiming || {})[p] || 'after';
        if (!(p in known)) known[p] = {marked: n, from: tm === 'before' ? n : n + 1, kind: 'recruited'};
      });
      (e.murdered || []).forEach(p => { if (!(p in out)) out[p] = {n, how: 'murdered', role: 'Faithful'}; });
      const bf = Object.entries(e.breakfast || {}).filter(([p, gn]) => (parseInt(gn, 10) || 0) > 0 && !(p in out)).map(([p, gn]) => [p, parseInt(gn, 10)]);
      if (bf.length) { const mx = Math.max(...bf.map(x => x[1])); lastGroups.push({n, members: bf.filter(x => x[1] === mx).map(x => x[0])}); }
      const rounds = [{votes: e.votes, revote: e.revote, moreRevotes: e.moreRevotes, banished: e.banished, role: e.role}]
        .concat((e.extraRounds || []).map(r => Object.assign({}, r)));
      rounds.forEach(rd => {
        const fb = Object.entries(rd.votes || {}).filter(([v, t]) => t && !(v in out));
        const res = revoteBallots(rd);
        let rv = []; res.forEach(([, m]) => Object.entries(m).forEach(([v, t]) => { if (t && !(v in out)) rv.push([v, t]); }));
        if (!rv.length) rv = null;
        const lastRv = res.length ? Object.entries(res[res.length - 1][1]).filter(([v, t]) => t && !(v in out)) : [];
        if (fb.length) {
          rt += 1;
          const earlier = ballots.slice();
          ballots = ballots.concat(fb.map(([v, t]) => ({n, rt, voter: v, target: t})));
          if (rv) ballots = ballots.concat(rv.map(([v, t]) => ({n, rt, voter: v, target: t, re: true})));
          if (rt <= 3) {
            const c = {}; fb.forEach(([, t]) => { c[t] = (c[t] || 0) + 1; });
            fb.forEach(([v, t]) => { if (c[t] === 1) add(v, pts.burn, `Early burn vote on ${name[t] || '?'}`, n, 'burn'); });
          }
          const T = rd.banished;
          if (T && rd.role === 'Traitor') {
            const tn = name[T] || '?', dec = lastRv.length ? lastRv : fb;
            dec.forEach(([v, t]) => {
              if (v === T) return;
              if (t === T) {
                const before = earlier.some(b => b.voter === v && b.target === T);
                if (before) add(v, pts.again, `Piled on ${tn} (had voted for them before)`, n, 'again');
                else add(v, pts.first, `Piled on ${tn} (first time)`, n, 'first');
              } else add(v, pts.stayed, `Stayed out of the pile-on on ${tn}`, n, 'stayed');
            });
            const present = new Set(fb.map(x => x[0]).concat(dec.map(x => x[0]))); present.delete(T);
            let frm = parseInt(e.recruitedEp || 0, 10) || 0;
            if (!frm && T in known && known[T].kind === 'recruited') frm = known[T].from;
            const tv = new Set(earlier.filter(b => b.voter === T && b.n >= frm).map(b => b.target));
            pySort([...present]).forEach(p => { if (tv.has(p)) add(p, pts.named, `${tn} had voted for them before`, n, 'named'); });
            if (extras.revenge) {
              const tb = dec.find(x => x[0] === T);
              if (tb) { const p = tb[1], pv = dec.find(x => x[0] === p); if (pv && pv[1] === T) add(p, pts.revenge, `${tn} voted for them on the way out`, n, 'revenge'); }
            }
            const seats = e.seats || [];
            if (extras.seating && seats.length > 2 && seats.includes(T)) {
              const i = seats.indexOf(T), L = seats.length;
              [...new Set([seats[(i - 1 + L) % L], seats[(i + 1) % L]])].forEach(p => { if (p !== T && !(p in out)) add(p, pts.seating, `Sat next to ${tn}`, n, 'seating'); });
            }
            if (extras.breakfast) lastGroups.forEach(lg => {
              if (lg.members.includes(T)) lg.members.forEach(p => {
                const key = T + '|' + p;
                if (p !== T && !bfDone.has(key) && !(p in out)) { bfDone.add(key); add(p, pts.breakfast, `Last to breakfast with ${tn} (episode ${lg.n})`, n, 'breakfast'); }
              });
            });
          }
        }
        if (rd.banished && !(rd.banished in out)) out[rd.banished] = {n, how: 'banished', role: rd.role || ''};
      });
      (e.left || []).forEach(p => { if (!(p in out)) out[p] = {n, how: 'left', role: (e.leftRoles || {})[p] || ''}; });
      const inPlay = P.map(p => p.id).filter(id => !(id in out));
      const rank = {}; inPlay.forEach(i => { rank[i] = 1 + inPlay.filter(o => score[o] > score[i] + 1e-9).length; });
      Object.entries(out).forEach(([p, o]) => { if (!o.role && p in known) o.role = 'Traitor'; });
      const tr = inPlay.filter(p => p in known), fa = inPlay.filter(p => !(p in known));
      let auc = null;
      if (tr.length && fa.length && Object.keys(known).length) {
        let s = 0; tr.forEach(t => fa.forEach(f => { s += (score[t] > score[f] + 1e-9 ? 1 : 0) + .5 * (Math.abs(score[t] - score[f]) <= 1e-9 ? 1 : 0); }));
        auc = s / (tr.length * fa.length);
      }
      const poss = possibleGroups(g, n, inPlay, score, out, tl);
      const sc = {}; Object.keys(score).forEach(k => { sc[k] = pyRound(score[k], 4); });
      snaps.push({n, score: sc, rank, groups: poss, traitors: tr, accuracy: auc, inPlay, out: JSON.parse(JSON.stringify(out)), rt});
    });
    return {snaps, log, out, rt, known, rules: g.rules};
  }

  function scoreGame(db, gid, setKey) {
    const g = loadGame(db, gid);
    const key = setKeys(g).includes(setKey) ? setKey : g.pointSet;
    const R = compute(g, pointsFor(g, key));
    R.set = key; R.sets = setKeys(g).map(k => ({key: k, label: setLabel(g, k)}));
    return R;
  }

  root.LedgerCore = {SETS, EXTRA, listGames, loadGame, compute, scoreGame, pointsFor, setKeys, setLabel};
  if (typeof module !== 'undefined') module.exports = root.LedgerCore;
})(typeof window !== 'undefined' ? window : globalThis);
