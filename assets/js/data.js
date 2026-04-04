/* assets/js/data.js
   Loads and caches data.json — with error handling + validation
*/

const DataStore = (() => {

  let _cache = null;

  async function load() {
    const url = KAIROS_CONFIG.DATA_URL + '?t=' + Date.now();
    let res;
    try {
      res = await fetch(url);
    } catch(e) {
      throw new Error('Cannot reach data.json. Check your internet connection.');
    }

    if (res.status === 404) throw new Error('data.json not found. Run: python3 sync/sync.py then git push.');
    if (!res.ok) throw new Error(`Failed to load data (HTTP ${res.status})`);

    let raw;
    try {
      raw = await res.json();
    } catch(e) {
      throw new Error('data.json is corrupted. Restore from data.backup.json and re-run sync.');
    }

    // Basic validation
    if (!raw.meta || !Array.isArray(raw.trades)) {
      throw new Error('data.json has unexpected format. Re-run sync.');
    }

    _cache = raw;
    return _cache;
  }

  function get()           { return _cache; }
  function getMeta()       { return _cache?.meta            || {}; }
  function getAccounts()   { return _cache?.accounts        || []; }
  function getPositions()  { return _cache?.open_positions  || []; }
  function getDailyPnl()   { return _cache?.daily_pnl       || []; }
  function getCumulative() { return _cache?.cumulative_pnl  || []; }
  function getStats()      { return _cache?.stats           || []; }
  function getTrades()     { return _cache?.trades          || []; }

  function getTradesByBroker(broker) {
    return getTrades().filter(t => t.broker === broker);
  }
  function getPositionsByBroker(broker) {
    return getPositions().filter(p => p.broker === broker);
  }
  function getStatsByBroker(broker) {
    return getStats().filter(s => s.broker === broker);
  }

  function getTotalPnl() {
    return getStats().reduce((a, s) => a + (parseFloat(s.total_pnl) || 0), 0);
  }
  function getTotalTrades() {
    return getStats().reduce((a, s) => a + (parseInt(s.total_trades) || 0), 0);
  }
  function getOverallWinRate() {
    const total = getTotalTrades();
    if (!total) return 0;
    const wins = getStats().reduce((a, s) =>
      a + (s.win_rate_pct / 100) * (parseInt(s.total_trades) || 0), 0);
    return Math.round(wins / total * 100);
  }
  function getClosedTrades() {
    // Only trades with non-zero pnl (closing orders)
    return getTrades().filter(t => t.asset_type === 'STK' || parseFloat(t.realized_pnl) !== 0);
  }
  function getTodayPnl() {
    const today = new Date().toISOString().slice(0, 10);
    return getTrades()
      .filter(t => t.date === today)
      .reduce((a, t) => a + (parseFloat(t.realized_pnl) || 0), 0);
  }
  function getTodayTradeCount() {
    const today = new Date().toISOString().slice(0, 10);
    return getTrades().filter(t => t.date === today).length;
  }
  function getTotalUpnl() {
    return getPositions().reduce((a, p) => a + (parseFloat(p.unrealized_pnl) || 0), 0);
  }

  return {
    load, get,
    getMeta, getAccounts, getPositions, getDailyPnl,
    getCumulative, getStats, getTrades,
    getTradesByBroker, getPositionsByBroker, getStatsByBroker,
    getTotalPnl, getTotalTrades, getOverallWinRate, getClosedTrades,
    getTodayPnl, getTodayTradeCount, getTotalUpnl,
  };

})();
