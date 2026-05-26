// HERMES v4 · webhook principal · v1.0.0
// Z-API → Edge → Claude Sonnet 4 (tool calls) → Z-API
//
// Variáveis obrigatórias: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
// Variáveis pendentes (warning-only): GROQ_API_KEY, ZAPI_URL, META_ACCESS_TOKEN,
//                                     STRIPE_SECRET_KEY, APIFY_API_TOKEN, RESEND_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── ENV ──────────────────────────────────────────────────────────────
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") || "";
const ZAPI_URL = Deno.env.get("ZAPI_URL") || ""; // ex: https://api.z-api.io/instances/XXX/token/YYY
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") || ""; // header Client-Token obrigatório nas requisições Z-API
const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN") || "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";

// warnings de boot — não trava execução
if (!ANTHROPIC_KEY) console.error("[hermes] ANTHROPIC_API_KEY ausente — Claude não responderá");
if (!GROQ_KEY) console.warn("[hermes] GROQ_API_KEY ausente — áudios não serão transcritos");
if (!ZAPI_URL) console.warn("[hermes] ZAPI_URL ausente — mensagens de resposta não serão enviadas");
if (!ZAPI_CLIENT_TOKEN) console.warn("[hermes] ZAPI_CLIENT_TOKEN ausente — Z-API vai rejeitar as chamadas");
if (!META_TOKEN) console.warn("[hermes] META_ACCESS_TOKEN ausente — tools meta_* falharão");
if (!STRIPE_KEY) console.warn("[hermes] STRIPE_SECRET_KEY ausente — tools stripe_* falharão");
if (!APIFY_TOKEN) console.warn("[hermes] APIFY_API_TOKEN ausente — tools apify_* falharão");
if (!RESEND_KEY) console.warn("[hermes] RESEND_API_KEY ausente — emails falharão");

const BOSS_PHONE = "5548999279320";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOOL_ITER = 12;

const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

// ─── HTTP helpers ─────────────────────────────────────────────────────
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function ok(b: unknown = { ok: true }) {
  return new Response(JSON.stringify(b), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
}

// ─── Processamento de mensagem ────────────────────────────────────────
type ZapiBody = any;

// phoneClean: normaliza para formato canônico BR (55 + DDD + número)
// Aceita: "5548999279320", "48999279320", "5548999279320@c.us", "+5548999279320",
//         "0048999279320", "55 48 99927-9320" → todos viram "5548999279320"
function phoneClean(raw: string): string {
  let p = (raw || "").replace(/@c\.us|@g\.us/g, "").replace(/\D/g, "");
  if (!p) return "";
  p = p.replace(/^0+/, ""); // tira zeros à esquerda (00, 0)
  // já no formato canônico BR (55 + 10 ou 11 dígitos = 12 ou 13 totais)
  if (p.startsWith("55") && (p.length === 12 || p.length === 13)) return p;
  // sem código do país (10 ou 11 dígitos) → assume BR e prepende 55
  if (p.length === 10 || p.length === 11) return "55" + p;
  // formato fora do esperado — retorna como veio (pode ser número internacional)
  return p;
}

async function processarMensagem(body: ZapiBody): Promise<string> {
  if (body?.text?.message) return String(body.text.message);
  if (body?.audio?.audioUrl || body?.audio?.base64) {
    if (!GROQ_KEY) return "[áudio recebido — transcrição indisponível no momento]";
    try { return await transcreverAudio(body.audio); }
    catch (e) { console.error("[hermes] transcrição falhou", e); return "[áudio recebido — não consegui transcrever]"; }
  }
  if (body?.image) return "[imagem recebida — funcionalidade em breve]";
  return "";
}

async function transcreverAudio(audio: { audioUrl?: string; base64?: string }): Promise<string> {
  let blob: Blob;
  if (audio.base64) {
    const bin = Uint8Array.from(atob(audio.base64), c => c.charCodeAt(0));
    blob = new Blob([bin], { type: "audio/ogg" });
  } else {
    const r = await fetch(audio.audioUrl!);
    blob = new Blob([await r.arrayBuffer()], { type: "audio/ogg" });
  }
  const fd = new FormData();
  fd.append("file", blob, "audio.ogg");
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("language", "pt");
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_KEY}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return d?.text || "";
}

// ─── Config ───────────────────────────────────────────────────────────
async function getConfig(): Promise<Record<string, string>> {
  const { data } = await sb.from("hermes_config").select("key,value");
  const m: Record<string, string> = {};
  (data || []).forEach((r: any) => { m[r.key] = r.value; });
  return m;
}

// ─── Sessão ───────────────────────────────────────────────────────────
async function getOuCriarSessao(phone: string, isBoss: boolean) {
  const { data: existing } = await sb.from("hermes_sessoes").select("*").eq("phone", phone).maybeSingle();
  if (existing) {
    if (existing.is_boss !== isBoss) {
      await sb.from("hermes_sessoes").update({ is_boss: isBoss }).eq("phone", phone);
      existing.is_boss = isBoss;
    }
    return existing;
  }
  const { data: novo } = await sb.from("hermes_sessoes").insert({
    phone, is_boss: isBoss, perfil: "desconhecido", dados_coletados: {},
  }).select().single();
  return novo;
}
async function atualizarAtividade(phone: string) {
  await sb.from("hermes_sessoes").update({ ultima_atividade: new Date().toISOString() }).eq("phone", phone);
}
async function atualizarSessao(phone: string, campos: Record<string, any>) {
  await sb.from("hermes_sessoes").update(campos).eq("phone", phone);
}

// ─── Histórico ────────────────────────────────────────────────────────
async function getHistorico(phone: string, limit: number) {
  const { data } = await sb.from("hermes_conversas")
    .select("role,content,created_at")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data || []).reverse();
  if (rows.length <= limit) return rows.map(r => ({ role: r.role as "user" | "assistant", content: r.content }));
  // mantém 5 primeiras + últimas (limit-5) — comportamento da spec
  const primeiras = rows.slice(0, 5);
  const ultimas = rows.slice(-(limit - 5));
  return [...primeiras, ...ultimas].map(r => ({ role: r.role as "user" | "assistant", content: r.content }));
}
async function salvarMensagem(phone: string, role: "user" | "assistant", content: string) {
  await sb.from("hermes_conversas").insert({ phone, role, content });
}

// ─── Treinamento ──────────────────────────────────────────────────────
async function getTreinamento(): Promise<string> {
  const { data } = await sb.from("hermes_treinamento")
    .select("categoria,gatilho,conteudo")
    .eq("ativo", true)
    .order("created_at", { ascending: true });
  if (!data?.length) return "(sem treinamento adicional)";
  return data.map((r: any) => `[${(r.categoria || r.gatilho || "GERAL").toUpperCase()}]\n${r.conteudo}`).join("\n\n");
}

// ─── Z-API envio ──────────────────────────────────────────────────────
async function enviarWhatsApp(phone: string, mensagem: string): Promise<boolean> {
  if (!ZAPI_URL) { console.warn("[hermes] enviarWhatsApp: ZAPI_URL ausente, skip"); return false; }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ZAPI_CLIENT_TOKEN) headers["Client-Token"] = ZAPI_CLIENT_TOKEN;
    const r = await fetch(`${ZAPI_URL}/send-text`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, message: mensagem }),
    });
    if (!r.ok) { console.error(`[hermes] z-api ${r.status}: ${(await r.text()).slice(0, 200)}`); return false; }
    return true;
  } catch (e) { console.error("[hermes] enviarWhatsApp erro", e); return false; }
}

