// gerar-originacao · v9.24.1
// Motor de Originação de Compradores · 1 chamada Sonnet 4 com web_search ativo
// Roda 1x por projeto (cria nova versão a cada chamada).
//
// v9.24.1 (hardening):
// - Remove bypass service_role sem verificação de assinatura
// - Limite de 3 gerações por projeto em janela de 24h
// - verify_jwt=true no deploy garante dupla validação (Edge Gateway + getUser)
//
// Input (POST):
// {
//   projeto_id: uuid,
//   contexto_adicional: string (obrigatório),
//   hipotese_comprador?: string,
//   restricoes?: string,
//   urgencia?: 'sem_pressa' | 'normal' | 'urgente' | 'critico',
//   orcamento_midia_diario?: number,
//   canais_excluidos?: string[],
//   foco_pj_pf?: 'pj' | 'pf' | 'ambos'
// }
//
// Output: { ok, originacao_id, versao, conteudo, web_search_usado,
//           duracao_ms, input_tokens, output_tokens, arquetipos_count }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `Você é um especialista sênior em M&A de pequenas e médias empresas no Brasil, especializado em identificar compradores estratégicos e financeiros para negócios à venda.

## REGRA ABSOLUTA — LINKS REAIS OBRIGATÓRIOS

Antes de gerar qualquer fonte, você DEVE usar a ferramenta de busca web para encontrar os links reais. Nunca invente URLs. Nunca escreva "busque por X no Facebook" sem incluir o link real do grupo. Nunca mencione um evento sem incluir o site oficial verificado.

Para cada fonte gerada:
- Grupos Facebook: pesquise o nome exato, verifique que existe, inclua o link real (formato: facebook.com/groups/ID)
- Perfis Instagram âncora: verifique que o @handle existe, inclua o link real (formato: instagram.com/@handle)
- Associações setoriais: verifique o site oficial, inclua o link real
- Eventos e feiras: verifique o site oficial e a próxima edição, inclua o link real
- LinkedIn: inclua a URL de busca com filtros pré-montados
- Google Maps: inclua a URL de busca com a query exata

Queries de busca para verificar (adapte ao setor do negócio):
- "grupo facebook [setor] lojistas brasil site:facebook.com/groups"
- "associação brasileira [setor] site oficial"
- "feira [setor] são paulo 2025 2026 site oficial"
- "instagram @[handle] [setor]"

Se não encontrar um link verificado, OMITA a fonte — não inclua com URL inventada ou genérica.

## FORMATO DE RESPOSTA

Responda APENAS com JSON válido, sem markdown, sem texto fora do JSON.

{
  "tese": {
    "resumo": "2-3 frases sobre o ativo e sua atratividade",
    "diferenciais": ["diferencial 1", "diferencial 2", "diferencial 3"],
    "riscos": ["risco 1", "risco 2"],
    "momento_mercado": "contexto de mercado relevante"
  },
  "arquetipos": [
    {
      "nome": "Nome do arquétipo",
      "vetor": "horizontal ou vertical",
      "perfil": "Quem é, o que faz, como opera",
      "motivacao": "Por que compraria este negócio especificamente",
      "capacidade_financeira": "Faixa estimada de capital disponível",
      "fit": "alto ou medio",
      "exemplos": "Exemplos concretos do perfil"
    }
  ],
  "onde_encontrar": [
    {
      "arquetipoNome": "nome do arquétipo",
      "fontes": [
        {
          "canal": "tipo do canal",
          "instrucao": "instrução específica e acionável",
          "link": "URL REAL verificada via busca — OBRIGATÓRIO",
          "ferramenta_enriquecimento": "Econodata ou Assertiva ou Lusha ou Apify ou Manual"
        }
      ]
    }
  ],
  "longlist": [
    {
      "perfil": "Descrição do candidato",
      "fonte": "Onde buscar",
      "link": "URL REAL verificada — quando aplicável",
      "ferramenta": "ferramenta de enriquecimento",
      "prioridade": "alta ou media",
      "arquetipoRef": "nome do arquétipo relacionado",
      "nota": "instrução específica opcional"
    }
  ],
  "tasks_enriquecimento": [
    {
      "tarefa": "Descrição concreta da tarefa",
      "ferramenta": "nome da ferramenta",
      "tipo": "automatica ou manual",
      "output_esperado": "o que se espera obter"
    }
  ],
  "midia_paga": [
    {
      "arquetipoNome": "nome do arquétipo",
      "facebook": {
        "demografico": { "idade_min": 0, "idade_max": 0, "localizacao": "cidade/estado", "genero": "todos" },
        "interesses": ["interesse 1", "interesse 2"],
        "comportamentos": ["comportamento 1"],
        "hook": "primeira frase do anúncio",
        "argumento": "argumento central",
        "cta": "texto do botão",
        "formato_sugerido": "carrossel ou imagem ou vídeo",
        "orcamento_sugerido": "R$X/dia"
      },
      "google": {
        "keywords_compra": ["keyword 1", "keyword 2"],
        "keywords_expansao": ["keyword 1"],
        "keywords_negativas": ["negativa 1"],
        "estrategia_lance": "descrição da estratégia"
      }
    }
  ],
  "perguntas_assessor": ["pergunta 1", "pergunta 2", "pergunta 3"]
}

