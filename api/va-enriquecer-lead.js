// /api/va-enriquecer-lead · Vercel Function
// Slice 3.1 · enriquecimento SOB DEMANDA de leads em antessala.
// Busca datasets partners+debts pra 1 CNPJ e preenche sócios/idade/dívida
// no va_leads (custo Kipflow armazenado em custo_enriquecimento_kipflow).
// Aceita { projeto_id, lead_ids: [...] } · processa cada CNPJ e agrega custo.
// Sem débito ao cliente por ora (pricing PDCA).
// Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KIP_KEY = process.env.KIPFLOW_API_KEY;

const DATASETS = 'partners,debts'; // apenas o que a extração magra não trouxe

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

function idadeAnos(dnasc) {
  if (!dnasc) return null;
  const d = new Date(dnasc); if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// Consulta 1 CNPJ no Kipflow com datasets partners+debts. Retorna { ok, cost, campos, erro }.
async function enriquecer(cnpj) {
  try {
    const r = await fetch(`https://api.kipflow.io/companies/v1/search?cnpj=${encodeURIComponent(cnpj)}&datasets=${DATASETS}`, {
      headers: { 'X-API-Key': KIP_KEY, Accept: 'application/json' },
    });
    const raw = await r.text();
    let parsed = null; try { parsed = JSON.parse(raw); } catch {}
    if (!r.ok) return { ok:false, erro: `kipflow_http_${r.status}: ${raw.slice(0,200)}` };
    const data = (parsed?.data && (Array.isArray(parsed.data) ? parsed.data[0] : parsed.data)) || parsed || {};
    const socios = Array.isArray(data.partners) ? data.partners
                 : Array.isArray(data.socios) ? data.socios : [];
    const idades = socios.map(s => idadeAnos(s.data_nascimento || s.nascimento)).filter(x => x != null);
    const divida = data.divida || data.debts || data.divida_ativa || null;
    let temDivida = null;
    if (divida && typeof divida === 'object') {
      const vals = [divida.total, divida.divida_ativa, divida.protestos, divida.tributaria].filter(x => typeof x === 'number');
      if (vals.length) temDivida = vals.some(v => v > 0);
    }
    return {
      ok: true,
      cost: parsed?.cost != null ? Number(parsed.cost) : 0,
      costFormatted: parsed?.costFormatted || null,
      campos: {
        socios: socios.length ? socios : null,
        idade_min_socios: idades.length ? Math.min(...idades) : null,
        idade_max_socios: idades.length ? Math.max(...idades) : null,
        com_divida: temDivida,
        divida_bruto: divida || null,
      },
    };
  } catch (e) {
    return { ok:false, erro: 'rede: ' + String(e.message||e).slice(0,200) };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return json(res, 405, { ok:false });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!KIP_KEY)   return json(res, 503, { ok:false, erro:'KIPFLOW_API_KEY ausente' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
  const { projeto_id, lead_ids } = body || {};
  if (!projeto_id || !Array.isArray(lead_ids) || !lead_ids.length) {
    return json(res, 400, { ok:false, erro:'projeto_id + lead_ids[] obrigatórios' });
  }

  const H = { apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' };

  const inList = encodeURIComponent(`(${lead_ids.join(',')})`);
  const lR = await fetch(`${SB_URL}/rest/v1/va_leads?id=in.${inList}&projeto_id=eq.${projeto_id}&select=id,cnpj,razao_social,dados_brutos`, { headers: H });
  const leads = await lR.json();
  if (!Array.isArray(leads) || !leads.length) return json(res, 404, { ok:false, erro:'nenhum lead encontrado no projeto' });

  let custoTotal = 0;
  const ok = []; const falhas = [];
  for (const l of leads) {
    const cnpjLimpo = String(l.cnpj || '').replace(/\D/g,'');
    if (!cnpjLimpo) { falhas.push({ id: l.id, motivo:'sem_cnpj' }); continue; }
    const r = await enriquecer(cnpjLimpo);
    if (!r.ok) { falhas.push({ id: l.id, motivo: r.erro }); continue; }
    custoTotal += r.cost || 0;
    // funde dados_brutos existente com o enriquecimento
    const brutoOut = Object.assign({}, l.dados_brutos || {}, {
      partners: r.campos.socios,
      divida: r.campos.divida_bruto,
    });
    const upd = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${l.id}`, {
      method:'PATCH', headers: H,
      body: JSON.stringify({
        enriquecido_em: new Date().toISOString(),
        custo_enriquecimento_kipflow: r.cost || 0,
        socios: r.campos.socios,
        dados_brutos: brutoOut,
        dados_enriquecimento: r.campos,
      }),
    });
    if (!upd.ok) { falhas.push({ id: l.id, motivo: `update: ${(await upd.text()).slice(0,200)}` }); continue; }
    // Débito · 1 unidade de 'lead_enriquecimento' por lead com sucesso
    // Falha do débito NÃO reverte o enriquecimento (dado já veio) · loga em falhas.detalhe.
    try {
      const shortL = String(l.id).slice(0,8);
      const dR = await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
        method:'POST', headers: H,
        body: JSON.stringify({
          p_projeto: projeto_id, p_tipo: 'lead_enriquecimento', p_qtd: 1,
          p_referencia: `enriq:${shortL} · partners+debts`, p_ciclo: null,
        }),
      });
      if (!dR.ok) console.error('va_debitar enriquecimento falhou:', await dR.text());
    } catch (e) { console.error('va_debitar erro:', e); }
    ok.push({ id: l.id, idade_min: r.campos.idade_min_socios, idade_max: r.campos.idade_max_socios, com_divida: r.campos.com_divida, cost: r.cost });
  }

  return json(res, 200, {
    ok: true,
    enriquecidos: ok.length,
    falhas: falhas.length ? falhas : undefined,
    custo_kipflow_total: custoTotal,
    custo_kipflow_por_lead: ok.length ? (custoTotal / ok.length) : null,
    resultados: ok,
  });
};
