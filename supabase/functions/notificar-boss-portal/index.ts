// notificar-boss-portal · v1.0.0
// Recebe Supabase Database Webhooks e dispara WhatsApp pro Boss
// Payload esperado: { type: "INSERT"|"UPDATE"|"DELETE", table, schema, record, old_record }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZAPI_URL = Deno.env.get("ZAPI_URL") || "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") || "";
const BOSS_PHONE = Deno.env.get("BOSS_PHONE") || "5548999279320";

if (!ZAPI_URL) console.error("[notificar-boss-portal][boot] ZAPI_URL ausente");
if (!ZAPI_CLIENT_TOKEN) console.error("[notificar-boss-portal][boot] ZAPI_CLIENT_TOKEN ausente");

const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

async function enviarZApi(message: string): Promise<boolean> {
  if (!ZAPI_URL) return false;
  try {
    const r = await fetch(`${ZAPI_URL}/send-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify({ phone: BOSS_PHONE, message }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error(`[notificar-boss-portal][zapi] FALHA HTTP ${r.status}: ${txt.slice(0, 300)}`);
      return false;
    }
    const data = await r.json();
    if (data?.error || data?.value === false) {
      console.error(`[notificar-boss-portal][zapi] 200 mas com erro no body: ${JSON.stringify(data).slice(0, 300)}`);
      return false;
    }
    console.log(`[notificar-boss-portal][zapi] OK · msgId=${data?.messageId || data?.id || "?"}`);
    return true;
  } catch (e) {
    console.error("[notificar-boss-portal][zapi] exception", e);
    return false;
  }
}

function brl(v: any): string {
  const n = Number(v);
  if (!n || !isFinite(n)) return "—";
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPhone(raw: any): string {
  const s = String(raw || "").replace(/\D/g, "");
  return s || "—";
}

async function buscarVendedor(vendedor_id: string | null): Promise<{ nome?: string; whatsapp?: string } | null> {
  if (!vendedor_id) return null;
  const { data } = await sb.from("usuarios").select("nome,whatsapp").eq("id", vendedor_id).maybeSingle();
  return data || null;
}
async function buscarNegocio(negocio_id: string | null): Promise<{ nome?: string; codigo?: string } | null> {
  if (!negocio_id) return null;
  const { data } = await sb.from("negocios").select("nome,codigo,nome_negocio,titulo_anuncio").eq("id", negocio_id).maybeSingle();
  if (!data) return null;
  return { nome: data.nome || data.nome_negocio || data.titulo_anuncio || data.codigo, codigo: data.codigo };
}

async function montarMensagem(
  table: string,
  type: string,
  record: any,
  oldRecord: any,
): Promise<string | null> {
  // ─── negocios · INSERT em status inicial ───────────────────────
  if (table === "negocios" && type === "INSERT") {
    if (!["em_avaliacao", "rascunho", "aguardando_aprovacao"].includes(record.status)) return null;
    // Pula se foi o próprio Hermes que criou (ele já chama notificar_boss no fluxo)
    if (record.origem === "hermes") {
      console.log("[notificar-boss-portal] negocios INSERT · origem=hermes · pulando (já notificado)");
      return null;
    }
    const vendedor = await buscarVendedor(record.vendedor_id);
    const local = [record.cidade, record.estado].filter(Boolean).join("/");
    const fatMensal = Number(record.fat_mensal) || (Number(record.fat_anual) / 12) || 0;
    const nome = record.nome || record.nome_negocio || record.titulo_anuncio || record.codigo_diagnostico || "(sem nome)";
    return [
      "Novo diagnóstico",
      `Negócio: ${nome}`,
      `Setor: ${record.categoria || record.setor || "—"}`,
      `Cidade: ${local || "—"}`,
      `Faturamento: ${brl(fatMensal)}/mês`,
      `Vendedor: ${vendedor?.nome || "(sem nome)"} · ${fmtPhone(vendedor?.whatsapp)}`,
    ].join("\n");
  }

  // ─── solicitacoes_info · INSERT ─────────────────────────────────
  if (table === "solicitacoes_info" && type === "INSERT") {
    const neg = await buscarNegocio(record.negocio_id);
    return [
      "Nova solicitação de info",
      `Negócio: ${neg?.nome || neg?.codigo || "(?)"}`,
      `Solicitante: ${record.nome_solicitante || "(sem nome)"} · ${fmtPhone(record.whatsapp_solicitante)}`,
      record.mensagem ? `Mensagem: ${String(record.mensagem).slice(0, 140)}` : null,
    ].filter(Boolean).join("\n");
  }

  // ─── solicitacoes_assessorado · INSERT ──────────────────────────
  if (table === "solicitacoes_assessorado" && type === "INSERT") {
    return [
      "Nova solicitação assessorado",
      `Cliente: ${record.nome_solicitante || "(sem nome)"} · ${fmtPhone(record.telefone)}`,
      record.nome_negocio ? `Negócio: ${record.nome_negocio}` : null,
      record.mensagem_livre ? `Msg: ${String(record.mensagem_livre).slice(0, 140)}` : null,
    ].filter(Boolean).join("\n");
  }

  // ─── admin_agenda · INSERT tipo=assessorado ─────────────────────
  if (table === "admin_agenda" && type === "INSERT" && record.tipo === "assessorado") {
    const neg = await buscarNegocio(record.negocio_id);
    return [
      "Nova solicitação assessorado",
      `Cliente: ${record.nome_cliente || "(sem nome)"} · ${fmtPhone(record.whatsapp_cliente)}`,
      neg ? `Negócio: ${neg.nome || neg.codigo}` : null,
    ].filter(Boolean).join("\n");
  }

  // ─── admin_agenda · pagamento_status transicionou pra 'pago' ────
  if (table === "admin_agenda") {
    const eraPago = oldRecord?.pagamento_status === "pago";
    const agoraPago = record?.pagamento_status === "pago";
    const transicaoInsertPago = type === "INSERT" && agoraPago;
    const transicaoUpdatePago = type === "UPDATE" && agoraPago && !eraPago;
    if (transicaoInsertPago || transicaoUpdatePago) {
      return [
        "Pagamento confirmado",
        `Cliente: ${record.nome_cliente || "(sem nome)"} · ${fmtPhone(record.whatsapp_cliente)}`,
        `Produto: ${record.tipo || "—"}`,
        `Valor: ${brl(record.pagamento_valor)}`,
      ].join("\n");
    }
  }

  // ─── teses_investimento · INSERT ────────────────────────────────
  if (table === "teses_investimento" && type === "INSERT") {
    // Pula se foi o Hermes que criou (db_criar_tese já chama notificar_boss)
    if (record.origem === "hermes") {
      console.log("[notificar-boss-portal] teses_investimento INSERT · origem=hermes · pulando");
      return null;
    }
    const setores = Array.isArray(record.setores) ? record.setores.join(", ") : (record.setores || "—");
    const local = [record.cidade, record.estado].filter(Boolean).join("/");
    const valor = record.valor_investimento
      ? `até ${record.valor_investimento}`
      : (record.valor_alvo ? `até ${brl(record.valor_alvo)}` : "não informado");
    return [
      "Nova tese comprador",
      `${record.nome || "(sem nome)"} · ${fmtPhone(record.whatsapp)}`,
      `Setores: ${setores}`,
      `Região: ${local || "—"}`,
      `Investimento: ${valor}`,
    ].join("\n");
  }

  return null;
}

Deno.serve(async (req: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, erro: "method_not_allowed" }), { status: 405, headers: cors });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: true, ignorado: "json_invalido" }), { headers: cors }); }

  const { type, table, record, old_record: oldRecord } = body || {};
  if (!table || !type || !record) {
    console.log("[notificar-boss-portal] payload incompleto", JSON.stringify(body).slice(0, 200));
    return new Response(JSON.stringify({ ok: true, ignorado: "payload_incompleto" }), { headers: cors });
  }

  try {
    const msg = await montarMensagem(table, type, record, oldRecord);
    if (!msg) {
      console.log(`[notificar-boss-portal] ${table} ${type} · ignorado (filtro de origem ou não-aplicável)`);
      return new Response(JSON.stringify({ ok: true, ignorado: "filtro" }), { headers: cors });
    }
    const enviado = await enviarZApi(msg);
    console.log(`[notificar-boss-portal] ${table} ${type} · enviado=${enviado}`);
    return new Response(JSON.stringify({ ok: enviado, table, type }), { headers: cors });
  } catch (e: any) {
    console.error("[notificar-boss-portal] erro", e);
    return new Response(JSON.stringify({ ok: false, erro: e?.message || String(e) }), { status: 500, headers: cors });
  }
});
