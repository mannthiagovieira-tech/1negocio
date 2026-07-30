// /api/gerar-mensagem · Vercel Function
// Gera o TOQUE 2 (contexto) via Anthropic API depois que o lead
// respondeu ao toque 1. Grava na va_disparo_fila com aprovacao pendente
// (ou já aprovada se projeto.auto_aprovar_toque2). Debita mensagem_ia.
//
// Auth: JWT admin. Chave Anthropic: env var, nunca ecoada.
// Sigilo: NUNCA envia à IA o nome/CNPJ/valor/sócios do negócio à venda.

const SB_URL = process.env.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

function json(res, code, body) {
  res.status(code).setHeader('Content-Type', 'application/json');
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
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return r.ok && (await r.json()) === true;
}

function anosNoQuadro(data_entrada) {
  if (!data_entrada) return null;
  const d = new Date(data_entrada);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (365.25 * 86400 * 1000)));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'method not allowed' });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!tok) return json(res, 401, { ok: false, erro: 'não autorizado' });
  if (!(await ehAdmin(tok))) return json(res, 403, { ok: false, erro: 'não autorizado' });

  const ANTH = process.env.ANTHROPIC_API_KEY;
  if (!ANTH) return json(res, 503, { ok: false, erro: 'ANTHROPIC_API_KEY não configurada' });
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY não configurada' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
  const { contato_id, resposta_lead } = body || {};
  if (!contato_id) return json(res, 400, { ok: false, erro: 'contato_id obrigatório' });

  const sbHeaders = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };

  // 1. Carrega contato + projeto + teaser aprovado (mais recente)
  const rCt = await fetch(`${SB_URL}/rest/v1/va_contatos?id=eq.${contato_id}&select=*`, { headers: sbHeaders });
  const [contato] = await rCt.json();
  if (!contato) return json(res, 404, { ok: false, erro: 'contato não encontrado' });
  if (!contato.respondeu_toque1_em) return json(res, 400, { ok: false, erro: 'contato ainda não respondeu ao toque 1' });

  const rPj = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${contato.projeto_id}&select=cidade,uf,setor,nivel_sigilo,auto_aprovar_toque2`, { headers: sbHeaders });
  const [projeto] = await rPj.json();
  if (!projeto) return json(res, 404, { ok: false, erro: 'projeto não encontrado' });

  const rTs = await fetch(`${SB_URL}/rest/v1/va_projeto_teaser?projeto_id=eq.${contato.projeto_id}&status=eq.aprovado&order=versao.desc&limit=1&select=texto`, { headers: sbHeaders });
  const [teaser] = await rTs.json();

  let arqNome = null, arqBusca = null;
  if (contato.arquetipo_codigo) {
    const rArq = await fetch(`${SB_URL}/rest/v1/va_arquetipos_catalogo?codigo=eq.${contato.arquetipo_codigo}&select=nome,busca`, { headers: sbHeaders });
    const [arq] = await rArq.json();
    arqNome = arq?.nome || null; arqBusca = arq?.busca || null;
  }

  // 2. Monta contexto SANITIZADO (nunca inclui identificadores do negócio à venda)
  const contexto = {
    teaser_cego:      teaser?.texto || null,
    arquetipo:        arqNome,
    por_que_selecionado: arqBusca,
    lead: {
      primeiro_nome:   (contato.nome || '').split(/\s+/)[0] || null,
      cargo:           contato.cargo || null,
      cidade:          contato.cidade || null,
      uf:              contato.estado || null,
      setor:           contato.empresa ? null : null, // opaco
      porte:           contato.porte_faturamento || null,
      anos_no_quadro:  anosNoQuadro(contato.socio_data_entrada),
    },
    negocio_a_venda: {
      cidade: projeto.cidade || null,
      uf:     projeto.uf     || null,
      setor:  projeto.setor  || null,
      // JAMAIS: nome, razão social, CNPJ, endereço, valor, sócios
    },
    resposta_do_lead_ao_toque1: resposta_lead || null,
  };

  const systemPrompt = [
    'Você é um consultor sênior de M&A brasileiro escrevendo pelo WhatsApp.',
    'Regras não negociáveis:',
    '• máximo 4 linhas curtas · sem introduções longas',
    '• português brasileiro coloquial de negócios · SEM formalidade',
    '• cite proximidade (cidade/UF) e afinidade de setor SEM identificar o negócio',
    '• termine com pergunta simples: "posso te mandar um resumo?"',
    '• NUNCA invente dado que não está no contexto',
    '• NUNCA cite nome, razão social, CNPJ, endereço ou valor do negócio à venda',
    '• tom de quem conhece a região, não de vendedor',
  ].join('\n');

  const userPrompt = 'CONTEXTO:\n' + JSON.stringify(contexto, null, 2) + '\n\nEscreva a mensagem do TOQUE 2 diretamente, sem preâmbulo, sem cabeçalho, sem aspas.';

  // 3. Chama Anthropic
  let mensagem, custoReal;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTH,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const raw = await r.text();
    let d = null; try { d = JSON.parse(raw); } catch {}
    if (!r.ok) return json(res, 502, { ok: false, erro: `anthropic_http_${r.status}`, resposta_amostra: raw.slice(0, 600) });
    mensagem = (d?.content?.[0]?.text || '').trim();
    if (!mensagem) return json(res, 502, { ok: false, erro: 'anthropic_resposta_vazia' });
    // Haiku 4.5: $1/M input tokens · $5/M output tokens (aprox)
    const inTok  = d?.usage?.input_tokens  || 0;
    const outTok = d?.usage?.output_tokens || 0;
    const usdCost = (inTok / 1_000_000) * 1.0 + (outTok / 1_000_000) * 5.0;
    custoReal = Number((usdCost * 5.5).toFixed(4)); // USD→BRL aprox
  } catch (e) {
    return json(res, 502, { ok: false, erro: 'anthropic_erro_rede', detalhe: String(e.message || e).slice(0, 200) });
  }

  // 4. Insere na fila (trigger seta status='aguardando_aprovacao' se não auto-aprovado)
  const aprovado = !!projeto.auto_aprovar_toque2;
  const insBody = {
    projeto_id: contato.projeto_id,
    contato_id,
    template_id: null,
    corpo_resolvido: mensagem,
    status: aprovado ? 'agendado' : 'aguardando_aprovacao',
    toque: 2,
    gerado_por_ia: true,
    aprovado_por_admin: aprovado,
    prompt_contexto: contexto,
  };
  const rIns = await fetch(`${SB_URL}/rest/v1/va_disparo_fila`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(insBody),
  });
  if (!rIns.ok) {
    return json(res, 500, { ok: false, erro: 'insert_fila_falhou', detalhe: (await rIns.text()).slice(0, 300) });
  }
  const [linha] = await rIns.json();

  // 5. Debita mensagem_ia (custo real Anthropic apurado; preço = 2× em va_precos)
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
      method: 'POST', headers: sbHeaders,
      body: JSON.stringify({
        p_projeto: contato.projeto_id, p_tipo: 'mensagem_ia', p_qtd: 1,
        p_referencia: `toque 2 IA · contato ${contato_id}`, p_ciclo: null,
      }),
    });
  } catch (_) { /* não bloqueia */ }

  return json(res, 200, {
    ok: true,
    fila_id: linha.id,
    contato_id,
    mensagem,
    custo_real_estimado: custoReal,
    aprovado_por_admin: aprovado,
    status: linha.status,
  });
};
