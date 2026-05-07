// maquininha-teses · V7 FASE 0 · 1negocio.com.br
// Gera teses sintéticas via Anthropic API · distribuição alvo do brandbook
// Auth: requer JWT admin (valida via is_admin_atual)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
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

// ─── DISTRIBUIÇÕES ALVO (B111.1 spec) ───
const SETORES_DIST: Record<string, number> = {
  alimentacao: 0.18,
  varejo: 0.15,
  servicos_empresas: 0.12,
  saude: 0.10,
  servicos_locais: 0.10,
  educacao: 0.08,
  beleza_estetica: 0.08,
  industria: 0.06,
  construcao: 0.05,
  bem_estar: 0.04,
  hospedagem: 0.03,
  logistica: 0.01,
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
  BA: ["Salvador"],
  CE: ["Fortaleza"],
  GO: ["Goiânia"],
  PE: ["Recife"],
  DF: ["Brasília"],
  ES: ["Vitória"],
};

const MODELOS_CANONICOS = [
  "presta_servico", "produz_revende", "fabricacao", "revenda",
  "distribuicao", "vende_governo", "saas", "assinatura",
];

// Localização: 50% brasil_todo · 30% estado · 20% cidade
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

// Box-Muller pra gaussian normal · convertido pra log-normal
function sampleLogNormal(median: number, sigma: number): number {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mu = Math.log(median);
  return Math.exp(mu + sigma * z);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function sortearTicket(): number {
  // Mediana ~400k · sigma 0.9 → mass concentrada 100k-1.5M com cauda até 5M
  const v = sampleLogNormal(400_000, 0.9);
  return Math.round(clamp(v, 50_000, 5_000_000) / 5_000) * 5_000;
}

function sortearModelos(): string[] {
  const r = Math.random();
  if (r < 0.30) return ["indiferente"]; // 30% indiferente
  // 70% têm 1-2 modelos sorteados aleatoriamente
  const qt = Math.random() < 0.6 ? 1 : 2;
  const pool = [...MODELOS_CANONICOS];
  const out: string[] = [];
  for (let i = 0; i < qt && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function sortearLocalizacao(estado: string) {
  const tipo = weightedPick(LOC_DIST);
  if (tipo === "brasil_todo") return { localizacao_tipo: "brasil_todo", estado: null, cidade: null };
  if (tipo === "estado") return { localizacao_tipo: "estado", estado, cidade: null };
  // cidade
  const cidades = CIDADES_POR_ESTADO[estado] || [];
  const cidade = cidades.length ? cidades[Math.floor(Math.random() * cidades.length)] : null;
  return { localizacao_tipo: "cidade", estado, cidade };
}

// ─── ANTHROPIC CALL ───
async function gerarConteudoTese(ctx: {
  setor: string; estado: string | null; cidade: string | null;
  brasil_todo: boolean; valor_min: number; valor_max: number;
  modelos: string[];
}): Promise<{ titulo: string; descricao: string }> {
  const fmt = (v: number) => `R$ ${v.toLocaleString("pt-BR")}`;
  const localTxt = ctx.brasil_todo
    ? "Brasil todo"
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
Faixa de ticket: ${fmt(ctx.valor_min)} a ${fmt(ctx.valor_max)}
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
      throw new Error(`anthropic ${r.status}: ${err.slice(0, 200)}`);
    }
    const data = await r.json();
    const txt = data?.content?.[0]?.text || "";
    // tenta extrair JSON · com fallback regex
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
      };
    }
    throw new Error("parse falhou");
  } catch (e) {
    // Fallback genérico determinístico
    const tit = `${ctx.setor.replace(/_/g, " ")} · ${localTxt}`;
    return {
      titulo: tit.slice(0, 60),
      descricao: `Comprador busca negócio em ${ctx.setor.replace(/_/g, " ")} ${localTxt ? "em " + localTxt : ""} · ticket ${fmt(ctx.valor_min)} a ${fmt(ctx.valor_max)}.`,
    };
  }
}

// ─── SEED USER ───
async function getSeedUserId(): Promise<string> {
  const { data } = await adminClient
    .from("usuarios")
    .select("id")
    .limit(0); // não-faz nada · só pra garantir client funciona
  // busca em auth.users via service role
  const { data: rows, error } = await adminClient.rpc("get_user_by_phone", { p_phone: "+" + SEED_PHONE });
  if (!error && Array.isArray(rows) && rows[0]?.id) return rows[0].id;
  // fallback · cria
  const { data: created, error: cerr } = await adminClient.auth.admin.createUser({
    phone: "+" + SEED_PHONE,
    phone_confirm: true,
    user_metadata: { nome: "Seed Maquininha", origem: "maquininha-seed" },
  });
  if (cerr || !created?.user) throw new Error("seed user create: " + (cerr?.message || "unknown"));
  return created.user.id;
}

// ─── ADMIN VALIDATION ───
async function isAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
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

