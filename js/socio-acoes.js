// socio-acoes.js · v9 · 1Negócio
// Modais que disparam ações do sócio na Área do Sócio.
//
// API:
//   window.SocioAcoes.modalCadastrarTese({ socio })        · v9 · 2 steps · delega pra cadastre.html?ctx=
//   window.SocioAcoes.modalCadastrarDiagnostico({ socio }) · v9 · 2 steps · delega pra diagnostico.html?ctx=
//   window.SocioAcoes.modalPedirVinculo({ socio })         · 3 steps · pedido de vínculo a código existente

(function () {
  'use strict';

  const SUPABASE_URL = window.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';

  // V8 B8.13 cura raiz · prefere /js/vocabulario-canonico.js (window.VC)
  // Fallback local mantido pra resilência caso script ordem dê problema
  if (!window.VC) console.warn('[socio-acoes] vocabulario-canonico.js não carregou · usando fallback local');
  const _SETORES_FALLBACK = [
    { id: 'servicos_empresas', label: 'Serviços B2B' },
    { id: 'varejo', label: 'Varejo' },
    { id: 'saude', label: 'Saúde' },
    { id: 'alimentacao', label: 'Alimentação' },
    { id: 'beleza_estetica', label: 'Beleza e estética' },
    { id: 'educacao', label: 'Educação' },
    { id: 'servicos_locais', label: 'Serviços locais' },
    { id: 'bem_estar', label: 'Bem-estar' },
    { id: 'industria', label: 'Indústria' },
    { id: 'construcao', label: 'Construção' },
    { id: 'hospedagem', label: 'Hospedagem' },
    { id: 'logistica', label: 'Logística' },
  ];
  const _FORMAS_FALLBACK = [
    { id: 'presta_servico', label: 'Presta serviço' },
    { id: 'produz_revende', label: 'Produz e revende' },
    { id: 'fabricacao', label: 'Fabricação' },
    { id: 'revenda', label: 'Revenda' },
    { id: 'distribuicao', label: 'Distribuição' },
    { id: 'vende_governo', label: 'Vende pra governo' },
    { id: 'saas', label: 'SaaS' },
    { id: 'assinatura', label: 'Assinatura/recorrência' },
  ];
  const _UFS_FALLBACK = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

  const SETORES = (window.VC && window.VC.SETORES) ? window.VC.SETORES : _SETORES_FALLBACK;
  const FORMAS  = (window.VC && window.VC.FORMAS)  ? window.VC.FORMAS  : _FORMAS_FALLBACK;
  const UFS     = (window.VC && window.VC.UFS)     ? window.VC.UFS     : _UFS_FALLBACK;

  // ───── helpers ─────
  const _h = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  function _maskPhone(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  function _formatBRL(n) {
    if (!Number.isFinite(n)) return '—';
    return 'R$ ' + Number(n).toLocaleString('pt-BR');
  }

  // V8 B8.13 fix · usa OneN.auth (helper canônico do projeto · auth-fetch.js)
  // OneN.auth.getSession() retorna { token, user_id, ... } · campo é .token (não .access_token)
  // OneN.auth.authFetch auto-injeta Authorization+apikey e renova via otp-refresh quando expira
  function _getToken() {
    const sess = (window.OneN && window.OneN.auth && window.OneN.auth.getSession)
      ? window.OneN.auth.getSession() : null;
    return (sess && sess.token) || null;
  }

  async function _apiCall(path, body) {
    const url = `${SUPABASE_URL}/functions/v1/${path}`;
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    let res;
    if (window.OneN && window.OneN.auth && window.OneN.auth.authFetch) {
      // Caminho preferido · authFetch renova token automaticamente em 401
      res = await window.OneN.auth.authFetch(url, opts);
    } else {
      // Fallback · OneN não carregou · lê token direto e dispara fetch puro
      const token = _getToken() || localStorage.getItem('sb_access_token') || null;
      if (!token) {
        const has = !!(window.OneN && window.OneN.auth);
        throw new Error(`Sem token · OneN.auth=${has} · sb_access_token=${!!localStorage.getItem('sb_access_token')}`);
      }
      res = await fetch(url, { ...opts, headers: { ...opts.headers, 'Authorization': 'Bearer ' + token } });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || data.mensagem || `HTTP ${res.status}`);
    return data;
  }

  // ───── modal stepper genérico ─────
  function _modalStepper({ titulo, steps, onSubmit, ctaFinalLabel }) {
    let _state = {};
    let _idx = 0;
    let _busy = false;

    const wrap = document.createElement('div');
    wrap.className = 'modal-stepper-overlay';
    wrap.innerHTML = `
      <div class="modal-stepper">
        <div class="modal-stepper-head">
          <div class="modal-stepper-titulo">${_h(titulo)}</div>
          <button type="button" class="modal-stepper-close" aria-label="Fechar">×</button>
        </div>
        <div class="modal-stepper-progress"><div class="modal-stepper-progress-fill"></div></div>
        <div class="modal-stepper-counter"></div>
        <div class="modal-stepper-body"></div>
        <div class="modal-stepper-foot">
          <button type="button" class="msf-btn msf-btn-back">Voltar</button>
          <button type="button" class="msf-btn msf-btn-next">Continuar</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';

    const elBody = wrap.querySelector('.modal-stepper-body');
    const elFill = wrap.querySelector('.modal-stepper-progress-fill');
    const elCount = wrap.querySelector('.modal-stepper-counter');
    const btnBack = wrap.querySelector('.msf-btn-back');
    const btnNext = wrap.querySelector('.msf-btn-next');
    const btnClose = wrap.querySelector('.modal-stepper-close');

    function fechar() {
      document.body.style.overflow = '';
      wrap.remove();
    }
    btnClose.addEventListener('click', fechar);

    async function render() {
      const step = steps[_idx];
      const total = steps.length;
      elFill.style.width = `${((_idx + 1) / total) * 100}%`;
      elCount.textContent = `${_idx + 1} de ${total}`;
      elBody.innerHTML = await step.render(_state);
      btnBack.style.visibility = _idx > 0 ? 'visible' : 'hidden';
      btnNext.textContent = _idx === total - 1 ? (ctaFinalLabel || 'Concluir') : 'Continuar';
      btnNext.disabled = false;
      btnNext.classList.remove('msf-btn-loading');
      if (typeof step.onMount === 'function') {
        try { await step.onMount(elBody, _state); } catch (e) { console.warn('[stepper onMount]', e); }
      }
    }

    btnBack.addEventListener('click', () => {
      if (_busy) return;
      if (_idx > 0) { _idx--; render(); }
    });

    btnNext.addEventListener('click', async () => {
      if (_busy) return;
      _busy = true;
      btnNext.disabled = true;
      btnNext.classList.add('msf-btn-loading');
      try {
        const step = steps[_idx];
        if (typeof step.validate === 'function') {
          const valid = await step.validate(elBody, _state);
          if (!valid) { _busy = false; btnNext.disabled = false; btnNext.classList.remove('msf-btn-loading'); return; }
        }
        if (_idx === steps.length - 1) {
          if (typeof onSubmit === 'function') {
            await onSubmit(_state, { fechar, mostrarSucesso });
          }
        } else {
          _idx++;
          await render();
        }
      } catch (e) {
        alert(e.message || String(e));
      } finally {
        _busy = false;
        btnNext.disabled = false;
        btnNext.classList.remove('msf-btn-loading');
      }
    });

    function mostrarSucesso(html) {
      elBody.innerHTML = html;
      btnBack.style.display = 'none';
      btnNext.style.display = 'none';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'msf-btn';
      closeBtn.textContent = 'Fechar';
      closeBtn.style.margin = '12px auto 0';
      closeBtn.style.display = 'block';
      closeBtn.addEventListener('click', () => { fechar(); window.location.reload(); });
      elBody.appendChild(closeBtn);
    }

    render();
  }

  // ============================================================
  // v9.1 · Iniciar cadastro de tese ou diagnóstico em nome de terceiro
  // Modal enxuto · 2 steps reordenados:
  //   step caminho: A (preencher agora) ou B (mandar link)
  //   step dados:   phone + nome (auto-preenche nome se phone já existir)
  // → delega pro funil (cadastre.html?ctx= ou diagnostico.html?ctx=) ou
  //   dispara WhatsApp.
  // ============================================================
  async function _modalIniciarCadastro(tipo) {
    const tipoLabel = tipo === 'tese' ? 'tese de investimento' : 'diagnóstico de empresa';
    const tipoLabelGenitivo = tipo === 'tese' ? 'da tese' : 'do diagnóstico';

    const overlay = document.createElement('div');
    overlay.className = 'sa-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,.6);
      backdrop-filter: blur(8px);
      z-index: 99999;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    `;

    overlay.innerHTML = `
      <div style="
        background: var(--surface, #121a15);
        color: var(--ink, #f4f7f4);
        border: 1px solid var(--line-2, rgba(255,255,255,.12));
        border-radius: 24px;
        max-width: 520px; width: 100%;
        padding: 28px;
        font-family: var(--sans, 'Geist', sans-serif);
        position: relative;
      ">
        <button id="sa-fechar" aria-label="Fechar" style="
          position: absolute; top: 14px; right: 14px;
          background: transparent; color: var(--ink-3);
          border: none; cursor: pointer;
          font-size: 22px; line-height: 1;
          padding: 4px 8px;
          font-family: var(--sans);
        ">×</button>

        <h2 style="
          font-family: var(--serif, 'Syne', serif);
          font-size: 22px; font-weight: 700;
          letter-spacing: -.025em;
          margin: 0 0 8px 0;
        ">Cadastrar ${_h(tipoLabel)} pra alguém</h2>
        <p style="
          font-size: 13px; color: var(--ink-2, rgba(244,247,244,.72));
          margin: 0 0 24px 0; line-height: 1.5;
        ">Você vai cadastrar em nome de outra pessoa.</p>

        <div id="sa-step-caminho">
          <p style="font-size: 13px; color: var(--ink-2); margin: 0 0 16px 0; line-height: 1.5;">
            Como você quer prosseguir?
          </p>

          <button class="sa-caminho" data-caminho="a" style="
            display: block; width: 100%;
            text-align: left;
            background: var(--bg-2);
            color: var(--ink);
            border: 1px solid var(--line-2);
            border-radius: 16px;
            padding: 16px 18px;
            margin-bottom: 12px;
            cursor: pointer;
            font-family: var(--sans);
          ">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">Vou preencher agora</div>
            <div style="font-size: 12px; color: var(--ink-2); line-height: 1.4;">Eu mesmo preencho os dados ${_h(tipoLabelGenitivo)}. O proprietário recebe WhatsApp depois pra confirmar o vínculo.</div>
          </button>

          <button class="sa-caminho" data-caminho="b" style="
            display: block; width: 100%;
            text-align: left;
            background: var(--bg-2);
            color: var(--ink);
            border: 1px solid var(--line-2);
            border-radius: 16px;
            padding: 16px 18px;
            margin-bottom: 4px;
            cursor: pointer;
            font-family: var(--sans);
          ">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">Mandar link pro proprietário preencher</div>
            <div style="font-size: 12px; color: var(--ink-2); line-height: 1.4;">O proprietário recebe WhatsApp com link pra preencher pessoalmente.</div>
          </button>
        </div>

        <div id="sa-step-dados" style="display:none;">
          <p id="sa-step-dados-header" style="font-size: 13px; color: var(--ink-2); margin: 0 0 18px 0; line-height: 1.5;"></p>

          <label style="display:block; font-size:11px; font-family:var(--mono); text-transform:uppercase; letter-spacing:.08em; color:var(--ink-3); margin-bottom:6px;">Telefone do proprietário (com DDD)</label>
          <input id="sa-phone" type="tel" placeholder="(48) 99999-9999" style="
            width: 100%;
            background: var(--bg-2, #0e1612);
            color: var(--ink);
            border: 1px solid var(--line-2);
            border-radius: 12px;
            padding: 13px 15px;
            font-size: 14px;
            font-family: var(--sans);
            margin-bottom: 16px;
            box-sizing: border-box;
          ">

          <label style="display:block; font-size:11px; font-family:var(--mono); text-transform:uppercase; letter-spacing:.08em; color:var(--ink-3); margin-bottom:6px;">Nome do proprietário</label>
          <input id="sa-nome" type="text" placeholder="João Padeiro" style="
            width: 100%;
            background: var(--bg-2, #0e1612);
            color: var(--ink);
            border: 1px solid var(--line-2);
            border-radius: 12px;
            padding: 13px 15px;
            font-size: 14px;
            font-family: var(--sans);
            margin-bottom: 4px;
            box-sizing: border-box;
          ">
          <small id="sa-nome-helper" style="
            display: block; margin-top: 4px; margin-bottom: 20px;
            font-size: 11px; font-family: var(--mono); color: var(--ink-3);
            letter-spacing: .04em; text-transform: uppercase;
            min-height: 14px;
          "></small>

          <div style="display:flex; gap:8px; justify-content:space-between; align-items:center;">
            <button id="sa-voltar-dados" style="
              background: transparent; color: var(--ink-3);
              border: none;
              font-size: 12px;
              cursor: pointer;
              font-family: var(--sans);
            ">← Voltar</button>
            <button id="sa-continuar" style="
              background: var(--accent, #3dff95);
              color: var(--accent-ink, #0a0f0c);
              border: none;
              border-radius: 999px;
              padding: 10px 22px;
              font-size: 13px; font-weight: 700;
              text-transform: uppercase; letter-spacing: .06em;
              cursor: pointer;
              font-family: var(--sans);
            ">Continuar</button>
          </div>
        </div>

        <div id="sa-step-loading" style="display:none; text-align:center; padding:30px;">
          <div style="font-size: 13px; color: var(--ink-2);">Iniciando cadastro...</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    let caminho = null;
    let phone = '';
    let nome = '';

    const $ = (sel) => overlay.querySelector(sel);
    const fechar = () => { document.body.style.overflow = ''; overlay.remove(); };

    $('#sa-fechar').onclick = fechar;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

    // Step caminho · click num card seta caminho e mostra step dados
    overlay.querySelectorAll('.sa-caminho').forEach((btn) => {
      btn.onclick = () => {
        caminho = btn.dataset.caminho;
        const header = $('#sa-step-dados-header');
        header.textContent = caminho === 'a'
          ? `Você vai preencher os dados ${tipoLabelGenitivo} de quem?`
          : 'Pra qual telefone vamos enviar o link?';
        $('#sa-step-caminho').style.display = 'none';
        $('#sa-step-dados').style.display = 'block';
        setTimeout(() => $('#sa-phone').focus(), 50);
      };
    });

    // Voltar pro step caminho · reset
    $('#sa-voltar-dados').onclick = () => {
      caminho = null;
      $('#sa-step-dados').style.display = 'none';
      $('#sa-step-caminho').style.display = 'block';
    };

    // Listener no phone input · máscara + lookup com debounce
    const phoneInput = $('#sa-phone');
    const nomeInput = $('#sa-nome');
    const helperEl = $('#sa-nome-helper');
    let lookupTimer = null;
    let lookupAtual = '';

    phoneInput.addEventListener('input', (e) => {
      e.target.value = _maskPhone(e.target.value);
      const phoneRaw = e.target.value.replace(/\D/g, '');

      // Reset visual quando phone fica curto
      if (phoneRaw.length < 10) {
        nomeInput.removeAttribute('readonly');
        nomeInput.style.opacity = '';
        if (helperEl) { helperEl.textContent = ''; helperEl.style.color = ''; }
        lookupAtual = '';
        return;
      }
      if (phoneRaw === lookupAtual) return;

      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(async () => {
        lookupAtual = phoneRaw;
        try {
          const r = await _apiCall('lookup-proprietario-por-phone', { phone: phoneRaw });
          if (r.encontrado && r.nome) {
            nomeInput.value = r.nome;
            nomeInput.setAttribute('readonly', 'readonly');
            nomeInput.style.opacity = '0.7';
            if (helperEl) {
              helperEl.textContent = 'usuario ja cadastrado · nome auto-preenchido';
              helperEl.style.color = 'var(--accent, #3dff95)';
            }
          } else {
            nomeInput.removeAttribute('readonly');
            nomeInput.style.opacity = '';
            if (helperEl) { helperEl.textContent = ''; helperEl.style.color = ''; }
          }
        } catch (_e) {
          // Lookup falhou silenciosamente · permite digitar nome
          nomeInput.removeAttribute('readonly');
          nomeInput.style.opacity = '';
          if (helperEl) { helperEl.textContent = ''; helperEl.style.color = ''; }
        }
      }, 500);
    });

    // Continuar · valida e dispara
    $('#sa-continuar').onclick = async () => {
      phone = phoneInput.value.trim();
      nome = nomeInput.value.trim();
      if (phone.replace(/\D/g, '').length < 10) { alert('Telefone inválido · digite DDD + número'); return; }
      if (nome.length < 2) { alert('Nome do proprietário obrigatório'); return; }
      if (!caminho) { alert('Escolha o caminho primeiro'); return; }

      $('#sa-step-dados').style.display = 'none';
      $('#sa-step-loading').style.display = 'block';

      try {
        const result = await _apiCall('socio-iniciar-cadastro-terceiro', {
          tipo,
          proprietario_phone: phone,
          proprietario_nome: nome,
          caminho,
        });

        // _apiCall throw em ok=false · então se chegou aqui, sucesso.
        if (caminho === 'a') {
          // Redireciona pro funil real (cadastre.html?ctx= ou diagnostico.html?ctx=)
          window.location.href = result.redirect_url;
        } else {
          // Caminho B · WhatsApp foi enviado
          alert(`Link enviado por WhatsApp pra ${nome}. Acompanhe em "Meus vínculos".`);
          fechar();
        }
      } catch (e) {
        console.error('[socio-iniciar-cadastro-terceiro] falhou:', e);
        // v9.3 · mensagem amigável diferenciada por caminho · detalhe técnico só no console
        const msgUser = caminho === 'a'
          ? 'Não consegui iniciar o preenchimento agora. Tenta de novo em alguns segundos.'
          : 'Não consegui enviar o link agora. Tenta de novo · ou escolha "Vou preencher agora" pra preencher você mesmo.';
        alert(msgUser);
        fechar();
      }
    };
  }

  function modalCadastrarTese(_opts)        { return _modalIniciarCadastro('tese'); }
  function modalCadastrarDiagnostico(_opts) { return _modalIniciarCadastro('diagnostico'); }

  // ───── modal: pedir vínculo · 3 steps · usa socio-pedir-vinculo v2 (ETAPA 6) ─────
  function modalPedirVinculo(_opts) {
    const steps = [
      // 1. Cola código
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Código da tese ou negócio</h3>
            <p class="msf-hint">Cole o código que o proprietário compartilhou com você</p>
            <input type="text" class="msf-input" id="msf-codigo" placeholder="T-0053  ou  1N-1149" maxlength="20" value="${_h(s.codigo || '')}" autocomplete="off" />
            <div class="msf-hint" style="margin-top:10px">
              · Tese de comprador → começa com <strong>T-</strong><br>
              · Negócio à venda → começa com <strong>1N-</strong>
            </div>
            <div class="msf-err" id="msf-codigo-err"></div>
          </div>
        `,
        onMount: (el, s) => {
          const inp = el.querySelector('#msf-codigo');
          inp.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
          inp.focus();
        },
        validate: async (el, s) => {
          const errEl = el.querySelector('#msf-codigo-err');
          const codigo = String(el.querySelector('#msf-codigo').value || '').trim().toUpperCase();
          if (!codigo) { errEl.textContent = 'Cole o código'; return false; }
          // Busca via edge · valida formato + existência + conflito
          try {
            const res = await _apiCall('socio-buscar-codigo', { codigo });
            s.codigo = codigo;
            s.preview = res;
            return true;
          } catch (e) {
            errEl.textContent = e.message || String(e);
            return false;
          }
        },
      },
      // 2. Preview
      {
        render: async (s) => {
          const p = s.preview || {};
          const tipoLabel = p.tipo === 'tese' ? 'Tese de investimento' : 'Negócio à venda';
          const valorOuSetor = p.tipo === 'tese' && p.valor_alvo
            ? `Valor alvo · ${_formatBRL(Number(p.valor_alvo))}`
            : (p.setor ? `Setor · ${_h(p.setor)}` : '');

          // 4 cenários:
          let alertHtml = '';
          let canContinue = true;
          if (p.ja_pediu_vinculo) {
            alertHtml = `<div class="msf-alert msf-alert-warn"><strong>Você já pediu vínculo a esse código.</strong> Aguarde resposta do proprietário ou cancele o pedido anterior pelo admin.</div>`;
            canContinue = false;
          } else if (p.tem_socio_ativo) {
            alertHtml = `<div class="msf-alert msf-alert-warn"><strong>Esse código já tem sócio ativo.</strong> Você pode pedir mesmo assim · o proprietário decide se troca de sócio.</div>`;
            canContinue = true;
          } else {
            alertHtml = `<div class="msf-alert msf-alert-ok"><strong>Disponível.</strong> Você pode pedir vínculo · proprietário recebe um WhatsApp pra aceitar ou recusar.</div>`;
          }

          s._canContinue = canContinue;

          return `
            <div class="msf-step">
              <h3 class="msf-q">Preview do código</h3>
              <div class="msf-preview">
                <div class="msf-preview-codigo">${_h(p.codigo)}</div>
                <div class="msf-preview-tipo">${_h(tipoLabel)}</div>
                <div class="msf-preview-resumo">${_h(p.resumo || '—')}</div>
                ${valorOuSetor ? `<div class="msf-preview-meta">${_h(valorOuSetor)}</div>` : ''}
                <div class="msf-preview-meta">Proprietário · <strong>${_h(p.proprietario_iniciais || '??')}</strong> <span style="color:var(--ink-3)">(sigilo · só iniciais até ele aceitar)</span></div>
              </div>
              ${alertHtml}
            </div>
          `;
        },
        validate: async (el, s) => {
          if (!s._canContinue) {
            // Bloqueia avanço quando já pediu
            return false;
          }
          return true;
        },
      },
      // 3. Confirmação
      {
        render: async (s) => {
          const p = s.preview || {};
          return `
            <div class="msf-step">
              <h3 class="msf-q">Confirmar pedido de vínculo</h3>
              <p class="msf-hint">Ao confirmar:</p>
              <ul class="msf-hint" style="padding-left:18px;line-height:1.7">
                <li>Vínculo é criado em status <strong>aguardando aceite</strong></li>
                <li>Proprietário recebe um WhatsApp com link de aceite</li>
                <li>Link expira em 30 dias · você é notificado quando ele aceitar ou recusar</li>
                <li>Enquanto pendente · você não tem acesso aos dados completos</li>
              </ul>
              <div class="msf-resumo" style="margin-top:14px">
                <div class="msf-resumo-row"><span>Código</span><strong>${_h(p.codigo)}</strong></div>
                <div class="msf-resumo-row"><span>Tipo</span><strong>${_h(p.tipo === 'tese' ? 'Tese' : 'Negócio')}</strong></div>
                <div class="msf-resumo-row"><span>Proprietário</span><strong>${_h(p.proprietario_iniciais || '??')}</strong></div>
              </div>
            </div>
          `;
        },
      },
    ];

    _modalStepper({
      titulo: 'Pedir vínculo a código existente',
      ctaFinalLabel: 'Pedir vínculo e enviar WhatsApp',
      steps,
      onSubmit: async (s, { mostrarSucesso }) => {
        const res = await _apiCall('socio-pedir-vinculo', { codigo: s.codigo });
        mostrarSucesso(`
          <div class="msf-step">
            <h3 class="msf-q" style="color:var(--accent,#0aa85a)">✓ Vínculo solicitado</h3>
            <p class="msf-hint">Código do vínculo: <strong>${_h(res.vinculo_codigo || '—')}</strong></p>
            <p class="msf-hint" style="margin-top:14px">WhatsApp enviado pro proprietário · ele tem 30 dias pra aceitar.</p>
            <p class="msf-hint">Você é notificado quando houver resposta.</p>
          </div>
        `);
      },
    });
  }

  window.SocioAcoes = {
    modalCadastrarTese,
    modalCadastrarDiagnostico,
    modalPedirVinculo,
  };
})();
