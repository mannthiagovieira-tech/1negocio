// gerar-lista-semanal · v9.34.1 · Sprint 2 · Motor V3
// Agrega leads do pool com score>=70 status='novo' · gera mensagem WhatsApp via Claude
// · separa por categoria (compradores · corretores · eventos · influenciadores)
// · grava lista_semanal_jsonb em projetos_originacao.
//
// POST body: { originacao_id: uuid, score_min?: number=70, limite?: number=50 }
// Output: { ok, lista, custo_anthropic_brl_estimado }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const BATCH_MSG = 10;
const CUSTO_POR_BATCH_BRL = 0.05;

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

function categorizar(lead: any): string {
  const cat = (lead.categoria_setorial || "").toLowerCase();
  if (cat === "corretor_local") return "corretores";
  if (cat === "evento_setor") return "eventos";
  if (cat === "influenciador") return "influenciadores";
  if (cat === "grupo_setorial") return "grupos";
  return "compradores";
}

function semanaAtual(): string {
  const hoje = new Date();
  const dia = hoje.getDay();
  const seg = new Date(hoje);
  seg.setDate(hoje.getDate() - ((dia + 6) % 7));
  const dom = new Date(seg);
  dom.setDate(seg.getDate() + 6);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][d.getMonth()]}`;
  return `${fmt(seg)}–${fmt(dom)}`;
}

async function gerarMensagensBatch(briefing: any, leads: any[]): Promise<{ ok: boolean; mensagens?: Record<string, string>; erro?: string; custo?: number }> {
  const negocio = briefing?.negocio || {};
  const tamanho = briefing?.tamanho || {};
  const briefingResumo = `Setor: ${negocio.setor || "?"} / ${negocio.sub_setor || "?"} · Cidade: ${negocio.cidade || "?"}/${negocio.estado || "?"} · Valor pedido: R$ ${tamanho.valor_venda_pedido || "?"}`;

  const leadsCompactos = leads.map(l => ({
    id: l.uso_id,
    nome: (l.nome || "").slice(0, 80),
    arquetipo: l.arquetipo_nome || "",
    categoria: l.categoria_setorial || "",
    cidade: l.cidade || "",
    score_motivo: (l.score_motivo || "").slice(0, 120),
    canal: l.canal_origem || l.canal || "",
  }));

  const systemPrompt = `Você é especialista em abordagem comercial M&A pra PMEs brasileiras.

NEGÓCIO À VENDA · contexto: ${briefingResumo}

Pra CADA lead abaixo · gere UMA mensagem de WhatsApp curta de abordagem em português brasileiro.

DIRETRIZES:
- Tom: direto · não-vendedor · respeitoso · primeira pessoa
- Máximo 3 parágrafos (cada parágrafo 1-2 frases)
- Mencione algo ESPECÍFICO do perfil do lead que justifique o contato (use o arquétipo · canal de origem · cidade)
- NÃO use "olá" genérico · personalize
- Termine com 1 pergunta aberta de interesse (não venda)

LEADS:
${JSON.stringify(leadsCompactos, null, 2)}

