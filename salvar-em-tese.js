// salvar-em-tese.js · V8 BLOCO 4 · 1Negócio
// Modal radio · 3 opções: avulso · tese existente · nova tese (criação inline)
// State machine 4 telas: phone → otp → nome → tese
//
// API:
//   window.SET.config({ supabaseUrl, supabaseAnon, getSession, setSession, registrarEvento })
//   window.SET.estado(negocio_id) → Promise<{ esta_salvo, teses, salvar_avulso, notas, salvo_id }>
//   window.SET.abrir(negocio_id, nome_negocio, onSaved?)
//   window.SET.statusButton(negocio_id) → "salvar" | "salvo"

(function () {
  if (window.SET) return;

  const cfg = {
    supabaseUrl: '',
    supabaseAnon: '',
    getSession: () => null,
    setSession: (s) => {},
    registrarEvento: () => {},
  };

  const cache = new Map();

  function _af(url, opts) {
    if (window.OneN && window.OneN.auth && window.OneN.auth.authFetch) {
      return window.OneN.auth.authFetch(url, opts);
    }
    return fetch(url, opts);
  }
  function _getSessionEffective() {
    if (window.OneN && window.OneN.auth && window.OneN.auth.getSession) {
      return window.OneN.auth.getSession();
    }
    return cfg.getSession ? cfg.getSession() : null;
  }

  const $ = (s, root) => (root || document).querySelector(s);
  const _h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function _primeirasPalavras(t, n) {
    n = n || 2;
    return String(t || '').trim().split(/\s+/).slice(0, n).join(' ');
  }
  function _truncate(s, n) {
    if (!s) return 'este negócio';
    s = String(s).trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  async function _rpcEstado(neg_id, sess) {
    if (!sess || !sess.user_id) return null;
    try {
      const url = cfg.supabaseUrl + '/rest/v1/rpc/negocio_salvo_status';
      const r = await _af(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ p_user_id: sess.user_id, p_negocio_id: neg_id }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      return Array.isArray(data) && data.length ? data[0] : null;
    } catch { return null; }
  }

  async function _carregarTeses(sess) {
    if (!sess || !sess.user_id) return [];
    try {
      // V8 B4 fix: coluna é created_at (não criado_em)
      const url = cfg.supabaseUrl + '/rest/v1/teses_investimento'
        + '?usuario_id=eq.' + sess.user_id
        + '&status=eq.ativa'
        + '&select=id,codigo,titulo,descricao_curta'
        + '&order=created_at.desc&limit=50';
      const r = await _af(url, { headers: { 'Content-Type': 'application/json' } });
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  }

  async function estado(negocio_id) {
    const sess = _getSessionEffective();
    if (!sess || !sess.user_id) {
      cache.set(negocio_id, { esta_salvo: false });
      return { esta_salvo: false };
    }
    const r = await _rpcEstado(negocio_id, sess);
    const out = {
      esta_salvo: !!(r && r.esta_salvo),
      salvo_id: r ? r.salvo_id : null,
      teses: r ? (r.teses_atreladas || []) : [],
      salvar_avulso: r ? !!r.salvar_avulso : false,
      notas: r ? (r.notas || '') : '',
    };
    cache.set(negocio_id, out);
    return out;
  }

  function statusButton(negocio_id) {
    const c = cache.get(negocio_id);
    return c && c.esta_salvo ? 'salvo' : 'salvar';
  }
  function label(negocio_id) {
    return statusButton(negocio_id) === 'salvo' ? '♥ Salvo' : '♡ Salvar em tese';
  }

  function _injetarModal() {
    if ($('#set-overlay')) return;
    const css = `
.set-overlay{position:fixed;inset:0;z-index:9999;background:rgba(10,21,16,.7);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:16px}
.set-overlay.open{display:flex}
.set-modal{background:#fff;color:#0a1510;max-width:520px;width:100%;border-radius:24px;padding:28px 28px 22px;box-shadow:0 20px 60px rgba(0,0,0,.25);max-height:92vh;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif}
.set-h{font-family:'Syne',sans-serif;font-weight:700;font-size:22px;letter-spacing:-.01em;margin-bottom:6px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.set-sub{font-size:13px;color:#5a6661;line-height:1.5;margin-bottom:14px}
.set-section-lbl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7a8581;margin:14px 0 10px;font-family:'JetBrains Mono',ui-monospace,monospace}
.set-input{width:100%;border:1px solid #e5e7e5;border-radius:12px;padding:14px 16px;font:inherit;font-size:15px;color:#0a1510;box-sizing:border-box}
.set-input:focus{outline:none;border-color:#0a1510}
.set-textarea{width:100%;border:1px solid #e5e7e5;border-radius:12px;padding:12px 14px;font:inherit;font-size:13px;color:#0a1510;resize:vertical;min-height:64px;box-sizing:border-box}
.set-counter{text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9px;color:#7a8581;margin-top:4px}

.set-opt{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1.5px solid #e5e7e5;border-radius:14px;margin-bottom:10px;cursor:pointer;transition:.15s;background:#fff}
.set-opt:hover{background:#f7f7f5}
.set-opt.active{background:#eafff0;border-color:#0a1510}
.set-opt.disabled{opacity:.55;cursor:not-allowed;background:#f7f7f5}
.set-opt input[type=radio]{margin-top:3px;flex-shrink:0;accent-color:#0a1510;width:16px;height:16px}
.set-opt-body{flex:1;min-width:0}
.set-opt-tit{font-family:'Syne',sans-serif;font-weight:600;font-size:15px;color:#0a1510;line-height:1.3}
.set-opt-sub{font-size:12px;color:#5a6661;margin-top:3px;line-height:1.4}
.set-opt-expand{margin-top:14px;padding-top:14px;border-top:1px dashed #e5e7e5}

.set-tese-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e5e7e5;border-radius:10px;margin-bottom:6px;cursor:pointer;font-size:13px}
.set-tese-row:hover{background:#f7f7f5}
.set-tese-row.checked{background:#eafff0;border-color:#3dff95}
.set-tese-row input{accent-color:#0a1510}
.set-tese-row .cod{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.06em;color:#3dff95;font-weight:600;flex-shrink:0}
.set-tese-row .tit{flex:1;color:#0a1510;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.set-foot{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid #e5e7e5}
.set-btn{padding:14px;border-radius:14px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;border:1px solid #e5e7e5;background:#fff;color:#0a1510;transition:.15s}
.set-btn:hover{background:#f7f7f5}
.set-btn.primary{background:#0a1510;color:#fff;border-color:#0a1510}
.set-btn.primary:hover{background:#1a2520}
.set-btn:disabled{opacity:.45;cursor:not-allowed}
.set-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0a1510;color:#3dff95;padding:14px 22px;border-radius:14px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.06em;z-index:10000;box-shadow:0 10px 30px rgba(0,0,0,.3);opacity:0;transition:.25s;pointer-events:none}
.set-toast.show{opacity:1}
.set-err{color:#dc2626;font-size:12px;margin-top:6px;min-height:16px}
.set-info{font-size:12px;color:#5a6661;margin-top:8px;line-height:1.5}
.set-link{color:#0a1510;text-decoration:underline;font-weight:600;cursor:pointer;background:none;border:0;padding:0;font:inherit}
`;
    const styleEl = document.createElement('style');
    styleEl.id = 'set-styles'; styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const html = `
      <div class="set-overlay" id="set-overlay" onclick="if(event.target===this) SET._fechar()">
        <div class="set-modal" id="set-modal">
          <div class="set-h" id="set-h">Salvar este negócio</div>
          <div id="set-stage"></div>
          <div class="set-foot" id="set-foot">
            <button class="set-btn" onclick="SET._fechar()">Cancelar</button>
            <button class="set-btn primary" id="set-submit">Continuar</button>
          </div>
        </div>
      </div>
      <div class="set-toast" id="set-toast"></div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
  }

  let _ctx = null;

  function _toast(msg, err) {
    const t = $('#set-toast'); if (!t) return;
    t.textContent = msg;
    t.style.color = err ? '#ff8b7a' : '#3dff95';
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function _fechar() { const o = $('#set-overlay'); if (o) o.classList.remove('open'); _ctx = null; }

  // ───── ABRIR ─────
  async function abrir(negocio_id, nome_negocio, onSaved) {
    _injetarModal();
    let sess = _getSessionEffective();
    if (sess && window.OneN && window.OneN.auth && window.OneN.auth.ensureFreshSession) {
      sess = await window.OneN.auth.ensureFreshSession();
    }
    _ctx = {
      negocio_id,
      nome_negocio: _truncate(nome_negocio, 80),
      nome_negocio_full: nome_negocio || 'este negócio',
      sess, teses: [],
      estadoAtual: { esta_salvo: false, teses: [], salvar_avulso: false, notas: '' },
      onSaved, tela: null,
    };

    $('#set-overlay').classList.add('open');

    if (sess && sess.user_id) {
      try { cfg.registrarEvento && cfg.registrarEvento('abrir_modal_salvar', { entidade_tipo: 'negocio', entidade_id: negocio_id }); } catch {}
      await _abrirTelaTese();
    } else {
      try { cfg.registrarEvento && cfg.registrarEvento('abrir_modal_salvar', { entidade_tipo: 'negocio', entidade_id: negocio_id, deslogado: true }); } catch {}
      _abrirTelaPhone();
    }
  }

  // ───── TELA: PHONE ─────
  function _abrirTelaPhone(prefilled) {
    if (!_ctx) return;
    _ctx.tela = 'phone';
    $('#set-h').textContent = `Salvar ${_primeirasPalavras(_ctx.nome_negocio, 2)}`;
    $('#set-stage').innerHTML = `
      <div class="set-info">Vamos salvar este negócio na sua conta. Se você ainda não tem · criamos uma agora.</div>
      <div class="set-section-lbl">Seu WhatsApp</div>
      <input class="set-input" id="set-phone" type="tel" inputmode="tel" maxlength="15" placeholder="(11) 91234-5678" value="${_h(prefilled || '')}">
      <div class="set-err" id="set-err-phone"></div>
    `;
    const inp = $('#set-phone');
    inp.addEventListener('input', () => {
      let v = inp.value.replace(/\D/g, '');
      if (v.length > 11) v = v.slice(0, 11);
      if (v.length > 7) v = '(' + v.slice(0, 2) + ') ' + v.slice(2, 7) + '-' + v.slice(7);
      else if (v.length > 2) v = '(' + v.slice(0, 2) + ') ' + v.slice(2);
      else if (v.length > 0) v = '(' + v;
      inp.value = v;
    });
    setTimeout(() => inp.focus(), 60);
    const btn = $('#set-submit'); btn.textContent = 'Continuar'; btn.disabled = false;
    btn.onclick = _submitPhone;
  }

  async function _submitPhone() {
    const inp = $('#set-phone');
    const err = $('#set-err-phone');
    const raw = inp.value.replace(/\D/g, '');
    if (raw.length !== 10 && raw.length !== 11) { err.textContent = 'WhatsApp precisa ter DDD + número (10 ou 11 dígitos).'; return; }
    const phoneSemPlus = '55' + raw;
    err.textContent = '';
    const btn = $('#set-submit'); btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      const r = await fetch(cfg.supabaseUrl + '/functions/v1/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseAnon },
        body: JSON.stringify({ whatsapp: phoneSemPlus }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) { err.textContent = data.error || 'Erro ao enviar código.'; btn.disabled = false; btn.textContent = 'Continuar'; return; }
      try { cfg.registrarEvento && cfg.registrarEvento('iniciar_otp_salvar', { entidade_tipo: 'negocio', entidade_id: _ctx.negocio_id }); } catch {}
      _ctx.phoneSemPlus = phoneSemPlus;
      _ctx.phoneFormatado = inp.value;
      _abrirTelaOtp();
    } catch (e) {
      err.textContent = 'Erro de rede. Tente novamente.';
      btn.disabled = false; btn.textContent = 'Continuar';
    }
  }

  // ───── TELA: OTP ─────
  function _abrirTelaOtp() {
    if (!_ctx) return;
    _ctx.tela = 'otp';
    $('#set-h').textContent = 'Validar código';
    $('#set-stage').innerHTML = `
      <div class="set-info">Código enviado pra ${_h(_ctx.phoneFormatado)}</div>
      <div class="set-section-lbl">Digite os 6 dígitos</div>
      <input class="set-input" id="set-otp" type="tel" inputmode="numeric" maxlength="6" placeholder="000000" style="letter-spacing:.4em;text-align:center;font-size:20px">
      <div class="set-err" id="set-err-otp"></div>
      <div style="margin-top:10px"><button class="set-link" onclick="SET._abrirTelaPhoneVoltar()">← Trocar WhatsApp</button></div>
    `;
    const inp = $('#set-otp');
    inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); });
    setTimeout(() => inp.focus(), 60);
    const btn = $('#set-submit'); btn.textContent = 'Validar'; btn.disabled = false;
    btn.onclick = _submitOtp;
  }

  async function _submitOtp() {
    const inp = $('#set-otp');
    const err = $('#set-err-otp');
    const codigo = (inp.value || '').replace(/\D/g, '');
    if (codigo.length !== 6) { err.textContent = 'Código precisa de 6 dígitos.'; return; }
    err.textContent = '';
    const btn = $('#set-submit'); btn.disabled = true; btn.textContent = 'Validando...';
    try {
      const r = await fetch(cfg.supabaseUrl + '/functions/v1/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseAnon },
        body: JSON.stringify({ whatsapp: _ctx.phoneSemPlus, codigo }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) { err.textContent = data.error || 'Código incorreto.'; btn.disabled = false; btn.textContent = 'Validar'; return; }
      const novaSess = {
        access_token: data.access_token, refresh_token: data.refresh_token,
        token: data.access_token, refresh: data.refresh_token,
        user_id: data.user_id, expires_at: data.expires_at,
        is_admin: !!data.is_admin, whatsapp: _ctx.phoneSemPlus,
      };
      if (window.OneN && window.OneN.auth && window.OneN.auth.setSession) {
        window.OneN.auth.setSession(novaSess);
      } else { try { cfg.setSession && cfg.setSession(novaSess); } catch {} }
      _ctx.sess = novaSess;
      try { cfg.registrarEvento && cfg.registrarEvento('completar_otp_salvar', { entidade_tipo: 'negocio', entidade_id: _ctx.negocio_id, usuario_novo: !!data.usuario_novo }); } catch {}
      if (data.usuario_novo || !data.tem_nome) _abrirTelaNome();
      else await _abrirTelaTese();
    } catch (e) {
      err.textContent = 'Erro de rede. Tente novamente.';
      btn.disabled = false; btn.textContent = 'Validar';
    }
  }
  function _abrirTelaPhoneVoltar() { _abrirTelaPhone(_ctx && _ctx.phoneFormatado); }

  // ───── TELA: NOME ─────
  function _abrirTelaNome() {
    if (!_ctx) return;
    _ctx.tela = 'nome';
    $('#set-h').textContent = 'Como podemos te chamar?';
    $('#set-stage').innerHTML = `
      <div class="set-info">Seu nome aparece pro consultor 1Negócio quando você manda mensagem.</div>
      <div class="set-section-lbl">Nome</div>
      <input class="set-input" id="set-nome" type="text" maxlength="60" placeholder="Ex: Ana Silva">
      <div class="set-err" id="set-err-nome"></div>
    `;
    setTimeout(() => $('#set-nome').focus(), 60);
    const btn = $('#set-submit'); btn.textContent = 'Continuar'; btn.disabled = false;
    btn.onclick = _submitNome;
  }
  async function _submitNome() {
    const inp = $('#set-nome');
    const err = $('#set-err-nome');
    const nome = (inp.value || '').trim();
    if (nome.length < 2) { err.textContent = 'Diga seu nome (mínimo 2 caracteres).'; return; }
    err.textContent = '';
    const btn = $('#set-submit'); btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      const r = await _af(cfg.supabaseUrl + '/auth/v1/user', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { nome } }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        err.textContent = data.msg || 'Erro ao salvar nome.';
        btn.disabled = false; btn.textContent = 'Continuar'; return;
      }
      _ctx.sess.nome = nome;
      if (window.OneN && window.OneN.auth) window.OneN.auth.setSession(_ctx.sess);
      try { cfg.registrarEvento && cfg.registrarEvento('criar_conta_salvar', { entidade_tipo: 'negocio', entidade_id: _ctx.negocio_id }); } catch {}
      await _abrirTelaTese();
    } catch (e) {
      err.textContent = 'Erro de rede. Tente novamente.';
      btn.disabled = false; btn.textContent = 'Continuar';
    }
  }

  // ───── TELA: TESE (3 opções radio) ─────
  async function _abrirTelaTese() {
    if (!_ctx) return;
    _ctx.tela = 'tese';
    const sess = _ctx.sess;
    const [estadoAtual, teses] = await Promise.all([estado(_ctx.negocio_id), _carregarTeses(sess)]);
    _ctx.teses = teses;
    _ctx.estadoAtual = estadoAtual;

    // V8 B4 · pegar nome do user pra header personalizado
    let nomeUser = sess && sess.nome;
    if (!nomeUser) {
      try {
        const r = await _af(cfg.supabaseUrl + '/auth/v1/user', { headers: { 'Content-Type': 'application/json' } });
        if (r.ok) {
          const u = await r.json();
          nomeUser = (u.user_metadata && (u.user_metadata.nome || u.user_metadata.full_name)) || '';
          if (nomeUser && window.OneN && window.OneN.auth) window.OneN.auth.setSession(Object.assign({}, sess, { nome: nomeUser }));
        }
      } catch {}
    }
    const primeiroNome = (nomeUser || 'Você').split(/\s+/)[0];
    const negPrev = _primeirasPalavras(_ctx.nome_negocio_full, 2);

    if (estadoAtual.esta_salvo) {
      $('#set-h').textContent = `Editar onde ${negPrev} está salvo`;
    } else {
      $('#set-h').textContent = `${primeiroNome}, vamos salvar ${negPrev}`;
    }

    // Determinar opção pré-selecionada
    let optInicial = 'avulso';
    if (estadoAtual.esta_salvo) {
      optInicial = (estadoAtual.teses && estadoAtual.teses.length > 0) ? 'tese' : 'avulso';
    } else if (teses.length === 0) {
      optInicial = 'avulso';
    }

    const teseAtualPrimeira = (estadoAtual.teses && estadoAtual.teses[0]) || (teses[0] && teses[0].id);
    const semTeses = teses.length === 0;

    let bodyHtml = `
      <div class="set-section-lbl">Onde salvar?</div>

      <label class="set-opt ${optInicial==='avulso'?'active':''}" data-opt="avulso">
        <input type="radio" name="set-opt" value="avulso" ${optInicial==='avulso'?'checked':''}>
        <div class="set-opt-body">
          <div class="set-opt-tit">De forma avulsa na sua página</div>
          <div class="set-opt-sub">Salva sem vincular a nenhuma tese · você revisa depois.</div>
        </div>
      </label>

      <label class="set-opt ${optInicial==='tese'?'active':''} ${semTeses?'disabled':''}" data-opt="tese">
        <input type="radio" name="set-opt" value="tese" ${optInicial==='tese'?'checked':''} ${semTeses?'disabled':''}>
        <div class="set-opt-body">
          <div class="set-opt-tit">Em uma tese existente</div>
          <div class="set-opt-sub">${semTeses ? 'Você ainda não tem teses' : 'Vincular a uma das suas teses ativas'}</div>
          <div id="set-teses-list" class="set-opt-expand" style="display:${optInicial==='tese'?'block':'none'}">
            ${teses.map(t => `
              <label class="set-tese-row ${(estadoAtual.teses||[]).includes(t.id) || t.id===teseAtualPrimeira ? 'checked':''}">
                <input type="radio" name="set-tese-id" value="${t.id}" ${(estadoAtual.teses||[]).includes(t.id) ? 'checked' : (!estadoAtual.esta_salvo && t.id===teseAtualPrimeira ? 'checked' : '')}>
                <span class="cod">${_h(t.codigo || '')}</span>
                <span class="tit">${_h(t.titulo || '—')}</span>
              </label>
            `).join('')}
          </div>
        </div>
      </label>

      <label class="set-opt ${optInicial==='nova'?'active':''}" data-opt="nova">
        <input type="radio" name="set-opt" value="nova" ${optInicial==='nova'?'checked':''}>
        <div class="set-opt-body">
          <div class="set-opt-tit">Em uma nova tese</div>
          <div class="set-opt-sub">Criar tese rápida e já vincular este negócio.</div>
          <div id="set-nova-form" class="set-opt-expand" style="display:${optInicial==='nova'?'block':'none'}">
            <div style="margin-bottom:10px">
              <label style="display:block;font-size:11px;font-weight:600;color:#5a6661;margin-bottom:4px">Título da tese</label>
              <input class="set-input" id="set-nova-titulo" type="text" maxlength="80" placeholder="Ex: Pousadas em Floripa">
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:#5a6661;margin-bottom:4px">Descrição curta <span style="color:#7a8581;font-weight:400">(opcional · pra matchmaking)</span></label>
              <input class="set-input" id="set-nova-desc" type="text" maxlength="80" placeholder="Ex: Pousadas com operação independente do dono">
            </div>
            <div class="set-err" id="set-err-nova"></div>
          </div>
        </div>
      </label>

      <div class="set-section-lbl">Notas pessoais (opcional)</div>
      <textarea class="set-textarea" id="set-notas" maxlength="500" placeholder="Por que você se interessou? Pontos de atenção?">${_h(estadoAtual.notas || '')}</textarea>
      <div class="set-counter"><span id="set-notas-count">${(estadoAtual.notas || '').length}</span> / 500</div>
    `;
    $('#set-stage').innerHTML = bodyHtml;

    // Listeners
    document.querySelectorAll('input[name="set-opt"]').forEach(r => {
      r.addEventListener('change', _atualizarOpt);
    });
    document.querySelectorAll('label.set-opt').forEach(lbl => {
      lbl.addEventListener('click', (e) => {
        if (lbl.classList.contains('disabled')) return;
        const opt = lbl.dataset.opt;
        if (e.target.tagName !== 'INPUT' && e.target.closest('input')==null) {
          // Click no label fora do input · ativar radio principal
          const r = lbl.querySelector('input[name="set-opt"]');
          if (r && !r.disabled) { r.checked = true; _atualizarOpt(); }
        }
      });
    });
    document.querySelectorAll('input[name="set-tese-id"]').forEach(r => {
      r.addEventListener('change', () => {
        document.querySelectorAll('#set-teses-list .set-tese-row').forEach(row => {
          row.classList.toggle('checked', row.querySelector('input').checked);
        });
      });
    });
    const txta = $('#set-notas');
    if (txta) txta.addEventListener('input', () => { const c = $('#set-notas-count'); if (c) c.textContent = txta.value.length; });

    _atualizarOpt();
    const btn = $('#set-submit');
    btn.textContent = estadoAtual.esta_salvo ? 'Atualizar' : 'Salvar';
    btn.onclick = _submitTese;
  }

  function _atualizarOpt() {
    const opt = (document.querySelector('input[name="set-opt"]:checked') || {}).value || 'avulso';
    document.querySelectorAll('label.set-opt').forEach(lbl => {
      lbl.classList.toggle('active', lbl.dataset.opt === opt);
    });
    const list = $('#set-teses-list'); if (list) list.style.display = opt === 'tese' ? 'block' : 'none';
    const form = $('#set-nova-form'); if (form) form.style.display = opt === 'nova' ? 'block' : 'none';
    const btn = $('#set-submit'); if (btn) btn.disabled = false;
  }

  async function _submitTese() {
    if (!_ctx) return;
    const btn = $('#set-submit');
    btn.disabled = true; btn.textContent = 'Salvando...';

    const sess = _ctx.sess;
    const opt = (document.querySelector('input[name="set-opt"]:checked') || {}).value || 'avulso';
    const notas = ($('#set-notas') && $('#set-notas').value.trim()) || null;
    let tese_ids = [];
    let novaTeseCriada = null;

    try {
      if (opt === 'tese') {
        const sel = document.querySelector('input[name="set-tese-id"]:checked');
        if (!sel) { _toast('Escolha uma tese da lista', true); btn.disabled = false; btn.textContent = 'Salvar'; return; }
        tese_ids = [sel.value];
      } else if (opt === 'nova') {
        const titulo = ($('#set-nova-titulo').value || '').trim();
        const descCurta = ($('#set-nova-desc').value || '').trim();
        const errEl = $('#set-err-nova');
        if (titulo.length < 5 || titulo.length > 80) {
          if (errEl) errEl.textContent = 'Título precisa de 5 a 80 caracteres.';
          btn.disabled = false; btn.textContent = 'Salvar'; return;
        }
        if (descCurta && (descCurta.length < 3 || descCurta.length > 80)) {
          if (errEl) errEl.textContent = 'Descrição curta precisa de 3 a 80 caracteres (ou deixe vazio).';
          btn.disabled = false; btn.textContent = 'Salvar'; return;
        }
        // INSERT teses_investimento
        const payload = {
          usuario_id: sess.user_id,
          titulo, descricao_curta: descCurta || null,
          status: 'ativa', origem: 'real',
          setores: [], formas_atuacao: [],
          localizacao_tipo: 'brasil_todo', valor_alvo: null,
          whatsapp: sess.whatsapp || null,
          nome: sess.nome || null,
        };
        const r = await _af(cfg.supabaseUrl + '/rest/v1/teses_investimento?select=id,codigo,titulo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          if (errEl) errEl.textContent = 'Erro ao criar tese: ' + (txt.slice(0, 120) || r.status);
          btn.disabled = false; btn.textContent = 'Salvar'; return;
        }
        const arr = await r.json();
        novaTeseCriada = arr[0];
        tese_ids = [novaTeseCriada.id];
        try { cfg.registrarEvento && cfg.registrarEvento('cadastrar_tese', { entidade_tipo: 'tese', entidade_id: novaTeseCriada.id, meta: { origem_modal_salvar: true } }); } catch {}
      }

      // ensureNegocioSalvo (UPSERT)
      let salvo_id = _ctx.estadoAtual.salvo_id;
      const teses_atuais = new Set(_ctx.estadoAtual.teses || []);

      if (!salvo_id) {
        const rIns = await _af(cfg.supabaseUrl + '/rest/v1/negocios_salvos?on_conflict=usuario_id,negocio_id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation,resolution=merge-duplicates' },
          body: JSON.stringify({ usuario_id: sess.user_id, negocio_id: _ctx.negocio_id, notas }),
        });
        if (!rIns.ok) {
          const txt = await rIns.text().catch(() => '');
          throw new Error('insert ' + rIns.status + (txt ? ': ' + txt.slice(0, 120) : ''));
        }
        const ar = await rIns.json();
        salvo_id = ar[0] && ar[0].id;
      } else {
        await _af(cfg.supabaseUrl + '/rest/v1/negocios_salvos?id=eq.' + salvo_id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notas }),
        });
      }

      // Diff M:N
      const novasIds = tese_ids.filter(t => !teses_atuais.has(t));
      if (novasIds.length > 0) {
        const rows = novasIds.map(t => ({ negocio_salvo_id: salvo_id, tese_id: t }));
        await _af(cfg.supabaseUrl + '/rest/v1/negocios_salvos_teses', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rows),
        });
      }
      const removerIds = [...teses_atuais].filter(t => !tese_ids.includes(t));
      for (const t of removerIds) {
        await _af(cfg.supabaseUrl + '/rest/v1/negocios_salvos_teses?negocio_salvo_id=eq.' + salvo_id + '&tese_id=eq.' + t, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        cfg.registrarEvento && cfg.registrarEvento('salvar_negocio', {
          entidade_tipo: 'negocio', entidade_id: _ctx.negocio_id,
          teses_atreladas: tese_ids, salvar_avulso: opt === 'avulso',
          opcao_modal: opt, nova_tese: !!novaTeseCriada,
          notas_length: (notas || '').length,
        });
      } catch {}

      cache.set(_ctx.negocio_id, {
        esta_salvo: true, salvo_id,
        teses: tese_ids, salvar_avulso: opt === 'avulso', notas: notas || '',
      });

      if (novaTeseCriada) _toast('Tese criada e negócio vinculado');
      else _toast(opt === 'avulso' ? 'Salvo sem vínculo (avulso)' : 'Negócio salvo na tese');

      if (_ctx.onSaved) _ctx.onSaved();
      _fechar();
    } catch (e) {
      _toast('Erro: ' + (e.message || 'tente novamente'), true);
      btn.disabled = false; btn.textContent = _ctx.estadoAtual.esta_salvo ? 'Atualizar' : 'Salvar';
    }
  }

  window.SET = {
    config(opts) { Object.assign(cfg, opts || {}); },
    estado, statusButton, label, abrir,
    _fechar, _abrirTelaPhoneVoltar,
  };
})();
