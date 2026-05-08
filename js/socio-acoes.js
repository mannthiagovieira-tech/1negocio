// socio-acoes.js · V8 B8.13 SUB-BLOCO B FASE 2 · 1Negócio
// Modais multi-step pra sócio cadastrar tese/diagnóstico em nome de terceiros.
// Padrão cadastre.html · sticky bottom buttons · progress bar · 1 pergunta por tela.
//
// API:
//   window.SocioAcoes.modalCadastrarTese({ socio })
//   window.SocioAcoes.modalCadastrarDiagnostico({ socio })
//   window.SocioAcoes.modalPedirVinculo({ socio })  · placeholder até SUB-BLOCO C

(function () {
  'use strict';

  const SUPABASE_URL = window.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';

  // Vocabulário canônico
  const SETORES = [
    { id: 'alimentacao', label: 'Alimentação' },
    { id: 'saude', label: 'Saúde' },
    { id: 'beleza_estetica', label: 'Beleza e estética' },
    { id: 'educacao', label: 'Educação' },
    { id: 'varejo', label: 'Varejo' },
    { id: 'industria', label: 'Indústria' },
    { id: 'logistica', label: 'Logística' },
    { id: 'construcao', label: 'Construção' },
    { id: 'servicos_empresas', label: 'Serviços B2B' },
    { id: 'tecnologia', label: 'Tecnologia / SaaS' },
    { id: 'hospedagem', label: 'Hospedagem' },
    { id: 'indiferente', label: 'Indiferente · qualquer setor' },
  ];

  const FORMAS = [
    { id: 'aquisicao_total', label: 'Aquisição total (100%)' },
    { id: 'participacao_majoritaria', label: 'Participação majoritária (>50%)' },
    { id: 'participacao_minoritaria', label: 'Participação minoritária (<50%)' },
    { id: 'joint_venture', label: 'Joint venture' },
    { id: 'franquia', label: 'Franquia' },
    { id: 'fusao', label: 'Fusão' },
    { id: 'parceria_estrategica', label: 'Parceria estratégica' },
    { id: 'indiferente', label: 'Indiferente · qualquer forma' },
  ];

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

  async function _getToken() {
    try {
      if (window.supabase && window.supabase.auth && typeof window.supabase.auth.getSession === 'function') {
        const { data } = await window.supabase.auth.getSession();
        return data?.session?.access_token || null;
      }
      return localStorage.getItem('sb-access-token') || null;
    } catch { return null; }
  }

  async function _apiCall(path, body) {
    const token = await _getToken();
    if (!token) throw new Error('Sessão expirada · faça login novamente');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
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

  // ───── steps comuns: telefone + confirmação ─────
  function _stepTelefone() {
    return {
      render: async (s) => `
        <div class="msf-step">
          <h3 class="msf-q">Telefone do proprietário</h3>
          <p class="msf-hint">DDD + número (10 ou 11 dígitos · WhatsApp dele)</p>
          <input type="tel" class="msf-input" id="msf-phone" placeholder="(11) 91234-5678" value="${_h(s.phoneMasked || '')}" maxlength="16" autocomplete="off" />
          <div class="msf-err" id="msf-phone-err"></div>
        </div>
      `,
      onMount: (el, s) => {
        const inp = el.querySelector('#msf-phone');
        inp.addEventListener('input', (e) => {
          e.target.value = _maskPhone(e.target.value);
        });
        inp.focus();
      },
      validate: async (el, s) => {
        const inp = el.querySelector('#msf-phone');
        const errEl = el.querySelector('#msf-phone-err');
        const digits = String(inp.value || '').replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 11) {
          errEl.textContent = 'Telefone inválido · digite DDD + número';
          return false;
        }
        s.phone = digits;
        s.phoneMasked = inp.value;
        // Valida via edge
        try {
          const res = await _apiCall('socio-validar-phone', { phone: digits });
          s.proprietario_existe = !!res.existe;
          s.proprietario_user_id = res.user_id || null;
          s.proprietario_nome_existente = res.nome || null;
        } catch (e) {
          errEl.textContent = 'Erro ao validar telefone: ' + (e.message || e);
          return false;
        }
        return true;
      },
    };
  }

  function _stepConfirmacaoProprietario() {
    return {
      render: async (s) => {
        if (s.proprietario_existe) {
          const nome = s.proprietario_nome_existente || 'Proprietário';
          return `
            <div class="msf-step">
              <h3 class="msf-q">Cadastrando pra ${_h(nome)}</h3>
              <p class="msf-hint">Encontramos esse telefone no sistema · cadastrando em nome de <strong>${_h(nome)}</strong>.</p>
              <p class="msf-hint" style="margin-top:14px">Continue pra preencher os dados.</p>
            </div>
          `;
        }
        return `
          <div class="msf-step">
            <h3 class="msf-q">Vamos criar uma conta nova</h3>
            <p class="msf-hint">Esse telefone ainda não tem conta. Qual o nome do proprietário?</p>
            <input type="text" class="msf-input" id="msf-nome" placeholder="Nome completo" value="${_h(s.proprietario_nome || '')}" maxlength="100" autocomplete="off" />
            <div class="msf-err" id="msf-nome-err"></div>
          </div>
        `;
      },
      onMount: (el, s) => {
        if (!s.proprietario_existe) {
          const inp = el.querySelector('#msf-nome');
          if (inp) inp.focus();
        }
      },
      validate: async (el, s) => {
        if (s.proprietario_existe) return true;
        const inp = el.querySelector('#msf-nome');
        const errEl = el.querySelector('#msf-nome-err');
        const nome = String(inp.value || '').trim();
        if (nome.length < 2) {
          errEl.textContent = 'Digite o nome do proprietário';
          return false;
        }
        s.proprietario_nome = nome;
        return true;
      },
    };
  }

  // ───── modal: cadastrar TESE · 8 steps ─────
  function modalCadastrarTese(_opts) {
    const steps = [
      _stepTelefone(),
      _stepConfirmacaoProprietario(),
      // 3. setores (multi)
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Setores de interesse</h3>
            <p class="msf-hint">Selecione 1 ou mais setores que ele(a) quer comprar</p>
            <div class="msf-chips" id="msf-setores">
              ${SETORES.map(o => `<button type="button" class="msf-chip${(s.setores || []).includes(o.id) ? ' on' : ''}" data-id="${o.id}">${_h(o.label)}</button>`).join('')}
            </div>
            <div class="msf-err" id="msf-setores-err"></div>
          </div>
        `,
        onMount: (el, s) => {
          el.querySelectorAll('.msf-chip').forEach((c) => {
            c.addEventListener('click', () => {
              c.classList.toggle('on');
            });
          });
        },
        validate: async (el, s) => {
          const ids = [...el.querySelectorAll('.msf-chip.on')].map(c => c.getAttribute('data-id'));
          if (ids.length === 0) {
            el.querySelector('#msf-setores-err').textContent = 'Selecione pelo menos 1 setor';
            return false;
          }
          s.setores = ids;
          return true;
        },
      },
      // 4. formas atuação (multi)
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Forma de atuação</h3>
            <p class="msf-hint">Como ele(a) prefere entrar no negócio</p>
            <div class="msf-chips" id="msf-formas">
              ${FORMAS.map(o => `<button type="button" class="msf-chip${(s.formas_atuacao || []).includes(o.id) ? ' on' : ''}" data-id="${o.id}">${_h(o.label)}</button>`).join('')}
            </div>
            <div class="msf-err" id="msf-formas-err"></div>
          </div>
        `,
        onMount: (el, s) => {
          el.querySelectorAll('.msf-chip').forEach((c) => {
            c.addEventListener('click', () => c.classList.toggle('on'));
          });
        },
        validate: async (el, s) => {
          const ids = [...el.querySelectorAll('.msf-chip.on')].map(c => c.getAttribute('data-id'));
          if (ids.length === 0) {
            el.querySelector('#msf-formas-err').textContent = 'Selecione pelo menos 1 forma';
            return false;
          }
          s.formas_atuacao = ids;
          return true;
        },
      },
      // 5. localização
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Localização preferida</h3>
            <p class="msf-hint">Onde ele(a) quer comprar a empresa</p>
            <div class="msf-radio">
              <label><input type="radio" name="msf-loc" value="brasil_todo" ${s.localizacao_tipo === 'brasil_todo' || !s.localizacao_tipo ? 'checked' : ''}><span>Brasil todo</span></label>
              <label><input type="radio" name="msf-loc" value="estado" ${s.localizacao_tipo === 'estado' ? 'checked' : ''}><span>Estado específico</span></label>
              <label><input type="radio" name="msf-loc" value="cidade" ${s.localizacao_tipo === 'cidade' ? 'checked' : ''}><span>Cidade específica</span></label>
            </div>
            <div id="msf-loc-detalhe">
              <input type="text" class="msf-input" id="msf-estado" placeholder="UF (ex SP)" maxlength="2" value="${_h(s.estado || '')}" style="margin-top:10px;display:none">
              <input type="text" class="msf-input" id="msf-cidade" placeholder="Cidade" maxlength="60" value="${_h(s.cidade || '')}" style="margin-top:8px;display:none">
            </div>
            <div class="msf-err" id="msf-loc-err"></div>
          </div>
        `,
        onMount: (el, s) => {
          const radios = el.querySelectorAll('input[name="msf-loc"]');
          const elE = el.querySelector('#msf-estado');
          const elC = el.querySelector('#msf-cidade');
          function refresh() {
            const v = (el.querySelector('input[name="msf-loc"]:checked') || {}).value;
            elE.style.display = (v === 'estado' || v === 'cidade') ? 'block' : 'none';
            elC.style.display = v === 'cidade' ? 'block' : 'none';
          }
          radios.forEach(r => r.addEventListener('change', refresh));
          refresh();
        },
        validate: async (el, s) => {
          const tipo = (el.querySelector('input[name="msf-loc"]:checked') || {}).value || 'brasil_todo';
          s.localizacao_tipo = tipo;
          if (tipo === 'estado' || tipo === 'cidade') {
            const uf = String(el.querySelector('#msf-estado').value || '').trim().toUpperCase();
            if (uf.length !== 2) { el.querySelector('#msf-loc-err').textContent = 'UF com 2 letras'; return false; }
            s.estado = uf;
          } else { s.estado = null; }
          if (tipo === 'cidade') {
            const cidade = String(el.querySelector('#msf-cidade').value || '').trim();
            if (cidade.length < 2) { el.querySelector('#msf-loc-err').textContent = 'Digite a cidade'; return false; }
            s.cidade = cidade;
          } else { s.cidade = null; }
          return true;
        },
      },
      // 6. valor alvo
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Valor alvo da operação</h3>
            <p class="msf-hint">Quanto ele(a) pretende investir · entre R$ 50 mil e R$ 10 milhões</p>
            <input type="number" class="msf-input" id="msf-valor" placeholder="500000" min="50000" max="10000000" step="1000" value="${s.valor_alvo || ''}" />
            <div class="msf-hint" id="msf-valor-fmt" style="margin-top:8px;font-family:var(--mono,monospace)"></div>
            <div class="msf-err" id="msf-valor-err"></div>
          </div>
        `,
        onMount: (el, s) => {
          const inp = el.querySelector('#msf-valor');
          const fmt = el.querySelector('#msf-valor-fmt');
          function update() {
            const n = Number(inp.value);
            fmt.textContent = Number.isFinite(n) && n > 0 ? _formatBRL(n) : '';
          }
          inp.addEventListener('input', update);
          inp.focus();
          update();
        },
        validate: async (el, s) => {
          const n = Number(el.querySelector('#msf-valor').value);
          if (!Number.isFinite(n) || n < 50000 || n > 10000000) {
            el.querySelector('#msf-valor-err').textContent = 'Valor entre R$ 50.000 e R$ 10.000.000';
            return false;
          }
          s.valor_alvo = n;
          return true;
        },
      },
      // 7. observações
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Observações <span class="msf-opt">(opcional)</span></h3>
            <p class="msf-hint">Algo específico que o admin precisa saber · até 500 caracteres</p>
            <textarea class="msf-input msf-textarea" id="msf-obs" maxlength="500" rows="5" placeholder="Ex: prefere fora de capitais · setor B2B com SaaS recorrente">${_h(s.observacoes || '')}</textarea>
          </div>
        `,
        onMount: (el) => el.querySelector('#msf-obs').focus(),
        validate: async (el, s) => {
          s.observacoes = String(el.querySelector('#msf-obs').value || '').trim() || null;
          return true;
        },
      },
      // 8. confirmação final
      {
        render: async (s) => {
          const labelSet = (s.setores || []).map(id => (SETORES.find(x => x.id === id) || {}).label || id).join(' · ');
          const labelFor = (s.formas_atuacao || []).map(id => (FORMAS.find(x => x.id === id) || {}).label || id).join(' · ');
          const loc = s.localizacao_tipo === 'brasil_todo' ? 'Brasil todo'
            : s.localizacao_tipo === 'estado' ? `Estado · ${s.estado}`
            : `Cidade · ${s.cidade}/${s.estado}`;
          const nome = s.proprietario_existe ? (s.proprietario_nome_existente || 'Proprietário') : (s.proprietario_nome || 'Proprietário');
          return `
            <div class="msf-step">
              <h3 class="msf-q">Revisar e confirmar</h3>
              <div class="msf-resumo">
                <div class="msf-resumo-row"><span>Proprietário</span><strong>${_h(nome)}</strong></div>
                <div class="msf-resumo-row"><span>Telefone</span><strong>${_h(s.phoneMasked)}</strong></div>
                <div class="msf-resumo-row"><span>Setores</span><strong>${_h(labelSet)}</strong></div>
                <div class="msf-resumo-row"><span>Forma</span><strong>${_h(labelFor)}</strong></div>
                <div class="msf-resumo-row"><span>Localização</span><strong>${_h(loc)}</strong></div>
                <div class="msf-resumo-row"><span>Valor alvo</span><strong>${_formatBRL(s.valor_alvo)}</strong></div>
                ${s.observacoes ? `<div class="msf-resumo-row"><span>Obs</span><strong>${_h(s.observacoes)}</strong></div>` : ''}
              </div>
              <p class="msf-hint" style="margin-top:14px">Ao confirmar · o proprietário recebe um WhatsApp com link pra aceitar o vínculo. Você é notificado quando ele aceitar.</p>
            </div>
          `;
        },
      },
    ];

    _modalStepper({
      titulo: 'Cadastrar tese pra alguém',
      ctaFinalLabel: 'Criar tese e enviar WhatsApp',
      steps,
      onSubmit: async (s, { mostrarSucesso }) => {
        const body = {
          proprietario_phone: s.phone,
          proprietario_user_id: s.proprietario_user_id || null,
          proprietario_nome: s.proprietario_existe ? null : s.proprietario_nome,
          dados_tese: {
            setores: s.setores,
            formas_atuacao: s.formas_atuacao,
            localizacao_tipo: s.localizacao_tipo,
            estado: s.estado,
            cidade: s.cidade,
            valor_alvo: s.valor_alvo,
            observacoes: s.observacoes,
          },
        };
        const res = await _apiCall('socio-cadastrar-tese', body);
        mostrarSucesso(`
          <div class="msf-step">
            <h3 class="msf-q" style="color:var(--accent,#0aa85a)">✓ Tese criada</h3>
            <p class="msf-hint">Código do vínculo: <strong>${_h(res.vinculo_codigo || '—')}</strong></p>
            <p class="msf-hint">Código da tese: <strong>${_h(res.tese_codigo || '—')}</strong></p>
            <p class="msf-hint" style="margin-top:14px">WhatsApp enviado pro proprietário · ele tem 30 dias pra aceitar.</p>
            ${res.is_ghost ? '<p class="msf-hint">Conta nova criada (ghost) · será ativada quando o proprietário aceitar.</p>' : ''}
          </div>
        `);
      },
    });
  }

  // ───── modal: cadastrar DIAGNÓSTICO · 8 steps ─────
  function modalCadastrarDiagnostico(_opts) {
    const steps = [
      _stepTelefone(),
      _stepConfirmacaoProprietario(),
      // 3. nome do negócio
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Nome do negócio</h3>
            <p class="msf-hint">Razão social ou nome fantasia da empresa</p>
            <input type="text" class="msf-input" id="msf-nome-neg" maxlength="100" placeholder="Padaria do Zé Ltda" value="${_h(s.nome_negocio || '')}" />
            <div class="msf-err" id="msf-nome-neg-err"></div>
          </div>
        `,
        onMount: (el) => el.querySelector('#msf-nome-neg').focus(),
        validate: async (el, s) => {
          const v = String(el.querySelector('#msf-nome-neg').value || '').trim();
          if (v.length < 2) { el.querySelector('#msf-nome-neg-err').textContent = 'Digite o nome do negócio'; return false; }
          s.nome_negocio = v;
          return true;
        },
      },
      // 4. setor + categoria
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Setor e categoria</h3>
            <p class="msf-hint">Em qual setor a empresa opera</p>
            <div class="msf-chips" id="msf-setor-d">
              ${SETORES.filter(x => x.id !== 'indiferente').map(o => `<button type="button" class="msf-chip${s.setor === o.id ? ' on' : ''}" data-id="${o.id}">${_h(o.label)}</button>`).join('')}
            </div>
            <input type="text" class="msf-input" id="msf-cat" placeholder="Categoria · ex: padaria, clínica veterinária" value="${_h(s.categoria || '')}" maxlength="100" style="margin-top:14px">
            <div class="msf-err" id="msf-setor-err"></div>
          </div>
        `,
        onMount: (el, s) => {
          el.querySelectorAll('.msf-chip').forEach(c => {
            c.addEventListener('click', () => {
              el.querySelectorAll('.msf-chip').forEach(x => x.classList.remove('on'));
              c.classList.add('on');
            });
          });
        },
        validate: async (el, s) => {
          const sel = el.querySelector('.msf-chip.on');
          if (!sel) { el.querySelector('#msf-setor-err').textContent = 'Selecione um setor'; return false; }
          s.setor = sel.getAttribute('data-id');
          s.categoria = String(el.querySelector('#msf-cat').value || '').trim() || null;
          return true;
        },
      },
      // 5. localização (cidade · estado)
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Localização da empresa</h3>
            <p class="msf-hint">Onde a empresa opera fisicamente</p>
            <input type="text" class="msf-input" id="msf-cidade-d" placeholder="Cidade" maxlength="60" value="${_h(s.cidade || '')}" />
            <input type="text" class="msf-input" id="msf-estado-d" placeholder="UF (ex SP)" maxlength="2" value="${_h(s.estado || '')}" style="margin-top:8px" />
            <div class="msf-err" id="msf-loc-d-err"></div>
          </div>
        `,
        onMount: (el) => el.querySelector('#msf-cidade-d').focus(),
        validate: async (el, s) => {
          const c = String(el.querySelector('#msf-cidade-d').value || '').trim();
          const u = String(el.querySelector('#msf-estado-d').value || '').trim().toUpperCase();
          if (c.length < 2) { el.querySelector('#msf-loc-d-err').textContent = 'Digite a cidade'; return false; }
          if (u.length !== 2) { el.querySelector('#msf-loc-d-err').textContent = 'UF com 2 letras'; return false; }
          s.cidade = c; s.estado = u;
          return true;
        },
      },
      // 6. faturamento anual
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Faturamento anual</h3>
            <p class="msf-hint">Receita bruta dos últimos 12 meses · em reais</p>
            <input type="number" class="msf-input" id="msf-fat" placeholder="1200000" min="1" step="1000" value="${s.faturamento_anual || ''}" />
            <div class="msf-hint" id="msf-fat-fmt" style="margin-top:8px;font-family:var(--mono,monospace)"></div>
            <div class="msf-err" id="msf-fat-err"></div>
          </div>
        `,
        onMount: (el) => {
          const inp = el.querySelector('#msf-fat');
          const fmt = el.querySelector('#msf-fat-fmt');
          function up() {
            const n = Number(inp.value);
            fmt.textContent = Number.isFinite(n) && n > 0 ? _formatBRL(n) : '';
          }
          inp.addEventListener('input', up);
          inp.focus();
          up();
        },
        validate: async (el, s) => {
          const n = Number(el.querySelector('#msf-fat').value);
          if (!Number.isFinite(n) || n <= 0) { el.querySelector('#msf-fat-err').textContent = 'Faturamento inválido'; return false; }
          s.faturamento_anual = n;
          return true;
        },
      },
      // 7. descrição curta (opcional)
      {
        render: async (s) => `
          <div class="msf-step">
            <h3 class="msf-q">Descrição curta <span class="msf-opt">(opcional)</span></h3>
            <p class="msf-hint">1 linha sobre o negócio · até 200 caracteres</p>
            <textarea class="msf-input msf-textarea" id="msf-desc" maxlength="200" rows="3" placeholder="Ex: padaria com 2 unidades · 12 anos de operação · ponto na esquina">${_h(s.descricao_curta || '')}</textarea>
          </div>
        `,
        onMount: (el) => el.querySelector('#msf-desc').focus(),
        validate: async (el, s) => {
          s.descricao_curta = String(el.querySelector('#msf-desc').value || '').trim() || null;
          return true;
        },
      },
      // 8. confirmação
      {
        render: async (s) => {
          const setorLabel = (SETORES.find(x => x.id === s.setor) || {}).label || s.setor;
          const nome = s.proprietario_existe ? (s.proprietario_nome_existente || 'Proprietário') : (s.proprietario_nome || 'Proprietário');
          return `
            <div class="msf-step">
              <h3 class="msf-q">Revisar e confirmar</h3>
              <div class="msf-resumo">
                <div class="msf-resumo-row"><span>Proprietário</span><strong>${_h(nome)}</strong></div>
                <div class="msf-resumo-row"><span>Telefone</span><strong>${_h(s.phoneMasked)}</strong></div>
                <div class="msf-resumo-row"><span>Negócio</span><strong>${_h(s.nome_negocio)}</strong></div>
                <div class="msf-resumo-row"><span>Setor</span><strong>${_h(setorLabel)}${s.categoria ? ' · ' + _h(s.categoria) : ''}</strong></div>
                <div class="msf-resumo-row"><span>Localização</span><strong>${_h(s.cidade + '/' + s.estado)}</strong></div>
                <div class="msf-resumo-row"><span>Faturamento anual</span><strong>${_formatBRL(s.faturamento_anual)}</strong></div>
                ${s.descricao_curta ? `<div class="msf-resumo-row"><span>Descrição</span><strong>${_h(s.descricao_curta)}</strong></div>` : ''}
              </div>
              <p class="msf-hint" style="margin-top:14px">Diagnóstico entra em curadoria admin. WhatsApp enviado pro proprietário pra aceitar o vínculo.</p>
            </div>
          `;
        },
      },
    ];

    _modalStepper({
      titulo: 'Cadastrar diagnóstico pra alguém',
      ctaFinalLabel: 'Criar diagnóstico e enviar WhatsApp',
      steps,
      onSubmit: async (s, { mostrarSucesso }) => {
        const body = {
          proprietario_phone: s.phone,
          proprietario_user_id: s.proprietario_user_id || null,
          proprietario_nome: s.proprietario_existe ? null : s.proprietario_nome,
          dados_diagnostico: {
            nome_negocio: s.nome_negocio,
            setor: s.setor,
            categoria: s.categoria,
            cidade: s.cidade,
            estado: s.estado,
            faturamento_anual: s.faturamento_anual,
            descricao_curta: s.descricao_curta,
          },
        };
        const res = await _apiCall('socio-cadastrar-diagnostico', body);
        mostrarSucesso(`
          <div class="msf-step">
            <h3 class="msf-q" style="color:var(--accent,#0aa85a)">✓ Diagnóstico criado</h3>
            <p class="msf-hint">Código do vínculo: <strong>${_h(res.vinculo_codigo || '—')}</strong></p>
            <p class="msf-hint">Código do negócio: <strong>${_h(res.negocio_codigo || '—')}</strong></p>
            <p class="msf-hint" style="margin-top:14px">WhatsApp enviado pro proprietário · ele tem 30 dias pra aceitar.</p>
            ${res.is_ghost ? '<p class="msf-hint">Conta nova criada (ghost) · será ativada quando o proprietário aceitar.</p>' : ''}
          </div>
        `);
      },
    });
  }

  // ───── modal: pedir vínculo · placeholder até SUB-BLOCO C ─────
  function modalPedirVinculo() {
    const wrap = document.createElement('div');
    wrap.className = 'modal-stepper-overlay';
    wrap.innerHTML = `
      <div class="modal-stepper">
        <div class="modal-stepper-head">
          <div class="modal-stepper-titulo">Pedir vínculo</div>
          <button type="button" class="modal-stepper-close" aria-label="Fechar">×</button>
        </div>
        <div class="modal-stepper-body">
          <div class="msf-step">
            <h3 class="msf-q">Em breve</h3>
            <p class="msf-hint">Essa funcionalidade será liberada na próxima fase do sócio-assessor (SUB-BLOCO C). Você poderá colar um código de tese ou diagnóstico existente e pedir vínculo ao proprietário.</p>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    function fechar() { document.body.style.overflow = ''; wrap.remove(); }
    wrap.querySelector('.modal-stepper-close').addEventListener('click', fechar);
  }

  window.SocioAcoes = {
    modalCadastrarTese,
    modalCadastrarDiagnostico,
    modalPedirVinculo,
  };
})();
