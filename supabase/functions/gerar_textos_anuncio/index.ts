// Edge Function: gerar_textos_anuncio
// Gera 7 textos focados em COMPRADOR (não em dono).
// 6 públicos (antes do NDA) + 1 pós-NDA (apresentacao_editorial).
// Cache em anuncios_v2.textos_negocio (jsonb).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const REGRAS_EDITORIAIS_GLOBAIS = `
REGRAS EDITORIAIS RÍGIDAS (aplicáveis a TODOS os textos):

PROIBIÇÕES ABSOLUTAS:
- Nome próprio (do dono OU do negócio)
- CNPJ, telefone, email, endereço completo
- Palavras: "vendo", "vende-se", "à venda", "a venda",
  "oportunidade", "oportunidade única", "passo ponto",
  "passa-se ponto", "empresa para venda", "negócio em venda"
- Adjetivos vazios: "incrível", "único", "espetacular",
  "imperdível", "fantástico", "maravilhoso"
- Clichês comerciais: "não perca", "última chance",
  "preço imperdível", "garanta já"

OBRIGATÓRIO:
- Tom: corretor de M&A profissional apresentando oportunidade
- Específico: ancorar em números reais do negócio
- Português brasileiro formal mas acessível
- Vocabulário técnico quando apropriado: "operação",
  "geração de caixa", "estrutura de capital"

FOCO NO LEITOR:
- Leitor é INVESTIDOR/COMPRADOR (não o dono do negócio)
- Não fale "seu negócio", fale "o negócio", "a operação"
- Não dê conselhos ao dono, apresente fatos ao leitor
`;

const PROMPTS: Record<string, { modelo: string; max_tokens: number; prompt: (calc: any) => string }> = {
  titulo_negocio: {
    modelo: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    prompt: (calc) => `${REGRAS_EDITORIAIS_GLOBAIS}

TAREFA: Gere UM título curto que descreva ESPECIFICAMENTE o tipo de negócio MAIS um atributo distintivo. Você está dando o "sobrenome" do negócio.

ESTRUTURA OBRIGATÓRIA: {Tipo do negócio} + {atributo distintivo}

DADOS DO NEGÓCIO:
- Setor: ${calc.identificacao?.setor?.label || ''}
- Subcategoria: ${calc.identificacao?.subcategoria || ''}
- Modelo: ${calc.identificacao?.modelo_negocio || ''}
- Tempo operação: ${calc.identificacao?.tempo_operacao_anos || 0} anos
- Marca registrada: ${calc.identificacao?.marca_inpi || false}
- Recorrência: ${calc.indicadores_vs_benchmark?.recorrencia?.valor || 0}%
- Concentração de cliente max: ${calc.indicadores_vs_benchmark?.concentracao?.valor || 0}%
- Localização: ${calc.identificacao?.localizacao?.cidade || ''}/${calc.identificacao?.localizacao?.estado || ''}
- Ticket médio: R$ ${calc.indicadores_vs_benchmark?.ticket_medio?.valor || 0}
- Equipe: ${calc.dre?.pessoal?.headcount_total ?? calc.equipe?.clt_qtd ?? 0} CLT, ${calc.equipe?.pj_qtd ?? 0} PJ
- Faturamento anual: R$ ${calc.dre?.fat_anual ?? calc.dre?.faturamento_anual ?? 0}

REGRA CRÍTICA — IDENTIFICAÇÃO DO TIPO:

1. Se subcategoria existe e é específica, USE-A:
   - "padaria" → escreva "Padaria" (não "Negócio de alimentação")
   - "odontologia" → escreva "Clínica odontológica"
   - "automotivo" → escreva "Oficina mecânica"
   - "pet" → escreva "Pet shop"
   - "vestuario" → escreva "Boutique" ou "Loja de roupas"
   - "limpeza" → escreva "Empresa de limpeza"

2. Só use o setor genérico se subcategoria estiver vazia/null.

