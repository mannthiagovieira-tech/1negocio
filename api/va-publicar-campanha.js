// /api/va-publicar-campanha · Slice P5 · B · Vercel Node runtime
// Publica va_campanhas no Meta Ads · SEMPRE PAUSED (operador ativa no Ads Manager).
// Preferencial: CTWA (OUTCOME_ENGAGEMENT + destination WHATSAPP + phone_number_id).
// Fallback: Lead Gen (OUTCOME_LEADS · edge criar-campanha-meta legada — sem WABA).
// Se WABA não configurada e operador não escolheu leadgen, retorna 422 com SPEC.
// Injeta {campanha_id, criativo_id, arquetipo_id} no ctwaPayload pra desemboque no Slice C.
// Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_983335024007752';
const META_PAGE_ID = process.env.META_PAGE_ID || '612525678608107';
const META_WHATSAPP_PHONE_ID = process.env.META_WHATSAPP_PHONE_ID || '';
const META_PRIVACY_URL = process.env.META_PRIVACY_URL || 'https://1negocio.com.br/termo-sigilo.html';
const GRAPH = 'https://graph.facebook.com/v23.0';

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const c = []; for await (const x of req) c.push(x);
  const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method:'POST', headers:{ apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' }, body:'{}',
  });
  return r.ok && (await r.json()) === true;
}
const H_SVC = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' });

async function metaPOST(path, body) {
  const fd = new URLSearchParams();
  for (const [k, v] of Object.entries(body || {})) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  fd.append('access_token', META_TOKEN);
  const r = await fetch(GRAPH + path, { method:'POST', body: fd });
  const txt = await r.text();
  let d = null; try { d = JSON.parse(txt); } catch {}
  if (!r.ok) throw new Error(`meta_${path} ${r.status}: ${txt.slice(0,300)}`);
  return d;
}

// ─── SPEC de publicação manual (fallback quando token indisponível) ─────
function specPublicacao(cmp, cri, arq) {
  const linhas = [];
  linhas.push('SPEC · PUBLICAÇÃO MANUAL META ADS');
  linhas.push('==================================');
  linhas.push(`Objetivo: ${cmp.objetivo_meta || 'CTWA (Click-to-WhatsApp)'}`);
  linhas.push(`Nome: ${cmp.nome}`);
  linhas.push(`Orçamento diário: R$ ${Number(cmp.orcamento_diario || 0).toFixed(2)}`);
  linhas.push(`Orçamento total: R$ ${Number(cmp.orcamento_total || 0).toFixed(2)}`);
  linhas.push(`Início: ${cmp.data_inicio || '(hoje)'}    Fim: ${cmp.data_fim || '(sem fim)'}`);
  linhas.push('');
  linhas.push('CRIATIVO APROVADO:');
  linhas.push(`  Headline: ${cri?.headline || ''}`);
  linhas.push(`  Texto:    ${cri?.texto || ''}`);
  linhas.push(`  CTA:      ${cri?.cta || ''}`);
  linhas.push(`  PNG:      ${cri?.png_path ? SB_URL + '/storage/v1/object/public/criativos-png/' + cri.png_path : '(sem render)'}`);
  linhas.push('');
  linhas.push('PÚBLICO:');
  const p = cmp.publico || {};
  linhas.push(`  Regiões: ${JSON.stringify(p.regioes || [])}`);
  linhas.push(`  Idade: ${p.idade_min || 25}-${p.idade_max || 65}`);
  linhas.push(`  Interesses: ${(p.interesses || []).join(', ') || '(nenhum)'}`);
  linhas.push('');
  linhas.push('CTWA payload custom (COPIE em "Ad → Contents → CTA WhatsApp → Custom payload"):');
  linhas.push(`  ${JSON.stringify({ campanha_id: cmp.id, criativo_id: cri?.id, arquetipo_id: arq?.id })}`);
  linhas.push('');
  linhas.push('LINK CTWA (Ads Manager):');
  linhas.push(`  https://wa.me/${cmp.instancia_whatsapp || '(instância)'}?text=Vim%20do%20anúncio`);
  return linhas.join('\n');
}

