// maquininha-teses · V7 FASE 0 (v2 · fix valor_alvo)
// Gera teses sintéticas via Anthropic API · distribuição alvo do brandbook
// Auth: requer JWT admin (valida via auth.users.phone vs admins.whatsapp)
//        OU service_role key (smoke-test interno · CC sempre trusted)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const SEED_PHONE = "5500000000001";

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── DISTRIBUIÇÕES ALVO ───
const SETORES_DIST: Record<string, number> = {
  alimentacao: 0.18, varejo: 0.15, servicos_empresas: 0.12,
  saude: 0.10, servicos_locais: 0.10, educacao: 0.08,
  beleza_estetica: 0.08, industria: 0.06, construcao: 0.05,
  bem_estar: 0.04, hospedagem: 0.03, logistica: 0.01,
};

const ESTADOS_DIST: Record<string, number> = {
  SP: 0.25, RJ: 0.12, MG: 0.10, RS: 0.10, PR: 0.10, SC: 0.08,
  BA: 0.05, CE: 0.05, GO: 0.05, PE: 0.04, DF: 0.03, ES: 0.03,
};

const CIDADES_POR_ESTADO: Record<string, string[]> = {
  SP: ["São Paulo", "Campinas", "Santos"],
  RJ: ["Rio de Janeiro", "Niterói"],
  MG: ["Belo Horizonte", "Uberlândia"],
  RS: ["Porto Alegre", "Caxias do Sul"],
  PR: ["Curitiba", "Londrina"],
  SC: ["Florianópolis", "Joinville", "Blumenau"],
  BA: ["Salvador"], CE: ["Fortaleza"], GO: ["Goiânia"],
  PE: ["Recife"], DF: ["Brasília"], ES: ["Vitória"],
};

const MODELOS_CANONICOS = [
  "presta_servico", "produz_revende", "fabricacao", "revenda",
  "distribuicao", "vende_governo", "saas", "assinatura",
];

const LOC_DIST = { brasil_todo: 0.50, estado: 0.30, cidade: 0.20 };

// ─── HELPERS ───
function weightedPick<T extends string>(dist: Record<T, number>): T {
  const r = Math.random();
  let acc = 0;
  for (const k in dist) {
    acc += dist[k];
    if (r < acc) return k;
  }
  return Object.keys(dist)[0] as T;
}

