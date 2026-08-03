// /api/va-portao-leads · Vercel Function
// Aprova leads da antessala em massa · lança 1 linha por lead em va_projeto_razao
// com preço vigente do tipo 'lead_scrapper' (custo real Kipflow embutido).
// Bloqueados só passam com override_blacklist já setado no lead (fluxo separado).
// Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TIPO_PRECO = 'lead_scrapper';

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json');
  res.send(JSON.stringify(body));
}
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method:'POST',
    headers:{ apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' },
    body:'{}',
  });
  return r.ok && (await r.json()) === true;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return json(res, 405, { ok:false });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE)           return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
  const { projeto_id, lead_ids } = body || {};
  if (!projeto_id || !Array.isArray(lead_ids) || !lead_ids.length) {
    return json(res, 400, { ok:false, erro:'projeto_id + lead_ids[] obrigatórios' });
  }

  const H = { apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' };

  // 1 · busca preço vigente
  const pR = await fetch(`${SB_URL}/rest/v1/va_precos?tipo=eq.${TIPO_PRECO}&ativo=eq.true&select=tipo,rotulo,preco`, { headers: H });
  const precos = await pR.json();
  const prc = precos?.[0];
  if (!prc || !(prc.preco > 0)) return json(res, 503, { ok:false, erro:'preço vigente de lead_scrapper ausente/zero' });
  const precoUnit = Number(prc.preco);

  // 2 · busca leads · válidos = 'antessala' do projeto (bloqueados exigem override individual antes)
  const inList = encodeURIComponent(`(${lead_ids.join(',')})`);
  const lR = await fetch(`${SB_URL}/rest/v1/va_leads?id=in.${inList}&projeto_id=eq.${projeto_id}&select=id,status,razao_social,nome_fantasia,arquetipo_id,whatsapp,telefone`, { headers: H });
  const leads = await lR.json();
  if (!Array.isArray(leads) || leads.length === 0) return json(res, 404, { ok:false, erro:'nenhum lead encontrado no projeto' });

  const naoAntessala = leads.filter(l => l.status !== 'antessala');
  if (naoAntessala.length) {
    return json(res, 422, {
      ok:false, erro:'leads_nao_antessala',
      detalhe: `${naoAntessala.length} lead(s) fora de antessala · use override individual pra bloqueados`,
      exemplos: naoAntessala.slice(0,3).map(l => ({ id: l.id, status: l.status })),
    });
  }

  // 3 · nomes de arquétipos (pra referência amigável na razão)
  const arqIds = Array.from(new Set(leads.map(l => l.arquetipo_id).filter(Boolean)));
  const arqNomes = {};
  if (arqIds.length) {
    const aInList = encodeURIComponent(`(${arqIds.join(',')})`);
    const aR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?id=in.${aInList}&select=id,nome`, { headers: H });
    const arqs = await aR.json();
    for (const a of arqs) arqNomes[a.id] = a.nome;
  }

  // 4 · aprova + debita · 1 linha por lead. Sem transação SQL nativa (PostgREST),
  // erro parcial: reverte já feitos re-marcando antessala (best effort) e reporta.
  const aprovados = []; const razaoIds = []; const falhas = [];
  for (const lead of leads) {
    const refArq = (arqNomes[lead.arquetipo_id] || 'sem_arq').slice(0, 40);
    const shortId = String(lead.id).slice(0, 8);
    const ref = `lead:${shortId} · arq:${refArq}`;

    // 4a · UPDATE lead → aprovado com custo (trigger custo checa)
    // P4 · também seta funil_etapa: 'na_fila' se tem WhatsApp/telefone; 'sem_contato' senão
    const temFone = !!(lead.whatsapp || lead.telefone);
    const upd = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead.id}`, {
      method:'PATCH', headers: H,
      body: JSON.stringify({
        status:'aprovado', custo_creditos: precoUnit, aprovado_em: new Date().toISOString(),
        funil_etapa: temFone ? 'na_fila' : 'sem_contato',
      }),
    });
    if (!upd.ok) {
      const t = await upd.text();
      falhas.push({ lead_id: lead.id, etapa:'update_lead', detalhe: t.slice(0,200) });
      continue;
    }

    // 4b · debita na razão (va_debitar já congela preço/custo/fornecedor)
    const dR = await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
      method:'POST', headers: H,
      body: JSON.stringify({ p_projeto: projeto_id, p_tipo: TIPO_PRECO, p_qtd: 1, p_referencia: ref, p_ciclo: null }),
    });
    if (!dR.ok) {
      const t = await dR.text();
      // reverte o lead → antessala (best effort)
      await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead.id}`, {
        method:'PATCH', headers: H,
        body: JSON.stringify({ status:'antessala', custo_creditos: null, aprovado_em: null }),
      });
      falhas.push({ lead_id: lead.id, etapa:'debitar', detalhe: t.slice(0,200) });
      continue;
    }
    const razaoId = await dR.json(); // va_debitar retorna uuid
    razaoIds.push(String(razaoId));
    aprovados.push(lead.id);
  }

  const custoTotal = aprovados.length * precoUnit;

  // 5 · saldo pós (se view existir)
  let saldo = null;
  try {
    const sR = await fetch(`${SB_URL}/rest/v1/va_projeto_financeiro?projeto_id=eq.${projeto_id}&select=saldo,credito_liberado,consumido`, { headers: H });
    if (sR.ok) {
      const rows = await sR.json();
      if (rows?.[0]) saldo = rows[0];
    }
  } catch (_) {}

  return json(res, falhas.length ? 207 : 200, {
    ok: falhas.length === 0,
    aprovados: aprovados.length,
    aprovados_ids: aprovados,
    razao_ids: razaoIds,
    preco_unitario: precoUnit,
    custo_total: custoTotal,
    saldo,
    falhas: falhas.length ? falhas : undefined,
  });
};
