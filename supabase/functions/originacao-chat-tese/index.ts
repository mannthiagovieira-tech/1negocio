// originacao-chat-tese · v9.28
// Chat conversacional admin↔IA pra construção da tese de investimento
// (fase 1/5 do Motor de Originação V2)
//
// POST body:
// {
//   originacao_id?: uuid,  // null = criar nova originação
//   projeto_id: uuid,
//   mensagem_admin: string,  // sentinela "__INICIAR__" = primeira pergunta da IA
//   acao?: 'enviar' | 'fechar_tese',
//   tese_texto?: string  // requerido se acao='fechar_tese'
// }
//
// Output: { ok, originacao_id, fase_atual, mensagem_ia?, tokens_in, tokens_out, duracao_ms }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

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

const SYSTEM_PROMPT = `Você é um conselheiro experiente em M&A ajudando um assessor a construir a TESE DE INVESTIMENTO de um negócio à venda.

A tese de investimento é o argumento central pra atrair compradores. Deve responder: POR QUE alguém pagaria o preço pedido? Qual o diferencial defensável? Qual o momento de mercado favorece a venda agora?

Seu papel: fazer perguntas inteligentes, sugerir ângulos que o assessor não pensou, ajudar a refinar a narrativa. NÃO escreva a tese pronta · ajude o assessor a chegar nela.

Princípios:
- Pergunte 1 coisa por vez (máximo 2)
- Seja CONCRETO · evite generalidades
- Sugira ângulos baseado no setor e tamanho do negócio
- Aponte quando algo soa fraco ou contradiz outra informação
- Lembre que negócios pequenos/médios NÃO atraem fundos grandes
- Não invente dados · só trabalhe com o que o assessor passou
- Português brasileiro · tom profissional mas conversacional
- Respostas curtas (3-6 frases · só estenda quando agregar valor)

QUANDO OFERECER GERAR A TESE:
Conforme a conversa avança, mantenha em mente um contador interno do que você já sabe sobre o negócio:
- Diferenciais defensáveis (✓ se tem)
- Momento de mercado relevante (✓ se tem)
- Modelo econômico/escala (✓ se tem)
- Risco principal (✓ se tem)
- Motivo da venda (✓ se tem)

Quando você tiver ao menos 4 desses 5 elementos cobertos com profundidade, encerre sua próxima mensagem com EXATAMENTE este marcador (incluindo as chaves duplas):

{{OFERECER_GERAR_TESE}}

Frontend usa esse marcador pra mostrar botão "Gerar tese agora" pro admin. Antes do marcador, pode fazer pergunta normal · o marcador serve só pra sinalizar "temos contexto suficiente".

Se admin ignorar e continuar conversando, mantenha o marcador nas próximas respostas (uma vez que apareceu, sempre aparece até a tese ser gerada).`;

