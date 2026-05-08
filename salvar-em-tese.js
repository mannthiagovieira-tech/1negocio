// salvar-em-tese.js · V8 BLOCO 1 · 1Negócio
// Modal compartilhado entre index.html, negocio.html, portal-usuario.html
// API:
//   window.SET.config({ supabaseUrl, supabaseAnon, getSession, registrarEvento, otpAbrir })
//   window.SET.estado(negocio_id) → Promise<{ esta_salvo, teses, salvar_avulso, notas, salvo_id }>
//   window.SET.abrir(negocio_id, onSaved?)
//   window.SET.statusButton(negocio_id) → "salvar" | "salvo"  (cache local)
//
// Uso típico em card:
//   <button onclick="SET.abrir('${d.id}', refreshCard)">${SET.label('${d.id}')}</button>

(function () {
  if (window.SET) return;

  const cfg = {
    supabaseUrl: '',
    supabaseAnon: '',
    getSession: () => null,           // returns { token, user_id, nome, whatsapp } or null
    registrarEvento: () => {},        // (tipo, meta) => void
    otpAbrir: null,                   // (callbackPosLogin) => abre fluxo OTP
  };

  const cache = new Map();            // negocio_id → estado

  // ───────────── HELPERS ─────────────
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

  // ───────────── PUBLIC API ─────────────
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

  // ───────────── MODAL ─────────────
  function _injetarModal() {
    if ($('#set-overlay')) return;
    const css = `
.set-overlay{position:fixed;inset:0;z-index:9999;background:rgba(10,21,16,.7);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:16px}
.set-overlay.open{display:flex}
.set-modal{background:#fff;color:#0a1510;max-width:480px;width:100%;border-radius:24px;padding:28px 28px 22px;box-shadow:0 20px 60px rgba(0,0,0,.25);max-height:90vh;overflow-y:auto;font-family:system-ui,-apple-system,sans-serif}
.set-h{font-family:'Syne',sans-serif;font-weight:700;font-size:22px;letter-spacing:-.01em;margin-bottom:6px}
.set-sub{font-size:13px;color:#5a6661;line-height:1.5;margin-bottom:18px}
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
.set-textarea{width:100%;border:1px solid #e5e7e5;border-radius:12px;padding:12px 14px;font:inherit;font-size:13px;color:#0a1510;resize:vertical;min-height:70px;box-sizing:border-box}
.set-counter{text-align:right;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9px;color:#7a8581;margin-top:4px}
.set-empty{padding:18px;background:#f7f7f5;border-radius:12px;font-size:13px;color:#5a6661;line-height:1.6;margin-bottom:14px}
.set-link{color:#0a1510;text-decoration:underline;font-weight:600}
.set-foot{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid #e5e7e5}
.set-btn{padding:14px;border-radius:14px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;border:1px solid #e5e7e5;background:#fff;color:#0a1510;transition:.15s}
.set-btn:hover{background:#f7f7f5}
.set-btn.primary{background:#0a1510;color:#fff;border-color:#0a1510}
.set-btn.primary:hover{background:#1a2520}
.set-btn:disabled{opacity:.45;cursor:not-allowed}
.set-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0a1510;color:#3dff95;padding:14px 22px;border-radius:14px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.06em;z-index:10000;box-shadow:0 10px 30px rgba(0,0,0,.3);opacity:0;transition:.25s;pointer-events:none}
.set-toast.show{opacity:1}
`;
    const styleEl = document.createElement('style');
    styleEl.id = 'set-styles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const html = `
      <div class="set-overlay" id="set-overlay" onclick="if(event.target===this) SET._fechar()">
        <div class="set-modal" id="set-modal">
          <div class="set-h" id="set-h">Salvar este negócio</div>
          <div class="set-sub" id="set-sub">Vincule a uma das suas teses · ou salve avulso</div>
          <div id="set-body"></div>
          <div class="set-section-lbl">Notas pessoais (opcional)</div>
          <textarea class="set-textarea" id="set-notas" maxlength="500" placeholder="Por que você se interessou? Pontos de atenção?"></textarea>
          <div class="set-counter"><span id="set-notas-count">0</span> / 500</div>
          <div class="set-foot">
            <button class="set-btn" onclick="SET._fechar()">Cancelar</button>
            <button class="set-btn primary" id="set-submit" onclick="SET._submit()">Salvar</button>
          </div>
        </div>
      </div>
      <div class="set-toast" id="set-toast"></div>
    `;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);

    const txta = $('#set-notas');
    if (txta) txta.addEventListener('input', () => {
      const c = $('#set-notas-count'); if (c) c.textContent = txta.value.length;
    });
  }

  let _ctx = null; // { negocio_id, sess, teses, estadoAtual, onSaved }

  function _toast(msg, err) {
    const t = $('#set-toast'); if (!t) return;
    t.textContent = msg;
    t.style.color = err ? '#ff8b7a' : '#3dff95';
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 2400);
  }

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

  async function abrir(negocio_id, onSaved) {
    _injetarModal();
    const sess = cfg.getSession ? cfg.getSession() : null;

    // CASO C: deslogado · dispara OTP
    if (!sess || !sess.token || !sess.user_id) {
      try { cfg.registrarEvento && cfg.registrarEvento('abrir_modal_salvar', { entidade_tipo: 'negocio', entidade_id: negocio_id, deslogado: true }); } catch {}
      if (typeof cfg.otpAbrir === 'function') {
        cfg.otpAbrir(() => abrir(negocio_id, onSaved));
        return;
      }
      _toast('Faça login primeiro', true);
      return;
    }

    try { cfg.registrarEvento && cfg.registrarEvento('abrir_modal_salvar', { entidade_tipo: 'negocio', entidade_id: negocio_id }); } catch {}

    // Carrega estado e teses em paralelo
    const [estadoAtual, teses] = await Promise.all([estado(negocio_id), _carregarTeses(sess)]);
    _ctx = { negocio_id, sess, teses, estadoAtual, onSaved };

    const marcadas = new Set(estadoAtual.teses || []);
    const avulsoMarcado = !!estadoAtual.salvar_avulso;

    if (estadoAtual.esta_salvo) {
      $('#set-h').textContent = 'Editar onde este negócio está salvo';
      $('#set-submit').textContent = 'Atualizar';
    } else {
      $('#set-h').textContent = 'Salvar este negócio';
      $('#set-submit').textContent = 'Salvar';
    }

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
      $('#set-sub').textContent = 'Vincule a uma das suas teses · ou salve avulso';
      bodyHtml = `<div class="set-section-lbl">Suas teses ativas</div>`;
      bodyHtml += teses.map(t => _renderRow(t, marcadas.has(t.id))).join('');
      bodyHtml += `
        <label class="set-row avulso${avulsoMarcado ? ' checked' : ''}" style="margin-top:10px">
          <input type="checkbox" id="set-avulso" ${avulsoMarcado ? 'checked' : ''}>
          <div class="lbl"><div class="lbl-tit">Salvar avulso · sem vincular a tese</div></div>
        </label>
      `;
    }
    $('#set-body').innerHTML = bodyHtml;
    $('#set-notas').value = estadoAtual.notas || '';
    const c = $('#set-notas-count'); if (c) c.textContent = (estadoAtual.notas || '').length;

    // Toggle visual checked + habilita botão
    document.querySelectorAll('#set-body input[type="checkbox"]').forEach(inp => {
      inp.addEventListener('change', _atualizarSubmit);
      inp.parentElement.addEventListener('click', (e) => {
        if (e.target !== inp) {
          inp.checked = !inp.checked;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    _atualizarSubmit();

    $('#set-overlay').classList.add('open');
  }

  function _atualizarSubmit() {
    const teses = [...document.querySelectorAll('#set-body input[data-tese]:checked')].map(i => i.dataset.tese);
    const av = $('#set-avulso') ? $('#set-avulso').checked : false;
    document.querySelectorAll('#set-body label.set-row').forEach(lbl => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('checked', inp && inp.checked);
    });
    const btn = $('#set-submit');
    if (btn) btn.disabled = teses.length === 0 && !av && !_ctx.estadoAtual.esta_salvo;
  }

  function _fechar() { const o = $('#set-overlay'); if (o) o.classList.remove('open'); }

  async function _submit() {
    if (!_ctx) return;
    const btn = $('#set-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

    const sess = _ctx.sess;
    const teses_marcadas = [...document.querySelectorAll('#set-body input[data-tese]:checked')].map(i => i.dataset.tese);
    const avulso = $('#set-avulso') ? $('#set-avulso').checked : false;
    const notas = ($('#set-notas') && $('#set-notas').value.trim()) || null;
    const teses_atuais = new Set(_ctx.estadoAtual.teses || []);
    const removerInteiro = teses_marcadas.length === 0 && !avulso;

    try {
      // 1. ensureNegocioSalvo (UPSERT em negocios_salvos)
      let salvo_id = _ctx.estadoAtual.salvo_id;
      if (removerInteiro && salvo_id) {
        // DELETE inteiro
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

      // 2. Insere M:N pra novas teses marcadas
      const novas = teses_marcadas.filter(t => !teses_atuais.has(t));
      if (novas.length > 0) {
        const rows = novas.map(t => ({ negocio_salvo_id: salvo_id, tese_id: t }));
        await fetch(cfg.supabaseUrl + '/rest/v1/negocios_salvos_teses', {
          method: 'POST', headers: _headers(sess.token),
          body: JSON.stringify(rows),
        });
      }

      // 3. Remove M:N pra teses desmarcadas
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

      // Atualiza cache
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
    _fechar, _submit, _ctx: () => _ctx,
  };
})();
