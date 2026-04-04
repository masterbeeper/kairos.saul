# KAIROS — Personal Options Trading Journal

A professional-grade personal trading journal for SPX options traders.
Syncs Tiger Brokers → private GitHub → Cloudflare Pages → secure dashboard.

```
Your Mac (Tiger API key stays here, never uploaded)
    ↓  ./run_sync.sh  (daily cron)
Fetches Tiger trades → data.json
    ↓  git push
Private GitHub repo
    ↓  auto-deploy
Cloudflare Pages  →  Cloudflare Zero Trust (Google login)
    ↓
Dashboard: https://kairos-xxx.pages.dev
```

---

## Features

| Tab | What it does |
|---|---|
| **Overview** | Total P&L, win rate, open positions, cumulative + daily charts with date filter |
| **Tiger** | Strategy performance, open positions, all trades with monthly P&L filter |
| **Journal** | Full trade history with broker/strategy/date filters |
| **SPX** | Professional options engine — IVR, VIX regime, RSI, Stoch, BB, Z-Score, ATR-based strikes, confluence scoring |

**SPX Engine signals:**
- VIX regime (Low / Normal / Elevated / Bear Panic)
- IV Rank — is current VIX elevated vs its own 52-week history?
- Trend filter — SPX vs 200-day moving average
- Momentum — RSI(14), Stochastic(14,3), BB %B(20), Z-Score(20)
- ATR-based strike placement (not just theoretical delta)
- 6-factor confluence score for BPS and BCS separately
- Signal: `SELL BPS [VALID]` / `BCS [WATCH]` / `STAY CASH`

---

## Prerequisites

Before starting, make sure you have:

- **Mac** with Python 3.9+
- **Tiger Brokers account** with API access enabled
- **GitHub account** (free)
- **Cloudflare account** (free)
- **Google account** (for OAuth login)

---

## Part 1 — Local Setup (Mac)

### Step 1 — Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/kairos.git
cd kairos
```

### Step 2 — Install Python dependencies

```bash
pip3 install -r sync/requirements.txt
```

If you get permission errors:
```bash
pip3 install -r sync/requirements.txt --break-system-packages
```

### Step 3 — Store Tiger private key in macOS Keychain

Tiger gives you a private key file (`tiger_openapi_config.properties`).
We store it in the macOS Keychain — it never touches any file in the repo.

Run this once in Terminal (from the folder containing your Tiger config file):

```bash
python3 -c "
import base64, subprocess

# Read key from Tiger config file
with open('tiger_openapi_config.properties') as f:
    for line in f:
        if 'private_key_pk1' in line:
            raw = line.split('=', 1)[1].strip()
            break

# Validate it's valid base64
p = 4 - len(raw) % 4
if p != 4: raw += '=' * p
base64.b64decode(raw)

# Store in Keychain
result = subprocess.run([
    'security', 'add-generic-password',
    '-a', 'tiger_quant',
    '-s', 'tiger_private_key',
    '-w', raw,
    '-U'  # update if exists
], capture_output=True, text=True)

if result.returncode == 0:
    print('✅ Key stored in Keychain successfully')
else:
    print('Error:', result.stderr)
"
```

Verify it works:
```bash
security find-generic-password \
  -a "tiger_quant" \
  -s "tiger_private_key" \
  -w | wc -c
# Should print a number > 100 (key length)
```

### Step 4 — Create .env file

```bash
cp .env.example .env
```

Open `.env` and fill in your Tiger details:

```bash
# Tiger API (non-secret config — private key is in Keychain)
TIGER_ID=12345678
TIGER_ACCOUNT=50830856
TIGER_LICENSE=TBSG
TIGER_ENV=PROD
```

**Where to find these values:**
- `TIGER_ID` — Tiger app → Profile → Account ID
- `TIGER_ACCOUNT` — Tiger app → Account → Account number
- `TIGER_LICENSE` — `TBSG` for Singapore, `TBNZ` for NZ, `TBW` for US
- `TIGER_ENV` — always `PROD` for live trading

### Step 5 — Test sync locally

```bash
cd /path/to/kairos
python3 sync/sync.py
```

Expected output:
```
=======================================================
  KAIROS Sync  2026-03-31 10:00
=======================================================
▶ TIGER
  [tiger] ✅ Connected (account: 50830856)
  [tiger] Fetching all order history (paginated)...
  [tiger] Page  1: 300 records, 141 filled → oldest: 2026-02-06
  [tiger] Page  2: 145 records,  92 filled → oldest: 2023-03-27
  [tiger] MLEG orders: 183 total, 0 cached, 183 new to fetch
  [tiger] Fetching 183 new leg details (batch=10, pause=8s)...
  ...
  [tiger] ✅ 232 trade records built

  Total trades:   232
  Realized P&L:   $4,189.68
