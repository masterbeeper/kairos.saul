/**
 * functions/api/history.js
 * Returns historical OHLC for a symbol — used by browser backtest
 * ?symbol=SPX&range=2y
 */

const YF_MAP = {
  SPX: '%5EGSPC', VIX: '%5EVIX', NDX: '%5ENDX',
  RUT: '%5ERUT',  SPY: 'SPY',    QQQ: 'QQQ',
};

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  };
  try {
    const url    = new URL(context.request.url);
    const sym    = (url.searchParams.get('symbol') || 'SPX').toUpperCase();
    const range  = url.searchParams.get('range')  || '2y';
    const yfSym  = YF_MAP[sym] || encodeURIComponent(sym);

    const res  = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yfSym}?interval=1d&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const data = await res.json();
    const r    = data?.chart?.result?.[0];
    if (!r) return new Response(JSON.stringify({ error: 'Not found' }), { status:404, headers:cors });

    const q     = r.indicators?.quote?.[0];
    const times = r.timestamp || [];
    const bars  = [];

    for (let i = 0; i < times.length; i++) {
      if (q?.close?.[i] != null) {
        const d = new Date(times[i] * 1000);
        bars.push({
          date: d.toISOString().slice(0, 10),
          o: q.open?.[i]  ? +q.open[i].toFixed(2)  : null,
          h: q.high?.[i]  ? +q.high[i].toFixed(2)  : null,
          l: q.low?.[i]   ? +q.low[i].toFixed(2)   : null,
          c: +q.close[i].toFixed(2),
        });
      }
    }

    return new Response(JSON.stringify({ symbol: sym, bars }), { headers: cors });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status:500, headers:cors });
  }
}
