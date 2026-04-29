// Edge Function: gerar_textos_laudo
// Gera UM texto de IA por chamada (genérica, paralelizável no cliente)
// Spec rev3 §12.6 — Sub-passo 4.3

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIMEOUT_MS = 30000;
const MAX_TENTATIVAS = 3;
const BACKOFF_INICIAL_MS = 2000;

const PRECO_USD = {
  "claude-haiku-4-5-20251001": { input: 0.0000008, output: 0.000004 },
  "claude-sonnet-4-5":          { input: 0.000003,  output: 0.000015 },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResp({ ok: false, erro: "Método não permitido", fase: "validacao" }, 405);
  }

  const inicio = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let negocio_id = "";
  let texto_a_gerar = "";

  try {
    const body = await req.json();
    negocio_id = body.negocio_id;
    texto_a_gerar = body.texto_a_gerar;

    if (!negocio_id || !texto_a_gerar) {
      return jsonResp({ ok: false, erro: "negocio_id e texto_a_gerar são obrigatórios", fase: "validacao" }, 400);
    }

    // 2. Ler calc_json
    const { data: laudo, error: errLaudo } = await supabase
      .from("laudos_v2")
      .select("calc_json")
      .eq("negocio_id", negocio_id)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    if (errLaudo || !laudo) {
      return jsonResp({ ok: false, erro: "Laudo ativo não encontrado", fase: "leitura_calc_json" }, 404);
    }
    const calc = laudo.calc_json;

    // 3. Ler snapshot ativo de prompts
    const { data: param, error: errParam } = await supabase
      .from("parametros_versoes")
      .select("snapshot")
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();

    if (errParam || !param) {
      return jsonResp({ ok: false, erro: "Snapshot ativo não encontrado", fase: "leitura_prompt" }, 404);
    }

    const promptsCfg = param.snapshot?.prompts_textos_ia;
    if (!promptsCfg) {
      return jsonResp({ ok: false, erro: "prompts_textos_ia ausente no snapshot", fase: "leitura_prompt" }, 400);
    }

    const promptCfg = promptsCfg.laudo?.[texto_a_gerar] ?? promptsCfg.anuncio?.[texto_a_gerar];
    if (!promptCfg) {
      return jsonResp({ ok: false, erro: `Prompt '${texto_a_gerar}' não encontrado`, fase: "leitura_prompt" }, 400);
    }

    const systemPrompt = promptsCfg.system_prompt_compartilhado ?? "";
    const modelo = promptCfg.modelo;

    // 4-9. Caso especial: descricoes_polidas_upsides → loop por upside ativo
    if (texto_a_gerar === "descricoes_polidas_upsides") {
      const upsidesAtivos = calc?.upsides?.ativos ?? [];
      const resultados: { id: string; texto: string }[] = [];
      let totalIn = 0, totalOut = 0;

      for (const ups of upsidesAtivos) {
        const dadosUps = {
          categoria: ups.categoria ?? "não informado",
          titulo: ups.label ?? ups.titulo ?? "não informado",
          descricao_curta: ups.descricao ?? ups.descricao_curta ?? "não informado",
          contribuicao_brl_fmt: typeof ups.contribuicao_brl === "number"
            ? formatBRL(ups.contribuicao_brl) : "não informado",
          complexidade: ups.complexidade ?? "não informado",
        };
        const promptFinal = preencherPlaceholders(promptCfg.prompt, dadosUps);
        const resp = await chamarAnthropicComRetry(modelo, systemPrompt, promptFinal);
        resultados.push({ id: ups.id ?? ups.label ?? `upside_${resultados.length}`, texto: resp.texto });
        totalIn += resp.tokens_input;
        totalOut += resp.tokens_output;
      }

      await salvarTexto(supabase, negocio_id, texto_a_gerar, resultados);

      const duracao = Date.now() - inicio;
      const custo = calcularCusto(modelo, totalIn, totalOut);
      await logar(supabase, {
        negocio_id, contexto: texto_a_gerar, texto_gerado: JSON.stringify(resultados),
        status: "sucesso", modelo, tokens_input: totalIn, tokens_output: totalOut,
        custo_estimado: custo, duracao_ms: duracao,
      });

      return jsonResp({
        ok: true,
        texto_gerado: resultados,
        modelo_usado: modelo,
        tokens_input: totalIn,
        tokens_output: totalOut,
        duracao_ms: duracao,
      });
    }

    // Caso normal: 1 chamada
    const dados = formatarDadosCalc(calc);
    const promptFinal = preencherPlaceholders(promptCfg.prompt, dados);
    const resp = await chamarAnthropicComRetry(modelo, systemPrompt, promptFinal);

    let textoSalvar: any = resp.texto;

    // Caso especial: sugestoes_titulo_anuncio → parsear array
    if (texto_a_gerar === "sugestoes_titulo_anuncio") {
      const limpo = resp.texto
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
      try {
        const parsed = JSON.parse(limpo);
        if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
          textoSalvar = parsed;
        } else {
          console.warn("[sugestoes_titulo_anuncio] formato inválido, salvando string crua");
        }
      } catch (e) {
        console.warn("[sugestoes_titulo_anuncio] JSON.parse falhou, salvando string crua:", e);
      }
    }

    await salvarTexto(supabase, negocio_id, texto_a_gerar, textoSalvar);

    const duracao = Date.now() - inicio;
    const custo = calcularCusto(modelo, resp.tokens_input, resp.tokens_output);
    await logar(supabase, {
      negocio_id, contexto: texto_a_gerar, texto_gerado: typeof textoSalvar === "string" ? textoSalvar : JSON.stringify(textoSalvar),
      status: "sucesso", modelo, tokens_input: resp.tokens_input, tokens_output: resp.tokens_output,
      custo_estimado: custo, duracao_ms: duracao,
    });

    return jsonResp({
      ok: true,
      texto_gerado: textoSalvar,
      modelo_usado: modelo,
      tokens_input: resp.tokens_input,
      tokens_output: resp.tokens_output,
      duracao_ms: duracao,
    });

  } catch (err) {
    const duracao = Date.now() - inicio;
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await logar(supabase, {
        negocio_id, contexto: texto_a_gerar, texto_gerado: null,
        status: "erro", modelo: null, tokens_input: null, tokens_output: null,
        custo_estimado: null, duracao_ms: duracao, erro_mensagem: msg,
      });
    } catch (_) { /* swallow log error */ }
    return jsonResp({ ok: false, erro: msg, fase: "exception" }, 500);
  }
});