3. NUNCA escreva "Negócio de [setor]" — use o tipo específico.
   ❌ "Negócio de alimentação"
   ✅ "Padaria"
   ✅ "Restaurante"
   ✅ "Lanchonete"

LÓGICA DE CONSTRUÇÃO:
1. Comece pelo TIPO DO NEGÓCIO (use subcategoria se houver, senão setor especificado)
2. Adicione UM atributo distintivo escolhido entre:
   - Combinação de operações ("padaria e restaurante", "loja e oficina")
   - Especialização do público ("de caminhões", "feminina", "infantil")
   - Característica geográfica ("no litoral", "no centro", "em condomínio")
   - Serviço adicional ("com banho e tosa", "com delivery próprio")
   - Posicionamento ("premium", "popular", "especializada")
   - Modelo B2B ("corporativa", "industrial", "para empresas")
   - Tempo/tradição ("tradicional", "histórica") - só se >10 anos

EXEMPLOS DESEJADOS:
✅ "Padaria e restaurante"
✅ "Oficina mecânica de caminhões"
✅ "Pousada no litoral"
✅ "Pet shop com banho e tosa"
✅ "Clínica de estética facial"
✅ "Boutique feminina premium"
✅ "Empresa de limpeza corporativa"
✅ "Restaurante popular tradicional"

EXEMPLOS RUINS (NÃO use estes formatos):
❌ "Restaurante de culinária caseira" (vago, sem distintivo claro)
❌ "Negócio de alimentação" (categoria pura)
❌ "Saude em São Paulo" (info já está no card)
❌ "Padaria artesanal" (falta atributo distintivo concreto)
❌ "Empresa consolidada de varejo" (genérico)

REGRAS:
- 3-7 palavras
- NÃO mencione cidade, estado, faturamento, faixa de valor
- NÃO use palavras proibidas (vendo, oportunidade, à venda, etc)
- O atributo deve ser CONCRETO, não adjetivo abstrato
- Se não tiver dados pra atributo distintivo, use só o tipo: "Padaria" (melhor que inventar atributo falso)

Responda APENAS o título, sem aspas, sem ponto final, sem comentários.`
  },

  descricao_publica: {
    modelo: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    prompt: (calc) => `${REGRAS_EDITORIAIS_GLOBAIS}

TAREFA: Escreva uma descrição curta para o hero da página do anúncio. Visível ao público (antes do NDA).

DADOS:
- Setor: ${calc.identificacao?.setor?.label}
- Tempo: ${calc.identificacao?.tempo_operacao_anos} anos
- Localização: ${calc.identificacao?.localizacao?.cidade}/${calc.identificacao?.localizacao?.estado}
- ISE total: ${calc.ise?.ise_total}/100
- Margem operacional: ${calc.dre?.margem_operacional_pct}%
- Recorrência: ${calc.indicadores_vs_benchmark?.recorrencia?.valor}%

REGRAS:
- 80-150 caracteres
- 1 frase única
- Tom: descrição editorial profissional
- Ancorar em dados reais quando possível

EXEMPLOS BONS:
- "Operação consolidada com 9 anos de presença local e base ativa de clientes recorrentes"
- "Negócio com geração de caixa estável e indicadores acima da média setorial"

Responda APENAS a descrição, sem aspas, sem comentários.`
  },

  diferenciais_competitivos: {
    modelo: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    prompt: (calc) => `${REGRAS_EDITORIAIS_GLOBAIS}

TAREFA: Liste 3-5 diferenciais competitivos do negócio.

DADOS RELEVANTES:
- ISE pilares fortes (>7): ${JSON.stringify((calc.ise?.pilares || []).filter((p: any) => (p.score_0_10 ?? p.nota ?? 0) >= 7).map((p: any) => p.label || p.id || p.nome))}
- Indicadores acima do benchmark: ${JSON.stringify(calc.indicadores_vs_benchmark)}
- Tempo operação: ${calc.identificacao?.tempo_operacao_anos} anos
- Marca registrada: ${calc.identificacao?.marca_inpi || false}
- Recorrência: ${calc.indicadores_vs_benchmark?.recorrencia?.valor}%

