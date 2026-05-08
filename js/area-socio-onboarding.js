// area-socio-onboarding.js · V8 BLOCO 7 FASE 1 · 1Negócio
// Componente único de 5 estados pra fluxo de virar sócio-assessor.
// Uso (em portal-usuario.html): SocioOnboarding.render('#container-id')
//
// Requer: window.OneN.auth (auth-fetch.js carregado antes)

(function () {
  if (window.SocioOnboarding) return;

  const TERMO_VERSAO = 'v1.0';
  const TERMO_HTML = `
    <h3 style="font-family:'Syne',sans-serif;font-weight:700;font-size:18px;margin:0 0 12px">Termo de adesão · Sócio-Assessor 1Negócio</h3>
    <div style="font-size:13px;line-height:1.65;color:var(--ink-2);max-height:240px;overflow-y:auto;border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--surface-2,#f7f7f5)">
      <p><strong>1. Sigilo absoluto.</strong> Como sócio-assessor · você terá acesso a informações sensíveis de empresas em processo de venda. NÃO pode compartilhar dados com terceiros · NÃO pode contatar partes diretamente fora da plataforma.</p>
      <p><strong>2. Comissões.</strong> Você ganha quando converter: 2pp em vendas (lado comprador OU vendedor) · 50% em laudos/guiados/avaliações · 40% em mensalidades de Venda Assessorada. Pagamento mensal via PIX após confirmação da operação.</p>
      <p><strong>3. Vínculos.</strong> Pra ganhar comissão · você precisa estar vinculado à tese ou ao negócio. Vínculo pode ser por cadastro próprio (você cria) ou pedido (proprietário aceita).</p>
      <p><strong>4. Conduta.</strong> Você representa a 1Negócio. Comunicação profissional · resposta rápida · não pressionar partes. Suspensão imediata em caso de denúncia procedente.</p>
      <p><strong>5. Cancelamento.</strong> Você pode cancelar a qualquer momento · 1Negócio pode suspender com 7 dias de aviso. Comissões ainda não pagas referentes a operações já fechadas continuam devidas.</p>
      <p><strong>6. Documentação.</strong> Você precisa enviar RG/CNH/passaporte pra aprovação. Documento privado · só admin tem acesso.</p>
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
  const SUPABASE_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

  async function _fetchSocio() {
    const sess = _sess();
    if (!sess || !sess.user_id) return null;
    const r = await _af(SUPABASE_URL + '/rest/v1/socios?usuario_id=eq.' + sess.user_id + '&select=*&limit=1');
    if (!r.ok) return null;
    const arr = await r.json();
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  }

  async function _criarSocio() {
    const sess = _sess();
    if (!sess) return null;
    const r = await _af(SUPABASE_URL + '/rest/v1/socios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ usuario_id: sess.user_id, status: 'pendente_termo' }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('criar_socio ' + r.status + (t ? ': ' + t.slice(0, 200) : ''));
    }
    const arr = await r.json();
    return arr[0];
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

  function _h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function _btnPrimary(label, id) {
    return `<button id="${id}" style="padding:12px 22px;background:var(--ink,#0a1510);color:#fff;border:0;border-radius:12px;font:inherit;font-weight:700;font-size:14px;cursor:pointer">${_h(label)}</button>`;
  }
  function _btnSecondary(label, id) {
    return `<button id="${id}" style="padding:12px 22px;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:12px;font:inherit;font-weight:700;font-size:14px;cursor:pointer">${_h(label)}</button>`;
  }

  let _root = null;

  async function render(selector) {
    _root = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!_root) return;
    _root.innerHTML = '<div style="padding:24px;color:var(--ink-3);font-family:var(--mono,monospace)">carregando...</div>';
    try {
      const socio = await _fetchSocio();
      if (!socio) return _renderEstado1();
      switch (socio.status) {
        case 'pendente_termo': return _renderEstado2(socio);
        case 'aguardando_aprovacao_doc': return _renderEstado3(socio);
        case 'aprovado': return _renderEstado4(socio);
        case 'suspenso':
        case 'cancelado': return _renderEstado5(socio);
        default: return _renderEstado1();
      }
    } catch (e) {
      _root.innerHTML = `<div style="padding:24px;color:#dc2626">Erro carregando: ${_h(e.message)}</div>`;
    }
  }

  function _renderEstado1() {
    _root.innerHTML = `
      <div style="max-width:560px;padding:32px;border:1px solid var(--line);border-radius:20px;background:var(--bg)">
        <h2 style="font-family:'Syne',sans-serif;font-weight:700;font-size:24px;margin:0 0 10px;line-height:1.2">Quer ser sócio-assessor da 1Negócio?</h2>
        <p style="font-size:14px;color:var(--ink-2);line-height:1.65;margin:0 0 14px">
          Sócios-assessores ganham comissão por trazer compradores ou negócios pra plataforma · 2pp em vendas · 40% em mensalidades · 50% em laudos.
        </p>
        <p style="font-size:13px;color:var(--ink-3);line-height:1.6;margin:0 0 20px">
          O processo é rápido: você aceita o termo · envia um documento de identidade · admin aprova em até 48h.
        </p>
        ${_btnPrimary('Solicitar acesso →', 'btn-soc-criar')}
      </div>
    `;
    document.getElementById('btn-soc-criar').onclick = async () => {
      const btn = document.getElementById('btn-soc-criar');
      btn.disabled = true; btn.textContent = 'Criando...';
      try {
        await _criarSocio();
        await render(_root);
      } catch (e) {
        alert('Erro: ' + e.message);
        btn.disabled = false; btn.textContent = 'Solicitar acesso →';
      }
    };
  }

  function _renderEstado2(socio) {
    _root.innerHTML = `
      <div style="max-width:680px;padding:32px;border:1px solid var(--line);border-radius:20px;background:var(--bg)">
        <h2 style="font-family:'Syne',sans-serif;font-weight:700;font-size:22px;margin:0 0 16px">Aceite o termo e envie um documento</h2>
        ${TERMO_HTML}
        <label style="display:flex;align-items:center;gap:10px;margin:16px 0 18px;cursor:pointer;font-size:14px">
          <input type="checkbox" id="chk-termo" style="width:18px;height:18px;accent-color:var(--accent,#3dff95)">
          <span>Li e aceito o termo de responsabilidade e sigilo</span>
        </label>

        <div style="margin-bottom:14px">
          <label style="display:block;font-size:12px;font-weight:600;color:var(--ink-3);margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase;font-family:var(--mono,monospace)">Tipo de documento</label>
          <select id="sel-tipo" style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;font:inherit;font-size:14px;background:var(--bg)">
            <option value="cnh">CNH</option>
            <option value="rg">RG</option>
            <option value="passaporte">Passaporte</option>
            <option value="outro">Outro</option>
          </select>
        </div>

        <div style="margin-bottom:14px">
          <label style="display:block;font-size:12px;font-weight:600;color:var(--ink-3);margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase;font-family:var(--mono,monospace)">Arquivo (PDF · JPG · PNG · max 5MB)</label>
          <input type="file" id="inp-doc" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:12px;font:inherit;font-size:13px;background:var(--bg)">
        </div>

        <div id="soc-err" style="color:#dc2626;font-size:12px;margin-bottom:10px;min-height:16px"></div>

        <div style="display:flex;gap:10px">
          ${_btnPrimary('Enviar para aprovação →', 'btn-soc-enviar')}
        </div>
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
      <div style="max-width:560px;padding:32px;border:1px solid var(--line);border-radius:20px;background:var(--bg);text-align:center">
        <div style="display:inline-flex;width:56px;height:56px;background:rgba(245,185,85,.15);border-radius:50%;align-items:center;justify-content:center;margin-bottom:14px">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f5b955" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <h2 style="font-family:'Syne',sans-serif;font-weight:700;font-size:22px;margin:0 0 10px">Em análise</h2>
        <p style="font-size:14px;color:var(--ink-2);line-height:1.6;margin:0 0 8px">
          Seu cadastro foi recebido · você será notificado quando for aprovado (até 48h).
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
      <div style="max-width:560px;padding:32px;border:1.5px solid var(--accent,#3dff95);border-radius:20px;background:rgba(61,255,149,.06)">
        <div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent,#3dff95);font-weight:600;margin-bottom:6px">${_h(socio.codigo || 'S-????')}</div>
        <h2 style="font-family:'Syne',sans-serif;font-weight:700;font-size:24px;margin:0 0 10px">Bem-vindo · você é sócio-assessor 1Negócio</h2>
        <p style="font-size:14px;color:var(--ink-2);line-height:1.65;margin:0 0 18px">
          A área completa do sócio (cadastrar tese · pedir vínculos · catálogo · financeiro · projetos) chega na próxima fase. Por enquanto · seu cadastro está ativo.
        </p>
        ${_btnSecondary('Acessar área do sócio (em breve)', 'btn-area-soc')}
      </div>
    `;
    const b = document.getElementById('btn-area-soc');
    if (b) b.onclick = () => alert('Área do sócio · disponível na FASE 2');
  }

  function _renderEstado5(socio) {
    const txt = socio.status === 'suspenso' ? 'Seu acesso está suspenso.' : 'Seu acesso foi cancelado.';
    _root.innerHTML = `
      <div style="max-width:560px;padding:32px;border:1px solid #dc2626;border-radius:20px;background:rgba(220,38,38,.04)">
        <h2 style="font-family:'Syne',sans-serif;font-weight:700;font-size:22px;margin:0 0 10px;color:#dc2626">${_h(txt)}</h2>
        <p style="font-size:14px;color:var(--ink-2);line-height:1.6;margin:0 0 8px">
          Entre em contato com o admin pelo WhatsApp <a href="https://wa.me/5511952136406" target="_blank" style="color:var(--ink);text-decoration:underline;font-weight:600">5511952136406</a>.
        </p>
        ${socio.notas_admin ? `<p style="font-size:12px;color:var(--ink-3);font-family:var(--mono,monospace);margin-top:14px">Nota: ${_h(socio.notas_admin)}</p>` : ''}
      </div>
    `;
  }

  window.SocioOnboarding = { render };
})();
