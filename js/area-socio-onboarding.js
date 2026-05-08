// area-socio-onboarding.js · V8 BLOCO 8 · 1Negócio
// Componente de fluxo do sócio-assessor · 6 estados:
//   1a · landing (hero + diferenciais + tabela comissão)
//   1b · cadastro profundo (form com perguntas) → salva dados_cadastro JSONB
//   2  · termo + upload doc
//   3  · em análise
//   4  · aprovado
//   5  · suspenso/cancelado
// Uso (em portal-usuario.html): SocioOnboarding.render('#container-id')
// Requer: window.OneN.auth (auth-fetch.js carregado antes)

(function () {
  if (window.SocioOnboarding) return;

  const SUPABASE_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
  const TERMO_VERSAO = 'v1.0';

  const SETORES = [
    'Alimentação','Saúde · Clínicas','Educação','Tecnologia','Indústria',
    'Comércio · Varejo','Serviços B2B','Serviços B2C','E-commerce','Beleza · Estética',
    'Logística · Transporte','Outros'
  ];

  const TERMO_HTML = `
    <h3 style="font-family:var(--serif,'Syne',sans-serif);font-weight:700;font-size:18px;margin:0 0 12px">Termo de adesão · Sócio-Assessor 1Negócio</h3>
    <div style="font-size:13px;line-height:1.65;color:var(--ink-2);max-height:240px;overflow-y:auto;border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--surface-2,#f7f7f5)">
      <p style="margin:0 0 10px"><strong>1. Sigilo absoluto.</strong> Você terá acesso a informações sensíveis de empresas em processo de venda. NÃO pode compartilhar dados com terceiros · NÃO pode contatar partes diretamente fora da plataforma.</p>
      <p style="margin:0 0 10px"><strong>2. Comissões.</strong> Você ganha quando converter: 2pp em vendas (lado comprador OU vendedor) · 50% em laudos/guiados/avaliações · 40% em mensalidades de Venda Assessorada. Pagamento mensal via PIX após confirmação da operação.</p>
      <p style="margin:0 0 10px"><strong>3. Vínculos.</strong> Pra ganhar comissão · você precisa estar vinculado à tese ou ao negócio. Vínculo pode ser por cadastro próprio (você cria) ou pedido (proprietário aceita).</p>
      <p style="margin:0 0 10px"><strong>4. Conduta.</strong> Você representa a 1Negócio. Comunicação profissional · resposta rápida · não pressionar partes. Suspensão imediata em caso de denúncia procedente.</p>
      <p style="margin:0 0 10px"><strong>5. Cancelamento.</strong> Você pode cancelar a qualquer momento · 1Negócio pode suspender com 7 dias de aviso. Comissões ainda não pagas referentes a operações já fechadas continuam devidas.</p>
      <p style="margin:0"><strong>6. Documentação.</strong> Você precisa enviar RG/CNH/passaporte pra aprovação. Documento privado · só admin tem acesso.</p>
    </div>
  `;

  function _af(u, o) {
    return (window.OneN && window.OneN.auth && window.OneN.auth.authFetch)
      ? window.OneN.auth.authFetch(u, o) : fetch(u, o);
  }
  function _sess() {
    return (window.OneN && window.OneN.auth && window.OneN.auth.getSession)
      ? window.OneN.auth.getSession() : null;
  }
  function _h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function _fetchSocio() {
    const sess = _sess();
    if (!sess || !sess.user_id) return null;
    const r = await _af(SUPABASE_URL + '/rest/v1/socios?usuario_id=eq.' + sess.user_id + '&select=*&limit=1');
    if (!r.ok) return null;
    const arr = await r.json();
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  }

  async function _criarOuPatchSocio(dados_cadastro) {
    const sess = _sess();
    if (!sess) throw new Error('sem_sessao');
    // Tenta INSERT · se já existe (UNIQUE constraint usuario_id) faz PATCH
    const insR = await _af(SUPABASE_URL + '/rest/v1/socios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({
        usuario_id: sess.user_id,
        status: 'pendente_termo',
        dados_cadastro,
        dados_cadastro_preenchido_em: new Date().toISOString(),
      }),
    });
    if (insR.ok) {
      const arr = await insR.json();
      return arr[0];
    }
    // 409 conflict: já existe row · PATCH dados_cadastro
    if (insR.status === 409) {
      const r = await _af(SUPABASE_URL + '/rest/v1/socios?usuario_id=eq.' + sess.user_id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({
          dados_cadastro,
          dados_cadastro_preenchido_em: new Date().toISOString(),
        }),
      });
      if (!r.ok) throw new Error('patch_socio ' + r.status);
      const arr = await r.json();
      return arr[0];
    }
    const t = await insR.text().catch(() => '');
    throw new Error('criar_socio ' + insR.status + (t ? ': ' + t.slice(0, 200) : ''));
  }

  async function _enviarTermoEDoc(socio_id, documento_url, documento_tipo) {
    const r = await _af(SUPABASE_URL + '/rest/v1/socios?id=eq.' + socio_id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({
        termo_assinado_em: new Date().toISOString(),
        termo_versao: TERMO_VERSAO,
        documento_url, documento_tipo,
        status: 'aguardando_aprovacao_doc',
      }),
    });
    if (!r.ok) throw new Error('enviar_termo ' + r.status);
    const arr = await r.json();
    return arr[0];
  }

  async function _uploadDoc(file) {
    const sess = _sess();
    if (!sess) throw new Error('sem_sessao');
    const ts = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const path = sess.user_id + '/' + ts + '_' + safeName;
    const url = SUPABASE_URL + '/storage/v1/object/documentos-socios/' + encodeURIComponent(path);
    const r = await _af(url, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('upload ' + r.status + (t ? ': ' + t.slice(0, 200) : ''));
    }
    return path;
  }

  let _root = null;

  async function render(selector) {
    _root = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!_root) return;
    _root.innerHTML = '<div style="padding:24px;color:var(--ink-3);font-family:var(--mono,monospace)">carregando...</div>';
    try {
      const socio = await _fetchSocio();
      if (!socio) return _renderLanding();
      switch (socio.status) {
        case 'pendente_termo': return _renderEstado2(socio);
        case 'aguardando_aprovacao_doc': return _renderEstado3(socio);
        case 'aprovado': return _renderEstado4(socio);
        case 'suspenso':
        case 'cancelado': return _renderEstado5(socio);
        default: return _renderLanding();
      }
    } catch (e) {
      _root.innerHTML = `<div style="padding:24px;color:#dc2626">Erro carregando: ${_h(e.message)}</div>`;
    }
  }

  // ============================================================
  // ESTADO 1A · LANDING
  // ============================================================
  function _renderLanding() {
    _root.innerHTML = `
      <div style="max-width:880px;margin:0 auto">

        <!-- HERO -->
        <section style="padding:36px 32px;border:1px solid var(--accent-line,rgba(10,168,90,.3));border-radius:24px;background:linear-gradient(160deg,var(--accent-soft,rgba(10,168,90,.12)),var(--surface) 75%);margin-bottom:22px">
          <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent,#0aa85a);font-weight:600;margin-bottom:14px;display:inline-flex;align-items:center;gap:10px">
            <span style="width:24px;height:1px;background:currentColor"></span>Programa Sócio-Assessor
          </div>
          <h1 style="font-family:var(--serif,'Syne'),serif;font-weight:800;font-size:clamp(28px,4vw,42px);line-height:1.08;letter-spacing:-.022em;color:var(--ink);margin:0 0 14px">
            Vire sócio-assessor da 1Negócio.<br>Ganhe trazendo empresas e compradores.
          </h1>
          <p style="font-size:15.5px;color:var(--ink-2);line-height:1.6;margin:0 0 8px;max-width:640px">
            Você indica · 1Negócio entrega o trilho técnico (laudo · diligência · documentos · NDA · operação). Você ganha comissão sobre cada conversão.
          </p>
          <p style="font-size:13.5px;color:var(--ink-3);line-height:1.55;margin:0;max-width:640px">
            Sem mensalidade. Sem volume mínimo. Aprovação em até 48h.
          </p>
        </section>

        <!-- DIFERENCIAIS -->
        <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:22px">
          ${[
            ['📦','Sigilo blindado','Comprador e vendedor nunca se falam direto. Tudo via consultor 1Negócio · você fica protegido.'],
            ['🧭','Trilho técnico pronto','Laudo · DRE · valuation · NDA · termos. Você indica · a gente operacionaliza.'],
            ['💵','Comissão recorrente','Vendas, laudos, guiados, avaliações e mensalidades de Assessorada — todas pagam você.'],
            ['🪪','Vínculo formal','Cada negócio/tese fica gravado no seu nome (S-XXXX) · zero risco de perder a comissão.'],
          ].map(([emoji,titulo,desc]) => `
            <div style="padding:18px 18px 16px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--shadow-soft,0 6px 24px -10px rgba(10,20,12,.1))">
              <div style="font-size:24px;margin-bottom:6px">${emoji}</div>
              <div style="font-family:var(--serif,'Syne'),serif;font-weight:700;font-size:15px;color:var(--ink);margin-bottom:4px">${titulo}</div>
              <div style="font-size:13px;color:var(--ink-3);line-height:1.5">${desc}</div>
            </div>
          `).join('')}
        </section>

        <!-- TABELA COMISSÃO -->
        <section style="padding:24px 26px;border:1px solid var(--line);border-radius:20px;background:var(--surface);margin-bottom:22px">
          <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:14px">Como você ganha</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border:1px solid var(--line);border-radius:14px;overflow:hidden">
            ${[
              ['Venda 2pp','2% sobre o valor da venda · cada lado pago separado · até 4% se trazer comprador E vendedor'],
              ['Laudo · Guiado · Avaliação','50% da receita do produto que você indicou'],
              ['Venda Assessorada','40% da mensalidade enquanto o contrato vigorar'],
            ].map(([titulo,desc],i) => `
              <div style="padding:16px 18px;border-right:${i<2?'1px solid var(--line)':'0'};background:${i===0?'var(--accent-soft,rgba(10,168,90,.06))':'var(--bg-2,#fff)'}">
                <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.08em;color:var(--accent,#0aa85a);font-weight:700;margin-bottom:6px">${titulo}</div>
                <div style="font-size:12.5px;color:var(--ink-2);line-height:1.5">${desc}</div>
              </div>
            `).join('')}
          </div>
        </section>

        <!-- REQUISITOS -->
        <section style="padding:22px 26px;border:1px solid var(--line);border-radius:20px;background:var(--bg-2,#fff);margin-bottom:22px">
          <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:12px">Requisitos</div>
          <ul style="margin:0;padding:0 0 0 18px;font-size:13.5px;color:var(--ink-2);line-height:1.85">
            <li>Aceitar termo de sigilo e conduta (cláusulas abaixo no formulário)</li>
            <li>Enviar documento de identidade (RG · CNH · passaporte) pra validação</li>
            <li>Comunicação profissional via WhatsApp e plataforma</li>
            <li>Sem mensalidade · sem volume mínimo · você pode cancelar quando quiser</li>
          </ul>
        </section>

        <!-- CTA -->
        <section style="text-align:center;padding:8px">
          <button id="btn-soc-comecar" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:58px;padding:0 38px;border-radius:999px;background:var(--accent,#0aa85a);color:var(--accent-ink,#fff);font-family:var(--mono,monospace);font-size:13px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;border:1px solid transparent;cursor:pointer;transition:transform .12s">
            Quero me cadastrar como sócio-assessor →
          </button>
          <div style="font-family:var(--mono,monospace);font-size:11px;color:var(--ink-3);letter-spacing:.06em;margin-top:14px">
            Resposta em até 48h · Sem compromisso até a aprovação
          </div>
        </section>

      </div>
    `;
    document.getElementById('btn-soc-comecar').onclick = _renderForm;
  }

  // ============================================================
  // ESTADO 1B · FORM PROFUNDO
  // ============================================================
  function _renderForm() {
    const sess = _sess() || {};
    const nomeAtual = sess.nome || '';
    const wppAtual = sess.whatsapp || '';
    _root.innerHTML = `
      <div style="max-width:760px;margin:0 auto">
        <div style="margin-bottom:18px">
          <button id="btn-soc-voltar" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink-2);font-family:var(--mono,monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer">
            ← Voltar
          </button>
        </div>

        <div style="padding:32px 32px 28px;border:1px solid var(--line-2,rgba(10,15,12,.18));border-radius:24px;background:var(--surface);box-shadow:var(--shadow-card,0 24px 60px -18px rgba(10,20,12,.18))">
          <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent,#0aa85a);margin-bottom:14px;font-weight:600">
            Cadastro · Sócio-Assessor
          </div>
          <h2 style="font-family:var(--serif,'Syne'),serif;font-weight:800;font-size:clamp(24px,3vw,32px);line-height:1.1;margin:0 0 8px;color:var(--ink)">
            Conta um pouco sobre você.
          </h2>
          <p style="font-size:14px;color:var(--ink-2);line-height:1.55;margin:0 0 26px;max-width:560px">
            Esses dados ajudam a 1Negócio a alinhar expectativas antes de aprovar e a recomendar negócios que combinam com seu perfil.
          </p>

          <form id="form-socio" novalidate>
            ${_blocoQuemEhVoce(nomeAtual, wppAtual)}
            ${_divider()}
            ${_blocoExperiencia()}
            ${_divider()}
            ${_blocoNetworkCarteira()}
            ${_divider()}
            ${_blocoMotivacao()}

            <div id="soc-form-err" style="color:#dc2626;font-size:13px;margin-top:14px;min-height:16px"></div>

            <button type="submit" id="btn-soc-form-enviar" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;height:58px;border-radius:999px;background:var(--accent,#0aa85a);color:var(--accent-ink,#fff);font-family:var(--mono,monospace);font-size:13px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;border:1px solid transparent;cursor:pointer;margin-top:20px">
              Enviar cadastro · ir para o termo →
            </button>
          </form>
        </div>
      </div>
    `;
    document.getElementById('btn-soc-voltar').onclick = _renderLanding;
    _bindFormEnvio();
  }

  function _divider() {
    return `<div style="height:1px;background:var(--line);margin:24px 0" role="separator"></div>`;
  }

  function _labelStyle() {
    return `font-family:var(--mono,monospace);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);font-weight:600`;
  }
  function _blocoTituloStyle() {
    return `font-family:var(--mono,monospace);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:14px;font-weight:600`;
  }
  function _inputStyle() {
    return `width:100%;height:48px;padding:0 16px;border-radius:12px;border:1px solid var(--line-2,rgba(10,15,12,.18));background:var(--bg-2,#fff);font-family:inherit;font-size:14.5px;color:var(--ink);font-weight:500;transition:border-color .15s,box-shadow .15s`;
  }
  function _selectStyle() {
    return _inputStyle() + `;appearance:none;cursor:pointer;padding-right:38px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center`;
  }
  function _textareaStyle() {
    return _inputStyle().replace('height:48px', 'min-height:90px;height:auto').replace('padding:0 16px', 'padding:12px 16px;line-height:1.5;resize:vertical');
  }

  function _blocoQuemEhVoce(nome, wpp) {
    return `
      <div>
        <div style="${_blocoTituloStyle()}">01 · Quem é você</div>
        <div style="display:grid;grid-template-columns:1fr;gap:12px">
          <div>
            <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-nome">Nome completo</label>
            <input id="f-nome" name="nome" type="text" required value="${_h(nome)}" style="${_inputStyle()}">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-wpp">WhatsApp</label>
              <input id="f-wpp" name="whatsapp" type="tel" required value="${_h(wpp)}" placeholder="(11) 99999-9999" style="${_inputStyle()};font-family:var(--mono,monospace)">
            </div>
            <div>
              <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-email">E-mail</label>
              <input id="f-email" name="email" type="email" required style="${_inputStyle()}">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:90px 1fr;gap:8px">
            <div>
              <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-uf">UF</label>
              <input id="f-uf" name="estado" type="text" maxlength="2" style="${_inputStyle()};text-transform:uppercase;text-align:center;font-family:var(--mono,monospace)" placeholder="SP">
            </div>
            <div>
              <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-cidade">Cidade</label>
              <input id="f-cidade" name="cidade" type="text" style="${_inputStyle()}" placeholder="São Paulo">
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function _blocoExperiencia() {
    return `
      <div>
        <div style="${_blocoTituloStyle()}">02 · Sua atuação</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-profissao">Profissão</label>
            <select id="f-profissao" name="profissao" style="${_selectStyle()}">
              <option value="">Selecione</option>
              <option value="corretor_imobiliario">Corretor imobiliário</option>
              <option value="corretor_negocios">Corretor de empresas</option>
              <option value="contador">Contador</option>
              <option value="advogado">Advogado</option>
              <option value="consultor_ma">Consultor M&amp;A</option>
              <option value="consultor_negocios">Consultor de negócios</option>
              <option value="empresario">Empresário</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div>
            <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-tempo">Tempo de atuação</label>
            <select id="f-tempo" name="tempo_atuacao" style="${_selectStyle()}">
              <option value="">Selecione</option>
              <option value="menos_1ano">Menos de 1 ano</option>
              <option value="1_3anos">1 a 3 anos</option>
              <option value="3_7anos">3 a 7 anos</option>
              <option value="7_15anos">7 a 15 anos</option>
              <option value="mais_15anos">Mais de 15 anos</option>
            </select>
          </div>
        </div>
        <div>
          <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-outras">Você atua em outras plataformas/programas similares hoje?</label>
          <input id="f-outras" name="parceiro_outras_plataformas" type="text" style="${_inputStyle()}" placeholder="Ex: BizBuySell, Sundae, sou independente, não atuo ainda…">
        </div>
      </div>
    `;
  }

  function _blocoNetworkCarteira() {
    return `
      <div>
        <div style="${_blocoTituloStyle()}">03 · Sua carteira e network</div>
        <div style="margin-bottom:14px">
          <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-carteira">Hoje você tem em carteira algum vendedor ou comprador específico?</label>
          <textarea id="f-carteira" name="carteira" style="${_textareaStyle()}" rows="3" placeholder="Ex: 3 vendedores em SP querendo vender entre 1M e 5M · 1 grupo investidor com tese pra clínicas no Sul · etc."></textarea>
        </div>

        <div style="margin-bottom:14px">
          <label style="${_labelStyle()};display:block;margin-bottom:8px">Setores que você conhece bem (selecione 1 ou mais)</label>
          <div id="setores-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">
            ${SETORES.map(s => `
              <label style="display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer;font-size:13px;background:var(--bg-2,#fff)">
                <input type="checkbox" name="setores" value="${_h(s)}" style="accent-color:var(--accent,#0aa85a);width:14px;height:14px">
                <span>${_h(s)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div>
          <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-disponibilidade">Disponibilidade semanal pra atuar como sócio</label>
          <select id="f-disponibilidade" name="disponibilidade" style="${_selectStyle()}">
            <option value="">Selecione</option>
            <option value="ate_5h">Até 5h/semana (paralelo a outra atividade)</option>
            <option value="5_15h">5h a 15h/semana</option>
            <option value="15_30h">15h a 30h/semana</option>
            <option value="dedicacao_total">Dedicação total · 30h+/semana</option>
          </select>
        </div>
      </div>
    `;
  }

  function _blocoMotivacao() {
    return `
      <div>
        <div style="${_blocoTituloStyle()}">04 · Por que você quer ser sócio</div>
        <label style="${_labelStyle()};display:block;margin-bottom:6px" for="f-motivacao">Em poucas linhas, o que te trouxe até aqui?</label>
        <textarea id="f-motivacao" name="motivacao" required style="${_textareaStyle()}" rows="4" placeholder="Ex: Quero diversificar minhas fontes de renda · já vi várias vendas de empresa darem errado por falta de trilho técnico · gosto da proposta de sigilo absoluto · etc."></textarea>
      </div>
    `;
  }

  function _bindFormEnvio() {
    const wpp = document.getElementById('f-wpp');
    if (wpp) {
      wpp.addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g, '').slice(0, 11);
        if (v.length > 6) v = '(' + v.slice(0,2) + ') ' + v.slice(2,7) + '-' + v.slice(7);
        else if (v.length > 2) v = '(' + v.slice(0,2) + ') ' + v.slice(2);
        e.target.value = v;
      });
    }
    const form = document.getElementById('form-socio');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('soc-form-err');
      err.textContent = '';
      const fd = new FormData(form);
      const setores = Array.from(form.querySelectorAll('input[name="setores"]:checked')).map(x => x.value);
      const dados = {
        nome: (fd.get('nome') || '').toString().trim(),
        whatsapp: (fd.get('whatsapp') || '').toString().replace(/\D/g, ''),
        email: (fd.get('email') || '').toString().trim(),
        cidade: (fd.get('cidade') || '').toString().trim() || null,
        estado: (fd.get('estado') || '').toString().toUpperCase().trim() || null,
        profissao: (fd.get('profissao') || '').toString() || null,
        tempo_atuacao: (fd.get('tempo_atuacao') || '').toString() || null,
        parceiro_outras_plataformas: (fd.get('parceiro_outras_plataformas') || '').toString().trim() || null,
        carteira: (fd.get('carteira') || '').toString().trim() || null,
        setores,
        disponibilidade: (fd.get('disponibilidade') || '').toString() || null,
        motivacao: (fd.get('motivacao') || '').toString().trim(),
      };

      if (dados.nome.length < 3) { err.textContent = 'Informe seu nome completo.'; return; }
      if (dados.whatsapp.length < 10 || dados.whatsapp.length > 11) { err.textContent = 'WhatsApp inválido (DDD + número).'; return; }
      if (dados.email.indexOf('@') < 1) { err.textContent = 'E-mail inválido.'; return; }
      if (dados.motivacao.length < 10) { err.textContent = 'Conta um pouco mais sobre sua motivação.'; return; }

      const btn = document.getElementById('btn-soc-form-enviar');
      btn.disabled = true; btn.textContent = 'Enviando...';
      try {
        await _criarOuPatchSocio(dados);
        await render(_root);
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false; btn.textContent = 'Enviar cadastro · ir para o termo →';
      }
    });
  }

  // ============================================================
  // ESTADO 2 · TERMO + DOC
  // ============================================================
  function _renderEstado2(socio) {
    _root.innerHTML = `
      <div style="max-width:680px;margin:0 auto;padding:32px;border:1px solid var(--line);border-radius:20px;background:var(--surface)">
        <h2 style="font-family:var(--serif,'Syne'),sans-serif;font-weight:700;font-size:22px;margin:0 0 6px">Falta pouco · aceite o termo e envie um documento</h2>
        <p style="font-size:13.5px;color:var(--ink-3);margin:0 0 18px;line-height:1.55">
          Seus dados de cadastro foram salvos. Agora a 1Negócio precisa do termo aceito e um documento de identidade pra aprovar.
        </p>
        ${TERMO_HTML}
        <label style="display:flex;align-items:center;gap:10px;margin:16px 0 18px;cursor:pointer;font-size:14px">
          <input type="checkbox" id="chk-termo" style="width:18px;height:18px;accent-color:var(--accent,#0aa85a)">
          <span>Li e aceito o termo de responsabilidade e sigilo</span>
        </label>

        <div style="margin-bottom:14px">
          <label style="display:block;font-size:11px;font-weight:600;color:var(--ink-3);margin-bottom:6px;letter-spacing:.10em;text-transform:uppercase;font-family:var(--mono,monospace)">Tipo de documento</label>
          <select id="sel-tipo" style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;font:inherit;font-size:14px;background:var(--bg-2,#fff)">
            <option value="cnh">CNH</option>
            <option value="rg">RG</option>
            <option value="passaporte">Passaporte</option>
            <option value="outro">Outro</option>
          </select>
        </div>

        <div style="margin-bottom:14px">
          <label style="display:block;font-size:11px;font-weight:600;color:var(--ink-3);margin-bottom:6px;letter-spacing:.10em;text-transform:uppercase;font-family:var(--mono,monospace)">Arquivo (PDF · JPG · PNG · max 5MB)</label>
          <input type="file" id="inp-doc" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:12px;font:inherit;font-size:13px;background:var(--bg-2,#fff)">
        </div>

        <div id="soc-err" style="color:#dc2626;font-size:12px;margin-bottom:10px;min-height:16px"></div>

        <button id="btn-soc-enviar" style="padding:14px 26px;background:var(--accent,#0aa85a);color:var(--accent-ink,#fff);border:0;border-radius:12px;font:inherit;font-weight:700;font-size:14px;cursor:pointer">
          Enviar para aprovação →
        </button>
      </div>
    `;
    const btn = document.getElementById('btn-soc-enviar');
    btn.disabled = true;
    const chk = document.getElementById('chk-termo');
    const inp = document.getElementById('inp-doc');
    function _atualizar() {
      btn.disabled = !(chk.checked && inp.files && inp.files[0] && inp.files[0].size <= 5 * 1024 * 1024);
    }
    chk.addEventListener('change', _atualizar);
    inp.addEventListener('change', _atualizar);
    btn.onclick = async () => {
      const file = inp.files[0];
      const tipo = document.getElementById('sel-tipo').value;
      const err = document.getElementById('soc-err');
      err.textContent = '';
      btn.disabled = true; btn.textContent = 'Enviando...';
      try {
        const path = await _uploadDoc(file);
        await _enviarTermoEDoc(socio.id, path, tipo);
        await render(_root);
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false; btn.textContent = 'Enviar para aprovação →';
      }
    };
  }

  function _renderEstado3(socio) {
    _root.innerHTML = `
      <div style="max-width:560px;margin:0 auto;padding:32px;border:1px solid var(--line);border-radius:20px;background:var(--surface);text-align:center">
        <div style="display:inline-flex;width:56px;height:56px;background:rgba(245,200,66,.15);border-radius:50%;align-items:center;justify-content:center;margin-bottom:14px">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f5c842" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <h2 style="font-family:var(--serif,'Syne'),sans-serif;font-weight:700;font-size:22px;margin:0 0 10px">Em análise</h2>
        <p style="font-size:14px;color:var(--ink-2);line-height:1.6;margin:0 0 8px">
          Seu cadastro foi recebido. A 1Negócio responde em até 48h.
        </p>
        <p style="font-size:12px;color:var(--ink-3);font-family:var(--mono,monospace);margin:14px 0 0">
          Documento enviado: ${_h(socio.documento_tipo || '—')}<br>
          Termo aceito em: ${socio.termo_assinado_em ? new Date(socio.termo_assinado_em).toLocaleString('pt-BR') : '—'}
        </p>
      </div>
    `;
  }

  function _renderEstado4(socio) {
    _root.innerHTML = `
      <div style="max-width:560px;margin:0 auto;padding:32px;border:1.5px solid var(--accent,#0aa85a);border-radius:20px;background:var(--accent-soft,rgba(10,168,90,.06))">
        <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent,#0aa85a);font-weight:600;margin-bottom:6px">${_h(socio.codigo || 'S-????')}</div>
        <h2 style="font-family:var(--serif,'Syne'),sans-serif;font-weight:700;font-size:24px;margin:0 0 10px">Bem-vindo · você é sócio-assessor 1Negócio</h2>
        <p style="font-size:14px;color:var(--ink-2);line-height:1.65;margin:0 0 18px">
          A área completa do sócio (cadastrar tese · pedir vínculos · catálogo · financeiro · projetos) chega na próxima fase. Por enquanto · seu cadastro está ativo.
        </p>
      </div>
    `;
  }

  function _renderEstado5(socio) {
    const txt = socio.status === 'suspenso' ? 'Seu acesso está suspenso.' : 'Seu acesso foi cancelado.';
    _root.innerHTML = `
      <div style="max-width:560px;margin:0 auto;padding:32px;border:1px solid #dc2626;border-radius:20px;background:rgba(220,38,38,.04)">
        <h2 style="font-family:var(--serif,'Syne'),sans-serif;font-weight:700;font-size:22px;margin:0 0 10px;color:#dc2626">${_h(txt)}</h2>
        <p style="font-size:14px;color:var(--ink-2);line-height:1.6;margin:0 0 8px">
          Entre em contato com o admin pelo WhatsApp <a href="https://wa.me/5511952136406" target="_blank" style="color:var(--ink);text-decoration:underline;font-weight:600">5511952136406</a>.
        </p>
        ${socio.notas_admin ? `<p style="font-size:12px;color:var(--ink-3);font-family:var(--mono,monospace);margin-top:14px">Nota: ${_h(socio.notas_admin)}</p>` : ''}
      </div>
    `;
  }

  window.SocioOnboarding = { render };
})();
