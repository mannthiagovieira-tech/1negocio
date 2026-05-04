// Edge Function: classificar-lead-olx
// Etapa B · Cowork · ATIVO
// Classifica leads OLX em 4 categorias via Claude Haiku 4.5 (barato).
// Atualiza leads_google.classificacao_ia + classificado_em.
//
// Endpoint:
//   POST /functions/v1/classificar-lead-olx
//   Body: { ids?: string[], all_pending?: boolean, limit?: number }
//
//   Default · classifica todos os pendentes (origem=olx · classificacao_ia IS NULL · limit 200)
//   Custom IDs · classifica só esses
//
// Resposta:
//   { ok, total_processados, classificados, erros, por_categoria, custo_estimado_brl }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-haiku-4-5-20251001";
const BATCH_PARALELO = 10; // 10 chamadas Anthropic em paralelo
const MAX_DEFAULT = 200;   // limite default por execução

// Custo aproximado Haiku 4.5 · ~200 input + ~60 output tokens por lead
// Input · $1/MTok · Output · $5/MTok
// Lead típico: 200×0.000001 + 60×0.000005 = 0.0005 USD ≈ R$ 0,0026
const CUSTO_BRL_POR_LEAD = 0.003;

const SYSTEM_PROMPT = `Você é um classificador especializado em identificar tipos de anúncios no OLX brasileiro pra plataforma 1Negócio (compra e venda de empresas).

Sua tarefa: ler o anúncio e classificar em UMA das 4 categorias:

1. negocio_funcionamento
   - Negócio operando · com clientes · com receita
   - Sinais: menciona faturamento · equipe · clientes · anos de operação
   - Inclui equipamentos · estoque · fornecedores · contratos
   - Palavras: 'operando' · 'lucrativo' · 'fluxo de caixa' · 'carteira'
   - Mantém base operacional na transferência

2. imovel_residencial
   - Casa · apartamento · terreno residencial
   - Sem operação comercial associada
   - Sinais: metragem · quartos · banheiros · IPTU
   - Foco em moradia

3. ponto_vazio
   - Ponto comercial vazio · sala comercial · loja sem operação
   - 'Pronto pra montar' · 'ideal pra abrir'
   - Sem clientes · sem equipe · sem operação atual
   - Foco em metragem comercial · localização · IPTU comercial

4. ambiguo
   - Não dá pra determinar com certeza
   - Informações incompletas
   - Pode ser tanto negócio quanto ponto vazio
   - Casos limítrofes · admin precisa revisar

REGRAS:
- Saída EXCLUSIVAMENTE em JSON: {"categoria":"...","motivo_breve":"..."}
- categoria: EXATAMENTE uma das 4 strings acima
- motivo_breve: 1 frase de até 100 caracteres
- Em dúvida entre negocio e ambiguo · prefere ambiguo
- Em dúvida entre imóvel e ponto_vazio · prefere ponto_vazio (mais conservador)
- "Vende-se imóvel comercial PRONTO PRA NEGÓCIO" = ponto_vazio (não tem operação)
- "Restaurante completo com clientes" = negocio_funcionamento

A 1Negócio é plataforma sobre EMPRESAS EM FUNCIONAMENTO.
'negocio_funcionamento' interessa pra abordagem direta.
'ambiguo' vai pra revisão manual.
'imovel_residencial' e 'ponto_vazio' são descarte automático.`;

const VALID_CATEGORIES = ["negocio_funcionamento", "imovel_residencial", "ponto_vazio", "ambiguo"];

interface Lead {
  id: string;
  nome: string | null;
  bio: string | null;
  cidade: string | null;
  categoria: string | null;
  tags: string[] | null;
}

interface ClassResult {
  id: string;
  categoria: string;
  motivo_breve: string;
  ok: boolean;
  erro?: string;
}

function montarPrompt(lead: Lead): string {
  const partes = [
    `TÍTULO: ${lead.nome || "(sem título)"}`,
    lead.bio ? `DESCRIÇÃO: ${lead.bio}` : null,
    lead.cidade ? `CIDADE: ${lead.cidade}` : null,
    lead.categoria ? `CATEGORIA OLX: ${lead.categoria}` : null,
    lead.tags && lead.tags.length ? `TAGS: ${lead.tags.join(", ")}` : null,
  ].filter(Boolean).join("\n");
  return `${partes}\n\nClassifique e devolva APENAS o JSON especificado.`;
}

