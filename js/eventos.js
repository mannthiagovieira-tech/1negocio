/* eventos.js · BLOCO 3 v6 · 1negocio.com.br
   Módulo de tracking. Expõe window.registrarEvento(tipo, dados).
   Adapta payload pro schema legado polimórfico de eventos_usuario:
   { tipo, entidade_tipo?, entidade_id?, meta? }
   Server-side popula usuario_id (JWT) · sessao_id (header) · ip · user_agent.
   Fire-and-forget · não bloqueia UX. */

(function(){
  'use strict';
  var SUPABASE_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
  var SESSION_KEY = '1n_session_id';
  var ENDPOINT = SUPABASE_URL + '/functions/v1/registrar-evento';

  function uuid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }

  function getSessionId(){
    try {
      var id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = uuid();
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch(e){ return uuid(); }
  }

  function getAccessToken(){
    try { return localStorage.getItem('sb_access_token') || null; } catch(e){ return null; }
  }

  /**
   * registrarEvento(tipo, dados)
   * @param {string} tipo · um dos 15 v6 + termo_sigilo_assinado legado
   * @param {object} dados · { entidade_tipo?, entidade_id?, meta?, duracao_ms? }
   */
  function registrarEvento(tipo, dados){
    if (!tipo) return;
    dados = dados || {};
    var headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'X-Session-Id': getSessionId()
    };
    var token = getAccessToken();
    headers['Authorization'] = 'Bearer ' + (token || SUPABASE_ANON);
    var body = JSON.stringify({
      tipo: tipo,
      entidade_tipo: dados.entidade_tipo || null,
      entidade_id: dados.entidade_id || null,
      meta: dados.meta || {},
      duracao_ms: dados.duracao_ms != null ? dados.duracao_ms : null
    });
    try {
      // fire-and-forget · não aguardamos resposta
      fetch(ENDPOINT, { method: 'POST', headers: headers, body: body, keepalive: true })
        .catch(function(e){ /* silencioso */ });
    } catch(e){ /* silencioso · tracking nunca pode quebrar UX */ }
  }

  window.registrarEvento = registrarEvento;
  window.__1n_eventos_ready = true;
})();
