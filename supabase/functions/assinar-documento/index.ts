// Edge Function: assinar-documento (unificada)
// GET ?link_token=X · retorna documento pra leitura (marca visualizado)
// POST { link_token, assinante_nome } · assina (atualiza status, captura IP/UA)

import { cors, svc, jsonRes } from "../_shared/admin-auth.ts";

function obterIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "—";
}

async function buscarPorToken(sb: any, token: string): Promise<{ tipo: "termo" | "nda"; row: any } | null> {
  // Procura em termos_adesao primeiro
  const { data: termo } = await sb.from("termos_adesao")
    .select("id, codigo, plano, status, termo_texto, link_token, gerado_em, assinatura_em, assinante_nome:representante_nome, valor_adesao, mensalidade, comissao_pct, forma_pagamento")
    .eq("link_token", token).maybeSingle();
  if (termo) return { tipo: "termo", row: termo };

  // Senão NDA (token uuid)
  const { data: nda } = await sb.from("nda_solicitacoes")
    .select("id, codigo, status, texto_renderizado, token, gerado_em, assinado_em, nome_completo, solicitacao_info_id")
    .eq("token", token).maybeSingle();
  if (nda) return { tipo: "nda", row: nda };

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = svc();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const linkToken = url.searchParams.get("link_token");
    if (!linkToken) return jsonRes({ erro: "link_token obrigatório" }, 400);
    const found = await buscarPorToken(sb, linkToken);
    if (!found) return jsonRes({ erro: "documento não encontrado" }, 404);
    const { tipo, row } = found;

    // Marca visualizado se ainda em gerado/enviado
    const statusAtual = row.status as string;
    if (["gerado", "enviado"].includes(statusAtual)) {
      const upd: any = { status: "visualizado", visualizado_em: new Date().toISOString() };
      const tabela = tipo === "termo" ? "termos_adesao" : "nda_solicitacoes";
      await sb.from(tabela).update(upd).eq("id", row.id);
    }

    if (tipo === "termo") {
      return jsonRes({
        ok: true, tipo,
        codigo: row.codigo,
        formato: row.plano,
        status: statusAtual,
        texto_renderizado: row.termo_texto,
        gerado_em: row.gerado_em,
        assinado_em: row.assinatura_em,
        ja_assinado: statusAtual === "assinado",
        valor_adesao: row.valor_adesao,
        mensalidade: row.mensalidade,
        comissao_pct: row.comissao_pct,
        forma_pagamento: row.forma_pagamento,
      });
    } else {
      return jsonRes({
        ok: true, tipo,
        codigo: row.codigo,
        status: statusAtual,
        texto_renderizado: row.texto_renderizado,
        gerado_em: row.gerado_em,
        assinado_em: row.assinado_em,
        ja_assinado: ["assinado", "em_analise", "aprovado"].includes(statusAtual),
      });
    }
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return jsonRes({ erro: "Invalid JSON" }, 400); }
    const { link_token, assinante_nome } = body || {};
    if (!link_token || !assinante_nome) return jsonRes({ erro: "link_token e assinante_nome obrigatórios" }, 400);

    const found = await buscarPorToken(sb, link_token);
    if (!found) return jsonRes({ erro: "documento não encontrado" }, 404);
    const { tipo, row } = found;

    if (row.status === "assinado" || row.status === "em_analise" || row.status === "aprovado") {
      return jsonRes({ erro: "documento já assinado", codigo: row.codigo, status: row.status }, 409);
    }

    const ip = obterIp(req);
    const ua = req.headers.get("user-agent") || "—";
    const agora = new Date().toISOString();

    if (tipo === "termo") {
      const { error } = await sb.from("termos_adesao").update({
        status: "assinado",
        assinatura_em: agora,
        ip_assinatura: ip,
        user_agent: ua,
        representante_nome: assinante_nome,
      }).eq("id", row.id);
      if (error) return jsonRes({ erro: "update: " + error.message }, 500);
      return jsonRes({
        ok: true, tipo: "termo",
        codigo: row.codigo,
        assinado_em: agora,
        mensagem: "Termo assinado com sucesso. Você receberá uma cópia por e-mail/WhatsApp em breve.",
      });
    }

    // NDA · escreve nas colunas novas (assinante_ip/ua/assinado_em)
    const { error } = await sb.from("nda_solicitacoes").update({
      status: "assinado",
      assinado_em: agora,
      assinante_ip: ip,
      assinante_ua: ua,
      nome_completo: assinante_nome,
    }).eq("id", row.id);
    if (error) return jsonRes({ erro: "update nda: " + error.message }, 500);

    // Audit log adicional · nda_assinaturas (tabela legacy de log · 4 entries existentes)
    await sb.from("nda_assinaturas").insert({
      usuario_id: null, negocio_id: null, nda_solicitacao_id: row.id,
      tipo: "nda", tipo_termo: "nda",
      ip, user_agent: ua, ip_assinatura: ip,
      assinado_em: agora,
    }).select("id").maybeSingle();

    // Atualiza solicitacoes_info raiz pra status nda_assinado (aciona aprovação admin)
    if (row.solicitacao_info_id) {
      await sb.from("solicitacoes_info").update({ status: "nda_assinado" }).eq("id", row.solicitacao_info_id);
    }

    return jsonRes({
      ok: true, tipo: "nda",
      codigo: row.codigo,
      assinado_em: agora,
      mensagem: "NDA assinado. A 1Negócio vai validar e liberar o dossiê em até 24h.",
    });
  }

  return jsonRes({ erro: "Method not allowed" }, 405);
});
