// MANDATO · core · Supabase singleton, auth guard admin (allowlist va_is_admin),
// contexto do mandato via ?mandato=uuid na URL. Zero estado global de app.
// Import via ESM: `import { sb, requireAdmin, getMandatoAtivo } from './core/core.js'`.

// supabase-js UMD (mesma versão do resto do site) — importado como script global
// pelas páginas antes deste módulo, disponível em window.supabase.
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

if (!window.supabase?.createClient) {
  throw new Error('MANDATO/core: supabase-js UMD ausente. Inclua o <script> antes do módulo.');
}
export const sb = window.supabase.createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// ─── Auth guard ─────────────────────────────────────────────────────
// Reusa a mesma allowlist do painel legado (projetos.html): tabela va_admins
// consultada via RPC va_is_admin() (SECURITY DEFINER, retorna boolean).
// - Sem sessão → showInlineLogin() (form email/senha inline, mesmo endpoint
//   supabase.auth.signInWithPassword usado no monolito).
// - Sessão sem admin → showAccessDenied().
export async function requireAdmin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showInlineLogin();
  const { data: isAdmin, error } = await sb.rpc('va_is_admin');
  if (error) {
    document.body.innerHTML = '';
    const app = document.createElement('div');
    app.className = 'auth';
    app.innerHTML = `<div class="auth__card">
      <div class="lbl">erro</div>
      <h1>Não foi possível validar sua conta</h1>
      <p class="muted">${escapeHtml(error.message || '')}</p>
      <button class="btn btn--ghost" id="lgt" style="margin-top:12px">Sair</button>
    </div>`;
    document.body.appendChild(app);
    document.getElementById('lgt').onclick = () => sb.auth.signOut().then(() => location.reload());
    return new Promise(() => {});
  }
  if (isAdmin !== true) return showAccessDenied(session);
  return session;
}

// Reage APENAS a mudanças reais de autenticação. Bugs evitados:
//
//   1) Race INITIAL_SESSION vs getSession(): o SDK dispara INITIAL_SESSION
//      sincronamente ao subscrever, ANTES de qualquer getSession().then()
//      resolver. Se _lastUserId ainda for null nesse instante e o usuário
//      já estiver logado, `id !== null` → reload → mesma corrida → loop.
//      Fix: aguardar getSession() ANTES de subscrever.
//
//   2) Eventos que não são "mudança de auth" pro nosso propósito
//      (TOKEN_REFRESHED, USER_UPDATED com mesmo uid, INITIAL_SESSION,
//      PASSWORD_RECOVERY). Fix: whitelist explícita de eventos e comparação
//      de user.id.
let _lastUserId = null;
export async function watchAuth(onChange) {
  const { data } = await sb.auth.getSession();
  _lastUserId = data.session?.user?.id || null;
  sb.auth.onAuthStateChange((evt, s) => {
    if (evt !== 'SIGNED_IN' && evt !== 'SIGNED_OUT') return;
    const id = s?.user?.id || null;
    if (id === _lastUserId) return;
    _lastUserId = id;
    onChange?.(s);
  });
}

function showInlineLogin(msg) {
  document.body.innerHTML = '';
  const app = document.createElement('div');
  app.className = 'auth';
  app.innerHTML = `<div class="auth__card">
    <div class="lbl">acesso</div>
    <h1>Entrar no MANDATO</h1>
    <p class="muted" style="margin:8px 0 20px">Use suas credenciais admin do 1Negócio.</p>
    ${msg ? `<div class="auth__err">${escapeHtml(msg)}</div>` : ''}
    <form id="lgf" style="display:flex;flex-direction:column;gap:14px;margin-top:14px">
      <div class="field"><span class="lbl">e-mail</span><input id="lg-em" type="email" required autocomplete="email" placeholder="voce@1negocio.com.br"></div>
      <div class="field"><span class="lbl">senha</span><input id="lg-pw" type="password" required autocomplete="current-password" placeholder="••••••••"></div>
      <button class="btn btn--primary" type="submit" style="margin-top:6px">Entrar</button>
    </form>
  </div>`;
  document.body.appendChild(app);
  document.getElementById('lgf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Entrando…';
    const email = document.getElementById('lg-em').value.trim();
    const pw = document.getElementById('lg-pw').value;
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) { showInlineLogin(error.message || 'Falha no login'); return; }
    location.reload();
  });
  return new Promise(() => {});
}

