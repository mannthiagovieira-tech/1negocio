// Edge Function: salvar-rascunho-template
// Admin salva/atualiza rascunho de um template (1 rascunho por par tipo+formato)

import { cors, checarAdmin, svc, jsonRes } from "../_shared/admin-auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ erro: "Method not allowed" }, 405);

  const auth = await checarAdmin(req);
  if (!auth.ok) return jsonRes({ erro: auth.erro }, auth.status);

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ erro: "Invalid JSON" }, 400); }

  const { tipo, formato = null, texto, notas_versao = null } = body || {};
  if (!tipo || !texto) return jsonRes({ erro: "tipo e texto obrigatórios" }, 400);
  if (!["termo_adesao", "nda"].includes(tipo)) return jsonRes({ erro: "tipo inválido" }, 400);
  if (tipo === "termo_adesao" && !formato) return jsonRes({ erro: "formato obrigatório pra termo_adesao" }, 400);
  if (tipo === "nda" && formato) return jsonRes({ erro: "nda não tem formato" }, 400);

  const sb = svc();

  // Busca versão ativa pra registrar como base_versao
  const tplQuery = sb.from("documentos_templates").select("versao").eq("tipo", tipo).eq("ativo", true);
  const { data: ativa } = formato
    ? await tplQuery.eq("formato", formato).maybeSingle()
    : await tplQuery.is("formato", null).maybeSingle();
  const baseVersao = ativa?.versao ?? null;

  // Verifica se já existe rascunho desse par
  const exQuery = sb.from("documentos_templates_rascunho").select("id").eq("tipo", tipo);
  const { data: existente } = formato
    ? await exQuery.eq("formato", formato).maybeSingle()
    : await exQuery.is("formato", null).maybeSingle();

  const agora = new Date().toISOString();
  if (existente) {
    const { data, error } = await sb.from("documentos_templates_rascunho")
      .update({ texto, notas_versao, base_versao: baseVersao, updated_at: agora })
      .eq("id", existente.id)
      .select("id, updated_at").single();
    if (error) return jsonRes({ erro: "update: " + error.message }, 500);
    return jsonRes({ ok: true, id: data.id, updated_at: data.updated_at, atualizado: true });
  }

  const { data, error } = await sb.from("documentos_templates_rascunho")
    .insert({ tipo, formato, texto, notas_versao, base_versao: baseVersao, created_by: auth.admin!.id })
    .select("id, updated_at").single();
  if (error) return jsonRes({ erro: "insert: " + error.message }, 500);
  return jsonRes({ ok: true, id: data.id, updated_at: data.updated_at, atualizado: false });
});