// ===== HELPERS =====

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatBRL(valor: number | null | undefined): string {
  const v = typeof valor === "number" ? valor : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v).replace("R$", "").trim();
}

function preencherPlaceholders(template: string, dados: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = dados[key];
    if (v === undefined || v === null || v === "") return "não informado";
    return String(v);
  });
}

function pilarLabel(chave: string): string {
  const labels: Record<string, string> = {
    P1: "rentabilidade", P2: "estabilidade", P3: "comercial",
    P4: "operacional",   P5: "governanca",   P6: "estrategico",
  };
  return labels[chave] ?? chave;
}

function atrSetorLabel(score: number): string {
  if (score >= 8) return "alta";
  if (score >= 6) return "média-alta";
  if (score >= 4) return "média";
  return "baixa";
}

function formatarDadosCalc(calc: any): Record<string, string | number> {
  const ident = calc?.identificacao ?? {};
  const dre = calc?.dre ?? {};
  const bal = calc?.balanco ?? {};
  const val = calc?.valuation ?? {};
  const ise = calc?.ise ?? {};
  const atr = calc?.atratividade ?? {};
  const indBench = calc?.indicadores_vs_benchmark ?? {};
  const op = calc?.operacional ?? {};
  const trib = calc?.analise_tributaria ?? {};

  // Pilares ISE
  const pilares = ise?.pilares ?? {};
  const pilaresEntries = Object.entries(pilares) as [string, any][];
  let destaque = "";
  let maiorNota = -Infinity;
  const pilaresFortes: string[] = [];
  const pilaresAtencao: string[] = [];
  for (const [k, v] of pilaresEntries) {
    const nota = typeof v?.nota === "number" ? v.nota : (typeof v === "number" ? v : null);
    if (nota === null) continue;
    if (nota > maiorNota) { maiorNota = nota; destaque = pilarLabel(k); }
    if (nota > 8) pilaresFortes.push(pilarLabel(k));
    if (nota < 6) pilaresAtencao.push(pilarLabel(k));
  }

  // Indicadores vs benchmark
  const indEntries = Object.entries(indBench) as [string, any][];
  const indAcima: string[] = [];
  const indAbaixo: string[] = [];
  let indDestaque = "";
  for (const [k, v] of indEntries) {
    if (v?.acima_media === true) {
      indAcima.push(k);
      if (!indDestaque) indDestaque = k;
    } else if (v?.acima_media === false) {
      indAbaixo.push(k);
    }
  }

  const scoreSetor = typeof atr?.score_setor === "number" ? atr.score_setor : 0;

  return {
    tipo_negocio_breve: ident.tipo_negocio_breve ?? "",
    setor_label: ident.setor?.label ?? "",
    cidade: ident.cidade ?? "",
    estado: ident.estado ?? "",
    tempo_operacao_anos: ident.tempo_operacao_anos ?? "",
    num_funcs_total: ident.num_funcs_total ?? "",
    modelo_atuacao_label: ident.modelo_atuacao_label ?? "",
    fat_anual_fmt: formatBRL(dre.fat_anual),
    ro_anual_fmt: formatBRL(dre.ro_anual),
    margem_pct: typeof dre.margem_pct === "number" ? dre.margem_pct.toFixed(1) : "",
    pl_fmt: formatBRL(bal.pl),
    valor_venda_fmt: formatBRL(val.valor_venda),
    fator_final: typeof val.fator_final === "number" ? val.fator_final.toFixed(1) : "",
    ise_total: typeof ise.total === "number" ? ise.total.toFixed(0) : "",
    ise_class: ise.class ?? "",
    ise_pilar_destaque: destaque,
    score_setor: scoreSetor,
    score_localizacao: typeof atr?.score_localizacao === "number" ? atr.score_localizacao : "",
    atr_setor_label: atrSetorLabel(scoreSetor),
    indicador_destaque_benchmark: indDestaque || "—",
    pilares_atencao: pilaresAtencao.join(", ") || "nenhum",
    pilares_fortes: pilaresFortes.join(", ") || "nenhum",
    indicadores_acima_benchmark: indAcima.join(", ") || "nenhum",
    indicadores_abaixo_benchmark: indAbaixo.join(", ") || "nenhum",
    marca_inpi: bal.marca_inpi === true ? "sim" : "não",
    dep_socio: op.dep_socio ?? "não informado",
    analise_tributaria_resumo: trib.resumo ?? "não informado",
    fat_anual_faixa: faixaFaturamento(dre.fat_anual),
    preco_pedido_fmt: formatBRL(val.preco_pedido),
    diferenca_pct: typeof val.diferenca_pct === "number" ? Math.abs(val.diferenca_pct).toFixed(0) : "",
    acima_ou_abaixo: typeof val.diferenca_pct === "number" ? (val.diferenca_pct >= 0 ? "acima" : "abaixo") : "—",
  };
}

