// Edge Function: gerar-termo-adesao
// Admin gera um Termo de Adesão pra um negócio · 3 formatos (gratuito/guiado/assessorada)
// Lê template ativo · renderiza placeholders · INSERT em termos_adesao com link público

import { cors, checarAdmin, svc, jsonRes, gerarTokenHex, renderTemplate, dataBR, formatBRL } from "../_shared/admin-auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ erro: "Method not allowed" }, 405);

  const auth = await checarAdmin(req);
  if (!auth.ok) return jsonRes({ erro: auth.erro }, auth.status);

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ erro: "Invalid JSON" }, 400); }

  const { negocio_id, formato, comissao_pct, valor_adesao = 0, mensalidade = 0, forma_pagamento = null, notas_admin = null } = body || {};
  if (!negocio_id || !formato || comissao_pct === undefined) return jsonRes({ erro: "negocio_id, formato e comissao_pct obrigatórios" }, 400);
  if (!["gratuito", "guiado", "assessorada"].includes(formato)) return jsonRes({ erro: "formato inválido" }, 400);

  const sb = svc();

  // 1. Busca negócio
  const { data: neg } = await sb.from("negocios").select("id, vendedor_id, cidade, estado, cnpj, codigo_diagnostico, setor").eq("id", negocio_id).maybeSingle();
  if (!neg) return jsonRes({ erro: "negócio não encontrado" }, 404);

  // 2. Busca vendedor
  let vendedorNome = "—", vendedorEmail = "", vendedorWhats = "";
  if (neg.vendedor_id) {
    const { data: u } = await sb.from("usuarios").select("nome, email, whatsapp").eq("id", neg.vendedor_id).maybeSingle();
    if (u) { vendedorNome = u.nome || "—"; vendedorEmail = u.email || ""; vendedorWhats = u.whatsapp || ""; }
  }

  // 3. Template ativo
  const { data: tpl } = await sb.from("documentos_templates").select("id, texto").eq("tipo", "termo_adesao").eq("formato", formato).eq("ativo", true).maybeSingle();
  if (!tpl) return jsonRes({ erro: `template ativo não encontrado pro formato ${formato}` }, 404);

  // 4. Pré-aloca código (sequence) pra incluir no texto renderizado
  const { data: codigoRpc, error: seqErr } = await sb.rpc("proximo_codigo_termo");
  if (seqErr || !codigoRpc) return jsonRes({ erro: "falha ao alocar código: " + (seqErr?.message || "vazio") }, 500);
  const codigo: string = codigoRpc as any;

  // 5. Renderiza texto
  const texto = renderTemplate(tpl.texto, {
    nome_assinante: vendedorNome,
    negocio_titulo: neg.codigo_diagnostico || neg.setor || "—",
    cidade: neg.cidade || "—",
    estado: neg.estado || "—",
    data_geracao: dataBR(),
    codigo_documento: codigo,
    comissao_pct: String(comissao_pct),
    valor_adesao: formatBRL(valor_adesao),
    mensalidade: formatBRL(mensalidade),
    forma_pagamento: forma_pagamento || "—",
  });

  const linkToken = gerarTokenHex(16);

  // 6. INSERT
  const { data: nova, error } = await sb.from("termos_adesao").insert({
    codigo,
    template_id: tpl.id,
    plano: formato,
    comissao_pct,
    valor_adesao,
    mensalidade,
    forma_pagamento,
    negocio_id,
    vendedor_id: neg.vendedor_id || null,
    razao_social: vendedorNome,
    representante_nome: vendedorNome,
    email: vendedorEmail || null,
    whatsapp: vendedorWhats || null,
    cnpj: neg.cnpj || null,
    endereco: null,
    representante_cpf: null,
    eh_proprietario: true,
    termo_texto: texto,
    link_token: linkToken,
    status: "gerado",
    gerado_em: new Date().toISOString(),
    gerado_por: auth.admin!.id,
    notas_admin,
  }).select("id, codigo, link_token").single();

  if (error) return jsonRes({ erro: "insert: " + error.message }, 500);

  return jsonRes({
    ok: true,
    id: nova.id,
    codigo: nova.codigo,
    link_token: nova.link_token,
    link_publico: `https://1negocio.com.br/termo/${nova.link_token}`,
  });
});
