import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1500;

// Cache de parâmetros (5 min)
let _paramsCache: any = null;
let _paramsCacheTs = 0;
const PARAMS_TTL_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = `# Você é o assistente virtual oficial da 1Negócio

## SOBRE A 1NEGÓCIO

Somos uma central brasileira de avaliação, compra e venda de negócios. Não publicamos negócios — publicamos diagnósticos. Cada anúncio na plataforma tem laudo técnico por trás, calculado pela nossa metodologia.

Nascemos pra resolver o problema do dono de PME que quer vender mas não sabe quanto vale. E pra resolver o problema do investidor que quer comprar mas não sabe o que vale a pena.

## TOM E ESTILO

Humano, caloroso, direto. Você é consultivo — não vendedor, não robô.
Atencioso. Deixa a pessoa falar sobre o negócio dela. Uma pergunta de cada vez.
Respostas curtas: 2 a 4 frases por mensagem. Texto corrido, natural.
Sem listas, sem bullets, sem headers.
Sem emojis (a não ser que a pessoa use primeiro).
Nunca use: "Claro!", "Com certeza!", "Fico feliz em ajudar", "Ótima pergunta".

## TOM POSITIVO — REGRA CRÍTICA

Sempre mantenha tom positivo, mesmo diante do negócio mais difícil.
Não bajule — seja genuíno. Se o negócio tem problema, diga que faz parte e que vamos em frente com os aprendizados.
Eleve o moral da pessoa. Nunca diminua o negócio dela, nunca seja pessimista.

## OBJETIVO PRINCIPAL

Você tem dois objetivos principais:

1. **Capturar lead validado** (nome + WhatsApp) de quem é dono ou tem interesse em PME.
2. **Entregar uma estimativa de valor** do negócio da pessoa, em troca dos dados.

A pessoa só recebe a estimativa de valor depois que:
(a) você tiver os 7 dados que precisam ser coletados (listados abaixo)
(b) ela tiver confirmado nome e WhatsApp (se ainda não estiver logada)

A estimativa que você entrega é uma FAIXA (-30% a +30% do valor calculado), porque é baseada em poucas perguntas. Você sempre destaca que o diagnóstico completo da plataforma fecha o número exato.

## FLUXO DE CONVERSA — 7 DADOS NECESSÁRIOS

Você precisa coletar 7 dados pra fazer a estimativa. **Não pergunte tudo de uma vez como formulário.** Conduza como conversa — uma coisa puxa a outra. Pode desviar, perguntar mais sobre o negócio, comentar algo interessante. Mas só revela o valor depois que tiver os 7.

Os 7 dados são:

1. **nome_negocio** — nome do negócio (não exibido publicamente, só pra registro)
2. **cidade_uf** — cidade e estado (registro)
3. **setor_code** — setor de atuação. Você infere pelo nome ou pela conversa, e CONFIRMA com a pessoa antes de seguir. Setores possíveis (use o code exato):
   - alimentacao (restaurante, padaria, lanchonete, food truck, doceria, pizzaria, açougue)
   - varejo (loja, comércio, mercado, papelaria, magazine)
   - saude (clínica, consultório, dentista, fisioterapeuta, laboratório)
   - bem_estar (academia, spa, salão de beleza, estética, pilates)
   - educacao (escola, curso, treinamento, ensino)
   - servicos_locais (serviços B2C, manutenção, reparo, conserto)
   - servicos_empresas (serviços B2B, consultoria, agência, software, SaaS, tecnologia)
   - industria (fábrica, manufatura, produção)
   - logistica (transporte, entrega, distribuição, armazenagem)
   - construcao (construção civil, reforma, obras)
   - hospedagem (hotel, pousada, airbnb, hospedaria)
   - beleza_estetica (estética avançada, harmonização, procedimentos)

   Quando confirmar setor, mostre 3-4 opções mais prováveis: "Pelo nome imagino que seja [setor X]. Tô certo? Se não, é mais [opção Y] ou [opção Z]?"

4. **forma_atuacao** — como o negócio fatura. Possíveis:
   - presencial_local (loja física, ponto comercial)
   - delivery (entrega)
   - online (e-commerce, digital)
   - assinatura (recorrência mensal/anual)
   - hibrido (mistura)
   - servico_local (atende cliente final na região)
   - b2b (vende pra outras empresas)

5. **faturamento_anual** — quanto o negócio fatura. Pergunte: "quanto o negócio faturou nos últimos 12 meses, ou se preferir, quanto fatura por mês?". Se a pessoa der valor mensal, multiplique por 12 internamente. Sempre confirme: "esse valor é mensal ou anual?".

6. **sobra_anual** — lucro líquido aproximado. Pergunte: "depois de pagar TODAS as despesas — fornecedores, salários, impostos, aluguel — quanto sobra por mês ou por ano? Pode desconsiderar pró-labore do dono e parcelas de empréstimos/financiamentos." Mesma confirmação mensal/anual.

7. **ativos_relevantes** — equipamentos, máquinas, veículos próprios. Pergunte: "o negócio tem equipamentos, máquinas, ou veículos próprios de valor? Tipo carro, moto, equipamento industrial. Se sim, qual o valor aproximado de tudo somado?". NÃO PERGUNTE sobre caixa, contas a receber, estoque — só itens duráveis.

8. **dividas_total** — passivos. Pergunte: "tem alguma dívida? Empréstimo, financiamento, imposto atrasado, parcelamento? Qual o saldo devedor total aproximado?".

## REGRA CRÍTICA — CAPTURA DE NOME E WHATSAPP

Antes de revelar a estimativa de valor:

- Se a pessoa NÃO ESTÁ LOGADA (você vai receber essa info no contexto), você precisa ter coletado:
  - Nome dela (primeiro nome basta)
  - WhatsApp dela (com DDD)

  Capture naturalmente. Não force no início — deixa a conversa fluir, e quando ela já estiver engajada (uns 4-5 turnos de conversa, geralmente quando ela menciona o setor ou faturamento), peça: "Pra eu te entregar a estimativa e também o link do diagnóstico completo, qual seu nome e WhatsApp?".

  Aceite formato livre ("11 99999-9999", "+55 11 99999 9999", "11999999999"). Se não conseguir extrair número válido, peça: "Hmm, não consegui ler esse número. Pode digitar com DDD? Tipo 11 99999-9999".

- Se a pessoa ESTÁ LOGADA, o sistema já tem nome e telefone. Você vai receber isso no contexto. NÃO pergunte de novo. Use o nome dela diretamente.

## QUANDO TIVER OS 7 DADOS + LEAD VALIDADO — CHAME A FERRAMENTA

Quando você tiver coletado os 7 dados E a pessoa for lead válido (nome+telefone capturados, OU usuário logado), CHAME a ferramenta calcular_valuation_rapido com os dados.

A ferramenta retorna:
- valor_central
- valor_min (-30%)
- valor_max (+30%)
- multiplo_aplicado
- floor_aplicado (boolean — se foi precisaram desconsiderar dívidas porque PL ia muito negativo)

Após receber o resultado, você apresenta pra pessoa em formato natural. Exemplo:

"[Nome], com os dados que você me passou, minha estimativa rápida aponta que seu negócio está numa faixa de R$ X até R$ Y. O valor central é em torno de R$ Z, mas como é estimativa baseada em poucos dados, sempre trabalhamos com essa margem de 30% pra mais ou pra menos.

Pra fechar o número exato, com 8 pilares de análise e parecer técnico, faz o diagnóstico completo no site — é grátis e leva 5 minutos: https://www.1negocio.com.br/diagnostico

Se quiser, posso te mandar o link no WhatsApp também."

Se floor_aplicado for true: adicione "Importante: pelo que você me contou de dívidas, o cálculo considerou só a operação. As dívidas precisam ser revisadas no diagnóstico completo pra entender impacto real no valor de venda."

## REGRAS ABSOLUTAS — NUNCA FAÇA

1. NUNCA mencionar BuyCo, MeuBiz, Thiago, 1007 ou outros projetos
2. NUNCA usar EBITDA, DCF, WACC ou jargão financeiro técnico em inglês
3. NUNCA inventar resposta — se não souber, admite e oferece WhatsApp humano
4. NUNCA dar conselho jurídico ou fiscal definitivo
5. NUNCA expor dados de outros clientes
6. NUNCA prometer resultado de venda (tempo ou valor)
7. NUNCA revelar a fórmula interna ou os múltiplos por setor
8. NUNCA chamar calcular_valuation_rapido sem ter os 7 dados completos
9. NUNCA chamar calcular_valuation_rapido sem ter nome+telefone (a menos que usuário esteja logado)
10. NUNCA dizer 15 minutos — sempre 5 a 10 minutos pro diagnóstico
11. NUNCA usar a palavra "faixa" exceto quando estiver apresentando o resultado da estimativa rápida (é o único caso onde "faixa" é permitido)

WhatsApp humano fallback: https://wa.me/5511952136406
Link diagnóstico completo: https://www.1negocio.com.br/diagnostico
Link laudo R$99: https://www.1negocio.com.br/laudo-completo.html?demo=true
`;

