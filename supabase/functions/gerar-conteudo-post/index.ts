// Edge Function: gerar-conteudo-post
// Gera 1 peça de conteúdo (texto + imagem) pra Instagram/LinkedIn
// a partir de um negócio publicado.
//
// Stack: Anthropic Sonnet 4 (texto) + opcional OpenAI DALL-E 3 (imagem).
// Persistência: tabela pecas_geradas (migration 20260503000000).
// Auth: verify_jwt = true.
//
// v2 · system prompt dinâmico (ângulo + tom + restrições)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FORMATOS = {
  "feed-insta":    { w: 1080, h: 1080, max_chars: 200,  label: "Feed Instagram (quadrado)" },
  "story-insta":   { w: 1080, h: 1920, max_chars: 100,  label: "Story Instagram (vertical)" },
  "post-linkedin": { w: 1200, h: 627,  max_chars: 1300, label: "Post LinkedIn (paisagem)" },
};

const TONS: Record<string, string> = {
  direto: `TOM · DIRETO
Números primeiro. Frases curtas. Sem floreio.
Exemplo de abertura: "R$ 2,4M de faturamento. 8 anos de operação. À venda."`,
  editorial: `TOM · EDITORIAL
Bloomberg. Contextual. Tom de jornalista de negócios.
Exemplo de abertura: "No setor de alimentação em Florianópolis, raros são os negócios que..."`,
  convidativo: `TOM · CONVIDATIVO
Pergunta no início ou no fim.
Exemplo de abertura: "Já pensou em entrar no setor de alimentação sem começar do zero?"`,
  provocativo: `TOM · PROVOCATIVO
Contraintuitivo. Quebra senso comum.
Exemplo de abertura: "Comprar empresa pronta dá menos prejuízo que abrir uma."`,
  pessoal: `TOM · PESSOAL
1ª pessoa do plural. Tom da equipe.
Exemplo de abertura: "Acabamos de aprovar mais um negócio na plataforma."`,
};

const ANGULOS: Record<string, string> = {
  oportunidade: `ÂNGULO · OPORTUNIDADE DE AQUISIÇÃO
Foco no comprador. Destaque a oportunidade de aquisição.
Argumentos: operação rodando · pronta pra entrar · poupa tempo de construir do zero · retorno mais rápido que abrir do zero.
Evite: detalhes financeiros sensíveis. Foque na lógica do investidor.`,

  momento_venda: `ÂNGULO · MOMENTO DE VENDA
Foco no vendedor. Valida a decisão de quem está vendendo.
Argumentos: ciclo natural do empreendedor · valor reconhecido · transição estruturada · sigilo do processo.
Tom respeitoso · NUNCA insinue que o dono está em apuros, em crise ou desesperado.`,

  setor_alta: `ÂNGULO · SETOR EM ALTA
Foco no setor da empresa. Contexto de mercado.
Argumentos: tendências do segmento · sinais positivos · oportunidade no momento certo.
Use 1 dado factual sobre o setor (sem inventar números). Se não souber dado preciso, use linguagem qualitativa ("aceleração", "consolidação").`,

  localizacao: `ÂNGULO · LOCALIZAÇÃO ESTRATÉGICA
Foco na cidade/região. Vantagem geográfica.
Argumentos: mercado local · poder de compra · concorrência · perfil populacional.
Use o que sabe da região (se cidade conhecida) ou contexto regional amplo.`,

  diferencial: `ÂNGULO · DIFERENCIAL OPERACIONAL
Foco em pontos operacionais fortes. Recorrência, margem saudável, gestão estruturada.
Argumentos: o que torna esse negócio melhor que a média.
Mencione 1-2 diferenciais (recorrência, anos de operação, processos) · sem números exatos a menos que pode_faturamento esteja liberado.`,

  historia: `ÂNGULO · HISTÓRIA DO NEGÓCIO
Foco no tempo de mercado e trajetória.
Argumentos: marca consolidada · resistência ao tempo · base de clientes formada · valor intangível.`,

  provocacao: `ÂNGULO · PROVOCAÇÃO
Faz uma pergunta provocadora pro leitor.
Argumentos: contradições do mercado · insights contraintuitivos · convite à reflexão.
A peça TERMINA com pergunta aberta. Engajamento como objetivo principal.`,

  curadoria: `ÂNGULO · CURADORIA 1NEGÓCIO
Foco no método da 1Negócio.
Argumentos: avaliação técnica · sigilo · curadoria humana · plataforma colaborativa.
Cita brevemente o negócio como exemplo do que a plataforma faz · não como protagonista da peça.`,

  surpresa: `ÂNGULO · SURPRESA
Você decide o ângulo mais forte considerando o perfil do negócio (setor, tempo, faturamento, ISE).
NÃO menciona "escolhi este ângulo" no texto · só executa.`,
};

