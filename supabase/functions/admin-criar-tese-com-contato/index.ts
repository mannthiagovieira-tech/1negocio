// admin-criar-tese-com-contato · v9.19.3 · 1Negócio
// Atalho admin pra criar tese: resolve contato (existing por whatsapp OU novo)
// e cria tese vinculada com estrutura canônica IDÊNTICA aos outros fluxos +
// preenche AMBOS valor_alvo (numeric) e valor_investimento (text "min-max") +
// localizacao_tipo explícito · origem='admin'.
//
// v9.19.1 · try/catch externo + logs detalhados + retorna {detalhe, code, hint, step}
// nos erros 500 pra debug · maybeSingle em vez de single pós-INSERT.
//
// v9.19.2 · FIX FK 23503: FK teses_investimento.usuario_id aponta pra auth.users(id),
// não public.usuarios(id). Edge agora replica pattern canônico de socio-cadastrar-tese:
// findOrCreateGhostAuth (busca/cria em auth.users) → ensureUsuarioRow espelha em
// public.usuarios com MESMO id. Antes a edge criava só em public.usuarios e tomava
// 23503 ao tentar INSERT em teses_investimento.
//
// v9.19.3 · Z-API tokens hardcoded estavam revogados (curl retornou 403
// "Client-Token not allowed"). Padrão canônico do projeto usa env vars
// (ZAPI_INSTANCE, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN) · alinhado com
// solicitar-assessorado, chat-ia, cowork-gerar-plano-diario, etc.
// Edge também retorna agora whatsapp_detalhe explicando o motivo da falha
// (status HTTP + corpo da resposta Z-API).
//
// POST {
//   telefone_raw,
//   nome_contato?,                  // obrigatório se contato é novo
//   dados_tese: {
//     titulo, descricao_curta, setores[], formas_atuacao[],
//     localizacao_tipo, estado?, cidade?,
//     valor_min, valor_max,         // ambos numbers (em R$)
//     descricao_adicional?
//   }
// }
// → 200 { ok, contato, tese, novo_contato, whatsapp_ok }
// → 400/403/409 erros padronizados
//
// Auth · JWT admin (gate canônico)
// verify_jwt · true

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// v9.19.3 · Z-API agora vem de env vars (tokens hardcoded estavam revogados)
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";

const SETORES_VALIDOS = new Set([
  "servicos_empresas","varejo","saude","alimentacao","beleza_estetica",
  "educacao","servicos_locais","bem_estar","industria","construcao","hospedagem","logistica",
]);
const FORMAS_VALIDAS = new Set([
  "presta_servico","produz_revende","fabricacao","revenda",
  "distribuicao","vende_governo","saas","assinatura",
]);
const LOC_TIPOS_VALIDOS = new Set(["brasil_todo","estado","cidade"]);
const UFS_VALIDAS = new Set([
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA",
  "PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
]);

const SETOR_LBL: Record<string,string> = {
  servicos_empresas:"Serviços p/ empresas", varejo:"Varejo", saude:"Saúde",
  alimentacao:"Alimentação", beleza_estetica:"Beleza & estética", educacao:"Educação",
  servicos_locais:"Serviços locais", bem_estar:"Bem-estar", industria:"Indústria",
  construcao:"Construção", hospedagem:"Hospedagem", logistica:"Logística",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function decodeJwtPayload(t: string): any | null {
  try {
    const p = t.split(".");
    if (p.length !== 3) return null;
    const b64 = p[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
  } catch { return null; }
}

async function gateAdmin(req: Request): Promise<{ ok: boolean; admin_id?: string | null }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true, admin_id: null };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.phone) return { ok: false };
    const { data: admin } = await adminClient.from("admins")
      .select("id").eq("whatsapp", data.user.phone).eq("ativo", true).maybeSingle();
    if (admin?.id) return { ok: true, admin_id: admin.id };
  } catch {}
  return { ok: false };
}