// ─── BATCH GENERATION ───
async function rodarBatch(geracaoId: string, qtd: number, modo: string) {
  const seedUserId = await getSeedUserId();
  let qtdGerada = 0;
  let qtdFalhada = 0;
  const distSetores: Record<string, number> = {};
  const distEstados: Record<string, number> = {};
  const tickets: number[] = [];

  for (let i = 0; i < qtd; i++) {
    try {
      const setor = weightedPick(SETORES_DIST);
      const estado = weightedPick(ESTADOS_DIST);
      const loc = sortearLocalizacao(estado);
      const ticket = sortearTicket();
      const valor_min = Math.round(ticket * 0.7 / 5000) * 5000;
      const valor_max = Math.round(ticket * 1.5 / 5000) * 5000;
      const modelos = sortearModelos();
      const usaIndiferente = modelos.length === 1 && modelos[0] === "indiferente";

      const { titulo, descricao } = await gerarConteudoTese({
        setor,
        estado: loc.estado,
        cidade: loc.cidade,
        brasil_todo: loc.localizacao_tipo === "brasil_todo",
        valor_min, valor_max,
        modelos,
      });

      const row: any = {
        usuario_id: seedUserId,
        nome: "Seed Maquininha",
        whatsapp: SEED_PHONE,
        titulo,
        tese_descricao: descricao,
        setores: [setor],
        formas_atuacao: usaIndiferente ? null : modelos,
        localizacao_tipo: loc.localizacao_tipo,
        estado: loc.estado,
        cidade: loc.cidade,
        valor_investimento: `${valor_min}-${valor_max}`,
        status: "ativa",
        origem: "sintetica",
        geracao_id: geracaoId,
      };

      const { error: ierr } = await adminClient
        .from("teses_investimento")
        .insert(row);

      if (ierr) {
        qtdFalhada++;
        console.error(`[maquininha ${i}] insert err:`, ierr.message);
        continue;
      }
      qtdGerada++;
      distSetores[setor] = (distSetores[setor] || 0) + 1;
      const eKey = loc.estado || "BR";
      distEstados[eKey] = (distEstados[eKey] || 0) + 1;
      tickets.push(ticket);
    } catch (e) {
      qtdFalhada++;
      console.error(`[maquininha ${i}] err:`, (e as Error).message);
    }
  }

  // Smoke validation se qtd=50 e modo='smoke'
  let validacao: any = null;
  if (modo === "smoke") {
    const desvios: Record<string, number> = {};
    for (const k in SETORES_DIST) {
      const real = (distSetores[k] || 0) / Math.max(qtdGerada, 1);
      const alvo = SETORES_DIST[k];
      desvios[k] = Math.abs(real - alvo);
    }
    const max_desvio = Math.max(...Object.values(desvios));
    validacao = {
      max_desvio_setorial: max_desvio,
      tolerancia: 0.05,
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
      custo_estimado_usd: qtd * 0.0017,
      concluido_em: new Date().toISOString(),
      log_resumo: {
        dist_setores: distSetores,
        dist_estados: distEstados,
        ticket_min: Math.min(...tickets, 0) || 0,
        ticket_max: Math.max(...tickets, 0) || 0,
        ticket_mediana: mediana,
        validacao,
      },
    })
    .eq("id", geracaoId);
}

// ─── HANDLER ───
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo nao permitido" }, 405);

  // Admin gate
  const okAdmin = await isAdmin(req.headers.get("authorization"));
  if (!okAdmin) return json({ ok: false, error: "admin required" }, 403);

  let body: { qtd?: number; modo?: string };
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "JSON invalido" }, 400); }

  const modo = body.modo === "smoke" ? "smoke" : "gerar";
  let qtd = Number.isFinite(body.qtd) ? Math.floor(body.qtd!) : 100;
  if (modo === "smoke") qtd = 50;
  qtd = Math.min(500, Math.max(10, qtd));

  // Get caller user id pra iniciado_por
  let iniciado_por: string | null = null;
  try {
    const auth = req.headers.get("authorization") || "";
    const { data } = await adminClient.auth.getUser(auth.slice(7));
    iniciado_por = data.user?.id || null;
  } catch {}

  const { data: ger, error: gerr } = await adminClient
    .from("maquininha_teses_geracoes")
    .insert({
      qtd_solicitada: qtd,
      status: "rodando",
      iniciado_por,
      parametros: { qtd, modo },
    })
    .select("id")
    .single();

  if (gerr || !ger?.id) return json({ ok: false, error: "erro criar geracao: " + (gerr?.message || "unknown") }, 500);

  const geracaoId = ger.id;
  // dispara em background · responde imediato
  // @ts-ignore EdgeRuntime existe em Supabase Functions
  if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
    (EdgeRuntime as any).waitUntil(rodarBatch(geracaoId, qtd, modo));
  } else {
    rodarBatch(geracaoId, qtd, modo).catch(e => console.error("batch err:", e));
  }

  return json({ ok: true, geracao_id: geracaoId, qtd, modo });
});
