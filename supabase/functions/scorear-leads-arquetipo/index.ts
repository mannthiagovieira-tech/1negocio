// scorear-leads-arquetipo · v9.33.5.2
// IA classifica leads de uma originação · 0-100 score + motivo + tags estruturadas.
// Batch de 15 leads por chamada Sonnet (~R$ 0,03) · paralelizado por arquétipo.
//
// v9.33.5.2 mudanças:
// - max_tokens 2000 → 4000 (folga pra JSON de 15 leads × ~150 tokens output)
// - BATCH_SIZE 20 → 15 (output cabe folgado · não trunca)
// - Retry automático 1x do batch (2s wait) antes de pular
// - Recuperação via regex match de array JSON parcial
// - Logs estruturados por batch · erro estruturado em por_arquetipo[].erros[]
//
// POST body: { originacao_id: uuid, arquetipo_id?: uuid, forcar?: boolean=false }
// Output: { ok, leads_scoreados, por_arquetipo[], custo_total_brl }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const BATCH_SIZE = 15;                 // v9.33.5.2 · era 20
const MAX_TOKENS = 4000;               // v9.33.5.2 · era 2000
const MAX_RETRY = 2;                   // v9.33.5.2 · 1ª tentativa + 1 retry
const RETRY_WAIT_MS = 2000;
const CUSTO_POR_BATCH_BRL = 0.03;

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

function compactarLead(l: any): any {
  const d = l.dados_brutos || {};
  return {
    id: l.id,
    nome: (l.nome || "").slice(0, 100),
    endereco: (d.address || "").slice(0, 120),
    categoria: (d.categoryName || d.category || "").slice(0, 60),
    website: (d.website || "").slice(0, 80),
    rating: d.totalScore ?? d.rating ?? null,
    reviews: d.reviewsCount ?? null,
    telefone: l.telefone ? "sim" : "nao",
  };
}

async function scorearBatch(
  arq: any,
  briefing: any,
  leadsBatch: any[],
  ctx: { batchIndex: number; totalBatches: number; tentativa: number },
): Promise<{ ok: boolean; resultados?: any[]; erro?: string; tokensIn?: number; tokensOut?: number; recuperado?: boolean }> {
  const negocio = briefing?.negocio || {};
  const tamanho = briefing?.tamanho || {};

  const systemPrompt = `Você é analista de M&A. Avalie a relevância de cada empresa abaixo pro ARQUÉTIPO DE COMPRADOR descrito · retornando score 0-100 e tags estruturadas.

ARQUÉTIPO:
- Nome: ${arq.nome || "(sem nome)"}
- Perfil: ${arq.perfil || "(sem perfil)"}
- Motivação pra comprar: ${arq.motivacao || "(sem motivação)"}
- Exemplos nominais: ${arq.exemplos || "(sem exemplos)"}
- Capacidade financeira: ${arq.capacidade_financeira || "(sem capacidade)"}

NEGÓCIO À VENDA (contexto):
- Setor: ${negocio.setor || "—"}
- Sub-setor: ${negocio.sub_setor || "—"}
- Cidade: ${negocio.cidade || "—"}${negocio.estado ? " · " + negocio.estado : ""}
- Valor de venda pedido: R$ ${tamanho.valor_venda_pedido || "(não informado)"}

EMPRESAS A AVALIAR (lista de ${leadsBatch.length}):
${JSON.stringify(leadsBatch.map(compactarLead), null, 2)}

PRA CADA EMPRESA, retorne:
- score: 0-100
  * 90-100: match perfeito · empresa-alvo ideal
  * 70-89: bom match · vale abordar
  * 50-69: match parcial · pode interessar
  * 30-49: improvável mas não impossível
  * 0-29: ruído · irrelevante
- motivo: 1 frase explicando o score (máx 100 chars)
- tags: array de strings curtas (max 5) classificando empresa
  * Setor: "bebidas", "alimentação", "varejo", "serviços", etc
  * Porte: "pequeno", "médio", "grande"
  * Localização: "mesma_cidade", "mesma_regiao", "fora_alvo"
  * Tipo: "concorrente", "fornecedor", "cliente", "adjacente", "investidor"

Retorne JSON array com EXATAMENTE ${leadsBatch.length} objetos · um por empresa · na MESMA ORDEM da lista de entrada · cada objeto: { "id": "<lead.id>", "score": <int>, "motivo": "<string>", "tags": ["<tag1>", "<tag2>"] }

NÃO escreva nada fora do JSON array.`;

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
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: "Scoreie agora · só JSON array." }],
      }),
    });
    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      return { ok: false, erro: `claude_status_${claudeResp.status} · ${errTxt.slice(0, 200)}` };
    }
    const claudeData = await claudeResp.json();
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const fullText = textBlocks.map((b: any) => b.text).join("");
    const tokensIn = claudeData?.usage?.input_tokens ?? 0;
    const tokensOut = claudeData?.usage?.output_tokens ?? 0;
    const stopReason = claudeData?.stop_reason || "";

    let parsed: any = null;
    let recuperado = false;
    try {
      const clean = fullText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch (e: any) {
      console.error(`[scorear] PARSE FAIL · arq="${arq.nome}" · batch ${ctx.batchIndex + 1}/${ctx.totalBatches} · tentativa ${ctx.tentativa} · stop_reason=${stopReason} · tokensOut=${tokensOut}`);
      console.error(`[scorear] raw (head 500):`, fullText.slice(0, 500));
      console.error(`[scorear] raw (tail 500):`, fullText.slice(-500));
      console.error(`[scorear] parseErr:`, e.message);
      // Recuperação · tenta extrair array via regex (greedy match · pega o último ])
      try {
        const arrayMatch = fullText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (arrayMatch) {
          parsed = JSON.parse(arrayMatch[0]);
          recuperado = true;
          console.log(`[scorear] RECUPERADO via regex · arq="${arq.nome}" · batch ${ctx.batchIndex + 1} · ${parsed.length} leads`);
        }
      } catch (_) {
        // recovery falhou · cai no return de erro
      }
      if (!parsed) {
        return {
          ok: false,
          erro: `json_parse_falhou · stop=${stopReason} · tokensOut=${tokensOut} · ${e.message} · raw_head: ${fullText.slice(0, 200)}`,
          tokensIn, tokensOut,
        };
      }
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, erro: "claude_retornou_nao_array · " + JSON.stringify(parsed).slice(0, 200), tokensIn, tokensOut };
    }
    return { ok: true, resultados: parsed, tokensIn, tokensOut, recuperado };
  } catch (e: any) {
    return { ok: false, erro: `exception · ${e.message}` };
  }
}