function normalizarTelefone(raw: string): string | null {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return null;
  let out = d;
  if (!out.startsWith("55")) out = "55" + out;
  // Aceita 55 + DDD(2) + 8|9 dígitos = 12 ou 13 chars
  if (out.length < 12 || out.length > 13) return null;
  return out;
}

function brl(v: number | null | undefined): string {
  if (v == null) return "—";
  return "R$ " + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function faixaTexto(min: number, max: number): string {
  return `${brl(min)} – ${brl(max)}`;
}

// v9.19.2 · pattern canônico (cópia de socio-cadastrar-tese · ajustado pro admin)
// 1. Busca user em auth.users por phone (paginado) · se acha, retorna id
// 2. Se não acha, cria com auth.admin.createUser({ phone, phone_confirm:false })
// 3. Retorna user_id que com certeza existe em auth.users → FK em teses passa
async function findOrCreateAuthUser(phoneCom55: string, nome: string | null): Promise<{ user_id: string | null; novo: boolean; erro?: string }> {
  const phoneRaw = phoneCom55.replace(/^55/, "");
  async function buscar(): Promise<any | null> {
    for (let page = 1; page <= 5; page++) {
      try {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data?.users?.length) return null;
        const found = data.users.find((u: any) => {
          const p = String(u.phone || "").replace(/\D/g, "");
          const meta = String(u.user_metadata?.phone || "").replace(/\D/g, "");
          return p === phoneCom55 || p === phoneRaw || meta === phoneCom55 || meta === phoneRaw;
        });
        if (found) return found;
        if (data.users.length < 1000) return null;
      } catch (e) { console.warn("[admin-criar-tese auth listUsers p", page, "]", (e as Error).message); return null; }
    }
    return null;
  }
  const existing = await buscar();
  if (existing) return { user_id: existing.id, novo: false };
  try {
    const { data: created, error } = await adminClient.auth.admin.createUser({
      phone: phoneCom55,
      phone_confirm: false,
      user_metadata: { nome: nome || "Contato", admin_cadastrou: true },
    });
    if (!error && created.user?.id) return { user_id: created.user.id, novo: true };
    console.warn("[admin-criar-tese auth createUser err]", error?.message);
    const retry = await buscar();
    if (retry) return { user_id: retry.id, novo: false };
    return { user_id: null, novo: false, erro: error?.message || "createUser falhou sem detalhe" };
  } catch (e) {
    return { user_id: null, novo: false, erro: (e as Error).message };
  }
}

async function ensureUsuarioRow(userId: string, nome: string | null, phoneCom55: string): Promise<{ id: string; nome: string; whatsapp: string; email: string | null }> {
  const { data: existing } = await adminClient.from("usuarios")
    .select("id, nome, whatsapp, email").eq("id", userId).maybeSingle();
  if (existing) return existing as any;
  const { data: novo } = await adminClient.from("usuarios")
    .insert({ id: userId, whatsapp: phoneCom55, nome: nome || "Contato", tipo: "buy" })
    .select("id, nome, whatsapp, email").single();
  return (novo || { id: userId, nome: nome || "Contato", whatsapp: phoneCom55, email: null }) as any;
}

