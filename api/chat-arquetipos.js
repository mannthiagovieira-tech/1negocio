// /api/chat-arquetipos · Vercel Function
// Chat de calibração de arquétipos: admin conversa com Claude que propõe
// 4-5 teses de comprador (nome, raciocínio, CNAEs, keywords, faixa porte)
// com base no contexto do projeto. Termina com aprovação → grava em
// va_projeto_arquetipos.queries_busca.
//
// Ações (POST body.action):
//   'iniciar'   · cria sessão, envia turno 1 com contexto agregado
//   'mensagem'  · adiciona turno do usuário, gera resposta IA
//   'contagem'  · roda 1 consulta Kipflow $size:1 basic pra medir universo de uma tese
//   'aprovar'   · chama RPC va_arquetipos_aprovar_teses (trava sessão)
//   'descartar' · marca sessão como descartada

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;

const SIGLA_UF = {
  AC:'ACRE', AL:'ALAGOAS', AP:'AMAPA', AM:'AMAZONAS', BA:'BAHIA', CE:'CEARA',
  DF:'DISTRITO FEDERAL', ES:'ESPIRITO SANTO', GO:'GOIAS', MA:'MARANHAO',
  MT:'MATO GROSSO', MS:'MATO GROSSO DO SUL', MG:'MINAS GERAIS', PA:'PARA',
  PB:'PARAIBA', PR:'PARANA', PE:'PERNAMBUCO', PI:'PIAUI', RJ:'RIO DE JANEIRO',
  RN:'RIO GRANDE DO NORTE', RS:'RIO GRANDE DO SUL', RO:'RONDONIA', RR:'RORAIMA',
  SC:'SANTA CATARINA', SP:'SAO PAULO', SE:'SERGIPE', TO:'TOCANTINS',
};
const ufExtenso = v => { if (!v) return null; const s=String(v).trim().toUpperCase(); return s.length===2&&SIGLA_UF[s]?SIGLA_UF[s]:s; };

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

// System prompt do consultor M&A que propõe teses
const SYSTEM = `Você é um consultor sênior brasileiro de M&A de PMEs (R$1M–R$50M/ano). Ajuda o operador a definir 4 a 5 TESES DE COMPRADOR para um negócio à venda.

REGRAS:
- Cada tese é um perfil concreto de quem compraria: um estratégico, um financeiro, um operador etc.
- Cada tese deve explicar POR QUE ESSE PERFIL COMPRARIA — o raciocínio econômico, não genérico.
- Para cada tese, sugira CNAEs (código de 4-5 dígitos para classe ou 7 dígitos para subclasse) E keywords em razão social (ex: "MULTA", "TRÂNSITO"). São inputs pra busca automática — se der duplicado, tudo bem, filtramos depois.
- Faixa de porte é múltiplo do faturamento da semente (ex: 3× a 15× para estratégico setorial).
- Se o CNAE da semente é residual (subclasse 8219999, categoria "não especificados anteriormente"), avise que só CNAE não filtra bem e sugira keywords.
- Você conversa em PT-BR direto, sem jargão americano. Sem "framework", sem "leverage", sem "sinergia".
- Contradiga o operador quando fizer sentido. Ele quer que você seja parceiro crítico.

QUANDO O OPERADOR DIZ "propor teses" OU "gere as teses", devolva um bloco JSON delimitado por <<<TESES>>> e <<<FIM>>> assim:
<<<TESES>>>
[
  {
    "codigo": "T1",
    "nome": "Nome curto do perfil",
    "raciocinio": "Por que essa gente compraria — 2-3 frases",
    "queries_busca": ["82199", "MULTA", "TRANSITO"],
    "faixa_porte_multiplo": {"min": 3, "max": 15},
    "observacao": "raciocínio completo · fica em va_projeto_arquetipos.observacao"
  }
]
<<<FIM>>>

O operador vê o JSON e pode pedir contagem de universo por tese, editar, ou aprovar. Se ele pede ajustes, gere o bloco novamente com as mudanças. Cada bloco novo é o snapshot final.`;