// Tool definition pro Claude Sonnet
const TOOLS = [{
  name: 'calcular_valuation_rapido',
  description: 'Calcula a estimativa rápida de valuation do negócio. SÓ chame quando tiver os 7 dados completos E o lead estiver validado (nome+telefone OU usuário logado).',
  input_schema: {
    type: 'object',
    properties: {
      nome_negocio: { type: 'string', description: 'Nome do negócio (não exibido publicamente)' },
      cidade_uf: { type: 'string', description: 'Cidade e estado (ex: "Florianópolis/SC")' },
      setor_code: {
        type: 'string',
        enum: ['alimentacao', 'varejo', 'saude', 'bem_estar', 'educacao',
               'servicos_locais', 'servicos_empresas', 'industria', 'logistica',
               'construcao', 'hospedagem', 'beleza_estetica'],
        description: 'Código do setor (use os códigos da lista do system prompt)'
      },
      forma_atuacao: { type: 'string', description: 'Forma de atuação' },
      faturamento_anual: { type: 'number', description: 'Faturamento anual em reais (já convertido se a pessoa deu mensal)' },
      sobra_anual: { type: 'number', description: 'Sobra/lucro líquido anual em reais (já convertido se mensal)' },
      ativos_relevantes: { type: 'number', description: 'Soma de equipamentos+veículos+máquinas. 0 se não tiver.' },
      dividas_total: { type: 'number', description: 'Total de dívidas. 0 se não tiver.' }
    },
    required: ['nome_negocio', 'cidade_uf', 'setor_code', 'forma_atuacao',
               'faturamento_anual', 'sobra_anual', 'ativos_relevantes', 'dividas_total']
  }
}];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      }
    });
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!ANTHROPIC_KEY) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  try {
    const body = await req.json();
    const { messages, action, lead_data, pagina_origem, lead_id, jwt } = body;

    // Ações administrativas (compat com frontend atual)
    if (action === 'save_lead') {
      return await saveLead(lead_data, messages, pagina_origem, req, lead_id, jwt);
    }
    if (action === 'escalate') {
      return await escalateLead(lead_data, messages, pagina_origem, req);
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: 'messages array é obrigatório' }, 400);
    }

    // Detectar usuário logado via JWT
    let usuarioLogado: any = null;
    if (jwt) {
      usuarioLogado = await detectarUsuarioLogado(jwt);
    }

    // Adiciona contexto de usuário logado no system prompt dinamicamente
    let systemFinal = SYSTEM_PROMPT;
    if (usuarioLogado) {
      systemFinal += `\n\n## CONTEXTO DESTA CONVERSA — USUÁRIO LOGADO\n\n` +
        `O usuário desta conversa JÁ ESTÁ CADASTRADO. Não pergunte nome nem WhatsApp.\n` +
        `Nome: ${usuarioLogado.nome}\n` +
        `WhatsApp: ${usuarioLogado.telefone}\n` +
        `Use o nome diretamente. Pode chamar a ferramenta calcular_valuation_rapido assim que tiver os 7 dados (não precisa pedir contato).`;
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemFinal,
        tools: TOOLS,
        messages: messages,
      }),
    });

    const rawText = await anthropicRes.text();

    if (!anthropicRes.ok) {
      let errMsg = rawText;
      try {
        const errJson = JSON.parse(rawText);
        errMsg = errJson?.error?.message || rawText;
      } catch (_) {}
      return jsonResponse({ error: errMsg, status: anthropicRes.status }, anthropicRes.status);
    }

    const data = JSON.parse(rawText);

    // Detecta se Claude chamou a ferramenta
    const toolUseBlock = data.content?.find((c: any) => c.type === 'tool_use' && c.name === 'calcular_valuation_rapido');

    if (toolUseBlock) {
      // Executa a ferramenta no servidor
      const dadosColetados = toolUseBlock.input;
      const valuation = await calcularValuationRapido(dadosColetados);

      // Salva no banco com avaliação completa
      await persistirAvaliacao(lead_id, dadosColetados, valuation, messages, pagina_origem, usuarioLogado);

      // Retorna ao Claude o resultado da ferramenta pra ele formular a resposta
      const messagesComTool = [
        ...messages,
        { role: 'assistant', content: data.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: JSON.stringify(valuation)
          }]
        }
      ];

      const segundoCall = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemFinal,
          tools: TOOLS,
          messages: messagesComTool,
        }),
      });

      const segundoData = await segundoCall.json();
      const finalReply = segundoData.content?.find((c: any) => c.type === 'text')?.text || '';

      return jsonResponse({
        reply: finalReply,
        usage: segundoData.usage,
        valuation: valuation,
        tool_called: true
      });
    }

    // Resposta normal sem tool
    const reply = data.content?.find((c: any) => c.type === 'text')?.text || '';
    return jsonResponse({ reply, usage: data.usage, tool_called: false });

  } catch (e) {
    console.error('Erro no chat-ia:', e);
    return jsonResponse({ error: String(e) }, 500);
  }
});

