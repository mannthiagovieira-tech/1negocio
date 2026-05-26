// HERMES v4 · cron · v1.0.0
// Acionado por pg_cron via pg_net.http_post
// jobs: relatorio (08h BRT) · followup (6h) · apify_poll (1h)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZAPI_URL = Deno.env.get("ZAPI_URL") || "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") || "";
const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN") || "";
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";

if (!ZAPI_URL) console.warn("[hermes-cron] ZAPI_URL ausente — relatório/followup não chegará ao WhatsApp");
if (!ZAPI_CLIENT_TOKEN) console.warn("[hermes-cron] ZAPI_CLIENT_TOKEN ausente — Z-API vai rejeitar as chamadas");
if (!APIFY_TOKEN) console.warn("[hermes-cron] APIFY_API_TOKEN ausente — apify_poll vai pular");
if (!META_TOKEN) console.warn("[hermes-cron] META_ACCESS_TOKEN ausente — relatório sem dados de Meta Ads");

const BOSS_PHONE = "5548999279320";
const AD_ACCOUNT_ID = "act_983335024007752";
const GRAPH = "https://graph.facebook.com/v23.0";

const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

// ─── Z-API ────────────────────────────────────────────────────────────
async function enviarWhatsApp(phone: string, mensagem: string): Promise<boolean> {
  if (!ZAPI_URL) return false;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ZAPI_CLIENT_TOKEN) headers["Client-Token"] = ZAPI_CLIENT_TOKEN;
    const r = await fetch(`${ZAPI_URL}/send-text`, {
      method: "POST", headers,
      body: JSON.stringify({ phone, message: mensagem }),
    });
    return r.ok;
  } catch (e) { console.error("[hermes-cron] z-api", e); return false; }
}

function fmtBRL(v: number) {
  return "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(v: number) {
  return (Number(v) || 0).toLocaleString("pt-BR");
}

