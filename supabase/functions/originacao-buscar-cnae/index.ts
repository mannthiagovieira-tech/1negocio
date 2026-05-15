// originacao-buscar-cnae · v9.34.4 · Sprint 5 · Motor V3
// Busca empresas via CNPJ.ws filtrando por CNAE + município (Receita Federal).
// Gratuito · sem auth · rate limit 3 req/min (20s entre cada CNAE).
//
// MODO 1 (busca padrão) · POST { originacao_id }
//   Prioridade CNAEs: busca_config_jsonb.cnaes > CNAE_POR_SETOR[setor]
//   Output: { ok, total_inseridos, total_retornado, por_cnae[], custo_brl: 0, fonte_cnaes }
//
// MODO 2 (lookup CNPJ → CNAEs · sem persistir) · POST { cnpj_lookup: "XX.XXX.XXX/0001-XX" }
//   Output: { ok, cnpj, razao_social, cnae_principal: {codigo,descricao}, cnaes_secundarios: [...] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RATE_LIMIT_MS = 20_000; // 3 req/min · 20s entre requests

// Mapeamento setor canônico → lista de CNAEs (Receita Federal)
const CNAE_POR_SETOR: Record<string, string[]> = {
  alimentacao:      ["5611201", "5611202", "5611203", "5612100"],
  varejo:           ["4711301", "4711302", "4712100"],
  saude:            ["8630503", "8630504", "8630506"],
  beleza_estetica:  ["9602501", "9602502"],
  educacao:         ["8511200", "8512100", "8513900"],
  servicos_locais:  ["9609208", "9609207"],
  bem_estar:        ["9313100", "9319101"],
  industria:        ["1091101", "1091102"],
  construcao:       ["4120400", "4321500"],
  hospedagem:       ["5510801", "5510802"],
  logistica:        ["4930201", "4930202"],
  servicos_empresas:["6911701", "6920601"],
};

// Cidade → cod_ibge · expandir conforme operador adicionar
const COD_IBGE_POR_CIDADE: Record<string, string> = {
  "belo horizonte": "3106200",
  "são paulo": "3550308",
  "sao paulo": "3550308",
  "rio de janeiro": "3304557",
  "florianópolis": "4205407",
  "florianopolis": "4205407",
  "brasília": "5300108",
  "brasilia": "5300108",
  "salvador": "2927408",
  "curitiba": "4106902",
  "porto alegre": "4314902",
  "fortaleza": "2304400",
  "recife": "2611606",
};

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

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function buscarCnaeUF(cnae: string, codIbge: string): Promise<{ ok: boolean; empresas?: any[]; erro?: string }> {
  const url = `https://www.cnpj.ws/cnpj/v1/empresas?cnae=${cnae}&municipio=${codIbge}&page=1`;
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json", "User-Agent": "1Negocio/v9.34.3" },
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 429) return { ok: false, erro: "cnpj_ws_rate_limit_429" };
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, erro: `cnpj_ws_status_${r.status} · ${txt.slice(0, 200)}` };
    }
    const data = await r.json();
    const empresas = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    return { ok: true, empresas };
  } catch (e: any) {
    return { ok: false, erro: `fetch_exception · ${e.message}` };
  }
}

function pickTelefone(emp: any): string | null {
  if (Array.isArray(emp.telefones) && emp.telefones.length > 0) {
    const t = emp.telefones[0];
    if (t?.ddd && t?.numero) return `(${t.ddd}) ${t.numero}`;
    if (typeof t === "string") return t;
  }
  if (emp.estabelecimento?.telefone1) return emp.estabelecimento.telefone1;
  if (emp.telefone) return emp.telefone;
  return null;
}

function pickEmail(emp: any): string | null {
  if (emp.estabelecimento?.email) return emp.estabelecimento.email;
  if (Array.isArray(emp.emails) && emp.emails.length > 0) {
    const e = emp.emails[0];
    if (typeof e === "string") return e;
    if (e?.endereco) return e.endereco;
  }
  if (emp.email) return emp.email;
  return null;
}