Retorne EXCLUSIVAMENTE este JSON · sem texto extra:
{ "mensagens": { "<id>": "texto da mensagem", "<id>": "texto..." } }`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content: "Gere as mensagens agora · só JSON válido." }],
      }),
    });
    if (!r.ok) {
      const errTxt = await r.text();
      return { ok: false, erro: `claude_status_${r.status} · ${errTxt.slice(0, 200)}` };
    }
    const data = await r.json();
    const textBlocks = (data.content || []).filter((b: any) => b.type === "text");
    const fullText = textBlocks.map((b: any) => b.text).join("");
    let parsed: any = null;
    try {
      const clean = fullText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      const m = fullText.match(/\{[\s\S]*"mensagens"[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }
    if (!parsed || !parsed.mensagens || typeof parsed.mensagens !== "object") {
      return { ok: false, erro: `json_parse_falhou · raw: ${fullText.slice(0, 200)}` };
    }
    return { ok: true, mensagens: parsed.mensagens, custo: CUSTO_POR_BATCH_BRL };
  } catch (e: any) {
    return { ok: false, erro: `exception · ${e.message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

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
  const { originacao_id, score_min, limite } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  const scoreMin = Math.max(0, Math.min(100, Number(score_min) || 70));
  const limiteN = Math.max(1, Math.min(200, Number(limite) || 50));

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao").select("id, briefing_jsonb, gasto_anthropic_mes")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });

    // Busca leads top-score · status novo · com arquétipo
    const { data: leadsRaw, error: errLeads } = await adminClient
      .from("pool_leads_originacao")
      .select("id, nome, telefone, email, cidade, categoria_setorial, dados_brutos, score_ia, score_motivo, canal, arquetipo_id")
      .eq("originacao_id", originacao_id)
      .gte("score_ia", scoreMin)
      .eq("status", "novo")
      .order("score_ia", { ascending: false })
      .limit(limiteN);
    if (errLeads) return resp(500, { ok: false, erro: "fetch_leads_falhou", detalhe: errLeads.message });

    const leads = leadsRaw || [];
    if (leads.length === 0) {
      return resp(200, {
        ok: true,
        lista: {
          gerada_em: new Date().toISOString(),
          semana: semanaAtual(),
          score_min: scoreMin,
          compradores: [], corretores: [], eventos: [], influenciadores: [], grupos: [],
          total: 0,
        },
        custo_anthropic_brl_estimado: 0,
        aviso: "Nenhum lead com score >= " + scoreMin + " e status='novo'",
      });
    }

    // Anexa arquetipo_nome + tipo
    const arqIds = [...new Set(leads.map(l => l.arquetipo_id).filter(Boolean))];
    let arqMap: Record<string, any> = {};
    if (arqIds.length > 0) {
      const { data: arqs } = await adminClient
        .from("arquetipos_compradores")
        .select("id, nome, tipo")
        .in("id", arqIds);
      for (const a of arqs || []) arqMap[a.id] = a;
    }
    for (const l of leads) {
      const a = arqMap[l.arquetipo_id] || {};
      (l as any).arquetipo_nome = a.nome || "—";
      (l as any).arquetipo_tipo = a.tipo || null;
      (l as any).uso_id = l.id;
      (l as any).canal_origem = l.canal;
    }

    // Gera mensagens em batches de 10
    const mensagensMap: Record<string, string> = {};
    let custoTotal = 0;
    const errosBatch: any[] = [];
    for (let i = 0; i < leads.length; i += BATCH_MSG) {
      const batch = leads.slice(i, i + BATCH_MSG);
      const r = await gerarMensagensBatch(orig.briefing_jsonb, batch);
      if (!r.ok) {
        errosBatch.push({ batch_idx: Math.floor(i / BATCH_MSG), erro: r.erro });
        continue;
      }
      custoTotal += r.custo || 0;
      for (const id of Object.keys(r.mensagens || {})) {
        mensagensMap[id] = String(r.mensagens![id] || "").slice(0, 1500);
      }
    }

    // Categoriza e monta lista
    const lista: any = {
      gerada_em: new Date().toISOString(),
      semana: semanaAtual(),
      score_min: scoreMin,
      compradores: [],
      corretores: [],
      eventos: [],
      influenciadores: [],
      grupos: [],
      total: leads.length,
    };

    for (const l of leads) {
      const item: any = {
        uso_id: l.id,
        nome: l.nome,
        telefone: l.telefone || null,
        email: l.email || null,
        cidade: l.cidade || null,
        arquetipo_nome: (l as any).arquetipo_nome,
        arquetipo_tipo: (l as any).arquetipo_tipo,
        score: l.score_ia,
        score_motivo: l.score_motivo,
        canal_origem: l.canal,
        categoria_setorial: l.categoria_setorial,
        mensagem_sugerida: mensagensMap[l.id] || null,
      };
      // Campos extras pra eventos
      if (categorizar(l) === "eventos") {
        const d = l.dados_brutos || {};
        item.data_evento = d.data || d.data_evento || d.start_date || null;
        item.local = d.local || d.endereco_completo || null;
        item.url = d.url || d.public_url || d.website || null;
        item.quem_deve_ir = d.quem_deve_ir || null;
      }
      const cat = categorizar(l);
      if (lista[cat]) lista[cat].push(item);
    }

    // Salva no GTM
    const { error: errUpd } = await adminClient
      .from("projetos_originacao")
      .update({
        lista_semanal_jsonb: lista,
        lista_gerada_em: new Date().toISOString(),
        gasto_anthropic_mes: Number(orig.gasto_anthropic_mes || 0) + custoTotal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", originacao_id);
    if (errUpd) return resp(500, { ok: false, erro: "update_lista_falhou", detalhe: errUpd.message });

    return resp(200, {
      ok: true,
      lista,
      custo_anthropic_brl_estimado: +custoTotal.toFixed(2),
      erros_batch: errosBatch,
    });
  } catch (e: any) {
    console.error("[gerar-lista-semanal] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
