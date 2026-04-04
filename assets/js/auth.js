/* assets/js/auth.js
   Google OAuth login + 7-day session management
*/

const Auth = (() => {

  const SESSION_KEY = 'kairos_session';

  // ── Session ──────────────────────────────────────────────────────────────

  function saveSession(email) {
    const expires = Date.now() + KAIROS_CONFIG.SESSION_DAYS * 864e5;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email, expires }));
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (Date.now() > s.expires) { clearSession(); return null; }
      return s;
    } catch { return null; }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function isAllowed(email) {
    return KAIROS_CONFIG.ALLOWED_EMAILS
      .map(e => e.toLowerCase().trim())
      .includes(email.toLowerCase().trim());
  }

  // ── Google callback ───────────────────────────────────────────────────────

  function handleCredential(response) {
    try {
      // Decode JWT payload
      const payload = JSON.parse(atob(
        response.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')
      ));
      const email = payload.email || '';

      if (!isAllowed(email)) {
        showError(`Access denied for ${email}.\nContact the admin to request access.`);
        return;
      }

      saveSession(email);
      enterApp();

    } catch(e) {
      showError('Login failed. Please try again.');
      console.error('Auth error:', e);
    }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  function showError(msg) {
    const el = document.getElementById('lerr');
    if (el) el.textContent = msg;
  }

  function enterApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    App.init();
  }

  // ── Google Identity Services init ─────────────────────────────────────────

  function initGoogle() {
    if (!window.google?.accounts?.id) {
      // Retry after GSI script loads
      setTimeout(initGoogle, 200);
      return;
    }
    google.accounts.id.initialize({
      client_id: KAIROS_CONFIG.GOOGLE_CLIENT_ID,
      callback:  handleCredential,
      auto_select: false,
    });
    google.accounts.id.renderButton(
      document.getElementById('g-signin-btn'),
      {
        type:  'standard',
        theme: document.documentElement.dataset.theme === 'light'
               ? 'outline' : 'filled_black',
        size:  'large',
        text:  'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 256,
      }
    );
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  function logout() {
    clearSession();
    // Redirect to Cloudflare Access logout — clears Zero Trust session
    window.location.href = '/cdn-cgi/access/logout';
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  function bootstrap() {
    // 1. Check if Cloudflare Access JWT cookie exists
    //    If yes — user already authenticated via Zero Trust, skip login form
    const cfAuth = document.cookie.split(';')
      .find(c => c.trim().startsWith('CF_Authorization='));

    if (cfAuth) {
      // Extract email from CF JWT payload
      try {
        const token   = cfAuth.split('=')[1].trim();
        const payload = JSON.parse(atob(token.split('.')[1]
          .replace(/-/g,'+').replace(/_/g,'/')));
        const email   = payload.email || '';
        if (email && isAllowed(email)) {
          saveSession(email);
          enterApp();
          return;
        }
      } catch(e) {
        console.warn('CF token parse error:', e);
      }
    }

    // 2. Check existing dashboard session
    const session = loadSession();
    if (session) {
      enterApp();
      return;
    }

    // 3. Fallback — show Google login (in case Zero Trust is bypassed)
    initGoogle();
  }

  return { bootstrap, logout, initGoogle };

})();