// Delay humano antes de enviar — simula tempo de digitação
// Base 1.5s fixo + 30ms por char · clamp [1500ms, 8000ms]
function humanDelayMs(texto: string): number {
  const calc = 1500 + 30 * (texto || "").length;
  return Math.max(1500, Math.min(8000, calc));
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Envio com split em até 2 mensagens via marcador [[SPLIT]] + delay humano antes de cada parte
async function enviarRespostaHermes(phone: string, resposta: string): Promise<void> {
  const partes = resposta.split("[[SPLIT]]").map(p => p.trim()).filter(Boolean);
  const lista = partes.length ? partes : [resposta];
  for (const parte of lista) {
    await sleep(humanDelayMs(parte));
    await enviarWhatsApp(phone, parte);
  }
}

// ─── Autorizações (Grupo H) ───────────────────────────────────────────
async function getAutorizacaoPendente(): Promise<any | null> {
  const { data } = await sb.from("hermes_autorizacoes")
    .select("*").eq("status", "pendente").order("created_at", { ascending: true }).limit(1);
  return data?.[0] || null;
}
async function getAutorizacoesPendentesTodas(): Promise<any[]> {
  const { data } = await sb.from("hermes_autorizacoes")
    .select("codigo,tipo,descricao_curta,negocio_id,created_at")
    .eq("status", "pendente").order("created_at", { ascending: true });
  return data || [];
}

async function criarAutorizacao(args: {
  tipo: string; descricao: string; descricao_curta?: string;
  negocio_id?: string | null; lead_phone?: string | null; payload?: any;
}) {
  const { data, error } = await sb.from("hermes_autorizacoes").insert({
    tipo: args.tipo,
    descricao: args.descricao,
    descricao_curta: args.descricao_curta || args.descricao.slice(0, 80),
    negocio_id: args.negocio_id || null,
    lead_phone: args.lead_phone || null,
    payload: args.payload || {},
  }).select().single();
  if (error) throw new Error(`criarAutorizacao: ${error.message}`);
  // Notifica Boss
  const msg = `Autorização necessária · #${data.codigo}\n\n${args.descricao}\n\nPosso prosseguir? sim/não`;
  await enviarWhatsApp(BOSS_PHONE, msg);
  return data;
}

async function marcarAutorizacao(id: string, status: "aprovada" | "rejeitada" | "expirada") {
  await sb.from("hermes_autorizacoes").update({
    status, respondida_at: status === "expirada" ? null : new Date().toISOString(),
  }).eq("id", id);
}

// Mapa de execução das ações autorizadas — chamado após Boss aprovar
async function executarAcaoAutorizada(auth: any): Promise<{ ok: boolean; detalhe?: string }> {
  const tipo = auth.tipo as string;
  const p = auth.payload || {};
  try {
    if (tipo === "nda_liberar_dossie") {
      // liberar acesso ao dossiê para solicitante
      if (p.solicitacao_id) {
        await sb.from("solicitacoes_info").update({
          status: "liberado",
          liberado_em: new Date().toISOString(),
          nivel: p.nivel || "completo",
        }).eq("id", p.solicitacao_id);
      }
      return { ok: true, detalhe: "Dossiê liberado" };
    }
    if (tipo === "publicar_negocio" && p.negocio_id) {
      await sb.from("negocios").update({
        status: "publicado",
        publicado_em: new Date().toISOString(),
      }).eq("id", p.negocio_id);
      return { ok: true, detalhe: `Negócio publicado: ${p.negocio_id}` };
    }
    if (tipo === "outbound_lote") {
      // payload = { contatos: [...], mensagem_template, delay_segundos }
      // Disparo só do primeiro contato como sinal — o resto deve usar cron/fila
      // Por enquanto, registra como aprovado e Hermes lida com o disparo via tool.
      return { ok: true, detalhe: "Lote autorizado · disparo via outbound_enviar_individual" };
    }
    if (tipo === "alterar_status_publicado" && p.negocio_id && p.novo_status) {
      await sb.from("negocios").update({ status: p.novo_status }).eq("id", p.negocio_id);
      return { ok: true, detalhe: `Status alterado: ${p.novo_status}` };
    }
    return { ok: false, detalhe: `tipo desconhecido: ${tipo}` };
  } catch (e: any) {
    return { ok: false, detalhe: e?.message || String(e) };
  }
}

// Boss responde "sim/não" → processa autorização ANTES de qualquer outra lógica
async function processarRespostaBoss(phone: string, texto: string): Promise<boolean> {
  const auth = await getAutorizacaoPendente();
  if (!auth) return false;
  const t = (texto || "").toLowerCase().trim();
  const aprovado = ["sim", "s", "aprovado", "ok", "pode", "vai", "libera", "manda", "autorizo"].some(p => t.includes(p));
  const rejeitado = ["não", "nao", "n", "nega", "recusa", "espera", "segura", "cancela", "não pode"].some(p => t.includes(p));
  if (!aprovado && !rejeitado) return false;

  if (aprovado) {
    const exec = await executarAcaoAutorizada(auth);
    await marcarAutorizacao(auth.id, "aprovada");
    const conf = exec.ok
      ? `Executado · #${auth.codigo}\n${exec.detalhe || auth.descricao_curta}`
      : `Aprovado mas falhou ao executar · #${auth.codigo}\n${exec.detalhe || ""}`;
    await enviarWhatsApp(phone, conf);
    await salvarMensagem(phone, "user", texto);
    await salvarMensagem(phone, "assistant", conf);
    return true;
  }
  // rejeitado
  await marcarAutorizacao(auth.id, "rejeitada");
  let msg = `Cancelado · #${auth.codigo}`;
  if (auth.negocio_id) msg += `\nNegócio mantido no estado atual.`;
  await enviarWhatsApp(phone, msg);
  if (auth.lead_phone) {
    await enviarWhatsApp(auth.lead_phone, "Nossa equipe está revisando sua solicitação. Você recebe retorno em breve.");
  }
  await salvarMensagem(phone, "user", texto);
  await salvarMensagem(phone, "assistant", msg);
  return true;
}

// ─── Valuation (Grupo G) ──────────────────────────────────────────────
// Múltiplos e margens operacionais da 1Negócio (skill avaliadora oficial)
// Fonte: supabase/migrations/002_seed_parametros_v2026_04.sql · multiplos_setor + benchmarks_dre
// Os múltiplos são aplicados sobre EBITDA estimado (faturamento × margem_op típica do setor)
const SETORES_1N: Record<string, { multiplo: number; margem_op: number; label: string }> = {
  servicos_empresas: { multiplo: 2.06, margem_op: 0.30, label: "Serviços B2B" },
  educacao:          { multiplo: 2.18, margem_op: 0.28, label: "Educação" },
  saude:             { multiplo: 2.12, margem_op: 0.25, label: "Saúde" },
  bem_estar:         { multiplo: 1.87, margem_op: 0.22, label: "Bem-estar / academia" },
  beleza_estetica:   { multiplo: 1.76, margem_op: 0.22, label: "Beleza e estética" },
  industria:         { multiplo: 1.72, margem_op: 0.12, label: "Indústria" },
  hospedagem:        { multiplo: 1.69, margem_op: 0.18, label: "Hospedagem" },
  logistica:         { multiplo: 1.67, margem_op: 0.12, label: "Logística" },
  alimentacao:       { multiplo: 1.58, margem_op: 0.15, label: "Alimentação" },
  servicos_locais:   { multiplo: 1.58, margem_op: 0.18, label: "Serviços locais" },
  varejo:            { multiplo: 1.52, margem_op: 0.10, label: "Varejo" },
  construcao:        { multiplo: 1.46, margem_op: 0.10, label: "Construção" },
};
// MAPA_SETORES · mapeia setor livre digitado pelo lead para os valores
// aceitos pelo CHECK constraint da tabela negocios.
// Usado em db_buscar_negocios para evitar busca vazia por mismatch.
const MAPA_SETORES: Record<string, string> = {
  "ti": "servicos_empresas", "tecnologia": "servicos_empresas",
  "informatica": "servicos_empresas", "software": "servicos_empresas",
  "consultoria": "servicos_empresas", "contabilidade": "servicos_empresas",
  "saude": "saude", "clinica": "saude", "medico": "saude",
  "odonto": "saude", "veterinaria": "saude", "fisio": "saude",
  "alimentacao": "alimentacao", "restaurante": "alimentacao",
  "lanchonete": "alimentacao", "padaria": "alimentacao",
  "bar": "alimentacao", "delivery": "alimentacao",
  "beleza": "beleza_estetica", "estetica": "beleza_estetica",
  "salao": "beleza_estetica", "barbearia": "beleza_estetica", "spa": "beleza_estetica",
  "educacao": "educacao", "escola": "educacao", "curso": "educacao", "idiomas": "educacao",
  "varejo": "varejo", "loja": "varejo", "comercio": "varejo",
  "ecommerce": "varejo", "revendedora": "varejo",
  "industria": "industria", "fabricacao": "industria", "manufatura": "industria",
  "construcao": "construcao", "obra": "construcao", "reforma": "construcao",
  "incorporadora": "construcao",
  "logistica": "logistica", "transporte": "logistica",
  "deposito": "logistica", "distribuidora": "logistica",
  "hospedagem": "hospedagem", "hotel": "hospedagem", "pousada": "hospedagem",
  "airbnb": "hospedagem", "turismo": "hospedagem",
  "bem_estar": "bem_estar", "academia": "bem_estar",
  "fitness": "bem_estar", "studio": "bem_estar", "personal": "bem_estar",
  "servicos": "servicos_locais", "servico": "servicos_locais",
  "lavanderia": "servicos_locais", "oficina": "servicos_locais",
  "manutencao": "servicos_locais",
};
function mapearSetorCanonico(input: string): string | null {
  if (!input) return null;
  const lower = (input).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  // match exato primeiro
  if (MAPA_SETORES[lower]) return MAPA_SETORES[lower];
  // substring (mais longo primeiro pra evitar "servicos" pegar antes de "servicos_empresas")
  const keys = Object.keys(MAPA_SETORES).sort((a, b) => b.length - a.length);
  for (const k of keys) if (lower.includes(k)) return MAPA_SETORES[k];
  return null;
}

// Aliases pra tolerar variações coloquiais que o lead pode usar
const SETOR_ALIAS: Record<string, string> = {
  servicos: "servicos_locais", servico: "servicos_locais", "serv_b2b": "servicos_empresas",
  consultoria: "servicos_empresas", contabilidade: "servicos_empresas", ti: "servicos_empresas",
  clinica: "saude", odonto: "saude", veterinaria: "saude", fisio: "saude",
  restaurante: "alimentacao", padaria: "alimentacao", bar: "alimentacao", delivery: "alimentacao",
  salao: "beleza_estetica", barbearia: "beleza_estetica", estetica: "beleza_estetica", spa: "beleza_estetica",
  escola: "educacao", curso: "educacao", idiomas: "educacao",
  loja: "varejo", ecommerce: "varejo", revendedora: "varejo",
  fabrica: "industria", manufatura: "industria", confeccao: "industria",
  transporte: "logistica", deposito: "logistica", distribuidora: "logistica",
  obra: "construcao", reforma: "construcao", incorporadora: "construcao",
  academia: "bem_estar", studio: "bem_estar", personal: "bem_estar",
  hotel: "hospedagem", pousada: "hospedagem", airbnb: "hospedagem", turismo: "hospedagem",
  lavanderia: "servicos_locais", oficina: "servicos_locais", manutencao: "servicos_locais",
};
function setorKey(s: string): string {
  const norm = (s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "");
  if (SETORES_1N[norm]) return norm;
  if (SETOR_ALIAS[norm]) return SETOR_ALIAS[norm];
  // tenta substring (ex: "servicos_empresariais" contém "servicos_empresas")
  for (const k of Object.keys(SETORES_1N)) if (norm.includes(k)) return k;
  for (const k of Object.keys(SETOR_ALIAS)) if (norm.includes(k)) return SETOR_ALIAS[k];
  return "servicos_locais"; // fallback conservador
}
function calcularValuationRapido(input: any) {
  const { setor, faturamento_mensal, anos_operacao, sobra_mensal, ativos_relevantes, dividas_relevantes } = input;
  const fatA = (Number(faturamento_mensal) || 0) * 12;
  const sk = setorKey(setor);
  const s = SETORES_1N[sk];
  // Prefere sobra real (informada pelo lead) sobre estimativa setorial
  const sobraInformada = Number(sobra_mensal) > 0;
  const ebitda = sobraInformada ? Number(sobra_mensal) * 12 : fatA * s.margem_op;
  let mult = s.multiplo;
  const anos = Number(anos_operacao) || 0;
  if (anos >= 5) mult *= 1.10;       // tempo de mercado consolida valor
  else if (anos < 2) mult *= 0.85;   // negócio novo é mais arriscado
  const operacional = ebitda * mult;
  const ativos = Math.max(0, Number(ativos_relevantes) || 0);
  const dividas = Math.max(0, Number(dividas_relevantes) || 0);
  const central = Math.max(0, operacional + ativos - dividas);
  return {
    valor_min: Math.round(central * 0.85),
    valor_max: Math.round(central * 1.15),
    valor_central: Math.round(central),
    valor_operacional: Math.round(operacional),
    ativos_somados: ativos,
    dividas_subtraidas: dividas,
    faturamento_anual: fatA,
    ebitda_usado: Math.round(ebitda),
    ebitda_fonte: sobraInformada ? "sobra_informada" : "margem_setorial_estimada",
    multiplo_aplicado: Number(mult.toFixed(2)),
    setor_normalizado: sk,
    setor_label: s.label,
    margem_op_setor: s.margem_op,
  };
}
function calcularValuationCompleto(d: any) {
  const base = calcularValuationRapido({
    setor: d.setor, faturamento_mensal: d.faturamento_mensal, anos_operacao: d.anos_operacao,
    sobra_mensal: d.sobra_mensal, ativos_relevantes: d.ativos_relevantes, dividas_relevantes: d.dividas_relevantes,
  });
  let mult = base.multiplo_aplicado;
  const fatores: string[] = [];
  if (d.tem_socios === false) { mult *= 1.10; fatores.push("+10% sem sócios (gestão centralizada)"); }
  if (d.situacao_financeira && /saud|sem divid|sem deuda|sem deve|controlad/i.test(d.situacao_financeira)) {
    mult *= 1.05; fatores.push("+5% situação financeira saudável");
  }
  if (d.situacao_financeira && /divid|atras|deve|inadimpl/i.test(d.situacao_financeira)) {
    mult *= 0.85; fatores.push("-15% dívidas na operação");
  }
  if (d.motivo_venda && /aposent|novo projeto|outro projeto|estrate|mudan[çc]a/i.test(d.motivo_venda)) {
    mult *= 1.05; fatores.push("+5% motivo estratégico");
  }
  if (d.motivo_venda && /urgen|dificu|saude|problema|press/i.test(d.motivo_venda)) {
    mult *= 0.90; fatores.push("-10% motivo de urgência");
  }
  if (d.momento_venda === "URGENTE") { mult *= 0.95; fatores.push("-5% momento urgente"); }
  if (d.momento_venda === "SEM_PRESSA") { mult *= 1.03; fatores.push("+3% sem pressa"); }
  const ebitda = base.ebitda_usado;
  const operacional = ebitda * mult;
  const ativos = base.ativos_somados;
  const dividas = base.dividas_subtraidas;
  const central = Math.max(0, operacional + ativos - dividas);
  return {
    valor_min: Math.round(central * 0.85),
    valor_max: Math.round(central * 1.15),
    valor_central: Math.round(central),
    valor_operacional: Math.round(operacional),
    ativos_somados: ativos,
    dividas_subtraidas: dividas,
    faturamento_anual: base.faturamento_anual,
    ebitda_usado: ebitda,
    ebitda_fonte: base.ebitda_fonte,
    multiplo_aplicado: Number(mult.toFixed(2)),
    setor_normalizado: base.setor_normalizado,
    setor_label: base.setor_label,
    margem_op_setor: base.margem_op_setor,
    fatores_aplicados: fatores,
  };
}

// ─── Notificar Boss ───────────────────────────────────────────────────
async function notificarBoss(texto: string): Promise<boolean> {
  return await enviarWhatsApp(BOSS_PHONE, texto);
}

// ─── Outbound individual ──────────────────────────────────────────────
async function outboundEnviarIndividual(args: { telefone: string; mensagem: string; contexto?: string }) {
  const phone = phoneClean(args.telefone);
  // opt-out check
  const { data: optOut } = await sb.from("hermes_outbound_log")
    .select("id").eq("phone", phone).eq("status", "opt_out").limit(1);
  if (optOut?.length) return { ok: false, erro: "opt_out_anterior" };
  const enviado = await enviarWhatsApp(phone, args.mensagem);
  await sb.from("hermes_outbound_log").insert({
    phone, mensagem: args.mensagem, contexto: args.contexto || null,
    status: enviado ? "enviado" : "falhou",
  });
  return { ok: enviado, telefone: phone };
}

// ─── TOOL DEFINITIONS ─────────────────────────────────────────────────
const TOOLS = [
  // ─── Grupo A · Supabase CRUD ───
  { name: "db_buscar_negocios", description: "Busca negócios publicados/ativos com filtros opcionais.", input_schema: {
    type: "object", properties: {
      setor: { type: "string" }, cidade: { type: "string" }, estado: { type: "string" },
      faixa_preco_min: { type: "number" }, faixa_preco_max: { type: "number" },
      status: { type: "string" }, limit: { type: "integer", default: 10 },
    }, required: [],
  }},
  { name: "db_buscar_negocio_por_id", description: "Busca um negócio pelo id ou código (1N-XXXX ou codigo_diagnostico).", input_schema: {
    type: "object", properties: { negocio_id: { type: "string" }, codigo: { type: "string" } }, required: [],
  }},
  { name: "db_criar_usuario", description: "Cria usuário (vendedor/comprador/desconhecido). Idempotente por telefone.", input_schema: {
    type: "object", properties: {
      nome: { type: "string" }, telefone: { type: "string" },
      perfil: { type: "string", enum: ["vendedor", "comprador", "desconhecido"] },
      email: { type: "string" },
    }, required: ["telefone"],
  }},
  { name: "db_buscar_usuario", description: "Busca usuário por telefone (whatsapp).", input_schema: {
    type: "object", properties: { telefone: { type: "string" } }, required: ["telefone"],
  }},
  { name: "db_criar_negocio", description: "Cria negócio com status rascunho. Aceita todos os campos do diagnóstico.", input_schema: {
    type: "object", properties: {
      vendedor_id: { type: "string" }, nome_negocio: { type: "string" }, setor: { type: "string" },
      cidade: { type: "string" }, estado: { type: "string" }, anos_operacao: { type: "integer" },
      faturamento_mensal: { type: "number" }, modelo_negocio: { type: "string" },
      num_funcionarios: { type: "integer" }, tem_socios: { type: "boolean" }, num_socios: { type: "integer" },
      situacao_financeira: { type: "string" }, motivo_venda: { type: "string" },
      descricao: { type: "string" },
    }, required: [],
  }},
  { name: "db_atualizar_negocio", description: "Atualiza campos de um negócio. Não usar pra mudar status (use db_atualizar_status_negocio).", input_schema: {
    type: "object", properties: {
      negocio_id: { type: "string" },
      campos: { type: "object", additionalProperties: true },
    }, required: ["negocio_id", "campos"],
  }},
  { name: "db_atualizar_status_negocio", description: "Muda status. Para negócios já publicados, requer autorização Boss antes.", input_schema: {
    type: "object", properties: {
      negocio_id: { type: "string" },
      status: { type: "string" },
      motivo: { type: "string" },
    }, required: ["negocio_id", "status"],
  }},
  { name: "db_transferir_titularidade", description: "Vincula vendedor (cria se não existir) ao negocio_id.", input_schema: {
    type: "object", properties: {
      nome: { type: "string" }, telefone: { type: "string" }, negocio_id: { type: "string" },
    }, required: ["telefone", "negocio_id"],
  }},
  { name: "db_criar_tese", description: "Cria tese de investimento pra comprador (teses_investimento).", input_schema: {
    type: "object", properties: {
      usuario_id: { type: "string" }, nome: { type: "string" }, whatsapp: { type: "string" },
      setores: { type: "array", items: { type: "string" } },
      cidade: { type: "string" }, estado: { type: "string" },
      valor_investimento: { type: "string" }, valor_alvo: { type: "number" },
      formas_atuacao: { type: "array", items: { type: "string" } },
      tese_descricao: { type: "string" }, descricao_curta: { type: "string" },
    }, required: [],
  }},
  { name: "db_criar_solicitacao_info", description: "Cria solicitação de informação de um comprador para um negócio.", input_schema: {
    type: "object", properties: {
      negocio_id: { type: "string" }, comprador_id: { type: "string" },
      nome_solicitante: { type: "string" }, whatsapp_solicitante: { type: "string" },
      mensagem: { type: "string" },
    }, required: ["negocio_id"],
  }},
  { name: "db_buscar_leads_recentes", description: "Lista usuários criados nas últimas N horas.", input_schema: {
    type: "object", properties: { horas: { type: "integer", default: 24 }, limit: { type: "integer", default: 50 } }, required: [],
  }},
  { name: "db_atividade_recente_portal", description: "Resumo consolidado de atividade do portal nas últimas N horas: leads novos, negócios criados, solicitações de informação. USE quando Boss perguntar sobre 'novidades', 'o que aconteceu', 'leads de hoje', 'essa noite', 'teve algo novo'.", input_schema: {
    type: "object", properties: { horas: { type: "integer", default: 24 } }, required: [],
  }},
  { name: "db_buscar_negocios_por_status", description: "Lista negócios por status (string ou array).", input_schema: {
    type: "object", properties: {
      status: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
      limit: { type: "integer", default: 30 },
    }, required: ["status"],
  }},
  { name: "db_query_faturamento_mes", description: "Soma transações do mês informado (YYYY-MM). Default = mês corrente.", input_schema: {
    type: "object", properties: { mes: { type: "string", description: "YYYY-MM" } }, required: [],
  }},
  { name: "db_buscar_projetos", description: "Lista solicitações de venda assessorada (solicitacoes_assessorado).", input_schema: {
    type: "object", properties: { status: { type: "string" }, limit: { type: "integer", default: 20 } }, required: [],
  }},
  { name: "db_criar_projeto_assessorado", description: "Cria solicitação de venda assessorada vinculada a um negócio.", input_schema: {
    type: "object", properties: {
      negocio_id: { type: "string" }, usuario_id: { type: "string" },
      nome_solicitante: { type: "string" }, telefone: { type: "string" },
      nome_negocio: { type: "string" }, mensagem_livre: { type: "string" },
    }, required: [],
  }},
  { name: "db_buscar_conversas_hermes", description: "Lista sessões ativas do Hermes nas últimas N horas.", input_schema: {
    type: "object", properties: { horas: { type: "integer", default: 6 }, limit: { type: "integer", default: 30 } }, required: [],
  }},
  { name: "db_backlog", description: "Lista itens do backlog admin filtrados por prioridade.", input_schema: {
    type: "object", properties: { prioridade: { type: "string", enum: ["P0", "P1", "P2", "P3"] }, limit: { type: "integer", default: 30 } }, required: [],
  }},
  { name: "db_get_treinamento", description: "Lista entradas de treinamento ativas (opcional filtrar por categoria/gatilho).", input_schema: {
    type: "object", properties: { filtro: { type: "string", description: "texto livre — busca em categoria/gatilho/conteudo" } }, required: [],
  }},
  { name: "db_add_treinamento", description: "Adiciona entrada ao treinamento dinâmico. Apenas Boss pode.", input_schema: {
    type: "object", properties: {
      categoria: { type: "string" }, gatilho: { type: "string" }, conteudo: { type: "string" },
    }, required: ["conteudo"],
  }},
  { name: "db_remove_treinamento", description: "Marca entrada como inativa pelo id. Apenas Boss pode.", input_schema: {
    type: "object", properties: { id: { type: "string" } }, required: ["id"],
  }},

  // ─── Grupo G · Valuation ───
  { name: "calcular_valuation_rapido", description: "Estimativa rápida — exige os 6 dados mínimos: setor, faturamento_mensal, sobra_mensal (lucro/margem), ativos_relevantes (em R$), dividas_relevantes (em R$) e anos_operacao. Se sobra_mensal informada, usa real; caso contrário usa margem setorial estimada. Ativos somam ao valor, dívidas subtraem.", input_schema: {
    type: "object", properties: {
      setor: { type: "string" },
      faturamento_mensal: { type: "number" },
      sobra_mensal: { type: "number", description: "Quanto sobra por mês (margem/lucro operacional). Se não informado, usa estimativa setorial." },
      ativos_relevantes: { type: "number", description: "Valor total de ativos (equipamentos, estoque, imóvel próprio etc.) em R$. Use 0 se não houver." },
      dividas_relevantes: { type: "number", description: "Total de dívidas / passivos em R$. Use 0 se não houver." },
      anos_operacao: { type: "integer" },
    }, required: ["setor", "faturamento_mensal", "anos_operacao"],
  }},
  { name: "calcular_valuation_completo", description: "Valuation com fatores de ajuste (diagnóstico B1-B15). Aceita os 6 dados + qualificadores qualitativos (sócios, dívidas, motivo, momento de venda).", input_schema: {
    type: "object", properties: {
      setor: { type: "string" },
      faturamento_mensal: { type: "number" },
      sobra_mensal: { type: "number" },
      ativos_relevantes: { type: "number" },
      dividas_relevantes: { type: "number" },
      anos_operacao: { type: "integer" },
      tem_socios: { type: "boolean" }, num_funcionarios: { type: "integer" },
      situacao_financeira: { type: "string" }, motivo_venda: { type: "string" },
      modelo_negocio: { type: "string" },
      momento_venda: { type: "string", enum: ["URGENTE", "SEM_PRESSA", "PENSANDO", "EXPLORANDO"] },
    }, required: ["setor", "faturamento_mensal", "anos_operacao"],
  }},

  // ─── Grupo H · Autorizações ───
  { name: "solicitar_autorizacao_boss", description: "Cria solicitação de autorização ao Boss e envia WhatsApp. Use para NDA, publicação, dossiê, outbound > 5, alteração de publicado.", input_schema: {
    type: "object", properties: {
      tipo: { type: "string", enum: ["nda_liberar_dossie", "publicar_negocio", "outbound_lote", "proposta", "alterar_status_publicado", "acesso_dossie"] },
      descricao: { type: "string", description: "Texto completo enviado ao Boss" },
      descricao_curta: { type: "string", description: "Resumo curto pra confirmação pós-aprovação" },
      negocio_id: { type: "string" }, lead_phone: { type: "string" },
      payload: { type: "object", additionalProperties: true, description: "Dados necessários pra executar a ação após aprovação" },
    }, required: ["tipo", "descricao"],
  }},
  { name: "get_autorizacoes_pendentes", description: "Lista autorizações pendentes (use quando Boss perguntar 'autorizações pendentes').", input_schema: { type: "object", properties: {}, required: [] }},
  { name: "marcar_autorizacao", description: "Marca autorização como aprovada/rejeitada/expirada manualmente. Em geral o sistema faz isso sozinho.", input_schema: {
    type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["aprovada", "rejeitada", "expirada"] } }, required: ["id", "status"],
  }},

  // ─── Comunicação direta ───
  { name: "notificar_boss", description: "Envia notificação direta ao Boss via WhatsApp.", input_schema: {
    type: "object", properties: { mensagem: { type: "string" } }, required: ["mensagem"],
  }},
  { name: "agendar_reuniao", description: "Registra pedido de reunião / Anúncio Guiado / Venda Assessorada / Parceria. Cria entrada em hermes_agendamentos e notifica Boss automaticamente. Use quando lead aceitar um plano que envolve conversar com a equipe.", input_schema: {
    type: "object", properties: {
      lead_nome: { type: "string" },
      lead_telefone: { type: "string", description: "Whatsapp do lead. Se vazio, usa o phone da sessão atual." },
      negocio_id: { type: "string", description: "UUID do negócio relacionado, se houver." },
      caminho: { type: "string", enum: ["vendedor", "comprador", "parceiro"] },
      plano_interesse: { type: "string", description: "Ex: anuncio_guiado, venda_assessorada, filiado, parceiro_pontual, socio_assessor" },
      horario_preferido: { type: "string", description: "Texto livre informado pelo lead (ex: 'amanhã de manhã')" },
      contexto: { type: "string", description: "Resumo livre da conversa que motivou o agendamento" },
    }, required: ["lead_telefone", "caminho", "plano_interesse"],
  }},
  { name: "outbound_enviar_individual", description: "Envia mensagem ativa para um telefone específico. Respeita opt-out e loga.", input_schema: {
    type: "object", properties: {
      telefone: { type: "string" }, mensagem: { type: "string" }, contexto: { type: "string" },
    }, required: ["telefone", "mensagem"],
  }},
];