REGRAS:
- Cada bullet: frase declarativa curta (máx 20 palavras)
- Ancorar em NÚMERO sempre que possível
- Sem adjetivos vazios

EXEMPLOS BONS:
- "Margem operacional 23% acima da média do setor"
- "Equipe estável com tempo médio de casa de 4 anos"
- "75% da receita vem de clientes recorrentes"
- "Marca registrada no INPI"
- "Negócio operando há 9 anos consecutivos"

Responda APENAS os bullets, um por linha, começando com "- ".`
  },

  potencial_crescimento: {
    modelo: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    prompt: (calc) => `${REGRAS_EDITORIAIS_GLOBAIS}

TAREFA: Escreva 1 parágrafo sobre o potencial de crescimento do negócio, ancorado em upsides reais identificados.

UPSIDES IDENTIFICADOS:
${JSON.stringify((calc.upsides?.ativos || []).map((u: any) => ({ nome: u.label || u.nome || u.id, valor_anual: u.contribuicao_brl ?? u.valor_anual_estimado })))}

DADOS DE CONTEXTO:
- Setor: ${calc.identificacao?.setor?.label}
- Tamanho atual: R$ ${calc.dre?.fat_anual ?? calc.dre?.faturamento_anual}/ano

REGRAS:
- 50-100 palavras
- 1 parágrafo único
- Foque nos 2-3 upsides mais relevantes
- Mencione valores quando relevante
- Tom: análise técnica de potencial, não promessa

EXEMPLO BOM:
"O negócio apresenta capacidade ociosa de aproximadamente 25% nos turnos noturnos, sugerindo possibilidade de ampliação operacional sem CAPEX adicional. A análise tributária aponta oportunidade de migração de regime que pode gerar economia estimada de R$ 266 mil/ano. Adicionalmente, a baixa penetração em vendas digitais (atualmente 8% da receita) configura espaço de expansão num setor onde a média é de 22%."

Responda APENAS o parágrafo.`
  },

  perfil_comprador_ideal: {
    modelo: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    prompt: (calc) => `${REGRAS_EDITORIAIS_GLOBAIS}

TAREFA: Descreva em 2-3 frases o perfil de comprador ideal para este negócio.

DADOS:
- Setor: ${calc.identificacao?.setor?.label}
- Modelo: ${calc.identificacao?.modelo_negocio}
- Tamanho: R$ ${calc.dre?.fat_anual ?? calc.dre?.faturamento_anual}/ano
- Equipe CLT: ${calc.dre?.pessoal?.headcount_total ?? calc.equipe?.clt_qtd}
- Sócio-dependência (ISE): ${(calc.ise?.pilares || []).find((p: any) => (p.id || p.nome) === 'independencia' || (p.id || p.nome) === 'socio_dependencia')?.score_0_10 ?? 'n/d'}/10

REGRAS:
- 2-3 frases
- Tom: descritivo, não prescritivo
- Foco em PERFIL (experiência, capital, intenção), não em pessoas

EXEMPLO BOM:
"Empreendedor com experiência prévia no setor de serviços buscando consolidação geográfica ou expansão de portfólio. Capital de giro entre R$ 200-400 mil para suportar operação nos primeiros 12 meses. Disponibilidade para envolvimento operacional moderado nos primeiros 6 meses de transição."

Responda APENAS o texto.`
  },

  call_to_action: {
    modelo: "claude-haiku-4-5-20251001",
    max_tokens: 80,
    prompt: (_calc) => `${REGRAS_EDITORIAIS_GLOBAIS}

TAREFA: Escreva 1 frase curta de chamada para próxima ação. Aparece antes do botão "Solicitar Informações".

REGRAS:
- 1 frase única, máx 15 palavras
- Tom: convite profissional
- NÃO use "compre", "garanta", "não perca"
- Foque em PRÓXIMO PASSO (acessar material completo)

EXEMPLOS BONS:
- "Solicite o material completo e converse com nossa equipe."
- "Acesse a documentação detalhada e avalie a oportunidade."
- "Receba o dossiê completo após assinatura do termo de confidencialidade."

