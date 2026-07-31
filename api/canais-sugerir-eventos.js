// /api/canais-sugerir-eventos · admin
// Wrapper que monta contexto equivalente ao 'sugerir-eventos-gtm' (edge do painel-v3)
// e insere resultados em va_projeto_canais_manuais tipo='evento'.
// Reaproveita o prompt/IA que já roda em produção (edge sugerir-eventos-gtm).
//
// Body: { projeto_id }

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
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const H = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { projeto_id } = body || {};
  if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });

  // Contexto do projeto
  const rP = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=setor,cidade,uf,negocio_titulo`, { headers: H });
  const [p] = await rP.json();
  if (!p) return json(res, 404, { ok:false, erro:'projeto não encontrado' });
  const setor = p.setor || p.negocio_titulo || '';
  const cidade = p.cidade || '';
  if (!setor || !cidade) return json(res, 400, { ok:false, erro:'projeto sem setor ou cidade' });

  // Chama a edge sugerir-eventos-gtm com contexto ad hoc (originacao_id null · setor+cidade explícitos)
  // Se edge exige originacao_id estrito, esse call pode falhar; nesse caso o operador tem input manual no card.
  let eventos = [];
  try {
    const r = await fetch(`${SB_URL}/functions/v1/sugerir-eventos-gtm`, {
      method:'POST',
      headers:{ Authorization:'Bearer '+tok, 'Content-Type':'application/json' },
      body: JSON.stringify({ contexto_ad_hoc: true, setor, cidade, uf: p.uf || null }),
    });
    const d = await r.json();
    if (r.ok && d.ok && Array.isArray(d.eventos)) eventos = d.eventos;
    else if (r.ok && Array.isArray(d.eventos)) eventos = d.eventos;
  } catch (e) {
    return json(res, 502, { ok:false, erro:'edge_indisponivel', detalhe:String(e.message||e).slice(0,200) });
  }

  if (!eventos.length) return json(res, 200, { ok:true, sugeridos: 0, aviso:'edge devolveu vazio · adicione manualmente' });

  // Insere cada evento sugerido em va_projeto_canais_manuais como tipo='evento'
  const inseridos = [];
  for (const e of eventos) {
    const insBody = {
      projeto_id, tipo: 'evento',
      nome: e.nome, url: e.url || null,
      descricao: e.relevancia || (e.tipo === 'nacional' ? 'Evento nacional' : null),
      proxima_ocorrencia: e.data && /^\d{4}-\d{2}-\d{2}$/.test(e.data) ? e.data : null,
      origem: 'ia',
      status: 'sugerido',
    };
    const r = await fetch(`${SB_URL}/rest/v1/va_projeto_canais_manuais`, {
      method:'POST', headers:{ ...H, Prefer:'return=representation' }, body: JSON.stringify(insBody),
    });
    if (r.ok) { const [row] = await r.json(); inseridos.push(row.id); }
  }
  return json(res, 200, { ok:true, sugeridos: eventos.length, inseridos: inseridos.length, ids: inseridos });
};
