// Edge Function: reverter-template
// Cria nova versão (vN+1) com texto da versão antiga escolhida

import { cors, checarAdmin, svc, jsonRes } from "../_shared/admin-auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ erro: "Method not allowed" }, 405);

  const auth = await checarAdmin(req);
  if (!auth.ok) return jsonRes({ erro: auth.erro }, auth.status);

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ erro: "Invalid JSON" }, 400); }

  const { template_id_origem } = body || {};
  if (!template_id_origem) return jsonRes({ erro: "template_id_origem obrigatório" }, 400);

  const sb = svc();

  // Busca template origem
  const { data: origem } = await sb.from("documentos_templates")
    .select("id, tipo, formato, versao, texto")
    .eq("id", template_id_origem).maybeSingle();
  if (!origem) return jsonRes({ erro: "template origem não encontrado" }, 404);

  // Última versão pra calcular próxima
  const ultQuery = sb.from("documentos_templates").select("versao").eq("tipo", origem.tipo);
  const { data: ultimas } = origem.formato
    ? await ultQuery.eq("formato", origem.formato).order("versao", { ascending: false }).limit(1)
    : await ultQuery.is("formato", null).order("versao", { ascending: false }).limit(1);
  const ultimaVersao = ultimas?.[0]?.versao || 0;
  const novaVersao = ultimaVersao + 1;

  // Desativa atual
  const upd = sb.from("documentos_templates").update({ ativo: false }).eq("tipo", origem.tipo).eq("ativo", true);
  if (origem.formato) await upd.eq("formato", origem.formato);
  else await upd.is("formato", null);

  // Cria nova versão = texto da origem
  const { data: nova, error } = await sb.from("documentos_templates").insert({
    tipo: origem.tipo,
    formato: origem.formato,
    versao: novaVersao,
    texto: origem.texto,
    ativo: true,
    notas_versao: `Reverter para conteúdo da v${origem.versao}`,
    created_by: auth.admin!.id,
  }).select("id, versao").single();
  if (error) return jsonRes({ erro: "insert: " + error.message }, 500);

  // Deleta rascunho do par
  const del = sb.from("documentos_templates_rascunho").delete().eq("tipo", origem.tipo);
  if (origem.formato) await del.eq("formato", origem.formato);
  else await del.is("formato", null);

  return jsonRes({
    ok: true,
    template_id: nova.id,
    nova_versao: nova.versao,
    revertido_de_versao: origem.versao,
  });
});