function pickEnderecoCompleto(emp: any): string | null {
  const est = emp.estabelecimento || emp;
  const partes: string[] = [];
  if (est.tipo_logradouro) partes.push(est.tipo_logradouro);
  if (est.logradouro) partes.push(est.logradouro);
  if (est.numero) partes.push(est.numero);
  if (est.bairro) partes.push("· " + est.bairro);
  if (est.cidade?.nome) partes.push("· " + est.cidade.nome);
  if (est.estado?.sigla) partes.push("/" + est.estado.sigla);
  return partes.length > 0 ? partes.join(" ") : null;
}

function pickSituacao(emp: any): string {
  return (emp.estabelecimento?.situacao_cadastral || emp.situacao_cadastral || "").toString().toUpperCase();
}

function pickRazaoSocial(emp: any): string {
  return (emp.razao_social || emp.nome_empresarial || emp.estabelecimento?.nome_fantasia || emp.cnpj || "(sem nome)").toString();
}

function pickCnpj(emp: any): string {
  return (emp.estabelecimento?.cnpj || emp.cnpj || "").toString();
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

  // ────── MODO 2 · LOOKUP CNPJ → CNAEs (Sprint 5 · Passo B) ──────
  if (body?.cnpj_lookup) {
    const cnpjLimpo = String(body.cnpj_lookup).replace(/\D/g, "");
    if (cnpjLimpo.length !== 14) return resp(400, { ok: false, erro: "cnpj_invalido" });
    try {
      const r = await fetch(`https://www.cnpj.ws/cnpj/v1/${cnpjLimpo}`, {
        headers: { "Accept": "application/json", "User-Agent": "1Negocio/v9.34.4" },
        signal: AbortSignal.timeout(20_000),
      });
      if (r.status === 429) return resp(429, { ok: false, erro: "cnpj_ws_rate_limit_429" });
      if (!r.ok) return resp(500, { ok: false, erro: `cnpj_ws_status_${r.status}` });
      const data = await r.json();
      const est = data?.estabelecimento || {};
      const principal = est.atividade_principal || est.cnae_principal || {};
      const secundarios = est.atividades_secundarias || [];
      return resp(200, {
        ok: true,
        cnpj: data?.cnpj || cnpjLimpo,
        razao_social: data?.razao_social || null,
        cnae_principal: principal?.id || principal?.codigo
          ? { codigo: String(principal.id || principal.codigo).replace(/\D/g, ""), descricao: principal.descricao || null }
          : null,
        cnaes_secundarios: secundarios.map((a: any) => ({
          codigo: String(a.id || a.codigo || "").replace(/\D/g, ""),
          descricao: a.descricao || null,
        })).filter((a: any) => a.codigo),
      });
    } catch (e: any) {
      return resp(500, { ok: false, erro: "cnpj_lookup_exception", detalhe: e?.message?.slice(0, 200) });
    }
  }

  // ────── MODO 1 · BUSCA NORMAL ──────
  const { originacao_id } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao").select("id, fase_atual, briefing_jsonb, busca_config_jsonb")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    if (orig.fase_atual !== "leads") return resp(400, { ok: false, erro: "fase_invalida", detalhe: `fase: ${orig.fase_atual}` });

    const negocio = orig.briefing_jsonb?.negocio || {};
    const setor = (negocio.setor || "").toLowerCase().trim();
    const cidade = (negocio.cidade || "").toLowerCase().trim();

    // PRIORIDADE 1: CNAEs configurados no Passo B (busca_config_jsonb.cnaes)
    // PRIORIDADE 2: mapeamento fixo CNAE_POR_SETOR (fallback)
    const cnaesConfig = Array.isArray(orig.busca_config_jsonb?.cnaes)
      ? orig.busca_config_jsonb.cnaes.map((c: any) => String(c).replace(/\D/g, "")).filter(Boolean)
      : [];
    const cnaes = cnaesConfig.length > 0 ? cnaesConfig : CNAE_POR_SETOR[setor];
    const fonteCnaes = cnaesConfig.length > 0 ? "busca_config_jsonb" : "mapeamento_fixo_setor";
    if (!cnaes || cnaes.length === 0) {
      return resp(400, {
        ok: false,
        erro: "setor_sem_mapeamento_cnae",
        detalhe: `setor '${setor}' não mapeado · setores suportados: ${Object.keys(CNAE_POR_SETOR).join(", ")} · OU configure CNAEs no Passo B`,
      });
    }
    const codIbge = COD_IBGE_POR_CIDADE[cidade];
    if (!codIbge) {
      return resp(400, {
        ok: false,
        erro: "cidade_sem_cod_ibge",
        detalhe: `cidade '${cidade}' não mapeada · cidades suportadas: ${Object.keys(COD_IBGE_POR_CIDADE).join(", ")}`,
      });
    }

    // Arquétipo: pega o primeiro aprovado pra anexar uso (CNAE não filtra por arquétipo)
    const { data: arquetipos } = await adminClient
      .from("arquetipos_compradores")
      .select("id")
      .eq("originacao_id", originacao_id)
      .eq("status", "aprovado")
      .order("ordem", { ascending: true })
      .limit(1);
    const arqId = arquetipos?.[0]?.id || null;

    // Sequencial · 20s entre cada CNAE (rate limit 3 req/min)
    const porCnae: any[] = [];
    let totalInseridos = 0;
    let totalRetornado = 0;

    for (let i = 0; i < cnaes.length; i++) {
      const cnae = cnaes[i];
      if (i > 0) await sleep(RATE_LIMIT_MS);

      const r = await buscarCnaeUF(cnae, codIbge);
      const base: any = { cnae, retornado: 0, ativas: 0, inseridos: 0, duplicados: 0 };
      if (!r.ok) {
        porCnae.push({ ...base, erro: r.erro });
        continue;
      }
      const empresas = r.empresas || [];
      base.retornado = empresas.length;
      totalRetornado += empresas.length;

      for (const emp of empresas) {
        if (pickSituacao(emp) !== "ATIVA") continue;
        base.ativas++;
        const cnpj = pickCnpj(emp);
        if (!cnpj) continue;
        const nome = pickRazaoSocial(emp);
        const tel = pickTelefone(emp);
        const email = pickEmail(emp);
        const endereco = pickEnderecoCompleto(emp);
        const cidadeEmp = emp.estabelecimento?.cidade?.nome || negocio.cidade || null;
        const estadoEmp = emp.estabelecimento?.estado?.sigla || negocio.estado || null;

        const { data: upserted, error: errUp } = await adminClient
          .from("pool_contatos_global")
          .upsert({
            identificador_canonico: cnpj,
            fonte_origem: "manual_admin",
            nome,
            telefone: tel,
            email,
            endereco_completo: endereco,
            cidade: cidadeEmp,
            estado: estadoEmp,
            categoria_setorial: "comprador_potencial",
            tags_consolidadas: ["cnae", "receita_federal", setor, cnae],
            dados_brutos: { ...emp, _fonte: "cnpj_ws", _cnae_busca: cnae, _setor: setor },
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "identificador_canonico,fonte_origem" })
          .select("id")
          .maybeSingle();
        if (errUp || !upserted) {
          console.error("[cnae] upsert err", errUp?.message);
          continue;
        }

        const { error: errUso } = await adminClient
          .from("pool_contatos_uso")
          .insert({
            contato_id: upserted.id,
            originacao_id,
            arquetipo_id: arqId,
            canal: "receita_federal",
            status: "novo",
          });
        if (errUso) {
          if (errUso.code === "23505") base.duplicados++;
          else console.error("[cnae] uso err", errUso.message);
        } else {
          base.inseridos++;
          totalInseridos++;
        }
      }
      porCnae.push(base);
    }

    return resp(200, {
      ok: true,
      setor,
      cidade,
      cod_ibge: codIbge,
      cnaes_usados: cnaes,
      fonte_cnaes: fonteCnaes,
      por_cnae: porCnae,
      total_retornado: totalRetornado,
      total_inseridos: totalInseridos,
      custo_brl: 0,
    });
  } catch (e: any) {
    console.error("[cnae] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
