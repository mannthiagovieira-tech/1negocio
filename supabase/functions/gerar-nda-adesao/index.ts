// Edge Function: gerar-nda-adesao
// Admin gera um NDA pra um par comprador+negócio · estende nda_solicitacoes
// Reaproveita registro existente se já houver (não duplica) · token UUID atual = link público

import { cors, checarAdmin, svc, jsonRes, renderTemplate, dataBR } from "../_shared/admin-auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ erro: "Method not allowed" }, 405);

  const auth = await checarAdmin(req);
  if (!auth.ok) return jsonRes({ erro: auth.erro }, auth.status);

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ erro: "Invalid JSON" }, 400); }

  const { comprador_id, negocio_id, notas_admin = null } = body || {};
  if (!comprador_id || !negocio_id) return jsonRes({ erro: "comprador_id e negocio_id obrigatórios" }, 400);

  const sb = svc();

  // 1. Verifica comprador
  const { data: comp } = await sb.from("usuarios").select("id, nome").eq("id", comprador_id).maybeSingle();
  if (!comp) return jsonRes({ erro: "comprador não encontrado" }, 404);

  // 2. Verifica negócio
  const { data: neg } = await sb.from("negocios").select("id, cidade, estado, codigo_diagnostico, setor").eq("id", negocio_id).maybeSingle();
  if (!neg) return jsonRes({ erro: "negócio não encontrado" }, 404);

  // 3. Dedup · se já existe NDA pro par (comprador, negocio), retorna o existente
  const { data: existente } = await sb.from("nda_solicitacoes")
    .select("id, codigo, token, status, texto_renderizado")
    .eq("usuario_id", comprador_id).eq("negocio_id", negocio_id).maybeSingle();
  if (existente) {
    return jsonRes({
      ok: true, ja_existia: true,
      id: existente.id, codigo: existente.codigo,
      link_token: existente.token,
      link_publico: `https://1negocio.com.br/nda/${existente.token}`,
      status: existente.status,
    });
  }

  // 4. Garante solicitacoes_info raiz · se não existir cria com status='aguardando'
  let solicInfoId: string | null = null;
  const { data: solicEx } = await sb.from("solicitacoes_info").select("id").eq("comprador_id", comprador_id).eq("negocio_id", negocio_id).maybeSingle();
  if (solicEx) solicInfoId = solicEx.id;
  else {
    const { data: solicNova, error: solicErr } = await sb.from("solicitacoes_info").insert({
      comprador_id, negocio_id, status: "aguardando", nivel: "completo",
    }).select("id").single();
    if (solicErr) return jsonRes({ erro: "criar solicitacoes_info: " + solicErr.message }, 500);
    solicInfoId = solicNova.id;
  }

  // 5. Template ativo NDA
  const { data: tpl } = await sb.from("documentos_templates").select("id, texto").eq("tipo", "nda").is("formato", null).eq("ativo", true).maybeSingle();
  if (!tpl) return jsonRes({ erro: "template ativo NDA não encontrado" }, 404);

  // 6. Pré-aloca código
  const { data: codigoRpc, error: seqErr } = await sb.rpc("proximo_codigo_nda");
  if (seqErr || !codigoRpc) return jsonRes({ erro: "falha ao alocar código: " + (seqErr?.message || "vazio") }, 500);
  const codigo: string = codigoRpc as any;

  // 7. Gera token UUID (a coluna existente é uuid)
  const token = crypto.randomUUID();

  // 8. Renderiza texto
  const texto = renderTemplate(tpl.texto, {
    nome_assinante: comp.nome || "—",
    negocio_titulo: neg.codigo_diagnostico || neg.setor || "—",
    cidade: neg.cidade || "—",
    estado: neg.estado || "—",
    data_geracao: dataBR(),
    codigo_documento: codigo,
  });

  // 9. INSERT
  const { data: nova, error } = await sb.from("nda_solicitacoes").insert({
    codigo,
    template_id: tpl.id,
    usuario_id: comprador_id,
    nome_completo: comp.nome || "—",
    negocio_id,
    solicitacao_info_id: solicInfoId,
    token,
    texto_renderizado: texto,
    status: "gerado",
    gerado_em: new Date().toISOString(),
    gerado_por: auth.admin!.id,
    notas_admin,
  }).select("id, codigo, token").single();

  if (error) return jsonRes({ erro: "insert nda: " + error.message }, 500);

  // 10. Atualiza solicitacoes_info pra status nda_pendente (enum existente)
  await sb.from("solicitacoes_info").update({ status: "nda_pendente" }).eq("id", solicInfoId);

  return jsonRes({
    ok: true,
    id: nova.id,
    codigo: nova.codigo,
    link_token: nova.token,
    link_publico: `https://1negocio.com.br/nda/${nova.token}`,
  });
});
