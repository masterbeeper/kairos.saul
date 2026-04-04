/* assets/js/components.js
   Reusable HTML string builders used across all tabs
*/

const Components = (() => {

  // ── Formatters ────────────────────────────────────────────────────────────

  function fmtPnl(v, alwaysSign = false) {
    const n = parseFloat(v) || 0;
    if (!alwaysSign && n === 0) return '$0.00';
    const abs = Math.abs(n).toLocaleString('en', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    return (n >= 0 ? '+$' : '-$') + abs;
  }

  function fmtDate(d) {
    return d ? String(d).slice(0, 10) : '—';
  }

  function pnlClass(v) {
    return parseFloat(v) >= 0 ? 'pos' : 'neg';
  }

  function calcDTE(expiry, fromDate) {
    if (!expiry) return null;
    const base = fromDate ? new Date(fromDate) : new Date();
    const exp  = new Date(expiry);
    const d    = Math.ceil((exp - base) / 864e5);
    return isNaN(d) ? null : d;
  }

  // ── Tag builders ─────────────────────────────────────────────────────────

  function strategyTag(s) {
    const cfg = KAIROS_CONFIG.STRATEGIES[s] || KAIROS_CONFIG.STRATEGIES.unknown;
    return `<span class="tag ${cfg.cssClass}">${cfg.label}</span>`;
  }

  function brokerTag(b) {
    return `<span class="tag t-${b}">${b.toUpperCase()}</span>`;
  }

  function dteTag(expiry, fromDate) {
    const d = calcDTE(expiry, fromDate);
    if (d === null) return '—';
    const cls = d <= 1 ? 'dte-hot' : d <= 5 ? 'dte-warn' : 'dte-ok';
    return `<span class="dte ${cls}">${d}d</span>`;
  }

  function winLossTag(pnl) {
    return parseFloat(pnl) >= 0
      ? '<span class="tag t-win">WIN</span>'
      : '<span class="tag t-loss">LOSS</span>';
  }

  function pnlSpan(v) {
    return `<span class="${pnlClass(v)}" style="font-weight:600">${fmtPnl(v, true)}</span>`;
  }

  // ── Summary card ─────────────────────────────────────────────────────────

  function summaryCard(label, value, valueCls, sub, subCls = '') {
    return `
      <div class="scard">
        <div class="scard-label">${label}</div>
        <div class="scard-val ${valueCls}">${value}</div>
        <div class="scard-sub ${subCls}">${sub}</div>
      </div>`;
  }

  // ── Broker card ───────────────────────────────────────────────────────────

  function brokerCard(broker, pnl, trades, netValue, isActive) {
    const cfg   = KAIROS_CONFIG.BROKERS[broker] || { label: broker, color: '#8b949e', icon: '●' };
    const cls   = pnlClass(pnl);
    const dot   = isActive ? '● live' : '○ not connected';
    return `
      <div class="bcard">
        <div class="bcard-hdr">
          <div class="bcard-dot" style="background:${cfg.color}"></div>
          <div class="bcard-name">${cfg.icon} ${cfg.label}</div>
          <div class="bcard-status">${dot}</div>
        </div>
        <div class="bcard-pnl ${cls}">${fmtPnl(pnl, true)}</div>
        <div class="bcard-sub">
          ${trades} trades${netValue > 0 ? ` · $${netValue.toLocaleString()} net` : ''}
        </div>
      </div>`;
  }

  // ── Position row ─────────────────────────────────────────────────────────

  function positionRow(p) {
    const upnl = parseFloat(p.unrealized_pnl) || 0;
    const strikes = (p.strikes || '—').replace(/  /g, '<br>');
    return `<tr>
      <td>${brokerTag(p.broker)}</td>
      <td>${strategyTag(p.strategy)}</td>
      <td><b>${p.symbol}</b></td>
      <td>${p.expiry || '—'}<br>${dteTag(p.expiry)}</td>
      <td style="font-size:10px;color:var(--text-muted)">${strikes}</td>
      <td class="num">${p.entry_credit > 0 ? '$' + parseFloat(p.entry_credit).toFixed(2) : '—'}</td>
      <td class="num pos">${p.max_profit > 0 ? '$' + parseFloat(p.max_profit).toFixed(2) : '—'}</td>
      <td class="num neg">${p.max_loss > 0 ? '-$' + Math.abs(parseFloat(p.max_loss)).toFixed(2) : '—'}</td>
      <td class="num">${pnlSpan(upnl)}</td>
    </tr>`;
  }

  // ── Trade row ─────────────────────────────────────────────────────────────

  function tradeRow(t, showBroker = true) {
    const dte = calcDTE(t.expiry, t.date);
    return `<tr>
      <td>${fmtDate(t.date)}</td>
      ${showBroker ? `<td>${brokerTag(t.broker)}</td>` : ''}
      <td>${strategyTag(t.strategy)}</td>
      <td><b>${t.symbol}</b></td>
      <td style="font-size:10px;color:var(--text-muted);max-width:160px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        title="${t.contract}">${t.contract.slice(0, 22)}</td>
      <td class="num">${dte !== null ? dte : '—'}</td>
      <td class="num">${pnlSpan(t.realized_pnl)}</td>
      <td>${winLossTag(t.realized_pnl)}</td>
    </tr>`;
  }

  // ── Stats row ─────────────────────────────────────────────────────────────

  function statsRow(s) {
    return `<tr>
      <td>${strategyTag(s.strategy)}</td>
      <td class="num">${s.total_trades}</td>
      <td class="num ${s.win_rate_pct >= 70 ? 'pos' : 'neu'}">${s.win_rate_pct}%</td>
      <td class="num">${pnlSpan(s.total_pnl)}</td>
      <td class="num">${pnlSpan(s.avg_pnl)}</td>
    </tr>`;
  }

  // ── Empty row ─────────────────────────────────────────────────────────────

  function emptyRow(cols, message, icon = '📭') {
    return `<tr><td colspan="${cols}">
      <div class="empty"><span class="empty-icon">${icon}</span>${message}</div>
    </td></tr>`;
  }

  // ── Filter pills ──────────────────────────────────────────────────────────

  function filterPills(options, activeKey, onClickFn) {
    return options.map(({ key, label }) =>
      `<button class="filter-btn${activeKey === key ? ' active' : ''}"
        onclick="${onClickFn}('${key}')">${label}</button>`
    ).join('');
  }

  return {
    fmtPnl, fmtDate, pnlClass, calcDTE,
    strategyTag, brokerTag, dteTag, winLossTag, pnlSpan,
    summaryCard, brokerCard,
    positionRow, tradeRow, statsRow, emptyRow, filterPills,
  };

})();