Responda APENAS a frase.`
  },

  apresentacao_editorial: {
    modelo: "claude-sonnet-4-5-20250929",
    max_tokens: 1500,
    prompt: (calc) => `${REGRAS_EDITORIAIS_GLOBAIS}

TAREFA: Escreva uma apresentação editorial completa do negócio. Este texto aparece SOMENTE para investidores que assinaram o NDA. É a peça central do material confidencial.

REGRAS ADICIONAIS DE FORMATAÇÃO E LINGUAGEM:

1. NÃO use markdown — sem #, ##, **, *, listas com -, ou qualquer formatação. Apenas texto corrido em parágrafos separados por linha em branco.

2. NÃO comece com título nem cabeçalho. Comece direto pelo primeiro parágrafo de apresentação.

3. DIVERSIFIQUE O VOCABULÁRIO. Alterne entre estes substitutos para "negócio":
   - operação (uso máximo: 4 vezes no texto inteiro)
   - empresa (uso máximo: 4 vezes)
   - estabelecimento (uso máximo: 3 vezes)
   - negócio (uso máximo: 3 vezes)
   - companhia (uso máximo: 2 vezes)

   Use também referências indiretas: "este caso", "a oferta", "o ativo em análise", "a oportunidade analisada".

4. Tom narrativo fluido. Cada parágrafo conecta ao anterior por transição natural (não por "Adicionalmente," ou "Por outro lado," — use estruturas mais sofisticadas).

5. Comece o texto com: "Trata-se de..." OU "Esta análise refere-se a..." OU "Apresentamos..." OU descrição direta sem fórmula.

CONTEXTO COMPLETO:
${JSON.stringify({
  identificacao: calc.identificacao,
  dre: calc.dre,
  balanco: calc.balanco_patrimonial ?? calc.balanco,
  ise: calc.ise,
  indicadores: calc.indicadores_vs_benchmark,
  upsides: calc.upsides?.ativos,
  equipe: calc.equipe ?? (calc.dre?.pessoal),
}, null, 2)}

ESTRUTURA OBRIGATÓRIA (4 parágrafos):

PARÁGRAFO 1 — APRESENTAÇÃO GERAL (~100 palavras):
- O que é o negócio (use o tipo, não o nome)
- Onde está localizado (cidade, NÃO endereço)
- Há quanto tempo opera
- Tamanho da operação (faturamento, equipe)

PARÁGRAFO 2 — POSICIONAMENTO E DIFERENCIAIS (~150 palavras):
- O que faz a operação se destacar
- Posição no mercado local/setorial
- Pontos fortes ancorados em ISE e indicadores

PARÁGRAFO 3 — ANÁLISE TÉCNICA (~200 palavras):
- Performance financeira: receita, margem, RO
- Indicadores principais comparados ao benchmark setorial
- Estrutura patrimonial (ativos relevantes, dívidas)
- Score ISE detalhado (pilares fortes/fracos)

PARÁGRAFO 4 — TESE DE VALOR E POTENCIAL (~150 palavras):
- Por que merece atenção do investidor
- Upsides identificados com potencial de valor
- Perfil de comprador que mais se beneficiaria
- Convite sutil para próxima etapa (sem CTA agressivo)

REGRAS RÍGIDAS:
- Total: 400-700 palavras
- Tom: corretor M&A sofisticado escrevendo Information Memorandum
- Ancorar TODA afirmação em dados específicos do JSON acima
- Vocabulário M&A profissional
- NUNCA: nome próprio, CNPJ, telefone, email, endereço
- EVITE: "incrível", "único", "imperdível", "oportunidade única"
- TERMINE com convite sutil ao próximo passo
- NÃO use markdown headers, bullets, asteriscos ou formatação especial
- Diversifique vocabulário (NÃO repita "operação" mais de 4 vezes)

