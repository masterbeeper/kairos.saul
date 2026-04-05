/* assets/js/spx.js
   Professional SPX Options Engine
   ─────────────────────────────────────────────────────────────────
   Inspired by: Sovereign Architect SPX Options Engine
   Method: ATR-based strikes + 6-factor confluence scoring
   Signals: SELL BPS / SELL BCS / SELL IC / WATCH / STAY CASH
*/

const SPX = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  const _d = {
    spx: null, vix: null, vix9d: null, vix3m: null, vvix: null,
    ivr: null, dma200: null, trendBullish: null, pctFromDMA: null,
    termStructure: null, skewLabel: null,
    atr: null, rsi: null, stoch: null, bb: null, zScore: null,
    lastFetch: null, fetchErr: null,
    account: 50000, riskPct: 2,
    dte: 7, atrMult: 1.5, width: 30,
    geoRisk: false,  // manual override for geopolitical VIX spikes
  };
  let _timer = null;
  const REFRESH_MS = 5 * 60 * 1000;

  // ── Black-Scholes (for PoP + premium estimate) ─────────────────────────────
  function _normCDF(x) {
    const a = [0.319381530,-0.356563782,1.781477937,-1.821255978,1.330274429];
    const k = 1/(1+0.2316419*Math.abs(x));
    let p   = k*(a[0]+k*(a[1]+k*(a[2]+k*(a[3]+k*a[4]))));
    p = 1 - (1/Math.sqrt(2*Math.PI))*Math.exp(-0.5*x*x)*p;
    return x >= 0 ? p : 1-p;
  }

  function _bsPrice(S, K, T, r, sigma, type) {
    if (T <= 0) T = 0.001;
    const d1  = (Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
    const d2  = d1 - sigma*Math.sqrt(T);
    if (type === 'C') return Math.max(0, S*_normCDF(d1)  - K*Math.exp(-r*T)*_normCDF(d2));
    return                  Math.max(0, K*Math.exp(-r*T)*_normCDF(-d2) - S*_normCDF(-d1));
  }

  function _bsDelta(S, K, T, r, sigma, type) {
    if (T <= 0) T = 0.001;
    const d1 = (Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
    return type === 'C' ? _normCDF(d1) : _normCDF(d1) - 1;
  }

  function _pop(S, K, T, sigma, type) {
    // PoP = probability short strike expires OTM
    if (T <= 0) T = 0.001;
    const d2 = (Math.log(S/K)+(0.045-0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
    return type === 'P' ? _normCDF(d2) : _normCDF(-d2);
  }

  // ── VIX Regime ─────────────────────────────────────────────────────────────
  function _vixRegime(vix) {
    if (!vix) return { label: '—', color: 'var(--text-muted)', bear: false };
    if (vix >= 35) return { label: 'EXTREME FEAR',   color: '#ef5350', bear: true  };
    if (vix >= 30) return { label: 'HIGH VOL (BEAR PANIC)', color: '#ef5350', bear: true  };
    if (vix >= 25) return { label: 'ELEVATED VOL',   color: '#ffb300', bear: true  };
    if (vix >= 18) return { label: 'NORMAL',         color: '#66bb6a', bear: false };
    return               { label: 'LOW VOL',         color: '#26a69a', bear: false };
  }

  // ── ATR-based strikes ──────────────────────────────────────────────────────
  function _atrStrikes(type) {
    // Use VIX-based expected move so strikes scale properly with DTE:
    //   dist = SPX × (VIX/100) × sqrt(DTE/365) × sigmaMult
    //   sigmaMult 1.5 ≈ Δ0.10 (7-45DTE)
    //   sigmaMult 2.0 ≈ Δ0.05 (0-1DTE)
    const S    = _d.spx?.price;
    const vix  = (_d.vix?.price || 20) / 100;
    const baseMult = _d.atrMult;
    const mult = _geoRiskActive() ? Math.max(baseMult, 2.5) : baseMult;
    const w    = _d.width;
    const dte  = _d.dte;
    if (!S || !vix) return null;

    const sigma = Math.sqrt(Math.max(dte, 0.5) / 365);
    const dist  = Math.round(S * vix * sigma * mult / 5) * 5;

    if (type === 'BPS') {
      const shortPut = Math.round((S - dist) / 5) * 5;
      const longPut  = shortPut - w;
      return { short: shortPut, long: longPut, dist, dte, w };
    } else if (type === 'BCS') {
      const shortCall = Math.round((S + dist) / 5) * 5;
      const longCall  = shortCall + w;
      return { short: shortCall, long: longCall, dist, dte, w };
    }
    return null;
  }

  function _strikeMetrics(strikes, type) {
    const S     = _d.spx?.price;
    const sigma = (_d.vix?.price || 20) / 100;
    const T     = Math.max(_d.dte, 0.5) / 365;
    const r     = 0.045;
    if (!S || !strikes) return null;

    const shortP = _bsPrice(S, strikes.short, T, r, sigma, type==='BPS'?'P':'C');
    const longP  = _bsPrice(S, strikes.long,  T, r, sigma, type==='BPS'?'P':'C');
    const credit = Math.max(0, shortP - longP);
    const maxL   = strikes.w * 100 - credit * 100;
    const pop    = _pop(S, strikes.short, T, sigma, type==='BPS'?'P':'C');
    const delta  = Math.abs(_bsDelta(S, strikes.short, T, r, sigma, type==='BPS'?'P':'C'));
    const ev     = credit * 100 * pop - maxL * (1-pop);

    const geoAdj   = _geoRiskActive() ? 0.5 : 1.0;
    const maxRisk  = _d.account * _d.riskPct / 100 * geoAdj;
    const contracts= Math.max(1, Math.floor(maxRisk / maxL));

    return {
      credit: parseFloat(credit.toFixed(2)),
      maxLoss: parseFloat(maxL.toFixed(2)),
      pop: parseFloat((pop*100).toFixed(1)),
      delta: parseFloat(delta.toFixed(3)),
      ev: parseFloat(ev.toFixed(2)),
      rr: maxL > 0 ? parseFloat((credit*100/maxL).toFixed(2)) : 0,
      contracts,
      totalPremium: parseFloat((credit*100*contracts).toFixed(2)),
      totalRisk:    parseFloat((maxL*contracts).toFixed(2)),
    };
  }

  // ── Confluence scoring (0-6) ───────────────────────────────────────────────
  function _geoRiskActive() {
    return document.getElementById('geo-risk-toggle')?.checked || _d.geoRisk;
  }

  function _confluenceScore(direction) {
    // direction: 'BULL' (for BPS) or 'BEAR' (for BCS)
    const factors = [];
    let score = 0;

    // 1. IVR — need elevated premium to sell
    const ivrOk = _d.ivr !== null && _d.ivr >= 30;
    factors.push({
      name: 'IV Rank',
      val:  _d.ivr !== null ? `${_d.ivr}%` : '—',
      ok:   ivrOk,
      note: ivrOk ? 'Premium elevated' : 'Low premium — avoid selling',
    });
    if (ivrOk) score += 1;

    // 2. VIX regime — not in extreme panic for short DTE
    const dte    = parseInt(document.getElementById('inp-dte')?.value) || _d.dte;
    const vix    = _d.vix?.price || 0;
    const vixOk  = dte >= 7 ? vix < 35 : vix < 25;
    factors.push({
      name: 'VIX Regime',
      val:  vix.toFixed(1),
      ok:   vixOk,
      note: vixOk ? 'Manageable volatility' : 'Too volatile for this DTE',
    });
    if (vixOk) score += 1;

    // 3. Trend — BPS needs bull, BCS needs bear or neutral
    const trendOk = direction === 'BULL'
      ? _d.trendBullish === true
      : _d.trendBullish === false || _d.trendBullish === null;
    factors.push({
      name: 'Trend (200DMA)',
      val:  _d.trendBullish === true ? 'Bullish' : _d.trendBullish === false ? 'Bearish' : '—',
      ok:   trendOk,
      note: trendOk
        ? (direction==='BULL' ? 'Above 200DMA ✅' : 'Below 200DMA ✅')
        : (direction==='BULL' ? 'Bearish — BPS risky' : 'Bullish — BCS risky'),
    });
    if (trendOk) score += 1;

    // 4. RSI — BPS wants oversold (RSI < 35), BCS wants overbought (RSI > 65)
    const rsi    = _d.rsi;
    const rsiOk  = rsi !== null && (direction === 'BULL' ? rsi < 40 : rsi > 60);
    factors.push({
      name: 'RSI(14)',
      val:  rsi !== null ? rsi.toString() : '—',
      ok:   rsiOk,
      note: rsi === null ? 'No data' : rsiOk
        ? (direction==='BULL' ? 'Oversold — bounce potential' : 'Overbought — fade potential')
        : (direction==='BULL' ? 'Not oversold yet' : 'Not overbought yet'),
    });
    if (rsiOk) score += 1;

    // 5. Stochastic — BPS wants K < 25, BCS wants K > 75
    const stochK = _d.stoch?.k;
    const stochOk= stochK !== undefined && (direction === 'BULL' ? stochK < 25 : stochK > 75);
    factors.push({
      name: 'Stoch K/D',
      val:  _d.stoch ? `${_d.stoch.k} / ${_d.stoch.d}` : '—',
      ok:   stochOk,
      note: stochOk
        ? (direction==='BULL' ? 'Oversold zone' : 'Overbought zone')
        : (direction==='BULL' ? 'Not in oversold zone' : 'Not in overbought zone'),
    });
    if (stochOk) score += 1;

    // 6. BB %B — BPS wants %B < 20 (near lower band), BCS wants %B > 80
    const pctB   = _d.bb?.pctB;
    const bbOk   = pctB !== undefined && (direction === 'BULL' ? pctB < 30 : pctB > 70);
    factors.push({
      name: 'BB %B',
      val:  pctB !== undefined ? `${pctB}%` : '—',
      ok:   bbOk,
      note: bbOk
        ? (direction==='BULL' ? 'Near lower band' : 'Near upper band')
        : (direction==='BULL' ? 'Not at lower band' : 'Not at upper band'),
    });
    if (bbOk) score += 1;

    // Signal
    let signal, signalColor;
    if (score >= 4) {
      signal      = `SELL ${direction === 'BULL' ? 'BPS' : 'BCS'} [VALID]`;
      signalColor = 'var(--pos)';
    } else if (score >= 2) {
      signal      = `${direction === 'BULL' ? 'BPS' : 'BCS'} [WATCH]`;
      signalColor = '#ffb300';
    } else {
      signal      = `${direction === 'BULL' ? 'BPS' : 'BCS'} [SKIP]`;
      signalColor = 'var(--neg)';
    }

    return { score, factors, signal, signalColor, valid: score >= 4 };
  }

  // ── Z-Score label ──────────────────────────────────────────────────────────
  function _zScoreLabel(z) {
    if (z === null) return '—';
    if (z < -2)  return 'Extreme Low';
    if (z < -1)  return 'In Range (Low)';
    if (z >  2)  return 'Extreme High';
    if (z >  1)  return 'In Range (High)';
    return 'Neutral';
  }

  // ── Expected move ──────────────────────────────────────────────────────────
  function _em(dte) {
    if (!_d.spx || !_d.vix) return null;
    return Math.round(_d.spx.price * (_d.vix.price/100) * Math.sqrt(Math.max(dte,0.5)/365));
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────
  async function fetchPrices() {
    const el = document.getElementById('spx-status');
    if (el) { el.textContent = '⟳ Fetching…'; el.className = 'fetch-status'; }
    try {
      const res  = await fetch('/api/prices?t=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      Object.assign(_d, {
        spx: data.spx, vix: data.vix, vix9d: data.vix9d,
        vix3m: data.vix3m, vvix: data.vvix,
        ivr: data.ivr, dma200: data.dma200,
        trendBullish: data.trendBullish, pctFromDMA: data.pctFromDMA,
        termStructure: data.termStructure, skewLabel: data.skewLabel,
        atr: data.atr, rsi: data.rsi, stoch: data.stoch,
        bb: data.bb, zScore: data.zScore,
        lastFetch: new Date(), fetchErr: null,
      });

      const t = _d.lastFetch.toLocaleTimeString();
      if (el) { el.textContent = `✓ Updated ${t} (15-min delay)`; el.className = 'fetch-status ok'; }

      // Expose live data + scores to AI module
      if (typeof AI !== 'undefined') {
        const bullScore = _confluenceScore('BULL');
        const bearScore = _confluenceScore('BEAR');
        AI.setSpxData(_d, { bull: bullScore, bear: bearScore });
        // Also expose current strike state for trade plan generation
        window._kairosSpxState = {
          dte:     _d.dte,
          strikes: `BPS ${_atrStrikes('BPS')?.short}/${_atrStrikes('BPS')?.long} · BCS ${_atrStrikes('BCS')?.short}/${_atrStrikes('BCS')?.long}`,
          metrics: _strikeMetrics(_atrStrikes('BPS'), 'BPS'),
        };
      }

      _renderAll();
    } catch(e) {
      _d.fetchErr = e.message;
      if (el) { el.textContent = `⚠ ${e.message}`; el.className = 'fetch-status err'; }
      _renderAll();
    }
  }

  // ── Render all ─────────────────────────────────────────────────────────────
  function _renderAll() {
    _renderPriceCards();
    _renderRegime();
    _renderEngine();
  }

  // ── Price cards ────────────────────────────────────────────────────────────
  function _renderPriceCards() {
    const el = document.getElementById('spx-prices');
    if (!el) return;
    const cards = [
      { label: 'S&P 500', data: _d.spx },
      { label: 'VIX',     data: _d.vix },
      { label: 'VIX9D',   data: _d.vix9d,  sub: '9-day' },
      { label: 'VIX3M',   data: _d.vix3m,  sub: '3-Month' },
      { label: 'VVIX',    data: _d.vvix,   sub: 'Vol of Vol' },
      { label: 'ATR(14)', data: _d.atr ? { price: _d.atr } : null, sub: 'Daily range' },
    ];
    el.innerHTML = cards.map(c => {
      if (!c.data) return `<div class="price-card skeleton"></div>`;
      const p   = c.data.price;
      const chg = c.data.change;
      const pct = c.data.changePct;
      const cls = chg > 0 ? 'pos' : chg < 0 ? 'neg' : '';
      return `<div class="price-card">
        <div class="pc-label">${c.label}</div>
        <div class="pc-price ${cls}">${typeof p==='number'&&p>100?p.toLocaleString():p?.toFixed(2)}</div>
        ${chg !== undefined ? `<div class="pc-change ${cls}">${chg>0?'+':''}${chg} (${pct>0?'+':''}${pct}%)</div>` : ''}
        ${c.sub ? `<div class="pc-sub">${c.sub}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ── Regime panel ───────────────────────────────────────────────────────────
  function _renderRegime() {
    const el = document.getElementById('spx-regime');
    if (!el) return;
    const geoRisk = document.getElementById('geo-risk-toggle')?.checked || _d.geoRisk;
    const vixReg = _vixRegime(_d.vix?.price, geoRisk);
    const dte    = parseInt(document.getElementById('inp-dte')?.value) || _d.dte;

    const rows = [
      { label: 'Price / ATR(14)', val: `${_d.spx?.price?.toLocaleString() || '—'}`, right: `ATR: ${_d.atr?.toFixed(2)||'—'}` },
      { label: 'VIX Core Regime', val: vixReg.label, color: vixReg.color, right: `VIX: ${_d.vix?.price?.toFixed(2)||'—'}` },
      { label: 'IV Rank (Proxy)', val: _d.ivr !== null ? `${_d.ivr}%` : '—',
        color: _d.ivr>=50?'var(--pos)':_d.ivr>=30?'#ffb300':'var(--neg)',
        right: _d.ivr>=50?'Elevated Premium':_d.ivr>=30?'Moderate':'Low Premium' },
      { label: 'Trend Bias',
        val: _d.trendBullish === true ? 'BULLISH >EMA200' : _d.trendBullish === false ? 'BEARISH <EMA200' : '—',
        color: _d.trendBullish ? 'var(--pos)' : _d.trendBullish === false ? 'var(--neg)' : 'var(--text-muted)',
        right: _d.pctFromDMA !== null ? `${_d.pctFromDMA>0?'+':''}${_d.pctFromDMA}% from DMA` : '' },
      { label: '── MOMENTUM ──', header: true },
      { label: 'RSI(14)',   val: _d.rsi?.toString()||'—',
        color: _d.rsi<30?'var(--neg)':_d.rsi>70?'var(--pos)':'var(--text-secondary)',
        right: _d.rsi<30?'Oversold':_d.rsi>70?'Overbought':'Neutral' },
      { label: 'Z-Score(20)', val: _d.zScore?.toString()||'—',
        color: Math.abs(_d.zScore||0)>2?'var(--neg)':'var(--text-secondary)',
        right: _zScoreLabel(_d.zScore) },
      { label: 'BB %B',     val: _d.bb ? `${_d.bb.pctB}%` : '—',
        right: _d.bb ? `BW: ${_d.bb.width}%` : '' },
      { label: 'Stoch K/D', val: _d.stoch ? `${_d.stoch.k} / ${_d.stoch.d}` : '—',
        color: _d.stoch?.k < 25 ? 'var(--neg)' : _d.stoch?.k > 75 ? 'var(--pos)' : 'var(--text-secondary)',
        right: _d.stoch?.k < 25 ? 'OS' : _d.stoch?.k > 75 ? 'OB' : '' },
      { label: 'VWAP Dev',  val: '—', right: 'Intraday only' },
      { label: '── STRUCTURE ──', header: true },
      { label: 'Term Structure',
        val: { contango:'Contango ✅', backwardation:'Backwardation ⚠️', flat:'Flat ➡️' }[_d.termStructure] || '—',
        color: _d.termStructure==='contango'?'var(--pos)':_d.termStructure==='backwardation'?'var(--neg)':'var(--text-muted)' },
      { label: 'Put Skew',
        val: _d.skewLabel==='heavy'?'PUT HEAVY':_d.skewLabel==='light'?'Call Heavy':'Normal',
        color: _d.skewLabel==='heavy'?'var(--neg)':_d.skewLabel==='light'?'var(--pos)':'var(--text-secondary)' },
      { label: '── EXPECTED MOVE ──', header: true },
      { label: `${dte}DTE (1σ)`, val: _em(dte)?`±${_em(dte)} pts`:'—',
        right: _em(dte)&&_d.spx?`${(_d.spx.price-_em(dte)).toFixed(0)} / ${(_d.spx.price+_em(dte)).toFixed(0)}`:''},
    ];

    el.innerHTML = rows.map(r => {
      if (r.header) return `<div class="regime-header">${r.label}</div>`;
      return `<div class="regime-row">
        <span class="regime-lbl">${r.label}</span>
        <span class="regime-val" style="color:${r.color||'var(--text-primary)'}">${r.val}</span>
        ${r.right ? `<span class="regime-right">${r.right}</span>` : ''}
      </div>`;
    }).join('');
  }

  // ── Options Engine ─────────────────────────────────────────────────────────
  function _renderEngine() {
    const el = document.getElementById('spx-engine');
    if (!el) return;
    if (!_d.spx || !_d.vix || !_d.atr) {
      el.innerHTML = `<div class="loading-msg">Loading market data…</div>`;
      return;
    }

    const bullScore = _confluenceScore('BULL');
    const bearScore = _confluenceScore('BEAR');
    const bpsStrikes = _atrStrikes('BPS');
    const bcsStrikes = _atrStrikes('BCS');
    const bpsMetrics = _strikeMetrics(bpsStrikes, 'BPS');
    const bcsMetrics = _strikeMetrics(bcsStrikes, 'BCS');

    const icMetrics = _icMetrics(bpsStrikes, bcsStrikes, bpsMetrics, bcsMetrics);

    el.innerHTML = `
      ${_icBanner()}

      <!-- IC card (recommended based on backtest) -->
      <div style="margin-bottom:var(--sp-md)">
        ${_icCard(bpsStrikes, bcsStrikes, bullScore, bearScore, icMetrics)}
      </div>

      <!-- BPS + BCS cards -->
      <div class="engine-grid">
        ${_tradeCard('BPS', bullScore, bpsStrikes, bpsMetrics)}
        ${_tradeCard('BCS', bearScore, bcsStrikes, bcsMetrics)}
      </div>

      <!-- Confluence details -->
      <div class="confluence-grid">
        ${_confluenceTable('BULL', bullScore)}
        ${_confluenceTable('BEAR', bearScore)}
      </div>`;
  }

  function _icBanner() {
    // Backtest: IC = 86.4% WR, max loss $106 vs BPS/BCS max loss $1,000-$2,025
    const geo = _geoRiskActive();
    return `<div style="padding:10px 14px;border-radius:var(--radius);margin-bottom:var(--sp-md);
      border:1px solid rgba(38,166,154,.3);background:rgba(38,166,154,.07);
      font-size:11px;line-height:1.6;color:var(--text-secondary)">
      <span style="font-weight:600;color:var(--pos)">Backtest insight:</span>
      Iron Condor = 86.4% WR · max loss $106.
      BPS = 65.5% WR · max loss $1,270. BCS = 75.5% WR · max loss $2,025.
      ${geo ? '<br><span style="color:var(--neg);font-weight:600">Geo risk active</span> — IC only, 3.5× ATR, 50% size.' : 'Prefer IC when both sides have similar premium.'}
    </div>`;
  }

  function _icMetrics(bpsStrikes, bcsStrikes, bpsM, bcsM) {
    if (!bpsM || !bcsM) return null;
    const totalCredit = parseFloat((bpsM.credit + bcsM.credit).toFixed(2));
    const maxLoss     = Math.max(bpsStrikes.w, bcsStrikes.w) * 100 - totalCredit * 100;
    const popIC       = parseFloat(((bpsM.pop/100 + bcsM.pop/100 - 1) * 100).toFixed(1));
    const ev          = totalCredit * 100 * (popIC/100) - maxLoss * (1 - popIC/100);
    const geoAdj      = _geoRiskActive() ? 0.5 : 1.0;
    const maxRisk     = _d.account * _d.riskPct / 100 * geoAdj;
    const contracts   = Math.max(1, Math.floor(maxRisk / maxLoss));
    return {
      credit: totalCredit,
      maxLoss: parseFloat(maxLoss.toFixed(2)),
      pop: popIC,
      ev: parseFloat(ev.toFixed(2)),
      rr: parseFloat((totalCredit * 100 / maxLoss).toFixed(2)),
      contracts,
      totalPremium: parseFloat((totalCredit * 100 * contracts).toFixed(2)),
      totalRisk:    parseFloat((maxLoss * contracts).toFixed(2)),
      putStrike:  bpsStrikes.short, putLong:  bpsStrikes.long,
      callStrike: bcsStrikes.short, callLong: bcsStrikes.long,
    };
  }

  function _icCard(bpsStrikes, bcsStrikes, bpsScore, bcsScore, icM) {
    if (!icM) return `<div class="trade-card"><div class="tc-header">
      <span class="tc-type" style="color:#26a69a">IC</span>
      <span class="tc-type-desc">Iron Condor</span></div>
      <div style="font-size:12px;color:var(--text-muted);padding:16px 0">
        Loading prices…</div></div>`;

    // IC score = average of BPS bull + BCS bear scores
    const score     = Math.round((bpsScore.score + bcsScore.score) / 2);
    const barColor  = score >= 4 ? 'var(--pos)' : score >= 2 ? '#ffb300' : 'var(--neg)';
    const signal    = score >= 4 ? 'SELL IC [VALID]' : score >= 2 ? 'IC [WATCH]' : 'IC [SKIP]';
    const sigColor  = score >= 4 ? 'var(--pos)' : score >= 2 ? '#ffb300' : 'var(--neg)';
    const valid     = score >= 4;
    const geo       = _geoRiskActive();

    return `
    <div class="trade-card${valid?' trade-card-valid':''}">
      <div class="tc-header">
        <span class="tc-type" style="color:#26a69a">IC</span>
        <span class="tc-type-desc">Iron Condor</span>
        <div style="flex:1"></div>
        <span class="tc-signal" style="color:${sigColor}">${signal}</span>
        ${geo ? '<span style="font-size:10px;color:var(--neg);margin-left:8px">GEO</span>' : ''}
      </div>

      <!-- Score bar -->
      <div class="tc-score-row">
        <span style="font-size:10px;color:var(--text-muted)">CONFLUENCE</span>
        <div class="tc-score-bar">
          ${[1,2,3,4,5,6].map(i =>
            `<div class="score-dot${i<=score?' filled':''}" style="${i<=score?`background:${barColor}`:''}"></div>`
          ).join('')}
        </div>
        <span style="font-size:12px;font-weight:700;color:${barColor}">${score} / 6</span>
      </div>

      <!-- IC strikes -->
      <div class="tc-strikes" style="flex-wrap:wrap;gap:4px">
        <div class="tcs-group" style="flex:1;min-width:120px">
          <div class="tcs-role" style="color:var(--neg)">SELL PUT</div>
          <div class="tcs-strike">${icM.putStrike}</div>
          <div class="tcs-delta">/ ${icM.putLong}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;
          justify-content:center;font-size:9px;color:var(--text-muted);
          padding:0 8px;border-left:1px solid var(--border);border-right:1px solid var(--border)">
          IC<br>${_d.dte}DTE<br>${_d.width}pt
        </div>
        <div class="tcs-group" style="flex:1;min-width:120px;text-align:right">
          <div class="tcs-role" style="color:var(--pos)">SELL CALL</div>
          <div class="tcs-strike">${icM.callStrike}</div>
          <div class="tcs-delta">/ ${icM.callLong}</div>
        </div>
      </div>

      <!-- Metrics -->
      <div class="tc-metrics">
        <div class="tcm"><div class="tcm-l">Total credit</div><div class="tcm-v pos">$${icM.credit}</div></div>
        <div class="tcm"><div class="tcm-l">Max profit</div><div class="tcm-v pos">$${(icM.credit*100).toFixed(0)}</div></div>
        <div class="tcm"><div class="tcm-l">Max risk</div><div class="tcm-v neg">~$${icM.maxLoss.toFixed(0)}</div></div>
        <div class="tcm"><div class="tcm-l">PoP</div>
          <div class="tcm-v" style="color:${icM.pop>=70?'var(--pos)':icM.pop>=55?'#ffb300':'var(--neg)'}">
            ${icM.pop}%
          </div>
        </div>
        <div class="tcm"><div class="tcm-l">R/R</div><div class="tcm-v">${icM.rr}x</div></div>
        <div class="tcm"><div class="tcm-l">Exp value</div>
          <div class="tcm-v ${icM.ev>=0?'pos':'neg'}">${icM.ev>=0?'+':''}$${icM.ev.toFixed(0)}</div>
        </div>
      </div>

      <!-- Sizing -->
      <div class="tc-sizing">
        ${geo?'<span style="color:var(--neg);font-weight:600">50% size (geo risk)</span> · ':''}
        <b>${icM.contracts} contract${icM.contracts!==1?'s':''}</b>
        → Premium: <b class="pos">$${icM.totalPremium.toLocaleString()}</b>
        · Risk: <b class="neg">-$${icM.totalRisk.toLocaleString()}</b>
      </div>

      <!-- Backtest badge -->
      <div style="margin-top:8px;font-size:10px;padding:6px 8px;
        background:rgba(38,166,154,.1);border-radius:4px;color:var(--pos)">
        Backtest: IC = 86.4% WR · max loss $106 (vs BPS $1,270 / BCS $2,025)
      </div>
    </div>`;
  }

  function _tradeCard(type, scoreObj, strikes, metrics) {
    const { score, signal, signalColor, valid } = scoreObj;
    const isBPS = type === 'BPS';
    const accent = isBPS ? 'var(--neg)' : 'var(--pos)';

    // Bar fill color
    const barColor = score >= 4 ? 'var(--pos)' : score >= 2 ? '#ffb300' : 'var(--neg)';

    return `
    <div class="trade-card${valid?' trade-card-valid':''}">
      <div class="tc-header">
        <span class="tc-type" style="color:${accent}">${type}</span>
        <span class="tc-type-desc">${isBPS?'Bull Put Spread':'Bear Call Spread'}</span>
        <div style="flex:1"></div>
        <span class="tc-signal" style="color:${signalColor}">${signal}</span>
      </div>

      <!-- Confluence bar -->
      <div class="tc-score-row">
        <span style="font-size:10px;color:var(--text-muted)">CONFLUENCE</span>
        <div class="tc-score-bar">
          ${[1,2,3,4,5,6].map(i =>
            `<div class="score-dot${i<=score?' filled':''}" style="${i<=score?`background:${barColor}`:''}"></div>`
          ).join('')}
        </div>
        <span style="font-size:12px;font-weight:700;color:${barColor}">${score} / 6</span>
      </div>

      ${strikes && metrics ? `
      <!-- Strikes -->
      <div class="tc-strikes">
        <div class="tcs-group">
          <div class="tcs-role">SELL ${isBPS?'PUT':'CALL'}</div>
          <div class="tcs-strike">${strikes.short}</div>
          <div class="tcs-delta">Δ ${metrics.delta}</div>
        </div>
        <div class="tcs-sep">/ ${strikes.long}</div>
        <div style="font-size:9px;color:var(--text-muted);padding:0 8px">
          ${strikes.w}pt wide<br>${strikes.dte}DTE<br>ATR×${_d.atrMult}
        </div>
      </div>

      <!-- Metrics -->
      <div class="tc-metrics">
        <div class="tcm"><div class="tcm-l">Credit/share</div><div class="tcm-v pos">$${metrics.credit}</div></div>
        <div class="tcm"><div class="tcm-l">Max Profit</div><div class="tcm-v pos">$${(metrics.credit*100).toFixed(0)}</div></div>
        <div class="tcm"><div class="tcm-l">Max Risk</div><div class="tcm-v neg">~$${metrics.maxLoss.toFixed(0)}</div></div>
        <div class="tcm"><div class="tcm-l">PoP</div>
          <div class="tcm-v" style="color:${metrics.pop>=75?'var(--pos)':metrics.pop>=60?'#ffb300':'var(--neg)'}">
            ${metrics.pop}%
          </div>
        </div>
        <div class="tcm"><div class="tcm-l">R/R</div><div class="tcm-v">${metrics.rr}x</div></div>
        <div class="tcm"><div class="tcm-l">Exp Value</div>
          <div class="tcm-v ${metrics.ev>=0?'pos':'neg'}">${metrics.ev>=0?'+':''}$${metrics.ev.toFixed(0)}</div>
        </div>
      </div>

      <!-- Sizing -->
      <div class="tc-sizing">
        <b>${metrics.contracts} contract${metrics.contracts!==1?'s':''}</b>
        → Premium: <b class="pos">$${metrics.totalPremium.toLocaleString()}</b>
        · Risk: <b class="neg">-$${metrics.totalRisk.toLocaleString()}</b>
      </div>` : `<div class="loading-msg">Calculating…</div>`}
    </div>`;
  }

  function _confluenceTable(direction, scoreObj) {
    const { factors } = scoreObj;
    return `
    <div class="conf-table">
      <div class="conf-title">${direction === 'BULL' ? 'BPS (Bull)' : 'BCS (Bear)'} Factor Check</div>
      ${factors.map(f => `
        <div class="conf-row">
          <span class="conf-dot" style="color:${f.ok?'var(--pos)':'var(--neg)'}">
            ${f.ok ? '✓' : '✗'}
          </span>
          <span class="conf-name">${f.name}</span>
          <span class="conf-val">${f.val}</span>
          <span class="conf-note" style="color:${f.ok?'var(--pos)':'var(--text-muted)'}">${f.note}</span>
        </div>`).join('')}
    </div>`;
  }

  // ── Shell ──────────────────────────────────────────────────────────────────
  function _buildShell() {
    return `<div class="content spx-content">

      <!-- Market bar -->
      <div id="spx-mkt" class="market-bar"></div>
      <div id="spx-status" class="fetch-status" style="margin:4px 0 8px"></div>

      <!-- Price cards -->
      <div id="spx-prices" class="price-cards-grid"></div>

      <div class="spx-main-grid">

        <!-- Left: Regime -->
        <div>
          <div class="sec-hdr" style="margin-top:var(--sp-md)">
            <div class="sec-title">📊 Market Regime (Auto-Sense)</div>
          </div>
          <div class="panel" style="padding:var(--sp-sm) var(--sp-md)">
            <div id="spx-regime"></div>
          </div>

          <!-- Parameters -->
          <div class="sec-hdr" style="margin-top:var(--sp-md)">
            <div class="sec-title">⚙️ Parameters</div>
          </div>
          <div class="panel" style="padding:var(--sp-md)">
            <div class="params-grid-2">
              <div class="param-group">
                <label class="param-label">SPX PRICE</label>
                <input id="inp-spx" class="input-field" placeholder="Auto"
                  value="${_d.spx?.price||''}" oninput="SPX.recalc()"/>
              </div>
              <div class="param-group">
                <label class="param-label">VIX</label>
                <input id="inp-vix" class="input-field" placeholder="Auto"
                  value="${_d.vix?.price||''}" oninput="SPX.recalc()"/>
              </div>
              <div class="param-group">
                <label class="param-label">DTE</label>
                <input id="inp-dte" class="input-field" value="${_d.dte}"
                  oninput="SPX.recalc()"/>
              </div>
              <div class="param-group">
                <label class="param-label">SIGMA MULT</label>
                <input id="inp-atr-mult" class="input-field" value="${_d.atrMult}"
                  title="1.5 ≈ Δ0.10 (7-45DTE) · 2.0 ≈ Δ0.05 (0-1DTE)"
                  oninput="SPX.recalc()"/>
              </div>
              <div class="param-group">
                <label class="param-label">WIDTH (PTS)</label>
                <input id="inp-width" class="input-field" value="${_d.width}"
                  oninput="SPX.recalc()"/>
              </div>
              <div class="param-group">
                <label class="param-label">ACCOUNT ($)</label>
                <input id="inp-account" class="input-field" value="${_d.account}"
                  oninput="SPX.recalc()"/>
              </div>
              <div class="param-group">
                <label class="param-label">RISK %</label>
                <input id="inp-risk" class="input-field" value="${_d.riskPct}"
                  oninput="SPX.recalc()"/>
              </div>
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:6px">
              Auto-refresh every 5 min · 15-min delayed
            </div>
          </div>
        </div>

        <!-- Right: Engine -->
        <div>
          <div class="sec-hdr" style="margin-top:var(--sp-md)">
            <div class="sec-title">🎯 Strike Engine — DTE: <span id="dte-display">${_d.dte}</span></div>
          </div>
          <div id="spx-engine" class="panel" style="padding:var(--sp-md)">
            <div class="loading-msg">Loading prices…</div>
          </div>
        </div>

      </div>

      <!-- TradingView -->
      <div class="section" style="margin-top:var(--sp-lg)">
        <div class="sec-hdr"><div class="sec-title">📈 SPX Chart</div></div>
        <div class="panel" style="padding:0;overflow:hidden;border-radius:var(--radius)">
          <div id="tv-widget-container" style="height:420px"></div>
        </div>
      </div>

      <div style="text-align:center;font-size:10px;color:var(--text-muted);padding:var(--sp-lg) 0">
        ⚠️ For educational and planning purposes only. Not financial advice.
        Verify all strikes with your broker before trading.
      </div>
    </div>`;
  }

  // ── Market status ──────────────────────────────────────────────────────────
  function _renderMarketBar() {
    const el = document.getElementById('spx-mkt');
    if (!el) return;
    const now = new Date();
    const et  = new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
    const h   = et.getHours(), m = et.getMinutes(), d = et.getDay();
    const open= d>=1&&d<=5&&(h>9||(h===9&&m>=30))&&h<16;
    const ts  = et.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
    el.innerHTML = `
      <span class="mkt-dot ${open?'open':'closed'}"></span>
      Market ${open?'Open':'Closed'}
      <span style="margin-left:auto;font-size:10px;color:var(--text-muted)">${ts}</span>`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  function _loadTradingView() {
    const container = document.getElementById('tv-widget-container');
    if (!container) return;

    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

    // iframe is the only approach that reliably works when injected dynamically
    const params = new URLSearchParams({
      symbol:           'SPREADEX:SPX',
      interval:         'D',
      timezone:         'America/New_York',
      theme:            theme,
      style:            '1',
      locale:           'en',
      hide_side_toolbar:'0',
      allow_symbol_change: 'false',
      studies:          'MASimple@tv-basicstudies,RSI@tv-basicstudies',
      height:           '420',
      autosize:         '1',
    });

    const iframe = document.createElement('iframe');
    iframe.src    = `https://www.tradingview.com/widgetembed/?${params}`;
    iframe.style  = 'width:100%;height:420px;border:none;display:block';
    iframe.title  = 'SPX chart';
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');

    container.innerHTML = '';
    container.appendChild(iframe);
  }

  function render() {
    const el = document.getElementById('pane-spx');
    if (!el) return;
    el.innerHTML = _buildShell();
    _renderMarketBar();
    fetchPrices();
    // Load TradingView after shell is in DOM
    setTimeout(_loadTradingView, 100);
    if (_timer) clearInterval(_timer);
    _timer = setInterval(fetchPrices, REFRESH_MS);
  }

  function recalc() {
    // Sync all param inputs into state so _atrStrikes reads fresh values
    const dteEl  = document.getElementById('inp-dte');
    const multEl = document.getElementById('inp-atr-mult');
    const wEl    = document.getElementById('inp-width');
    const accEl  = document.getElementById('inp-account');
    const riskEl = document.getElementById('inp-risk');
    const spxEl  = document.getElementById('inp-spx');
    const vixEl  = document.getElementById('inp-vix');

    if (dteEl)  { _d.dte     = parseFloat(dteEl.value)  || _d.dte;
                  const dd = document.getElementById('dte-display');
                  if (dd) dd.textContent = dteEl.value; }
    if (multEl)  _d.atrMult  = parseFloat(multEl.value) || _d.atrMult;
    if (wEl)     _d.width    = parseFloat(wEl.value)    || _d.width;
    if (accEl)   _d.account  = parseFloat(accEl.value)  || _d.account;
    if (riskEl)  _d.riskPct  = parseFloat(riskEl.value) || _d.riskPct;
    if (spxEl && spxEl.value) _d.spx = { ..._d.spx, price: parseFloat(spxEl.value) };
    if (vixEl && vixEl.value) _d.vix = { ..._d.vix, price: parseFloat(vixEl.value) };

    _renderRegime();
    _renderEngine();
  }

  function destroy() { if (_timer) { clearInterval(_timer); _timer = null; } }
  function update()  { fetchPrices(); }

  function toggleGeoRisk(active) {
    _d.geoRisk = active;
    // Update toggle UI
    const track = document.getElementById('geo-track');
    const thumb = document.getElementById('geo-thumb');
    if (track) track.style.background = active ? '#ef5350' : 'rgba(255,255,255,.15)';
    if (thumb) thumb.style.transform  = active ? 'translateX(16px)' : 'translateX(0)';
    // Update label
    const lbl = document.getElementById('geo-risk-label');
    if (lbl) lbl.textContent = active
      ? 'ACTIVE: 3.5× ATR strikes · 50% position size · IC only'
      : 'When enabled: 3.5× ATR strikes · 50% position size · IC only';
    // Re-render
    _renderRegime();
    _renderEngine();
  }

  return { render, recalc, update, destroy, toggleGeoRisk, getState: () => _d };

})();