## REGRAS ADICIONAIS

- Mínimo: 3 arquétipos, 10 itens na longlist, 5 tasks, 2 blocos de mídia paga, 3 perguntas
- CNAEs: use códigos reais brasileiros (formato XXXX-X/XX)
- Grupos Facebook: prefira grupos com mais de 1.000 membros ativos
- Instagram âncoras: prefira perfis com mais de 10k seguidores no setor
- Eventos: inclua apenas edições futuras ou anuais confirmadas
- Sempre classifique o vetor do arquétipo: horizontal (mesmo setor) ou vertical (setor adjacente)
- midia_paga: gere para os 2 arquétipos de maior fit`;

function urgenciaDesc(u: string): string {
  const map: Record<string, string> = {
    sem_pressa: "180+ dias · sem pressa",
    normal: "90-180 dias · ritmo normal",
    urgente: "60-90 dias · acelerar prospecção",
    critico: "menos de 60 dias · máxima velocidade",
  };
  return map[u] || "normal";
}

function focoDesc(f: string): string {
  const map: Record<string, string> = {
    pj: "apenas pessoa jurídica (empresas)",
    pf: "apenas pessoa física (executivos, investidores)",
    ambos: "PJ e PF (recomendado · cobertura completa)",
  };
  return map[f] || "ambos";
}

function buildUserPrompt(negocio: any, inputs: any): string {
  const canaisExcluidos = (inputs.canais_excluidos?.length)
    ? `\n\nCanais EXCLUÍDOS (NÃO incluir nesta análise): ${inputs.canais_excluidos.join(", ")}`
    : "";

  const hipotese = inputs.hipotese_comprador
    ? `\n\nHipótese inicial do assessor sobre comprador ideal: ${inputs.hipotese_comprador}`
    : "";

  const restricoes = inputs.restricoes
    ? `\n\nRestrições do mandato: ${inputs.restricoes}`
    : "";

  const fatAnual = negocio.faturamento_anual ?? negocio.fat_anual;
  const ebitda = negocio.ebitda ?? negocio.ebitda_anual;
  const preco = negocio.preco_pedido ?? negocio.valor_1n;
  const anosOp = negocio.tempo_operacao_anos ?? negocio.anos_existencia
    ?? (negocio.ano_fundacao ? new Date().getFullYear() - negocio.ano_fundacao : null);
  const func = negocio.funcionarios ?? negocio.num_funcionarios;
  const descricao = negocio.descricao || negocio.descricao_geral || negocio.tese || "Não informado";
  const diferenciais = negocio.diferenciais || negocio.pontos_positivos || "Não informado";
  const motivoVenda = negocio.motivo_venda || "Não informado";

  return `Negócio à venda:
