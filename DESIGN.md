# Kairos — System Design

## Infrastructure Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  SOURCE                                                      │
│  Tiger Brokers API  (Singapore · TBSG license)              │
└──────────────────────────┬──────────────────────────────────┘
                           │ get_orders() · paginated
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LOCAL MAC  (data never leaves except via git push)         │
│                                                             │
│  ┌──────────────┐   auth   ┌───────────┐   ┌────────────┐  │
│  │  macOS       │ ───────► │  sync.py  │ ► │ data.json  │  │
│  │  Keychain    │          │  classify │   │ 232 trades │  │
│  │  (priv key)  │          │  merge    │   │            │  │
│  └──────────────┘          └───────────┘   └────────────┘  │
│                                                             │
│  cron: 10:30 PM SGT weekdays → run_sync.sh → git push      │
└──────────────────────────┬──────────────────────────────────┘
                           │ git push
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  CLOUD                                                      │
│                                                             │
│  GitHub (private repo)                                      │
│       │ webhook auto-deploy                                 │
│       ▼                                                     │
│  Cloudflare Pages  (kairos-f3w.pages.dev)                   │
│       │                      │                             │
│       │                      ▼                             │
│       │            /api/prices  (Pages Function)            │
│       │            Yahoo Finance proxy                      │
│       │            SPX · VIX · ATR · RSI · IVR             │
│       ▼                                                     │
│  Cloudflare Zero Trust  (Google OAuth gate)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ authenticated request
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  USER                                                       │
│  Browser → Zero Trust login → Dashboard                     │
│                         ↕                                   │
│            Yahoo Finance (live prices · 15-min delay)       │
└─────────────────────────────────────────────────────────────┘
```

### Data flow detail

| Step | From | To | What |
|---|---|---|---|
| 1 | Tiger API | sync.py | `get_orders()` paginated · MLEG leg details |
| 2 | Keychain | sync.py | Private key loaded at runtime only |
| 3 | sync.py | data.json | 232 trades · classified · merged |
| 4 | run_sync.sh | GitHub | `git push` · cache bust version stamp |
| 5 | GitHub | Cloudflare Pages | Webhook auto-deploy (~30 sec) |
| 6 | Browser | /api/prices | SPX, VIX, ATR, RSI, Stoch, BB, IVR |
| 7 | /api/prices | Yahoo Finance | Fetches server-side (no CORS) |

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — Private GitHub repo                              │
│  Source code not publicly visible                           │
│  .env · leg_cache.json · data.backup.json all gitignored    │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Layer 2 — Cloudflare Zero Trust                      │  │
│  │  Google OAuth gate at CDN level                       │  │
│  │  data.json returns 403 without auth                   │  │
│  │  Session expires every 24 hours                       │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Layer 3 — Cloudflare Pages (HTTPS only)        │  │  │
│  │  │  Auto-deploy from private repo                  │  │  │
│  │  │  HTTPS enforced · no HTTP fallback              │  │  │
│  │  │                                                 │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │  Layer 4 — Dashboard auth.js              │  │  │  │
│  │  │  │  Reads CF_Authorization cookie            │  │  │  │
│  │  │  │  Falls back to Google sign-in form        │  │  │  │
│  │  │  │  ALLOWED_EMAILS whitelist                 │  │  │  │
│  │  │  │                                           │  │  │  │
│  │  │  │  ┌─────────────────────────────────────┐  │  │  │  │
│  │  │  │  │  Layer 5 — Mac (never leaves)       │  │  │  │  │
│  │  │  │  │  Tiger private key in Keychain      │  │  │  │  │
│  │  │  │  │  Never written to any file          │  │  │  │  │
│  │  │  │  │  Never pushed to GitHub             │  │  │  │  │
│  │  │  │  │  Read-only API client               │  │  │  │  │
│  │  │  │  │  place_order() → PermissionError    │  │  │  │  │
│  │  │  │  └─────────────────────────────────────┘  │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Threat model

| Threat | Mitigation | Layer |
|---|---|---|
| Public access to data.json | Cloudflare Zero Trust blocks unauthenticated requests | 2 |
| Someone guesses your Pages URL | ZT gate — Google login required before any content served | 2 |
| GitHub repo leaked | No secrets in repo — .env, keys, cache all gitignored | 1 |
| Dashboard URL shared | ALLOWED_EMAILS whitelist — only your Gmail works | 4 |
| Tiger key compromised | Key never leaves macOS Keychain — not in any cloud | 5 |
| Attacker places trades | Tiger client is read-only — place_order() raises PermissionError | 5 |
| Session hijacking | CF_Authorization cookie · 24hr expiry · Google re-auth required | 2+4 |

### What is NOT protected

- If your Mac is physically compromised, the Keychain key can be extracted
- Tiger API rate limits apply — sync.py can be throttled if run too frequently
- Yahoo Finance data is 15-min delayed — not suitable for live trading decisions
- Cloudflare free plan has limits — not suitable for high-traffic production use

---

## SPX Calculator Design

### Signal logic

```
Raw data (Yahoo Finance, server-side)
    ↓
Computed indicators
    ATR(14) · RSI(14) · Stoch(14,3) · BB%B(20) · Z-Score(20)
    IVR = (VIX - 52w low) / (52w high - 52w low) × 100
    200DMA · trend direction · VIX term structure
    ↓
6-factor confluence score (BPS and BCS scored separately)
    1. IVR ≥ 30%           → +1  (elevated premium)
    2. VIX regime          → +1  (manageable for DTE)
    3. Trend (200DMA)      → +1  (aligned with direction)
    4. RSI(14)             → +1  (oversold/overbought)
    5. Stochastic K        → +1  (extreme zone)
    6. BB %B               → +1  (near band)
    ↓
Signal: VALID (≥4) · WATCH (2-3) · SKIP (<2)
    ↓
Expected move reference (NOT strike suggestions)
    dist = SPX × (VIX/100) × √(DTE/365) × sigmaMult
    1σ boundary · 2σ boundary shown
    User picks exact strike from real options chain
```

### Backtest findings (126 trades · Dec 2025 – Mar 2026)

| Finding | Detail |
|---|---|
| Overall win rate | 73.0% (92W / 34L) |
| Best strategy | IC: 86.4% WR · max loss $106 |
| Worst strategy | BPS: 65.5% WR · max loss $1,270 |
| VIX sweet spot | VIX 25-30: 91.7% WR |
| Confluence signal | Not yet predictive — 78% of trades had null IVR |
| IVR availability | Needs 12 months VIX history — reliable from Dec 2026 |

### Geopolitical risk override

When war/sanctions drive VIX spike (not normal market selling):
- Toggle "Geopolitical risk active" in SPX tab
- Dashboard applies: 3.5× sigma multiplier · 50% position size · IC only warning
- Cannot be auto-detected — requires manual judgment from trader

---

## Stack summary

| Component | Technology | Hosted |
|---|---|---|
| Dashboard | Vanilla JS · Chart.js · TradingView | Cloudflare Pages |
| Market data API | Cloudflare Pages Function (JS) | Cloudflare Edge |
| Trade sync | Python 3 · tigeropen | Mac (local) |
| Auth | Cloudflare Zero Trust · Google OAuth | Cloudflare |
| Source control | Git | GitHub (private) |
| Tiger connection | TigerOpen SDK · TBSG license | Mac (local) |
| Key storage | macOS Keychain | Mac (local) |

---

*Last updated: March 2026*
