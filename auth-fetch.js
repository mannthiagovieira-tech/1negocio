// auth-fetch.js · V8 BLOCO 2 · 1Negócio
// Camada central de auth: refresh automático de access_token via otp-refresh.
// Uso:
//   <script src="/auth-fetch.js"></script>
//   const r = await window.OneN.auth.authFetch('/rest/v1/...');
//
// Eventos:
//   1n:session-refreshed · disparado após renovação bem-sucedida
//   1n:session-expired   · disparado quando refresh falha (clearSession já feito)

(function () {
  if (window.OneN && window.OneN.auth) return;

  const STORAGE_KEY = '1n_auth';
  const SUPABASE_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
  const REFRESH_BUFFER = 60; // segundos

  let _refreshPromise = null;

  function getSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      // Compat: alguns HTMLs salvam {token: ...} (legado · sem refresh)
      if (s && (s.access_token || s.token) && (s.refresh_token || s.refresh) && s.user_id) {
        return {
          access_token: s.access_token || s.token,
          refresh_token: s.refresh_token || s.refresh,
          token: s.access_token || s.token,
          refresh: s.refresh_token || s.refresh,
          user_id: s.user_id,
          expires_at: s.expires_at || null,
          is_admin: !!s.is_admin,
          nome: s.nome,
          whatsapp: s.whatsapp,
        };
      }
      return null;
    } catch { return null; }
  }

  function setSession(session) {
    if (!session) return;
    const cur = getSession() || {};
    const merged = Object.assign({}, cur, session);
    // Garante ambos pares (compat antigo + novo)
    if (merged.access_token) { merged.token = merged.access_token; }
    if (merged.refresh_token) { merged.refresh = merged.refresh_token; }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }

  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function isExpired(session) {
    if (!session || !session.expires_at) return false; // sem expires_at = não sabe · trata como válido
    const now = Math.floor(Date.now() / 1000);
    return Number(session.expires_at) - REFRESH_BUFFER <= now;
  }

  async function _doRefresh(session) {
    try {
      const r = await fetch(SUPABASE_URL + '/functions/v1/otp-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
        body: JSON.stringify({ refresh_token: session.refresh_token || session.refresh }),
      });
      if (!r.ok) {
        clearSession();
        try { window.dispatchEvent(new CustomEvent('1n:session-expired', { detail: { reason: 'refresh_invalid', status: r.status } })); } catch {}
        return null;
      }
      const data = await r.json();
      const updated = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token: data.access_token,
        refresh: data.refresh_token,
        user_id: data.user_id || session.user_id,
        expires_at: data.expires_at,
        is_admin: !!data.is_admin,
        nome: session.nome,
        whatsapp: session.whatsapp,
      };
      setSession(updated);
      try { window.dispatchEvent(new CustomEvent('1n:session-refreshed', { detail: { user_id: updated.user_id } })); } catch {}
      return updated;
    } catch (e) {
      clearSession();
      try { window.dispatchEvent(new CustomEvent('1n:session-expired', { detail: { reason: 'network', error: String(e) } })); } catch {}
      return null;
    }
  }

  function refreshNow(session) {
    session = session || getSession();
    if (!session || !(session.refresh_token || session.refresh)) return Promise.resolve(null);
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = _doRefresh(session).finally(() => { _refreshPromise = null; });
    return _refreshPromise;
  }

  async function ensureFreshSession() {
    let s = getSession();
    if (!s) return null;
    if (isExpired(s)) {
      s = await refreshNow(s);
    }
    return s;
  }

  async function authFetch(url, options) {
    options = options || {};
    const session = await ensureFreshSession();
    const headers = new Headers(options.headers || {});
    if (session && session.access_token) {
      headers.set('Authorization', 'Bearer ' + session.access_token);
    }
    if (!headers.has('apikey')) headers.set('apikey', ANON_KEY);

    let resp = await fetch(url, Object.assign({}, options, { headers }));

    // Race: token expirou entre ensureFreshSession e fetch · tenta 1x mais
    if (resp.status === 401 && session) {
      const refreshed = await refreshNow(session);
      if (refreshed && refreshed.access_token) {
        const h2 = new Headers(options.headers || {});
        h2.set('Authorization', 'Bearer ' + refreshed.access_token);
        if (!h2.has('apikey')) h2.set('apikey', ANON_KEY);
        resp = await fetch(url, Object.assign({}, options, { headers: h2 }));
      }
    }
    return resp;
  }

  window.OneN = window.OneN || {};
  window.OneN.auth = {
    SUPABASE_URL, ANON_KEY,
    getSession, setSession, clearSession,
    isExpired, ensureFreshSession, authFetch,
    refreshNow,
  };
})();