=======================================================
```

> **First run takes ~3 minutes** — fetches leg details for all orders and builds `leg_cache.json`.
> **Daily runs take ~10 seconds** — uses cache, only fetches new orders.

---

## Part 2 — GitHub Setup

### Step 1 — Create a private GitHub repo

1. Go to `github.com` → **New repository**
2. Name it `kairos`
3. Set to **Private** ← important for security
4. Do NOT initialize with README (you already have one)
5. Click **Create repository**

### Step 2 — Push your code

```bash
cd /path/to/kairos

git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kairos.git
git push -u origin main
```

### Step 3 — Verify .gitignore

Make sure these sensitive files are NOT pushed to GitHub:

```bash
cat .gitignore
```

Should include:
```
.env
sync/leg_cache.json
data.backup.json
logs/
```

---

## Part 3 — Google OAuth Setup

The dashboard uses Google to verify your identity.

### Step 1 — Create Google OAuth credentials

1. Go to `console.cloud.google.com`
2. Create a new project (or use existing)
   - Click project dropdown → **New Project** → name it `Kairos`
3. Go to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client ID**
5. If prompted, configure OAuth consent screen first:
   - User type: **External**
   - App name: `Kairos`
   - Support email: your Gmail
   - Save and continue through all steps
6. Back to Create OAuth Client:
   - Application type: **Web application**
   - Name: `Kairos Web`
   - Authorized JavaScript origins: (add after Cloudflare setup)
   - Click **Create**
7. Copy the **Client ID** — looks like:
   ```
   123456789-abcdefghijklmnop.apps.googleusercontent.com
   ```

### Step 2 — Update config.js

Open `assets/js/config.js` and fill in:

```javascript
GOOGLE_CLIENT_ID: '123456789-abcdefghijklmnop.apps.googleusercontent.com',
ALLOWED_EMAILS: [
    'your@gmail.com',
],
```

Commit and push:
```bash
git add assets/js/config.js
git commit -m "config: add Google Client ID"
git push
```

---

## Part 4 — Cloudflare Pages Setup

Cloudflare Pages hosts your dashboard and auto-deploys on every `git push`.

### Step 1 — Sign up for Cloudflare

1. Go to `dash.cloudflare.com`
2. Sign up with email + password (free plan is fine)

### Step 2 — Create Pages project

1. In Cloudflare dashboard → **Workers & Pages**
2. Click **Create application** → look for **"Looking to deploy Pages? Get started"** at the bottom
3. Click **Connect to Git** → authorize GitHub access
4. Select your `kairos` repo
5. Click **Begin setup**

### Step 3 — Configure build settings

```
Project name:      kairos
Production branch: main
Build command:     (leave completely empty)
Build output dir:  /
```

Click **Save and Deploy**. Wait ~1 minute.

You'll get a URL like: `https://kairos-abc123.pages.dev`

### Step 4 — Add Authorized JavaScript Origin to Google

1. Go back to `console.cloud.google.com`
2. APIs & Services → Credentials → your OAuth client
3. Under **Authorized JavaScript origins** → Add URI:
   ```
   https://kairos-abc123.pages.dev
   ```
4. Click **Save**

### Step 5 — Update run_sync.sh

Open `run_sync.sh` and verify the git push works:
```bash
./run_sync.sh
```

Should sync Tiger → push to GitHub → Cloudflare auto-deploys within seconds.

### Step 6 — Test the dashboard

Open `https://kairos-abc123.pages.dev` in your browser.
You should see the Kairos login screen → sign in with Google → dashboard loads.

---

## Part 5 — Cloudflare Zero Trust Security

This is the most important security step. It protects your entire site —
including `data.json` — behind Google authentication at the CDN level.

### Step 1 — Enable Zero Trust

1. Cloudflare dashboard → **Zero Trust** (left sidebar)
2. Choose a team name: `kairos-team`
   - This creates `kairos-team.cloudflareaccess.com`
3. Select **Free plan** → complete setup

### Step 2 — Add Google as Identity Provider

1. Zero Trust → **Integrations** → **Identity Providers**
2. Click **Add new** → select **Google**
3. Fill in:
   ```
   Client ID:     (same as GOOGLE_CLIENT_ID in config.js)
   Client Secret: (from Google Cloud Console → your OAuth client)
   ```
   **Get Client Secret:**
   - `console.cloud.google.com` → Credentials → click your OAuth client
   - Copy the **Client Secret** value
4. Click **Save**

### Step 3 — Add Cloudflare callback to Google

