/* assets/js/broker.js
   Renders per-broker tabs with monthly P&L filter
*/

const BrokerTab = (() => {

  // Month filter state per broker
  const _monthFilter = {};

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _fmtContract(t) {
    if (!t) return '—';
    if (t.asset_type === 'STK')
      return `${t.quantity > 0 ? '+' : ''}${t.quantity} @ $${t.avg_price}`;
    const c = (t.contract || '').trim();
    if (c.startsWith('P ') || c.startsWith('C ')) return c;
    if (c.includes('/OPT/')) {
      const parts = c.split(/\s+/).filter(Boolean);
      const code  = (parts[1] || '').split('/')[0];
      if (code.length >= 8) {
        const type   = code[6];
        const strike = (parseInt(code.slice(7)) / 1000).toFixed(0);
        return `${type} ${strike}`;
      }
    }
    return c.slice(0, 28) || '—';
  }

  function _dte(t) {
    if (!t.expiry || !t.date) return null;
    const d = Math.ceil((new Date(t.expiry) - new Date(t.date)) / 864e5);
    return isNaN(d) ? null : d;
  }

  function _wl(pnl) {
    if (pnl > 0) return '<span class="tag t-win">WIN</span>';
    if (pnl < 0) return '<span class="tag t-loss">LOSS</span>';
    return '<span class="tag" style="background:rgba(139,148,158,0.15);color:var(--text-muted)">OPEN</span>';
  }

  function _tradeRow(t) {
    const C   = Components;
    const pnl = parseFloat(t.realized_pnl) || 0;
    const dte = _dte(t);
    return `<tr>
      <td>${C.fmtDate(t.date)}</td>
      <td>${C.strategyTag(t.strategy)}</td>
      <td><b>${t.symbol}</b></td>
      <td style="font-size:10px;color:var(--text-muted)">${_fmtContract(t)}</td>
      <td class="num">${dte !== null && dte >= 0 ? dte + 'd' : '—'}</td>
      <td class="num">${C.pnlSpan(pnl)}</td>
      <td>${_wl(pnl)}</td>
    </tr>`;
  }

  // ── Month filter ──────────────────────────────────────────────────────────

  function _getMonths(trades) {
    const months = new Set(trades.map(t => t.date.slice(0, 7)));
    return [...months].sort().reverse(); // most recent first
  }

  function setMonth(broker, month) {
    _monthFilter[broker] = month;
    render(broker);
  }

  function _renderMonthFilter(broker, trades, allTrades) {
    const months  = _getMonths(allTrades);
    const current = _monthFilter[broker] || 'all';

    const pills = [{ key: 'all', label: 'All' },
      ...months.map(m => {
        const [y, mo] = m.split('-');
        const label = new Date(parseInt(y), parseInt(mo)-1).toLocaleString('en',{month:'short',year:'2-digit'});
        return { key: m, label };
      })
    ].map(({ key, label }) =>
      `<button class="filter-btn${current === key ? ' active' : ''}"
        onclick="BrokerTab.setMonth('${broker}','${key}')">${label}</button>`
    ).join('');

    // Monthly stats for selected month
    const filtered = current === 'all' ? trades : trades.filter(t => t.date.startsWith(current));
    const closed   = filtered.filter(t => parseFloat(t.realized_pnl) !== 0);
    const pnl      = closed.reduce((a,t) => a+(parseFloat(t.realized_pnl)||0), 0);
    const wins     = closed.filter(t => parseFloat(t.realized_pnl) > 0).length;
    const wr       = closed.length ? Math.round(wins/closed.length*100) : 0;
    const C        = Components;

    return `
      <div class="section">
        <div class="sec-hdr"><div class="sec-title">📅 Monthly P&L</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
          ${pills}
        </div>
        ${current !== 'all' ? `
        <div class="grid-3" style="margin-bottom:var(--sp-md)">
          ${C.summaryCard(
            current === 'all' ? 'All Time' : new Date(current+'-01').toLocaleString('en',{month:'long',year:'numeric'}),
            C.fmtPnl(pnl, true), C.pnlClass(pnl), closed.length + ' closed trades'
          )}
          ${C.summaryCard('Win Rate', wr+'%', wr>=70?'pos':'neu', wins+' wins / '+closed.length+' trades')}
          ${C.summaryCard('Avg P&L', C.fmtPnl(closed.length?pnl/closed.length:0, true),
            C.pnlClass(pnl/closed.length||0), 'Per closed trade')}
        </div>` : ''}
      </div>`;
  }

  // ── Main render ───────────────────────────────────────────────────────────

  function render(broker) {
    const el          = document.getElementById(`pane-${broker}`);
    const allTrades   = DataStore.getTradesByBroker(broker);
    const positions   = DataStore.getPositionsByBroker(broker);
    const stats       = DataStore.getStatsByBroker(broker);
    const activeBrokers = DataStore.getMeta().brokers || [];
    const isActive    = activeBrokers.includes(broker);
    const cfg         = KAIROS_CONFIG.BROKERS[broker] || {};
    const C           = Components;

    if (!isActive && allTrades.length === 0) {
      el.innerHTML = `<div class="content"><div class="empty" style="margin-top:var(--sp-xl)">
        <span class="empty-icon">${cfg.icon || '●'}</span>
        ${cfg.label || broker} is not connected yet.<br>
        <span class="muted" style="font-size:10px">Add credentials to .env and run sync.</span>
      </div></div>`;
      return;
    }

    // Apply month filter to trades display (only closing trades)
    const current       = _monthFilter[broker] || 'all';
    const closedTrades  = allTrades.filter(t =>
      t.asset_type === 'STK' || parseFloat(t.realized_pnl) !== 0
    );
    const filteredTrades = current === 'all'
      ? closedTrades
      : closedTrades.filter(t => t.date.startsWith(current));

    const totalPnl    = stats.reduce((a,s)=>a+(parseFloat(s.total_pnl)||0),0);
    const totalTrades = stats.reduce((a,s)=>a+(parseInt(s.total_trades)||0),0);
    const upnl        = positions.reduce((a,p)=>a+(parseFloat(p.unrealized_pnl)||0),0);
    const account     = DataStore.getAccounts().find(a=>a.broker===broker);
    const netVal      = account ? parseFloat(account.net_value||0) : 0;

    // Strategy stats
    const statsRows = stats.length
      ? stats.map(C.statsRow).join('')
      : C.emptyRow(5, 'No strategy data yet');

    // Open positions
    const posRows = positions.length
      ? positions.map(p => `<tr>
          <td>${C.strategyTag(p.strategy)}</td>
          <td><b>${p.symbol}</b></td>
          <td>${p.expiry||'—'} ${C.dteTag(p.expiry)}</td>
          <td style="font-size:10px">${(p.strikes||'—').replace(/  /g,'<br>')}</td>
          <td class="num">${p.entry_credit>0?'$'+parseFloat(p.entry_credit).toFixed(2):'—'}</td>
          <td class="num pos">${p.max_profit>0?'$'+parseFloat(p.max_profit).toFixed(2):'—'}</td>
          <td class="num neg">${p.max_loss>0?'-$'+parseFloat(p.max_loss).toFixed(2):'—'}</td>
          <td class="num">${C.pnlSpan(p.unrealized_pnl)}</td>
        </tr>`).join('')
      : C.emptyRow(8, 'No open positions');

    // Trades for current month filter
    const sorted = [...filteredTrades]
      .sort((a,b) => b.date.localeCompare(a.date))
      .slice(0, 100);
    const tradeRows = sorted.length
      ? sorted.map(_tradeRow).join('')
      : C.emptyRow(7, 'No trades for this period');

    el.innerHTML = `
      <div class="content">

        <!-- Summary -->
        <div class="grid-3 mb-md" style="margin-top:var(--sp-md)">
          ${C.summaryCard('Realized P&L', C.fmtPnl(totalPnl,true), C.pnlClass(totalPnl), totalTrades+' trades (all time)')}
          ${C.summaryCard('Open Positions', positions.length, 'neu', 'uPnL: '+C.fmtPnl(upnl,true), C.pnlClass(upnl))}
          ${C.summaryCard('Net Value', netVal>0?'$'+netVal.toLocaleString():'—', 'neu', account?.currency||'USD')}
        </div>

        <!-- Monthly filter -->
        ${_renderMonthFilter(broker, closedTrades, closedTrades)}

        <!-- Strategy performance -->
        <div class="section">
          <div class="sec-hdr"><div class="sec-title">Strategy Performance</div></div>
          <div class="panel"><div class="tsc"><table class="tbl">
            <thead><tr>
              <th>Strategy</th><th class="num">Trades</th>
              <th class="num">Win %</th><th class="num">Total P&L</th><th class="num">Avg P&L</th>
            </tr></thead>
            <tbody>${statsRows}</tbody>
          </table></div></div>
        </div>

        <!-- Open positions -->
        <div class="section">
          <div class="sec-hdr">
            <div class="sec-title">📂 Open Positions</div>
            <div class="sec-badge">${positions.length}</div>
          </div>
          <div class="panel"><div class="tsc"><table class="tbl">
            <thead><tr>
              <th>Strategy</th><th>Symbol</th><th>Expiry / DTE</th>
              <th>Strikes</th>
              <th class="num">Credit</th><th class="num">Max P</th>
              <th class="num">Max L</th><th class="num">uPnL</th>
            </tr></thead>
            <tbody>${posRows}</tbody>
          </table></div></div>
        </div>

        <!-- Trades -->
        <div class="section">
          <div class="sec-hdr">
            <div class="sec-title">📋 Trades
              ${current !== 'all' ? `<span class="muted" style="font-weight:400;font-size:11px">
                — ${new Date(current+'-01').toLocaleString('en',{month:'long',year:'numeric'})}
              </span>` : ''}
            </div>
            <div class="sec-badge">${filteredTrades.length} trades</div>
          </div>
          <div class="panel"><div class="tsc"><table class="tbl">
            <thead><tr>
              <th>Date</th><th>Strategy</th><th>Symbol</th>
              <th>Contract</th><th class="num">DTE</th>
              <th class="num">P&L</th><th>W/L</th>
            </tr></thead>
            <tbody>${tradeRows}</tbody>
          </table></div></div>
        </div>

      </div>`;
  }

  return { render, setMonth };

})();