- Nome: ${negocio.nome_negocio || negocio.nome || "Não informado"}
- Setor: ${negocio.setor || negocio.categoria || "Não informado"}
- Modelo de negócio: ${Array.isArray(negocio.formas_atuacao) ? negocio.formas_atuacao.join(", ") : "Não informado"}
- Localização: ${negocio.cidade || "?"}, ${negocio.estado || "?"}
- Faturamento anual: ${fatAnual ? "R$ " + fatAnual : "Não informado"}
- EBITDA / Lucro anual: ${ebitda ? "R$ " + ebitda : "Não informado"}
- Preço pedido: ${preco ? "R$ " + preco : "Não informado"}
- Tempo de operação: ${anosOp || "Não informado"} anos
- Funcionários: ${func || "Não informado"}
- Descrição: ${descricao}
- Diferenciais: ${diferenciais}
- Motivo da venda: ${motivoVenda}

Contexto adicional do assessor: ${inputs.contexto_adicional}${hipotese}${restricoes}

Parâmetros do mandato:
- Urgência: ${inputs.urgencia} (${urgenciaDesc(inputs.urgencia)})
- Foco: ${focoDesc(inputs.foco_pj_pf)}
- Orçamento mídia paga: R$ ${inputs.orcamento_midia_diario || 50}/dia${canaisExcluidos}