// =====================================================
// FUNÇÃO DE CÁLCULO — fórmula encurtada
// Lê múltiplos de parametros_versoes (mesma fonte da skill v2)
// =====================================================

async function calcularValuationRapido(d: any) {
  const params = await getParametros();
  const setor = d.setor_code || 'alimentacao';

  // Múltiplo do setor (mesmo que a skill v2 usa)
  const multipliosSetor = params?.multiplos_setor || {};
  let multiplo = Number(multipliosSetor[setor]) || 1.5;

  // Ajuste por forma de atuação (simplificado, conservador)
  const ajustes_forma: Record<string, number> = {
    presencial_local: 0,
    delivery: 0.1,
    online: 0.3,
    assinatura: 0.4,
    hibrido: 0.15,
    servico_local: 0,
    b2b: 0.2,
  };
  multiplo += ajustes_forma[d.forma_atuacao] || 0;

  // Floor de múltiplo
  if (multiplo < 0.5) multiplo = 0.5;

  // Cálculo principal
  const sobra = Number(d.sobra_anual) || 0;
  const ativos = Number(d.ativos_relevantes) || 0;
  const dividas = Number(d.dividas_total) || 0;

  const valor_operacional = sobra * multiplo;
  let valor_central = valor_operacional + ativos - dividas;
  let floor_aplicado = false;

  // Floor: se a fórmula com dívidas der negativo ou < 50% do valor operacional puro,
  // retorna só valor_operacional + ativos com aviso
  if (valor_central < (valor_operacional * 0.5) || valor_central < 0) {
    valor_central = valor_operacional + ativos;
    floor_aplicado = true;
  }

  // Garantia adicional: nunca negativo
  if (valor_central < 0) valor_central = 0;

  const valor_min = Math.round(valor_central * 0.7);
  const valor_max = Math.round(valor_central * 1.3);
  valor_central = Math.round(valor_central);

  return {
    valor_central,
    valor_min,
    valor_max,
    multiplo_aplicado: Number(multiplo.toFixed(3)),
    floor_aplicado,
    parametros_versao_id: params?._versao_id || null,
  };
}

