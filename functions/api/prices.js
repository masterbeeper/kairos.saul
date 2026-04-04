/**
 * functions/api/prices.js
 * =======================
 * Server-side market data + technical indicators
 * Returns everything needed for professional SPX options analysis
 */

const YF      = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchQuote(symbol) {
  try {
    const res  = await fetch(`${YF}${symbol}?interval=1d&range=1d`, { headers: HEADERS });
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = parseFloat((meta.regularMarketPrice || meta.previousClose).toFixed(2));
    const prev  = parseFloat((meta.chartPreviousClose || meta.previousClose).toFixed(2));
    return {
      price,
      change:    parseFloat((price - prev).toFixed(2)),
      changePct: parseFloat(((price - prev) / (prev||1) * 100).toFixed(2)),
    };
  } catch { return null; }
}

async function fetchOHLC(symbol, range = '3mo') {
  try {
    const res  = await fetch(`${YF}${symbol}?interval=1d&range=${range}`, { headers: HEADERS });
    const data = await res.json();
    const r    = data?.chart?.result?.[0];
    if (!r) return null;
    const q     = r.indicators?.quote?.[0];
    const times = r.timestamp || [];
    const opens = q?.open   || [];
    const highs = q?.high   || [];
    const lows  = q?.low    || [];
    const close = q?.close  || [];
    const bars  = [];
    for (let i = 0; i < times.length; i++) {
      if (close[i] != null) {
        bars.push({ t: times[i], o: opens[i], h: highs[i], l: lows[i], c: close[i] });
      }
    }
    return bars;
  } catch { return null; }
}

// ── Technical indicators ──────────────────────────────────────────────────────

function calcATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i-1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Wilder EMA
  let atr = trs.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period-1) + trs[i]) / period;
  }
  return parseFloat(atr.toFixed(2));
}

function calcRSI(bars, period = 14) {
  if (!bars || bars.length < period + 2) return null;
  const closes = bars.map(b => b.c);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    avgGain = (avgGain * (period-1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period-1) + (d < 0 ? -d : 0)) / period;
  }
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return parseFloat((100 - 100/(1+rs)).toFixed(1));
}

function calcStoch(bars, kPeriod = 14, dPeriod = 3) {
  if (!bars || bars.length < kPeriod + dPeriod) return null;
  const kValues = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    const slice  = bars.slice(i - kPeriod + 1, i + 1);
    const hi     = Math.max(...slice.map(b => b.h));
    const lo     = Math.min(...slice.map(b => b.l));
    const k      = hi === lo ? 50 : (bars[i].c - lo) / (hi - lo) * 100;
    kValues.push(k);
  }
  const d = kValues.slice(-dPeriod).reduce((a,b)=>a+b,0) / dPeriod;
  return {
    k: parseFloat(kValues[kValues.length-1].toFixed(1)),
    d: parseFloat(d.toFixed(1)),
  };
}

function calcBB(bars, period = 20, mult = 2) {
  if (!bars || bars.length < period) return null;
  const closes = bars.slice(-period).map(b => b.c);
  const sma    = closes.reduce((a,b)=>a+b,0) / period;
  const std    = Math.sqrt(closes.reduce((a,b)=>a+(b-sma)**2,0)/period);
  const upper  = sma + mult * std;
  const lower  = sma - mult * std;
  const last   = closes[closes.length-1];
  const pctB   = std === 0 ? 50 : (last - lower) / (upper - lower) * 100;
  return {
    upper: parseFloat(upper.toFixed(2)),
    lower: parseFloat(lower.toFixed(2)),
    sma:   parseFloat(sma.toFixed(2)),
    width: parseFloat(((upper-lower)/sma*100).toFixed(2)),
    pctB:  parseFloat(pctB.toFixed(1)),
  };
}

function calcZScore(bars, period = 20) {
  if (!bars || bars.length < period) return null;
  const closes = bars.slice(-period).map(b => b.c);
  const mean   = closes.reduce((a,b)=>a+b,0) / period;
  const std    = Math.sqrt(closes.reduce((a,b)=>a+(b-mean)**2,0)/period);
  const last   = closes[closes.length-1];
  return std === 0 ? 0 : parseFloat(((last - mean)/std).toFixed(2));
}

function calcIVR(vixBars, currentVix) {
  if (!vixBars || vixBars.length < 20) return null;
  const closes = vixBars.map(b => b.c);
  const hi52   = Math.max(...closes);
  const lo52   = Math.min(...closes);
  if (hi52 === lo52) return 50;
  return Math.round((currentVix - lo52) / (hi52 - lo52) * 100);
}

function calc200DMA(spxBars, currentSpx) {
  if (!spxBars || spxBars.length < 200) return null;
  const last200 = spxBars.slice(-200).map(b => b.c);
  const dma     = last200.reduce((a,b)=>a+b,0) / last200.length;
  return {
    dma200:       parseFloat(dma.toFixed(2)),
    trendBullish: currentSpx > dma,
    pctFromDMA:   parseFloat(((currentSpx - dma)/dma*100).toFixed(2)),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function onRequest() {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };

  try {
    // Parallel fetches
    const [spxQ, vixQ, vix9dQ, vix3mQ, vvixQ, spxBars, vixBars] = await Promise.all([
      fetchQuote('%5EGSPC'),
      fetchQuote('%5EVIX'),
      fetchQuote('%5EVIX9D'),
      fetchQuote('%5EVIX3M'),
      fetchQuote('%5EVVIX'),
      fetchOHLC('%5EGSPC', '1y'),
      fetchOHLC('%5EVIX',  '1y'),
    ]);

    if (!spxQ || !vixQ) {
      return new Response(JSON.stringify({ error: 'Failed to fetch SPX/VIX' }), { status: 500, headers: cors });
    }

    const S = spxQ.price;
    const V = vixQ.price;

    // Technical indicators from SPX bars
    const atr    = calcATR(spxBars, 14);
    const rsi    = calcRSI(spxBars, 14);
    const stoch  = calcStoch(spxBars, 14, 3);
    const bb     = calcBB(spxBars, 20, 2);
    const zScore = calcZScore(spxBars, 20);
    const trend  = calc200DMA(spxBars, S);
    const ivr    = calcIVR(vixBars, V);

    // VIX term structure
    let termStructure = null;
    if (vix9dQ && vix3mQ) {
      const v9 = vix9dQ.price, v = V, v3 = vix3mQ.price;
      if      (v9 < v && v < v3)  termStructure = 'contango';
      else if (v9 > v)             termStructure = 'backwardation';
      else                         termStructure = 'flat';
    }

    // Skew proxy (VIX/VIX3M ratio)
    let skewLabel = null;
    if (vix3mQ) {
      const ratio = V / vix3mQ.price;
      if      (ratio > 1.05) skewLabel = 'heavy';
      else if (ratio > 0.95) skewLabel = 'normal';
      else                   skewLabel = 'light';
    }

    return new Response(JSON.stringify({
      // Quotes
      spx: spxQ, vix: vixQ, vix9d: vix9dQ, vix3m: vix3mQ, vvix: vvixQ,
      // Trend
      dma200:       trend?.dma200        ?? null,
      trendBullish: trend?.trendBullish  ?? null,
      pctFromDMA:   trend?.pctFromDMA    ?? null,
      // Vol
      ivr, termStructure, skewLabel,
      // Technicals
      atr, rsi, stoch, bb, zScore,
      ts: new Date().toISOString(),
    }), { headers: cors });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
