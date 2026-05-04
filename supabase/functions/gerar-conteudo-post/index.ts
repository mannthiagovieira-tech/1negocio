// Edge Function: gerar-conteudo-post
// Gera 1 peça de conteúdo (texto + imagem) pra Instagram/LinkedIn
// a partir de um negócio publicado.
//
// Stack: Anthropic Sonnet 4 (texto + sugestão visual) + opcional OpenAI DALL-E 3 (imagem).
// Persistência: tabela pecas_geradas (migration 20260503000000).
// Auth: verify_jwt = true (igual ao chat-ia).
//
// Sigilo: nunca usa nome real do negócio · usa identificador anônimo.
// Glossário editorial: "compra e venda de empresas" não M&A · "avaliação financeira" não DCF.

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

const TONS = {
  direto:       "Direto e objetivo. Sem floreios. Frase curta. Vai pro ponto. Não termina com pergunta.",
  editorial:    "Editorial e contextual. Tom Bloomberg-like. Números primeiro, narrativa depois. Profissional mas legível.",
  convidativo:  "Convidativo e consultivo. Termina com uma pergunta aberta que provoca reflexão do leitor.",
};

const SYSTEM_PROMPT = `Você é o gerador de conteúdo editorial da 1Negócio · plataforma colaborativa de compra e venda de empresas.

REGRAS DE SIGILO ABSOLUTAS:
- NUNCA use o nome real do negócio.
- Use identificador anônimo: "{tipo} · {região}" (ex: "Padaria · Grande Florianópolis", "Clínica odonto · Rio Sul").
- NUNCA cite CNPJ, endereço, sócios, telefone, marca registrada.

GLOSSÁRIO EDITORIAL (substituições obrigatórias):
- M&A → "compra e venda de empresas"
- DCF / Valuation → "avaliação financeira"
- Margem → "quanto sobra de cada R$ 100"
- Benchmark → "comparativo com mercado"
- ROI → "retorno do investimento"
- EBITDA → "lucro real da operação"
- Due diligence → "análise de risco"
- Cashflow → "fluxo de caixa"
- Deal → "negócio" / "operação"

POSICIONAMENTO 1NEGÓCIO:
- "Plataforma colaborativa de compra e venda de empresas"
- Tagline: "Quanto vale um negócio? Nós sabemos."
- Não é classificado · é mesa de negociação digital com laudo + curadoria humana.

FORMATO BLOOMBERG-EDITORIAL:
- Números primeiro · contexto depois.
- Frases curtas, dados ancorados, sem adjetivos vazios.
- Sem hashtags genéricas tipo #empreendedorismo · prefira específicas.

OUTPUT: APENAS um JSON válido (sem markdown, sem backticks):
{
  "texto_principal": "...",
  "hashtags": ["#tag1", "#tag2", ...],
  "dica_visual": "Descrição em 1 frase de elementos visuais sugeridos pra a peça (números grandes, cores, ícones, etc)"
}`;

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
  const isSquare = opts.formato === "feed-insta";
  const isStory = opts.formato === "story-insta";
  const isLinkedin = opts.formato === "post-linkedin";
  const accent = "#3dff95";
  const ink = "#f4f7f4";
  const ink2 = "rgba(244,247,244,0.72)";
  const ink3 = "rgba(244,247,244,0.48)";
  const bg = "#0a0f0c";

  // Posições adaptáveis por formato
  const fontDest = isStory ? 180 : isLinkedin ? 110 : 140;
  const padX = isStory ? 80 : isLinkedin ? 80 : 80;
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
  <text x="${padX}" y="${yDest}" fill="${ink}" font-family="Syne, ui-serif, serif" font-weight="800" font-size="${fontDest}" letter-spacing="-4">${dest}</text>
  <text x="${padX}" y="${yDest + 80}" fill="${ink3}" font-family="ui-monospace, JetBrains Mono, monospace" font-size="22">${opts.identificador.toUpperCase()} · ${opts.faixa_fat.toUpperCase()}</text>
  <foreignObject x="${padX}" y="${yTexto}" width="${w - padX * 2}" height="${h - yTexto - 240}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:'Geist','Inter',sans-serif;color:${ink2};font-size:${isStory ? 36 : isLinkedin ? 24 : 32}px;line-height:1.5;letter-spacing:-0.01em">${escapeXml(linhaTexto)}</div>
  </foreignObject>
  <text x="${padX}" y="${yMeta}" fill="${ink3}" font-family="ui-monospace, JetBrains Mono, monospace" font-size="18">1NEGOCIO.COM.BR · QUANTO VALE UM NEGÓCIO? NÓS SABEMOS.</text>
