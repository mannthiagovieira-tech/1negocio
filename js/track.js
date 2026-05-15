// Helper de tracking — window.track(tipo, metadata)
// Pré-requisito: window.ANUNCIO_CODIGO definido na página (ex: 1N-AN-XXXXX)

(function () {
  function getOrCreateVisitorId() {
    let vid = localStorage.getItem("1n_visitor_id");
    if (!vid) {
      vid = "v_" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      localStorage.setItem("1n_visitor_id", vid);
    }
    return vid;
  }

  function getOrCreateSessionId() {
    let sid = sessionStorage.getItem("1n_session_id");
    if (!sid) {
      sid = "s_" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      sessionStorage.setItem("1n_session_id", sid);
    }
    return sid;
  }

  function getUtmParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
    };
  }

  window.track = function (tipo, metadata) {
    metadata = metadata || {};
    const anuncio_codigo = window.ANUNCIO_CODIGO || metadata.anuncio_codigo;
    if (!anuncio_codigo) {
      console.warn("[track] anuncio_codigo não definido. Skip evento:", tipo);
      return;
    }

    const utm = getUtmParams();

    const payload = {
      anuncio_codigo: anuncio_codigo,
      tipo: tipo,
      session_id: getOrCreateSessionId(),
      visitor_id: getOrCreateVisitorId(),
      referrer: document.referrer || null,
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      metadata: metadata,
    };

    // Fire and forget — não bloqueia UX
    fetch("https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/track_evento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function (err) { console.warn("[track] erro:", err); });
  };

  console.log('[track] Helper carregado. Use window.track("evento", metadata)');
})();
