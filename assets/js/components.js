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
    return '<span class="tag ' + cfg.cssClass + '">' + cfg.label + '</span>';
  }

  function brokerTag(b) {
    return '<span class="tag t-' + b + '">' + b.toUpperCase() + '</span>';
  }

  function dteTag(expiry, fromDate) {
    const d = calcDTE(expiry, fromDate);
    if (d === null) return '—';
    const cls = d <= 1 ? 'dte-hot' : d <= 5 ? 'dte-warn' : 'dte-ok';
    return '<span class="dte ' + cls + '">' + d + 'd</span>';
  }

  function winLossTag(pnl) {
    return parseFloat(pnl) >= 0
      ? '<span class="tag t-win">WIN</span>'
      : '<span class="tag t-loss">LOSS</span>';
  }

  function pnlSpan(v) {
    return '<span class="' + pnlClass(v) + '" style="font-weight:600">' + fmtPnl(v, true) + '</span>';
  }

  // ── Summary card ─────────────────────────────────────────────────────────

  function summaryCard(label, value, valueCls, sub, subCls) {
    subCls = subCls || '';
    return [
      '<div class="scard">',
      '  <div class="scard-label">' + label + '</div>',
      '  <div class="scard-val ' + valueCls + '">' + value + '</div>',
      '  <div class="scard-sub ' + subCls + '">' + sub + '</div>',
      '</div>',
    ].join('\n');
  }

  // ── Broker card ───────────────────────────────────────────────────────────

  function brokerCard(broker, pnl, trades, netValue, isActive) {
    const cfg  = KAIROS_CONFIG.BROKERS[broker] || { label: broker, color: '#8b949e', icon: '●' };
    const cls  = pnlClass(pnl);
    const dot  = isActive ? '● live' : '○ not connected';
    const net  = netValue > 0 ? ' · $' + netValue.toLocaleString() + ' net' : '';
    return [
      '<div class="bcard">',
      '  <div class="bcard-hdr">',
      '    <div class="bcard-dot" style="background:' + cfg.color + '"></div>',
      '    <div class="bcard-name">' + cfg.icon + ' ' + cfg.label + '</div>',
      '    <div class="bcard-status">' + dot + '</div>',
      '  </div>',
      '  <div class="bcard-pnl ' + cls + '">' + fmtPnl(pnl, true) + '</div>',
      '  <div class="bcard-sub">' + trades + ' trades' + net + '</div>',
      '</div>',
    ].join('\n');
  }

  // ── Risk badge for open positions ─────────────────────────────────────────
  // Shows how much of max loss has been consumed, with colour-coded status.

  function _riskBadge(upnl, maxLoss) {
    const loss = Math.max(0, -(parseFloat(upnl) || 0));
    const maxL = Math.abs(parseFloat(maxLoss) || 0);

    if (maxL === 0) return '<span style="font-size:10px;color:var(--text-muted)">—</span>';

    const pctUsed = (loss / maxL) * 100;
    var label, bg, color;

    if (pctUsed >= 90) {
      label = 'CRITICAL'; bg = 'rgba(239,83,80,0.18)'; color = '#ef5350';
    } else if (pctUsed >= 60) {
      label = 'DANGER';   bg = 'rgba(239,83,80,0.10)'; color = '#ef5350';
    } else if (pctUsed >= 30) {
      label = 'WARNING';  bg = 'rgba(255,179,0,0.12)'; color = '#ffb300';
    } else {
      label = 'SAFE';     bg = 'rgba(102,187,106,0.12)'; color = '#66bb6a';
    }

    return [
      '<div style="display:flex;flex-direction:column;align-items:center;gap:3px">',
      '  <span style="display:inline-block;padding:2px 7px;border-radius:4px;',
      '    font-size:9px;font-weight:700;letter-spacing:.05em;',
      '    background:' + bg + ';color:' + color + '">' + label + '</span>',
      '  <span style="font-size:10px;color:' + color + ';font-weight:600">' + pctUsed.toFixed(0) + '%</span>',
      '</div>',
    ].join('\n');
  }

  // ── Position row ─────────────────────────────────────────────────────────

  function positionRow(p) {
    const upnl    = parseFloat(p.unrealized_pnl) || 0;
    const maxLoss = parseFloat(p.max_loss) || 0;
    const maxProf = parseFloat(p.max_profit) || 0;
    const credit  = parseFloat(p.entry_credit) || 0;
    const strikes = (p.strikes || '—').replace(/  /g, '<br>');

    var creditCell  = credit  > 0 ? '$' + credit.toFixed(2)  : '—';
    var maxProfCell = maxProf > 0 ? '$' + maxProf.toFixed(2) : '—';
    var maxLossCell = maxLoss > 0 ? '-$' + maxLoss.toFixed(2) : '—';

    return [
      '<tr>',
      '  <td>' + brokerTag(p.broker) + '</td>',
      '  <td>' + strategyTag(p.strategy) + '</td>',
      '  <td><b>' + p.symbol + '</b></td>',
      '  <td>' + (p.expiry || '—') + '<br>' + dteTag(p.expiry) + '</td>',
      '  <td style="font-size:10px;color:var(--text-muted)">' + strikes + '</td>',
      '  <td class="num">' + creditCell + '</td>',
      '  <td class="num pos">' + maxProfCell + '</td>',
      '  <td class="num neg">' + maxLossCell + '</td>',
      '  <td class="num">' + pnlSpan(upnl) + '</td>',
      '  <td style="text-align:center">' + _riskBadge(upnl, maxLoss) + '</td>',
      '</tr>',
    ].join('\n');
  }

  // ── Trade row ─────────────────────────────────────────────────────────────

  function tradeRow(t, showBroker) {
    showBroker = showBroker !== false;
    const dte = calcDTE(t.expiry, t.date);
    const brokerCell = showBroker ? '<td>' + brokerTag(t.broker) + '</td>' : '';
    return [
      '<tr>',
      '  <td>' + fmtDate(t.date) + '</td>',
      brokerCell,
      '  <td>' + strategyTag(t.strategy) + '</td>',
      '  <td><b>' + t.symbol + '</b></td>',
      '  <td style="font-size:10px;color:var(--text-muted);max-width:160px;',
      '    overflow:hidden;text-overflow:ellipsis;white-space:nowrap"',
      '    title="' + t.contract + '">' + t.contract.slice(0, 22) + '</td>',
      '  <td class="num">' + (dte !== null ? dte : '—') + '</td>',
      '  <td class="num">' + pnlSpan(t.realized_pnl) + '</td>',
      '  <td>' + winLossTag(t.realized_pnl) + '</td>',
      '</tr>',
    ].join('\n');
  }

  // ── Stats row ─────────────────────────────────────────────────────────────

  function statsRow(s) {
    return [
      '<tr>',
      '  <td>' + strategyTag(s.strategy) + '</td>',
      '  <td class="num">' + s.total_trades + '</td>',
      '  <td class="num ' + (s.win_rate_pct >= 70 ? 'pos' : 'neu') + '">' + s.win_rate_pct + '%</td>',
      '  <td class="num">' + pnlSpan(s.total_pnl) + '</td>',
      '  <td class="num">' + pnlSpan(s.avg_pnl) + '</td>',
      '</tr>',
    ].join('\n');
  }

  // ── Empty row ─────────────────────────────────────────────────────────────

  function emptyRow(cols, message, icon) {
    icon = icon || '📭';
    return '<tr><td colspan="' + cols + '">' +
      '<div class="empty"><span class="empty-icon">' + icon + '</span>' + message + '</div>' +
      '</td></tr>';
  }

  // ── Filter pills ──────────────────────────────────────────────────────────

  function filterPills(options, activeKey, onClickFn) {
    return options.map(function(o) {
      var active = activeKey === o.key ? ' active' : '';
      return '<button class="filter-btn' + active + '" onclick="' + onClickFn + '(\'' + o.key + '\')">' + o.label + '</button>';
    }).join('');
  }

  return {
    fmtPnl, fmtDate, pnlClass, calcDTE,
    strategyTag, brokerTag, dteTag, winLossTag, pnlSpan,
    summaryCard, brokerCard,
    positionRow, tradeRow, statsRow, emptyRow, filterPills,
  };

})();
