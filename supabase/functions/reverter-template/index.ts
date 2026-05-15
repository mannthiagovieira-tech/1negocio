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

  // Chamada atômica · função PL/pgSQL faz lookup+UPDATE+INSERT+DELETE numa transação
  const { data, error } = await sb.rpc("reverter_template_atomico", {
    p_template_id_origem: template_id_origem,
    p_admin_id: auth.admin!.id,
  });
  if (error) return jsonRes({ erro: "reverter: " + error.message }, 500);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return jsonRes({ erro: "reverter: sem retorno" }, 500);

  return jsonRes({
    ok: true,
    template_id: row.template_id,
    nova_versao: row.nova_versao,
    revertido_de_versao: row.revertido_de_versao,
  });
});
