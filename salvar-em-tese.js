// salvar-em-tese.js · V8 BLOCO 1 FIX 2 · 1Negócio
// Modal compartilhado index.html / negocio.html / portal-usuario.html
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
    setSession: (s) => {},        // recebe { token, refresh, user_id, nome }
    registrarEvento: () => {},
  };

  const cache = new Map();

  // ───── HELPERS ─────
  const $ = (s, root) => (root || document).querySelector(s);
  const _h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function _headers(token) {
    return {
      'apikey': cfg.supabaseAnon,
      'Authorization': 'Bearer ' + (token || cfg.supabaseAnon),
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
  }

  async function _rpcEstado(neg_id, sess) {
    if (!sess || !sess.token || !sess.user_id) return null;
    try {
      const url = cfg.supabaseUrl + '/rest/v1/rpc/negocio_salvo_status';
      const r = await fetch(url, {
        method: 'POST',
        headers: _headers(sess.token),
        body: JSON.stringify({ p_user_id: sess.user_id, p_negocio_id: neg_id }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      return Array.isArray(data) && data.length ? data[0] : null;
    } catch { return null; }
  }

  async function _carregarTeses(sess) {
    if (!sess || !sess.token || !sess.user_id) return [];
    try {
      const url = cfg.supabaseUrl + '/rest/v1/teses_investimento'
        + '?usuario_id=eq.' + sess.user_id
        + '&status=eq.ativa'
        + '&select=id,codigo,titulo,descricao_curta'
        + '&order=criado_em.desc&limit=50';
      const r = await fetch(url, { headers: _headers(sess.token) });
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  }

  // ───── PUBLIC API ─────
  async function estado(negocio_id) {
    const sess = cfg.getSession ? cfg.getSession() : null;
    if (!sess) {
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

  // ───── MODAL ─────
  function _injetarModal() {
    if ($('#set-overlay')) return;
    const css = `
.set-overlay{position:fixed;inset:0;z-index:9999;background:rgba(10,21,16,.7);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:16px}
.set-overlay.open{display:flex}
.set-modal{background:#fff;color:#0a1510;max-width:480px;width:100%;border-radius:24px;padding:28px 28px 22px;box-shadow:0 20px 60px rgba(0,0,0,.25);max-height:90vh;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif}
.set-h{font-family:'Syne',sans-serif;font-weight:700;font-size:22px;letter-spacing:-.01em;margin-bottom:4px}
.set-sub-neg{font-size:13px;color:#5a6661;line-height:1.45;margin-bottom:18px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.set-sub-neg em{color:#0a1510;font-style:normal;font-weight:600}
.set-sub{font-size:13px;color:#5a6661;line-height:1.5;margin-bottom:14px}
.set-section-lbl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7a8581;margin:14px 0 10px;font-family:'JetBrains Mono',ui-monospace,monospace}
.set-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid #e5e7e5;border-radius:12px;margin-bottom:8px;cursor:pointer;transition:.15s}
.set-row:hover{background:#f7f7f5}
.set-row.checked{background:#eafff0;border-color:#3dff95}
.set-row input{margin-top:3px;flex-shrink:0;accent-color:#3dff95}
.set-row .lbl{flex:1;min-width:0}
.set-row .lbl-cod{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:.06em;color:#3dff95;font-weight:600}
.set-row .lbl-tit{font-size:14px;color:#0a1510;font-weight:500;margin-top:2px}
.set-row .lbl-desc{font-size:12px;color:#5a6661;margin-top:2px}
.set-row.avulso{border-style:dashed}
.set-input{width:100%;border:1px solid #e5e7e5;border-radius:12px;padding:14px 16px;font:inherit;font-size:15px;color:#0a1510;box-sizing:border-box}
.set-input:focus{outline:none;border-color:#0a1510}
.set-textarea{width:100%;border:1px solid #e5e7e5;border-radius:12px;padding:12px 14px;font:inherit;font-size:13px;color:#0a1510;resize:vertical;min-height:70px;box-sizing:border-box}
.set-counter{text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9px;color:#7a8581;margin-top:4px}
.set-empty{padding:18px;background:#f7f7f5;border-radius:12px;font-size:13px;color:#5a6661;line-height:1.6;margin-bottom:14px}
.set-link{color:#0a1510;text-decoration:underline;font-weight:600;cursor:pointer;background:none;border:0;padding:0;font:inherit}
.set-foot{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid #e5e7e5}
.set-foot.single{grid-template-columns:1fr}
.set-btn{padding:14px;border-radius:14px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;border:1px solid #e5e7e5;background:#fff;color:#0a1510;transition:.15s}
.set-btn:hover{background:#f7f7f5}
.set-btn.primary{background:#0a1510;color:#fff;border-color:#0a1510}
.set-btn.primary:hover{background:#1a2520}
.set-btn:disabled{opacity:.45;cursor:not-allowed}
.set-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0a1510;color:#3dff95;padding:14px 22px;border-radius:14px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.06em;z-index:10000;box-shadow:0 10px 30px rgba(0,0,0,.3);opacity:0;transition:.25s;pointer-events:none}
.set-toast.show{opacity:1}
.set-err{color:#dc2626;font-size:12px;margin-top:6px;min-height:16px}
.set-info{font-size:12px;color:#5a6661;margin-top:8px;line-height:1.5}
`;
    const styleEl = document.createElement('style');
    styleEl.id = 'set-styles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const html = `
      <div class="set-overlay" id="set-overlay" onclick="if(event.target===this) SET._fechar()">
        <div class="set-modal" id="set-modal">
          <div class="set-h" id="set-h">Salvar</div>
          <div class="set-sub-neg" id="set-sub-neg">—</div>
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

  let _ctx = null; // { negocio_id, nome_negocio, sess, teses, estadoAtual, onSaved, tela }

  function _toast(msg, err) {
    const t = $('#set-toast'); if (!t) return;
    t.textContent = msg;
    t.style.color = err ? '#ff8b7a' : '#3dff95';
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function _fechar() {
    const o = $('#set-overlay'); if (o) o.classList.remove('open');
    _ctx = null;
  }

  function _truncate(s, n) {
    if (!s) return 'este negócio';
    s = String(s).trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ───── ABRIR ─────
  async function abrir(negocio_id, nome_negocio, onSaved) {
    _injetarModal();
    const sess = cfg.getSession ? cfg.getSession() : null;
    _ctx = { negocio_id, nome_negocio: _truncate(nome_negocio, 80), sess, teses: [], estadoAtual: { esta_salvo: false, teses: [], salvar_avulso: false, notas: '' }, onSaved, tela: null };

    $('#set-sub-neg').innerHTML = '<em>' + _h(_ctx.nome_negocio) + '</em>';
    $('#set-overlay').classList.add('open');

    if (sess && sess.token && sess.user_id) {
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
    $('#set-h').textContent = 'Salvar este negócio';
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
    $('#set-foot').className = 'set-foot';
    const btn = $('#set-submit');
    btn.textContent = 'Continuar';
    btn.disabled = false;
    btn.onclick = _submitPhone;
  }

  async function _submitPhone() {
    const inp = $('#set-phone');
    const err = $('#set-err-phone');
    const raw = inp.value.replace(/\D/g, '');
    if (raw.length !== 10 && raw.length !== 11) {
      err.textContent = 'WhatsApp precisa ter DDD + número (10 ou 11 dígitos).';
      return;
    }
    const phoneSemPlus = '55' + raw;
    err.textContent = '';
    const btn = $('#set-submit'); btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      const r = await fetch(cfg.supabaseUrl + '/functions/v1/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseAnon, 'Authorization': 'Bearer ' + cfg.supabaseAnon },
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
    $('#set-foot').className = 'set-foot';
    const btn = $('#set-submit');
    btn.textContent = 'Validar';
    btn.disabled = false;
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
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseAnon, 'Authorization': 'Bearer ' + cfg.supabaseAnon },
        body: JSON.stringify({ whatsapp: _ctx.phoneSemPlus, codigo }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) { err.textContent = data.error || 'Código incorreto.'; btn.disabled = false; btn.textContent = 'Validar'; return; }
      // Persiste session
      const novaSess = {
        token: data.access_token,
        refresh: data.refresh_token,
        user_id: data.user_id,
        whatsapp: _ctx.phoneSemPlus,
      };
      try { cfg.setSession && cfg.setSession(novaSess); } catch {}
      _ctx.sess = novaSess;
      try { cfg.registrarEvento && cfg.registrarEvento('completar_otp_salvar', { entidade_tipo: 'negocio', entidade_id: _ctx.negocio_id, usuario_novo: !!data.usuario_novo }); } catch {}

      if (data.usuario_novo || !data.tem_nome) {
        _abrirTelaNome();
      } else {
        await _abrirTelaTese();
      }
    } catch (e) {
      err.textContent = 'Erro de rede. Tente novamente.';
      btn.disabled = false; btn.textContent = 'Validar';
    }
  }

  function _abrirTelaPhoneVoltar() {
    _abrirTelaPhone(_ctx && _ctx.phoneFormatado);
  }

  // ───── TELA: NOME ─────
  function _abrirTelaNome() {
    if (!_ctx) return;
    _ctx.tela = 'nome';
    $('#set-h').textContent = 'Como podemos te chamar?';
    $('#set-stage').innerHTML = `
      <div class="set-info">Seu nome aparece pro vendedor quando você manda mensagem.</div>
      <div class="set-section-lbl">Nome</div>
      <input class="set-input" id="set-nome" type="text" maxlength="60" placeholder="Ex: Ana Silva">
      <div class="set-err" id="set-err-nome"></div>
    `;
    const inp = $('#set-nome');
    setTimeout(() => inp.focus(), 60);
    $('#set-foot').className = 'set-foot';
    const btn = $('#set-submit');
    btn.textContent = 'Continuar';
    btn.disabled = false;
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
      // Re-chama otp-verify só pra atualizar nome via metadata · ele faz updateUserById quando nome difere
      // Alternativa mais limpa: chamar direto via PATCH /auth/v1/user com Bearer do user
      const r = await fetch(cfg.supabaseUrl + '/auth/v1/user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseAnon, 'Authorization': 'Bearer ' + _ctx.sess.token },
        body: JSON.stringify({ data: { nome } }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        err.textContent = data.msg || 'Erro ao salvar nome.';
        btn.disabled = false; btn.textContent = 'Continuar';
        return;
      }
      _ctx.sess.nome = nome;
      try { cfg.setSession && cfg.setSession(_ctx.sess); } catch {}
      try { cfg.registrarEvento && cfg.registrarEvento('criar_conta_salvar', { entidade_tipo: 'negocio', entidade_id: _ctx.negocio_id }); } catch {}
      await _abrirTelaTese();
    } catch (e) {
      err.textContent = 'Erro de rede. Tente novamente.';
      btn.disabled = false; btn.textContent = 'Continuar';
    }
  }

  // ───── TELA: TESE ─────
  function _renderRow(t, marcado) {
    const desc = t.descricao_curta || '';
    return `
      <label class="set-row${marcado ? ' checked' : ''}" data-set-tese="${t.id}">
        <input type="checkbox" data-tese="${t.id}" ${marcado ? 'checked' : ''}>
        <div class="lbl">
          <div class="lbl-cod">${_h(t.codigo || '')}</div>
          <div class="lbl-tit">${_h(t.titulo || '')}</div>
          ${desc ? `<div class="lbl-desc">${_h(desc)}</div>` : ''}
        </div>
      </label>`;
  }

  async function _abrirTelaTese() {
    if (!_ctx) return;
    _ctx.tela = 'tese';
    const sess = _ctx.sess;
    const [estadoAtual, teses] = await Promise.all([estado(_ctx.negocio_id), _carregarTeses(sess)]);
    _ctx.teses = teses;
    _ctx.estadoAtual = estadoAtual;
    const marcadas = new Set(estadoAtual.teses || []);
    const avulsoMarcado = !!estadoAtual.salvar_avulso;
    $('#set-h').textContent = estadoAtual.esta_salvo ? 'Editar onde está salvo' : 'Salvar este negócio';

    let bodyHtml = '';
    if (teses.length === 0) {
      bodyHtml = `
        <div class="set-empty">Você ainda não tem teses cadastradas. Salve avulso por enquanto · depois pode criar uma tese e vincular.</div>
        <label class="set-row avulso${avulsoMarcado ? ' checked' : ''}">
          <input type="checkbox" id="set-avulso" ${avulsoMarcado ? 'checked' : ''}>
          <div class="lbl"><div class="lbl-tit">Salvar avulso · sem vincular a tese</div></div>
        </label>
        <div style="margin-top:14px;text-align:center"><a class="set-link" href="/cadastre.html">Cadastrar minha primeira tese →</a></div>
      `;
    } else {
      bodyHtml = `<div class="set-section-lbl">Suas teses ativas</div>`;
      bodyHtml += teses.map(t => _renderRow(t, marcadas.has(t.id))).join('');
      bodyHtml += `
        <label class="set-row avulso${avulsoMarcado ? ' checked' : ''}" style="margin-top:10px">
          <input type="checkbox" id="set-avulso" ${avulsoMarcado ? 'checked' : ''}>
          <div class="lbl"><div class="lbl-tit">Salvar avulso · sem vincular a tese</div></div>
        </label>
      `;
    }
    bodyHtml += `
      <div class="set-section-lbl">Notas pessoais (opcional)</div>
      <textarea class="set-textarea" id="set-notas" maxlength="500" placeholder="Por que você se interessou? Pontos de atenção?">${_h(estadoAtual.notas || '')}</textarea>
      <div class="set-counter"><span id="set-notas-count">${(estadoAtual.notas || '').length}</span> / 500</div>
    `;
    $('#set-stage').innerHTML = bodyHtml;

    const txta = $('#set-notas');
    if (txta) txta.addEventListener('input', () => {
      const c = $('#set-notas-count'); if (c) c.textContent = txta.value.length;
    });

    document.querySelectorAll('#set-stage input[type="checkbox"]').forEach(inp => {
      inp.addEventListener('change', _atualizarSubmitTese);
    });
    _atualizarSubmitTese();

    $('#set-foot').className = 'set-foot';
    const btn = $('#set-submit');
    btn.textContent = estadoAtual.esta_salvo ? 'Atualizar' : 'Salvar';
    btn.onclick = _submitTese;
  }

  function _atualizarSubmitTese() {
    const teses = [...document.querySelectorAll('#set-stage input[data-tese]:checked')].map(i => i.dataset.tese);
    const av = $('#set-avulso') ? $('#set-avulso').checked : false;
    document.querySelectorAll('#set-stage label.set-row').forEach(lbl => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('checked', inp && inp.checked);
    });
    const btn = $('#set-submit');
    if (btn) btn.disabled = teses.length === 0 && !av && !(_ctx && _ctx.estadoAtual && _ctx.estadoAtual.esta_salvo);
  }

  async function _submitTese() {
    if (!_ctx) return;
    const btn = $('#set-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

    const sess = _ctx.sess;
    const teses_marcadas = [...document.querySelectorAll('#set-stage input[data-tese]:checked')].map(i => i.dataset.tese);
    const avulso = $('#set-avulso') ? $('#set-avulso').checked : false;
    const notas = ($('#set-notas') && $('#set-notas').value.trim()) || null;
    const teses_atuais = new Set(_ctx.estadoAtual.teses || []);
    const removerInteiro = teses_marcadas.length === 0 && !avulso;

    try {
      let salvo_id = _ctx.estadoAtual.salvo_id;
      if (removerInteiro && salvo_id) {
        await fetch(cfg.supabaseUrl + '/rest/v1/negocios_salvos?id=eq.' + salvo_id, {
          method: 'DELETE', headers: _headers(sess.token),
        });
        try { cfg.registrarEvento && cfg.registrarEvento('remover_salvo', { entidade_tipo: 'negocio', entidade_id: _ctx.negocio_id }); } catch {}
        cache.delete(_ctx.negocio_id);
        _toast('Negócio removido dos salvos');
        if (_ctx.onSaved) _ctx.onSaved();
        _fechar();
        return;
      }

      if (!salvo_id) {
        const r = await fetch(cfg.supabaseUrl + '/rest/v1/negocios_salvos?on_conflict=usuario_id,negocio_id', {
          method: 'POST',
          headers: { ..._headers(sess.token), 'Prefer': 'return=representation,resolution=merge-duplicates' },
          body: JSON.stringify({ usuario_id: sess.user_id, negocio_id: _ctx.negocio_id, notas }),
        });
        if (!r.ok) throw new Error('insert ' + r.status);
        const arr = await r.json();
        salvo_id = arr[0] && arr[0].id;
      } else {
        await fetch(cfg.supabaseUrl + '/rest/v1/negocios_salvos?id=eq.' + salvo_id, {
          method: 'PATCH', headers: _headers(sess.token),
          body: JSON.stringify({ notas }),
        });
      }

      const novas = teses_marcadas.filter(t => !teses_atuais.has(t));
      if (novas.length > 0) {
        const rows = novas.map(t => ({ negocio_salvo_id: salvo_id, tese_id: t }));
        await fetch(cfg.supabaseUrl + '/rest/v1/negocios_salvos_teses', {
          method: 'POST', headers: _headers(sess.token),
          body: JSON.stringify(rows),
        });
      }
      const remover = [...teses_atuais].filter(t => !teses_marcadas.includes(t));
      for (const t of remover) {
        await fetch(cfg.supabaseUrl + '/rest/v1/negocios_salvos_teses?negocio_salvo_id=eq.' + salvo_id + '&tese_id=eq.' + t, {
          method: 'DELETE', headers: _headers(sess.token),
        });
      }

      try {
        cfg.registrarEvento && cfg.registrarEvento('salvar_negocio', {
          entidade_tipo: 'negocio', entidade_id: _ctx.negocio_id,
          teses_atreladas: teses_marcadas, salvar_avulso: avulso, notas_length: (notas || '').length,
        });
      } catch {}

      cache.set(_ctx.negocio_id, {
        esta_salvo: true, salvo_id,
        teses: teses_marcadas, salvar_avulso: avulso, notas: notas || '',
      });

      _toast('Negócio salvo');
      if (_ctx.onSaved) _ctx.onSaved();
      _fechar();
    } catch (e) {
      _toast('Erro: ' + (e.message || 'tente novamente'), true);
      if (btn) { btn.disabled = false; btn.textContent = _ctx.estadoAtual.esta_salvo ? 'Atualizar' : 'Salvar'; }
    }
  }

  window.SET = {
    config(opts) { Object.assign(cfg, opts || {}); },
    estado, statusButton, label, abrir,
    _fechar, _abrirTelaPhoneVoltar,
  };
})();
