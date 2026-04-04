/* assets/js/charts.js
   All Chart.js chart renderers
*/

const Charts = (() => {

  const _instances = {};

  function _defaults() {
    Chart.defaults.color         = getComputedStyle(document.documentElement)
                                     .getPropertyValue('--text-muted').trim();
    Chart.defaults.borderColor   = getComputedStyle(document.documentElement)
                                     .getPropertyValue('--grid-line').trim();
    Chart.defaults.font.family   = "'JetBrains Mono', monospace";
    Chart.defaults.font.size     = 9;
  }

  function destroy(id) {
    if (_instances[id]) { _instances[id].destroy(); delete _instances[id]; }
  }

  function destroyAll() {
    Object.keys(_instances).forEach(destroy);
  }

  // ── Cumulative P&L line chart ─────────────────────────────────────────────

  function renderCumulative(canvasId, rows, legendId) {
    destroy(canvasId);
    if (!rows?.length) return;
    _defaults();

    const keys   = Object.keys(rows[0]).filter(k => k !== 'date');
    const sparse = rows.map((r, i) =>
      i % Math.ceil(rows.length / 10) === 0
        ? Components.fmtDate(r.date) : '');

    const datasets = keys.map(k => {
      const [broker, ...rest] = k.split('_');
      const strategy = rest.join('_');
      const sc = KAIROS_CONFIG.STRATEGIES[strategy];
      const bc = KAIROS_CONFIG.BROKERS[broker];
      const color = sc?.color || bc?.color || '#8b949e';
      return {
        label: k,
        data:  rows.map(r => parseFloat(r[k]) || 0),
        borderColor: color, borderWidth: 1.5,
        pointRadius: 0, tension: 0.4, fill: false,
      };
    });

    // Legend
    if (legendId) {
      document.getElementById(legendId).innerHTML = datasets.map(ds =>
        `<div class="leg">
          <div class="leg-ln" style="background:${ds.borderColor}"></div>
          ${ds.label}
        </div>`).join('');
    }

    _instances[canvasId] = new Chart(
      document.getElementById(canvasId), {
        type: 'line',
        data: { labels: sparse, datasets },
        options: {
          responsive: true, animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index', intersect: false,
              callbacks: {
                label: c => ` ${c.dataset.label}: ${Components.fmtPnl(c.raw, true)}`
              }
            }
          },
          scales: {
            x: { grid: { color: 'var(--grid-line)' },
                 ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            y: { grid: { color: 'var(--grid-line)' },
                 ticks: { callback: v =>
                   v >= 1000  ? '$' + (v/1000).toFixed(0) + 'k'  :
                   v <= -1000 ? '-$' + (Math.abs(v)/1000).toFixed(0) + 'k' :
                   '$' + v
                 }
               }
          }
        }
      }
    );
  }

  // ── Daily P&L stacked bar ─────────────────────────────────────────────────

  function renderDailyBars(canvasId, rows) {
    destroy(canvasId);
    if (!rows?.length) return;
    _defaults();

    const stratKeys = Object.keys(KAIROS_CONFIG.STRATEGIES)
      .filter(s => s !== 'unknown');
    const brokers   = Object.keys(KAIROS_CONFIG.BROKERS);

    // Build per broker+strategy datasets
    const datasets = [];
    brokers.forEach(broker => {
      stratKeys.forEach(strategy => {
        const key   = `${broker}_${strategy}`;
        const color = KAIROS_CONFIG.STRATEGIES[strategy]?.color || '#8b949e';
        const data  = rows.map(r => parseFloat(r[key]) || 0);
        if (data.some(v => v !== 0)) {
          datasets.push({
            label: key,
            data, backgroundColor: color,
            stack: 's', barPercentage: 0.85,
          });
        }
      });
    });

    if (!datasets.length) return;

    const sparse = rows.map((r, i) =>
      i % Math.ceil(rows.length / 10) === 0
        ? Components.fmtDate(r.date) : '');

    _instances[canvasId] = new Chart(
      document.getElementById(canvasId), {
        type: 'bar',
        data: { labels: sparse, datasets },
        options: {
          responsive: true, animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index', intersect: false,
              callbacks: {
                label: c => c.raw !== 0
                  ? ` ${c.dataset.label}: ${Components.fmtPnl(c.raw, true)}`
                  : null,
                filter: item => item.raw !== 0,
              }
            }
          },
          scales: {
            x: { stacked: true, grid: { display: false },
                 ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            y: { stacked: true, grid: { color: 'var(--grid-line)' },
                 ticks: { callback: v =>
                   v >= 1000  ? '$' + (v/1000).toFixed(0) + 'k'  :
                   v <= -1000 ? '-$' + (Math.abs(v)/1000).toFixed(0) + 'k' : '$' + v
                 }
               }
          }
        }
      }
    );
  }

  // ── Win rate donut ────────────────────────────────────────────────────────

  function renderWinRateDonut(canvasId, winRate) {
    destroy(canvasId);
    _defaults();
    _instances[canvasId] = new Chart(
      document.getElementById(canvasId), {
        type: 'doughnut',
        data: {
          datasets: [{
            data: [winRate, 100 - winRate],
            backgroundColor: ['#66bb6a', 'rgba(48,54,61,0.4)'],
            borderWidth: 0,
          }]
        },
        options: {
          responsive: true, animation: false, cutout: '75%',
          plugins: { legend: { display: false }, tooltip: { enabled: false } }
        }
      }
    );
  }

  // Refresh chart colors when theme changes
  function refreshTheme() {
    _defaults();
    Object.values(_instances).forEach(c => c.update());
  }

  return {
    renderCumulative, renderDailyBars, renderWinRateDonut,
    destroy, destroyAll, refreshTheme,
  };

})();