async function getParametros() {
  const agora = Date.now();
  if (_paramsCache && (agora - _paramsCacheTs) < PARAMS_TTL_MS) return _paramsCache;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/parametros_versoes?ativo=eq.true&select=id,snapshot`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        }
      }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      _paramsCache = { ...data[0].snapshot, _versao_id: data[0].id };
      _paramsCacheTs = agora;
    }
    return _paramsCache;
  } catch (e) {
    console.error('Erro carregar parametros_versoes:', e);
    return null;
  }
}

async function detectarUsuarioLogado(jwt: string): Promise<any> {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, telefone, whatsapp')
      .eq('id', user.id)
      .single();

    return usuario;
  } catch (e) {
    console.error('Erro detectar usuário logado:', e);
    return null;
  }
}

async function persistirAvaliacao(leadId: string | undefined, dados: any, valuation: any, messages: any[], paginaOrigem: string | undefined, usuarioLogado: any) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const payload: any = {
    dados_coletados: dados,
    valuation_central: valuation.valor_central,
    valuation_min: valuation.valor_min,
    valuation_max: valuation.valor_max,
    multiplo_aplicado: valuation.multiplo_aplicado,
    floor_aplicado: valuation.floor_aplicado,
    parametros_versao_id: valuation.parametros_versao_id,
    setor_code: dados.setor_code,
    setor_mencionado: dados.setor_code,
    cidade_estado: dados.cidade_uf,
    faixa_faturamento: String(dados.faturamento_anual),
    mensagens: messages,
    pagina_origem: paginaOrigem || null,
    usuario_id: usuarioLogado?.id || null,
  };

  if (usuarioLogado) {
    payload.nome = usuarioLogado.nome;
    payload.whatsapp = usuarioLogado.whatsapp || usuarioLogado.telefone;
    payload.perfil = 'logado';
  }

  if (leadId) {
    await supabase.from('chat_ia_leads').update(payload).eq('id', leadId);
  } else {
    await supabase.from('chat_ia_leads').insert(payload);
  }
}

async function saveLead(leadData: any, messages: any[], paginaOrigem: string | undefined, req: Request, leadId: string | undefined, jwt: string | undefined) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let usuarioId = null;
  if (jwt) {
    const u = await detectarUsuarioLogado(jwt);
    if (u) usuarioId = u.id;
  }

  const whatsappLimpo = leadData?.whatsapp ? String(leadData.whatsapp).replace(/\D/g, '') : null;
  const whatsappFormatado = whatsappLimpo
    ? (whatsappLimpo.startsWith('55') ? `+${whatsappLimpo}` : `+55${whatsappLimpo}`)
    : null;

  const userAgent = req.headers.get('user-agent') || '';
  const ip = req.headers.get('x-forwarded-for') || '';
  const ipHash = ip ? await hashString(ip) : null;

  const resumo = (messages || []).slice(-4)
    .map((m: any) => `${m.role === 'user' ? 'U' : 'A'}: ${typeof m.content === 'string' ? m.content.slice(0, 150) : '[tool]'}`)
    .join(' | ');

  const payload: any = {
    nome: leadData?.nome ? String(leadData.nome).trim() : null,
    whatsapp: whatsappFormatado,
    email: leadData?.email ? String(leadData.email).trim() : null,
    perfil: leadData?.perfil || 'curioso',
    sub_perfil: leadData?.sub_perfil || null,
    mensagens: messages || [],
    resumo_conversa: resumo,
    pagina_origem: paginaOrigem || null,
    user_agent: userAgent,
    ip_hash: ipHash,
    setor_mencionado: leadData?.setor_mencionado || null,
    faixa_faturamento: leadData?.faixa_faturamento || null,
    cidade_estado: leadData?.cidade_estado || null,
    escalacao_pendente: leadData?.escalacao === true,
    escalacao_motivo: leadData?.motivo || null,
    usuario_id: usuarioId,
  };

  if (leadId) {
    const { data, error } = await supabase.from('chat_ia_leads').update(payload).eq('id', leadId).select().single();
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ success: true, lead_id: data.id });
  } else {
    const { data, error } = await supabase.from('chat_ia_leads').insert(payload).select().single();
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ success: true, lead_id: data.id });
  }
}

async function escalateLead(leadData: any, messages: any[], paginaOrigem: string | undefined, req: Request) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (leadData?.lead_id) {
    const { error } = await supabase
      .from('chat_ia_leads')
      .update({
        escalacao_pendente: true,
        escalacao_motivo: leadData.motivo || 'solicitacao_usuario',
        mensagens: messages,
      })
      .eq('id', leadData.lead_id);

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ success: true });
  }

  return await saveLead({ ...leadData, escalacao: true }, messages, paginaOrigem, req, undefined, undefined);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

async function hashString(str: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
