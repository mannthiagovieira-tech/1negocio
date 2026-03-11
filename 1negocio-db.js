// ══════════════════════════════════════════════════════════
//  1NEGÓCIO — SUPABASE CLIENT & DATA LAYER
//  Incluir em todos os arquivos antes de qualquer outro script
//  <script src="1negocio-db.js"></script>
// ══════════════════════════════════════════════════════════

const SB_URL  = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

// ── baixo nível: fetch wrapper ────────────────────────────
async function _sb(path, opts = {}, key = SB_ANON) {
  const headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + (opts._jwt || key),
    'Content-Type': 'application/json',
    'Prefer': opts.prefer || 'return=representation',
    ...opts.headers
  };
  delete opts._jwt; delete opts.prefer; delete opts.headers;
  const res = await fetch(SB_URL + path, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── RPC helper ───────────────────────────────────────────
async function _rpc(fn, params, key = SB_ANON) {
  return _sb('/rest/v1/rpc/' + fn, {
    method: 'POST',
    body: JSON.stringify(params)
  }, key);
}

// ════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════

const DB = {
  _jwt: null,   // set after login
  _uid: null,

  // ── signup + cria registro em usuarios ───────────────
  async signUp({ nome, email, password, whatsapp, tipo }) {
    // 1. criar conta no Supabase Auth
    const res = await fetch(SB_URL + '/auth/v1/signup', {
      method: 'POST',
      headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.error_description || 'Erro no cadastro');

    const jwt = data.access_token;
    const uid = data.user?.id;
    if (!uid) throw new Error('UID não retornado');

    // 2. inserir em public.usuarios
    await _sb('/rest/v1/usuarios', {
      method: 'POST',
      _jwt: jwt,
      prefer: 'return=minimal',
      body: JSON.stringify({ id: uid, nome, email, whatsapp, tipo })
    }, SB_ANON);

    DB._jwt = jwt;
    DB._uid = uid;
    sessionStorage.setItem('1n_jwt', jwt);
    sessionStorage.setItem('1n_uid', uid);
    return { jwt, uid, nome, email, tipo };
  },

  // ── login ─────────────────────────────────────────────
  async signIn({ email, password }) {
    const res = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || 'E-mail ou senha incorretos');

    DB._jwt = data.access_token;
    DB._uid = data.user?.id;
    sessionStorage.setItem('1n_jwt', data.access_token);
    sessionStorage.setItem('1n_uid', data.user?.id);

    // busca perfil
    const perfil = await DB.getPerfil(data.user.id, data.access_token);
    return { jwt: data.access_token, uid: data.user.id, ...perfil };
  },

  // ── signout ───────────────────────────────────────────
  signOut() {
    DB._jwt = null; DB._uid = null;
    sessionStorage.removeItem('1n_jwt');
    sessionStorage.removeItem('1n_uid');
  },

  // ── restore session ───────────────────────────────────
  async restoreSession() {
    const jwt = sessionStorage.getItem('1n_jwt');
    const uid = sessionStorage.getItem('1n_uid');
    if (!jwt || !uid) return null;
    DB._jwt = jwt; DB._uid = uid;
    try {
      const perfil = await DB.getPerfil(uid, jwt);
      return { jwt, uid, ...perfil };
    } catch(e) {
      DB.signOut();
      return null;
    }
  },

  // ════════════════════════════════════════════════════
  //  USUÁRIOS
  // ════════════════════════════════════════════════════
  async getPerfil(uid, jwt) {
    const rows = await _sb('/rest/v1/usuarios?id=eq.' + uid + '&limit=1', {
      _jwt: jwt || DB._jwt
    });
    if (!rows || !rows.length) throw new Error('Perfil não encontrado');
    return rows[0];
  },

  async updatePerfil(fields) {
    return _sb('/rest/v1/usuarios?id=eq.' + DB._uid, {
      method: 'PATCH',
      _jwt: DB._jwt,
      body: JSON.stringify(fields)
    });
  },

  // ════════════════════════════════════════════════════
  //  NEGÓCIOS — HOMEPAGE (públicos)
  // ════════════════════════════════════════════════════
  async getNegociosPublicados() {
    return _sb('/rest/v1/negocios?status=eq.publicado&order=updated_at.desc', {
      headers: { 'Accept': 'application/json' }
    });
  },

  async getNegocioByVendedor(vendedorId) {
    const rows = await _sb('/rest/v1/negocios?vendedor_id=eq.' + vendedorId + '&limit=1', {
      _jwt: DB._jwt
    });
    return rows?.[0] || null;
  },

  async getDreLinhas(negocioId, jwt) {
    return _sb('/rest/v1/dre_linhas?negocio_id=eq.' + negocioId + '&order=ordem.asc', {
      _jwt: jwt || DB._jwt
    });
  },

  // ── status do anúncio ─────────────────────────────────
  async updateNegocioStatus(negocioId, status, extras = {}) {
    return _sb('/rest/v1/negocios?id=eq.' + negocioId, {
      method: 'PATCH',
      _jwt: DB._jwt,
      body: JSON.stringify({ status, ...extras })
    });
  },

  // ════════════════════════════════════════════════════
  //  FAVORITOS
  // ════════════════════════════════════════════════════
  async getFavoritos() {
    return _sb(
      '/rest/v1/favoritos?usuario_id=eq.' + DB._uid +
      '&select=*,negocio:negocios(id,nome,tag,categoria,cidade,estado,preco_pedido,faturamento_anual)',
      { _jwt: DB._jwt }
    );
  },

  async addFavorito(negocioId) {
    return _sb('/rest/v1/favoritos', {
      method: 'POST',
      _jwt: DB._jwt,
      body: JSON.stringify({ usuario_id: DB._uid, negocio_id: negocioId })
    });
  },

  async removeFavorito(negocioId) {
    return _sb('/rest/v1/favoritos?usuario_id=eq.' + DB._uid + '&negocio_id=eq.' + negocioId, {
      method: 'DELETE',
      _jwt: DB._jwt,
      prefer: 'return=minimal'
    });
  },

  // ════════════════════════════════════════════════════
  //  SOLICITAÇÕES DE INFO
  // ════════════════════════════════════════════════════
  async getSolicitacoes() {
    return _sb(
      '/rest/v1/solicitacoes_info?comprador_id=eq.' + DB._uid +
      '&select=*,negocio:negocios(id,nome,tag,cidade,estado)&order=created_at.desc',
      { _jwt: DB._jwt }
    );
  },

  async criarSolicitacao(negocioId, cnpj) {
    return _sb('/rest/v1/solicitacoes_info', {
      method: 'POST',
      _jwt: DB._jwt,
      body: JSON.stringify({ comprador_id: DB._uid, negocio_id: negocioId, cnpj_informado: cnpj })
    });
  },

  // ════════════════════════════════════════════════════
  //  TERMOS DE ACEITE
  // ════════════════════════════════════════════════════
  async registrarAceite(negocioId, tipo) {
    return _sb('/rest/v1/termos_aceite', {
      method: 'POST',
      _jwt: DB._jwt,
      body: JSON.stringify({ usuario_id: DB._uid, negocio_id: negocioId, tipo })
    });
  },

  // ════════════════════════════════════════════════════
  //  MENSAGENS DE ALTERAÇÃO
  // ════════════════════════════════════════════════════
  async getMsgsAlteracao(negocioId) {
    return _sb(
      '/rest/v1/mensagens_alteracao?negocio_id=eq.' + negocioId + '&order=created_at.asc',
      { _jwt: DB._jwt }
    );
  },

  async enviarMsgAlteracao(negocioId, texto) {
    return _sb('/rest/v1/mensagens_alteracao', {
      method: 'POST',
      _jwt: DB._jwt,
      body: JSON.stringify({ negocio_id: negocioId, remetente: 'sell', texto })
    });
  },

  // ════════════════════════════════════════════════════
  //  MESAS DE NEGOCIAÇÃO
  // ════════════════════════════════════════════════════
  async getMesaByUser() {
    return _sb(
      '/rest/v1/mesas_negociacao?or=(vendedor_id.eq.' + DB._uid + ',comprador_id.eq.' + DB._uid + ')' +
      '&order=created_at.desc&limit=5' +
      '&select=*,negocio:negocios(id,nome,tag)',
      { _jwt: DB._jwt }
    );
  },

  async getMsgsMesa(mesaId) {
    return _sb(
      '/rest/v1/mensagens_mesa?mesa_id=eq.' + mesaId + '&order=created_at.asc',
      { _jwt: DB._jwt }
    );
  },

  async enviarMsgMesa(mesaId, texto, role) {
    const nome = sessionStorage.getItem('1n_nome') || 'Usuário';
    return _sb('/rest/v1/mensagens_mesa', {
      method: 'POST',
      _jwt: DB._jwt,
      body: JSON.stringify({ mesa_id: mesaId, remetente: role, nome, texto })
    });
  },

  async aceitarTermoMesa(mesaId, role) {
    const field = role === 'sell' ? 'aceite_vendedor' : 'aceite_comprador';
    return _sb('/rest/v1/mesas_negociacao?id=eq.' + mesaId, {
      method: 'PATCH',
      _jwt: DB._jwt,
      body: JSON.stringify({ [field]: new Date().toISOString() })
    });
  },

  // ════════════════════════════════════════════════════
  //  CHAT DOSSIE
  // ════════════════════════════════════════════════════
  async getMsgsDossie(solicitacaoId) {
    return _sb(
      '/rest/v1/mensagens_dossie?solicitacao_id=eq.' + solicitacaoId + '&order=created_at.asc',
      { _jwt: DB._jwt }
    );
  },

  async enviarMsgDossie(solicitacaoId, texto) {
    const nome = sessionStorage.getItem('1n_nome') || 'Comprador';
    return _sb('/rest/v1/mensagens_dossie', {
      method: 'POST',
      _jwt: DB._jwt,
      body: JSON.stringify({ solicitacao_id: solicitacaoId, remetente: 'buy', nome, texto })
    });
  },

  // ════════════════════════════════════════════════════
  //  LEADS SITE (homepage — sem auth)
  // ════════════════════════════════════════════════════
  async criarLead({ nome, whatsapp, email, negocioId, corretor }) {
    return _sb('/rest/v1/leads_site', {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify({ nome, whatsapp, email, negocio_id: negocioId, corretor: !!corretor })
    });
  },

  // ════════════════════════════════════════════════════
  //  CHAT DRAFTS (vendedor via chat IA — sem auth)
  // ════════════════════════════════════════════════════
  async salvarChatDraft({ nome, whatsapp, progresso_pct, campos_json, transcricao }) {
    // usa upsert por whatsapp — evita duplicatas
    return _sb('/rest/v1/chat_drafts', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: JSON.stringify({ nome, whatsapp, progresso_pct, campos_json, transcricao })
    });
  },

  // ════════════════════════════════════════════════════
  //  ADMIN — funções que precisam service_role key
  //  Essas funções só rodam no admin.html após o usuário
  //  inserir a service_role key no painel de configuração
  // ════════════════════════════════════════════════════
  _srvKey: null,   // preenchido em admin.html

  _admin(path, opts = {}) {
    if (!DB._srvKey) throw new Error('Service role key não configurada');
    return _sb(path, opts, DB._srvKey);
  },

  // listar todos os negócios (qualquer status)
  async adminGetNegocios(filtros = '') {
    return DB._admin('/rest/v1/negocios?order=created_at.desc' + filtros +
      '&select=*,vendedor:usuarios(id,nome,email,whatsapp)');
  },

  // aprovar anúncio (publicar)
  async adminPublicarNegocio(negocioId) {
    return DB._admin('/rest/v1/negocios?id=eq.' + negocioId, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'publicado', publicado_em: new Date().toISOString() })
    });
  },

  // listar solicitações de info
  async adminGetSolicitacoes(status = '') {
    const q = status ? '&status=eq.' + status : '';
    return DB._admin(
      '/rest/v1/solicitacoes_info?order=created_at.desc' + q +
      '&select=*,comprador:usuarios(id,nome,email,whatsapp),negocio:negocios(id,nome,tag)'
    );
  },

  // liberar dossiê
  async adminLiberarDossie(solId) {
    return DB._admin('/rest/v1/solicitacoes_info?id=eq.' + solId, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'liberado', liberado_em: new Date().toISOString() })
    });
  },

  // recusar solicitação
  async adminRecusarSolicitacao(solId) {
    return DB._admin('/rest/v1/solicitacoes_info?id=eq.' + solId, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'recusado' })
    });
  },

  // listar mesas
  async adminGetMesas() {
    return DB._admin(
      '/rest/v1/mesas_negociacao?order=created_at.desc' +
      '&select=*,negocio:negocios(id,nome),vendedor:usuarios!mesas_negociacao_vendedor_id_fkey(nome,whatsapp),comprador:usuarios!mesas_negociacao_comprador_id_fkey(nome,whatsapp)'
    );
  },

  // abrir mesa
  async adminAbrirMesa({ negocioId, vendedorId, compradorId, pctComissao, notasAdmin }) {
    const exclusividade = new Date(Date.now() + 90*24*60*60*1000).toISOString().slice(0,10);
    const [mesa] = await DB._admin('/rest/v1/mesas_negociacao', {
      method: 'POST',
      body: JSON.stringify({
        negocio_id: negocioId,
        vendedor_id: vendedorId,
        comprador_id: compradorId,
        pct_comissao: pctComissao,
        status: 'aguardando_aceite',
        exclusividade_ate: exclusividade,
        notas_admin: notasAdmin
      })
    });
    // mensagem de sistema
    if (mesa?.id) {
      await DB._admin('/rest/v1/mensagens_mesa', {
        method: 'POST',
        body: JSON.stringify({
          mesa_id: mesa.id,
          remetente: 'system',
          nome: '1Negócio',
          texto: 'Mesa de Negociação aberta. Honorários: ' + pctComissao + '% sobre o valor negociado, cobrado de ambas as partes. Exclusividade de 90 dias. Aguardando aceite das partes.'
        })
      });
    }
    return mesa;
  },

  // encerrar mesa
  async adminEncerrarMesa(mesaId) {
    return DB._admin('/rest/v1/mesas_negociacao?id=eq.' + mesaId, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'encerrada', encerrada_em: new Date().toISOString() })
    });
  },

  // msgs mesa (admin vê tudo)
  async adminGetMsgsMesa(mesaId) {
    return DB._admin('/rest/v1/mensagens_mesa?mesa_id=eq.' + mesaId + '&order=created_at.asc');
  },

  // enviar msg como admin/mediador
  async adminEnviarMsgMesa(mesaId, texto) {
    return DB._admin('/rest/v1/mensagens_mesa', {
      method: 'POST',
      body: JSON.stringify({ mesa_id: mesaId, remetente: 'admin', nome: '1Negócio', texto })
    });
  },

  // leads
  async adminGetLeads() {
    return DB._admin('/rest/v1/leads_site?order=created_at.desc&select=*,negocio:negocios(nome,tag)');
  },

  // chat drafts
  async adminGetChatDrafts() {
    return DB._admin('/rest/v1/chat_drafts?order=created_at.desc');
  },

  // msgs alteração (admin responde)
  async adminGetMsgsAlteracao(negocioId) {
    return DB._admin('/rest/v1/mensagens_alteracao?negocio_id=eq.' + negocioId + '&order=created_at.asc');
  },

  async adminEnviarMsgAlteracao(negocioId, texto) {
    return DB._admin('/rest/v1/mensagens_alteracao', {
      method: 'POST',
      body: JSON.stringify({ negocio_id: negocioId, remetente: 'admin', texto })
    });
  },

  // buscar usuário por email (para abrir mesa)
  async adminGetUsuarioByEmail(email) {
    const rows = await DB._admin('/rest/v1/usuarios?email=eq.' + encodeURIComponent(email) + '&limit=1');
    return rows?.[0] || null;
  },

  // msgs dossie (admin responde)
  async adminGetMsgsDossie(solId) {
    return DB._admin('/rest/v1/mensagens_dossie?solicitacao_id=eq.' + solId + '&order=created_at.asc');
  },

  async adminEnviarMsgDossie(solId, texto) {
    return DB._admin('/rest/v1/mensagens_dossie', {
      method: 'POST',
      body: JSON.stringify({ solicitacao_id: solId, remetente: 'admin', nome: '1Negócio', texto })
    });
  },

  // ── upsert negócio completo (admin salva dossiê) ─────
  async adminSalvarNegocio(data) {
    const method = data.id ? 'PATCH' : 'POST';
    const path   = data.id
      ? '/rest/v1/negocios?id=eq.' + data.id
      : '/rest/v1/negocios';
    return DB._admin(path, { method, body: JSON.stringify(data) });
  },

  async adminSalvarDreLinhas(negocioId, linhas) {
    // delete existing then insert fresh
    await DB._admin('/rest/v1/dre_linhas?negocio_id=eq.' + negocioId, {
      method: 'DELETE', prefer: 'return=minimal'
    });
    if (!linhas?.length) return;
    const rows = linhas.map((l, i) => ({ ...l, negocio_id: negocioId, ordem: i }));
    return DB._admin('/rest/v1/dre_linhas', {
      method: 'POST',
      body: JSON.stringify(rows)
    });
  }
};

// ── Realtime helper ───────────────────────────────────────
// uso: DB.subscribe('mensagens_mesa', 'mesa_id=eq.UUID', callback)
DB.subscribe = function(table, filter, onData) {
  const ws = new WebSocket(
    'wss://dbijmgqlcrgjlcfrastg.supabase.co/realtime/v1/websocket?apikey=' + SB_ANON + '&vsn=1.0.0'
  );
  ws.onopen = () => {
    ws.send(JSON.stringify({ topic: 'realtime:public:' + table + ':' + filter, event: 'phx_join', payload: {}, ref: null }));
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'INSERT' || msg.event === 'UPDATE') onData(msg.payload?.record);
  };
  return ws; // caller can ws.close() to unsubscribe
};