// ─── JOB 1 · Relatório diário 08h BRT ─────────────────────────────────
async function gerarEnviarRelatorio() {
  const ontemIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const ontemDia = new Date(Date.now() - 24 * 3600 * 1000);
  const labelData = ontemDia.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const labelDia = ontemDia.toLocaleDateString("pt-BR", { weekday: "long" });

  // 1) Leads novos (usuarios criados nas últimas 24h)
  const { data: leadsRow, count: leadsCount } = await sb.from("usuarios")
    .select("tipo", { count: "exact" }).gte("created_at", ontemIso);
  const vendedores = (leadsRow || []).filter((r: any) => r.tipo === "sell").length;
  const compradores = (leadsRow || []).filter((r: any) => r.tipo === "buy").length;

  // 1b) Total de usuários na base
  const { count: totalUsuarios } = await sb.from("usuarios").select("id", { count: "exact", head: true });

  // 2) Negócios por status
  const { data: negPubl } = await sb.from("negocios").select("id", { count: "exact" }).eq("status", "publicado");
  const { data: negAval } = await sb.from("negocios").select("id", { count: "exact" }).eq("status", "em_avaliacao");
  const { data: negNego } = await sb.from("negocios").select("id", { count: "exact" }).eq("status", "em_negociacao");

  // 3) Hermes — conversas ontem
  const { count: convOntem } = await sb.from("hermes_sessoes").select("id", { count: "exact", head: true })
    .gte("ultima_atividade", ontemIso);

  // 4) Meta Ads · gasto ontem
  let metaResumo = "Meta Ads: dados indisponíveis";
  if (META_TOKEN) {
    try {
      const fields = "spend,actions,cost_per_action_type";
      const url = `${GRAPH}/${AD_ACCOUNT_ID}/insights?fields=${encodeURIComponent(fields)}&date_preset=yesterday&access_token=${encodeURIComponent(META_TOKEN)}`;
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        const row = d?.data?.[0] || {};
        const spend = parseFloat(row.spend || "0");
        const convAction = (row.actions || []).find((a: any) =>
          a.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
          a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
        const cplAction = (row.cost_per_action_type || []).find((a: any) =>
          a.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
          a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
        const conv = convAction ? parseInt(convAction.value, 10) : 0;
        const cpl = cplAction ? parseFloat(cplAction.value) : 0;
        metaResumo = `Gasto ontem: ${fmtBRL(spend)} · Conversas: ${conv} · CPL: ${fmtBRL(cpl)}`;
      } else {
        console.error("[hermes-cron] meta insights status", r.status);
      }
    } catch (e) { console.error("[hermes-cron] meta insights erro", e); }
  }

  // 5) Autorizações pendentes
  const { data: pendentes } = await sb.from("hermes_autorizacoes")
    .select("codigo,tipo,descricao_curta").eq("status", "pendente")
    .order("created_at", { ascending: true });
  const pendBlock = (pendentes && pendentes.length)
    ? `\n🔐 AUTORIZAÇÕES PENDENTES: ${pendentes.length}\n` +
        pendentes.slice(0, 8).map((p: any) => `· #${p.codigo} · ${p.tipo} · ${p.descricao_curta || ""}`).join("\n")
    : "\n🔐 Nenhuma autorização pendente";

  const msg =
`📊 1Negócio · ${labelDia}, ${labelData}

LEADS:
↑ ${fmtInt(leadsCount || 0)} novos ontem (${vendedores} vendedores · ${compradores} compradores)
Total na base: ${fmtInt(totalUsuarios || 0)}

NEGÓCIOS:
Publicados: ${fmtInt(negPubl?.length || 0)} · Em avaliação: ${fmtInt(negAval?.length || 0)} · Em negociação: ${fmtInt(negNego?.length || 0)}

HERMES:
Conversas ontem: ${fmtInt(convOntem || 0)}

META ADS:
${metaResumo}
${pendBlock}`;

  await enviarWhatsApp(BOSS_PHONE, msg);
  return { enviado: true, leads: leadsCount, autorizacoes: pendentes?.length || 0 };
}

// ─── JOB 2 · Follow-up leads inativos ────────────────────────────────
async function followupLeadsInativos() {
  // Pega config dinâmica
  const { data: cfgRows } = await sb.from("hermes_config").select("key,value");
  const cfg: Record<string, string> = {};
  (cfgRows || []).forEach((r: any) => { cfg[r.key] = r.value; });
  const horas = parseInt(cfg.followup_horas || "24", 10);

  const limiteSup = new Date(Date.now() - horas * 3600 * 1000).toISOString();
  const limiteInf = new Date(Date.now() - (horas + 6) * 3600 * 1000).toISOString();

  // Janela: sessões cuja última atividade está entre [horas+6h] e [horas] atrás
  // → leads que estão inativos há ~horas mas não fugiram pra sempre
  const { data: sessoes } = await sb.from("hermes_sessoes")
    .select("phone,perfil,fluxo_ativo,step_atual,dados_coletados,is_boss,ultima_atividade")
    .eq("arquivada", false).eq("is_boss", false)
    .gte("ultima_atividade", limiteInf).lt("ultima_atividade", limiteSup)
    .limit(50);

  if (!sessoes?.length) return { processadas: 0 };

  // Horário válido (08-20 BRT) — BRT = UTC-3
  const agoraUTC = new Date();
  const horaBRT = (agoraUTC.getUTCHours() - 3 + 24) % 24;
  const inicio = parseInt((cfg.outbound_horario_inicio || "08:00").split(":")[0], 10);
  const fim = parseInt((cfg.outbound_horario_fim || "20:00").split(":")[0], 10);
  if (horaBRT < inicio || horaBRT >= fim) return { processadas: 0, motivo: "fora_de_horario" };

  let processadas = 0;
  for (const s of sessoes) {
    // Checa opt-out
    const { data: optOut } = await sb.from("hermes_outbound_log")
      .select("id").eq("phone", s.phone).eq("status", "opt_out").limit(1);
    if (optOut?.length) continue;

    const dados = s.dados_coletados || {};
    const nome = dados.nome || dados.contato_nome || "";
    let mensagem = "";
    if (s.fluxo_ativo === "diagnostico_completo" && (s.step_atual || 0) > 0 && (s.step_atual || 0) < 11) {
      mensagem = `Oi${nome ? " " + nome : ""}! Você estava no meio do diagnóstico aqui na 1Negócio. Continuamos de onde paramos?`;
    } else if (s.fluxo_ativo === "estimativa_rapida") {
      mensagem = `Oi${nome ? " " + nome : ""}! Você fez aquela estimativa rápida e o valor faz sentido pra você. Quer fechar o diagnóstico completo agora?`;
    } else if (s.perfil === "comprador") {
      mensagem = `Oi${nome ? " " + nome : ""}! Vi alguns negócios novos que podem casar com o que você busca. Quer dar uma olhada?`;
    } else {
      // genérico — vendedor sem fluxo
      mensagem = `Oi${nome ? " " + nome : ""}! Posso te ajudar a saber quanto vale seu negócio em 2 minutos. Topa?`;
    }

    const ok = await enviarWhatsApp(s.phone, mensagem);
    await sb.from("hermes_outbound_log").insert({
      phone: s.phone, mensagem, contexto: `followup_auto · fluxo=${s.fluxo_ativo || "-"} · step=${s.step_atual || 0}`,
      status: ok ? "enviado" : "falhou",
    });
    if (ok) processadas++;

    // delay anti-ban (45s padrão)
    const delay = parseInt(cfg.outbound_delay_segundos || "45", 10);
    await new Promise(r => setTimeout(r, delay * 1000));
  }
  return { processadas };
}

// ─── JOB 3 · Poll Apify jobs pendentes ────────────────────────────────
async function pollarJobsApify() {
  if (!APIFY_TOKEN) return { skip: "sem_token_apify" };

  const { data: jobs } = await sb.from("hermes_apify_jobs")
    .select("id,phone,run_id,actor").eq("status", "pending")
    .order("created_at", { ascending: true }).limit(20);
  if (!jobs?.length) return { processados: 0 };

  let entregues = 0;
  for (const j of jobs) {
    try {
      const r = await fetch(`https://api.apify.com/v2/actor-runs/${j.run_id}?token=${APIFY_TOKEN}`);
      if (!r.ok) continue;
      const d = await r.json();
      const st = d?.data?.status;
      if (st === "SUCCEEDED") {
        // busca resultados
        const datasetId = d.data?.defaultDatasetId;
        let items: any[] = [];
        if (datasetId) {
          const ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&limit=50`);
          if (ds.ok) items = await ds.json();
        }
        await sb.from("hermes_apify_jobs").update({
          status: "done", resultado: { items, count: items.length },
          entregue_at: new Date().toISOString(),
        }).eq("id", j.id);

        // Notifica o usuário (em geral o Boss)
        const resumo = `✅ Scraper ${j.actor} terminou\n${items.length} resultados\nDigite "ver scraper ${j.run_id.slice(0, 8)}" pra eu listar.`;
        await enviarWhatsApp(j.phone, resumo);
        entregues++;
      } else if (st === "FAILED" || st === "ABORTED" || st === "TIMED-OUT") {
        await sb.from("hermes_apify_jobs").update({
          status: "failed", resultado: { erro: st },
          entregue_at: new Date().toISOString(),
        }).eq("id", j.id);
        await enviarWhatsApp(j.phone, `❌ Scraper ${j.actor} ${st.toLowerCase()}.`);
      }
      // running/ready: deixa pra próxima rodada
    } catch (e) { console.error("[hermes-cron] apify poll", j.run_id, e); }
  }
  return { verificados: jobs.length, entregues };
}

// ─── MAIN ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  let body: any = {};
  try { body = await req.json(); } catch { /* permite GET com query opcional */ }
  const job = body?.job || new URL(req.url).searchParams.get("job") || "";

  try {
    let resultado: any = { ok: true, job };
    switch (job) {
      case "relatorio": resultado = { ok: true, job, ...(await gerarEnviarRelatorio()) }; break;
      case "followup":  resultado = { ok: true, job, ...(await followupLeadsInativos()) }; break;
      case "apify_poll": resultado = { ok: true, job, ...(await pollarJobsApify()) }; break;
      default: return new Response(JSON.stringify({ ok: false, erro: "job_desconhecido", esperados: ["relatorio", "followup", "apify_poll"] }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(resultado), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[hermes-cron] erro", e);
    return new Response(JSON.stringify({ ok: false, erro: e?.message || String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
