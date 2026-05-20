// tese-agente-chat · v9.40.0 · Motor V3.6 · Fix abertura com contexto real
// MUDANÇAS v9.40.0:
//   - Edge sempre busca dados do banco (não depende do client)
//   - Mensagem inicial força agente a descrever o negócio antes de perguntar
//   - Merge banco + client (banco prevalece em campos numéricos)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MAX_TOKENS = 2000;
const CUSTO_POR_TURNO_BRL = 0.05;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtBRL(v: any): string {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n === 0) return "0";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function resumirContextoNegocio(ctx: any): string {
  if (!ctx || typeof ctx !== "object") return "";
  const p: string[] = [];
  const nome = ctx.nome || ctx.titulo_anuncio;
  if (nome) p.push(`Nome/Título: ${nome}`);
  if (ctx.setor) p.push(`Setor: ${ctx.setor}`);
  if (ctx.cidade) p.push(`Cidade: ${ctx.cidade}`);
  if (ctx.faturamento_anual != null && Number(ctx.faturamento_anual) > 0) p.push(`Faturamento anual: R$ ${fmtBRL(ctx.faturamento_anual)}`);
  if (ctx.resultado_operacional != null && Number(ctx.resultado_operacional) > 0) {
    const margemTxt = ctx.margem != null ? ` (margem ${ctx.margem}%)` : "";
    p.push(`Resultado operacional: R$ ${fmtBRL(ctx.resultado_operacional)}${margemTxt}`);
  }
  if (ctx.score_saude != null && ctx.score_saude !== "" && ctx.score_saude !== "—") p.push(`Score de saúde: ${ctx.score_saude}/100`);
  if (ctx.valor_pedido != null && Number(ctx.valor_pedido) > 0) p.push(`Valor pedido pelo dono: R$ ${fmtBRL(ctx.valor_pedido)}`);
  if (ctx.valor_1n != null && Number(ctx.valor_1n) > 0) p.push(`Avaliação 1NEGÓCIO: R$ ${fmtBRL(ctx.valor_1n)}`);
  if (ctx.descricao) p.push(`Descrição do anúncio: ${String(ctx.descricao).slice(0, 400)}`);
  if (ctx.transcricao) p.push(`\nTRANSCRIÇÃO DA REUNIÃO COM O DONO:\n${String(ctx.transcricao).slice(0, 3000)}`);
  return p.join("\n");
}

function composeDadosNegocio(ctx: any, briefing: any): string {
  const c = resumirContextoNegocio(ctx);
  if (c) return c;
  return resumirBriefing(briefing);
}

function resumirBriefing(briefing: any): string {
  if (!briefing) return "(dados do negócio não disponíveis ainda)";
  const n = briefing.negocio || {};
  const t = briefing.tamanho || {};
  const s = briefing.sinergia || {};
  const partes: string[] = [];
  if (n.setor) partes.push(`Setor: ${n.setor}${n.sub_setor ? " / " + n.sub_setor : ""}`);
  if (n.cidade) partes.push(`Cidade: ${n.cidade}${n.estado ? "/" + n.estado : ""}`);
  if (t.faturamento_bruto_anual) partes.push(`Faturamento anual: R$ ${t.faturamento_bruto_anual}`);
  if (t.margem_operacional_pct != null) partes.push(`Margem operacional: ${t.margem_operacional_pct}%`);
  if (t.valor_venda_pedido) partes.push(`Valor venda pedido: R$ ${t.valor_venda_pedido}`);
  if (Array.isArray(briefing.diferenciais_ativos) && briefing.diferenciais_ativos.length > 0) {
    partes.push(`Diferenciais: ${briefing.diferenciais_ativos.slice(0, 3).map((d: any) => typeof d === "string" ? d : d?.texto || "").filter(Boolean).join(" · ")}`);
  }
  if (s.ganho_consolidador) partes.push(`Sinergia: ${s.ganho_consolidador}`);
  if (Array.isArray(briefing.tipos_comprador_buscar) && briefing.tipos_comprador_buscar.length > 0) {
    partes.push(`Tipos comprador alvo: ${briefing.tipos_comprador_buscar.join(", ")}`);
  }
  if (briefing.alcance_geografico_comprador) partes.push(`Alcance: ${briefing.alcance_geografico_comprador}`);
  return partes.length > 0 ? partes.join("\n") : "(dados do negócio não disponíveis ainda)";
}

