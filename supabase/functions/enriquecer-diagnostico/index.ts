import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CAT_LABELS: Record<string,string> = {
  alimentacao: 'Alimentação e Food Service',
  tecnologia: 'Tecnologia e SaaS',
  beleza_saude: 'Beleza e Saúde',
  varejo: 'Varejo e Comércio',
  educacao: 'Educação',
  industria: 'Indústria',
  servicos: 'Serviços B2B',
  saude: 'Saúde e Clínicas',
  pet: 'Pet',
  hospedagem: 'Hospedagem e Turismo',
  comercio: 'Comércio',
  distribuicao: 'Distribuição',
  outro: 'Outros',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

    const body = await req.json();
    // detalhe é o sinal PRIMÁRIO — o que o dono escreveu com suas próprias palavras
    const { categoria, cidade, estado, faturamento_mensal, resultado_mensal, score_ise, anos_operacao, subcategoria, detalhe, descricao_ia } = body;

    if (!categoria) throw new Error('categoria obrigatória');

    const catLabel = CAT_LABELS[categoria] ?? categoria;
    const fat = faturamento_mensal ? `R$ ${Math.round(faturamento_mensal).toLocaleString('pt-BR')}/mês` : 'não informado';
    const res = resultado_mensal ? `R$ ${Math.round(resultado_mensal).toLocaleString('pt-BR')}/mês` : 'não informado';
    const localStr = cidade && estado ? `${cidade}, ${estado}` : (estado ?? 'Brasil');
    const anosStr = anos_operacao ? `${anos_operacao} anos` : 'não informado';
    
    // Usar descricao_ia (já validada pelo usuário) ou detalhe como descrição
    const descricaoNegocio = descricao_ia || detalhe || '';
    const temDescricao = descricaoNegocio.trim().length > 5;

    const prompt = `Você é um analista de M&A especializado em pequenas e médias empresas brasileiras (PMEs). A 1Negócio conecta empreendedores que querem vender seus negócios com compradores qualificados — que são principalmente: outros empreendedores, profissionais liberais querendo montar um negócio próprio, pequenos grupos de investidores locais, ou empresas do próprio setor querendo expandir regionalmente.

Perfil do negócio analisado:
${temDescricao ? `- O que o dono descreveu (USE ISSO COMO REFERÊNCIA PRINCIPAL): "${descricaoNegocio}"
` : ''}- Setor de referência: ${catLabel}${subcategoria ? ` — ${subcategoria}` : ''}
- Localização: ${localStr}
- Faturamento: ${fat}
- Resultado operacional: ${res}
- Tempo de operação: ${anosStr}
- ISE (solidez): ${score_ise ?? 'sendo calculado'}/100

${temDescricao ? `IMPORTANTE: O contexto de mercado, localização e perfil do comprador deve ser ancorado no que o dono descreveu ("${descricaoNegocio}"), não apenas no setor genérico. Se o dono descreveu um studio de gravações, o contexto deve ser sobre estúdios de gravação, não sobre tecnologia em geral.` : ''}

Retorne APENAS um JSON válido (sem markdown, sem backticks) com esta estrutura:
{
  "setor": {
    "tendencia": "2-3 frases sobre tendências do mercado para ESTE NEGÓCIO ESPECÍFICO no Brasil em 2025-2026, baseado no que o dono descreveu",
    "crescimento_anual": "estimativa realista de crescimento, ex: 6-9% ao ano",
    "drivers_demanda": ["fator que valoriza este tipo de negócio especificamente", "outro fator", "outro fator"]
  },
  "localizacao": {
    "contexto": "2-3 frases sobre o mercado local em ${localStr} para este negócio específico — demanda, perfil do consumidor, densidade de concorrência",
    "vantagens_locais": ["vantagem específica da região para este negócio", "outra vantagem"]
  },
  "momento_mercado": {
    "oportunidade": "1-2 frases sobre por que é bom momento para M&A neste negócio — baseado em dados reais do mercado brasileiro",
    "perfil_comprador": "2-3 frases descrevendo quem realisticamente vai querer comprar ESTE negócio específico. Seja realista para o porte PME."
  },
  "headline": "Uma frase de até 15 palavras que mostra o potencial deste negócio para o comprador certo"
}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error('Anthropic API erro: ' + err.slice(0, 200));
    }

    const data = await resp.json();
    const text = data.content?.[0]?.text ?? '{}';

    let contexto: Record<string, unknown>;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      contexto = JSON.parse(clean);
    } catch {
      throw new Error('JSON inválido: ' + text.slice(0, 300));
    }

    return new Response(JSON.stringify({ ok: true, contexto }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Erro enriquecer-diagnostico:', msg);
    return new Response(JSON.stringify({ ok: false, erro: msg }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
