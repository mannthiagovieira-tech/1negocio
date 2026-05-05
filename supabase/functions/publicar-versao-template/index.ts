// Edge Function: publicar-versao-template
// Cria nova versão · desativa anterior · deleta rascunho

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

  // Busca última versão (ativa ou não) pra calcular nova
  const ultQuery = sb.from("documentos_templates").select("id, versao").eq("tipo", tipo);
  const { data: ultimas } = formato
    ? await ultQuery.eq("formato", formato).order("versao", { ascending: false }).limit(1)
    : await ultQuery.is("formato", null).order("versao", { ascending: false }).limit(1);
  const ultimaVersao = ultimas?.[0]?.versao || 0;
  const novaVersao = ultimaVersao + 1;

  // Desativa todas as ativas do par (geralmente só 1 · constraint partial unique)
  const upd = sb.from("documentos_templates").update({ ativo: false }).eq("tipo", tipo).eq("ativo", true);
  if (formato) await upd.eq("formato", formato);
  else await upd.is("formato", null);

  // Cria nova versão ativa
  const { data: nova, error } = await sb.from("documentos_templates").insert({
    tipo,
    formato,
    versao: novaVersao,
    texto,
    ativo: true,
    notas_versao,
    created_by: auth.admin!.id,
  }).select("id, versao, ativo").single();
  if (error) return jsonRes({ erro: "insert nova versão: " + error.message }, 500);

  // Deleta rascunho do par (se existir)
  const del = sb.from("documentos_templates_rascunho").delete().eq("tipo", tipo);
  if (formato) await del.eq("formato", formato);
  else await del.is("formato", null);

  return jsonRes({
    ok: true,
    template_id: nova.id,
    nova_versao: nova.versao,
    versao_anterior: ultimaVersao || null,
  });
});
