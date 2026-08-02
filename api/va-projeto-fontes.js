// /api/va-projeto-fontes · MANDATO · Zona ATIVO
// POST   { projeto_id, tipo, titulo?, conteudo } → limpa Gemini se reunião, insere.
// DELETE { id }                                  → apaga.
// (LIST fica direto no client via sb.from · não precisa endpoint só pra isso.)

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { sanitizarConteudoParaSalvar } = require('./_va_fontes.js');

function json(res, code, body) { res.status(code).setHeader('Content-Type', 'application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const c = []; for await (const x of req) c.push(x);
  const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method: 'POST', headers: { apikey: SB_ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}',
  });
  return r.ok && (await r.json()) === true;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok: false, erro: 'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY ausente' });
  const H = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };

  if (req.method === 'DELETE') {
    let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
    const { id } = body || {};
    if (!id) return json(res, 400, { ok: false, erro: 'id obrigatório' });
    const r = await fetch(`${SB_URL}/rest/v1/va_projeto_fontes?id=eq.${id}`, { method: 'DELETE', headers: H });
    if (!r.ok) return json(res, 500, { ok: false, erro: 'delete: ' + r.status });
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'POST') return json(res, 405, { ok: false });
  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
  const { projeto_id, tipo, titulo, conteudo } = body || {};
  if (!projeto_id) return json(res, 400, { ok: false, erro: 'projeto_id obrigatório' });
  if (!['reuniao', 'anotacao', 'documento'].includes(tipo)) return json(res, 400, { ok: false, erro: 'tipo inválido' });
  if (!conteudo || String(conteudo).trim().length < 10) return json(res, 400, { ok: false, erro: 'conteudo curto demais' });

  const clean = sanitizarConteudoParaSalvar(tipo, conteudo);
  if (!clean.limpo || clean.limpo.length < 10) {
    return json(res, 400, { ok: false, erro: 'depois da limpeza sobrou muito pouco · confira o texto colado' });
  }
  const insR = await fetch(`${SB_URL}/rest/v1/va_projeto_fontes`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({
      projeto_id, tipo, titulo: titulo || null,
      conteudo: clean.limpo,
      formato_detectado: clean.formato || null,
    }),
  });
  const inseridos = await insR.json();
  if (!insR.ok) return json(res, 500, { ok: false, erro: 'insert: ' + JSON.stringify(inseridos).slice(0, 300) });
  const fonte = Array.isArray(inseridos) ? inseridos[0] : inseridos;
  return json(res, 200, {
    ok: true,
    fonte,
    aproveitados: clean.aproveitados,
    original: clean.originalLen,
    formato: clean.formato,
    precisa_destilacao: clean.precisaDestilacao,
  });
};
