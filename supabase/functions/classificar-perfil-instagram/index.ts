// Edge Function: classificar-perfil-instagram
// Etapa F3 · Cowork · ATIVO
//
// Classifica perfis Instagram em ig_seguidores_raw com Claude Haiku 4.5.
// Lê perfis WHERE classificacao_ia IS NULL (até `limit`, default 200, max 500).
// Roda Haiku em batches de 10 paralelos.
// Salva classificacao_ia em 1 das 4 categorias:
//   1. empresario_alvo  · dono de PME / negócio físico (alvo de venda)
//   2. investidor       · investe / compra empresas (alvo de compra)
//   3. profissional     · funcionário / autônomo / profissional liberal
//   4. descarte         · perfil pessoal / fake / inativo / criança / fora de target
//
// Custo · ~R$ 0.003/perfil · ~R$ 0.60 por batch de 200
//
// Endpoint:
//   POST /functions/v1/classificar-perfil-instagram
//   Body: { limit?: number, only_username?: string }

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
const VALID = ["empresario_alvo", "investidor", "profissional", "descarte"];
const BATCH_PARALLEL = 10;

const SYSTEM_PROMPT = `Você é classificador de perfis Instagram pra plataforma 1Negócio (compra e venda de empresas/PMEs).

Tarefa · ler nome + bio + flags (business, verified, seguidores) e classificar em UMA das 4 categorias:

1. empresario_alvo · dono de PME / negócio físico que pode QUERER VENDER a empresa
   Sinais · "CEO da X", "fundador", "sócio", "@minhaloja", restaurante, padaria, clínica, oficina, mercado, salão, escritório, "empreendedor", marca própria, e-commerce, conta business com bio mencionando produto/serviço

2. investidor · pessoa que INVESTE / COMPRA EMPRESAS
   Sinais · "investidor", "M&A", "private equity", "venture capital", "angel", "family office", "holding", "compro empresas", "consultor M&A"

3. profissional · funcionário CLT, autônomo, profissional liberal (advogado, médico, designer, dev, consultor) sem indicação de DONO de negócio
   Sinais · cargo em empresa de outro ("dev na X", "advogada"), profissão isolada sem marca/empresa própria

4. descarte · perfil pessoal sem viés business / fake / criança / atleta / influencer puro / fora de target Brasil
   Sinais · só fotos pessoais, sem bio profissional, conta privada sem business, perfil de fã, < 18 anos, gringo sem operação BR

REGRAS:
- Saída JSON ESTRITO: {"categoria":"...","motivo":"..."}
- "motivo" curto (max 120 chars), em PT-BR
- Em dúvida entre empresario_alvo e profissional · vai de profissional (regra do menor risco)
- Em dúvida entre profissional e descarte · vai de descarte (foco em qualidade)
- is_business=true + bio com produto/serviço · forte sinal pra empresario_alvo`;

interface Perfil {
  id: string;
  username: string;
  nome: string | null;
  bio: string | null;
  is_business: boolean | null;
  is_verified: boolean | null;
  seguidores: number | null;
  categoria: string | null;
}

async function classificar(p: Perfil): Promise<{ categoria: string; motivo: string }> {
  try {
    const prompt = `USERNAME: @${p.username}
NOME: ${p.nome || "—"}
BIO: ${p.bio || "—"}
BUSINESS: ${p.is_business ? "sim" : "não"}
VERIFICADO: ${p.is_verified ? "sim" : "não"}
SEGUIDORES: ${p.seguidores ?? "—"}
CATEGORIA IG: ${p.categoria || "—"}

Classifique e devolva APENAS o JSON.`;
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
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return { categoria: "descarte", motivo: `Anthropic ${res.status}` };
    const data = await res.json();
    const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return { categoria: "descarte", motivo: "JSON inválido" }; }
    const cat = String(parsed.categoria || "").trim();
    if (!VALID.includes(cat)) return { categoria: "descarte", motivo: "categoria inválida" };
    return { categoria: cat, motivo: String(parsed.motivo || "").slice(0, 200) };
  } catch (e) {
    return { categoria: "descarte", motivo: String((e as Error).message).slice(0, 100) };
  }
}

async function processarLotes<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const lote = items.slice(i, i + batchSize);
    out.push(...(await Promise.all(lote.map(fn))));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(parseInt(body?.limit) || 200, 1), 500);

    let q = supabase.from("ig_seguidores_raw")
      .select("id,username,nome,bio,is_business,is_verified,seguidores,categoria")
      .is("classificacao_ia", null)
      .limit(limit);
    if (body?.only_username) q = q.eq("username", body.only_username);

    const { data: perfis, error } = await q;
    if (error) return jsonErr("erro lendo perfis: " + error.message, 500);
    if (!perfis?.length) return jsonOk({ ok: true, classificados: 0, motivo: "nenhum perfil pendente" });

    const t0 = Date.now();
    const resultados = await processarLotes(perfis as Perfil[], BATCH_PARALLEL, async (p) => {
      const c = await classificar(p);
      await supabase.from("ig_seguidores_raw")
        .update({ classificacao_ia: c.categoria })
        .eq("id", p.id);
      return { id: p.id, username: p.username, categoria: c.categoria, motivo: c.motivo };
    });

    const porCategoria: Record<string, number> = {};
    resultados.forEach(r => { porCategoria[r.categoria] = (porCategoria[r.categoria] || 0) + 1; });

    return jsonOk({
      ok: true,
      classificados: resultados.length,
      duracao_ms: Date.now() - t0,
      por_categoria: porCategoria,
      custo_estimado_brl: Number((resultados.length * 0.003).toFixed(2)),
      proximo_passo: "POST /functions/v1/cowork-distribuir-instagram-diario pra distribuir empresario_alvo no plano",
    });
  } catch (e) {
    console.error("[classificar-perfil-instagram]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonErr(e: string, s = 400) { return new Response(JSON.stringify({ ok: false, erro: e }), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