function sampleLogNormal(median: number, sigma: number): number {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(Math.log(median) + sigma * z);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function sortearTicketAlvo(): number {
  const v = sampleLogNormal(400_000, 0.9);
  return Math.round(clamp(v, 50_000, 5_000_000) / 5_000) * 5_000;
}

function formatarRangeText(alvo: number): string {
  const min = Math.round(alvo * 0.7 / 1000);
  const max = Math.round(alvo * 1.3 / 1000);
  const fmt = (k: number) => k >= 1000
    ? (k / 1000).toFixed(1).replace(/\.0$/, "") + "M"
    : k + "k";
  return `${fmt(min)}-${fmt(max)}`;
}

function sortearModelos(): string[] {
  if (Math.random() < 0.30) return ["indiferente"];
  const qt = Math.random() < 0.6 ? 1 : 2;
  const pool = [...MODELOS_CANONICOS];
  const out: string[] = [];
  for (let i = 0; i < qt && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

function sortearLocalizacao(estado: string) {
  const tipo = weightedPick(LOC_DIST);
  if (tipo === "brasil_todo") return { localizacao_tipo: "brasil_todo", estado: null, cidade: null };
  if (tipo === "estado") return { localizacao_tipo: "estado", estado, cidade: null };
  const cs = CIDADES_POR_ESTADO[estado] || [];
  const cidade = cs.length ? cs[Math.floor(Math.random() * cs.length)] : null;
  return { localizacao_tipo: "cidade", estado, cidade };
}

// ─── ANTHROPIC ───
async function gerarConteudoTese(ctx: {
  setor: string; estado: string | null; cidade: string | null;
  brasil_todo: boolean; valor_alvo: number; modelos: string[];
}): Promise<{ titulo: string; descricao: string; usou_fallback: boolean }> {
  const fmt = (v: number) => `R$ ${v.toLocaleString("pt-BR")}`;
  const localTxt = ctx.brasil_todo ? "Brasil todo"
    : (ctx.cidade ? `${ctx.cidade}/${ctx.estado}` : ctx.estado);
  const modelosTxt = ctx.modelos[0] === "indiferente"
    ? "indiferente · não filtra"
    : ctx.modelos.join(" · ");

  const prompt = `Você gera teses de investimento ficcionais pra teste de plataforma de M&A brasileira.
NUNCA use emoji. NUNCA use jargão sem explicar. Português brasileiro coloquial.
Retorne APENAS JSON válido · sem markdown · sem comentários.

CONTEXTO:
Setor: ${ctx.setor}
Localização: ${localTxt}
Ticket alvo (tolerância ±30%): ${fmt(ctx.valor_alvo)}
Modelos: ${modelosTxt}

GERE:
{
  "titulo": "string · máx 60 chars · descritivo · sem nome próprio fictício",
  "descricao": "string · 2-3 frases · perfil do comprador e racional do investimento"
}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`anthropic ${r.status}: ${err.slice(0, 160)}`);
    }
    const data = await r.json();
    const txt = data?.content?.[0]?.text || "";
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch {}
    if (!parsed) {
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    if (parsed?.titulo && parsed?.descricao) {
      return {
        titulo: String(parsed.titulo).slice(0, 80),
        descricao: String(parsed.descricao).slice(0, 600),
        usou_fallback: false,
      };
    }
    throw new Error("parse falhou");
  } catch (e) {
    const tit = `${ctx.setor.replace(/_/g, " ")} · ${localTxt}`;
    return {
      titulo: tit.slice(0, 60),
      descricao: `Comprador busca negócio em ${ctx.setor.replace(/_/g, " ")}${localTxt ? " em " + localTxt : ""} · ticket alvo ${fmt(ctx.valor_alvo)} (tolerância ±30%).`,
      usou_fallback: true,
    };
  }
}

// ─── SEED USER ───
async function getSeedUserId(): Promise<string> {
  // Tenta via RPC first (mais rápido)
  try {
    const { data: rows } = await adminClient.rpc("get_user_by_phone", { p_phone: "+" + SEED_PHONE });
    if (Array.isArray(rows) && rows[0]?.id) return rows[0].id;
  } catch {}
  // Fallback: cria via auth admin (idempotente · phone unique)
  const { data: created, error: cerr } = await adminClient.auth.admin.createUser({
    phone: "+" + SEED_PHONE,
    phone_confirm: true,
    user_metadata: { nome: "Seed Maquininha", origem: "maquininha-seed" },
  });
  if (cerr) {
    // pode já existir · tenta listar
    const { data: list } = await adminClient.auth.admin.listUsers();
    const u = list?.users?.find((x: any) => x.phone === SEED_PHONE);
    if (u?.id) return u.id;
    throw new Error("seed user: " + cerr.message);
  }
  return created!.user!.id;
}

// ─── ADMIN GATE (com bypass service_role · valida via decode JWT role) ───
function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

async function isAdminOrServiceRole(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);

  // Bypass service_role: decodifica JWT e checa role · tokens Supabase têm 'role' no claim
  const payload = decodeJwtPayload(token);
  if (payload?.role === "service_role") return true;

  // Caso normal: admin via phone match em admins.whatsapp
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user) return false;
    const phone = data.user.phone;
    if (!phone) return false;
    const { count } = await adminClient
      .from("admins")
      .select("id", { count: "exact", head: true })
      .eq("whatsapp", phone)
      .eq("ativo", true);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

// ─── HEARTBEAT + COUNTERS via UPDATE direto ───
async function bumpGen(geracaoId: string, fields: { gerada?: boolean; falhada?: boolean }, heartbeat?: any) {
  // Não dá pra fazer i++ atomico em uma query só sem RPC · faz read-modify-write simples
  const { data: cur } = await adminClient
    .from("maquininha_teses_geracoes")
    .select("qtd_gerada, qtd_falhada, log_resumo")
    .eq("id", geracaoId)
    .single();
  if (!cur) return;
  const upd: any = {};
  if (fields.gerada) upd.qtd_gerada = (cur.qtd_gerada || 0) + 1;
  if (fields.falhada) upd.qtd_falhada = (cur.qtd_falhada || 0) + 1;
  if (heartbeat) {
    upd.log_resumo = { ...(cur.log_resumo || {}), ...heartbeat };
  }
  await adminClient
    .from("maquininha_teses_geracoes")
    .update(upd)
    .eq("id", geracaoId);
}

// ─── BATCH ───
async function rodarBatch(geracaoId: string, qtd: number, modo: string) {
  let seedUserId: string;
  try {
    seedUserId = await getSeedUserId();
  } catch (e) {
    await adminClient
      .from("maquininha_teses_geracoes")
      .update({
        status: "falha",
        concluido_em: new Date().toISOString(),
        log_resumo: { erro: "seed user: " + (e as Error).message },
      })
      .eq("id", geracaoId);
    return;
  }

  const distSetores: Record<string, number> = {};
  const distEstados: Record<string, number> = {};
  const tickets: number[] = [];
  const erros: Array<{ i: number; msg: string }> = [];
  let qtdGerada = 0;
  let qtdFalhada = 0;
  let usouFallbackCount = 0;

  for (let i = 0; i < qtd; i++) {
    try {
      const setor = weightedPick(SETORES_DIST);
      const estado = weightedPick(ESTADOS_DIST);
      const loc = sortearLocalizacao(estado);
      const ticketAlvo = sortearTicketAlvo();
      const modelos = sortearModelos();
      const usaIndif = modelos.length === 1 && modelos[0] === "indiferente";

      const conteudo = await gerarConteudoTese({
        setor,
        estado: loc.estado,
        cidade: loc.cidade,
        brasil_todo: loc.localizacao_tipo === "brasil_todo",
        valor_alvo: ticketAlvo,
        modelos,
      });
      if (conteudo.usou_fallback) usouFallbackCount++;

      const row: any = {
        usuario_id: seedUserId,
        nome: "Seed Maquininha",
        whatsapp: SEED_PHONE,
        titulo: conteudo.titulo,
        tese_descricao: conteudo.descricao,
        setores: [setor],
        formas_atuacao: usaIndif ? null : modelos,
        localizacao_tipo: loc.localizacao_tipo,
        estado: loc.estado,
        cidade: loc.cidade,
        valor_alvo: ticketAlvo,
        valor_investimento: formatarRangeText(ticketAlvo),
        status: "ativa",
        origem: "sintetica",
        geracao_id: geracaoId,
      };

      const { error: ierr } = await adminClient.from("teses_investimento").insert(row);
      if (ierr) throw ierr;

      qtdGerada++;
      distSetores[setor] = (distSetores[setor] || 0) + 1;
      distEstados[loc.estado || "BR"] = (distEstados[loc.estado || "BR"] || 0) + 1;
      tickets.push(ticketAlvo);
    } catch (e) {
      qtdFalhada++;
      const msg = (e as any)?.message || String(e);
      console.error(`[maquininha ${i}] err: ${msg}`);
      if (erros.length < 20) erros.push({ i, msg: String(msg).slice(0, 200) });
    }

    // Heartbeat a cada 5 teses
    if ((i + 1) % 5 === 0 || i === qtd - 1) {
      await bumpGen(geracaoId, {}, {
        progresso: i + 1,
        total: qtd,
        ultima_atualizacao: new Date().toISOString(),
      });
      // Atualiza qtd_gerada + qtd_falhada em batches
      await adminClient
        .from("maquininha_teses_geracoes")
        .update({ qtd_gerada: qtdGerada, qtd_falhada: qtdFalhada })
        .eq("id", geracaoId);
    }
  }

  // Smoke validation
  let validacao: any = null;
  if (modo === "smoke") {
    let max_desvio = 0;
    for (const k in SETORES_DIST) {
      const real = (distSetores[k] || 0) / Math.max(qtdGerada, 1);
      const desv = Math.abs(real - SETORES_DIST[k]);
      if (desv > max_desvio) max_desvio = desv;
    }
    validacao = {
      max_desvio_setorial: Number(max_desvio.toFixed(4)),
      tolerancia: 0.10,
      go_no_go: max_desvio <= 0.10 ? "GO" : "REVIEW",
    };
  }

  const tickets_sorted = [...tickets].sort((a, b) => a - b);
  const mediana = tickets_sorted[Math.floor(tickets_sorted.length / 2)] || 0;

  await adminClient
    .from("maquininha_teses_geracoes")
    .update({
      status: qtdFalhada > qtd * 0.5 ? "falha" : "concluida",
      qtd_gerada: qtdGerada,
      qtd_falhada: qtdFalhada,
      custo_estimado_usd: Number((qtd * 0.0008).toFixed(4)),
      concluido_em: new Date().toISOString(),
      log_resumo: {
        modelo: ANTHROPIC_MODEL,
        dist_setores: distSetores,
        dist_estados: distEstados,
        ticket_min: tickets.length ? Math.min(...tickets) : 0,
        ticket_max: tickets.length ? Math.max(...tickets) : 0,
        ticket_mediana: mediana,
        usou_fallback: usouFallbackCount,
        erros: erros.slice(0, 10),
        validacao,
      },
    })
    .eq("id", geracaoId);
}

// ─── HANDLER ───
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo nao permitido" }, 405);

  if (!(await isAdminOrServiceRole(req))) {
    return json({ ok: false, error: "admin ou service_role required" }, 403);
  }

  let body: { qtd?: number; modo?: string };
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "JSON invalido" }, 400); }

  const modo = body.modo === "smoke" ? "smoke" : "gerar";
  let qtd = Number.isFinite(body.qtd) ? Math.floor(body.qtd!) : 100;
  if (modo === "smoke" && !Number.isFinite(body.qtd)) qtd = 50;
  qtd = Math.min(500, Math.max(1, qtd));

  let iniciado_por: string | null = null;
  try {
    const auth = req.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ") && auth.slice(7) !== SUPABASE_SERVICE_ROLE_KEY) {
      const { data } = await adminClient.auth.getUser(auth.slice(7));
      iniciado_por = data.user?.id || null;
    }
  } catch {}

  const { data: ger, error: gerr } = await adminClient
    .from("maquininha_teses_geracoes")
    .insert({
      qtd_solicitada: qtd,
      status: "rodando",
      iniciado_por,
      parametros: { qtd, modo, modelo: ANTHROPIC_MODEL },
    })
    .select("id")
    .single();

  if (gerr || !ger?.id) return json({ ok: false, error: "erro criar geracao: " + (gerr?.message || "?") }, 500);

  const geracaoId = ger.id;
  // @ts-ignore EdgeRuntime existe em Supabase Functions
  const hasWaitUntil = typeof EdgeRuntime !== "undefined" && typeof (EdgeRuntime as any).waitUntil === "function";
  if (hasWaitUntil) {
    // @ts-ignore
    (EdgeRuntime as any).waitUntil(rodarBatch(geracaoId, qtd, modo));
    return json({ ok: true, geracao_id: geracaoId, qtd, modo, async: true });
  } else {
    // Fallback inline · resposta espera batch terminar (até timeout limit · ~60s)
    await rodarBatch(geracaoId, qtd, modo);
    return json({ ok: true, geracao_id: geracaoId, qtd, modo, async: false });
  }
});
