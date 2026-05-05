// Edge Function: assinar-documento (unificada)
// GET ?link_token=X · retorna documento + telefone do assinante
// POST { link_token, assinante_nome, assinante_cpf, otp_confirmado } · assina

import { cors, svc, jsonRes } from "../_shared/admin-auth.ts";

const ADMIN_WHATSAPP = Deno.env.get("ADMIN_WHATSAPP") ?? "";
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") ?? "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") ?? "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") ?? "";

function obterIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "—";
}

async function notificarAdmin(msg: string): Promise<void> {
  if (!ADMIN_WHATSAPP || !ZAPI_INSTANCE || !ZAPI_TOKEN) return;
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ZAPI_CLIENT_TOKEN) headers["Client-Token"] = ZAPI_CLIENT_TOKEN;
  try {
    await fetch(url, { method: "POST", headers, body: JSON.stringify({ phone: ADMIN_WHATSAPP, message: msg }) });
  } catch (e) { console.warn("[zapi]", e); }
}

async function buscarPorToken(sb: any, token: string): Promise<{ tipo: "termo" | "nda"; row: any } | null> {
  const { data: termo } = await sb.from("termos_adesao")
    .select("id, codigo, plano, status, termo_texto, link_token, gerado_em, assinatura_em, valor_adesao, mensalidade, comissao_pct, forma_pagamento, vendedor_id, negocio_id")
    .eq("link_token", token).maybeSingle();
  if (termo) return { tipo: "termo", row: termo };

  const { data: nda } = await sb.from("nda_solicitacoes")
    .select("id, codigo, status, texto_renderizado, token, gerado_em, assinado_em, nome_completo, solicitacao_info_id, usuario_id, negocio_id")
    .eq("token", token).maybeSingle();
  if (nda) return { tipo: "nda", row: nda };

  return null;
}

async function resolverTelefone(sb: any, tipo: string, row: any): Promise<string> {
  const userId = tipo === "termo" ? row.vendedor_id : row.usuario_id;
  if (!userId) return "";
  const { data: u } = await sb.from("usuarios").select("whatsapp").eq("id", userId).maybeSingle();
  return (u?.whatsapp || "").replace(/\D/g, "");
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

    const statusAtual = row.status as string;
    if (["gerado", "enviado"].includes(statusAtual)) {
      const upd: any = { status: "visualizado", visualizado_em: new Date().toISOString() };
      const tabela = tipo === "termo" ? "termos_adesao" : "nda_solicitacoes";
      await sb.from(tabela).update(upd).eq("id", row.id);
    }

    const telefoneAssinante = await resolverTelefone(sb, tipo, row);

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
        assinante_telefone: telefoneAssinante,
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
        assinante_telefone: telefoneAssinante,
      });
    }
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return jsonRes({ erro: "Invalid JSON" }, 400); }
    const { link_token, assinante_nome, assinante_cpf, otp_confirmado } = body || {};
    if (!link_token || !assinante_nome) return jsonRes({ erro: "link_token e assinante_nome obrigatórios" }, 400);

    if (!otp_confirmado) return jsonRes({ erro: "Confirmação por OTP obrigatória" }, 400);
    const cpfDig = String(assinante_cpf || "").replace(/\D/g, "");
    if (cpfDig.length !== 11) return jsonRes({ erro: "CPF inválido (11 dígitos)" }, 400);

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
        assinante_cpf: cpfDig,
        otp_confirmado: true,
      }).eq("id", row.id);
      if (error) return jsonRes({ erro: "update: " + error.message }, 500);

      // Move negócio pra aguardando_aprovacao se estiver em rascunho/em_avaliacao
      let negocioInfo: any = null;
      if (row.negocio_id) {
        const { data: neg } = await sb.from("negocios")
          .select("id,nome,cidade,estado,status")
          .eq("id", row.negocio_id).maybeSingle();
        negocioInfo = neg;
        if (neg && ["rascunho", "em_avaliacao"].includes(neg.status)) {
          await sb.from("negocios").update({ status: "aguardando_aprovacao" }).eq("id", row.negocio_id);
        }
      }

      // Notifica admin via Z-API
      const linkAdmin = `https://1negocio.com.br/painel-v3.html#op-anuncios?id=${row.negocio_id || ""}`;
      const dispositivo = ua.length > 80 ? ua.slice(0, 80) + "…" : ua;
      const negTit = negocioInfo ? `${negocioInfo.nome || "—"} · ${negocioInfo.cidade || "—"}/${negocioInfo.estado || "—"}` : "—";
      notificarAdmin([
        `🟢 Termo assinado · ${row.codigo} · ${(row.plano || "").toUpperCase()}`,
        ``,
        `Assinante: ${assinante_nome}`,
        `CPF: ${cpfDig}`,
        `Negócio: ${negTit}`,
        `IP: ${ip}`,
        `Dispositivo: ${dispositivo}`,
        ``,
        `Negócio movido para AGUARDANDO_APROVACAO.`,
        `Revisar: ${linkAdmin}`,
      ].join("\n")).catch(() => {});

      return jsonRes({
        ok: true, tipo: "termo",
        codigo: row.codigo,
        assinado_em: agora,
        mensagem: "Termo assinado com sucesso. Você receberá uma cópia por e-mail/WhatsApp em breve.",
      });
    }

    // NDA
    const { error } = await sb.from("nda_solicitacoes").update({
      status: "assinado",
      assinado_em: agora,
      assinante_ip: ip,
      assinante_ua: ua,
      nome_completo: assinante_nome,
      assinante_cpf: cpfDig,
      otp_confirmado: true,
    }).eq("id", row.id);
    if (error) return jsonRes({ erro: "update nda: " + error.message }, 500);

    await sb.from("nda_assinaturas").insert({
      nda_solicitacao_id: row.id,
      tipo: "nda", tipo_termo: "nda",
      ip, user_agent: ua, ip_assinatura: ip,
      assinado_em: agora,
    }).select("id").maybeSingle();

    if (row.solicitacao_info_id) {
      await sb.from("solicitacoes_info").update({ status: "nda_assinado" }).eq("id", row.solicitacao_info_id);
    }

    // Notifica admin via Z-API
    let negocioInfo: any = null;
    if (row.negocio_id) {
      const { data: neg } = await sb.from("negocios")
        .select("id,nome,cidade,estado")
        .eq("id", row.negocio_id).maybeSingle();
      negocioInfo = neg;
    }
    const dispositivo2 = ua.length > 80 ? ua.slice(0, 80) + "…" : ua;
    const negTit2 = negocioInfo ? `${negocioInfo.nome || "—"} · ${negocioInfo.cidade || "—"}/${negocioInfo.estado || "—"}` : "—";
    notificarAdmin([
      `🔒 NDA assinado · ${row.codigo}`,
      ``,
      `Comprador: ${assinante_nome}`,
      `CPF: ${cpfDig}`,
      `Negócio: ${negTit2}`,
      `IP: ${ip}`,
      `Dispositivo: ${dispositivo2}`,
      ``,
      `Aprovação pendente.`,
      `Liberar: https://1negocio.com.br/painel-v3.html#op-dossies`,
    ].join("\n")).catch(() => {});

    return jsonRes({
      ok: true, tipo: "nda",
      codigo: row.codigo,
      assinado_em: agora,
      mensagem: "NDA assinado. A 1Negócio vai validar e liberar o dossiê em até 24h.",
    });
  }

  return jsonRes({ erro: "Method not allowed" }, 405);
});
