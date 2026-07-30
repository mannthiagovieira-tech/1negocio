// Edge Function: disparador-rodar-campanha
// Cron 5min · processa 1 envio por campanha elegível por execução
// Multi-telefone Z-API · respeita janela · dias da semana · velocidade diária · pausa random
//
// Auth · service role (cron-only)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TZ_BR = "America/Sao_Paulo";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ZapiTel {
  id: string;
  numero: string;
  zapi_instance: string;
  zapi_token: string;
  zapi_client_token: string;
  total_enviados_hoje: number;
  limite_diario: number;
  ativo: boolean;
}

interface Campanha {
  id: string;
  nome: string;
  status: string;
  zapi_telefone_id: string | null;
  mensagem_template: string | null;
  janela_inicio: string;
  janela_fim: string;
  dias_semana: string[];
  velocidade_por_dia: number;
  pausa_min_segundos: number;
  pausa_max_segundos: number;
  iniciado_em: string | null;
  agendado_para: string | null;
}

function diaSemanaBR(): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ_BR, weekday: "short" });
  return fmt.format(new Date()).toLowerCase().slice(0, 3); // mon/tue/wed/thu/fri/sat/sun
}

function horaBR(): { h: number; m: number; hhmm: string } {
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ_BR, hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.format(new Date());
  const [hStr, mStr] = parts.split(":");
  return { h: parseInt(hStr, 10), m: parseInt(mStr, 10), hhmm: `${hStr}:${mStr}` };
}

