// /api/va-sugerir-publico · Slice P5.4 · Vercel Node runtime
// Monta o CONTRATO de público (P5.2) automaticamente:
//   1. Sonnet lê arquétipo (tese + segmentacao_meta) + setor do laudo → termos de busca
//   2. Para cada termo, chama /api/va-meta-buscar (adinterest) contra catálogo real
//   3. REGRAS EM CÓDIGO (não IA):
//      · descartar audience > 50M (largos demais)
//      · descartar audience < 100k (estreitos demais)
//      · máx 5 interesses (união · dedupe por meta_id)
//   4. Geo default = UF do ativo inteira (não raio · sigilo + CTWA)
//   5. Idade do arquétipo (fallback 30-60)
//   6. Advantage ON default
//   7. Cada interesse vem com justificativa (1 frase do Sonnet)
// Retorna o CONTRATO + justificativas · operador edita antes de salvar.
// Débito ia_geracao_criativo NÃO cobrado aqui (é assist, não geração de peça).
// Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const META_TOKEN = process.env.META_ACCESS_TOKEN || '';
const GRAPH = 'https://graph.facebook.com/v23.0';
const MODEL = 'claude-sonnet-4-6';

const AUDIENCE_MIN = 100_000;
const AUDIENCE_MAX = 50_000_000;
const MAX_INTERESSES = 5;

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json')
     .setHeader('Access-Control-Allow-Origin','*').setHeader('Cache-Control','no-store');
  res.send(JSON.stringify(body));
}
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
const H_SVC = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' });

async function chamarSonnet(prompt, maxTokens = 800) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'x-api-key': ANTHROPIC_KEY, 'anthropic-version':'2023-06-01', 'Content-Type':'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens,
      system: 'Você é estrategista sênior de Meta Ads B2B, especializado em segmentação de campanhas pra alcançar compradores de PMEs (M&A). Retorna JSON puro.',
      messages: [{ role:'user', content: prompt }],
    }),
  });
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch {}
  if (!r.ok) return { ok:false, erro:`anthropic_http_${r.status}`, detalhe: raw.slice(0,300) };
  return { ok:true, texto: d?.content?.[0]?.text || '' };
}

async function buscarInteressesMeta(q, limit = 8) {
  if (!META_TOKEN) return { ok:false, erro:'META_ACCESS_TOKEN ausente' };
  const url = `${GRAPH}/search?type=adinterest&q=${encodeURIComponent(q)}&locale=pt_BR&limit=${limit}&access_token=${encodeURIComponent(META_TOKEN)}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok) return { ok:false, erro:'meta_erro', detalhe: d?.error?.message };
    return { ok:true, sugestoes: (d.data || []).map(x => ({
      meta_id: x.id, nome: x.name,
      audience: x.audience_size_lower_bound || x.audience_size || null,
    })) };
  } catch (e) { return { ok:false, erro:'meta_rede: ' + String(e?.message||e).slice(0,150) }; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','authorization, x-client-info, apikey, content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!ANTHROPIC_KEY) return json(res, 503, { ok:false, erro:'ANTHROPIC_API_KEY ausente' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { projeto_id, arquetipo_id } = body || {};
  if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });

  // Carrega projeto + arquétipo
  const [pR, aR] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=setor,avaliacao_setor,cidade,uf`, { headers: H_SVC() }),
    arquetipo_id ? fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${arquetipo_id}&select=id,nome,tese,abordagem`, { headers: H_SVC() }) : Promise.resolve({ json: async () => [] }),
  ]);
  const [proj] = await pR.json();
  const [arq] = await aR.json();
  if (!proj) return json(res, 404, { ok:false, erro:'projeto não encontrado' });

  const setor = proj.setor || proj.avaliacao_setor || null;
  const uf = proj.uf || null;
  const segmentacao = typeof arq?.abordagem?.segmentacao_meta === 'string'
    ? arq.abordagem.segmentacao_meta
    : (arq?.abordagem?.segmentacao_meta?.texto_original || '');

  // 1 · Sonnet gera 6-10 termos de busca + idade sugerida + justificativas
  const prompt = `Contexto: campanha Meta Ads B2B pra encontrar COMPRADORES de uma PME à venda.

Setor do ativo: ${setor || 'não informado'}
UF do ativo: ${uf || 'não informado'} (público será toda a UF · sigilo)

Arquétipo do comprador-alvo:
- Nome: ${arq?.nome || 'genérico'}
- Tese: ${arq?.tese || 'sem tese'}
- Segmentação textual (do arquétipo): ${segmentacao || 'sem descrição'}

