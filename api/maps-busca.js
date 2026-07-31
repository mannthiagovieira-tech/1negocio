// /api/maps-busca · Vercel Function · scrape Google Maps via Apify
// Insere em va_prospeccao_bruta (NÃO em va_contatos, NÃO debita ainda).
// Só debita lead_maps por resultado retornado (custo Apify × 2).
//
// Body: { projeto_id, arquetipo_codigo?, termo, regiao?, limite? }
// Auth: JWT admin. APIFY_TOKEN em env.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL+'/rest/v1/rpc/va_is_admin', {
    method:'POST', headers:{apikey:SB_ANON,Authorization:'Bearer '+tok,'Content-Type':'application/json'}, body:'{}'
  });
  return r.ok && (await r.json())===true;
}
async function safeCall(url, opts) { try { return await fetch(url, opts); } catch { return null; } }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false, erro:'POST only' });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!tok) return json(res, 401, { ok:false });
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false });

  const APIFY = process.env.APIFY_TOKEN;
  if (!APIFY) return json(res, 503, { ok:false, erro:'APIFY_TOKEN não configurada' });
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });
  const sbHeaders = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
  const { projeto_id, arquetipo_codigo, termo, regiao, limite } = body || {};
  if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });
  if (!termo || !termo.trim()) return json(res, 400, { ok:false, erro:'termo obrigatório' });

  // GATE ONDA
  const rGate = await fetch(SB_URL+'/rest/v1/rpc/va_onda_operacional', {
    method:'POST', headers: sbHeaders, body: JSON.stringify({ p_projeto_id: projeto_id }),
  });
  const gate = await rGate.json();
  if (!gate?.operacional) return json(res, 402, { ok:false, erro:'onda_nao_operacional', detalhe: gate?.mensagem });
  // GATE MODALIDADE
  const rMod = await fetch(SB_URL+'/rest/v1/rpc/va_etapa_ativa', {
    method:'POST', headers: sbHeaders, body: JSON.stringify({ p_projeto_id: projeto_id, p_etapa_chave: 'arquetipos' }),
  });
  if (!(await rMod.json())) return json(res, 403, { ok:false, erro:'modalidade_nao_libera', detalhe:'Busca Maps está disponível na Venda Assessorada.' });

  const size = Math.min(50, Math.max(1, Number(limite) || 10));
  const searchStr = regiao ? `${termo.trim()} em ${regiao.trim()}` : termo.trim();

  // Actor Apify: compass/crawler-google-places (sync com limite pequeno)
  const runUrl = `https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?token=${APIFY}`;
  let items = [];
  try {
    const r = await fetch(runUrl, {
      method:'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        searchStringsArray: [searchStr],
        maxCrawledPlacesPerSearch: size,
        language: 'pt-BR',
        countryCode: 'br',
        skipClosedPlaces: true,
        scrapeContacts: true,
      }),
    });
    if (!r.ok) return json(res, 502, { ok:false, erro:`apify_http_${r.status}`, detalhe:(await r.text()).slice(0,300) });
    items = await r.json();
    if (!Array.isArray(items)) items = [];
  } catch (e) {
    return json(res, 502, { ok:false, erro:'apify_erro_rede', detalhe: String(e.message||e).slice(0,200) });
  }

  // Insere cada resultado em va_prospeccao_bruta
  const inseridos = [];
  for (const it of items.slice(0, size)) {
    const telRaw = it.phone || it.phoneUnformatted || (Array.isArray(it.additionalInfo?.phone) ? it.additionalInfo.phone[0] : null) || null;
    const telNorm = telRaw ? String(telRaw).replace(/\D/g,'') : null;
    const cidadeExtr = it.city || it.address?.city || null;
    const ufExtr = it.state || it.address?.state || null;
    const enderecoExtr = it.address || (typeof it.location === 'object' ? null : it.location) || null;

    const insBody = {
      projeto_id, arquetipo_codigo: arquetipo_codigo || null,
      fonte: 'maps', fonte_detalhe: searchStr,
      razao_social: it.title || it.name || null,
      nome: null, // Maps não separa decisor
      cnpj: null, // Maps não tem CNPJ
      telefone: telRaw, telefone_normalizado: telNorm,
      site: it.website || null,
      cidade: cidadeExtr, estado: ufExtr,
      endereco: typeof enderecoExtr === 'string' ? enderecoExtr : (enderecoExtr ? JSON.stringify(enderecoExtr) : null),
      payload_bruto: {
        avaliacao: it.totalScore, avaliacoes: it.reviewsCount,
        categorias: it.categoryName, place_id: it.placeId,
        url: it.url, whatsapp: false, // Maps não sinaliza WhatsApp
      },
    };
    const r = await safeCall(`${SB_URL}/rest/v1/va_prospeccao_bruta`, {
      method:'POST', headers: { ...sbHeaders, Prefer:'return=representation' }, body: JSON.stringify(insBody),
    });
    if (r && r.ok) {
      const [row] = await r.json();
      inseridos.push(row);
      // Qualifica imediatamente
      await fetch(`${SB_URL}/rest/v1/rpc/va_qualificar_prospeccao`, {
        method:'POST', headers: sbHeaders, body: JSON.stringify({ p_id: row.id }),
      });
    }
  }

  // Debita lead_maps por resultado retornado (Apify cobrou pela raspagem)
  if (inseridos.length > 0) {
    try {
      await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
        method:'POST', headers: sbHeaders,
        body: JSON.stringify({
          p_projeto: projeto_id, p_tipo: 'lead_maps', p_qtd: inseridos.length,
          p_referencia: `maps · "${searchStr.slice(0,60)}"`, p_ciclo: null,
        }),
      });
    } catch (_) {}
  }

  // Contagem por status após qualificação
  const rC = await safeCall(`${SB_URL}/rest/v1/va_prospeccao_bruta?projeto_id=eq.${projeto_id}&fonte=eq.maps&fonte_detalhe=eq.${encodeURIComponent(searchStr)}&select=status`, { headers: sbHeaders });
  const arr = rC ? (await rC.json()) : [];
  const contagem = {};
  for (const x of arr) contagem[x.status] = (contagem[x.status]||0)+1;

  return json(res, 200, {
    ok: true,
    termo_pesquisado: searchStr,
    raspados: items.length,
    inseridos: inseridos.length,
    contagem_por_status: contagem,
    debitado_lead_maps: inseridos.length,
  });
};