Responda APENAS o texto editorial em 4 parágrafos separados por linha em branco. NÃO inclua título, cabeçalho ou qualquer formatação.`
  },
};

const TEXTOS_VALIDOS = Object.keys(PROMPTS);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validarAntiVazamento(texto: string, calc: any) {
  const palavrasProibidas = [
    "vendo", "vende-se", "à venda", "a venda", "oportunidade única",
    "passo ponto", "passa-se ponto", "empresa para venda", "negócio em venda",
  ];
  const textoLower = texto.toLowerCase();
  for (const p of palavrasProibidas) {
    if (textoLower.includes(p)) {
      return { ok: false, motivo: `Contém palavra proibida: "${p}"` };
    }
  }
  const cnpj = calc.identificacao?.cnpj || "";
  if (cnpj && texto.includes(cnpj)) {
    return { ok: false, motivo: "Contém CNPJ" };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const { anuncio_id, texto_a_gerar } = body;

    if (!anuncio_id || !texto_a_gerar) {
      return jsonResp({ ok: false, error: "anuncio_id e texto_a_gerar obrigatórios" }, 400);
    }
    if (!TEXTOS_VALIDOS.includes(texto_a_gerar)) {
      return jsonResp({ ok: false, error: "texto_a_gerar inválido. Aceitos: " + TEXTOS_VALIDOS.join(",") }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: anuncio } = await supabase
      .from("anuncios_v2")
      .select("id, codigo, laudo_v2_id, textos_negocio")
      .eq("id", anuncio_id)
      .single();

    if (!anuncio) {
      return jsonResp({ ok: false, error: "anúncio não encontrado" }, 404);
    }
    if (!anuncio.laudo_v2_id) {
      return jsonResp({ ok: false, error: "anúncio sem laudo v2 vinculado" }, 400);
    }

    const { data: laudo } = await supabase
      .from("laudos_v2")
      .select("calc_json")
      .eq("id", anuncio.laudo_v2_id)
      .single();

    if (!laudo || !laudo.calc_json) {
      return jsonResp({ ok: false, error: "laudo v2 sem calc_json" }, 400);
    }

    const calc = laudo.calc_json;
    const config = PROMPTS[texto_a_gerar];
    const promptFinal = config.prompt(calc);

    const startTs = Date.now();
    const respAnthropic = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.modelo,
        max_tokens: config.max_tokens,
        messages: [{ role: "user", content: promptFinal }],
      }),
    });

    if (!respAnthropic.ok) {
      const errBody = await respAnthropic.text();
      console.error("Anthropic API erro:", respAnthropic.status, errBody);
      return jsonResp({ ok: false, error: "Anthropic API erro: " + respAnthropic.status, body: errBody }, 500);
    }

    const dataAnthropic = await respAnthropic.json();
    const textoGerado = (dataAnthropic.content?.[0]?.text || "").trim();
    const duracaoMs = Date.now() - startTs;

    if (!textoGerado) {
      return jsonResp({ ok: false, error: "Resposta vazia da Anthropic" }, 500);
    }

    const validacao = validarAntiVazamento(textoGerado, calc);

    const novoTexto = {
      conteudo: textoGerado,
      modelo: config.modelo,
      tokens_in: dataAnthropic.usage?.input_tokens || 0,
      tokens_out: dataAnthropic.usage?.output_tokens || 0,
      duracao_ms: duracaoMs,
      gerado_em: new Date().toISOString(),
      validacao,
    };

    // RPC atomic — jsonb_set evita race entre chamadas paralelas
    const { error: updErr } = await supabase.rpc("atualizar_texto_anuncio", {
      p_anuncio_id: anuncio_id,
      p_chave: texto_a_gerar,
      p_valor: novoTexto,
    });

    if (updErr) {
      console.error("Erro ao salvar:", updErr);
      return jsonResp({ ok: false, error: "Erro ao salvar: " + updErr.message }, 500);
    }

    return jsonResp({ ok: true, texto_gerado: novoTexto, validacao });
  } catch (e) {
    console.error("Erro geral:", e);
    return jsonResp({ ok: false, error: String(e) }, 500);
  }
});