// ─── TOOL EXECUTOR ────────────────────────────────────────────────────
async function executarTool(name: string, args: any, ctx: { phone: string; isBoss: boolean; sessao: any }): Promise<any> {
  try {
    switch (name) {
      // ─── Grupo A ──────────────────────────
      case "db_buscar_negocios": {
        let q = sb.from("negocios").select("id,codigo,nome_negocio,setor,cidade,estado,preco_pedido,valor_venda,status,titulo_anuncio")
          .limit(Math.min(50, args.limit || 10));
        const setorCanonico = args.setor ? mapearSetorCanonico(args.setor) : null;
        if (setorCanonico) q = q.eq("setor", setorCanonico);
        else if (args.setor) q = q.ilike("setor", `%${args.setor}%`); // fallback ilike se não mapeou
        if (args.cidade) q = q.ilike("cidade", `%${args.cidade}%`);
        if (args.estado) q = q.eq("estado", args.estado.toUpperCase());
        if (args.status) q = q.eq("status", args.status);
        else q = q.eq("status", "publicado");
        if (args.faixa_preco_min) q = q.gte("preco_pedido", args.faixa_preco_min);
        if (args.faixa_preco_max) q = q.lte("preco_pedido", args.faixa_preco_max);
        const { data, error } = await q;
        if (error) return { ok: false, erro: error.message };
        // Resposta cuidadosa quando vazio — Hermes nunca pode dizer "nao temos nada"
        const vazio = !data?.length;
        return {
          ok: true,
          negocios: data || [],
          total: data?.length || 0,
          setor_consultado: setorCanonico || args.setor || null,
          mensagem_se_vazio: vazio
            ? "No momento nao temos nada publicado nesse perfil especifico, mas acabamos de registrar sua tese. Assim que surgir algo compativel voce e o primeiro a saber."
            : null,
        };
      }
      case "db_buscar_negocio_por_id": {
        let q = sb.from("negocios").select("*").limit(1);
        if (args.negocio_id) q = q.eq("id", args.negocio_id);
        else if (args.codigo) q = q.or(`codigo.eq.${args.codigo},codigo_anuncio.eq.${args.codigo},codigo_diagnostico.eq.${args.codigo}`);
        else return { ok: false, erro: "informe negocio_id ou codigo" };
        const { data, error } = await q;
        if (error) return { ok: false, erro: error.message };
        return { ok: true, negocio: data?.[0] || null };
      }
      case "db_criar_usuario": {
        const tel = phoneClean(args.telefone);
        const { data: existing } = await sb.from("usuarios").select("id,nome,whatsapp,tipo").eq("whatsapp", tel).maybeSingle();
        if (existing) return { ok: true, usuario_id: existing.id, ja_existia: true, usuario: existing };
        const tipoMap: Record<string, string> = { vendedor: "sell", comprador: "buy", desconhecido: "sell" };
        const { data, error } = await sb.from("usuarios").insert({
          nome: args.nome || null, whatsapp: tel,
          email: args.email || tel,
          tipo: tipoMap[args.perfil || "desconhecido"] || "sell",
        }).select().single();
        if (error) return { ok: false, erro: error.message };
        return { ok: true, usuario_id: data.id, ja_existia: false };
      }
      case "db_buscar_usuario": {
        const tel = phoneClean(args.telefone);
        const { data } = await sb.from("usuarios").select("id,nome,whatsapp,email,tipo,created_at").eq("whatsapp", tel).maybeSingle();
        return { ok: true, usuario: data || null };
      }
      case "db_criar_negocio": {
        const ins: any = { status: "rascunho" };
        const map: Record<string, string> = {
          vendedor_id: "vendedor_id", nome_negocio: "nome_negocio", setor: "setor",
          cidade: "cidade", estado: "estado", anos_operacao: "tempo_operacao_anos",
          faturamento_mensal: "fat_mensal", modelo_negocio: "modelo_negocio",
          num_funcionarios: "num_funcionarios", num_socios: "num_socios",
          situacao_financeira: "situacao_financeira", motivo_venda: "motivo_venda",
          descricao: "descricao",
        };
        for (const [k, col] of Object.entries(map)) if (args[k] !== undefined) ins[col] = args[k];
        if (args.tem_socios !== undefined) ins.num_socios = args.tem_socios ? (args.num_socios || 1) : 0;
        if (args.faturamento_mensal) ins.fat_anual = Number(args.faturamento_mensal) * 12;
        const { data, error } = await sb.from("negocios").insert(ins).select("id,codigo,codigo_diagnostico").single();
        if (error) return { ok: false, erro: error.message };
        return { ok: true, negocio: data };
      }
      case "db_atualizar_negocio": {
        const { error } = await sb.from("negocios").update(args.campos).eq("id", args.negocio_id);
        if (error) return { ok: false, erro: error.message };
        return { ok: true };
      }
      case "db_atualizar_status_negocio": {
        const { data: cur } = await sb.from("negocios").select("status,notas_admin").eq("id", args.negocio_id).maybeSingle();
        if (!cur) return { ok: false, erro: "negocio_nao_encontrado" };
        if (cur.status === "publicado" && args.status !== "publicado") {
          return { ok: false, erro: "negocio_publicado_requer_autorizacao", dica: "use solicitar_autorizacao_boss com tipo=alterar_status_publicado" };
        }
        const notas = (cur.notas_admin ? cur.notas_admin + "\n" : "") + `[${new Date().toISOString()}] hermes: status ${cur.status} → ${args.status}${args.motivo ? " · " + args.motivo : ""}`;
        const { error } = await sb.from("negocios").update({ status: args.status, notas_admin: notas }).eq("id", args.negocio_id);
        if (error) return { ok: false, erro: error.message };
        return { ok: true, status: args.status };
      }
      case "db_transferir_titularidade": {
        const tel = phoneClean(args.telefone);
        let { data: u } = await sb.from("usuarios").select("id").eq("whatsapp", tel).maybeSingle();
        if (!u) {
          const { data: novo, error } = await sb.from("usuarios").insert({
            nome: args.nome || null, whatsapp: tel, email: tel, tipo: "sell",
          }).select("id").single();
          if (error) return { ok: false, erro: error.message };
          u = novo;
        }
        const { error: e2 } = await sb.from("negocios").update({ vendedor_id: u.id }).eq("id", args.negocio_id);
        if (e2) return { ok: false, erro: e2.message };
        return { ok: true, usuario_id: u.id, negocio_id: args.negocio_id };
      }
      case "db_criar_tese": {
        const ins: any = { status: "novo", origem: "hermes" };
        const map = ["usuario_id", "nome", "whatsapp", "setores", "cidade", "estado", "valor_investimento", "valor_alvo", "formas_atuacao", "tese_descricao", "descricao_curta"];
        for (const k of map) if (args[k] !== undefined) ins[k] = args[k];
        if (ins.whatsapp) ins.whatsapp = phoneClean(ins.whatsapp);
        const { data, error } = await sb.from("teses_investimento").insert(ins).select("id,codigo").single();
        if (error) return { ok: false, erro: error.message };
        return { ok: true, tese: data };
      }
      case "db_criar_solicitacao_info": {
        const ins: any = { negocio_id: args.negocio_id };
        if (args.comprador_id) ins.comprador_id = args.comprador_id;
        if (args.nome_solicitante) ins.nome_solicitante = args.nome_solicitante;
        if (args.whatsapp_solicitante) ins.whatsapp_solicitante = phoneClean(args.whatsapp_solicitante);
        if (args.mensagem) { ins.mensagem = args.mensagem; ins.msg_comprador = args.mensagem; }
        const { data, error } = await sb.from("solicitacoes_info").insert(ins).select("id").single();
        if (error) return { ok: false, erro: error.message };
        return { ok: true, solicitacao_id: data.id };
      }
      case "db_buscar_leads_recentes": {
        const horas = args.horas || 24;
        const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
        const { data, error } = await sb.from("usuarios")
          .select("id,nome,whatsapp,email,tipo,created_at")
          .gte("created_at", desde).order("created_at", { ascending: false })
          .limit(Math.min(100, args.limit || 50));
        if (error) return { ok: false, erro: error.message };
        return { ok: true, leads: data, total: data?.length || 0 };
      }
      case "db_atividade_recente_portal": {
        const horas = args.horas || 24;
        const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
        const [usuariosR, negociosR, solicitacoesR, conversasR] = await Promise.all([
          sb.from("usuarios").select("id,nome,whatsapp,tipo,created_at").gte("created_at", desde).order("created_at", { ascending: false }).limit(30),
          sb.from("negocios").select("id,codigo,codigo_diagnostico,nome_negocio,titulo_anuncio,setor,cidade,estado,status,created_at,vendedor_id").gte("created_at", desde).order("created_at", { ascending: false }).limit(30),
          sb.from("solicitacoes_info").select("id,negocio_id,nome_solicitante,whatsapp_solicitante,mensagem,status,created_at").gte("created_at", desde).order("created_at", { ascending: false }).limit(30),
          sb.from("hermes_sessoes").select("phone,perfil,fluxo_ativo,step_atual,ultima_atividade").gte("ultima_atividade", desde).eq("is_boss", false).eq("arquivada", false).order("ultima_atividade", { ascending: false }).limit(30),
        ]);
        const leads = usuariosR.data || [];
        const negocios = negociosR.data || [];
        const solicitacoes = solicitacoesR.data || [];
        const conversas = conversasR.data || [];
        return {
          ok: true, horas,
          resumo: {
            leads_total: leads.length,
            leads_vendedores: leads.filter((u: any) => u.tipo === "sell").length,
            leads_compradores: leads.filter((u: any) => u.tipo === "buy").length,
            negocios_criados: negocios.length,
            negocios_por_status: negocios.reduce((acc: any, n: any) => { acc[n.status || "?"] = (acc[n.status || "?"] || 0) + 1; return acc; }, {}),
            solicitacoes_info: solicitacoes.length,
            conversas_hermes: conversas.length,
          },
          leads, negocios, solicitacoes, conversas,
        };
      }
      case "db_buscar_negocios_por_status": {
        const status = Array.isArray(args.status) ? args.status : [args.status];
        const { data, error } = await sb.from("negocios")
          .select("id,codigo,nome_negocio,titulo_anuncio,setor,cidade,estado,status,preco_pedido,created_at")
          .in("status", status).order("created_at", { ascending: false })
          .limit(Math.min(100, args.limit || 30));
        if (error) return { ok: false, erro: error.message };
        return { ok: true, negocios: data, total: data?.length || 0 };
      }
      case "db_query_faturamento_mes": {
        const mes = args.mes || new Date().toISOString().slice(0, 7); // YYYY-MM
        const inicio = `${mes}-01`;
        const [y, m] = mes.split("-").map(Number);
        const fim = new Date(y, m, 1).toISOString().slice(0, 10); // 1º dia do próximo mês
        const { data, error } = await sb.from("transacoes")
          .select("tipo,valor,status").gte("created_at", inicio).lt("created_at", fim);
        if (error) return { ok: false, erro: error.message };
        const pagas = (data || []).filter((r: any) => ["pago", "ativo", "concluido"].includes((r.status || "").toLowerCase()));
        const total = pagas.reduce((s, r: any) => s + (Number(r.valor) || 0), 0);
        const por_tipo: Record<string, number> = {};
        pagas.forEach((r: any) => { por_tipo[r.tipo || "outros"] = (por_tipo[r.tipo || "outros"] || 0) + Number(r.valor || 0); });
        return { ok: true, mes, total, count: pagas.length, por_tipo };
      }
      case "db_buscar_projetos": {
        let q = sb.from("solicitacoes_assessorado")
          .select("id,nome_solicitante,telefone,nome_negocio,status,created_at,atendido_em")
          .order("created_at", { ascending: false }).limit(Math.min(100, args.limit || 20));
        if (args.status) q = q.eq("status", args.status);
        const { data, error } = await q;
        if (error) return { ok: false, erro: error.message };
        return { ok: true, projetos: data };
      }
      case "db_criar_projeto_assessorado": {
        const ins: any = { status: "novo" };
        ["negocio_id", "usuario_id", "nome_solicitante", "telefone", "nome_negocio", "mensagem_livre"].forEach(k => {
          if (args[k] !== undefined) ins[k] = args[k];
        });
        if (args.negocio_id) ins.diagnostico_id = args.negocio_id; // alias mais natural
        if (ins.telefone) ins.telefone = phoneClean(ins.telefone);
        const { data, error } = await sb.from("solicitacoes_assessorado").insert(ins).select("id").single();
        if (error) return { ok: false, erro: error.message };
        return { ok: true, projeto_id: data.id };
      }
      case "db_buscar_conversas_hermes": {
        const horas = args.horas || 6;
        const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
        const { data, error } = await sb.from("hermes_sessoes")
          .select("phone,is_boss,perfil,fluxo_ativo,step_atual,ultima_atividade")
          .gte("ultima_atividade", desde).eq("arquivada", false)
          .order("ultima_atividade", { ascending: false })
          .limit(Math.min(100, args.limit || 30));
        if (error) return { ok: false, erro: error.message };
        return { ok: true, conversas: data };
      }
      case "db_backlog": {
        let q = sb.from("backlog_itens").select("id,titulo,area,prioridade,status,ordem")
          .order("ordem", { ascending: true }).limit(Math.min(100, args.limit || 30));
        if (args.prioridade) q = q.eq("prioridade", args.prioridade);
        const { data, error } = await q;
        if (error) return { ok: false, erro: error.message };
        return { ok: true, itens: data };
      }
      case "db_get_treinamento": {
        let q = sb.from("hermes_treinamento").select("id,categoria,gatilho,conteudo,created_at")
          .eq("ativo", true).order("created_at", { ascending: true });
        const { data, error } = await q;
        if (error) return { ok: false, erro: error.message };
        let rows = data || [];
        if (args.filtro) {
          const f = String(args.filtro).toLowerCase();
          rows = rows.filter((r: any) =>
            (r.categoria || "").toLowerCase().includes(f) ||
            (r.gatilho || "").toLowerCase().includes(f) ||
            (r.conteudo || "").toLowerCase().includes(f));
        }
        return { ok: true, entradas: rows };
      }
      case "db_add_treinamento": {
        if (!ctx.isBoss) return { ok: false, erro: "apenas_boss" };
        const { data, error } = await sb.from("hermes_treinamento").insert({
          categoria: args.categoria || null, gatilho: args.gatilho || null,
          conteudo: args.conteudo, criado_por: "boss",
        }).select("id").single();
        if (error) return { ok: false, erro: error.message };
        return { ok: true, id: data.id };
      }
      case "db_remove_treinamento": {
        if (!ctx.isBoss) return { ok: false, erro: "apenas_boss" };
        const { error } = await sb.from("hermes_treinamento").update({ ativo: false }).eq("id", args.id);
        if (error) return { ok: false, erro: error.message };
        return { ok: true };
      }

      // ─── Grupo G ──────────────────────────
      case "calcular_valuation_rapido": return { ok: true, ...calcularValuationRapido(args) };
      case "calcular_valuation_completo": return { ok: true, ...calcularValuationCompleto(args) };

      // ─── Grupo H ──────────────────────────
      case "solicitar_autorizacao_boss": {
        const auth = await criarAutorizacao({
          tipo: args.tipo, descricao: args.descricao, descricao_curta: args.descricao_curta,
          negocio_id: args.negocio_id, lead_phone: args.lead_phone, payload: args.payload || {},
        });
        return { ok: true, codigo: auth.codigo, id: auth.id, status: auth.status };
      }
      case "get_autorizacoes_pendentes": {
        const lista = await getAutorizacoesPendentesTodas();
        return { ok: true, pendentes: lista, total: lista.length };
      }
      case "marcar_autorizacao": {
        if (!ctx.isBoss) return { ok: false, erro: "apenas_boss" };
        await marcarAutorizacao(args.id, args.status);
        return { ok: true };
      }

      // ─── Comunicação direta ───────────────
      case "notificar_boss": {
        // Defesa em profundidade: se estamos numa conversa com lead (não Boss),
        // garante que o número correto do lead apareça no topo. Hermes às vezes
        // escreve o próprio número do Boss por confusão de contexto.
        let mensagem = args.mensagem;
        if (!ctx.isBoss && ctx.phone) {
          // tira qualquer linha "Lead: ..." que Hermes tenha tentado escrever
          mensagem = mensagem.replace(/^\s*Lead:\s*\S+.*$/im, "").trim();
          mensagem = `Lead: ${ctx.phone}\n\n${mensagem}`;
        }
        const enviado = await notificarBoss(mensagem);
        return { ok: enviado };
      }
      case "agendar_reuniao": {
        const tel = phoneClean(args.lead_telefone || ctx.phone);
        const ins: any = {
          lead_nome: args.lead_nome || null,
          lead_telefone: tel,
          negocio_id: args.negocio_id || null,
          caminho: args.caminho || null,
          plano_interesse: args.plano_interesse || null,
          horario_preferido: args.horario_preferido || null,
          contexto: args.contexto || null,
        };
        const { data, error } = await sb.from("hermes_agendamentos").insert(ins).select("id,created_at").single();
        if (error) return { ok: false, erro: error.message };
        // Notifica Boss automaticamente
        const msg = `Lead: ${tel}\n\nAgendamento solicitado\n`
          + `Caminho: ${args.caminho || "—"}\n`
          + `Plano: ${args.plano_interesse || "—"}\n`
          + (args.lead_nome ? `Nome: ${args.lead_nome}\n` : "")
          + (args.horario_preferido ? `Horário preferido: ${args.horario_preferido}\n` : "")
          + (args.contexto ? `\nContexto:\n${args.contexto}` : "");
        await notificarBoss(msg);
        return { ok: true, agendamento_id: data.id };
      }
      case "outbound_enviar_individual": return await outboundEnviarIndividual(args);

      default: return { ok: false, erro: `tool_desconhecida: ${name}` };
    }
  } catch (e: any) {
    console.error(`[hermes] tool ${name} falhou:`, e);
    return { ok: false, erro: e?.message || String(e) };
  }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────
function buildSystemPrompt(opts: {
  isBoss: boolean; sessao: any; treinamentoDinamico: string;
  usuarioExistente?: any; perfilExistente?: string | null;
  simulando?: boolean;
}): string {
  const { isBoss, sessao, treinamentoDinamico, usuarioExistente, perfilExistente, simulando } = opts;

  const bossBlock = isBoss ? `
## Modo Boss ATIVO
Thiago · CEO 1Negócio · autoridade máxima.
Modo operacional total. Linguagem direta e técnica, sem floreio.
Executa qualquer ação solicitada. Confirma antes de destrutivas (apagar, alterar publicados).
Boss pode pedir leitura ("leads de hoje", "backlog P0"), escrita ("publica o 1N-XXXX", "pausa campanha X"),
treinamento ("adiciona ao treinamento: ..."), outbound, e autorizações ("autorizações pendentes").
` : "";

  const simulBlock = simulando ? `
## Modo simulação
Você está em modo simulação. Trate este número exatamente como um lead novo, mesmo que seja o Boss.
Siga todos os fluxos sem atalhos. O Boss vai mandar /astheboss quando quiser sair.
` : "";

  let usuarioBlock = "";
  if (usuarioExistente) {
    const nome = usuarioExistente.nome || "(sem nome)";
    if (perfilExistente === "vendedor") {
      usuarioBlock = `
## Usuário identificado na base
Nome: ${nome}
Tipo: vendedor (já cadastrado)
NUNCA pergunte o nome. Cumprimente pelo nome direto. Pode usar db_buscar_negocio_por_id (ou db_buscar_negocios_por_status com vendedor_id) pra mostrar status do negócio dele se ele perguntar. Pergunte o que ele precisa.
`;
    } else if (perfilExistente === "comprador") {
      usuarioBlock = `
## Usuário identificado na base
Nome: ${nome}
Tipo: comprador (já cadastrado)
NUNCA pergunte o nome. Cumprimente pelo nome direto. Ofereça novidades da tese ou negócios compatíveis (db_buscar_negocios filtrando pelos setores/região da tese dele).
`;
    } else {
      usuarioBlock = `
## Usuário identificado na base
Nome: ${nome}
Tipo: desconhecido (existe na base mas sem perfil definido)
NUNCA pergunte o nome. Cumprimente pelo nome direto. Pergunte se chegou como dono ou comprador.
`;
    }
  }

  return `Você é Hermes, agente da 1Negócio.

## O que é a 1Negócio
A 1Negócio é a primeira plataforma brasileira especializada em compra e venda de empresas para pequenos e médios negócios.

Não é um classificado. É uma mesa de negociação com avaliação técnica, sigilo absoluto e curadoria humana em cada anúncio.

Quem vende: empresário que quer vender seu negócio com apoio profissional, sem expor sua identidade antes da hora.
Quem compra: investidor ou empresário buscando oportunidades avaliadas e curadas — não chute de dono.

Tagline: "Quanto vale o seu negócio? Nós sabemos."

## Apresentação inicial (OBRIGATÓRIA em toda primeira mensagem)
Quando um lead chega pela primeira vez (sem histórico), você se apresenta brevemente ANTES de qualquer pergunta:

"Oi! Sou o Hermes da 1Negócio, plataforma de compra e venda de empresas. [continua com a qualificação ou contexto]"

Se a mensagem pré-preenchida já dá contexto (ex: "Quanto vale meu negócio?"), a apresentação pode ser mais curta:
"Oi! Sou da 1Negócio. [responde direto ao contexto]"

## Produtos
Anúncio gratuito: publicamos com curadoria, 10% só se vender.
Anúncio guiado: R$588/ano, reunião com consultor, 5% comissão.
Venda assessorada: a partir de R$500/mês, time dedicado, 5%.
Laudo PDF: R$99 (só mencionar se perguntarem).
Avaliação Profissional: R$397 (só mencionar se perguntarem).

## Os 3 caminhos
Todo lead é identificado em um dos 3 caminhos:

CAMINHO A — VENDEDOR: dono de negócio querendo avaliar ou vender
CAMINHO B — COMPRADOR: buscando comprar uma empresa
CAMINHO C — PARCEIRO: quer indicar negócios e ganhar comissão, ou ser sócio-assessor

Se não identificado pela mensagem inicial:
"Você chegou aqui como dono de negócio, está buscando comprar uma empresa, ou tem interesse em ser parceiro 1Negócio?"

## Caminho A · Vendedor · Avaliação rápida
Dados MÍNIMOS obrigatórios (não dar valor sem todos eles):
1. Nome do negócio
2. Setor de atuação
3. Faturamento mensal
4. Quanto sobra por mês (margem / lucro operacional)
5. Ativos relevantes (equipamentos, estoque, imóvel próprio?)
6. Passivos / dívidas relevantes

Perguntar um por vez. Nunca juntar. Nunca deduzir. Se o lead não souber um dado, aceite "não sei" e siga.

Após coletar os 6 dados → calcular_valuation_rapido passando setor, faturamento_mensal, sobra_mensal, ativos_relevantes, dividas_relevantes, anos_operacao (estime se não souber, ex: setor padrão = 5 anos).

Apresentar resultado com contexto:
"Com base no que você me passou:
[resumo curto dos dados]

O valor estimado fica entre R$ [min] e R$ [max].

Essa é uma faixa inicial. O diagnóstico completo vai refinar isso com precisão."

## Caminho A · Vendedor · Diagnóstico completo · REGRA RÍGIDA
UMA pergunta por mensagem. Nunca pula um step. Nunca deduz. Nunca combina duas perguntas. Aguarda a resposta antes de avançar.

Fluxo B1-B15:
- B1: Nome e tipo do negócio (capta setor — chaves canônicas: alimentacao, saude, beleza_estetica, educacao, varejo, industria, logistica, construcao, servicos_empresas, bem_estar, hospedagem, servicos_locais)
- B2: Cidade e estado
- B3: Anos de operação
- B4: Faturamento mensal (salva em dados_coletados.faturamento_mensal)
- B5: Quanto sobra por mês (margem / lucro operacional) — salva em dados_coletados.sobra_mensal
- B6: Ativos relevantes (equipamentos, estoque, imóvel próprio?) — salva em dados_coletados.ativos_relevantes (em R$)
- B7: Passivos / dívidas relevantes — salva em dados_coletados.dividas_relevantes (em R$)
- B8: Modelo de negócio (presta serviço, revende, fabrica, outro?)
- B9: Número de funcionários e se tem sócios
- B10: Situação financeira geral (saudável, dívidas, atrasos)
- B11: Motivo da venda — salva em dados_coletados.motivo_venda
- B12: "Você está querendo vender logo ou ainda avaliando com calma?" — classifica em dados_coletados.momento_venda:
    URGENTE = quer vender rápido ("logo", "preciso", "tô apertado")
    SEM_PRESSA = vender se aparecer algo bom ("se aparecer")
    PENSANDO = ainda avaliando ("tô vendo", "não sei")
    EXPLORANDO = só quer saber o valor ("curiosidade")
- B13: "Antes de te passar nossa avaliação — qual é a sua expectativa de valor para o negócio?" — salva em dados_coletados.expectativa_valor (aceita coloquial: "uns 500k" = 500000)
- B14: Nome (PULAR se identificado na base) + confirma whatsapp
- B15: Confirmação. Lista resumo dos dados em texto corrido (sem bullets markdown), pergunta "Tá certo?". Após "tá certo":
  1) db_buscar_usuario (verifica se já existe)
  2) db_criar_usuario se não existe (perfil: vendedor)
  3) db_criar_negocio (status: rascunho, todos os campos coletados)
  4) db_transferir_titularidade
  5) calcular_valuation_completo (passa setor, faturamento_mensal, sobra_mensal, ativos_relevantes, dividas_relevantes, anos_operacao, tem_socios, situacao_financeira, motivo_venda, momento_venda)
  6) notificar_boss com resumo do diagnóstico — o sistema injeta "Lead: <numero>" automaticamente no topo. NUNCA escreva linha "Lead:" no texto da mensagem nem repita o número do lead.
  7) Mensagem final com os 3 CTAs (calibrados por expectativa_valor e momento_venda).

## Entrega do valuation · calibração pela expectativa
Antes de entregar a faixa, compare expectativa_valor com valor_min e valor_max retornados:
- expectativa DENTRO da faixa: entrega direto, valida que está alinhado com mercado.
- expectativa ACIMA do teto: prepara terreno ("O mercado tem premiado negócios assim entre X e Y. Tem fatores que puxam pra cima: recorrência, gestão sem dependência do dono, crescimento. Vou te mostrar onde seu negócio se encaixa hoje, e dá pra trabalhar pra subir.")
- expectativa ABAIXO do piso: confirma positivo ("Boa notícia: o mercado paga mais do que você imagina por isso.")

## CTAs finais do diagnóstico · ordem por momento_venda
- URGENTE: destaca Venda Assessorada primeiro (agilidade, time dedicado), depois Guiado, por último Gratuito.
- SEM_PRESSA: destaca Gratuito primeiro (sem compromisso, comissão só se vender), depois Guiado, por último Assessorada.
- PENSANDO: tom educativo, sem pressão. Ordem neutra Gratuito, Guiado, Assessorada.
- EXPLORANDO: entrega valor, planta semente sem hard-sell ("Quando fizer sentido olhar com mais cuidado, esses são os caminhos:").

Formato base (sem emojis, sem markdown, sem listas com - ou *):

"Pronto, [Nome]. Cadastrado como [codigo].

Valor estimado do seu negócio: R$ [min] a R$ [max].

[parágrafo curto de calibração pela expectativa]

Você tem 3 caminhos:

1) Anúncio gratuito. Publicamos seu negócio com curadoria completa, cuidamos da formatação, sigilo absoluto até o momento certo. Você não paga nada agora — só 10% se vender. Posso te ajudar a preencher agora se quiser.

2) Anúncio guiado por R$588 por ano. Você tem uma reunião com um consultor 1Negócio que refina sua oferta, define estratégia de precificação e aumenta sua visibilidade. Comissão reduz para 5% na venda. Só o pagamento de R$588 para agendar.

3) Venda assessorada. Time dedicado, gestão completa do processo. Ideal para negócios acima de R$500 mil. A partir de R$500 por mês.

[fechamento adaptado ao momento_venda]"

NÃO ofereça Laudo R$99 nem Avaliação R$397 como caminho principal. Só mencione se o cliente perguntar especificamente por documento técnico avulso.

## Pitch completo da Venda Assessorada
Se o lead pedir mais detalhes sobre Assessorada, use este pitch (em múltiplas mensagens curtas com [[SPLIT]] entre blocos densos):

"Na venda assessorada, a gente assume o processo inteiro.

Começamos revisando e refinando sua avaliação para garantir que o valor está posicionado certo no mercado.

Produzimos os materiais estratégicos da oferta — textuais e visuais. Seu negócio é apresentado profissionalmente, sem revelar sua identidade.

Distribuímos na nossa rede de vendedores e parceiros pelo Brasil — corretores, assessores, investidores buscando ativamente.

Fazemos prospecção ativa. Identificamos arquétipos de compradores ideais para o seu tipo de negócio — quem compra para operar e quem compra para expandir. Abordamos esses perfis diretamente.

Garantimos mais de 200 contatos qualificados por mês. Você aprova a lista antes da gente abordar.

Sigilo absoluto até o final. Cada interessado assina confidencialidade e passa por verificação.

Você acompanha tudo em tempo real.

No fechamento, apoio jurídico no contrato final.

O valor mensal investido é abatido da comissão de venda."

Lógica de preço da Assessorada:
- Mensalidade sugerida: aproximadamente 1% do valor estimado do negócio dividido por 12 meses.
- Exemplo: negócio de R$1M → ~R$833/mês.
- Comissão: 5% (com abatimento das mensalidades pagas).
- Quando o lead aceitar avançar com Assessorada (ou Guiado), use a tool agendar_reuniao pra registrar e notificar Boss.

## Caminho B · Comprador
Coletar OBRIGATORIAMENTE (uma pergunta por vez):
1. Tipo de negócio que busca (setor)
2. Região de interesse
3. Faixa de investimento
4. Vai operar ou investir?
5. Nome (PULAR se cadastrado) + número

Após coletar, OBRIGATORIAMENTE nesta ordem:
1) db_buscar_usuario({ telefone })
2) Se não existe → db_criar_usuario({ nome, telefone, perfil: 'comprador' })
3) db_criar_tese ({ usuario_id, setores, cidade, estado, valor_investimento, formas_atuacao, tese_descricao }) — NÃO pode pular essa etapa; é o que ativa o matching automático
4) Confirma pro lead: "Sua tese foi registrada. Vou te avisar quando surgir algo compatível."
5) db_buscar_negocios com os filtros da tese
6) Se houver match → apresentar até 3 negócios (formato texto corrido: nome, setor, cidade, valor)
7) Se vazio → use a mensagem do campo "mensagem_se_vazio" retornado pela tool (já vem pronta)
8) notificar_boss com resumo da tese

NUNCA afirme que não há negócios sem ter chamado db_buscar_negocios primeiro.

## Caminho C · Parceiro
Três perfis dentro do Caminho C:

FILIADO — quer indicar negócios e ganhar comissão por etapa.
Explica modelo: "No nosso programa de filiados, você indica negócios e ganha comissão em cada etapa do funil — não só na venda. A gente gera link e código de rastreio. Quer que eu já te cadastre?"
Coleta nome + telefone → use agendar_reuniao com plano_interesse=filiado, caminho=parceiro.

PARCEIRO PONTUAL — parceria específica (ex: corretor que tem um negócio, advogado, escritório).
Coleta contexto livre. Use agendar_reuniao com plano_interesse=parceiro_pontual, caminho=parceiro.

SÓCIO-ASSESSOR — quer operar a 1Negócio na sua região (modelo 50/50).
"Esse modelo é o sócio-assessor regional. Você opera a 1Negócio na sua cidade ou região, com nossa estrutura, nossa marca, nosso método. Divisão 50/50 da operação. Posso agendar uma conversa com o time para te apresentar o modelo?"
Use agendar_reuniao com plano_interesse=socio_assessor, caminho=parceiro.

## Comportamento quando lead recusa ou some
NUNCA encerrar com "Boa sorte com tudo!" ou frases definitivas de despedida.
Sempre deixar porta aberta: "Sem problema. Quando quiser saber mais, é só chamar."

Se lead some depois de qualificação parcial, retomar em 24h: "Oi [Nome], você estava no meio da avaliação do seu negócio. Continuamos quando quiser."

## Origem do lead
A origem fica em dados_coletados.origem (já é detectada automaticamente):
- ad_quanto_vale: anúncio "Quanto vale meu negócio?". Já está em modo valuation. Vai direto pra avaliação rápida.
- ad_noticia_boa: anúncio de venda de empresa. Confirma o interesse, pergunta se é dono querendo vender ou comprador.
- ad_ja_pensou: lead já cogita vender. Acolhe o momento, entra no fluxo vendedor suave.
- qr_evento: referencia o evento. Tom mais quente.
- qr_material: referencia o material. Tom consultivo.
- organico: qualificação inicial dos 3 caminhos antes de entrar no fluxo.

NÃO repita pra o lead qual a origem dele. Use a info pra ajustar o tom de abertura.

## Metodologia — resposta padrão
Quando perguntarem como calculamos o valor:
"Usamos metodologia própria 1Negócio — combinamos múltiplos de mercado com análise de capacidade de geração de caixa, taxa de risco do negócio e retorno esperado pelo comprador. É uma abordagem desenvolvida internamente."

NUNCA mencione: DCF, ISE, WACC, M&A, Benchmark, ROI, Earnout, Cashflow, Deal, Churn, "8 dimensões". Nunca cite múltiplos exatos por setor.

## Identidade e tom
Nome: Hermes. Sem emojis. Tom direto, humano, experiente.
Uma mensagem, uma ideia. Mensagens curtas.
Tolera informal: "uns 80k" → 80.000.
Áudio = texto (não mencionar transcrição).
Nunca deixar conversa morrer — sempre próximo passo.
Nunca revelar donos, sócios ou número do Boss.

## Formatação das mensagens
- ZERO markdown. Nada de asterisco para negrito, nada de underscore para itálico, nada de hashtag, nada de listas com - ou *. Texto puro.
- Frases curtas. Uma ideia por vez. Tom conversacional, não corporativo.
- Parágrafos separados por uma única linha em branco quando precisar respirar entre ideias.
- Quando fizer sentido natural (uma pergunta separada do contexto, uma pausa antes de informação importante), você PODE dividir a resposta em duas mensagens usando o marcador literal [[SPLIT]] entre elas — o sistema envia em duas mensagens WhatsApp separadas. Máximo um split por turno. Não force.

## Ações sensíveis → solicitar_autorizacao_boss ANTES de executar
- NDA liberar dossiê (tipo: nda_liberar_dossie)
- Publicar anúncio (tipo: publicar_negocio)
- Outbound em lote > 5 (tipo: outbound_lote)
- Alterar status de negócio JÁ publicado (tipo: alterar_status_publicado)
- Liberar acesso dossiê nível 3 (tipo: acesso_dossie)
NUNCA execute essas ações sem autorização prévia.

## Regras de ouro
1. Nunca invente dados, negócios ou preços
2. Nunca prometa o que não está no produto
3. Não revele número ou identidade do Boss
4. Confirme dados antes de salvar (resumo, "tá certo?")
5. Ações destrutivas: autorização Boss
6. Escala se: lead pede humano, negociação ativa, reclamação grave, erro técnico
7. Áudio = texto (sem mencionar transcrição)
8. Coloquial OK: "uns 80k" = 80.000
9. NUNCA use emojis em nenhuma mensagem
10. No diagnóstico: uma pergunta por vez, nunca pula step, nunca combina perguntas

## Treinamento adicional (Boss)
${treinamentoDinamico}

## Sessão atual
Lead phone (whatsapp do interlocutor): ${sessao?.phone || "—"}
Perfil: ${sessao?.perfil || "desconhecido"} · Fluxo: ${sessao?.fluxo_ativo || "—"} · Step: ${sessao?.step_atual || 0}
Dados coletados: ${JSON.stringify(sessao?.dados_coletados || {})}

IMPORTANTE sobre notificar_boss: o sistema injeta "Lead: ${sessao?.phone || ""}" automaticamente no topo da mensagem. NUNCA escreva linha "Lead:" no texto. NUNCA repita o número do lead no corpo. Se mencionar contato no resumo pro Boss, use o nome (ou só "lead novo").
${usuarioBlock}${simulBlock}${bossBlock}`;
}

// ─── Claude loop ──────────────────────────────────────────────────────
async function chamarClaude(opts: {
  phone: string; isBoss: boolean; sessao: any;
  historico: { role: "user" | "assistant"; content: any }[];
  treinamento: string; texto: string;
  usuarioExistente?: any; perfilExistente?: string | null;
  simulando?: boolean;
}): Promise<{ resposta: string }> {
  if (!ANTHROPIC_KEY) return { resposta: "Sistema indisponível no momento (sem chave Claude). Tente novamente em alguns minutos." };

  const system = buildSystemPrompt({
    isBoss: opts.isBoss, sessao: opts.sessao, treinamentoDinamico: opts.treinamento,
    usuarioExistente: opts.usuarioExistente, perfilExistente: opts.perfilExistente,
    simulando: opts.simulando,
  });
  const messages: any[] = [
    ...opts.historico.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: opts.texto },
  ];

  let textoFinal = "";
  for (let iter = 0; iter < MAX_TOOL_ITER; iter++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        system,
        tools: TOOLS,
        messages,
      }),
    });
    if (!r.ok) {
      const errTxt = (await r.text()).slice(0, 500);
      console.error(`[hermes] anthropic ${r.status}: ${errTxt}`);
      return { resposta: "Tive um problema técnico agora. Pode mandar de novo em alguns segundos?" };
    }
    const data = await r.json();

    const blocks = data.content || [];
    const toolUses = blocks.filter((b: any) => b.type === "tool_use");
    const textBlocks = blocks.filter((b: any) => b.type === "text");

    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      textoFinal = textBlocks.map((b: any) => b.text).join("\n\n").trim();
      break;
    }

    // pega texto parcial enquanto roda tools (não envia ao usuário, só log)
    messages.push({ role: "assistant", content: blocks });
    const toolResults = [];
    for (const tu of toolUses) {
      const result = await executarTool(tu.name, tu.input || {}, { phone: opts.phone, isBoss: opts.isBoss, sessao: opts.sessao });
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!textoFinal) textoFinal = "Tô processando aqui... me dá um segundo e te respondo.";
  return { resposta: textoFinal };
}