function faixaFaturamento(v: number | undefined | null): string {
  if (typeof v !== "number") return "não informado";
  if (v < 500_000) return "até R$ 500 mil";
  if (v < 1_000_000) return "R$ 500 mil a R$ 1 milhão";
  if (v < 5_000_000) return "R$ 1 a R$ 5 milhões";
  if (v < 10_000_000) return "R$ 5 a R$ 10 milhões";
  return "acima de R$ 10 milhões";
}

async function chamarAnthropicComRetry(
  modelo: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ texto: string; tokens_input: number; tokens_output: number }> {
  let ultimoErro: unknown = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      if (resp.status === 429 || resp.status >= 500) {
        const txtErro = await resp.text();
        ultimoErro = new Error(`Anthropic ${resp.status}: ${txtErro}`);
        if (tentativa < MAX_TENTATIVAS) {
          const espera = BACKOFF_INICIAL_MS * Math.pow(2, tentativa - 1);
          await new Promise(r => setTimeout(r, espera));
          continue;
        }
        throw ultimoErro;
      }

      if (!resp.ok) {
        const txtErro = await resp.text();
        throw new Error(`Anthropic ${resp.status}: ${txtErro}`);
      }

      const data = await resp.json();
      const texto = data?.content?.[0]?.text ?? "";
      const tokens_input = data?.usage?.input_tokens ?? 0;
      const tokens_output = data?.usage?.output_tokens ?? 0;
      return { texto, tokens_input, tokens_output };

    } catch (err) {
      clearTimeout(timer);
      ultimoErro = err;
      if (tentativa < MAX_TENTATIVAS && (err instanceof Error && err.name === "AbortError")) {
        const espera = BACKOFF_INICIAL_MS * Math.pow(2, tentativa - 1);
        await new Promise(r => setTimeout(r, espera));
        continue;
      }
      if (tentativa >= MAX_TENTATIVAS) throw err;
    }
  }

  throw ultimoErro ?? new Error("Falha desconhecida na chamada Anthropic");
}

