/* assets/js/app.js
   Main app — init, tab routing, theme toggle, data sync, skeleton loader
*/

const App = (() => {

  let _activeTab   = 'overview';
  let _initialised = false;

  // ── Skeleton loader ───────────────────────────────────────────────────────

  function _showSkeleton() {
    const el = document.getElementById('ov-cards');
    if (!el) return;
    const skCard = `<div class="scard">
      <div class="skel" style="width:60%;height:12px;margin-bottom:8px"></div>
      <div class="skel" style="width:80%;height:24px;margin-bottom:6px"></div>
      <div class="skel" style="width:50%;height:10px"></div>
    </div>`;
    el.innerHTML = skCard.repeat(4);

    const brokers = document.getElementById('ov-brokers');
    if (brokers) brokers.innerHTML = skCard.repeat(3);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    if (_initialised) { await sync(); return; }
    _initialised = true;
    _bindTabClicks();
    _showSkeleton();
    await sync();
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  async function sync() {
    const btn     = document.getElementById('btn-sync');
    const syncMsg = document.getElementById('tb-sync');

    if (btn) btn.disabled = true;
    if (syncMsg) { syncMsg.textContent = '⟳ Syncing…'; syncMsg.className = 'tb-sync'; }

    try {
      await DataStore.load();
      const meta = DataStore.getMeta();
      const t    = meta.last_sync
        ? new Date(meta.last_sync).toLocaleString()
        : 'unknown';
      if (syncMsg) {
        syncMsg.textContent = `Synced ${t}`;
        syncMsg.className = 'tb-sync';
      }
      _renderActiveTab();
      if (typeof AutoRefresh !== 'undefined') AutoRefresh.start();
    } catch(e) {
      if (syncMsg) {
        syncMsg.textContent = `⚠ ${e.message}`;
        syncMsg.className = 'tb-sync tb-sync-err';
      }
      const ov = document.getElementById('ov-cards');
      if (ov) ov.innerHTML = `
        <div style="grid-column:span 4">
          <div class="empty">
            <span class="empty-icon">⚠️</span>
            <b>${e.message}</b><br>
            <span class="muted" style="font-size:10px">
              Run <code>python3 sync/sync.py && ./run_sync.sh</code> to generate data
            </span>
          </div>
        </div>`;
      console.error('Sync failed:', e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Tab routing ───────────────────────────────────────────────────────────

  function _bindTabClicks() {
    document.querySelectorAll('.tab').forEach(el => {
      el.addEventListener('click', () => switchTab(el.dataset.tab));
    });
  }

  function switchTab(name) {
    // Destroy SPX timer if leaving SPX tab
    if (_activeTab === 'spx' && name !== 'spx') {
      if (typeof SPX !== 'undefined') SPX.destroy();
    }

    _activeTab = name;

    document.querySelectorAll('.tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === name);
    });
    document.querySelectorAll('.tab-pane').forEach(el => {
      el.classList.toggle('active', el.id === 'pane-' + name);
    });

    if (DataStore.get()) _renderTab(name);
  }

  function _renderActiveTab() { _renderTab(_activeTab); }

  function _renderTab(name) {
    switch(name) {
      case 'overview': Overview.render();          break;
      case 'tiger':    BrokerTab.render('tiger');  break;
      case 'webull':   BrokerTab.render('webull'); break;
      case 'moomoo':   BrokerTab.render('moomoo'); break;
      case 'journal':  Journal.render();           break;
      case 'spx':      SPX.render();               break;
      case 'ai':       AI.render();                break;
      case 'backtest':
        const btPane = document.getElementById('pane-backtest');
        if (btPane && !btPane.querySelector('iframe')) {
          btPane.innerHTML = `
            <div style="width:100%;height:calc(100vh - 100px)">
              <iframe src="backtest-browser.html"
                style="width:100%;height:100%;border:none"
                title="Backtest">
              </iframe>
            </div>`;
        }
        break;
    }
  }

  // ── Privacy mode ──────────────────────────────────────────────────────────

  let _privacyMode = false;

  function togglePrivacy() {
    _privacyMode = !_privacyMode;
    document.body.classList.toggle('privacy-mode', _privacyMode);
    const btn = document.getElementById('btn-privacy');
    if (btn) {
      btn.style.opacity = _privacyMode ? '0.4' : '1';
      btn.title = _privacyMode ? 'Show P&L' : 'Hide P&L for screenshot';
    }
  }

  // ── Theme toggle ──────────────────────────────────────────────────────────

  function toggleTheme() {
    const html    = document.documentElement;
    const current = html.dataset.theme || 'dark';
    const next    = current === 'dark' ? 'light' : 'dark';
    html.dataset.theme = next;
    localStorage.setItem('kairos_theme', next);

    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';

    Charts.destroyAll();
    if (DataStore.get()) _renderTab(_activeTab);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  function bootstrap() {
    const savedTheme = localStorage.getItem('kairos_theme')
      || KAIROS_CONFIG.DEFAULT_THEME || 'dark';
    document.documentElement.dataset.theme = savedTheme;

    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

    Auth.bootstrap();
  }

  return { init, sync, switchTab, toggleTheme, togglePrivacy, bootstrap };

})();

document.addEventListener('DOMContentLoaded', App.bootstrap);