type Restricoes = {
  pode_ise: boolean;
  pode_faturamento: boolean;
  pode_localizacao: boolean;
  pode_setor: boolean;
};

function buildSystemPrompt(opts: {
  angulo: string;
  tom: string;
  restricoes: Restricoes;
  formato: keyof typeof FORMATOS;
}): string {
  const F = FORMATOS[opts.formato];
  const r = opts.restricoes;
  const restrLinhas = [
    !r.pode_ise && "- NÃO mencione score de saúde, ISE, ou indicadores compostos.",
    !r.pode_faturamento && "- NÃO mencione faixa de faturamento ou números financeiros absolutos.",
    !r.pode_localizacao && "- NÃO mencione cidade ou estado · use só \"Brasil\" ou \"interior\".",
    !r.pode_setor && "- NÃO cite o setor específico · use linguagem genérica (\"empresa\", \"negócio\").",
  ].filter(Boolean).join("\n");
  const blocoRestr = restrLinhas
    ? `RESTRIÇÕES NESTA PEÇA:\n${restrLinhas}`
    : "RESTRIÇÕES NESTA PEÇA: nenhuma · pode usar todos os dados informados.";

  return `IDENTIDADE
Você é o gerador de conteúdo editorial da 1Negócio · plataforma colaborativa de compra e venda de empresas.
Tagline: "Quanto vale um negócio? Nós sabemos."

GLOSSÁRIO EDITORIAL · TERMOS VETADOS
Nunca use: M&A, DCF, WACC, valuation, EBITDA isolado, benchmark, ROI, TIR, VPL, equity, stake, cap table, earnout, due diligence, cashflow, deal, churn.

SUBSTITUIÇÕES OFICIAIS:
- M&A → "compra e venda de empresas"
- Valuation → "avaliação financeira"
- EBITDA → "lucro real da operação"
- Benchmark → "comparativo com mercado"
- Due diligence → "análise de risco"
- ROI → "retorno do investimento"
- Cashflow → "fluxo de caixa"
- Deal → "negócio" / "operação"
- Churn → "cancelamento de clientes"

SIGILO ABSOLUTO
- NUNCA use o nome real do negócio · NUNCA cite CNPJ, endereço, sócios, telefone, marca registrada.
- Use sempre o IDENTIFICADOR ANÔNIMO no formato "{Setor} · {Cidade}/{UF} · {Faixa de Faturamento}" passado no prompt do usuário.

POSICIONAMENTO 1NEGÓCIO
- Plataforma colaborativa de compra e venda de empresas (não é classificado · é mesa de negociação digital com laudo + curadoria).
- Tagline: "Quanto vale um negócio? Nós sabemos."

${ANGULOS[opts.angulo] || ANGULOS.surpresa}

${TONS[opts.tom] || TONS.direto}

${blocoRestr}

FORMATO ALVO: ${F.label}
- Dimensões: ${F.w}×${F.h}px
- Limite de texto principal: ${F.max_chars} caracteres (rígido)
- Hashtags: ${opts.formato === "story-insta" ? "3-5" : "5-8"}

OUTPUT: APENAS um JSON válido (sem markdown, sem backticks):
{
  "texto_principal": "string · respeitando limite de caracteres",
  "hashtags": ["#tag1", "#tag2", "..."],
  "dica_visual": "1 frase de elementos visuais sugeridos pra a peça"
}`;
}