function dentroJanela(inicio: string, fim: string): boolean {
  const { hhmm } = horaBR();
  return hhmm >= inicio.slice(0, 5) && hhmm <= fim.slice(0, 5);
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return (tpl || "").replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function primeiroNome(nome: string | null): string {
  if (!nome) return "";
  return String(nome).trim().split(/\s+/)[0] || "";
}

async function zapiSend(tel: ZapiTel, telefone: string, mensagem: string): Promise<{ ok: boolean; erro?: string; data?: any }> {
  const num = (telefone || "").replace(/\D/g, "");
  if (!num) return { ok: false, erro: "telefone vazio" };
  const fone = num.startsWith("55") ? num : "55" + num;
  try {
    const url = `https://api.z-api.io/instances/${tel.zapi_instance}/token/${tel.zapi_token}/send-text`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "client-token": tel.zapi_client_token },
      body: JSON.stringify({ phone: fone, message: mensagem }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`, data };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, erro: String((e as Error).message).slice(0, 200) };
  }
}

async function processarCampanha(sb: any, c: Campanha): Promise<{ acao: string; detalhe?: string }> {
  // 1. Validações de janela e dias
  const dia = diaSemanaBR();
  if (!c.dias_semana || !c.dias_semana.includes(dia)) return { acao: "skip", detalhe: `dia ${dia} fora` };
  if (!dentroJanela(c.janela_inicio, c.janela_fim)) return { acao: "skip", detalhe: "fora janela" };

  // 2. Carrega telefone Z-API
  if (!c.zapi_telefone_id) return { acao: "erro", detalhe: "campanha sem telefone Z-API" };
  const { data: tel } = await sb.from("zapi_telefones").select("*").eq("id", c.zapi_telefone_id).maybeSingle();
  if (!tel || !tel.ativo) return { acao: "skip", detalhe: "telefone inativo/inexistente" };
  if (tel.total_enviados_hoje >= tel.limite_diario) return { acao: "skip", detalhe: `telefone bateu limite ${tel.limite_diario}` };

  // 3. Conta envios da campanha hoje
  const inicioDia = new Date();
  // Define meia-noite BRT do dia atual em UTC: BRT é UTC-3, então 00:00 BRT = 03:00 UTC
  const utc0 = new Date(Date.UTC(inicioDia.getUTCFullYear(), inicioDia.getUTCMonth(), inicioDia.getUTCDate(), 3, 0, 0));
  if (utc0.getTime() > Date.now()) utc0.setUTCDate(utc0.getUTCDate() - 1);
  const { count: enviadosHoje } = await sb.from("disparador_envios")
    .select("id", { count: "exact", head: true })
    .eq("campanha_id", c.id)
    .eq("status", "enviado")
    .gte("enviado_em", utc0.toISOString());
  if ((enviadosHoje || 0) >= c.velocidade_por_dia) return { acao: "skip", detalhe: `bateu velocidade diária ${c.velocidade_por_dia}` };

  // 4. Pega próximo envio pendente
  const { data: env } = await sb.from("disparador_envios")
    .select("id, lead_id, lead_telefone, mensagem_customizada")
    .eq("campanha_id", c.id)
    .eq("status", "pendente")
    .limit(1)
    .maybeSingle();

  if (!env) {
    // Fila vazia · marca campanha como concluída
    await sb.from("disparador_campanhas").update({ status: "concluida", concluido_em: new Date().toISOString() }).eq("id", c.id);
    return { acao: "concluida" };
  }

  // 5. Carrega lead pra renderizar variáveis
  let lead: any = null;
  if (env.lead_id) {
    const { data } = await sb.from("leads_google").select("nome, cidade, estado, setor, telefone").eq("id", env.lead_id).maybeSingle();
    lead = data;
  }
  const nome = lead?.nome || "";
  const vars = {
    nome,
    primeiro_nome: primeiroNome(nome),
    cidade: lead?.cidade || "",
    estado: lead?.estado || "",
    setor: lead?.setor || "",
  };
  const telefoneEnvio = env.lead_telefone || lead?.telefone || "";
  const mensagem = (env as any).mensagem_customizada
    ? String((env as any).mensagem_customizada)
    : renderTemplate(c.mensagem_template || "", vars);

  if (!telefoneEnvio) {
    await sb.from("disparador_envios").update({ status: "erro", erro_mensagem: "lead sem telefone" }).eq("id", env.id);
    await sb.from("disparador_campanhas").update({ total_erros: (c as any).total_erros ? (c as any).total_erros + 1 : 1 }).eq("id", c.id);
    return { acao: "erro", detalhe: "lead sem telefone" };
  }

  // 6. Envia
  const t0 = Date.now();
  const r = await zapiSend(tel, telefoneEnvio, mensagem);
  const dur = Date.now() - t0;

  if (r.ok) {
    const nowIso = new Date().toISOString();
    await sb.from("disparador_envios").update({
      status: "enviado",
      enviado_em: nowIso,
      mensagem_enviada: mensagem,
      erro_mensagem: null,
    }).eq("id", env.id);
    if (env.lead_id) {
      await sb.from("leads_google").update({ abordado_em: nowIso }).eq("id", env.lead_id);
    }
    // Incrementa contadores · SELECT+UPDATE atômico-aproximado
    const { data: cur } = await sb.from("disparador_campanhas").select("total_enviados").eq("id", c.id).maybeSingle();
    await sb.from("disparador_campanhas").update({ total_enviados: (cur?.total_enviados || 0) + 1 }).eq("id", c.id);
    await sb.from("zapi_telefones").update({
      total_enviados_hoje: (tel.total_enviados_hoje || 0) + 1,
      total_enviados_total: (tel.total_enviados_total || 0) + 1,
      ultima_atividade: nowIso,
    }).eq("id", tel.id);
    return { acao: "enviado", detalhe: `${dur}ms` };
  } else {
    await sb.from("disparador_envios").update({
      status: "erro",
      erro_mensagem: r.erro,
    }).eq("id", env.id);
    const { data: cur } = await sb.from("disparador_campanhas").select("total_erros").eq("id", c.id).maybeSingle();
    await sb.from("disparador_campanhas").update({ total_erros: (cur?.total_erros || 0) + 1 }).eq("id", c.id);
    return { acao: "erro", detalhe: r.erro };
  }
}

// ─── VA · processar va_disparo_fila (extensão) ────────────────────
// Chamável por: cron (service role, sem body) OU admin via front (JWT admin, body {action:'processar_va'[,projeto_id]})
// Limite por execução: 10 (proteção de tempo de edge).
const VA_MAX_POR_EXEC = 10;

async function processarVaFila(sb: any, projetoFiltro: string | null): Promise<any> {
  // Pega 1 telefone Z-API ativo com folga
  const { data: tel } = await sb.from("zapi_telefones")
    .select("*").eq("ativo", true)
    .order("total_enviados_hoje", { ascending: true })
    .limit(1).maybeSingle();
  if (!tel) return { ok: false, erro: "nenhum zapi_telefone ativo" };
  if (tel.total_enviados_hoje >= tel.limite_diario) return { ok: false, erro: `zapi_telefone ${tel.numero} bateu limite ${tel.limite_diario}` };

  // Pega itens vencidos
  let q = sb.from("va_disparo_fila")
    .select("id, projeto_id, contato_id, corpo_resolvido, agendado_para")
    .eq("status", "agendado")
    .lte("agendado_para", new Date().toISOString())
    .order("agendado_para", { ascending: true })
    .limit(VA_MAX_POR_EXEC);
  if (projetoFiltro) q = q.eq("projeto_id", projetoFiltro);
  const { data: itens, error: fErr } = await q;
  if (fErr) return { ok: false, erro: "SELECT fila: " + fErr.message };
  if (!itens || itens.length === 0) return { ok: true, processados: 0, msg: "fila vazia" };

  let sucessos = 0, falhas = 0;
  for (const item of itens) {
    // Contato pra pegar telefone
    const { data: c } = await sb.from("va_contatos").select("telefone_normalizado, nome").eq("id", item.contato_id).maybeSingle();
    if (!c?.telefone_normalizado) {
      await sb.rpc("va_confirmar_disparo", { p_fila_id: item.id, p_sucesso: false, p_zapi_id: null, p_erro: "contato sem telefone" });
      falhas++;
      continue;
    }
    const r = await zapiSend(tel, c.telefone_normalizado, item.corpo_resolvido || "");
    if (r.ok) {
      await sb.rpc("va_confirmar_disparo", { p_fila_id: item.id, p_sucesso: true, p_zapi_id: r.data?.messageId || r.data?.id || null, p_erro: null });
      sucessos++;
      await sb.from("zapi_telefones").update({
        total_enviados_hoje: (tel.total_enviados_hoje || 0) + sucessos,
        total_enviados_total: (tel.total_enviados_total || 0) + sucessos,
        ultima_atividade: new Date().toISOString(),
      }).eq("id", tel.id);
    } else {
      await sb.rpc("va_confirmar_disparo", { p_fila_id: item.id, p_sucesso: false, p_zapi_id: null, p_erro: r.erro || "sem detalhe" });
      falhas++;
    }
  }
  return { ok: true, processados: itens.length, sucessos, falhas, zapi_telefone: tel.numero };
}

// Checa se o Authorization header é de um admin (via va_admins)
async function chamadorEhAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  // Se veio o service role, sempre passa (cron)
  if (token === SB_SERVICE) return true;
  // Se é JWT de user, cria cliente com o token e chama va_is_admin
  const sbUser = createClient(SB_URL, SB_SERVICE, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await sbUser.rpc("va_is_admin");
  if (error) { console.warn("[disp] chamadorEhAdmin erro:", error.message); return false; }
  return data === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb = createClient(SB_URL, SB_SERVICE);

    // Parse body (opcional)
    let body: any = null;
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = null; }
    }
    const acao = body?.action || null;

    // ── Modo 1: acao === 'processar_va' (chamada manual admin, do front) ──
    if (acao === "processar_va") {
      if (!(await chamadorEhAdmin(req))) {
        return new Response(JSON.stringify({ ok: false, erro: "não autorizado" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const projetoFiltro = body?.projeto_id || null;
      const res = await processarVaFila(sb, projetoFiltro);
      return new Response(JSON.stringify(res), { status: res.ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Modo 2: cron / sem body · processa CAMPANHAS VELHAS + VA FILA ──
    // 1. Promove campanhas agendadas vencidas para rodando
    await sb.from("disparador_campanhas")
      .update({ status: "rodando", iniciado_em: new Date().toISOString() })
      .eq("status", "agendada")
      .lte("agendado_para", new Date().toISOString());

    // 2. Carrega campanhas em curso
    const { data: campanhas, error: campErr } = await sb.from("disparador_campanhas")
      .select("id, nome, status, zapi_telefone_id, mensagem_template, janela_inicio, janela_fim, dias_semana, velocidade_por_dia, pausa_min_segundos, pausa_max_segundos, iniciado_em, agendado_para, total_erros")
      .eq("status", "rodando");
    if (campErr) {
      console.error("[disp] SELECT campanhas erro:", campErr);
      return new Response(JSON.stringify({ ok: false, erro: "SELECT campanhas: " + campErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const resultados: any[] = [];
    for (const c of (campanhas || [])) {
      try {
        const r = await processarCampanha(sb, c as Campanha);
        resultados.push({ campanha: c.nome || c.id, ...r });
      } catch (e) {
        const msg = (e as Error).message || String(e);
        const stk = (e as Error).stack || "";
        console.error(`[disp] processarCampanha(${c.nome}) THROW:`, msg, stk);
        resultados.push({ campanha: c.nome || c.id, acao: "throw", detalhe: msg });
      }
    }

    // 3. NOVO: processa também a fila de disparos do VA no mesmo cron
    let va: any = null;
    try {
      va = await processarVaFila(sb, null);
    } catch (e) {
      va = { ok: false, erro: (e as Error).message };
    }

    return new Response(JSON.stringify({ ok: true, processadas: resultados.length, resultados, va }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const stk = (e as Error).stack || "";
    console.error("[disp] TOPLEVEL THROW:", msg, stk);
    return new Response(JSON.stringify({ ok: false, erro: msg, stack: stk.slice(0, 500) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