async function classificarUm(lead: Lead): Promise<ClassResult> {
  try {
    const userPrompt = montarPrompt(lead);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { id: lead.id, categoria: "", motivo_breve: "", ok: false, erro: `Anthropic ${res.status}: ${txt.slice(0, 100)}` };
    }
    const data = await res.json();
    const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    let parsed: { categoria?: string; motivo_breve?: string };
    try { parsed = JSON.parse(raw); }
    catch { return { id: lead.id, categoria: "", motivo_breve: "", ok: false, erro: `JSON inválido: ${raw.slice(0, 80)}` }; }

    const cat = String(parsed.categoria || "").trim();
    if (!VALID_CATEGORIES.includes(cat)) {
      return { id: lead.id, categoria: "", motivo_breve: "", ok: false, erro: `categoria inválida: "${cat}"` };
    }
    return {
      id: lead.id,
      categoria: cat,
      motivo_breve: String(parsed.motivo_breve || "").slice(0, 200),
      ok: true,
    };
  } catch (e) {
    return { id: lead.id, categoria: "", motivo_breve: "", ok: false, erro: String((e as Error).message) };
  }
}

// Processa um array em lotes de N · espera cada lote terminar antes do próximo
async function processarLotes<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const lote = items.slice(i, i + batchSize);
    const res = await Promise.all(lote.map(fn));
    out.push(...res);
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const { ids, all_pending = true, limit = MAX_DEFAULT } = body || {};

    // 1. Carrega leads
    let leads: Lead[] = [];
    if (Array.isArray(ids) && ids.length) {
      const { data, error } = await supabase
        .from("leads_google")
        .select("id,nome,bio,cidade,categoria,tags")
        .in("id", ids);
      if (error) throw new Error("SELECT por ids falhou: " + error.message);
      leads = data || [];
    } else if (all_pending) {
      const { data, error } = await supabase
        .from("leads_google")
        .select("id,nome,bio,cidade,categoria,tags")
        .eq("origem", "olx")
        .is("classificacao_ia", null)
        .order("created_at", { ascending: false })
        .limit(Math.min(limit, 500));
      if (error) throw new Error("SELECT pendentes falhou: " + error.message);
      leads = data || [];
    }

    if (!leads.length) {
      return jsonOk({ ok: true, total_processados: 0, classificados: 0, erros: 0, por_categoria: {}, custo_estimado_brl: 0, mensagem: "Nenhum lead pendente." });
    }

    // 2. Classifica em paralelo (10 por vez)
    const resultados = await processarLotes(leads, BATCH_PARALELO, classificarUm);

    // 3. Atualiza banco · 1 PATCH por lead OK
    const okList = resultados.filter(r => r.ok);
    const erroList = resultados.filter(r => !r.ok);
    const agora = new Date().toISOString();

    await processarLotes(okList, BATCH_PARALELO, async (r) => {
      const { error } = await supabase
        .from("leads_google")
        .update({ classificacao_ia: r.categoria, classificado_em: agora, notas: r.motivo_breve ? `[IA] ${r.motivo_breve}` : null })
        .eq("id", r.id);
      if (error) console.warn("[update] falhou pra", r.id, error.message);
      return r;
    });

    // 4. Estatística
    const porCat: Record<string, number> = {};
    okList.forEach(r => { porCat[r.categoria] = (porCat[r.categoria] || 0) + 1; });

    return jsonOk({
      ok: true,
      total_processados: leads.length,
      classificados: okList.length,
      erros: erroList.length,
      por_categoria: porCat,
      custo_estimado_brl: Number((leads.length * CUSTO_BRL_POR_LEAD).toFixed(3)),
      modelo: MODEL,
      ...(erroList.length ? { erros_detalhe: erroList.slice(0, 5).map(e => ({ id: e.id, erro: e.erro })) } : {}),
    });
  } catch (e) {
    console.error("[classificar-lead-olx]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonErr(erro: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, erro }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