async function enviarWhatsApp(telefone: string, mensagem: string): Promise<{ ok: boolean; detalhe?: string }> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) {
    return { ok: false, detalhe: "envs Z-API ausentes (ZAPI_INSTANCE / ZAPI_TOKEN / ZAPI_CLIENT_TOKEN)" };
  }
  try {
    const r = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Client-Token": ZAPI_CLIENT },
        body: JSON.stringify({ phone: telefone, message: mensagem }),
      }
    );
    const txt = await r.text();
    if (!r.ok) {
      console.error("[admin-criar-tese] Z-API falhou:", r.status, txt);
      return { ok: false, detalhe: `Z-API ${r.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[admin-criar-tese] Z-API exception:", e);
    return { ok: false, detalhe: (e as Error).message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  // v9.19.1 · try/catch externo · captura qualquer exception inesperada e retorna detalhe
  try {
  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const telefone = normalizarTelefone(String(body?.telefone_raw || ""));
  if (!telefone) return json({ ok: false, error: "telefone_invalido", detalhe: "use 10-13 dígitos · ex: 11999999999" }, 400);

  const dt = body?.dados_tese || {};
  const titulo = String(dt?.titulo || "").trim();
  const descricao_curta = String(dt?.descricao_curta || "").trim();
  const setores: string[] = Array.isArray(dt?.setores) ? dt.setores.filter((s: any) => typeof s === "string") : [];
  const formas_atuacao: string[] = Array.isArray(dt?.formas_atuacao) ? dt.formas_atuacao.filter((s: any) => typeof s === "string") : [];
  const localizacao_tipo = String(dt?.localizacao_tipo || "").trim();
  const estado = dt?.estado ? String(dt.estado).toUpperCase().trim() : null;
  const cidade = dt?.cidade ? String(dt.cidade).trim() : null;
  const valor_min = Number(dt?.valor_min || 0);
  const valor_max = Number(dt?.valor_max || 0);
  const descricao_adicional = dt?.descricao_adicional ? String(dt.descricao_adicional).slice(0, 1000) : null;

  if (titulo.length < 3 || titulo.length > 200) return json({ ok: false, error: "titulo_invalido" }, 400);
  if (descricao_curta.length < 3 || descricao_curta.length > 80) return json({ ok: false, error: "descricao_curta_invalido", detalhe: "3-80 caracteres" }, 400);
  if (!setores.length || !setores.every(s => SETORES_VALIDOS.has(s))) return json({ ok: false, error: "setores_invalido", detalhe: "1+ valores canônicos" }, 400);
  if (formas_atuacao.length && !formas_atuacao.every(f => FORMAS_VALIDAS.has(f))) return json({ ok: false, error: "formas_atuacao_invalido" }, 400);
  if (!LOC_TIPOS_VALIDOS.has(localizacao_tipo)) return json({ ok: false, error: "localizacao_tipo_invalido" }, 400);
  if (estado && !UFS_VALIDAS.has(estado)) return json({ ok: false, error: "estado_invalido" }, 400);
  if (localizacao_tipo === "estado" && !estado) return json({ ok: false, error: "estado_obrigatorio_quando_loc_estado" }, 400);
  if (localizacao_tipo === "cidade" && (!estado || !cidade)) return json({ ok: false, error: "cidade_e_estado_obrigatorios_quando_loc_cidade" }, 400);
  if (!Number.isFinite(valor_min) || !Number.isFinite(valor_max) || valor_min <= 0 || valor_max <= 0 || valor_min > valor_max) {
    return json({ ok: false, error: "faixa_valores_invalida", detalhe: "min e max em R$ · min ≤ max" }, 400);
  }
  if (valor_max > 100_000_000) return json({ ok: false, error: "valor_max_excessivo", detalhe: "≤ 100M" }, 400);

  // 1. Resolve contato em auth.users (FK de teses_investimento aponta pra lá)
  //    Pré-check: se já existe em public.usuarios por whatsapp · pega o nome
  const { data: usuariosRow } = await adminClient
    .from("usuarios")
    .select("id, nome, whatsapp, email")
    .eq("whatsapp", telefone)
    .maybeSingle();

  const nome_novo = String(body?.nome_contato || "").trim();
  const nome_efetivo = usuariosRow?.nome || nome_novo || null;

  // Se contato é novo (nem auth.users, nem public.usuarios) · exige nome
  if (!usuariosRow && nome_novo.length < 2) {
    // Vou tentar achar em auth.users mesmo assim (pode existir lá sem espelho em public.usuarios)
    const buscaAuth = await findOrCreateAuthUser(telefone, null);
    if (!buscaAuth.user_id) {
      return json({ ok: false, error: "nome_contato_obrigatorio", detalhe: "contato não existe · forneça nome_contato" }, 400);
    }
  }

  const resolved = await findOrCreateAuthUser(telefone, nome_efetivo);
  if (!resolved.user_id) {
    console.error("[admin-criar-tese] findOrCreateAuthUser falhou:", resolved.erro);
    return json({ ok: false, error: "erro_criar_contato", detalhe: resolved.erro || "auth.admin.createUser falhou", step: "auth_create_user" }, 500);
  }

  // 2. Espelha em public.usuarios com MESMO id (idempotente · se já existe, retorna existing)
  const contato = await ensureUsuarioRow(resolved.user_id, nome_efetivo, telefone);
  const novo_contato = resolved.novo;

  // 2. Monta payload canônico da tese
  // valor_alvo = média de min/max (numeric · usado pelo motor V8 B8.13)
  const valor_alvo_numeric = Math.round((valor_min + valor_max) / 2);
  const valor_investimento_text = `${valor_min}-${valor_max}`;

  const tesePayload: Record<string, unknown> = {
    usuario_id: contato!.id,
    status: "ativa",
    origem: "admin",
    titulo,
    descricao_curta,
    setores,
    formas_atuacao: formas_atuacao.length ? formas_atuacao : null,
    localizacao_tipo,
    estado: localizacao_tipo === "brasil_todo" ? null : estado,
    cidade: localizacao_tipo === "cidade" ? cidade : null,
    valor_alvo: valor_alvo_numeric,
    valor_investimento: valor_investimento_text,
    descricao_adicional,
    nome: contato!.nome,
    whatsapp: telefone,
    email: contato!.email,
  };

  console.log("[admin-criar-tese] INSERT payload:", JSON.stringify(tesePayload));
  const { data: tese, error: errT } = await adminClient
    .from("teses_investimento")
    .insert(tesePayload)
    .select("id, codigo, titulo, setores, valor_alvo, valor_investimento, estado, cidade, localizacao_tipo, status, origem, created_at")
    .maybeSingle();
  if (errT) {
    console.error("[admin-criar-tese] erro INSERT tese:", JSON.stringify(errT));
    return json({ ok: false, error: "erro_criar_tese", detalhe: errT.message, code: errT.code, hint: errT.hint, step: "insert_tese" }, 500);
  }
  if (!tese) {
    console.error("[admin-criar-tese] INSERT retornou sem dados (RLS bloqueou SELECT pós-INSERT?)");
    return json({ ok: false, error: "erro_criar_tese", detalhe: "insert sucesso mas SELECT pós-INSERT vazio · RLS suspeito", step: "select_pos_insert" }, 500);
  }

  // 3. Z-API · notifica contato (não bloqueia se falhar)
  const setoresTxt = setores.map(s => SETOR_LBL[s] || s).join(", ");
  const locTxt = localizacao_tipo === "brasil_todo" ? "Brasil todo" : (localizacao_tipo === "estado" ? estado! : `${cidade}/${estado}`);
  const msg =
    `Olá ${contato!.nome.split(" ")[0]}!\n\n` +
    `Sua tese de investimento foi cadastrada na 1Negócio.\n\n` +
    `📋 Título: ${titulo}\n` +
    `🎯 Setores: ${setoresTxt}\n` +
    `📍 Local: ${locTxt}\n` +
    `💰 Faixa: ${faixaTexto(valor_min, valor_max)}\n\n` +
    `A partir de agora, sempre que aparecer um negócio compatível com seus critérios, você será o primeiro a saber.\n\n` +
    `Acesse seu portal: https://1negocio.com.br/portal-usuario.html\n\n` +
    `Equipe 1Negócio`;

  const wpp = await enviarWhatsApp(telefone, msg);

  return json({ ok: true, contato, tese, novo_contato, whatsapp_ok: wpp.ok, whatsapp_detalhe: wpp.detalhe || null });
  } catch (e) {
    // v9.19.1 · captura QUALQUER exception não tratada · retorna detalhe pro toast
    const err = e as Error;
    console.error("[admin-criar-tese] exception não tratada:", err.message, err.stack);
    return json({ ok: false, error: "excecao_nao_tratada", detalhe: err.message || String(e), step: "catch_externo" }, 500);
  }
});
