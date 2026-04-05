/* assets/js/ai.js
   Kairos AI Analyst — powered by Claude (claude-sonnet-4-20250514)
   ─────────────────────────────────────────────────────────────────
   Modules:
     1. Market Conditions Brief   — daily macro + vol summary
     2. Position Risk Assessment  — per-position risk + "what if I don't exit"
     3. Trade Plan Generator      — entry setup for BPS / BCS / IC
     4. Signal Explainer          — explain SPX confluence score in plain English
     5. Free Q&A                  — natural language chat about positions / market
*/

const AI = (() => {

  const MODEL   = 'claude-sonnet-4-20250514';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MAX_TOK = 1000;

  // ── System prompt ─────────────────────────────────────────────────────────

  function _systemPrompt() {
    const meta  = DataStore.getMeta();
    const stats = DataStore.getStats();
    const pos   = DataStore.getPositions();

    const statsSummary = stats.map(s =>
      `${s.broker}/${s.strategy}: ${s.total_trades} trades, ${s.win_rate_pct}% WR, P&L $${s.total_pnl}`
    ).join('\n');

    const posSummary = pos.map(p =>
      `[${p.broker}] ${p.strategy.toUpperCase()} ${p.symbol} exp:${p.expiry} strikes:${p.strikes} ` +
      `credit:$${p.entry_credit} maxLoss:-$${p.max_loss} uPnL:$${p.unrealized_pnl}`
    ).join('\n') || 'None';

    return `You are Kairos AI, an institutional-grade options trading analyst assistant embedded in a personal SPX options trading journal.

TRADER PROFILE:
- Instruments: SPX options (BPS, BCS, Iron Condor)
- Style: premium seller, short DTE (0-45 DTE), confluence-based entries
- Platform: Kairos trading journal (Tiger Brokers, Singapore)

PORTFOLIO SUMMARY (as of last sync: ${meta.last_sync || 'unknown'}):
${statsSummary || 'No trade history yet'}

OPEN POSITIONS:
${posSummary}

YOUR ROLE:
- Be direct, concise, and actionable — no fluff
- Use specific numbers and percentages
- Flag risks clearly — especially time decay, delta exposure, and early exit scenarios
- When discussing "what if I don't exit": quantify max loss, theta burn rate, and probability of breach
- Format responses in plain text with short paragraphs — no markdown headers
- Always end risk assessments with a clear RECOMMENDATION: EXIT / HOLD / ADJUST

IMPORTANT: You are an analytical tool, not financial advice. Always note this briefly if discussing specific trade decisions.`;
  }

  // ── Core API call ─────────────────────────────────────────────────────────

  async function _call(messages, onChunk) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: MAX_TOK,
        system:     _systemPrompt(),
        stream:     true,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';
    let   full   = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') break;
        try {
          const evt = JSON.parse(raw);
          const txt = evt?.delta?.text || '';
          if (txt) { full += txt; onChunk(full); }
        } catch {}
      }
    }
    return full;
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function _renderThinking(container) {
    container.innerHTML = `
      <div class="ai-thinking">
        <span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>
        <span style="font-size:11px;color:var(--text-muted);margin-left:6px">Kairos AI is thinking…</span>
      </div>`;
  }

  function _renderStreaming(container, text) {
    container.innerHTML = `<div class="ai-response">${_escHtml(text)}<span class="ai-cursor">▋</span></div>`;
  }

  function _renderDone(container, text) {
    container.innerHTML = `<div class="ai-response">${_escHtml(text)}</div>`;
  }

  function _renderError(container, msg) {
    container.innerHTML = `<div class="ai-error">⚠ ${_escHtml(msg)}</div>`;
  }

  function _escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  // ── Module 1: Market Conditions Brief ────────────────────────────────────

  async function marketBrief(spxData) {
    const el = document.getElementById('ai-market-output');
    if (!el) return;
    _renderThinking(el);

    const vixLevel = spxData?.vix?.price ?? 'unknown';
    const spxPrice = spxData?.spx?.price ?? 'unknown';
    const ivr      = spxData?.ivr ?? 'unknown';
    const trend    = spxData?.trendBullish === true ? 'above' : spxData?.trendBullish === false ? 'below' : 'at';
    const ts       = spxData?.termStructure ?? 'unknown';
    const rsi      = spxData?.rsi ?? 'unknown';

    const prompt = `Give me a concise market conditions brief for an SPX premium seller right now.

Current data:
- SPX: ${spxPrice}
- VIX: ${vixLevel}
- IV Rank (proxy): ${ivr}%
- SPX vs 200DMA: ${trend} the 200-day moving average
- RSI(14): ${rsi}
- VIX term structure: ${ts}

Cover: (1) overall vol environment and whether it's good for premium selling, (2) key risk factors for the next 1-5 days, (3) which strategy (BPS/BCS/IC) is most appropriate right now and why. Keep it under 200 words.`;

    try {
      await _call([{ role: 'user', content: prompt }], txt => _renderStreaming(el, txt));
      const final = el.querySelector('.ai-response')?.innerText || '';
      _renderDone(el, final);
    } catch(e) {
      _renderError(el, e.message);
    }
  }

  // ── Module 2: Position Risk Assessment ───────────────────────────────────

  async function assessPosition(pos, spxData) {
    const el = document.getElementById('ai-position-output');
    if (!el) return;
    _renderThinking(el);

    const dte      = Components.calcDTE(pos.expiry);
    const vix      = spxData?.vix?.price ?? 'unknown';
    const spxPrice = spxData?.spx?.price ?? 'unknown';
    const atr      = spxData?.atr ?? 'unknown';

    const prompt = `Assess the risk for this open position:

Position: ${pos.strategy.toUpperCase()} ${pos.symbol}
Expiry: ${pos.expiry} (${dte !== null ? dte + ' DTE' : 'DTE unknown'})
Strikes: ${pos.strikes}
Entry credit: $${pos.entry_credit}
Max profit: $${pos.max_profit}
Max loss: -$${pos.max_loss}
Current unrealized P&L: $${pos.unrealized_pnl}

Market context:
- SPX current: ${spxPrice}
- VIX: ${vix}
- ATR(14): ${atr}

Please cover:
1. Current risk level (Low/Medium/High/Critical) and why
2. What happens to this position if I do NOT exit in the next ${dte <= 2 ? '24 hours' : `${dte} days`}
3. Specific price levels that would threaten this position (breach of short strike)
4. Theta decay situation — is time working for or against me right now?
5. Clear RECOMMENDATION: EXIT NOW / HOLD TO EXPIRY / ADJUST (with specific action)

Be direct and quantitative.`;

    try {
      await _call([{ role: 'user', content: prompt }], txt => _renderStreaming(el, txt));
      const final = el.querySelector('.ai-response')?.innerText || '';
      _renderDone(el, final);
    } catch(e) {
      _renderError(el, e.message);
    }
  }

  // ── Module 3: Trade Plan Generator ───────────────────────────────────────

  async function generateTradePlan(params) {
    const el = document.getElementById('ai-plan-output');
    if (!el) return;
    _renderThinking(el);

    const { strategy, dte, spxPrice, vix, ivr, strikes, metrics } = params;

    const prompt = `Generate a complete trade plan for this setup:

Strategy: ${strategy}
DTE: ${dte}
SPX price: ${spxPrice}
VIX: ${vix}
IV Rank: ${ivr}%
Proposed strikes: ${strikes}
Estimated credit: $${metrics?.credit ?? 'unknown'}
Max loss: $${metrics?.maxLoss ?? 'unknown'}
PoP: ${metrics?.pop ?? 'unknown'}%
Contracts: ${metrics?.contracts ?? 1}

Include:
1. Entry rationale — why this setup makes sense RIGHT NOW
2. Exact entry: strikes, credit target (min acceptable), contracts
3. Exit plan — profit target (% of max profit), stop loss trigger
4. "What if it goes wrong" — at what SPX level do you exit, and what's the loss?
5. Time-based rule — if ${dte} DTE, at what DTE do you cut regardless of P&L?
6. Post-trade risk: if you overstay by 2 days, what's the likely outcome?

Format as a numbered trade plan. Keep it actionable and specific.`;

    try {
      await _call([{ role: 'user', content: prompt }], txt => _renderStreaming(el, txt));
      const final = el.querySelector('.ai-response')?.innerText || '';
      _renderDone(el, final);
    } catch(e) {
      _renderError(el, e.message);
    }
  }

  // ── Module 4: Signal Explainer ────────────────────────────────────────────

  async function explainSignal(scoreObj, direction, spxData) {
    const el = document.getElementById('ai-signal-output');
    if (!el) return;
    _renderThinking(el);

    const factors = scoreObj.factors.map(f =>
      `${f.ok ? '✓' : '✗'} ${f.name}: ${f.val} — ${f.note}`
    ).join('\n');

    const prompt = `Explain this SPX options confluence score in plain English for a trader deciding whether to enter a ${direction === 'BULL' ? 'Bull Put Spread (BPS)' : 'Bear Call Spread (BCS)'}.

Score: ${scoreObj.score} / 6 → Signal: ${scoreObj.signal}

Factors:
${factors}

Current market: SPX ${spxData?.spx?.price ?? 'unknown'}, VIX ${spxData?.vix?.price ?? 'unknown'}

In 3-4 sentences: what does this score mean, which failing factors matter most, and should the trader wait for a better setup or is this entry acceptable? End with a one-line verdict.`;

    try {
      await _call([{ role: 'user', content: prompt }], txt => _renderStreaming(el, txt));
      const final = el.querySelector('.ai-response')?.innerText || '';
      _renderDone(el, final);
    } catch(e) {
      _renderError(el, e.message);
    }
  }

  // ── Module 5: Free Q&A chat ───────────────────────────────────────────────

  let _chatHistory = [];

  async function chat(userMessage) {
    const outputEl = document.getElementById('ai-chat-output');
    const inputEl  = document.getElementById('ai-chat-input');
    if (!outputEl || !userMessage.trim()) return;

    _chatHistory.push({ role: 'user', content: userMessage });
    if (inputEl) inputEl.value = '';

    // Append user bubble
    outputEl.innerHTML += `<div class="ai-chat-bubble user">${_escHtml(userMessage)}</div>`;
    const botBubble = document.createElement('div');
    botBubble.className = 'ai-chat-bubble bot';
    botBubble.innerHTML = '<span class="ai-thinking-inline">…</span>';
    outputEl.appendChild(botBubble);
    outputEl.scrollTop = outputEl.scrollHeight;

    try {
      let full = '';
      await _call(_chatHistory, txt => {
        full = txt;
        botBubble.innerHTML = _escHtml(txt) + '<span class="ai-cursor">▋</span>';
        outputEl.scrollTop = outputEl.scrollHeight;
      });
      botBubble.innerHTML = _escHtml(full);
      _chatHistory.push({ role: 'assistant', content: full });
    } catch(e) {
      botBubble.innerHTML = `<span class="ai-error">⚠ ${_escHtml(e.message)}</span>`;
      _chatHistory.pop(); // remove failed user message
    }
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function clearChat() {
    _chatHistory = [];
    const el = document.getElementById('ai-chat-output');
    if (el) el.innerHTML = `<div class="ai-chat-welcome">
      Ask me anything about your positions, the market, or trade setups.
    </div>`;
  }

  // ── Tab shell ─────────────────────────────────────────────────────────────

  function _buildShell() {
    const positions = DataStore.getPositions();
    const posOptions = positions.length
      ? positions.map((p, i) =>
          `<option value="${i}">${p.strategy.toUpperCase()} ${p.symbol} ${p.expiry} (${p.strikes})</option>`
        ).join('')
      : '<option value="">No open positions</option>';

    return `<div class="content">

      <!-- ── Header ── -->
      <div class="sec-hdr" style="margin-top:var(--sp-md)">
        <div class="sec-title">🤖 Kairos AI Analyst</div>
        <div style="font-size:10px;color:var(--text-muted)">Powered by Claude · Educational use only</div>
      </div>

      <!-- ── Module grid ── -->
      <div class="ai-module-grid">

        <!-- Market Brief -->
        <div class="ai-card">
          <div class="ai-card-hdr">
            <span class="ai-card-icon">🌐</span>
            <span class="ai-card-title">Market Conditions Brief</span>
          </div>
          <div class="ai-card-desc">Get a concise vol environment summary and strategy recommendation for right now.</div>
          <button class="btn btn-primary ai-btn" onclick="AI.runMarketBrief()">
            ⟳ Generate Brief
          </button>
          <div id="ai-market-output" class="ai-output"></div>
        </div>

        <!-- Position Risk -->
        <div class="ai-card">
          <div class="ai-card-hdr">
            <span class="ai-card-icon">⚠️</span>
            <span class="ai-card-title">Position Risk Assessment</span>
          </div>
          <div class="ai-card-desc">Analyze an open position — risk level, exit timing, and "what if I overstay?"</div>
          <select id="ai-pos-select" class="input-field" style="margin-bottom:8px;width:100%">
            ${posOptions}
          </select>
          <button class="btn btn-primary ai-btn"
            onclick="AI.runPositionAssess()" ${!positions.length ? 'disabled' : ''}>
            Assess Risk
          </button>
          <div id="ai-position-output" class="ai-output"></div>
        </div>

        <!-- Trade Plan -->
        <div class="ai-card">
          <div class="ai-card-hdr">
            <span class="ai-card-icon">🎯</span>
            <span class="ai-card-title">Trade Plan Generator</span>
          </div>
          <div class="ai-card-desc">Generate a full entry/exit plan for the current SPX setup from the engine.</div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <select id="ai-plan-strat" class="input-field" style="flex:1">
              <option value="IC">Iron Condor</option>
              <option value="BPS">Bull Put Spread</option>
              <option value="BCS">Bear Call Spread</option>
            </select>
          </div>
          <button class="btn btn-primary ai-btn" onclick="AI.runTradePlan()">
            Generate Plan
          </button>
          <div id="ai-plan-output" class="ai-output"></div>
        </div>

        <!-- Signal Explainer -->
        <div class="ai-card">
          <div class="ai-card-hdr">
            <span class="ai-card-icon">📊</span>
            <span class="ai-card-title">Signal Explainer</span>
          </div>
          <div class="ai-card-desc">Plain-English explanation of the current BPS or BCS confluence score.</div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button class="btn btn-outline ai-btn-sm active" id="ai-sig-bull"
              onclick="AI.setSignalDir('BULL')">BPS (Bull)</button>
            <button class="btn btn-outline ai-btn-sm" id="ai-sig-bear"
              onclick="AI.setSignalDir('BEAR')">BCS (Bear)</button>
          </div>
          <button class="btn btn-primary ai-btn" onclick="AI.runSignalExplain()">
            Explain Signal
          </button>
          <div id="ai-signal-output" class="ai-output"></div>
        </div>

      </div><!-- /module-grid -->

      <!-- ── Q&A Chat ── -->
      <div class="sec-hdr" style="margin-top:var(--sp-lg)">
        <div class="sec-title">💬 Ask Kairos AI</div>
        <button class="btn btn-outline" style="font-size:10px;padding:4px 10px"
          onclick="AI.clearChat()">Clear</button>
      </div>
      <div class="ai-chat-wrap">
        <div id="ai-chat-output" class="ai-chat-output">
          <div class="ai-chat-welcome">
            Ask me anything — positions, market conditions, trade setups, Greeks, or risk.
          </div>
        </div>
        <div class="ai-chat-input-row">
          <input id="ai-chat-input" class="input-field ai-chat-input"
            placeholder="e.g. What's my max risk if SPX drops 2%?"
            onkeydown="if(event.key==='Enter')AI.sendChat()"/>
          <button class="btn btn-primary" onclick="AI.sendChat()">Send</button>
        </div>
      </div>

      <div style="text-align:center;font-size:10px;color:var(--text-muted);padding:var(--sp-lg) 0">
        ⚠️ AI responses are for educational and planning purposes only. Not financial advice.
        Verify all trades with your broker.
      </div>

    </div>`;
  }

  // ── State for SPX data (set by SPX module on fetch) ──────────────────────
  let _spxData    = null;
  let _spxScores  = null;
  let _signalDir  = 'BULL';

  function setSpxData(data, scores) {
    _spxData   = data;
    _spxScores = scores;
  }

  function setSignalDir(dir) {
    _signalDir = dir;
    document.getElementById('ai-sig-bull')?.classList.toggle('active', dir === 'BULL');
    document.getElementById('ai-sig-bear')?.classList.toggle('active', dir === 'BEAR');
  }

  // ── Public runners ────────────────────────────────────────────────────────

  async function runMarketBrief()    { await marketBrief(_spxData); }

  async function runPositionAssess() {
    const sel = document.getElementById('ai-pos-select');
    const idx = parseInt(sel?.value ?? '0');
    const pos = DataStore.getPositions()[idx];
    if (!pos) {
      const el = document.getElementById('ai-position-output');
      if (el) _renderError(el, 'No position selected.');
      return;
    }
    await assessPosition(pos, _spxData);
  }

  async function runTradePlan() {
    const strat = document.getElementById('ai-plan-strat')?.value || 'IC';
    if (!_spxData?.spx) {
      const el = document.getElementById('ai-plan-output');
      if (el) _renderError(el, 'SPX data not loaded yet. Go to the SPX tab first to fetch prices.');
      return;
    }
    // Pull current strikes from SPX state if available via window
    const spxState = window._kairosSpxState || {};
    await generateTradePlan({
      strategy: strat,
      dte:      spxState.dte   ?? 7,
      spxPrice: _spxData.spx?.price,
      vix:      _spxData.vix?.price,
      ivr:      _spxData.ivr,
      strikes:  spxState.strikes ?? 'see SPX engine',
      metrics:  spxState.metrics ?? null,
    });
  }

  async function runSignalExplain() {
    if (!_spxScores || !_spxData) {
      const el = document.getElementById('ai-signal-output');
      if (el) _renderError(el, 'SPX signals not loaded. Go to the SPX tab first.');
      return;
    }
    const score = _signalDir === 'BULL' ? _spxScores.bull : _spxScores.bear;
    await explainSignal(score, _signalDir, _spxData);
  }

  async function sendChat() {
    const input = document.getElementById('ai-chat-input');
    await chat(input?.value?.trim() || '');
  }

  // ── Render entry ──────────────────────────────────────────────────────────

  function render() {
    const el = document.getElementById('pane-ai');
    if (!el) return;
    el.innerHTML = _buildShell();
  }

  return {
    render,
    runMarketBrief, runPositionAssess, runTradePlan, runSignalExplain,
    sendChat, clearChat, setSignalDir,
    setSpxData,
  };

})();