</svg>`;
}

function escapeXml(s: string): string {
  return String(s || "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  } as Record<string,string>)[c]);
}

async function callAnthropic(prompt: string, maxTokens = 800): Promise<{texto: string; tokens: number}> {
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
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
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
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: promptVisual,
        size: sizeStr,
        n: 1,
      }),
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
    const { negocio_id, formato, tipo_imagem, tom } = body;

    if (!negocio_id) return jsonErr("negocio_id obrigatório");
    if (!FORMATOS[formato as keyof typeof FORMATOS]) return jsonErr(`formato inválido: ${formato}`);
    if (!["html-svg","dalle-3"].includes(tipo_imagem)) return jsonErr("tipo_imagem inválido");
    if (!TONS[tom as keyof typeof TONS]) return jsonErr("tom inválido");

    if (tipo_imagem === "dalle-3" && !OPENAI_API_KEY) {
      return jsonErr("OPENAI_API_KEY não configurada · use tipo_imagem='html-svg' ou configure o secret no Supabase");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Busca dados do negócio + laudo ativo
    const { data: neg } = await supabase
      .from("negocios")
      .select("id, setor, categoria, cidade, estado, faturamento_anual, score_saude")
      .eq("id", negocio_id)
      .maybeSingle();

    if (!neg) return jsonErr("negocio não encontrado", 404);

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
    const identificador = gerarIdentificadorAnonimo(setor_label, neg.cidade, neg.estado);

    // 2. Chama Anthropic pra gerar texto+hashtags
    const F = FORMATOS[formato as keyof typeof FORMATOS];
    const tomDescricao = TONS[tom as keyof typeof TONS];
    const promptUser = `Gere 1 peça de conteúdo pra ${F.label} sobre o seguinte negócio anônimo:

IDENTIFICADOR: ${identificador}
SETOR: ${setor_label}
LOCALIZAÇÃO: ${neg.cidade || "—"}/${neg.estado || "—"}
FAIXA DE FATURAMENTO: ${faixaFat(neg.faturamento_anual)}
ISE (saúde operacional 0-100): ${ise ?? "não informado"}
MARGEM OPERACIONAL (%): ${margem_op ?? "não informado"}
VALOR DE VENDA ESTIMADO (R$): ${valor_venda ? Math.round(valor_venda).toLocaleString("pt-BR") : "não informado"}

LIMITE DE TEXTO PRINCIPAL: ${F.max_chars} caracteres
TOM: ${tomDescricao}

Pra peça de ${F.label}, devolva JSON com texto_principal, hashtags (5-10) e dica_visual. Lembre-se das regras de sigilo.`;

    const { texto: rawClaude, tokens } = await callAnthropic(promptUser, 800);

    // Parse JSON do Claude
    let parsed: { texto_principal: string; hashtags: string[]; dica_visual: string };
    try {
      const clean = rawClaude.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return jsonErr(`Anthropic retornou JSON inválido: ${rawClaude.slice(0, 200)}`);
    }

    // 3. Gera imagem
    let imagem_dados: string;
    let imagem_tipo: "svg" | "url" = "svg";
    if (tipo_imagem === "dalle-3") {
      const promptVisual = `${parsed.dica_visual}. Editorial style. Professional. Clean. Minimal text. Color palette: dark green (#0a0f0c) background with mint accent (#3dff95). Typography-focused composition. Bloomberg-style data visualization aesthetic.`;
      const url = await gerarImagemDallE(promptVisual, formato as keyof typeof FORMATOS);
      if (!url) {
        // Fallback pra SVG
        imagem_dados = svgEditorial({
          formato: formato as keyof typeof FORMATOS,
          identificador, ise,
          faixa_fat: faixaFat(neg.faturamento_anual),
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
        identificador, ise,
        faixa_fat: faixaFat(neg.faturamento_anual),
        texto: parsed.texto_principal,
      });
      imagem_tipo = "svg";
    }

    // 4. Persiste em pecas_geradas
    const { data: peca } = await supabase
      .from("pecas_geradas")
      .insert({
        negocio_id,
        formato, tipo_imagem, tom,
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
      texto_principal: parsed.texto_principal,
      hashtags: parsed.hashtags,
      dica_visual: parsed.dica_visual,
      imagem: { tipo: imagem_tipo, conteudo: imagem_dados },
      tokens_usados: tokens,
    });
  } catch (e) {
    console.error("[gerar-conteudo-post] erro:", e);
    return jsonErr(String(e?.message || e), 500);
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
