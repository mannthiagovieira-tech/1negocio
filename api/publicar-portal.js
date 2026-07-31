// /api/publicar-portal · Vercel Function · admin
// POST { projeto_id, action: 'publicar'|'despublicar' }
// Cria/vincula registro em `negocios` e marca va_projetos.negocio_publicado_id + publicado_em.
// Respeita nivel_sigilo · rigoroso não expõe cidade.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8'); return raw ? JSON.parse(raw) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL+'/rest/v1/rpc/va_is_admin', { method:'POST', headers:{apikey:SB_ANON,Authorization:'Bearer '+tok,'Content-Type':'application/json'}, body:'{}' });
  return r.ok && (await r.json())===true;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });
  const H = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { projeto_id, action } = body || {};
  if (!projeto_id || !['publicar','despublicar'].includes(action)) return json(res, 400, { ok:false, erro:'projeto_id + action obrigatórios' });

  const rP = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=id,negocio_titulo,cidade,uf,setor,nivel_sigilo,valor_venda,cliente_usuario_id,negocio_publicado_id,modalidade`, { headers: H });
  const [p] = await rP.json();
  if (!p) return json(res, 404, { ok:false, erro:'projeto não encontrado' });

  if (action === 'despublicar') {
    await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}`, {
      method:'PATCH', headers: H, body: JSON.stringify({ negocio_publicado_id: null, publicado_em: null }),
    });
    if (p.negocio_publicado_id) {
      await fetch(`${SB_URL}/rest/v1/negocios?id=eq.${p.negocio_publicado_id}`, {
        method:'PATCH', headers: H, body: JSON.stringify({ publicado: false }),
      });
    }
    return json(res, 200, { ok:true, action:'despublicado' });
  }

  // Publicar: cria registro em negocios ou reusa existente
  const cidadeVisivel = p.nivel_sigilo === 'rigoroso' ? null : p.cidade;
  const negocio_body = {
    vendedor_id: p.cliente_usuario_id,
    nome: p.negocio_titulo || (p.setor || 'Oportunidade'),
    categoria: p.setor,
    cidade: cidadeVisivel, estado: p.uf,
    publicado: true,
  };
  let negocio_id = p.negocio_publicado_id;
  if (negocio_id) {
    await fetch(`${SB_URL}/rest/v1/negocios?id=eq.${negocio_id}`, {
      method:'PATCH', headers: H, body: JSON.stringify(negocio_body),
    });
  } else {
    const r = await fetch(`${SB_URL}/rest/v1/negocios`, {
      method:'POST', headers: { ...H, Prefer:'return=representation' }, body: JSON.stringify(negocio_body),
    });
    if (!r.ok) return json(res, 500, { ok:false, erro:'insert_negocios_falhou', detalhe:(await r.text()).slice(0,300) });
    const [n] = await r.json(); negocio_id = n.id;
  }

  await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}`, {
    method:'PATCH', headers: H, body: JSON.stringify({ negocio_publicado_id: negocio_id, publicado_em: new Date().toISOString() }),
  });
  return json(res, 200, { ok:true, negocio_id, link: '/negocios/'+negocio_id });
};