Gere a análise completa em JSON conforme schema. Use web search ativo pra encontrar grupos Facebook reais, perfis Instagram âncora reais, associações setoriais reais e eventos com data confirmada.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // ───── Gate admin (v9.24.1 · sem bypass service_role) ─────
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });

  // adminClient.auth.getUser(jwt) faz chamada HTTP pra GoTrue · valida assinatura
  // verify_jwt=true no deploy garante validação dupla (Edge Gateway + esta linha)
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });

  const { data: admin, error: adminErr } = await adminClient
    .from("admins")
    .select("id, ativo")
    .eq("whatsapp", userData.user.phone)
    .eq("ativo", true)
    .maybeSingle();
  if (adminErr || !admin) return resp(403, { ok: false, erro: "nao_admin" });

  // ───── Parse body ─────
  let body: any;
  try { body = await req.json(); }
  catch { return resp(400, { ok: false, erro: "json_invalido" }); }

  const {
    projeto_id,
    contexto_adicional,
    hipotese_comprador,
    restricoes,
    urgencia,
    orcamento_midia_diario,
    canais_excluidos,
    foco_pj_pf,
  } = body;

  if (!projeto_id || !contexto_adicional) {
    return resp(400, {
      ok: false,
      erro: "params_invalidos",
      detalhe: "projeto_id e contexto_adicional são obrigatórios",
    });
  }

  // ───── v9.24.1 · Limite 3 gerações/dia por projeto ─────
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: geracoes24h } = await adminClient
    .from("projetos_originacao")
    .select("id", { count: "exact", head: true })
    .eq("projeto_id", projeto_id)
    .gte("created_at", cutoff);

  if ((geracoes24h ?? 0) >= 3) {
    return resp(429, {
      ok: false,
      erro: "limite_diario",
      detalhe: "Limite de 3 gerações por dia atingido para este projeto. Tente novamente em algumas horas.",
      geracoes_24h: geracoes24h,
    });
  }

  // ───── Busca projeto_metadata + negocio ─────
  const { data: projeto, error: errProj } = await adminClient
    .from("projeto_metadata")
    .select("id, negocio_id")
    .eq("id", projeto_id)
    .maybeSingle();

  if (errProj || !projeto) return resp(404, { ok: false, erro: "projeto_nao_encontrado" });

  const { data: negocio } = await adminClient
    .from("negocios")
    .select("*")
    .eq("id", projeto.negocio_id)
    .maybeSingle();

  if (!negocio) return resp(404, { ok: false, erro: "negocio_nao_encontrado" });

  // ───── Próxima versão ─────
  const { data: ultimaVersao } = await adminClient
    .from("projetos_originacao")
    .select("versao")
    .eq("projeto_id", projeto_id)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proximaVersao = (ultimaVersao?.versao || 0) + 1;

  // ───── INSERT row inicial (status='gerando') ─────
  const inputs = {
    contexto_adicional,
    hipotese_comprador: hipotese_comprador || null,
    restricoes: restricoes || null,
    urgencia: urgencia || "normal",
    orcamento_midia_diario: orcamento_midia_diario ?? 50,
    canais_excluidos: canais_excluidos || [],
    foco_pj_pf: foco_pj_pf || "ambos",
  };

  const insertPayload: any = {
    projeto_id,
    versao: proximaVersao,
    status: "gerando",
    gerado_por_admin_id: admin.id,
    ...inputs,
  };

  const { data: origRow, error: errInsert } = await adminClient
    .from("projetos_originacao")
    .insert(insertPayload)
    .select()
    .maybeSingle();

  if (errInsert || !origRow) {
    return resp(500, { ok: false, erro: "erro_insert", detalhe: errInsert?.message });
  }

  // ───── Chama Claude API ─────
  const inicio = Date.now();
  const userPrompt = buildUserPrompt(negocio, inputs);

  try {
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      await adminClient
        .from("projetos_originacao")
        .update({ status: "erro", erro_msg: `Claude API ${claudeResp.status}: ${errTxt.slice(0, 500)}` })
        .eq("id", origRow.id);
      return resp(500, {
        ok: false,
        erro: "claude_api_falhou",
        detalhe: errTxt.slice(0, 500),
      });
    }

    const claudeData = await claudeResp.json();

    // Parse output · concatena text blocks
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const fullText = textBlocks.map((b: any) => b.text).join("");

    if (!fullText) {
      await adminClient
        .from("projetos_originacao")
        .update({ status: "erro", erro_msg: "Resposta IA vazia" })
        .eq("id", origRow.id);
      return resp(500, { ok: false, erro: "resposta_vazia" });
    }

    // Detecta web search
    const webSearchUsado = (claudeData.content || []).some(
      (b: any) => b.type === "tool_use" && b.name === "web_search"
    ) || (claudeData.content || []).some(
      (b: any) => b.type === "server_tool_use" && b.name === "web_search"
    );

    // Parse JSON
    let conteudo: any;
    try {
      const cleanText = fullText.replace(/```json|```/g, "").trim();
      conteudo = JSON.parse(cleanText);
    } catch (e: any) {
      await adminClient
        .from("projetos_originacao")
        .update({ status: "erro", erro_msg: `JSON parse falhou: ${e.message}` })
        .eq("id", origRow.id);
      return resp(500, {
        ok: false,
        erro: "json_parse_falhou",
        detalhe: fullText.slice(0, 500),
      });
    }

    const duracao = Date.now() - inicio;
    const usage = claudeData.usage || {};

    // UPDATE row com conteúdo
    const { error: errUpdate } = await adminClient
      .from("projetos_originacao")
      .update({
        status: "gerado",
        conteudo,
        web_search_usado: webSearchUsado,
        input_tokens: usage.input_tokens || null,
        output_tokens: usage.output_tokens || null,
        duracao_ms: duracao,
        updated_at: new Date().toISOString(),
      })
      .eq("id", origRow.id);

    if (errUpdate) {
      return resp(500, { ok: false, erro: "erro_update", detalhe: errUpdate.message });
    }

    // INSERT arquétipos extraídos
    if (Array.isArray(conteudo.arquetipos)) {
      const arquetiposInsert = conteudo.arquetipos.map((arq: any, idx: number) => ({
        originacao_id: origRow.id,
        projeto_id,
        nome: arq.nome || `Arquétipo ${idx + 1}`,
        vetor: arq.vetor || null,
        fit: arq.fit || null,
        perfil: arq.perfil || null,
        motivacao: arq.motivacao || null,
        capacidade_financeira: arq.capacidade_financeira || null,
        exemplos: arq.exemplos || null,
        ordem: idx,
      }));

      await adminClient.from("arquetipos_compradores").insert(arquetiposInsert);
    }

    return resp(200, {
      ok: true,
      originacao_id: origRow.id,
      versao: proximaVersao,
      conteudo,
      web_search_usado: webSearchUsado,
      duracao_ms: duracao,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      arquetipos_count: conteudo.arquetipos?.length || 0,
    });
  } catch (e: any) {
    await adminClient
      .from("projetos_originacao")
      .update({ status: "erro", erro_msg: `Exception: ${e.message}` })
      .eq("id", origRow.id);
    return resp(500, { ok: false, erro: "exception", detalhe: e.message });
  }
});