async function debitarMidia(projetoId, campanhaId, gasto) {
  if (!gasto || gasto <= 0) return null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
      method:'POST', headers: H_SVC(),
      body: JSON.stringify({
        p_projeto: projetoId, p_tipo: 'midia_meta', p_qtd: Number(gasto),
        p_referencia: `midia:${campanhaId.slice(0,8)}`, p_ciclo: null,
      }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { campanha_id, dry_run } = body || {};
  if (!campanha_id) return json(res, 400, { ok:false, erro:'campanha_id obrigatório' });

  // Carrega campanha + criativo + arquétipo
  const cR = await fetch(`${SB_URL}/rest/v1/va_campanhas?id=eq.${campanha_id}&select=*`, { headers: H_SVC() });
  const [cmp] = await cR.json();
  if (!cmp) return json(res, 404, { ok:false, erro:'campanha não encontrada' });
  if (cmp.status !== 'aprovada') return json(res, 400, { ok:false, erro:'campanha precisa estar aprovada · atual=' + cmp.status });

  let cri = null, arq = null;
  if (cmp.criativo_id) {
    const r = await fetch(`${SB_URL}/rest/v1/va_criativos?id=eq.${cmp.criativo_id}&select=*`, { headers: H_SVC() });
    [cri] = await r.json();
  }
  if (!cri || cri.status !== 'aprovado') return json(res, 400, { ok:false, erro:'criativo aprovado obrigatório · atual=' + (cri?.status || 'null') });
  if (!cri.png_path) return json(res, 400, { ok:false, erro:'criativo sem PNG renderizado' });
  if (cmp.arquetipo_id) {
    const r = await fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${cmp.arquetipo_id}&select=id,nome,abordagem`, { headers: H_SVC() });
    [arq] = await r.json();
  }

  const objetivo = cmp.objetivo_meta || 'ctwa';
  const ctwaPayload = { campanha_id: cmp.id, criativo_id: cri.id, arquetipo_id: arq?.id || null };

  // dry_run: só devolve a SPEC + payload, não bate na API Meta
  if (dry_run) {
    return json(res, 200, {
      ok:true, mode:'dry_run', objetivo,
      ctwa_payload: ctwaPayload,
      ctwa_payload_base64: Buffer.from(JSON.stringify(ctwaPayload)).toString('base64'),
      spec: specPublicacao(cmp, cri, arq),
    });
  }

  // Se não tem token Meta ou WABA (pra CTWA), devolve SPEC + salva ids null
  const podeCtwa = objetivo === 'ctwa' && META_WHATSAPP_PHONE_ID;
  const podeLeadgen = objetivo === 'leadgen' && META_TOKEN;
  if (!META_TOKEN || (objetivo === 'ctwa' && !META_WHATSAPP_PHONE_ID)) {
    return json(res, 200, {
      ok:true, mode:'spec_only', objetivo,
      motivo: !META_TOKEN ? 'META_ACCESS_TOKEN ausente' : 'META_WHATSAPP_PHONE_ID ausente (WABA)',
      ctwa_payload: ctwaPayload,
      ctwa_payload_base64: Buffer.from(JSON.stringify(ctwaPayload)).toString('base64'),
      spec: specPublicacao(cmp, cri, arq),
    });
  }

  try {
    // 1 · Upload da imagem do criativo → adimages
    const pngUrl = `${SB_URL}/storage/v1/object/public/criativos-png/${cri.png_path}`;
    const imgResp = await fetch(pngUrl);
    if (!imgResp.ok) throw new Error(`fetch png ${imgResp.status}`);
    const imgBlob = await imgResp.blob();
    const fd = new FormData();
    fd.append('source', imgBlob, 'creative.png');
    fd.append('access_token', META_TOKEN);
    const upImg = await fetch(`${GRAPH}/${META_AD_ACCOUNT_ID}/adimages`, { method:'POST', body: fd });
    const upTxt = await upImg.text();
    if (!upImg.ok) throw new Error(`adimages ${upImg.status}: ${upTxt.slice(0,200)}`);
    const upData = JSON.parse(upTxt);
    const image_hash = upData.images?.[Object.keys(upData.images || {})[0]]?.hash;
    if (!image_hash) throw new Error('adimages sem hash');

    // 2 · Campanha PAUSED
    const OBJ_MAP = {
      ctwa:    { objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP', cta: 'WHATSAPP_MESSAGE' },
      leadgen: { objective: 'OUTCOME_LEADS',      optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD',   cta: 'SIGN_UP' },
      trafego: { objective: 'OUTCOME_TRAFFIC',    optimization_goal: 'LINK_CLICKS',     destination_type: 'WEBSITE', cta: 'LEARN_MORE' },
    };
    const cfg = OBJ_MAP[objetivo] || OBJ_MAP.ctwa;
    const camp = await metaPOST(`/${META_AD_ACCOUNT_ID}/campaigns`, {
      name: cmp.nome, objective: cfg.objective, status: 'PAUSED',
      special_ad_categories: [],
    });

    // 3 · Adset PAUSED
    const startTime = new Date(cmp.data_inicio || new Date()).toISOString();
    const endTime = cmp.data_fim ? new Date(cmp.data_fim).toISOString() : new Date(Date.now() + 30 * 86400_000).toISOString();
    const p = cmp.publico || {};
    const targeting = {
      geo_locations: { countries: ['BR'] },
      age_min: p.idade_min || 30,
      age_max: p.idade_max || 65,
    };
    const adsetPayload = {
      name: `Adset · ${cmp.nome}`,
      campaign_id: camp.id,
      daily_budget: Math.round(Number(cmp.orcamento_diario || 30) * 100),
      billing_event: 'IMPRESSIONS',
      optimization_goal: cfg.optimization_goal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      start_time: startTime,
      end_time: endTime,
      status: 'PAUSED',
      destination_type: cfg.destination_type,
    };
    if (objetivo === 'ctwa') {
      adsetPayload.promoted_object = { page_id: META_PAGE_ID, whatsapp_phone_number: META_WHATSAPP_PHONE_ID };
    } else if (objetivo === 'leadgen') {
      adsetPayload.promoted_object = { page_id: META_PAGE_ID };
    }
    const adset = await metaPOST(`/${META_AD_ACCOUNT_ID}/adsets`, adsetPayload);

    // 4 · Creative com CTWA payload injetado
    const ctwaPayloadB64 = Buffer.from(JSON.stringify(ctwaPayload)).toString('base64');
    const objectStorySpec = {
      page_id: META_PAGE_ID,
      link_data: {
        image_hash,
        message: cri.texto,
        name: cri.headline,
        link: objetivo === 'ctwa' ? `https://wa.me/${cmp.instancia_whatsapp || META_WHATSAPP_PHONE_ID}` : (cmp.publico?.url_destino || 'https://1negocio.com.br/'),
        call_to_action: { type: cfg.cta, value: objetivo === 'ctwa' ? { app_destination: 'WHATSAPP' } : { link: 'https://1negocio.com.br/' } },
      },
    };
    // CTWA · payload custom vai em url_tags (Meta preserva no adReferral)
    if (objetivo === 'ctwa') {
      objectStorySpec.link_data.url_tags = `ctwa_payload=${encodeURIComponent(ctwaPayloadB64)}`;
    }
    const creative = await metaPOST(`/${META_AD_ACCOUNT_ID}/adcreatives`, {
      name: `Creative · ${cmp.nome}`,
      object_story_spec: objectStorySpec,
    });

    // 5 · Ad PAUSED
    const ad = await metaPOST(`/${META_AD_ACCOUNT_ID}/ads`, {
      name: `Ad · ${cmp.nome}`,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    });

    // Persist
    await fetch(`${SB_URL}/rest/v1/va_campanhas?id=eq.${campanha_id}`, {
      method:'PATCH', headers: H_SVC(),
      body: JSON.stringify({
        status: 'publicada', publicado_em: new Date().toISOString(),
        meta_campaign_id: camp.id, meta_adset_id: adset.id, meta_ad_id: ad.id, meta_creative_id: creative.id,
      }),
    });

    return json(res, 200, {
      ok:true, mode:'published_paused', objetivo,
      meta: { campaign_id: camp.id, adset_id: adset.id, ad_id: ad.id, creative_id: creative.id },
      ctwa_payload: ctwaPayload,
      atenção: 'Anúncio nasce PAUSED no Meta · operador ativa via Ads Manager após revisão.',
    });
  } catch (e) {
    console.error('[va-publicar-campanha]', e?.message, e?.stack?.slice(0,300));
    return json(res, 502, {
      ok:false, erro:'meta_api_falhou', detalhe: String(e?.message || e).slice(0,400),
      fallback_spec: specPublicacao(cmp, cri, arq),
    });
  }
};