1. Back in Google Cloud Console → your OAuth client
2. Under **Authorized redirect URIs** → Add URI:
   ```
   https://kairos-team.cloudflareaccess.com/cdn-cgi/access/callback
   ```
   > Note: Use YOUR team name, not `kairos-team` if you chose something different
3. Click **Save**

### Step 4 — Create Access Application

1. Zero Trust → **Access controls** → **Applications**
2. Click **Add an application** → **Self-hosted**
3. Fill in:
   ```
   Application name: Kairos
   Session Duration: 24 hours
   Subdomain:        (leave empty)
   Domain:           kairos-abc123.pages.dev
   Path:             (leave empty)
   ```
4. Click **Next**

### Step 5 — Add Access Policy

```
Policy name:  Allow Me
Action:       Allow

Configure rules:
  Selector:   Emails
  Value:      your@gmail.com
```

Click **Next** → **Add application**

### Step 6 — Test Zero Trust

1. Open a new incognito window
2. Go to `https://kairos-abc123.pages.dev`
3. You should see **Cloudflare Access** login screen with Google button
4. Sign in with your Gmail
5. Dashboard should load directly (no second login)

**Verify data.json is protected:**
```
https://kairos-abc123.pages.dev/data.json
```
Should show **Access denied** — not your trade data ✅

---

## Part 6 — Daily Sync Automation

### Manual sync

Run anytime to fetch latest trades and update the dashboard:

```bash
cd /path/to/kairos
./run_sync.sh
```

This:
1. Fetches last 30 days from Tiger
2. Merges with existing `data.json`
3. Bumps version stamp (forces browser cache refresh)
4. Pushes to GitHub
5. Cloudflare auto-deploys in ~30 seconds
6. Dashboard auto-detects update and refreshes within 5 minutes

### Automated cron (recommended)

Run at 10:30 PM SGT (after US market close) on weekdays:

```bash
# Open crontab
crontab -e
```

Add this line (replace with your actual path):
```bash
30 22 * * 1-5 cd /Users/yourname/kairos && ./run_sync.sh >> logs/sync.log 2>&1
```

Create the logs folder first:
```bash
mkdir -p /path/to/kairos/logs
```

**Verify cron is running:**
```bash
# List scheduled jobs
crontab -l

# Watch the log file
tail -f /path/to/kairos/logs/sync.log

# Check macOS cron is enabled
sudo launchctl list | grep cron
```

**If cron doesn't run on macOS:**
```bash
# Grant Full Disk Access to cron
# System Settings → Privacy & Security → Full Disk Access → add /usr/sbin/cron
```

---

## Part 7 — SPX Calculator Usage

The SPX tab gives you professional trade signals based on:

| Signal | Meaning |
|---|---|
| `SELL BPS [VALID]` | 4+ factors confirm bull put spread entry |
| `SELL BCS [VALID]` | 4+ factors confirm bear call spread entry |
| `BPS [WATCH]` | 2-3 factors align — monitor, not yet |
| `BPS [SKIP]` | Less than 2 factors — avoid |

**6 confluence factors (each worth 1 point):**

1. **IV Rank ≥ 30%** — elevated premium environment
2. **VIX regime** — manageable volatility for your DTE
3. **Trend (200DMA)** — aligned with spread direction
4. **RSI(14)** — oversold for BPS (<40), overbought for BCS (>60)
5. **Stochastic K** — oversold for BPS (<25), overbought for BCS (>75)
6. **BB %B** — near lower band for BPS (<30%), near upper for BCS (>70%)

**Strike calculation:**
- Strikes placed at `ATR × multiplier` from current SPX price
- Default: ATR(14) × 2.5 = distance from current price
- Increase multiplier in high-vol environments for more cushion

**Parameters you can adjust:**
- DTE — match your current trade (0, 1, 7, 30-45)
- ATR Multiplier — default 2.5x (increase to 3x when VIX > 25)
- Width — spread width in points (25 for 0-1DTE, 50 for 7-45DTE)
- Account size and risk per trade %

---

## File Structure

