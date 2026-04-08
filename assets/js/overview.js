/* assets/js/overview.js
   Overview tab — summary cards, broker cards, charts with date filter, positions
*/

const Overview = (() => {

  let _dateFrom = '';
  let _dateTo   = '';

  function render() {
    _initDates();
    renderSummaryCards();
    renderBrokerCards();
    renderDateFilter();
    renderStrategyBreakdown();
    renderBacktestSummary();
    renderCharts();
    renderPositions();
  }

  function _initDates() {
    if (_dateFrom && _dateTo) return; // already set
    const trades = DataStore.getTrades();
    const maxDate = trades.length ? trades[trades.length-1].date : new Date().toISOString().slice(0,10);
    if (!_dateTo)   _dateTo   = maxDate;
    if (!_dateFrom) _dateFrom = _daysAgo(90); // default last 90 days
  }

  function _daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0,10);
  }

  // ── Date filter ───────────────────────────────────────────────────────────

  function renderDateFilter() {
    const el = document.getElementById('ov-date-filter');
    if (!el) return;
    const trades  = DataStore.getTrades();
    const minDate = trades.length ? trades[0].date : '';
    const maxDate = trades.length ? trades[trades.length-1].date : '';
    const periods = ['7d','30d','90d','YTD','All'];

    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:var(--sp-sm)">
        <span style="font-size:10px;color:var(--text-muted)">P&L Period:</span>
        <input type="date" id="ov-from" class="input-field"
          style="width:135px;padding:4px 8px;font-size:11px"
          value="${_dateFrom}" min="${minDate}" max="${maxDate}"
          onchange="Overview.updateDateFilter()"/>
        <span style="font-size:10px;color:var(--text-muted)">to</span>
        <input type="date" id="ov-to" class="input-field"
          style="width:135px;padding:4px 8px;font-size:11px"
          value="${_dateTo}" min="${minDate}" max="${maxDate}"
          onchange="Overview.updateDateFilter()"/>
        <div style="display:flex;gap:4px">
          ${periods.map(p => `
            <button class="filter-btn${_isPeriodActive(p,minDate,maxDate)?' active':''}"
              onclick="Overview.setPeriod('${p}')">${p}</button>`
          ).join('')}
        </div>
      </div>`;
  }

  function _isPeriodActive(period, minDate, maxDate) {
    if (period === '7d')  return _dateFrom === _daysAgo(7)  && _dateTo === maxDate;
    if (period === '30d') return _dateFrom === _daysAgo(30) && _dateTo === maxDate;
    if (period === '90d') return _dateFrom === _daysAgo(90) && _dateTo === maxDate;
    if (period === 'YTD') return _dateFrom === `${new Date().getFullYear()}-01-01` && _dateTo === maxDate;
    if (period === 'All') return _dateFrom === minDate && _dateTo === maxDate;
    return false;
  }

  function setPeriod(period) {
    const trades  = DataStore.getTrades();
    const minDate = trades.length ? trades[0].date : '';
    const maxDate = trades.length ? trades[trades.length-1].date : '';
    _dateTo = maxDate;
    if (period === '7d')  _dateFrom = _daysAgo(7);
    if (period === '30d') _dateFrom = _daysAgo(30);
    if (period === '90d') _dateFrom = _daysAgo(90);
    if (period === 'YTD') _dateFrom = `${new Date().getFullYear()}-01-01`;
    if (period === 'All') _dateFrom = minDate;
    renderDateFilter();
    renderCharts();
    renderSummaryCards();
  }

  function updateDateFilter() {
    _dateFrom = document.getElementById('ov-from')?.value || '';
    _dateTo   = document.getElementById('ov-to')?.value   || '';
    renderDateFilter();
    renderCharts();
    renderSummaryCards();
  }

  // ── Filtered data ─────────────────────────────────────────────────────────

  function _filteredTrades() {
    let t = DataStore.getTrades();
    if (_dateFrom) t = t.filter(x => x.date >= _dateFrom);
    if (_dateTo)   t = t.filter(x => x.date <= _dateTo);
    return t;
  }

  function _filteredDaily() {
    let r = DataStore.getDailyPnl();
    if (_dateFrom) r = r.filter(x => x.date >= _dateFrom);
    if (_dateTo)   r = r.filter(x => x.date <= _dateTo);
    return r;
  }

  function _filteredCumulative() {
    const daily   = _filteredDaily();
    const allKeys = new Set();
    daily.forEach(r => Object.keys(r).filter(k=>k!=='date').forEach(k=>allKeys.add(k)));
    const running = {};
    return daily.map(row => {
      const cum = { date: row.date };
      allKeys.forEach(k => {
        running[k] = parseFloat(((running[k]||0)+(parseFloat(row[k])||0)).toFixed(2));
        cum[k] = running[k];
      });
      return cum;
    });
  }

  // ── Summary cards ─────────────────────────────────────────────────────────

  function renderSummaryCards() {
    const trades    = _filteredTrades();
    const totalPnl  = trades.reduce((a,t)=>a+(parseFloat(t.realized_pnl)||0),0);
    const closed    = trades.filter(t=>t.realized_pnl!==0);
    const wins      = closed.filter(t=>parseFloat(t.realized_pnl)>0).length;
    const winRate   = closed.length ? Math.round(wins/closed.length*100) : 0;
    const positions = DataStore.getPositions();
    const upnl      = DataStore.getTotalUpnl();
    const todayPnl  = DataStore.getTodayPnl();
    const todayCount= DataStore.getTodayTradeCount();
    const C         = Components;

    const rangeLabel = _dateFrom === (DataStore.getTrades()[0]?.date||'')
      ? 'All time'
      : `${_dateFrom} → ${_dateTo}`;

    document.getElementById('ov-cards').innerHTML = [
      C.summaryCard('Realized P&L', C.fmtPnl(totalPnl,true), C.pnlClass(totalPnl), rangeLabel),
      C.summaryCard('Win Rate', winRate+'%', winRate>=70?'pos':'neu', closed.length+' closed trades'),
      C.summaryCard('Open Positions', positions.length, 'neu', `uPnL: ${C.fmtPnl(upnl,true)}`, C.pnlClass(upnl)),
      C.summaryCard('Today P&L', C.fmtPnl(todayPnl,true), todayPnl===0?'neu':C.pnlClass(todayPnl), todayCount+' trade(s) today'),
    ].join('');
  }

  // ── Broker cards ──────────────────────────────────────────────────────────

  function renderBrokerCards() {
    const activeBrokers = DataStore.getMeta().brokers || [];
    const html = Object.keys(KAIROS_CONFIG.BROKERS).map(broker => {
      const stats  = DataStore.getStatsByBroker(broker);
      const acct   = DataStore.getAccounts().find(a=>a.broker===broker);
      const pnl    = stats.reduce((a,s)=>a+(parseFloat(s.total_pnl)||0),0);
      const trades = stats.reduce((a,s)=>a+(parseInt(s.total_trades)||0),0);
      const netVal = acct ? parseFloat(acct.net_value||0) : 0;
      return Components.brokerCard(broker, pnl, trades, netVal, activeBrokers.includes(broker));
    }).join('');
    document.getElementById('ov-brokers').innerHTML = html;
  }

  // ── Strategy breakdown ───────────────────────────────────────────────────

  // ── Backtest summary ─────────────────────────────────────────────────────

  async function renderBacktestSummary() {
    const el = document.getElementById('ov-backtest');
    if (!el) return;
    try {
      const res  = await fetch('backtest_results.json?t=' + Date.now());
      if (!res.ok) { el.innerHTML = ''; return; }
      const data = await res.json();
      const s    = data.summary;
      if (!s) { el.innerHTML = ''; return; }

      const vixOrder = ['VIX <15','VIX 15-20','VIX 20-25','VIX 25-30','VIX ≥30'];
      const vixRows  = vixOrder
        .filter(k => s.by_vix[k])
        .map(k => {
          const a   = s.by_vix[k];
          const wr  = a.win_rate;
          const col = wr >= 80 ? 'var(--pos)' : wr >= 65 ? '#ffb300' : 'var(--neg)';
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px">
            <span style="width:76px;color:var(--text-muted);flex-shrink:0">${k}</span>
            <div style="flex:1;height:14px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
              <div style="width:${wr}%;height:100%;background:${col};border-radius:3px"></div>
            </div>
            <span style="font-weight:600;color:${col};width:38px;text-align:right">${wr}%</span>
            <span style="color:var(--text-muted);width:36px;text-align:right">${a.count}t</span>
          </div>`;
        }).join('');

      el.innerHTML = `
        <div class="sec-hdr" style="margin-top:var(--sp-md)">
          <div class="sec-title">📊 Backtest findings</div>
          <div style="font-size:10px;color:var(--text-muted)">${data.meta.total_trades} trades · ${data.meta.date_range}</div>
        </div>
        <div class="panel" style="padding:var(--sp-md)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-md)">

            <div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Win rate by VIX level</div>
              ${vixRows}
              <div style="font-size:10px;color:var(--text-muted);margin-top:6px">Higher VIX = better outcomes when trading IC</div>
            </div>

            <div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Strategy performance</div>
              ${['iron_condor','bps','bcs'].filter(k=>s.by_strategy[k]).map(k => {
                const a   = s.by_strategy[k];
                const wr  = a.win_rate;
                const lbl = {iron_condor:'IC',bps:'BPS',bcs:'BCS'}[k];
                const col = wr>=80?'var(--pos)':wr>=65?'#ffb300':'var(--neg)';
                return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px">
                  <span style="width:36px;font-weight:600;color:var(--text-secondary)">${lbl}</span>
                  <div style="flex:1;height:14px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
                    <div style="width:${wr}%;height:100%;background:${col};border-radius:3px"></div>
                  </div>
                  <span style="font-weight:600;color:${col};width:38px;text-align:right">${wr}%</span>
                  <span style="color:var(--text-muted);font-size:10px;width:60px;text-align:right">max -$${Math.abs(a.max_loss).toFixed(0)}</span>
                </div>`;
              }).join('')}
              <div style="font-size:10px;color:var(--text-muted);margin-top:6px">IC max loss capped at $106 vs BPS/BCS $1,270+</div>
            </div>

          </div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border2);
            font-size:10px;color:var(--text-muted)">
            ⚠ Confluence score not yet predictive — IVR null on 78% of trades. Re-run backtest Dec 2026 after 12 months VIX history.
          </div>
        </div>`;
    } catch(e) {
      el.innerHTML = '';
    }
  }

  function renderStrategyBreakdown() {
    const el = document.getElementById('ov-strategy-breakdown');
    if (!el) return;

    const stats    = DataStore.getStats();
    const stratMap = {};
    stats.forEach(s => {
      const k = s.strategy;
      if (!stratMap[k]) stratMap[k] = { trades:0, wins:0, pnl:0 };
      stratMap[k].trades += parseInt(s.total_trades) || 0;
      stratMap[k].wins   += Math.round((s.win_rate_pct/100) * (parseInt(s.total_trades)||0));
      stratMap[k].pnl    += parseFloat(s.total_pnl) || 0;
    });

    const order = ['iron_condor','bps','bcs','long_stock','short_stock'];
    const LABELS = { iron_condor:'IC', bps:'BPS', bcs:'BCS',
                     long_stock:'Long', short_stock:'Short' };
    const BACKTEST = { iron_condor:'86.4%', bps:'65.5%', bcs:'75.5%' };
    const C = Components;

    el.innerHTML = order.map(k => {
      const s = stratMap[k];
      if (!s || s.trades === 0) return '';
      const wr  = s.trades ? Math.round(s.wins/s.trades*100) : 0;
      const bt  = BACKTEST[k] ? `<span style="font-size:9px;color:var(--text-muted);margin-left:4px">bt:${BACKTEST[k]}</span>` : '';
      const wrColor = wr >= 80 ? 'var(--pos)' : wr >= 65 ? '#ffb300' : 'var(--neg)';
      const barW = Math.min(wr, 100);
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:11px;font-weight:600">${LABELS[k]||k}${bt}</span>
          <span style="font-size:11px;color:${C.pnlClass(s.pnl)==='pos'?'var(--pos)':'var(--neg)'};font-weight:600">
            ${C.fmtPnl(s.pnl,true)}
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:16px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
            <div style="width:${barW}%;height:100%;background:${wrColor};border-radius:3px"></div>
          </div>
          <span style="font-size:11px;font-weight:600;color:${wrColor};width:36px;text-align:right">${wr}%</span>
          <span style="font-size:10px;color:var(--text-muted);width:40px;text-align:right">${s.trades}t</span>
        </div>
      </div>`;
    }).join('');
  }

  // ── Charts ────────────────────────────────────────────────────────────────

  function renderCharts() {
    Charts.renderCumulative('chart-cum', _filteredCumulative(), 'cum-legend');
    Charts.renderDailyBars('chart-daily', _filteredDaily());
  }

  // ── Open positions ────────────────────────────────────────────────────────

  function renderPositions() {
    const positions = DataStore.getPositions();
    const badge     = document.getElementById('ov-pos-badge');
    const tbody     = document.getElementById('ov-pos-body');

    if (badge) badge.textContent = positions.length + ' position'+(positions.length!==1?'s':'');

    if (!positions.length) {
      tbody.innerHTML = Components.emptyRow(10, 'No open positions right now', '✅');
      return;
    }
    tbody.innerHTML = positions.map(Components.positionRow).join('');
  }

  return { render, setPeriod, updateDateFilter };

})();