function calcularCusto(modelo: string, tokensIn: number, tokensOut: number): number {
  const preco = PRECO_USD[modelo as keyof typeof PRECO_USD];
  if (!preco) return 0;
  return tokensIn * preco.input + tokensOut * preco.output;
}

async function salvarTexto(
  supabase: ReturnType<typeof createClient>,
  negocio_id: string,
  chave: string,
  valor: unknown,
) {
  const { data: cur, error: errR } = await supabase
    .from("laudos_v2")
    .select("calc_json, id")
    .eq("negocio_id", negocio_id)
    .eq("ativo", true)
    .limit(1)
    .maybeSingle();
  if (errR || !cur) throw new Error(`salvarTexto: laudo ativo não encontrado: ${errR?.message ?? ""}`);

  const novoCalc = { ...((cur.calc_json as Record<string, unknown>) ?? {}) };
  const textosAtuais = (novoCalc.textos_ia as Record<string, unknown>) ?? {};
  novoCalc.textos_ia = { ...textosAtuais, [chave]: valor };

  const { error: errU } = await supabase
    .from("laudos_v2")
    .update({ calc_json: novoCalc })
    .eq("id", cur.id);
  if (errU) throw new Error(`salvarTexto update: ${errU.message}`);
}

async function logar(
  supabase: ReturnType<typeof createClient>,
  payload: {
    negocio_id: string;
    contexto: string;
    texto_gerado: string | null;
    status: "iniciado" | "sucesso" | "erro" | "timeout";
    modelo: string | null;
    tokens_input: number | null;
    tokens_output: number | null;
    custo_estimado: number | null;
    duracao_ms: number;
    erro_mensagem?: string;
  },
) {
  await supabase.from("logs_edge_functions").insert({
    function_name: "gerar_textos_laudo",
    negocio_id: payload.negocio_id || null,
    contexto: payload.contexto,
    texto_gerado: payload.texto_gerado,
    status: payload.status,
    modelo_usado: payload.modelo,
    tokens_input: payload.tokens_input,
    tokens_output: payload.tokens_output,
    custo_estimado: payload.custo_estimado,
    erro_mensagem: payload.erro_mensagem ?? null,
    duracao_ms: payload.duracao_ms,
  });
}
