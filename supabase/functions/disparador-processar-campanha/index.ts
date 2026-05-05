// Edge Function: disparador-processar-campanha
// B76 · Cron 5min · processa campanhas com status='rodando' · respeita cadência
//
// Cron · '*/5 * * * *' (a cada 5 min)
// Endpoint manual:
//   POST /functions/v1/disparador-processar-campanha
//   Body: { only_campanha_id?, max_msgs?: number (default 30) }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_WHATSAPP = Deno.env.get("ADMIN_WHATSAPP") ?? "";
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mapa de listas → origens em leads_google
const LISTAS = {
  "vdrs": { origens: ["base_manual_2026_05"], tag: "vdrs" },
  "ptcprdrs": { origens: ["base_manual_2026_05"], tag: "ptcprdrs" },
  "ptcrrtoes": { origens: ["base_manual_2026_05"], tag: "ptcrrtoes" },
  "ia_atendente": { origens: ["ia_atendente_home", "ia_atendente_home_prelead"], tag: null },
  "floripa": { origens: ["gmaps_floripa"], tag: null },
  "corretores": { origens: ["gmaps_corretores"], tag: null },
  "olx": { origens: ["olx"], tag: null },
  "likers": { origens: ["likers_post"], tag: null },
};

function dentroJanela(cadencia: any): boolean {
  const now = new Date();
  // Considera horário de Brasília (UTC-3) · janela em hora local
  const hBR = (now.getUTCHours() - 3 + 24) % 24;
  const dow = now.getUTCDay();
  if (cadencia.skip_weekend && (dow === 0 || dow === 6)) return false;
  const ini = cadencia.janela_inicio ?? 9;
  const fim = cadencia.janela_fim ?? 19;
  return hBR >= ini && hBR < fim;
}

function resolverTemplate(tpl: string, lead: any): string {
  const primeiroNome = (lead.nome || "").split(" ")[0] || "";
  return tpl
    .replace(/\{nome\}/g, lead.nome || "")
    .replace(/\{primeiro_nome\}/g, primeiroNome)
    .replace(/\{cidade\}/g, lead.cidade || "")
    .replace(/\{estado\}/g, lead.estado || "");
}

async function enviarZapi(phone: string, message: string): Promise<{ ok: boolean; erro?: string }> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN) return { ok: false, erro: "Z-API não configurado" };
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ZAPI_CLIENT_TOKEN) headers["Client-Token"] = ZAPI_CLIENT_TOKEN;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, message }),
    });
    if (r.ok) return { ok: true };
    const txt = await r.text().catch(() => "");
    return { ok: false, erro: `${r.status}: ${txt.slice(0, 100)}` };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

async function notificarAdmin(msg: string): Promise<void> {
  if (!ADMIN_WHATSAPP || !ZAPI_INSTANCE || !ZAPI_TOKEN) return;
  await enviarZapi(ADMIN_WHATSAPP, msg);
}

