/* assets/js/journal.js
   Journal tab — groups option legs into positions before display
*/

const Journal = (() => {

  let _filter = {
    broker:   'all',
    strategy: 'all',
    asset:    'all',
    dateFrom: '',
    dateTo:   '',
  };

  function render() {
    _renderFilters();
    _renderTable();
  }

  function setFilter(type, value) {
    _filter[type] = value;
    _renderFilters();
    _renderTable();
  }

  function setDateFilter() {
    _filter.dateFrom = document.getElementById('j-date-from')?.value || '';
    _filter.dateTo   = document.getElementById('j-date-to')?.value   || '';
    _renderTable();
  }

  function clearFilters() {
    _filter = { broker:'all', strategy:'all', asset:'all', dateFrom:'', dateTo:'' };
    const from = document.getElementById('j-date-from');
    const to   = document.getElementById('j-date-to');
    if (from) from.value = '';
    if (to)   to.value   = '';
    _renderFilters();
    _renderTable();
  }

  // ── Group option legs into positions ──────────────────────────────────────

  function _groupLegs(trades) {
    // Tiger stores combo orders as single records with full contract string
    // Group by symbol+expiry+contract to merge open/close orders of same position
    const groups = {}, stocks = [];

    trades.forEach(t => {
      if (t.asset_type === 'OPT') {
        const k = `${t.broker}|${t.symbol}|${t.expiry}|${t.contract}`;
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
      } else {
        stocks.push(t);
      }
    });

    const positions = [];
    Object.values(groups).forEach(group => {
      const totalPnl = group.reduce((a,t) => a+(parseFloat(t.realized_pnl)||0), 0);
      const best     = group.find(t => parseFloat(t.realized_pnl) !== 0) || group[0];
      const date     = group.map(t=>t.date).sort()[0];
      positions.push({
        broker:       best.broker,
        date:         date,
        strategy:     best.strategy,
        symbol:       best.symbol,
        expiry:       best.expiry,
        asset_type:   'OPT',
        legs:         group.length,
        strikes:      best.contract || '—',
        realized_pnl: parseFloat(totalPnl.toFixed(2)),
      });
    });

    stocks.forEach(t => positions.push({
      broker: t.broker, date: t.date, strategy: t.strategy,
      symbol: t.symbol, expiry: t.expiry, asset_type: 'STK',
      legs: 1,
      strikes: `${t.quantity>0?'+':''}${t.quantity} @ $${t.avg_price}`,
      realized_pnl: parseFloat(t.realized_pnl),
    }));

    return positions.sort((a,b) => b.date.localeCompare(a.date));
  }

  // ── Render position row ───────────────────────────────────────────────────

  function _positionRow(p) {
    const C      = Components;
    const pnl    = parseFloat(p.realized_pnl);
    const isWin  = pnl > 0;
    const isOpen = pnl === 0;

    // DTE at entry
    const dte = p.expiry && p.date ? Math.ceil(
      (new Date(p.expiry) - new Date(p.date)) / 864e5
    ) : null;
    const dteStr = dte !== null && dte >= 0 ? dte + 'd' : '—';

    // W/L tag
    const wlTag = isOpen
      ? '<span class="tag" style="background:rgba(139,148,158,0.15);color:var(--text-muted)">OPEN</span>'
      : isWin
        ? '<span class="tag t-win">WIN</span>'
        : '<span class="tag t-loss">LOSS</span>';

    const strikes = (p.strikes||'—').trim();
    return `<tr>
      <td>${C.fmtDate(p.date)}</td>
      <td>${C.brokerTag(p.broker)}</td>
      <td>${C.strategyTag(p.strategy)}</td>
      <td><b>${p.symbol}</b></td>
      <td style="font-size:10px;color:var(--text-muted)">${strikes}</td>
      <td class="num">${dteStr}</td>
      <td class="num">${C.pnlSpan(pnl)}</td>
      <td>${wlTag}</td>
    </tr>`;
  }

  // ── Filter + render ───────────────────────────────────────────────────────

  function _getFiltered() {
    let trades = DataStore.getTrades();
    if (_filter.broker   !== 'all') trades = trades.filter(t => t.broker    === _filter.broker);
    if (_filter.strategy !== 'all') trades = trades.filter(t => t.strategy  === _filter.strategy);
    if (_filter.asset    !== 'all') trades = trades.filter(t => t.asset_type === _filter.asset);
    if (_filter.dateFrom)           trades = trades.filter(t => t.date >= _filter.dateFrom);
    if (_filter.dateTo)             trades = trades.filter(t => t.date <= _filter.dateTo);
    return trades;
  }

  function _renderFilters() {
    const el = document.getElementById('journal-filters');
    if (!el) return;

    const brokerOpts = [
      { key:'all', label:'All Brokers' },
      ...Object.entries(KAIROS_CONFIG.BROKERS)
        .map(([k, v]) => ({ key:k, label: v.icon + ' ' + v.label }))
    ];
    const stratOpts = [
      { key:'all', label:'All Strategies' },
      ...Object.entries(KAIROS_CONFIG.STRATEGIES)
        .filter(([k]) => k !== 'unknown')
        .map(([k, v]) => ({ key:k, label: v.label }))
    ];
    const assetOpts = [
      { key:'all', label:'All Types' },
      { key:'OPT', label:'Options' },
      { key:'STK', label:'Stocks' },
    ];

    const trades = DataStore.getTrades();
    const minDate = trades.length ? trades[0].date : '';
    const maxDate = trades.length ? trades[trades.length-1].date : '';

    el.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <span style="font-size:10px;color:var(--text-muted)">Broker:</span>
        ${Components.filterPills(brokerOpts, _filter.broker, "Journal.setFilter.bind(Journal,'broker')")}
        <span style="color:var(--border);margin:0 2px">|</span>
        <span style="font-size:10px;color:var(--text-muted)">Strategy:</span>
        ${Components.filterPills(stratOpts, _filter.strategy, "Journal.setFilter.bind(Journal,'strategy')")}
        <span style="color:var(--border);margin:0 2px">|</span>
        ${Components.filterPills(assetOpts, _filter.asset, "Journal.setFilter.bind(Journal,'asset')")}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--text-muted)">Date:</span>
        <input type="date" id="j-date-from" class="input-field"
          style="width:140px;padding:4px 8px;font-size:11px"
          value="${_filter.dateFrom}" min="${minDate}" max="${maxDate}"
          onchange="Journal.setDateFilter()"/>
        <span style="font-size:10px;color:var(--text-muted)">to</span>
        <input type="date" id="j-date-to" class="input-field"
          style="width:140px;padding:4px 8px;font-size:11px"
          value="${_filter.dateTo}" min="${minDate}" max="${maxDate}"
          onchange="Journal.setDateFilter()"/>
        <button class="btn btn-outline" style="padding:4px 10px;font-size:10px"
          onclick="Journal.clearFilters()">Clear</button>
      </div>`;
  }

  function _renderTable() {
    const filtered   = _getFiltered();
    const positions  = _groupLegs(filtered);
    const badge      = document.getElementById('journal-badge');
    const tbody      = document.getElementById('journal-body');

    if (badge) badge.textContent = positions.length + ' trade' + (positions.length !== 1 ? 's' : '');

    if (!positions.length) {
      tbody.innerHTML = Components.emptyRow(8, 'No trades match the current filter', '🔍');
      return;
    }

    // Summary row
    const totalPnl = positions.reduce((a, p) => a + p.realized_pnl, 0);
    const closed   = positions.filter(p => p.realized_pnl !== 0);
    const wins     = closed.filter(p => p.realized_pnl > 0).length;
    const wr       = closed.length ? Math.round(wins / closed.length * 100) : 0;

    const summary = `<tr style="background:var(--panel2);font-size:10px">
      <td colspan="5" style="padding:6px 10px;color:var(--text-muted)">
        ${positions.length} positions · ${closed.length} closed · Win rate: ${wr}%
      </td>
      <td></td>
      <td class="num" style="padding:6px 10px">
        <span class="${Components.pnlClass(totalPnl)}" style="font-weight:600">
          ${Components.fmtPnl(totalPnl, true)}
        </span>
      </td>
      <td></td>
    </tr>`;

    tbody.innerHTML = summary + positions.map(_positionRow).join('');
  }

  return { render, setFilter, setDateFilter, clearFilters };

})();
