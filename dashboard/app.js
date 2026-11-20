/* Token Radar dashboard — reads window.RADAR (data.js), no network, no framework. */
(function () {
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:2rem">No data loaded.</p>'; return; }

  var state = { tab: 'pre', search: '', category: '', chain: '', tvlMin: 0, sortKey: 'rank', sortDir: 1, detail: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function usd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + s + '</span>';
  }
  function ageText(days) { return days === null ? 'unknown' : days + 'd'; }
  function chainShort(chains) {
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3) + ' more';
  }

  /* The model, re-derived here in the page from the raw snapshot figures. */
  function rederive(r) {
    var g = 1 + clamp(r.change_7d === null ? 0 : r.change_7d, -40, 100) / 100 * 0.8;
    var c = 1 + 0.03 * Math.min(r.chains.length, 10);
    var cat = 0.85 + 0.30 * Math.sqrt(r.tvl_usd / r.model.category_tvl_usd);
    var age = r.age_days === null ? 365 : r.age_days;
    var m = 0.55 + 0.45 * Math.log(1 + Math.min(age, 1460)) / Math.log(1461);
    return Math.max(1, Math.round(r.tvl_usd * 0.20 * g * c * cat * m));
  }

  /* ---- header badges ---- */
  $('badge-asof').textContent = 'DefiLlama · as_of ' + R.as_of;
  $('badge-count').textContent = R.rows.length + ' pre-token rows · ' + R.live.length + ' live';

  /* ---- top 10 strip ---- */
  $('top10').innerHTML = R.rows.slice(0, 10).map(function (r) {
    return '<div class="top-card" data-slug="' + esc(r.slug) + '">' +
      '<div class="rank">#' + r.rank + '</div>' +
      '<div class="name">' + esc(r.name) + '</div>' +
      '<div class="val">' + usd(r.implied_value_usd) + '</div>' +
      '<div class="sub">TVL ' + usd(r.tvl_usd) + ' · ' + esc(r.category || 'uncategorised') + '</div></div>';
  }).join('');

  /* ---- filters ---- */
  var cats = [], chains = [];
  R.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('f-category').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('f-chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function setTab(tab) {
    state.tab = tab;
    $('tab-pre').classList.toggle('active', tab === 'pre');
    $('tab-live').classList.toggle('active', tab === 'live');
    document.querySelectorAll('input[name="tab"]').forEach(function (el) { el.checked = el.value === tab; });
    state.sortKey = 'rank'; state.sortDir = 1;
    render();
  }
  $('tab-pre').addEventListener('click', function () { setTab('pre'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });
  document.querySelectorAll('input[name="tab"]').forEach(function (el) {
    el.addEventListener('change', function () { setTab(el.value); });
  });
  $('f-search').addEventListener('input', function (e) { state.search = e.target.value.trim().toLowerCase(); render(); });
  $('f-category').addEventListener('change', function (e) { state.category = e.target.value; render(); });
  $('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  $('f-tvl').addEventListener('input', function (e) {
    state.tvlMin = Number(e.target.value) * 1e6;
    $('f-tvl-label').textContent = '$' + e.target.value + 'M';
    render();
  });
  $('f-reset').addEventListener('click', function () {
    state.search = ''; state.category = ''; state.chain = ''; state.tvlMin = 0;
    $('f-search').value = ''; $('f-category').value = ''; $('f-chain').value = '';
    $('f-tvl').value = '0'; $('f-tvl-label').textContent = '$0';
    setTab('pre');
  });

  /* ---- table ---- */
  var PRE_COLS = [
    { key: 'rank', label: 'Rank' }, { key: 'name', label: 'Protocol' },
    { key: 'tvl_usd', label: 'TVL' }, { key: 'change_7d', label: '7d' },
    { key: 'implied_value_usd', label: 'Implied value' }, { key: 'age_days', label: 'Age' },
  ];
  var LIVE_COLS = [
    { key: 'rank', label: 'Rank' }, { key: 'name', label: 'Protocol' },
    { key: 'tvl_usd', label: 'TVL' }, { key: 'mcap_usd', label: 'Market cap' },
    { key: 'symbol', label: 'Token' },
  ];

  function filtered() {
    var list = state.tab === 'pre' ? R.rows : R.live;
    return list.filter(function (r) {
      if (state.search && r.name.toLowerCase().indexOf(state.search) < 0) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.tvlMin) return false;
      return true;
    });
  }
  function sorted(list) {
    var k = state.sortKey, d = state.sortDir;
    return list.slice().sort(function (a, b) {
      var av = a[k], bv = b[k];
      if (av === null) av = -Infinity; if (bv === null) bv = -Infinity;
      if (typeof av === 'string') return d * av.localeCompare(bv);
      return d * (av - bv);
    });
  }

  function renderHead() {
    var cols = state.tab === 'pre' ? PRE_COLS : LIVE_COLS;
    $('board-head').innerHTML = cols.map(function (c) {
      var arrow = state.sortKey === c.key ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '';
      return '<th data-key="' + c.key + '">' + c.label + arrow + '</th>';
    }).join('');
    document.querySelectorAll('#board-head th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (state.sortKey === k) state.sortDir = -state.sortDir;
        else { state.sortKey = k; state.sortDir = 1; }
        render();
      });
    });
  }

  function renderBody(list) {
    if (state.tab === 'pre') {
      $('board-body').innerHTML = list.map(function (r) {
        return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
          '<td>' + r.rank + '</td>' +
          '<td class="name">' + esc(r.name) + (r.on_watchlist ? '<span class="watch">WATCHLIST</span>' : '') +
          '<span class="cat">' + esc(r.category || 'uncategorised') + ' · ' + esc(chainShort(r.chains)) + '</span></td>' +
          '<td>' + usd(r.tvl_usd) + '</td>' +
          '<td>' + pct(r.change_7d) + '</td>' +
          '<td><b>' + usd(r.implied_value_usd) + '</b></td>' +
          '<td>' + ageText(r.age_days) + '</td></tr>';
      }).join('');
    } else {
      $('board-body').innerHTML = list.map(function (r) {
        return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
          '<td>' + r.rank + '</td>' +
          '<td class="name">' + esc(r.name) +
          '<span class="cat">' + esc(r.category || 'uncategorised') + ' · ' + esc(chainShort(r.chains)) + '</span></td>' +
          '<td>' + usd(r.tvl_usd) + '</td>' +
          '<td><b>' + usd(r.mcap_usd) + '</b></td>' +
          '<td>' + esc(r.symbol || '—') + '</td></tr>';
      }).join('');
    }
    document.querySelectorAll('#board-body tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  function render() {
    var list = sorted(filtered());
    renderHead();
    renderBody(list);
    $('board-note').textContent = state.tab === 'pre'
      ? 'Pre-token board — every row records no token in the snapshot. Sorted by ' + state.sortKey + '. Click a row for its detail and farm plan.'
      : 'Live-token market — market caps are the market\u2019s own values. Implied values are never shown for protocols whose token already trades.';
    $('filter-count').textContent = 'Showing ' + list.length + ' of ' + (state.tab === 'pre' ? R.rows.length : R.live.length) + ' rows.';
  }

  /* ---- detail ---- */
  function openDetail(slug) {
    state.detail = slug;
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) r = R.rows[i];
    if (!r) { for (var j = 0; j < R.live.length; j++) if (R.live[j].slug === slug) r = R.live[j]; }
    if (!r) return;
    render();
    var el = $('detail');
    if (r.mcap_usd !== undefined && r.implied_value_usd === undefined) {
      el.innerHTML = '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="sym">live token</span></h2>' +
        '<p>This protocol already trades a token, so the radar shows its market cap, not an implied value: <b>' + usd(r.mcap_usd) + '</b> (' + esc(r.symbol || 'no ticker in snapshot') + '). TVL ' + usd(r.tvl_usd) + ', ' + esc(r.category || 'uncategorised') + ', chains: ' + esc(r.chains.join(', ')) + '.</p>';
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    var again = rederive(r);
    var match = again === r.implied_value_usd;
    var m = r.model;
    var steps = r.farm_steps.map(function (s) {
      return '<li>' + esc(s).replace(/Cost:/g, '<b>Cost:</b>').replace(/Time:/g, '<b>Time:</b>') + '</li>';
    }).join('');
    el.innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.on_watchlist ? ' <span class="watch">WATCHLIST</span>' : '') + ' <span class="sym">' + esc(r.category || 'uncategorised') + '</span></h2>' +
      '<div class="stat-grid">' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + usd(r.tvl_usd) + '</div></div>' +
      '<div class="stat"><div class="k">7-day change</div><div class="v">' + pct(r.change_7d) + '</div></div>' +
      '<div class="stat"><div class="k">Implied value</div><div class="v">' + usd(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="k">Age</div><div class="v">' + ageText(r.age_days) + '</div></div>' +
      '<div class="stat"><div class="k">Chains (' + r.chains.length + ')</div><div class="v" style="font-size:14px">' + esc(chainShort(r.chains)) + '</div></div>' +
      '<div class="stat"><div class="k">Capital tier</div><div class="v">$' + r.capital_tier_usd + '</div></div>' +
      '<div class="stat"><div class="k">Gas / tx (est.)</div><div class="v">$' + r.gas_usd.toFixed(2) + '</div></div>' +
      '<div class="stat"><div class="k">Hold window</div><div class="v">' + r.hold_days + ' days</div></div>' +
      '</div>' +
      '<h3>Model breakdown — radar-3</h3>' +
      '<table class="factor-table"><thead><tr><th>Factor</th><th>Formula</th><th>Value</th></tr></thead><tbody>' +
      '<tr><td>Base</td><td>TVL × 0.20</td><td class="num">' + usdFull(m.base_usd) + '</td></tr>' +
      '<tr><td>Growth</td><td>1 + clamp(' + (r.change_7d === null ? 'unknown → 0' : r.change_7d + '%') + ', −40, +100) / 100 × 0.8</td><td class="num">' + m.growth_factor.toFixed(4) + '</td></tr>' +
      '<tr><td>Chain</td><td>1 + 0.03 × min(' + r.chains.length + ' chains, 10)</td><td class="num">' + m.chain_factor.toFixed(4) + '</td></tr>' +
      '<tr><td>Category</td><td>0.85 + 0.30 × √(' + usd(r.tvl_usd) + ' / ' + usd(m.category_tvl_usd) + ' category TVL)</td><td class="num">' + m.category_factor.toFixed(4) + '</td></tr>' +
      '<tr><td>Maturity</td><td>0.55 + 0.45 × ln(1 + min(' + (r.age_days === null ? 'unknown → 365' : r.age_days) + 'd, 1460)) / ln(1461)</td><td class="num">' + m.maturity_factor.toFixed(4) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>base × growth × chain × category × maturity</td><td class="num">' + usdFull(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p>Re-derived in this page from the raw figures: <b>' + usdFull(again) + '</b> — ' +
      (match ? '<span class="derive-ok">matches the board value.</span>' : '<span class="derive-bad">does not match the board value.</span>') + '</p>' +
      '<h3>Why it ranks #' + r.rank + '</h3>' +
      '<p class="why">' + esc(r.why_rank) + '</p>' +
      '<h3 id="farm-plan">Farm plan — 8 steps, capital tier $' + r.capital_tier_usd + '</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="fineprint">Costs and times are estimates. The snapshot carries no points or airdrop data — no program is claimed here.</p>';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.querySelectorAll('.top-card').forEach(function (card) {
    card.addEventListener('click', function () { openDetail(card.getAttribute('data-slug')); });
  });

  /* ---- gas table ---- */
  $('gas-table').querySelector('tbody').innerHTML = R.gas_table.map(function (g) {
    return '<tr><td>' + esc(g.chain) + '</td><td>$' + g.usd.toFixed(2) + '</td></tr>';
  }).join('');

  /* ---- deep links: #detail=<slug> #filter=<category> #tab=live ---- */
  var hash = location.hash.slice(1);
  var params = {};
  hash.split('&').forEach(function (part) {
    var kv = part.split('=');
    if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
  });
  if (params.tab === 'live') setTab('live');
  if (params.filter) { state.category = params.filter; $('f-category').value = params.filter; }
  render();
  if (params.detail) openDetail(params.detail);
})();