function showAccessDenied(session) {
  document.body.innerHTML = '';
  const app = document.createElement('div');
  app.className = 'auth';
  app.innerHTML = `<div class="auth__card">
    <div class="lbl">acesso negado</div>
    <h1>Você entrou, mas não está na allowlist</h1>
    <p class="muted" style="margin-top:8px">Conta <b>${escapeHtml(session.user.email || '')}</b> não é admin do MANDATO. Fale com quem gerencia a plataforma.</p>
    <button class="btn btn--ghost" id="lgt" style="margin-top:14px">Sair</button>
  </div>`;
  document.body.appendChild(app);
  document.getElementById('lgt').onclick = () => sb.auth.signOut().then(() => location.reload());
  return new Promise(() => {});
}

// ─── Contexto do mandato ────────────────────────────────────────────
// Fonte-verdade: query param ?mandato=uuid. Nenhum cache em memória
// entre navegações — cada página lê da URL e busca no banco.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mandatoIdFromURL() {
  const id = new URLSearchParams(location.search).get('mandato');
  return (id && UUID_RE.test(id)) ? id : null;
}

/** Preserva ?mandato=uuid em qualquer href relativo. */
export function withMandato(href, mandatoId = mandatoIdFromURL()) {
  if (!mandatoId) return href;
  const [path, q = ''] = href.split('?');
  const params = new URLSearchParams(q);
  params.set('mandato', mandatoId);
  return `${path}?${params.toString()}`;
}

/**
 * Carrega o mandato ativo. Se ausente na URL, retorna null — a página deve
 * chamar renderSelector(). Se presente, busca em va_projetos_resumo.
 */
// SELECT amplo: cada zona consome campos diferentes de va_projetos_resumo.
// Se ficar caro no futuro, particionar por zona (getMandatoAtivo/getMandatoAtivo({ campos }))
// mas por ora manter simples e completo evita bugs de campo ausente pós-reload.
const MANDATO_CAMPOS = [
  'id', 'codigo', 'cliente_nome', 'cliente_whatsapp', 'negocio_titulo',
  'setor', 'avaliacao_setor', 'cidade', 'uf', 'cnpj',
  'status', 'data_inicio', 'dia_atual', 'etapas_ok', 'etapas_total',
  'arquivado_em', 'arquivado_por', 'arquivado_motivo',
  'valor_venda', 'valor_venda_justificativa', 'valor_venda_decidido_por', 'valor_venda_definido_em',
  'valor_avaliacao', 'valor_avaliacao_min', 'valor_avaliacao_max',
  'laudo_v2_id', 'avaliacao_origem_id',
  'descricao_negocio', 'descricao_negocio_versao', 'descricao_negocio_gerado_em',
  'modalidade', 'nivel_sigilo', 'fidelidade_meses', 'comissao_percent',
  'expectativa_valor',
].join(', ');

export async function getMandatoAtivo() {
  const id = mandatoIdFromURL();
  if (!id) return null;
  const { data, error } = await sb
    .from('va_projetos_resumo')
    .select(MANDATO_CAMPOS)
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Lista de mandatos disponíveis pra montar o seletor. Exclui arquivados. */
export async function listarMandatos() {
  const { data, error } = await sb
    .from('va_projetos_resumo')
    .select('id, codigo, cliente_nome, negocio_titulo, cidade, status, data_inicio, dia_atual, etapas_ok, etapas_total, arquivado_em')
    .is('arquivado_em', null)
    .order('data_inicio', { ascending: false });
  if (error) throw error;
  return data || [];
}

// escape puro pra uso em templates dentro do próprio core
function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