```
kairos/
├── index.html              Dashboard entry point
├── data.json               Trade data (auto-generated, pushed to GitHub)
├── _headers                Cloudflare cache headers
├── run_sync.sh             Run this to sync + push
├── .env                    Your credentials (gitignored)
├── .env.example            Template for .env
│
├── assets/
│   ├── css/
│   │   ├── variables.css   Design tokens (colors, spacing, dark/light theme)
│   │   ├── base.css        Reset, utilities, skeleton loader
│   │   ├── layout.css      Topbar, tabs, responsive grid
│   │   ├── components.css  Cards, tables, tags, buttons
│   │   └── spx.css         SPX calculator styles
│   └── js/
│       ├── config.js       ← EDIT THIS: Google Client ID + allowed emails
│       ├── auth.js         Authentication (Cloudflare Access + Google OAuth)
│       ├── data.js         Load and parse data.json
│       ├── components.js   Reusable HTML builder functions
│       ├── charts.js       Chart.js wrappers (cumulative + daily P&L)
│       ├── overview.js     Overview tab with date filter
│       ├── broker.js       Per-broker tabs with monthly filter
│       ├── journal.js      Journal tab with advanced filters
│       ├── spx.js          SPX professional options engine
│       └── app.js          Main init, routing, auto-refresh
│
├── functions/
│   └── api/
│       └── prices.js       Cloudflare Pages Function — Yahoo Finance proxy
│                           Computes: ATR, RSI, Stoch, BB, Z-Score, IVR, 200DMA
│
└── sync/
    ├── sync.py             Main sync runner
    ├── classifier.py       Strategy classification (IC/BPS/BCS)
    ├── leg_cache.json      Cached MLEG leg details (gitignored)
    ├── requirements.txt    Python dependencies
    └── brokers/
        ├── base.py         Abstract broker interface
        ├── tiger.py        Tiger Brokers (fully implemented)
        ├── webull.py       Webull (stub — ready to implement)
        └── moomoo.py       MooMoo (stub — ready to implement)
```

---

## Security Architecture

```
Layer 1 — Private GitHub repo
  Source code not publicly visible
  data.json not publicly accessible via GitHub URL

Layer 2 — Cloudflare Zero Trust
  Entire site gated behind Google login at CDN level
  data.json returns "Access denied" to unauthenticated users
  Session expires every 24 hours

Layer 3 — Dashboard Google OAuth
  Secondary auth check using Google JWT
  Reads CF_Authorization cookie from Zero Trust
  Falls back to Google login form if needed

Layer 4 — Read-only Tiger client
  Tiger API client configured read-only
  place_order/cancel_order/modify_order all raise PermissionError

Layer 5 — Keychain key storage
  Tiger private key stored in macOS Keychain
  Never written to any file
  Never pushed to GitHub
```

---

## Troubleshooting

### "Failed to fetch prices" on SPX tab

The `/api/prices` Cloudflare Function is failing.
Check: Cloudflare Pages → your project → Functions → Logs

Most common cause: Yahoo Finance rate limiting.
Fix: wait 1-2 minutes and refresh.

### Sync taking too long every run

The leg cache isn't being used.
Check that `sync/leg_cache.json` exists:
```bash
ls -la sync/leg_cache.json
wc -l sync/leg_cache.json  # should show 100+ lines
```

If missing, delete `data.json` and re-run sync to rebuild:
```bash
rm data.json
python3 sync/sync.py
```

### "That account does not have access" on Cloudflare login

Your email policy isn't attached to the application.
Fix:
1. Zero Trust → Access → Applications → Kairos → Edit
2. Policies tab → verify your email policy is listed
3. If not: Add existing policy → select your policy → Save

### Google login shows "invalid_client"

The Google Client ID in `config.js` doesn't match the one in Google Cloud Console.
Fix: copy the exact Client ID from Google Cloud Console → paste into `config.js` → push.

### Dashboard not updating after sync

1. Check `run_sync.sh` completed without errors
2. Check GitHub — `data.json` should show recent commit
3. Check Cloudflare Pages — should show recent deployment
4. Dashboard auto-refreshes every 5 min — wait or hard refresh: `Cmd+Shift+R`

### Cron job not running on macOS

macOS requires Full Disk Access for cron:
```
System Settings → Privacy & Security → Full Disk Access
→ Click + → navigate to /usr/sbin/cron → Add
```

---

## Adding Webull or MooMoo

When ready to add another broker:

1. Add credentials to `.env`:
   ```
   WEBULL_USERNAME=your@email.com
   WEBULL_PASSWORD=yourpassword
   WEBULL_DEVICE_ID=your_device_id
   WEBULL_TRADE_PIN=123456
   ```

2. Implement `sync/brokers/webull.py`:
   - Fill in `connect()`, `get_account()`, `get_positions()`, `get_trades()`
   - Follow the same pattern as `tiger.py`

3. The dashboard Webull tab will automatically activate once trades are synced.

---

## Dependencies

**Python (sync/requirements.txt):**
```
tigeropen>=2.4.0    # Tiger Brokers API
pandas>=1.5.0       # Data processing
python-dotenv>=0.21 # .env file loading
pytz>=2022.7        # Timezone handling
```

**JavaScript (loaded from CDN):**
- Chart.js 4.x — P&L charts
- TradingView widget — SPX chart
- Google Identity Services — OAuth login

---

## License

Private personal use only. Not for redistribution.

---

*Last updated: March 2026*
