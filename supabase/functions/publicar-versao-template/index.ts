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

  // Chamada atômica · função PL/pgSQL faz UPDATE+INSERT+DELETE numa única transação
  const { data, error } = await sb.rpc("publicar_template_v2", {
    p_tipo: tipo,
    p_formato: formato,
    p_texto: texto,
    p_notas: notas_versao,
    p_admin_id: auth.admin!.id,
  });
  if (error) return jsonRes({ erro: "publicar: " + error.message }, 500);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return jsonRes({ erro: "publicar: sem retorno" }, 500);

  return jsonRes({
    ok: true,
    template_id: row.template_id,
    nova_versao: row.nova_versao,
  });
});