Sua tarefa: sugerir 6-10 TERMOS DE BUSCA em português BR (uma palavra ou expressão curta) que a Targeting Search do Meta vai usar pra achar interesses no catálogo oficial. Também sugere faixa etária realista pro perfil.

REGRAS:
- Termos concretos e pesquisáveis (Meta indexa por interesse/comportamento). Ex: "Empreendedorismo", "Pequenas empresas", "Fusões e aquisições", "Distribuição de alimentos". NÃO usar termos vagos ("negócios em geral").
- Cada termo vem com uma JUSTIFICATIVA de 1 frase (por que esse interesse pega comprador desse perfil).
- Idade: pensar em quem tem capital + experiência pra adquirir uma empresa neste setor.

Retorne JSON puro (sem markdown, sem preâmbulo):
{
  "termos": [
    { "termo": "string curta", "justificativa": "1 frase" }
  ],
  "idade_min": 30,
  "idade_max": 60
}`;

  const rClaude = await chamarSonnet(prompt);
  if (!rClaude.ok) return json(res, 502, { ok:false, erro: rClaude.erro, detalhe: rClaude.detalhe });
  let sug = null;
  try {
    const t = rClaude.texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/,'').trim();
    sug = JSON.parse(t);
  } catch { return json(res, 502, { ok:false, erro:'sonnet_json_invalido', texto: rClaude.texto.slice(0, 400) }); }
  if (!Array.isArray(sug?.termos) || !sug.termos.length) return json(res, 502, { ok:false, erro:'sonnet_sem_termos' });

  // 2 · Busca cada termo no Meta · agrega candidatos únicos por meta_id
  const candidatos = new Map(); // meta_id → { meta_id, nome, audience, justificativas:[] }
  const erros = [];
  for (const t of sug.termos.slice(0, 10)) {
    const rM = await buscarInteressesMeta(t.termo, 6);
    if (!rM.ok) { erros.push({ termo: t.termo, erro: rM.erro }); continue; }
    for (const s of rM.sugestoes) {
      if (!s.meta_id) continue;
      const prev = candidatos.get(s.meta_id);
      if (prev) prev.justificativas.push(`(via "${t.termo}") ${t.justificativa}`);
      else candidatos.set(s.meta_id, {
        meta_id: s.meta_id, nome: s.nome, audience: Number(s.audience || 0),
        justificativas: [`(via "${t.termo}") ${t.justificativa}`],
      });
    }
  }
  if (!META_TOKEN) return json(res, 503, { ok:false, erro:'META_ACCESS_TOKEN ausente · sem catálogo Meta pra resolver os termos', termos_sonnet: sug.termos });

  // 3 · REGRAS EM CÓDIGO · filtra por tamanho de audience e limita a MAX
  let filtrados = [...candidatos.values()]
    .filter(c => c.audience >= AUDIENCE_MIN && c.audience <= AUDIENCE_MAX)
    .sort((a, b) => b.audience - a.audience)   // maior audience primeiro (dentro da faixa)
    .slice(0, MAX_INTERESSES);

  // 4 · Monta o CONTRATO
  const contrato = {
    geo: uf ? { modo:'ufs', ufs:[uf], cidades:[], excluir:[] } : { modo:'ufs', ufs:['SP'], cidades:[], excluir:[] },
    idade_min: Math.max(18, Math.min(65, Number(sug.idade_min) || 30)),
    idade_max: Math.max(18, Math.min(65, Number(sug.idade_max) || 60)),
    genero: 'todos',
    interesses: filtrados.map(f => ({ meta_id: f.meta_id, nome: f.nome, audience: f.audience, justificativa: f.justificativas[0] })),
    comportamentos: [],
    advantage_detailed: true,
    audiencias: { incluir: [], excluir: [] },
    posicionamentos: 'automatico',
    idiomas: ['pt_BR'],
  };

  return json(res, 200, {
    ok: true,
    contrato,
    resumo: {
      termos_sugeridos: sug.termos.length,
      candidatos_encontrados: candidatos.size,
      selecionados: filtrados.length,
      descartados_largos: [...candidatos.values()].filter(c => c.audience > AUDIENCE_MAX).length,
      descartados_estreitos: [...candidatos.values()].filter(c => c.audience < AUDIENCE_MIN).length,
      regras: `audience [${AUDIENCE_MIN}, ${AUDIENCE_MAX}] · max ${MAX_INTERESSES}`,
    },
    termos_sonnet: sug.termos,
    erros_meta: erros.length ? erros : undefined,
  });
};