async function buscarProximoLead(supabase: any, camp: any): Promise<any | null> {
  const lista = camp.lista_origens || [];
  const filtros = camp.filtros || {};
  // Constrói where dinâmico
  let q = supabase.from("leads_google")
    .select("id, nome, telefone, cidade, estado, tags, fontes, ultima_mensagem_em")
    .not("telefone", "is", null);

  // Origens via OR (suporte multi-lista)
  const origens: string[] = [];
  const tags: string[] = [];
  for (const l of lista) {
    const cfg = (LISTAS as any)[l];
    if (cfg) {
      origens.push(...cfg.origens);
      if (cfg.tag) tags.push(cfg.tag);
    }
  }
  if (origens.length) q = q.in("origem", Array.from(new Set(origens)));
  if (tags.length) q = q.overlaps("tags", tags);
  if (filtros.cidade) q = q.eq("cidade", filtros.cidade);
  if (filtros.estado) q = q.eq("estado", filtros.estado);
  if (filtros.tag_extra) q = q.contains("tags", [filtros.tag_extra]);

  // Exclui já enviados desta campanha
  const { data: jaEnviados } = await supabase
    .from("disparador_envios")
    .select("lead_id")
    .eq("campanha_id", camp.id);
  const idsExcluir = new Set((jaEnviados || []).map((e: any) => e.lead_id));

  // Ordenar por created_at asc · pega leads mais antigos primeiro
  q = q.order("created_at", { ascending: true }).limit(50);
  const { data: candidatos } = await q;
  if (!candidatos?.length) return null;

  // Filtro client-side · não pode ter mensagem nos últimos 7 dias · exclui já enviado
  const seteDiasAtras = Date.now() - 7 * 86400000;
  for (const c of candidatos) {
    if (idsExcluir.has(c.id)) continue;
    if ((c.tags || []).includes("opt_out")) continue;
    if (c.ultima_mensagem_em && new Date(c.ultima_mensagem_em).getTime() > seteDiasAtras) continue;
    return c;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const maxMsgs = Math.min(Math.max(parseInt(body?.max_msgs) || 30, 1), 100);

    let q = supabase.from("disparador_campanhas").select("*").eq("status", "rodando");
    if (body?.only_campanha_id) q = q.eq("id", body.only_campanha_id);
    const { data: camps } = await q;
    if (!camps?.length) return new Response(JSON.stringify({ ok: true, processadas: 0, motivo: "nenhuma campanha rodando" }), { headers: { ...cors, "Content-Type": "application/json" } });

    const resumo: any[] = [];
    for (const camp of camps) {
      const cadencia = camp.cadencia || {};
      if (!dentroJanela(cadencia)) {
        resumo.push({ id: camp.id, nome: camp.nome, skip: "fora janela" });
        continue;
      }
      const intervaloMs = (cadencia.intervalo_min || 2) * 60000;
      const proximoOk = !camp.proximo_envio_em || new Date(camp.proximo_envio_em).getTime() <= Date.now();
      if (!proximoOk) {
        resumo.push({ id: camp.id, nome: camp.nome, skip: "aguardando intervalo" });
        continue;
      }

      let enviados = 0;
      let falhas = 0;
      const limitePorTick = Math.min(maxMsgs, Math.floor((cadencia.msgs_por_hora || 30) / 12)); // 5min de janela
      for (let i = 0; i < limitePorTick; i++) {
        const lead = await buscarProximoLead(supabase, camp);
        if (!lead) {
          // Acabou · finaliza
          await supabase.from("disparador_campanhas").update({
            status: "concluida",
            finished_at: new Date().toISOString(),
          }).eq("id", camp.id);
          await notificarAdmin(`✅ Campanha "${camp.nome}" concluída\n${camp.total_enviado + enviados} enviados · ${camp.total_falhas + falhas} falhas`);
          break;
        }
        const msg = resolverTemplate(camp.mensagem_template, lead);
        const r = await enviarZapi(lead.telefone, msg);
        await supabase.from("disparador_envios").insert({
          campanha_id: camp.id,
          lead_id: lead.id,
          lead_telefone: lead.telefone,
          mensagem_enviada: msg,
          status: r.ok ? "sucesso" : "falha",
          erro_detalhe: r.erro || null,
        });
        if (r.ok) {
          enviados++;
          await supabase.from("leads_google").update({
            ultima_campanha_enviada: camp.id,
            ultima_mensagem_em: new Date().toISOString(),
            total_disparos: (lead.total_disparos || 0) + 1,
          }).eq("id", lead.id);
        } else {
          falhas++;
        }
        // Aguarda intervalo entre msgs (skip last)
        if (i < limitePorTick - 1) {
          await new Promise(r => setTimeout(r, Math.min(intervaloMs, 60000)));
        }
      }

      // Atualiza contador + próximo envio
      await supabase.from("disparador_campanhas").update({
        total_enviado: camp.total_enviado + enviados,
        total_falhas: camp.total_falhas + falhas,
        proximo_envio_em: new Date(Date.now() + intervaloMs).toISOString(),
      }).eq("id", camp.id);

      // Alerta se >20% falha
      const totalNovo = camp.total_enviado + enviados;
      const falhasNovo = camp.total_falhas + falhas;
      if (totalNovo > 20 && (falhasNovo / totalNovo) > 0.20 && camp.status !== "pausada") {
        await supabase.from("disparador_campanhas").update({ status: "pausada" }).eq("id", camp.id);
        await notificarAdmin(`⚠️ Campanha "${camp.nome}" pausada · ${falhasNovo}/${totalNovo} falhas (>20%)`);
      }

      resumo.push({ id: camp.id, nome: camp.nome, enviados, falhas, total_enviado: totalNovo });
    }

    return new Response(JSON.stringify({ ok: true, processadas: camps.length, detalhe: resumo }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String((e as Error).message) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