function gerarIdentificadorAnonimo(setor_label: string, cidade: string, estado: string): string {
  const cidadeFmt = cidade ? cidade.split(" ")[0] : "Brasil";
  const estFmt = estado ? `/${estado}` : "";
  return `${setor_label} · ${cidadeFmt}${estFmt}`;
}

function faixaFat(v: number | null | undefined): string {
  if (!v) return "fat. não informado";
  if (v < 240000) return "até R$ 240k/ano";
  if (v < 600000) return "R$ 240k–600k/ano";
  if (v < 1200000) return "R$ 600k–1,2M/ano";
  if (v < 2400000) return "R$ 1,2M–2,4M/ano";
  if (v < 4800000) return "R$ 2,4M–4,8M/ano";
  return "acima de R$ 4,8M/ano";
}

function svgEditorial(opts: {
  formato: keyof typeof FORMATOS;
  identificador: string;
  ise: number | null;
  faixa_fat: string;
  texto: string;
  destaque?: string;
}): string {
  const F = FORMATOS[opts.formato];
  const w = F.w;
  const h = F.h;
  const isStory = opts.formato === "story-insta";
  const isLinkedin = opts.formato === "post-linkedin";
  const accent = "#3dff95";
  const ink = "#f4f7f4";
  const ink2 = "rgba(244,247,244,0.72)";
  const ink3 = "rgba(244,247,244,0.48)";
  const bg = "#0a0f0c";

  const fontDest = isStory ? 180 : isLinkedin ? 110 : 140;
  const padX = 80;
  const yEyebrow = isStory ? 220 : isLinkedin ? 120 : 200;
  const yDest = isStory ? 480 : isLinkedin ? 250 : 380;
  const yTexto = isStory ? 880 : isLinkedin ? 410 : 600;
  const yMeta = h - 200;

  const eyebrow = "1NEGÓCIO · COMPRA E VENDA DE EMPRESAS";
  const dest = opts.destaque || (opts.ise !== null ? `ISE ${opts.ise}` : opts.identificador.split("·")[0].trim());
  const linhaTexto = (opts.texto || "").slice(0, isStory ? 220 : isLinkedin ? 280 : 240);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <line x1="${padX}" y1="${yEyebrow + 30}" x2="${padX + 60}" y2="${yEyebrow + 30}" stroke="${accent}" stroke-width="2"/>
  <text x="${padX + 76}" y="${yEyebrow + 38}" fill="${accent}" font-family="ui-monospace, JetBrains Mono, monospace" font-size="18" letter-spacing="3">${eyebrow}</text>
  <text x="${padX}" y="${yDest}" fill="${ink}" font-family="Syne, ui-serif, serif" font-weight="800" font-size="${fontDest}" letter-spacing="-4">${escapeXml(dest)}</text>
  <text x="${padX}" y="${yDest + 80}" fill="${ink3}" font-family="ui-monospace, JetBrains Mono, monospace" font-size="22">${escapeXml(opts.identificador.toUpperCase())} · ${escapeXml(opts.faixa_fat.toUpperCase())}</text>
  <foreignObject x="${padX}" y="${yTexto}" width="${w - padX * 2}" height="${h - yTexto - 240}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:'Geist','Inter',sans-serif;color:${ink2};font-size:${isStory ? 36 : isLinkedin ? 24 : 32}px;line-height:1.5;letter-spacing:-0.01em">${escapeXml(linhaTexto)}</div>
  </foreignObject>
  <text x="${padX}" y="${yMeta}" fill="${ink3}" font-family="ui-monospace, JetBrains Mono, monospace" font-size="18">1NEGOCIO.COM.BR · QUANTO VALE UM NEGÓCIO? NÓS SABEMOS.</text>
</svg>`;
}

function escapeXml(s: string): string {
  return String(s || "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  } as Record<string, string>)[c]);
}

async function callAnthropic(systemPrompt: string, userPrompt: string, maxTokens = 800): Promise<{ texto: string; tokens: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const texto = data.content?.[0]?.text || "";
  const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
  return { texto, tokens };
}

async function gerarImagemDallE(promptVisual: string, formato: keyof typeof FORMATOS): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  const F = FORMATOS[formato];
  const sizeStr = F.w === F.h ? "1024x1024" : F.w > F.h ? "1792x1024" : "1024x1792";
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "dall-e-3", prompt: promptVisual, size: sizeStr, n: 1 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.url || null;
  } catch (e) {
    console.error("[dalle] erro:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      negocio_id,
      formato,
      tipo_imagem,
      tom,
      angulo: anguloIn = "surpresa",
      restricoes: restrIn = {},
    } = body;

    if (!negocio_id) return jsonErr("negocio_id obrigatório");
    if (!FORMATOS[formato as keyof typeof FORMATOS]) return jsonErr(`formato inválido: ${formato}`);
    if (!["html-svg", "dalle-3"].includes(tipo_imagem)) return jsonErr("tipo_imagem inválido");
    if (!TONS[tom]) return jsonErr(`tom inválido: ${tom}`);

    const angulo = ANGULOS[anguloIn] ? anguloIn : "surpresa";

    const restricoes: Restricoes = {
      pode_ise: restrIn.pode_ise !== false,
      pode_faturamento: restrIn.pode_faturamento !== false,
      pode_localizacao: restrIn.pode_localizacao !== false,
      pode_setor: restrIn.pode_setor !== false,
    };

    if (tipo_imagem === "dalle-3" && !OPENAI_API_KEY) {
      return jsonErr("OPENAI_API_KEY não configurada · use tipo_imagem='html-svg' ou configure o secret no Supabase");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: neg } = await supabase
      .from("negocios")
      .select("id, setor, categoria, cidade, estado, faturamento_anual, score_saude, anos_existencia, tempo_operacao_anos, ano_fundacao")
      .eq("id", negocio_id)
      .maybeSingle();

    if (!neg) return jsonErr("negocio não encontrado", 404);

    // Ângulo "historia" exige >=3 anos · senão cai pra "surpresa"
    let anguloEfetivo = angulo;
    let aviso: string | null = null;
    if (angulo === "historia") {
      const anos = neg.tempo_operacao_anos
        || neg.anos_existencia
        || (neg.ano_fundacao ? new Date().getFullYear() - neg.ano_fundacao : 0);
      if (anos < 3) {
        anguloEfetivo = "surpresa";
        aviso = "ângulo 'historia' indisponível pra negócios com menos de 3 anos · usado 'surpresa'";
      }
    }

    const { data: laudo } = await supabase
      .from("laudos_v2")
      .select("calc_json")
      .eq("negocio_id", negocio_id)
      .eq("ativo", true)
      .maybeSingle();

    const calc = laudo?.calc_json || {};
    const ise = calc.ise?.ise_total ?? neg.score_saude ?? null;
    const valor_venda = calc.valuation?.valor_venda ?? null;
    const margem_op = calc.dre?.margem_operacional_pct ?? null;
    const setor_label = calc.identificacao?.setor?.label || neg.setor || "Negócio";

    const cidadeUI = restricoes.pode_localizacao ? (neg.cidade || "—") : "Brasil";
    const estadoUI = restricoes.pode_localizacao ? (neg.estado || "—") : "—";
    const setorUI = restricoes.pode_setor ? setor_label : "Empresa";
    const identificador = gerarIdentificadorAnonimo(setorUI, cidadeUI, estadoUI);

    const F = FORMATOS[formato as keyof typeof FORMATOS];
    const systemPrompt = buildSystemPrompt({
      angulo: anguloEfetivo,
      tom,
      restricoes,
      formato: formato as keyof typeof FORMATOS,
    });

    const linhasUser: string[] = [
      `Gere 1 peça de conteúdo pra ${F.label} sobre o seguinte negócio anônimo:`,
      ``,
      `IDENTIFICADOR: ${identificador}`,
    ];
    if (restricoes.pode_setor) linhasUser.push(`SETOR: ${setor_label}`);
    if (restricoes.pode_localizacao) linhasUser.push(`LOCALIZAÇÃO: ${neg.cidade || "—"}/${neg.estado || "—"}`);
    if (restricoes.pode_faturamento) linhasUser.push(`FAIXA DE FATURAMENTO: ${faixaFat(neg.faturamento_anual)}`);
    if (restricoes.pode_ise) linhasUser.push(`ISE (saúde operacional 0-100): ${ise ?? "não informado"}`);
    if (restricoes.pode_faturamento && margem_op !== null) linhasUser.push(`MARGEM OPERACIONAL (%): ${margem_op}`);
    if (restricoes.pode_faturamento && valor_venda) linhasUser.push(`VALOR DE VENDA ESTIMADO (R$): ${Math.round(valor_venda).toLocaleString("pt-BR")}`);
    if (anguloEfetivo === "historia") {
      const anos = neg.tempo_operacao_anos || neg.anos_existencia || (neg.ano_fundacao ? new Date().getFullYear() - neg.ano_fundacao : null);
      if (anos) linhasUser.push(`TEMPO DE OPERAÇÃO (anos): ${anos}`);
    }
    linhasUser.push(``, `Devolva APENAS o JSON especificado no system prompt. Lembre-se das regras de sigilo, glossário, ângulo, tom e restrições.`);

    const promptUser = linhasUser.join("\n");

    const { texto: rawClaude, tokens } = await callAnthropic(systemPrompt, promptUser, 800);

    let parsed: { texto_principal: string; hashtags: string[]; dica_visual: string };
    try {
      const clean = rawClaude.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return jsonErr(`Anthropic retornou JSON inválido: ${rawClaude.slice(0, 200)}`);
    }

    let imagem_dados: string;
    let imagem_tipo: "svg" | "url" = "svg";
    if (tipo_imagem === "dalle-3") {
      const promptVisual = `${parsed.dica_visual}. Editorial style. Professional. Clean. Minimal text. Color palette: dark green (#0a0f0c) background with mint accent (#3dff95). Typography-focused composition. Bloomberg-style data visualization aesthetic.`;
      const url = await gerarImagemDallE(promptVisual, formato as keyof typeof FORMATOS);
      if (!url) {
        imagem_dados = svgEditorial({
          formato: formato as keyof typeof FORMATOS,
          identificador,
          ise: restricoes.pode_ise ? ise : null,
          faixa_fat: restricoes.pode_faturamento ? faixaFat(neg.faturamento_anual) : "—",
          texto: parsed.texto_principal,
        });
        imagem_tipo = "svg";
      } else {
        imagem_dados = url;
        imagem_tipo = "url";
      }
    } else {
      imagem_dados = svgEditorial({
        formato: formato as keyof typeof FORMATOS,
        identificador,
        ise: restricoes.pode_ise ? ise : null,
        faixa_fat: restricoes.pode_faturamento ? faixaFat(neg.faturamento_anual) : "—",
        texto: parsed.texto_principal,
      });
      imagem_tipo = "svg";
    }

    const { data: peca } = await supabase
      .from("pecas_geradas")
      .insert({
        negocio_id,
        formato,
        tipo_imagem,
        tom,
        texto_principal: parsed.texto_principal,
        hashtags: parsed.hashtags,
        imagem_dados,
        tokens_usados: tokens,
      })
      .select("id")
      .single();

    return jsonOk({
      ok: true,
      peca_id: peca?.id || null,
      angulo_usado: anguloEfetivo,
      aviso,
      texto_principal: parsed.texto_principal,
      hashtags: parsed.hashtags,
      dica_visual: parsed.dica_visual,
      imagem: { tipo: imagem_tipo, conteudo: imagem_dados },
      tokens_usados: tokens,
    });
  } catch (e) {
    console.error("[gerar-conteudo-post] erro:", e);
    return jsonErr(String((e as Error)?.message || e), 500);
  }
});

function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function jsonErr(erro: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, erro }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