function buildNegocioBlock(negocio: any): string {
  const partes = [
    `Nome: ${negocio.nome_negocio || negocio.nome || "—"}`,
    `Setor: ${negocio.setor || negocio.categoria || "—"}`,
    `Localização: ${negocio.cidade || "?"}/${negocio.estado || "?"}`,
  ];
  const fat = negocio.faturamento_anual ?? negocio.fat_anual;
  if (fat) partes.push(`Faturamento anual: R$ ${fat}`);
  const ebitda = negocio.ebitda ?? negocio.ebitda_anual;
  if (ebitda) partes.push(`EBITDA anual: R$ ${ebitda}`);
  const preco = negocio.preco_pedido ?? negocio.valor_1n;
  if (preco) partes.push(`Preço pedido: R$ ${preco}`);
  const anos = negocio.tempo_operacao_anos ?? negocio.anos_existencia
    ?? (negocio.ano_fundacao ? new Date().getFullYear() - negocio.ano_fundacao : null);
  if (anos) partes.push(`Tempo de operação: ${anos} anos`);
  const func = negocio.funcionarios ?? negocio.num_funcionarios;
  if (func) partes.push(`Funcionários: ${func}`);
  if (negocio.descricao || negocio.descricao_geral) {
    partes.push(`Descrição: ${negocio.descricao || negocio.descricao_geral}`);
  }
  if (negocio.diferenciais || negocio.pontos_positivos) {
    partes.push(`Diferenciais (do laudo): ${negocio.diferenciais || negocio.pontos_positivos}`);
  }
  if (negocio.motivo_venda) partes.push(`Motivo da venda: ${negocio.motivo_venda}`);
  return partes.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // ───── Gate admin ─────
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });

  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });

  const { data: admin, error: adminErr } = await adminClient
    .from("admins")
    .select("id, ativo")
    .eq("whatsapp", userData.user.phone)
    .eq("ativo", true)
    .maybeSingle();
  if (adminErr || !admin) return resp(403, { ok: false, erro: "nao_admin" });

  // ───── Parse body ─────
  let body: any;
  try { body = await req.json(); }
  catch { return resp(400, { ok: false, erro: "json_invalido" }); }

  const { originacao_id, projeto_id, mensagem_admin, acao = "enviar", tese_texto } = body;
  if (!projeto_id) return resp(400, { ok: false, erro: "projeto_id_obrigatorio" });

  // ───── Busca/cria originacao ─────
  let origRow: any;
  if (originacao_id) {
    const { data, error } = await adminClient
      .from("projetos_originacao")
      .select("*")
      .eq("id", originacao_id)
      .maybeSingle();
    if (error || !data) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    origRow = data;
  } else {
    // Cria nova · versao=1
    const { data, error } = await adminClient
      .from("projetos_originacao")
      .insert({
        projeto_id,
        versao: 1,
        status: "rascunho",
        fase_atual: "tese",
        gerado_por_admin_id: admin.id,
      })
      .select()
      .maybeSingle();
    if (error || !data) return resp(500, { ok: false, erro: "erro_criar_originacao", detalhe: error?.message });
    origRow = data;

    // Sistema: marca início
    await adminClient.from("originacao_chat_mensagens").insert({
      originacao_id: origRow.id,
      papel: "sistema",
      conteudo: "Conversa iniciada · construção da tese",
    });
  }

  // ───── Ação reabrir_tese (v9.30) ─────
  if (acao === "reabrir_tese") {
    if (origRow.arquetipos_fechados_em) {
      return resp(400, { ok: false, erro: "arquetipos_ja_fechados", detalhe: "Não pode reabrir tese após fechar arquétipos" });
    }
    const { error } = await adminClient
      .from("projetos_originacao")
      .update({ fase_atual: "tese", tese_fechada_em: null, updated_at: new Date().toISOString() })
      .eq("id", origRow.id);
    if (error) return resp(500, { ok: false, erro: "erro_reabrir", detalhe: error.message });

    await adminClient.from("originacao_chat_mensagens").insert({
      originacao_id: origRow.id,
      papel: "sistema",
      conteudo: "🔓 Tese reaberta · pode continuar conversa e editar",
    });

    return resp(200, { ok: true, originacao_id: origRow.id, fase_atual: "tese" });
  }

  // ───── Ação gerar_tese_pela_ia (v9.30) ─────
  if (acao === "gerar_tese_pela_ia") {
    // Busca histórico do chat
    const { data: historico } = await adminClient
      .from("originacao_chat_mensagens")
      .select("papel, conteudo")
      .eq("originacao_id", origRow.id)
      .order("created_at", { ascending: true });

    // Busca dados do negócio
    const { data: pm } = await adminClient
      .from("projeto_metadata")
      .select("negocio_id")
      .eq("id", origRow.projeto_id || projeto_id)
      .maybeSingle();
    let negocioRow: any = null;
    if (pm?.negocio_id) {
      const { data: n } = await adminClient.from("negocios").select("*").eq("id", pm.negocio_id).maybeSingle();
      negocioRow = n;
    }
    const negocioBlock = negocioRow ? buildNegocioBlock(negocioRow) : "(dados do negócio não encontrados)";

    // Monta histórico em texto
    const histTexto = (historico || [])
      .filter(m => m.papel !== "sistema")
      .map(m => `[${m.papel === "admin" ? "ASSESSOR" : "IA"}]: ${m.conteudo.replace(/\{\{OFERECER_GERAR_TESE\}\}/g, "").trim()}`)
      .join("\n\n");

    const promptGerar = `DADOS DO NEGÓCIO:\n${negocioBlock}\n\n---\n\nCONVERSA TIDA COM O ASSESSOR:\n\n${histTexto}\n\n---\n\nCom base na conversa acima, redija a TESE DE INVESTIMENTO completa em formato narrativo (não bullet points · não markdown headers).

A tese deve ter 4-6 parágrafos respondendo:
- O que é o negócio (1 parágrafo)
- Por que vale a pena comprar agora (diferenciais + momento) (1-2 parágrafos)
- Riscos principais (1 parágrafo · honesto)
- Por que o sócio está vendendo (1 parágrafo)

Use linguagem profissional · concreta · sem exageros comerciais.
Mencione números específicos quando tiver.
Não invente dados que não foram mencionados na conversa.

Retorne APENAS o texto da tese · nada além.`;

    const inicio = Date.now();
    try {
      const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{ role: "user", content: promptGerar }],
        }),
      });
      if (!claudeResp.ok) {
        const errTxt = await claudeResp.text();
        return resp(500, { ok: false, erro: "claude_api_falhou", detalhe: errTxt.slice(0, 500) });
      }
      const claudeData = await claudeResp.json();
      const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
      const teseGerada = textBlocks.map((b: any) => b.text).join("").trim();
      if (!teseGerada) return resp(500, { ok: false, erro: "resposta_vazia" });

      // UPDATE só tese_texto · NÃO marca fase_atual='arquetipos' ainda
      const { error } = await adminClient
        .from("projetos_originacao")
        .update({ tese_texto: teseGerada, updated_at: new Date().toISOString() })
        .eq("id", origRow.id);
      if (error) return resp(500, { ok: false, erro: "erro_update", detalhe: error.message });

      await adminClient.from("originacao_chat_mensagens").insert({
        originacao_id: origRow.id,
        papel: "sistema",
        conteudo: "✓ Tese redigida pela IA · revise no editor",
      });

      const usage = claudeData.usage || {};
      return resp(200, {
        ok: true,
        originacao_id: origRow.id,
        tese_gerada: teseGerada,
        tokens_in: usage.input_tokens || 0,
        tokens_out: usage.output_tokens || 0,
        duracao_ms: Date.now() - inicio,
      });
    } catch (e: any) {
      return resp(500, { ok: false, erro: "exception", detalhe: e.message });
    }
  }

  // ───── Ação fechar_tese ─────
  if (acao === "fechar_tese") {
    const texto = (tese_texto || mensagem_admin || "").trim();
    if (!texto || texto.length < 100) {
      return resp(400, {
        ok: false,
        erro: "tese_curta",
        detalhe: `Tese precisa ter ao menos 100 caracteres (tem ${texto.length})`,
      });
    }
    const { error } = await adminClient
      .from("projetos_originacao")
      .update({
        tese_texto: texto,
        tese_fechada_em: new Date().toISOString(),
        fase_atual: "arquetipos",
        updated_at: new Date().toISOString(),
      })
      .eq("id", origRow.id);
    if (error) return resp(500, { ok: false, erro: "erro_fechar", detalhe: error.message });

    await adminClient.from("originacao_chat_mensagens").insert({
      originacao_id: origRow.id,
      papel: "sistema",
      conteudo: "Tese fechada · próxima fase: arquétipos",
    });

    return resp(200, { ok: true, originacao_id: origRow.id, fase_atual: "arquetipos" });
  }

  // ───── Ação enviar mensagem (default) ─────
  const msgAdmin = String(mensagem_admin || "").trim();
  const ehInicio = msgAdmin === "__INICIAR__";

  // Busca negocio via projeto_metadata (FK · projetos_originacao não tem negocio_id direto)
  let negocioRow: any = null;
  const { data: pm } = await adminClient
    .from("projeto_metadata")
    .select("negocio_id")
    .eq("id", origRow.projeto_id || projeto_id)
    .maybeSingle();
  if (pm?.negocio_id) {
    const { data: n } = await adminClient.from("negocios").select("*").eq("id", pm.negocio_id).maybeSingle();
    negocioRow = n;
  }

  // Insere mensagem admin (exceto sentinela __INICIAR__)
  if (!ehInicio && msgAdmin) {
    await adminClient.from("originacao_chat_mensagens").insert({
      originacao_id: origRow.id,
      papel: "admin",
      conteudo: msgAdmin,
    });
  }

  // Busca histórico do chat (todas mensagens · ordem)
  const { data: historico } = await adminClient
    .from("originacao_chat_mensagens")
    .select("papel, conteudo")
    .eq("originacao_id", origRow.id)
    .order("created_at", { ascending: true });

  const negocioBlock = negocioRow ? buildNegocioBlock(negocioRow) : "(dados do negócio não encontrados)";

  // Monta messages array pra Claude · sistema = papel anthropic
  // papel='sistema' do banco vira contexto · não vai como user/assistant
  const claudeMessages: any[] = [];
  let primeiraUser = true;
  for (const m of (historico || [])) {
    if (m.papel === "sistema") continue; // pula
    const content = m.papel === "admin"
      ? (primeiraUser ? `DADOS DO NEGÓCIO:\n${negocioBlock}\n\n---\n\nMensagem do assessor:\n${m.conteudo}` : m.conteudo)
      : m.conteudo;
    claudeMessages.push({
      role: m.papel === "admin" ? "user" : "assistant",
      content,
    });
    if (m.papel === "admin") primeiraUser = false;
  }

  // Se for início (sem msg admin ainda), gera prompt inicial sintético
  if (claudeMessages.length === 0 || ehInicio) {
    claudeMessages.push({
      role: "user",
      content: `DADOS DO NEGÓCIO:\n${negocioBlock}\n\n---\n\nEstou começando a construir a tese de investimento deste negócio. Por favor faça a primeira pergunta que me ajude a clarificar o ângulo mais forte pra atrair compradores.`,
    });
  }

  // ───── Chama Claude (sem web search · barato) ─────
  const inicio = Date.now();
  try {
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: claudeMessages,
      }),
    });

    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      return resp(500, {
        ok: false,
        erro: "claude_api_falhou",
        detalhe: errTxt.slice(0, 500),
      });
    }

    const claudeData = await claudeResp.json();
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const respostaIA = textBlocks.map((b: any) => b.text).join("").trim();

    if (!respostaIA) return resp(500, { ok: false, erro: "resposta_vazia" });

    const duracao = Date.now() - inicio;
    const usage = claudeData.usage || {};

    // Insere mensagem IA
    await adminClient.from("originacao_chat_mensagens").insert({
      originacao_id: origRow.id,
      papel: "ia",
      conteudo: respostaIA,
      tokens_in: usage.input_tokens || null,
      tokens_out: usage.output_tokens || null,
      duracao_ms: duracao,
    });

    return resp(200, {
      ok: true,
      originacao_id: origRow.id,
      fase_atual: "tese",
      mensagem_ia: respostaIA,
      tokens_in: usage.input_tokens || 0,
      tokens_out: usage.output_tokens || 0,
      duracao_ms: duracao,
    });
  } catch (e: any) {
    return resp(500, { ok: false, erro: "exception", detalhe: e.message });
  }
});