// v9.40.0 · busca contexto completo do negócio direto no banco
// Sempre executa · independente do que o client enviou
async function buscarContextoNegocioBanco(adminClient: any, negId: string): Promise<any | null> {
  if (!negId) return null;
  try {
    const [{ data: neg }, { data: anuArr }, { data: laudo }] = await Promise.all([
      adminClient
        .from("negocios")
        .select("nome, titulo_anuncio, setor, cidade, estado, faturamento_anual, ebitda_anual, score_saude, preco_pedido, valor_1n, descricao_geral")
        .eq("id", negId)
        .maybeSingle(),
      adminClient
        .from("anuncios_v2")
        .select("titulo, valor_pedido, descricao_card")
        .eq("negocio_id", negId)
        .limit(1),
      adminClient
        .from("laudos_v2")
        .select("calc_json")
        .eq("negocio_id", negId)
        .eq("ativo", true)
        .order("versao", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const anu = Array.isArray(anuArr) && anuArr.length > 0 ? anuArr[0] : null;
    const dre: any = laudo?.calc_json?.dre || null;
    if (!neg && !dre) return null;
    const fatAnual = dre?.fat_anual != null ? Number(dre.fat_anual) : Number(neg?.faturamento_anual || 0);
    const roAnual = dre?.ro_anual != null ? Number(dre.ro_anual) : Number(neg?.ebitda_anual || 0);
    const margem = dre?.margem_operacional_pct != null
      ? Math.round(Number(dre.margem_operacional_pct))
      : (fatAnual > 0 ? Math.round((roAnual / fatAnual) * 100) : null);
    return {
      nome: neg?.nome || neg?.titulo_anuncio || anu?.titulo || null,
      titulo_anuncio: neg?.titulo_anuncio || anu?.titulo || null,
      setor: neg?.setor || null,
      cidade: neg?.cidade ? `${neg.cidade}${neg.estado ? "/" + neg.estado : ""}` : null,
      faturamento_anual: fatAnual || null,
      resultado_operacional: roAnual || null,
      margem,
      score_saude: neg?.score_saude ?? null,
      valor_pedido: Number(anu?.valor_pedido || neg?.preco_pedido || 0) || null,
      valor_1n: Number(neg?.valor_1n || 0) || null,
      descricao: anu?.descricao_card || neg?.descricao_geral || null,
    };
  } catch (_) {
    return null;
  }
}

// v9.40.0 · merge banco + client · banco prevalece em campos numéricos
function mergeContexto(banco: any | null, client: any | null, transcricao: string | null): any | null {
  if (!banco && !client) return null;
  const base = banco || client;
  const complemento = banco ? client : null;
  return {
    nome: base?.nome || complemento?.nome || null,
    titulo_anuncio: base?.titulo_anuncio || complemento?.titulo_anuncio || null,
    setor: base?.setor || complemento?.setor || null,
    cidade: base?.cidade || complemento?.cidade || null,
    // banco prevalece em numéricos (fonte canônica = laudos_v2)
    faturamento_anual: base?.faturamento_anual || complemento?.faturamento_anual || null,
    resultado_operacional: base?.resultado_operacional || complemento?.resultado_operacional || null,
    margem: base?.margem ?? complemento?.margem ?? null,
    score_saude: base?.score_saude ?? complemento?.score_saude ?? null,
    valor_pedido: base?.valor_pedido || complemento?.valor_pedido || null,
    valor_1n: base?.valor_1n || complemento?.valor_1n || null,
    descricao: base?.descricao || complemento?.descricao || null,
    transcricao: transcricao || client?.transcricao || null,
  };
}

function systemPromptTese(ctx: any, briefing: any, teseAtual: any): string {
  const dadosNegocio = composeDadosNegocio(ctx, briefing);
  const teseAtualStr = teseAtual && Object.keys(teseAtual).length > 0
    ? `\nTESE ATUAL (rascunho versão ${teseAtual?._versao || 1}):\n${JSON.stringify(teseAtual, null, 2)}`
    : "";
  return `Você é um analista sênior de M&A especializado em pequenas e médias empresas brasileiras.
Seu objetivo nesta fase é construir uma TESE DE INVESTIMENTO sólida para o negócio em questão.

DADOS DO NEGÓCIO (carregados automaticamente):
${dadosNegocio}
${teseAtualStr}

VOCABULÁRIO OBRIGATÓRIO — NUNCA violar:
- NUNCA usar "EBITDA". Sempre "resultado operacional".
- NUNCA usar "M&A". Sempre "compra e venda de empresas".
- Múltiplos: calcular SEMPRE como (valor_pedido / resultado_operacional) = múltiplo resultado operacional
  e (valor_pedido / faturamento_anual) = múltiplo receita bruta.
  Exemplo correto: "R$ 450k = 0,6x receita bruta · 2,7x resultado operacional"
  NUNCA inverter os labels.

REGRAS DE TOM E FORMATO:
- Na PRIMEIRA mensagem: apresente os dados que já tem (setor, cidade, financeiro, múltiplos, valor pedido).
  Depois proponha hipóteses para cada componente da tese — baseadas nos dados disponíveis.
  Por último, pergunte UMA coisa: se as hipóteses fazem sentido ou o que muda.
- Nas mensagens seguintes: continue propondo, nunca só perguntando.
  Formato: "Minha leitura é X. Faz sentido?" — não "Qual é o X?"
- Faça UMA pergunta por vez. Nunca duas.
- Use os dados que já tem — não peça o que já sabe.
- Tom: analista frio, direto, factual. Nunca vendedor. Não use "claro" / "perfeito" / "ótimo".
- Quando tiver informação suficiente para os 5 componentes, proponha a tese completa.
- Ao propor a tese, inclua no final da resposta, numa linha separada:
  TESE_COMPLETA_JSON:{"diferencial_competitivo":"...","dependencia_dono":"...","perfil_comprador_ideal":"...","riscos_principais":["...","..."],"justificativa_preco":"..."}

5 componentes obrigatórios:
1. diferencial_competitivo: o que torna este negócio único e defensável
2. dependencia_dono: grau de dependência e impacto na transferência
3. perfil_comprador_ideal: quem teria mais a ganhar com essa aquisição
4. riscos_principais: array com 3-5 riscos reais e específicos
5. justificativa_preco: múltiplo resultado operacional + múltiplo receita bruta + benchmark setorial`;
}

function systemPromptArquetipos(ctx: any, briefing: any, tese: any): string {
  const dadosNegocio = composeDadosNegocio(ctx, briefing);
  const teseTxt = JSON.stringify(tese || {}, null, 2);
  return `Você é um especialista em M&A e análise de compradores para PMEs brasileiras.
Tese de investimento aprovada:
${teseTxt}

Negócio:
${dadosNegocio}

OBJETIVO: Identificar 4-7 arquétipos de compradores reais e específicos.

OBRIGATÓRIO cobrir as 7 dimensões (não precisa todas, mas pelo menos 4 distintas):
1. horizontal - concorrente direto que quer crescer
2. vertical_antes - fornecedor que quer verticalizar (ter ponto de venda)
3. vertical_depois - cliente que quer integrar (reduzir custos)
4. adjacente - negócio diferente mas com sinergia operacional
5. clientes_negocio - consumidor fiel que sempre quis ter o negócio
6. investidor_financeiro - PF ou empresa buscando rentabilidade
7. profissional_setor - funcionário/profissional com perfil empreendedor latente

Para cada arquétipo gere:
- nome: nome descritivo específico (ex: "Distribuidora regional de bebidas")
- dimensao: uma das 7 acima
- logica_compra: por que compraria (racional + emocional)
- objecoes: 2-3 objeções mais prováveis
- sinal_qualificacao: como reconhecer este perfil
- capacidade_financeira: estimativa de capacidade de compra
- mensagem_abordagem: como iniciar contato (tom + conteúdo)

REGRAS:
- Faça UMA pergunta por vez se faltar informação.
- Use os dados da tese · não peça o que já sabe.
- Tom: analista frio, direto. Nada de "claro" / "perfeito".

Quando tiver os arquétipos prontos, inclua no final:
ARQUETIPOS_COMPLETOS_JSON:[{"nome":"...","dimensao":"...","logica_compra":"...","objecoes":["..."],"sinal_qualificacao":"...","capacidade_financeira":"...","mensagem_abordagem":"..."}]`;
}

function systemPromptAmbientacao(ctx: any, briefing: any, arquetipos: any[]): string {
  const dadosNegocio = composeDadosNegocio(ctx, briefing);
  const arqsTxt = JSON.stringify(arquetipos || [], null, 2);
  return `Você é um especialista em prospecção B2B e inteligência de mercado para PMEs brasileiras.

⚠️ ATENÇÃO: Esta fase NÃO é sobre descrever o negócio. O negócio já foi descrito nas fases anteriores.
Esta fase é exclusivamente sobre LOCALIZAR OS COMPRADORES no mundo real.

Arquétipos de compradores aprovados:
${arqsTxt}

Negócio de referência (contexto apenas):
${dadosNegocio}

OBJETIVO ÚNICO DESTA FASE:
Para cada arquétipo acima, responder: onde essa pessoa física ou empresa ESTÁ no mundo real?
Onde ela aparece? O que ela lê? Em quais grupos participa? Quais eventos frequenta?
Isso vai alimentar diretamente as ferramentas de prospecção (Google Maps, Facebook, Instagram, associações).

Para cada arquétipo, mapeie:
- grupos_online: nomes reais de grupos Facebook/LinkedIn/WhatsApp onde este perfil está
- associacoes: entidades setoriais reais (ABRASEL, CDL, APAS, sindicatos, federações, etc.)
- eventos_feiras: eventos reais e recorrentes onde este perfil aparece (nome + frequência + cidade)
- canais_digitais: hashtags Instagram, canais YouTube, podcasts, newsletters do setor
- corretores_facilitadores: tipo de profissional que pode intermediar o contato com este perfil

TAMBÉM mapeie para o DONO DO NEGÓCIO (onde ele deveria aparecer para encontrar compradores):
- eventos_para_ir: eventos onde o dono deveria se posicionar
- grupos_para_entrar: grupos onde o dono deveria participar ativamente

REGRAS:
- Use nomes REAIS e ESPECÍFICOS. Não invente. Prefira ser honesto se não souber.
- NÃO descreva o negócio. NÃO repita a tese. NÃO fale sobre ambientação do empório.
- Se precisar de informação, faça UMA pergunta direta sobre o arquétipo, não sobre o negócio.
- Tom: analista frio, direto, operacional.

Na PRIMEIRA mensagem: apresente o mapeamento dos 7 arquétipos diretamente.
Não pergunte nada antes — você tem informação suficiente para começar.

Quando concluir, inclua no final numa linha separada:
AMBIENTACAO_COMPLETA_JSON:{"por_arquetipo":{"[nome_arquetipo]":{"grupos_online":["..."],"associacoes":["..."],"eventos_feiras":["..."],"canais_digitais":["..."],"corretores_facilitadores":"..."}},"sugestoes_dono":{"eventos_para_ir":[{"nome":"...","quando":"...","cidade":"...","motivo":"..."}],"grupos_para_entrar":[{"nome":"...","plataforma":"...","url":"...","motivo":"..."}]}}`;
}

function systemPromptLivre(ctx: any, briefing: any, tese: any, arquetipos: any[]): string {
  return `Você é um analista sênior de M&A. Tese aprovada: ${JSON.stringify(tese || {}, null, 2)}.
Arquétipos: ${JSON.stringify(arquetipos || [], null, 2)}.
Negócio: ${composeDadosNegocio(ctx, briefing)}.

Continue ajudando com ideias estratégicas livres: roteiros de abordagem, refinamento de mensagens,
sugestões de timing, materiais de apoio, qualquer coisa que avance o projeto.
Tom: analista frio, direto. Nada de emojis ou "claro" / "perfeito".`;
}

function extrairJsonAposMarcador(texto: string, marcador: string): any | null {
  const idx = texto.indexOf(marcador);
  if (idx === -1) return null;
  const depois = texto.slice(idx + marcador.length).trim();
  const m = depois.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) return null;
  for (let len = m[1].length; len > 1; len--) {
    try { return JSON.parse(m[1].slice(0, len)); } catch { /* keep */ }
  }
  try { return JSON.parse(m[1]); } catch { return null; }
}

function limparMarcadores(texto: string): string {
  return texto
    .replace(/TESE_COMPLETA_JSON:[\s\S]*$/m, "")
    .replace(/ARQUETIPOS_COMPLETOS_JSON:[\s\S]*$/m, "")
    .replace(/AMBIENTACAO_COMPLETA_JSON:[\s\S]*$/m, "")
    .replace(/TESE_COMPLETA:[\s\S]*$/m, "")
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await adminClient
    .from("admins").select("id, ativo")
    .eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const {
    originacao_id,
    mensagem,
    historico: histFromClient,
    fase_atual = "tese",
    reiniciar,
    salvar_output,
    contexto_negocio: ctxFromClient,
    negocio_id: negIdFromClient,
  } = body || {};

  // v9.43.5 · modo:'json_only' · bypass conversacional pra one-shot estruturados (aba Mídia, etc.)
  if (body?.modo === 'json_only') {
    const userMsg = (body.mensagens?.[0]?.content || body.mensagem || '').toString().trim();
    if (!userMsg) return resp(400, { ok: false, erro: "prompt_vazio_em_json_only" });
    try {
      const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 3000,
          system: "Você é assistente. Retorne APENAS o JSON solicitado pelo usuário, sem markdown, sem texto antes ou depois.",
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      const claudeData = await claudeResp.json();
      if (!claudeResp.ok) return resp(claudeResp.status, { ok: false, erro: "claude_falhou", detalhe: claudeData });
      const txt = (claudeData?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      return resp(200, {
        ok: true,
        resposta: txt,
        tokens_in: claudeData?.usage?.input_tokens ?? 0,
        tokens_out: claudeData?.usage?.output_tokens ?? 0,
      });
    } catch (e: any) {
      return resp(500, { ok: false, erro: "exception_json_only", detalhe: e?.message });
    }
  }

  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao")
      .select("id, projeto_id, briefing_jsonb, tese_jsonb, tese_versao, tese_chat_historico, gasto_anthropic_mes, busca_config_jsonb, arquetipos_fechados_em, tese_fechada_em")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });

    // ---- salvar_output ----
    if (salvar_output && salvar_output.tipo) {
      if (salvar_output.tipo === "tese") {
        const dados = { ...(salvar_output.dados || {}), _versao: (orig.tese_versao || 0) + 1 };
        await adminClient.from("projetos_originacao").update({
          tese_jsonb: dados,
          tese_versao: (orig.tese_versao || 0) + 1,
          tese_fechada_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", originacao_id);
        return resp(200, { ok: true, salvo: "tese" });
      }
      if (salvar_output.tipo === "arquetipos") {
        const lista = Array.isArray(salvar_output.dados) ? salvar_output.dados : [];
        let inseridos = 0;
        for (const arq of lista) {
          const row: Record<string, unknown> = {
            originacao_id,
            projeto_id: orig.projeto_id,
            nome: arq.nome,
            tipo: arq.dimensao,
            vetor: arq.logica_compra,
            perfil: arq.sinal_qualificacao,
            motivacao: arq.logica_compra,
            capacidade_financeira: arq.capacidade_financeira,
            status: "aprovado",
            criado_pela_ia: true,
            aprovado_em: new Date().toISOString(),
          };
          const { error: upErr } = await adminClient
            .from("arquetipos_compradores")
            .upsert(row, { onConflict: "originacao_id,nome" });
          if (!upErr) inseridos++;
        }
        await adminClient.from("projetos_originacao").update({
          arquetipos_fechados_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", originacao_id);
        return resp(200, { ok: true, salvo: "arquetipos", total: inseridos });
      }
      if (salvar_output.tipo === "ambientacao") {
        const config = (orig.busca_config_jsonb && typeof orig.busca_config_jsonb === "object") ? { ...orig.busca_config_jsonb } : {};
        config.ambientacao = salvar_output.dados?.por_arquetipo || {};
        config.sugestoes_dono = salvar_output.dados?.sugestoes_dono || {};
        await adminClient.from("projetos_originacao").update({
          busca_config_jsonb: config,
          updated_at: new Date().toISOString(),
        }).eq("id", originacao_id);
        if (orig.projeto_id && salvar_output.dados?.sugestoes_dono) {
          const eventos = (salvar_output.dados.sugestoes_dono.eventos_para_ir || []).map((e: any) => ({
            tipo: "evento",
            projeto_metadata_id: orig.projeto_id,
            nome: e.nome,
            descricao: e.motivo || null,
            url: e.url || null,
            cidade: e.cidade || null,
            data_evento: e.quando && /^\d{4}-\d{2}-\d{2}$/.test(e.quando) ? e.quando : null,
            motivo: e.motivo || null,
            gerado_por_ia: true,
          }));
          const grupos = (salvar_output.dados.sugestoes_dono.grupos_para_entrar || []).map((g: any) => ({
            tipo: "grupo",
            projeto_metadata_id: orig.projeto_id,
            nome: g.nome,
            descricao: g.motivo || null,
            url: g.url || null,
            plataforma: g.plataforma || null,
            motivo: g.motivo || null,
            gerado_por_ia: true,
          }));
          const sugs = [...eventos, ...grupos];
          if (sugs.length > 0) {
            await adminClient.from("projeto_sugestoes_dono").insert(sugs);
          }
        }
        return resp(200, { ok: true, salvo: "ambientacao" });
      }
      return resp(400, { ok: false, erro: "tipo_salvar_output_invalido" });
    }

    // ---- chat normal ----
    let historico: any[] = Array.isArray(orig.tese_chat_historico) ? orig.tese_chat_historico : [];
    if (Array.isArray(histFromClient) && histFromClient.length > 0) historico = histFromClient;
    if (reiniciar) historico = [];

    if (mensagem && typeof mensagem === "string" && mensagem.trim()) {
      historico.push({ role: "user", content: mensagem.trim(), ts: new Date().toISOString(), fase: fase_atual });
    }

    // v9.40.0 · SEMPRE busca negocio_id · via projeto_metadata ou client
    let negId: string | null = negIdFromClient || null;
    if (!negId && orig.projeto_id) {
      const { data: meta } = await adminClient
        .from("projeto_metadata").select("negocio_id").eq("id", orig.projeto_id).maybeSingle();
      negId = meta?.negocio_id || null;
    }

    // v9.40.0 · busca banco sempre · merge com client
    const ctxBanco = negId ? await buscarContextoNegocioBanco(adminClient, negId) : null;
    const transcricao = orig.briefing_jsonb?.transcricao_reuniao || ctxFromClient?.transcricao || null;
    const contextoNegocio = mergeContexto(ctxBanco, ctxFromClient || null, transcricao);

    // Carregar arquetipos aprovados (necessário pra fases ambientacao/livre)
    let arquetiposAprovados: any[] = [];
    if (fase_atual === "ambientacao" || fase_atual === "livre") {
      const { data: arqs } = await adminClient
        .from("arquetipos_compradores")
        .select("nome,tipo,vetor,perfil,motivacao,capacidade_financeira")
        .eq("originacao_id", originacao_id).eq("status", "aprovado");
      arquetiposAprovados = arqs || [];
    }

    let systemPrompt = "";
    if (fase_atual === "tese") {
      systemPrompt = systemPromptTese(contextoNegocio, orig.briefing_jsonb, orig.tese_jsonb);
    } else if (fase_atual === "arquetipos") {
      systemPrompt = systemPromptArquetipos(contextoNegocio, orig.briefing_jsonb, orig.tese_jsonb);
    } else if (fase_atual === "ambientacao") {
      systemPrompt = systemPromptAmbientacao(contextoNegocio, orig.briefing_jsonb, arquetiposAprovados);
    } else {
      systemPrompt = systemPromptLivre(contextoNegocio, orig.briefing_jsonb, orig.tese_jsonb, arquetiposAprovados);
    }

    // v9.40.0 · mensagem inicial força o agente a descrever o negócio antes de perguntar
    // antes era "me pergunte o que precisa" → agente ficava perguntando em vez de apresentar
    const ultimas = historico.slice(-20).map((m: any) => ({ role: m.role, content: m.content }));
    const messagesParaApi = ultimas.length > 0
      ? ultimas
      : fase_atual === 'ambientacao'
        ? [{ role: "user", content: "Mapeie agora onde estão os compradores de cada arquétipo no mundo real. Apresente direto, sem introdução." }]
        : [{ role: "user", content: "Vamos começar. Apresente o que você já sabe sobre o negócio e me diga o que ainda precisa entender para montar a tese." }];

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: messagesParaApi,
      }),
    });

    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      return resp(500, { ok: false, erro: `claude_status_${claudeResp.status}`, detalhe: errTxt.slice(0, 300) });
    }

    const claudeData = await claudeResp.json();
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const respostaAgente = textBlocks.map((b: any) => b.text).join("\n");

    let fase_concluida: string | null = null;
    let output_proposto: any = null;

    if (fase_atual === "tese") {
      const j = extrairJsonAposMarcador(respostaAgente, "TESE_COMPLETA_JSON:");
      if (j && typeof j === "object" && !Array.isArray(j)) { fase_concluida = "tese"; output_proposto = j; }
    } else if (fase_atual === "arquetipos") {
      const j = extrairJsonAposMarcador(respostaAgente, "ARQUETIPOS_COMPLETOS_JSON:");
      if (Array.isArray(j) && j.length > 0) { fase_concluida = "arquetipos"; output_proposto = j; }
    } else if (fase_atual === "ambientacao") {
      const j = extrairJsonAposMarcador(respostaAgente, "AMBIENTACAO_COMPLETA_JSON:");
      if (j && typeof j === "object") { fase_concluida = "ambientacao"; output_proposto = j; }
    }

    historico.push({ role: "assistant", content: respostaAgente, ts: new Date().toISOString(), fase: fase_atual });

    await adminClient
      .from("projetos_originacao")
      .update({
        tese_chat_historico: historico,
        gasto_anthropic_mes: Number(orig.gasto_anthropic_mes || 0) + CUSTO_POR_TURNO_BRL,
        updated_at: new Date().toISOString(),
      })
      .eq("id", originacao_id);

    return resp(200, {
      ok: true,
      resposta: limparMarcadores(respostaAgente),
      fase_concluida,
      output_proposto,
      fase_atual,
      tese_completa: fase_concluida === "tese",
      tese_proposta: fase_concluida === "tese" ? output_proposto : null,
      historico_count: historico.length,
      historico,
      custo_brl: CUSTO_POR_TURNO_BRL,
      tokens_in: claudeData?.usage?.input_tokens ?? 0,
      tokens_out: claudeData?.usage?.output_tokens ?? 0,
    });
  } catch (e: any) {
    console.error("[tese-agente-chat v9.40.0] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
