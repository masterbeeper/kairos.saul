/* assets/js/config.js
   ─────────────────────────────────────────────────────
   All user-configurable settings live here.
   Edit this file to customise Kairos for your setup.
   ─────────────────────────────────────────────────────
*/

const KAIROS_CONFIG = {

  // ── Google OAuth ────────────────────────────────────────────────────────
  // Get your Client ID from:
  // console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0
  // Add your GitHub Pages URL to "Authorized JavaScript origins"
  // e.g. https://etherhtun.github.io
  GOOGLE_CLIENT_ID: '750109214497-i6akdb52n1n4tv731v33rh08hpo8ofo2.apps.googleusercontent.com',

  // Only these Google accounts can access the dashboard
  // Add as many emails as you need
  ALLOWED_EMAILS: [
    'aungkhingsauloo@gmail.com',
    // 'family@gmail.com',
  ],

  // ── Session ─────────────────────────────────────────────────────────────
  // How long to stay logged in (days)
  SESSION_DAYS: 7,

  // ── Data ────────────────────────────────────────────────────────────────
  // Path to data.json (relative to index.html)
  DATA_URL: 'data.json',

  // ── Brokers ─────────────────────────────────────────────────────────────
  // Display names and colors for each broker
  BROKERS: {
    tiger:  { label: 'Tiger',  color: '#ff6b35', icon: '🐯' },
    webull: { label: 'Webull', color: '#00d4aa', icon: '📗' },
    moomoo: { label: 'MooMoo', color: '#ff4b6e', icon: '🟠' },
  },

  // ── Strategies ──────────────────────────────────────────────────────────
  STRATEGIES: {
    iron_condor: { label: 'IC',    color: '#66bb6a', cssClass: 't-ic'    },
    bps:         { label: 'BPS',   color: '#4fc3f7', cssClass: 't-bps'   },
    bcs:         { label: 'BCS',   color: '#ff9800', cssClass: 't-bcs'   },
    long_stock:  { label: 'LONG',  color: '#ce93d8', cssClass: 't-stock' },
    short_stock: { label: 'SHORT', color: '#f48fb1', cssClass: 't-stock' },
    unknown:     { label: '—',     color: '#8b949e', cssClass: ''        },
  },

  // ── Theme ────────────────────────────────────────────────────────────────
  // 'dark' | 'light' | 'system'
  DEFAULT_THEME: 'dark',

};