async function scorearArquetipo(
  adminClient: any,
  arq: any,
  briefing: any,
  leads: any[],
): Promise<{ arquetipo_id: string; nome: string; scoreados: number; batches: number; erros: any[] }> {
  const erros: any[] = [];
  let scoreados = 0;
  let batches = 0;
  const totalBatches = Math.ceil(leads.length / BATCH_SIZE);

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const batchIndex = batches;
    batches++;

    console.log(`[scorear] arq="${arq.nome}" · batch ${batchIndex + 1}/${totalBatches} · leads=${batch.length}`);

    // v9.33.5.2 · retry loop · 1ª tentativa + 1 retry (2s wait)
    let result: { ok: boolean; resultados?: any[]; erro?: string; tokensIn?: number; tokensOut?: number; recuperado?: boolean } | null = null;
    let tentativa = 0;
    while (tentativa < MAX_RETRY) {
      tentativa++;
      result = await scorearBatch(arq, briefing, batch, { batchIndex, totalBatches, tentativa });
      if (result.ok) break;
      console.error(`[scorear] arq="${arq.nome}" · batch ${batchIndex + 1} · tentativa ${tentativa} falhou: ${result.erro}`);
      if (tentativa < MAX_RETRY) {
        await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
      }
    }

    if (!result || !result.ok) {
      erros.push({
        batch: batchIndex + 1,
        leads_perdidos: batch.length,
        tentativas: tentativa,
        erro_final: result?.erro || "sem_resultado",
      });
      continue;
    }

    console.log(`[scorear] arq="${arq.nome}" · batch ${batchIndex + 1} → ${(result.resultados || []).length} scores · in=${result.tokensIn} · out=${result.tokensOut}${result.recuperado ? " · RECUPERADO" : ""}`);

    const resultados = result.resultados || [];
    const byId: Record<string, any> = {};
    for (const x of resultados) {
      if (x && x.id) byId[x.id] = x;
    }
    let inseridosBatch = 0;
    for (const lead of batch) {
      const res = byId[lead.id];
      if (!res) continue;
      const score = Math.max(0, Math.min(100, Number(res.score) || 0));
      const motivo = (res.motivo || "").toString().slice(0, 200);
      const tags = Array.isArray(res.tags) ? res.tags.map((t: any) => String(t).slice(0, 30)).slice(0, 5) : [];
      const { error: errUpd } = await adminClient
        .from("originacao_leads_brutos")
        .update({
          score_ia: score,
          razao_score: motivo,
          tags_ia: tags,
          updated_at: new Date().toISOString(),
        })
        .eq("id", lead.id);
      if (errUpd) {
        erros.push({ batch: batchIndex + 1, lead_id: lead.id, erro: `update_falhou · ${errUpd.message}` });
      } else {
        scoreados++;
        inseridosBatch++;
      }
    }
    if (inseridosBatch < batch.length) {
      console.warn(`[scorear] arq="${arq.nome}" · batch ${batchIndex + 1} · IA retornou ${resultados.length} scores · ${inseridosBatch}/${batch.length} aplicados (ids não bateram?)`);
    }
  }

  return { arquetipo_id: arq.id, nome: arq.nome || "(sem nome)", scoreados, batches, erros };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate admin canônico
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await adminClient
    .from("admins").select("id, ativo")
    .eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { originacao_id, arquetipo_id, forcar } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  try {
    // Busca originação + briefing
    const { data: orig, error: errOrig } = await adminClient
      .from("projetos_originacao").select("id, briefing_jsonb")
      .eq("id", originacao_id).maybeSingle();
    if (errOrig) return resp(500, { ok: false, erro: "fetch_orig_falhou", detalhe: errOrig.message });
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });

    // Busca arquétipos aprovados
    let arqQuery = adminClient
      .from("arquetipos_compradores")
      .select("id, nome, perfil, motivacao, exemplos, capacidade_financeira")
      .eq("originacao_id", originacao_id)
      .eq("status", "aprovado")
      .order("ordem", { ascending: true });
    if (arquetipo_id) arqQuery = arqQuery.eq("id", arquetipo_id);
    const { data: arquetipos, error: errArq } = await arqQuery;
    if (errArq) return resp(500, { ok: false, erro: "fetch_arquetipos_falhou", detalhe: errArq.message });
    if (!arquetipos || arquetipos.length === 0) return resp(400, { ok: false, erro: "nenhum_arquetipo_aprovado" });

    // Para cada arquétipo · busca seus leads (não-scoreados, ou todos se forcar)
    const porArquetipo: any[] = [];
    let totalScoreados = 0;
    let totalBatches = 0;

    for (const arq of arquetipos) {
      let leadsQuery = adminClient
        .from("originacao_leads_brutos")
        .select("id, nome, telefone, dados_brutos")
        .eq("originacao_id", originacao_id)
        .eq("arquetipo_id", arq.id);
      if (!forcar) leadsQuery = leadsQuery.is("score_ia", null);
      const { data: leads, error: errLeads } = await leadsQuery;
      if (errLeads) {
        porArquetipo.push({
          arquetipo_id: arq.id, nome: arq.nome, scoreados: 0, batches: 0,
          erros: [`fetch_leads_falhou · ${errLeads.message}`],
        });
        continue;
      }
      if (!leads || leads.length === 0) {
        porArquetipo.push({ arquetipo_id: arq.id, nome: arq.nome, scoreados: 0, batches: 0, erros: [] });
        continue;
      }
      const r = await scorearArquetipo(adminClient, arq, orig.briefing_jsonb, leads);
      porArquetipo.push(r);
      totalScoreados += r.scoreados;
      totalBatches += r.batches;
    }

    return resp(200, {
      ok: true,
      leads_scoreados: totalScoreados,
      por_arquetipo: porArquetipo,
      batches_total: totalBatches,
      custo_total_brl: +(totalBatches * CUSTO_POR_BATCH_BRL).toFixed(2),
    });
  } catch (e: any) {
    console.error("[scorear-leads] exception raiz", e);
    return resp(500, {
      ok: false,
      erro: "exception_raiz",
      erro_debug: e?.message || "sem mensagem",
      stack: e?.stack?.slice(0, 1000) || null,
    });
  }
});
