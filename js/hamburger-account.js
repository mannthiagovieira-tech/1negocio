// hamburger-account.js · V8 BLOCO 8.5 · 1Negócio
// Card "ENTRAR" dinâmico do menu hamburger · reusa em qualquer página
// que tenha o markup padrão do drawer:
//
//   <a class="drawer-link enter" id="drawer-auth-link" href="/portal-usuario.html">
//     <div class="drawer-avatar" id="drawer-avatar" style="display:none"></div>
//     <div>
//       <div class="drawer-link-t" id="drawer-auth-t">ENTRAR</div>
//       <div class="drawer-link-s" id="drawer-auth-s">Acesse sua conta</div>
//     </div>
//     <svg class="enter-icon" ...>...</svg>
//   </a>
//
//   <a class="drawer-link signout" id="drawer-signout" href="#"
//      onclick="event.preventDefault();HamburgerAccount.signOut()"
//      style="display:none">
//     <div>
//       <div class="drawer-link-t">Sair da conta</div>
//       <div class="drawer-link-s">Encerra sua sessão neste navegador</div>
//     </div>
//   </a>
//
// API:
//   window.HamburgerAccount.refresh()  → re-aplica estado (após login/logout)
//   window.HamburgerAccount.signOut()  → limpa storage e redireciona pra /
//
// Detecção de sessão · ordem:
//   1. window.OneN.auth.getSession() · padrão V8 B2 (key 1n_auth)
//   2. localStorage '1n_auth' direto · se OneN não carregou
//   3. localStorage 'sb_access_token' · legacy (compat)
//
// Auto-refresh ouvindo 1n:session-refreshed e 1n:session-expired do auth-fetch.js.

(function () {
  if (window.HamburgerAccount) return;

  const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

  function _parseJwt(token) {
    try {
      const p = token.split('.');
      if (p.length !== 3) return null;
      const b64 = p[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)));
    } catch (e) { return null; }
  }

  function _tokenValido(token) {
    if (!token) return null;
    const dec = _parseJwt(token);
    if (!dec) return null;
    const now = Math.floor(Date.now() / 1000);
    if (dec.exp && dec.exp < now) return null;
    return dec;
  }

  function _primeiroNome(nome) {
    const s = String(nome || '').trim();
    if (!s) return '';
    return s.split(/\s+/)[0];
  }

  function _inicial(nome) {
    const s = String(nome || '').trim();
    if (!s) return '·';
    return s.charAt(0).toUpperCase();
  }

  // Detecta sessão · prefere V8 B2 (1n_auth via OneN.auth) · fallback legacy
  function _getSession() {
    // 1. via OneN.auth (V8 B2)
    try {
      if (window.OneN && window.OneN.auth && typeof window.OneN.auth.getSession === 'function') {
        const sess = window.OneN.auth.getSession();
        if (sess && sess.token && _tokenValido(sess.token)) {
          return { token: sess.token, nome: sess.nome || null, user_id: sess.user_id || null, source: 'onen' };
        }
      }
    } catch (e) {}
    // 2. localStorage 1n_auth direto
    try {
      const raw = localStorage.getItem('1n_auth');
      if (raw) {
        const j = JSON.parse(raw);
        if (j && j.token && _tokenValido(j.token)) {
          return { token: j.token, nome: j.nome || null, user_id: j.user_id || null, source: '1n_auth' };
        }
      }
    } catch (e) {}
    // 3. legacy sb_access_token
    try {
      const tk = localStorage.getItem('sb_access_token');
      const dec = _tokenValido(tk);
      if (dec) {
        const meta = dec.user_metadata || {};
        return { token: tk, nome: meta.nome || meta.full_name || null, user_id: dec.sub || null, source: 'sb_legacy' };
      }
    } catch (e) {}
    return null;
  }

  async function _buscarNomeRemoto(token, userId) {
    if (!userId) return null;
    try {
      const r = await fetch(SB_URL + '/rest/v1/usuarios?select=nome&id=eq.' + encodeURIComponent(userId) + '&limit=1', {
        headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token }
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (Array.isArray(d) && d[0] && d[0].nome) return d[0].nome;
    } catch (e) {}
    return null;
  }

  function _renderLogado(nomeCompleto) {
    const link = document.getElementById('drawer-auth-link');
    const av = document.getElementById('drawer-avatar');
    const t = document.getElementById('drawer-auth-t');
    const s = document.getElementById('drawer-auth-s');
    const out = document.getElementById('drawer-signout');
    if (!link || !t || !s) return; // página sem markup do drawer · noop
    const primeiro = _primeiroNome(nomeCompleto) || 'Sua conta';
    link.setAttribute('href', '/portal-usuario.html');
    link.classList.add('logged');
    if (av) {
      av.textContent = _inicial(nomeCompleto);
      av.style.display = '';
    }
    t.textContent = primeiro;
    s.textContent = 'Acesse seus negócios';
    if (out) out.style.display = '';
  }

  function _renderDeslogado() {
    const link = document.getElementById('drawer-auth-link');
    const av = document.getElementById('drawer-avatar');
    const t = document.getElementById('drawer-auth-t');
    const s = document.getElementById('drawer-auth-s');
    const out = document.getElementById('drawer-signout');
    if (!link || !t || !s) return; // página sem markup do drawer · noop
    link.setAttribute('href', '/portal-usuario.html');
    link.classList.remove('logged');
    if (av) av.style.display = 'none';
    t.textContent = 'ENTRAR';
    s.textContent = 'Acesse sua conta';
    if (out) out.style.display = 'none';
  }

  async function refresh() {
    const sess = _getSession();
    if (!sess) {
      _renderDeslogado();
      return;
    }
    let nome = sess.nome;
    if (!nome) {
      // Tenta nome via JWT user_metadata
      const dec = _parseJwt(sess.token) || {};
      const meta = dec.user_metadata || {};
      nome = meta.nome || meta.full_name || null;
    }
    if (!nome) nome = await _buscarNomeRemoto(sess.token, sess.user_id);
    _renderLogado(nome || 'Sua conta');
  }

  function signOut() {
    try {
      localStorage.removeItem('1n_auth');
      localStorage.removeItem('sb_access_token');
      localStorage.removeItem('sb_refresh_token');
    } catch (e) {}
    try {
      if (window.OneN && window.OneN.auth && typeof window.OneN.auth.clearSession === 'function') {
        window.OneN.auth.clearSession();
      }
    } catch (e) {}
    window.location.href = '/';
  }

  function _boot() {
    refresh();
    // Re-aplica quando a sessão é refreshada ou expira
    window.addEventListener('1n:session-refreshed', refresh);
    window.addEventListener('1n:session-expired', () => _renderDeslogado());
  }

  window.HamburgerAccount = { refresh, signOut };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }
})();
