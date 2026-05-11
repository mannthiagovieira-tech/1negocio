// gerar-peca · v9.12 · 1Negócio
// Wrapper sobre gerar-conteudo-post · 5 tipos de conteúdo (v9.12 implementa 2:
// legenda_solta e imagem_unica · roteiros/carrossel virão em v9.12.1/2).
//
// Após chamar a edge real, atualiza pecas_geradas com colunas de curadoria
// (tipo_conteudo, status='rascunho', angulo, texto_gerado, imagem_url,
// link_associado, created_by_admin_id).
//
// POST { negocio_id, tipo_conteudo, angulo?, tom? }
// → 200 { ok, peca }
// → 400/403/404 · erros padronizados

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

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

// Tons aceitos pela edge real
const TONS_VALIDOS = new Set(["direto", "editorial", "convidativo", "provocativo", "pessoal"]);
// Ângulos aceitos pela edge real
const ANGULOS_VALIDOS = new Set([
  "oportunidade", "momento_venda", "setor_alta", "localizacao",
  "diferencial", "historia", "provocacao", "curadoria", "surpresa",
]);

// Tipos implementados nesta versão
const TIPOS_IMPLEMENTADOS = new Set(["legenda_solta", "imagem_unica"]);

// Mapeia tipo_conteudo → (formato, tipo_imagem) da edge real
function mapearTipo(tipo_conteudo: string): { formato: string; tipo_imagem: string } {
  switch (tipo_conteudo) {
    case "legenda_solta":
      return { formato: "feed-insta", tipo_imagem: "html-svg" };
    case "imagem_unica":
      return { formato: "feed-insta", tipo_imagem: "dalle-3" };
    default:
      return { formato: "feed-insta", tipo_imagem: "html-svg" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  // JWT do admin (necessário pra chamar gerar-conteudo-post que tem verify_jwt=true)
  const adminAuthHeader = req.headers.get("authorization") || "";

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const negocio_id = String(body?.negocio_id || "").trim();
  const tipo_conteudo = String(body?.tipo_conteudo || "").trim();
  const angulo = body?.angulo ? String(body.angulo).trim() : "surpresa";
  const tom = body?.tom ? String(body.tom).trim() : "editorial";

  if (!negocio_id) return json({ ok: false, error: "params_invalidos", detalhe: "negocio_id" }, 400);
  if (!tipo_conteudo) return json({ ok: false, error: "params_invalidos", detalhe: "tipo_conteudo" }, 400);
  if (!TIPOS_IMPLEMENTADOS.has(tipo_conteudo)) {
    return json({
      ok: false,
      error: "tipo_nao_implementado",
      detalhe: "v9.12 implementa só 'legenda_solta' e 'imagem_unica' · roteiros/carrossel virão em v9.12.1/2"
    }, 400);
  }
  if (!ANGULOS_VALIDOS.has(angulo)) return json({ ok: false, error: "params_invalidos", detalhe: "angulo inválido" }, 400);
  if (!TONS_VALIDOS.has(tom)) return json({ ok: false, error: "params_invalidos", detalhe: "tom inválido" }, 400);

  // Confere negócio existe
  const { data: negocio } = await adminClient.from("negocios").select("id").eq("id", negocio_id).maybeSingle();
  if (!negocio) return json({ ok: false, error: "negocio_nao_encontrado" }, 404);

  // Chama edge real (gerar-conteudo-post · tem verify_jwt=true) repassando JWT do admin
  const { formato, tipo_imagem } = mapearTipo(tipo_conteudo);
  const callBody = {
    negocio_id, formato, tipo_imagem, tom, angulo,
    restricoes: { pode_ise: true, pode_faturamento: true, pode_localizacao: true, pode_setor: true },
  };

  let gerado: any = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/gerar-conteudo-post`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": adminAuthHeader,
      },
      body: JSON.stringify(callBody),
    });
    gerado = await r.json();
    if (!r.ok || !gerado?.ok) {
      return json({ ok: false, error: "geracao_falhou", detalhe: gerado?.erro || ("status " + r.status) }, 502);
    }
  } catch (e) {
    return json({ ok: false, error: "geracao_falhou", detalhe: String((e as Error).message || e) }, 502);
  }

  // Extrai conteúdo gerado
  const imgTipo = gerado?.imagem?.tipo;
  const imgConteudo = gerado?.imagem?.conteudo;
  const imagem_url = imgTipo === "url" ? String(imgConteudo) : null;
  const imagem_dados_legado = imgTipo === "svg" ? String(imgConteudo || "") : null;
  const link_associado = `https://1negocio.com.br/negocio.html?id=${negocio_id}`;
  const textoFinal = gerado.texto_principal || "";
  const hashtagsArr = Array.isArray(gerado.hashtags) ? gerado.hashtags : [];
  const textoCompleto = hashtagsArr.length
    ? `${textoFinal}\n\n${hashtagsArr.join(" ")}`
    : textoFinal;

  const camposCuradoria = {
    tipo_conteudo,
    status: "rascunho",
    angulo: gerado.angulo_usado || angulo,
    texto_gerado: textoCompleto,
    imagem_url,
    link_associado,
    prompt_usado: JSON.stringify({ tipo_conteudo, angulo, tom, formato, tipo_imagem }),
    metadata: { gerar_resp: { aviso: gerado.aviso, dica_visual: gerado.dica_visual, tokens: gerado.tokens_usados } },
    created_by_admin_id: gate.admin_id || null,
    updated_at: new Date().toISOString(),
  };

  const peca_id_gerado = gerado.peca_id;

  // Caminho normal · edge interna populou peca_id · só UPDATE pra adicionar curadoria
  if (peca_id_gerado) {
    const { data: peca, error } = await adminClient
      .from("pecas_geradas")
      .update(camposCuradoria)
      .eq("id", peca_id_gerado)
      .select()
      .maybeSingle();
    if (error) return json({ ok: false, error: "erro_update", detalhe: error.message }, 500);
    if (peca) return json({ ok: true, peca, aviso: gerado.aviso || null });
    // peça evaporou (deletada entre INSERT e UPDATE? muito raro) · cai pro fallback
    console.warn("[gerar-peca] peca_id retornado mas UPDATE achou null · vai criar nova");
  } else {
    console.warn("[gerar-peca] edge sem peca_id · vai criar manualmente · texto.length=" + textoCompleto.length);
  }

  // Fallback defensivo · edge não retornou peca_id mas tem conteúdo · INSERT direto via service-role
  if (!textoCompleto && !imagem_url && !imagem_dados_legado) {
    return json({ ok: false, error: "edge_sem_conteudo", detalhe: "gerar-conteudo-post não retornou texto nem imagem" }, 502);
  }
  const insertPayload: Record<string, unknown> = {
    negocio_id,
    formato,
    tipo_imagem,
    tom,
    texto_principal: textoFinal,
    hashtags: hashtagsArr,
    imagem_dados: imagem_dados_legado,
    tokens_usados: gerado.tokens_usados || null,
    ...camposCuradoria,
  };
  const { data: novaPeca, error: errIns } = await adminClient
    .from("pecas_geradas")
    .insert(insertPayload)
    .select()
    .maybeSingle();
  if (errIns) return json({ ok: false, error: "erro_insert_fallback", detalhe: errIns.message }, 500);
  if (!novaPeca) return json({ ok: false, error: "erro_insert_fallback", detalhe: "insert retornou null" }, 500);
  return json({ ok: true, peca: novaPeca, aviso: gerado.aviso || null });
});