// ─── Comandos Boss · simulação/teste/público ──────────────────────────
async function handleComandosBoss(phone: string, texto: string, sessao: any, isBoss: boolean): Promise<boolean> {
  if (!isBoss) return false;
  const t = (texto || "").trim().toLowerCase();
  const replyBoss = async (msg: string) => {
    await salvarMensagem(phone, "user", texto);
    await salvarMensagem(phone, "assistant", msg);
    await enviarWhatsApp(phone, msg);
  };

  // /astheboss funciona MESMO em simulação (precisa pra sair)
  if (t === "/astheboss" || t === "/asboss") {
    await sb.from("hermes_sessoes").update({
      is_simulating: false,
      fluxo_ativo: null, step_atual: 0, dados_coletados: {},
    }).eq("phone", phone);
    await replyBoss("Voltei ao modo Boss. O que precisa?");
    return true;
  }

  // /comecar /recomecar · só faz sentido DENTRO da simulação
  // zera histórico + reseta sessão (mantém is_simulating=true)
  if (sessao?.is_simulating && (t === "/comecar" || t === "/recomecar" || t === "/começar")) {
    await sb.from("hermes_conversas").delete().eq("phone", phone);
    await sb.from("hermes_sessoes").update({
      fluxo_ativo: null, step_atual: 0, dados_coletados: {},
      perfil: "desconhecido", is_simulating: true, usuario_id: null,
    }).eq("phone", phone);
    // Não chama replyBoss aqui pra não recriar histórico — só salva o novo turno limpo
    await salvarMensagem(phone, "user", texto);
    const msg = "Conversa zerada. Pode começar.";
    await salvarMensagem(phone, "assistant", msg);
    await enviarWhatsApp(phone, msg);
    return true;
  }

  // Em simulação, demais comandos Boss ficam desligados (passa como lead)
  if (sessao?.is_simulating) return false;

  // "status" · resumo on-demand
  if (t === "status" || t === "/status") {
    try {
      const desdeMeiaNoite = new Date(); desdeMeiaNoite.setHours(0, 0, 0, 0);
      const desdeIso = desdeMeiaNoite.toISOString();
      const [cfgRes, convH, leadsH, diagH, agendH, autorizH, ultLeadR] = await Promise.all([
        sb.from("hermes_config").select("key,value").in("key", ["hermes_ativo"]),
        sb.from("hermes_sessoes").select("phone", { count: "exact", head: true }).gte("ultima_atividade", desdeIso).eq("is_boss", false),
        sb.from("usuarios").select("id", { count: "exact", head: true }).gte("created_at", desdeIso),
        sb.from("negocios").select("id", { count: "exact", head: true }).gte("created_at", desdeIso).neq("status", "rascunho"),
        sb.from("hermes_agendamentos").select("id", { count: "exact", head: true }).gte("created_at", desdeIso),
        sb.from("hermes_autorizacoes").select("id", { count: "exact", head: true }).eq("status", "pendente"),
        sb.from("usuarios").select("nome,created_at").order("created_at", { ascending: false }).limit(1),
      ]);
      const cfgMap: Record<string, string> = {};
      (cfgRes.data || []).forEach((r: any) => { cfgMap[r.key] = r.value; });
      const ativoPublico = (cfgMap.hermes_ativo || "true") !== "false";
      const modo = ativoPublico ? "ATIVO para todos" : "TESTE · só Boss";
      const ultimo = (ultLeadR.data || [])[0];
      const ultimoLeadStr = ultimo?.created_at
        ? `${ultimo.nome || "(sem nome)"} · ${new Date(ultimo.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : "nenhum hoje";
      const msg = `Hermes · status atual\n\n`
        + `Modo: ${modo}\n`
        + `Versão: webhook v9\n\n`
        + `Hoje:\n`
        + `Conversas: ${convH.count || 0}\n`
        + `Diagnósticos: ${diagH.count || 0}\n`
        + `Agendamentos: ${agendH.count || 0}\n`
        + `Autorizações pendentes: ${autorizH.count || 0}\n`
        + `Leads cadastrados: ${leadsH.count || 0}\n\n`
        + `Último lead: ${ultimoLeadStr}`;
      await replyBoss(msg);
    } catch (e) {
      console.error("[hermes] status erro", e);
      await replyBoss("Falhei ao montar o status. Tenta de novo em alguns segundos.");
    }
    return true;
  }

  if (t === "/asclient") {
    await sb.from("hermes_sessoes").update({
      is_simulating: true, perfil: "desconhecido",
      fluxo_ativo: null, step_atual: 0, dados_coletados: {},
    }).eq("phone", phone);
    await replyBoss("Modo cliente ativo. Pode começar.");
    return true;
  }

  // Toggle público OFF · "modo teste" + aliases ("pausa o Hermes")
  if (/^modo teste$/.test(t) || /^(pausa|pausar|para|parar)( o)? hermes$/.test(t)) {
    await sb.from("hermes_config").update({ value: "false", updated_at: new Date().toISOString() }).eq("key", "hermes_ativo");
    await replyBoss("Modo teste ativo. Só você me acessa agora.");
    return true;
  }

  // Toggle público ON · "modo publico" + aliases ("ativa o Hermes")
  if (/^modo p[uú]blico$/.test(t) || /^(ativa|ativar|liga|ligar)( o)? hermes$/.test(t)) {
    await sb.from("hermes_config").update({ value: "true", updated_at: new Date().toISOString() }).eq("key", "hermes_ativo");
    await replyBoss("Hermes ativo para todos.");
    return true;
  }

  return false;
}

// ─── Detecção de origem do lead (primeira mensagem) ──────────────────
function detectarOrigem(texto: string): string {
  const t = (texto || "").toLowerCase();
  if (/quanto vale|valor do (meu )?neg[óo]cio/.test(t)) return "ad_quanto_vale";
  if (/not[íi]cia boa|vi que voc[êe]s vendem/.test(t)) return "ad_noticia_boa";
  if (/tenho pensado em vender|j[áa] pensei em vender/.test(t)) return "ad_ja_pensou";
  if (/vim pelo evento|venho do evento|do evento\s+\S+/i.test(t)) return "qr_evento";
  if (/vim pelo material|venho do material|do material\s+\S+/i.test(t)) return "qr_material";
  return "organico";
}
async function registrarOrigemSeNova(phone: string, texto: string, sessao: any, historicoCount: number): Promise<string | null> {
  // Só registra na PRIMEIRA mensagem (sem histórico) e se origem ainda não está salva
  if (historicoCount > 0) return sessao?.dados_coletados?.origem || null;
  if (sessao?.dados_coletados?.origem) return sessao.dados_coletados.origem;
  const origem = detectarOrigem(texto);
  const novosDados = { ...(sessao?.dados_coletados || {}), origem };
  await sb.from("hermes_sessoes").update({ dados_coletados: novosDados }).eq("phone", phone);
  if (sessao) sessao.dados_coletados = novosDados;
  return origem;
}

// ─── Identificação de usuário já cadastrado ───────────────────────────
async function identificarUsuarioExistente(phone: string, sessao: any): Promise<{ usuario: any | null; perfil: string | null }> {
  if (sessao?.usuario_id) {
    // já vinculado — só carrega
    const { data: u } = await sb.from("usuarios").select("id,nome,whatsapp,tipo").eq("id", sessao.usuario_id).maybeSingle();
    if (!u) return { usuario: null, perfil: null };
    const perfil = u.tipo === "sell" ? "vendedor" : (u.tipo === "buy" ? "comprador" : null);
    return { usuario: u, perfil };
  }
  const { data: u } = await sb.from("usuarios").select("id,nome,whatsapp,tipo").eq("whatsapp", phone).maybeSingle();
  if (!u) return { usuario: null, perfil: null };
  const perfil = u.tipo === "sell" ? "vendedor" : (u.tipo === "buy" ? "comprador" : null);
  await sb.from("hermes_sessoes").update({
    usuario_id: u.id, perfil: perfil || sessao?.perfil || "desconhecido",
  }).eq("phone", phone);
  sessao.usuario_id = u.id;
  if (perfil) sessao.perfil = perfil;
  return { usuario: u, perfil };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: any;
  try { body = await req.json(); } catch { return ok(); } // ignora corpos inválidos

  // ignora grupos / próprias mensagens
  if (body?.phone?.includes?.("@g.us")) return ok();
  if (body?.fromMe) return ok();
  if (!body?.phone) return ok();

  const rawPhone = body.phone;
  const phone = phoneClean(rawPhone);
  if (!phone) return ok();

  let texto = "";
  try { texto = await processarMensagem(body); }
  catch (e) { console.error("[hermes] processarMensagem erro", e); return ok(); }
  if (!texto.trim()) return ok();

  const cfg = await getConfig();
  const bossCfg = phoneClean(cfg.boss_phone || BOSS_PHONE); // normaliza pra evitar mismatch por formato
  const isBoss = phone === bossCfg;
  console.log(`[hermes] incoming · raw='${rawPhone}' · phoneClean='${phone}' · boss='${bossCfg}' · isBoss=${isBoss} · texto='${texto.slice(0, 60).replace(/\n/g, " ")}'`);

  // Idempotência · Z-API às vezes faz retry do webhook em 5-15s
  // Comparação case-insensitive + trim · janela de 30s
  try {
    const cutoff = new Date(Date.now() - 30_000).toISOString();
    const conteudoNorm = (texto || "").trim();
    const { data: dup } = await sb.from("hermes_conversas")
      .select("id")
      .eq("phone", phone).eq("role", "user")
      .ilike("content", conteudoNorm)
      .gte("created_at", cutoff)
      .limit(1);
    if (dup?.length) {
      console.log(`[hermes] dedup · ignorando retry do Z-API · phone=${phone} content='${conteudoNorm.slice(0, 40)}'`);
      return ok();
    }
  } catch (e) { console.error("[hermes] dedup check erro", e); /* segue adiante */ }

  // Gate: hermes_ativo=false pausa público mas Boss sempre passa (modo teste)
  if ((cfg.hermes_ativo || "true") === "false" && !isBoss) return ok();

  const historicoLimit = parseInt(cfg.historico_limit || "30", 10);
  const sessao = await getOuCriarSessao(phone, isBoss);

  // isBossEffective: se Boss está em simulação, trata como lead
  const isBossEffective = isBoss && !sessao?.is_simulating;

  // Comandos Boss (pausa, /asclient, /astheboss) — usa isBoss raw pra /astheboss sair de simulação
  try {
    const handled = await handleComandosBoss(phone, texto, sessao, isBoss);
    if (handled) return ok();
  } catch (e) { console.error("[hermes] handleComandosBoss erro", e); }

  // Boss respondendo autorização (só se efetivamente em modo Boss)
  if (isBossEffective) {
    try {
      const foi = await processarRespostaBoss(phone, texto);
      if (foi) return ok();
    } catch (e) { console.error("[hermes] processarRespostaBoss erro", e); }
  }

  // Identificar usuário já cadastrado (cumprimenta pelo nome, pula coleta)
  // Pula em modo Boss efetivo (Boss não é "usuário")
  let usuarioExistente: any = null;
  let perfilExistente: string | null = null;
  if (!isBossEffective) {
    try {
      const r = await identificarUsuarioExistente(phone, sessao);
      usuarioExistente = r.usuario;
      perfilExistente = r.perfil;
    } catch (e) { console.error("[hermes] identificarUsuarioExistente erro", e); }
  }

  const historico = await getHistorico(phone, historicoLimit);
  const treinamento = await getTreinamento();

  // Detecta origem do lead na primeira mensagem (só não-Boss)
  if (!isBossEffective) {
    try { await registrarOrigemSeNova(phone, texto, sessao, historico.length); }
    catch (e) { console.error("[hermes] registrarOrigem erro", e); }
  }

  await salvarMensagem(phone, "user", texto);
  await atualizarAtividade(phone);

  let resposta = "";
  try {
    const r = await chamarClaude({
      phone, isBoss: isBossEffective, sessao, historico, treinamento, texto,
      usuarioExistente, perfilExistente,
      simulando: !!sessao?.is_simulating,
    });
    resposta = r.resposta;
  } catch (e) {
    console.error("[hermes] chamarClaude erro", e);
    resposta = "Tive um problema técnico agora. Volta a falar comigo em alguns segundos.";
  }

  // Salva histórico com [[SPLIT]] colapsado em quebra dupla — Claude não precisa ver o marcador
  const respostaLimpa = resposta.replace(/\[\[SPLIT\]\]/g, "\n\n");
  await salvarMensagem(phone, "assistant", respostaLimpa);
  // Envia com delay humano + split em N mensagens se o marcador estiver presente
  await enviarRespostaHermes(phone, resposta);

  return ok();
});