async function chamarAnthropic(mensagens) {
  const ANTH = process.env.ANTHROPIC_API_KEY;
  if (!ANTH) return { erro: 'ANTHROPIC_API_KEY não configurada' };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers: { 'x-api-key':ANTH, 'anthropic-version':'2023-06-01', 'Content-Type':'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 2000,
      system: SYSTEM,
      messages: mensagens,
    }),
  });
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch {}
  if (!r.ok) return { erro: `anthropic_http_${r.status}`, detalhe: raw.slice(0,300) };
  const texto = (d?.content?.[0]?.text || '').trim();
  const inTok = d?.usage?.input_tokens || 0;
  const outTok = d?.usage?.output_tokens || 0;
  // sonnet-4.6: aprox $3/M input, $15/M output
  const custoUsd = (inTok/1e6)*3 + (outTok/1e6)*15;
  return { texto, custo_real: Number((custoUsd*5.5).toFixed(4)) };
}

// Extrai teses do último bloco <<<TESES>>>...<<<FIM>>>
function extrairTeses(texto) {
  const m = /<<<TESES>>>\s*([\s\S]*?)\s*<<<FIM>>>/.exec(texto);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

async function contagemKipflow(KEY, tese, semFat, semUf, cnpjSemente) {
  const fx = tese.faixa_porte_multiplo || { min: 0.5, max: 5 };
  const orQ = [];
  for (const q of (tese.queries_busca || [])) {
    const s = String(q).trim();
    if (/^\d{4,7}$/.test(s)) {
      const chave = s.length >= 7 ? 'cnae_principal_subclasse' : 'cnae_principal_classe';
      orQ.push({ [chave]: Number(s) });
    } else if (s) orQ.push({ razao_social: { $fuzzy: s } });
  }
  if (orQ.length === 0) return { erro: 'sem queries_busca' };
  const andBlocks = [
    { $or:[{ situacao_cadastral:'ATIVA' }] },
    { $or:[{ matriz:true }] },
    { $or: orQ },
  ];
  if (semFat > 0) {
    andBlocks.push({ $or:[{ faturamento:{ $gte: Math.round(semFat*fx.min) } }] });
    andBlocks.push({ $or:[{ faturamento:{ $lte: Math.round(semFat*fx.max) } }] });
  }
  if (semUf) andBlocks.push({ $or:[{ uf: semUf }] });
  if (cnpjSemente) andBlocks.push({ $or:[{ cnpj:{ $nin:[cnpjSemente] } }] });

  const r = await fetch('https://api.kipflow.io/companies/v1/search', {
    method:'POST',
    headers:{ 'X-API-Key':KEY, 'Content-Type':'application/json', Accept:'application/json' },
    body: JSON.stringify({ $filter:{$and:andBlocks}, $page:0, $size:1, datasets:['basic'] }),
  });
  const d = await r.json().catch(()=>null);
  if (!r.ok) return { erro: `kipflow_http_${r.status}`, detalhe: JSON.stringify(d).slice(0,200) };
  return {
    universo: d?.pagination?.total || 0,
    custo: d?.cost || 0,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false, erro:'POST only' });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!tok) return json(res, 401, { ok:false });
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });
  const KEY = process.env.KIPFLOW_API_KEY;
  const sbHeaders = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { action, projeto_id, sessao_id, mensagem, tese, teses } = body || {};

  // ── ACTION: iniciar ─────────────────────────────────
  if (action === 'iniciar') {
    if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });

    // Carrega contexto (kickoff, laudo, teaser, semente enriquecida)
    const rPj = await safeCall(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=cnpj,cidade,uf,setor,negocio_titulo,valor_venda,valor_avaliacao,valor_avaliacao_min,valor_avaliacao_max`, { headers: sbHeaders });
    const [proj] = await rPj.json();
    if (!proj) return json(res, 404, { ok:false, erro:'projeto não encontrado' });

    let semente = null;
    if (proj.cnpj) {
      const rE = await safeCall(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${proj.cnpj}&select=razao_social,nome_fantasia,cnae_codigo,cnae_descricao,estado,cidade,enriquecimento_bruto`, { headers: sbHeaders });
      const [emp] = await rE.json();
      if (emp) {
        const b = emp.enriquecimento_bruto?.data || emp.enriquecimento_bruto || {};
        semente = {
          razao: emp.razao_social, fantasia: emp.nome_fantasia,
          cnae_classe: b.cnae_principal_classe, cnae_desc_classe: b.cnae_principal_desc_classe,
          cnae_subclasse: b.cnae_principal_subclasse, cnae_desc_subclasse: b.cnae_principal_desc_subclasse,
          faturamento: b.faturamento, porte: b.porte, funcionarios: b.faixa_funcionarios_grupo,
          municipio: b.municipio, uf: b.uf, segmento: b.segmento, ramo: b.ramo_de_atividade,
        };
      }
    }

    const rKick = await safeCall(`${SB_URL}/rest/v1/va_projeto_kickoff?projeto_id=eq.${projeto_id}`, { headers: sbHeaders });
    const [kick] = await rKick.json();
    const rTz = await safeCall(`${SB_URL}/rest/v1/va_projeto_teaser?projeto_id=eq.${projeto_id}&status=eq.aprovado&order=versao.desc&limit=1&select=texto`, { headers: sbHeaders });
    const [teaser] = await rTz.json();

    const contexto = {
      projeto: { titulo: proj.negocio_titulo, cidade: proj.cidade, uf: proj.uf, setor: proj.setor,
                 valor_venda: proj.valor_venda, valor_avaliacao: proj.valor_avaliacao,
                 valor_avaliacao_faixa: [proj.valor_avaliacao_min, proj.valor_avaliacao_max] },
      semente, kickoff: kick || null,
      teaser_cego: teaser?.texto || null,
    };

    const msgInicial = `Contexto do projeto:\n\n${JSON.stringify(contexto, null, 2)}\n\nBaseado nesse contexto, proponha 4 a 5 teses de comprador. Devolva o bloco JSON <<<TESES>>>...<<<FIM>>>.`;
    const mensagens = [{ role:'user', content: msgInicial }];

    const ia = await chamarAnthropic(mensagens);
    if (ia.erro) return json(res, 502, { ok:false, erro: ia.erro, detalhe: ia.detalhe });

    const mensagensFinal = [
      { role:'user', content: msgInicial, ts: new Date().toISOString() },
      { role:'assistant', content: ia.texto, ts: new Date().toISOString() },
    ];
    const teses0 = extrairTeses(ia.texto);
    const rIns = await fetch(`${SB_URL}/rest/v1/va_arquetipos_chat_sessao`, {
      method:'POST', headers: { ...sbHeaders, Prefer:'return=representation' },
      body: JSON.stringify({ projeto_id, status:'aberta', mensagens: mensagensFinal, teses_propostas: teses0, custo_ia_total: ia.custo_real }),
    });
    const [ses] = await rIns.json();
    return json(res, 200, { ok:true, sessao_id: ses.id, resposta: ia.texto, teses: teses0, custo_ia_real: ia.custo_real });
  }

  // Carrega sessão pras próximas ações
  if (!sessao_id) return json(res, 400, { ok:false, erro:'sessao_id obrigatório' });
  const rS = await safeCall(`${SB_URL}/rest/v1/va_arquetipos_chat_sessao?id=eq.${sessao_id}&select=*`, { headers: sbHeaders });
  const [sessao] = await rS.json();
  if (!sessao) return json(res, 404, { ok:false, erro:'sessão não encontrada' });
  if (sessao.status !== 'aberta') return json(res, 400, { ok:false, erro:`sessão ${sessao.status}` });

  // ── ACTION: mensagem ────────────────────────────────
  if (action === 'mensagem') {
    if (!mensagem) return json(res, 400, { ok:false, erro:'mensagem obrigatória' });
    const historico = [
      ...sessao.mensagens.map(m => ({ role: m.role, content: m.content })),
      { role:'user', content: mensagem },
    ];
    const ia = await chamarAnthropic(historico);
    if (ia.erro) return json(res, 502, { ok:false, erro: ia.erro, detalhe: ia.detalhe });
    const novaTeses = extrairTeses(ia.texto);
    const mensagensAtual = [
      ...sessao.mensagens,
      { role:'user', content: mensagem, ts: new Date().toISOString() },
      { role:'assistant', content: ia.texto, ts: new Date().toISOString() },
    ];
    await fetch(`${SB_URL}/rest/v1/va_arquetipos_chat_sessao?id=eq.${sessao_id}`, {
      method:'PATCH', headers: sbHeaders,
      body: JSON.stringify({
        mensagens: mensagensAtual,
        teses_propostas: novaTeses || sessao.teses_propostas,
        custo_ia_total: Number(sessao.custo_ia_total) + ia.custo_real,
        atualizado_em: new Date().toISOString(),
      }),
    });
    return json(res, 200, { ok:true, resposta: ia.texto, teses: novaTeses, custo_ia_real: ia.custo_real });
  }

  // ── ACTION: contagem ────────────────────────────────
  if (action === 'contagem') {
    if (!tese) return json(res, 400, { ok:false, erro:'tese obrigatória' });
    if (!KEY) return json(res, 503, { ok:false, erro:'KIPFLOW_API_KEY ausente' });
    // Puxa semente
    const rPj = await safeCall(`${SB_URL}/rest/v1/va_projetos?id=eq.${sessao.projeto_id}&select=cnpj`, { headers: sbHeaders });
    const [proj] = await rPj.json();
    const cnpjSemente = String(proj?.cnpj||'').replace(/\D/g,'');
    const rE = await safeCall(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${cnpjSemente}&select=enriquecimento_bruto,estado`, { headers: sbHeaders });
    const [emp] = await rE.json();
    const b = emp?.enriquecimento_bruto?.data || emp?.enriquecimento_bruto || {};
    const semFat = Number(b.faturamento) || 0;
    const semUf = ufExtenso(b.uf || emp?.estado);

    const r = await contagemKipflow(KEY, tese, semFat, semUf, cnpjSemente);
    if (r.erro) return json(res, 502, { ok:false, ...r });

    await fetch(`${SB_URL}/rest/v1/va_arquetipos_chat_sessao?id=eq.${sessao_id}`, {
      method:'PATCH', headers: sbHeaders,
      body: JSON.stringify({ custo_kipflow_contagem: Number(sessao.custo_kipflow_contagem) + Number(r.custo||0), atualizado_em: new Date().toISOString() }),
    });
    return json(res, 200, { ok:true, universo: r.universo, custo_kipflow: r.custo });
  }

  // ── ACTION: aprovar ─────────────────────────────────
  if (action === 'aprovar') {
    if (!Array.isArray(teses) || teses.length === 0) return json(res, 400, { ok:false, erro:'teses obrigatório (array)' });
    const rApr = await fetch(`${SB_URL}/rest/v1/rpc/va_arquetipos_aprovar_teses`, {
      method:'POST', headers: sbHeaders,
      body: JSON.stringify({ p_sessao_id: sessao_id, p_teses: teses }),
    });
    if (!rApr.ok) return json(res, 500, { ok:false, erro:'aprovar_falhou', detalhe:(await rApr.text()).slice(0,300) });
    const n = await rApr.json();
    return json(res, 200, { ok:true, aprovadas: n, sessao_status: 'aprovada' });
  }

  // ── ACTION: descartar ───────────────────────────────
  if (action === 'descartar') {
    await fetch(`${SB_URL}/rest/v1/va_arquetipos_chat_sessao?id=eq.${sessao_id}`, {
      method:'PATCH', headers: sbHeaders,
      body: JSON.stringify({ status:'descartada', atualizado_em: new Date().toISOString() }),
    });
    return json(res, 200, { ok:true, sessao_status: 'descartada' });
  }

  return json(res, 400, { ok:false, erro:'action inválido (iniciar|mensagem|contagem|aprovar|descartar)' });
};
