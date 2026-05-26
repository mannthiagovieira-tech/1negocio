import { createClient } from 'jsr:@supabase/supabase-js@2';

// v9.22 · Z-API com header 'Client-Token' (CamelCase, conforme docs Z-API)
// + try/catch explícito no branch novo_diagnostico
const ZAPI_INSTANCE   = Deno.env.get('ZAPI_INSTANCE') ?? '';
const ZAPI_TOKEN      = Deno.env.get('ZAPI_TOKEN') ?? '';
const ZAPI_CLIENT     = Deno.env.get('ZAPI_CLIENT_TOKEN') ?? '';
const THIAGO_PHONE    = '5548999279320';
const BASE_URL        = 'https://1negocio.com.br';

// Aviso de boot · faz ruído no log se faltar alguma env (em vez de só na primeira request)
if (!ZAPI_INSTANCE) console.error('[notificar-diagnostico][boot] ZAPI_INSTANCE ausente');
if (!ZAPI_TOKEN)    console.error('[notificar-diagnostico][boot] ZAPI_TOKEN ausente');
if (!ZAPI_CLIENT)   console.error('[notificar-diagnostico][boot] ZAPI_CLIENT_TOKEN ausente · Z-API vai rejeitar');

const MOTIVACAO_MAP: Record<string, string> = {
  curiosidade:  'Curiosidade',
  vender:       'Quer vender',
  sucessao:     'Sucessão',
  captar_socio: 'Captar sócio',
  planejamento: 'Planejamento',
  socio:        'Busca sócio',
  outro:        'Outro',
};

async function zapiSend(phone: string, message: string) {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) {
    console.error('[notificar-diagnostico] envs Z-API ausentes:', {
      tem_instance: !!ZAPI_INSTANCE,
      tem_token: !!ZAPI_TOKEN,
      tem_client: !!ZAPI_CLIENT,
    });
    throw new Error('envs Z-API ausentes (ZAPI_INSTANCE / ZAPI_TOKEN / ZAPI_CLIENT_TOKEN)');
  }
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': ZAPI_CLIENT, // CamelCase conforme docs Z-API (alinhado com hermes-webhook)
    },
    body: JSON.stringify({ phone, message }),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error(`[notificar-diagnostico][zapiSend] FALHA HTTP ${r.status} · phone=${phone} · resposta='${txt.slice(0, 300)}'`);
    throw new Error(`Z-API ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  // Z-API às vezes retorna 200 mas com erro no body — checa estrutura típica
  if (data?.error || data?.value === false) {
    console.error(`[notificar-diagnostico][zapiSend] 200 mas com erro no body · phone=${phone} · body=${JSON.stringify(data).slice(0, 300)}`);
    throw new Error(`Z-API body indica erro: ${JSON.stringify(data).slice(0, 200)}`);
  }
  console.log(`[notificar-diagnostico][zapiSend] OK · phone=${phone} · msgId=${data?.messageId || data?.id || '?'}`);
  return data;
}

function brl(v: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v || 0);
}

function formatarWpp(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('55')) return digits;
  return '55' + digits;
}

Deno.serve(async (req: Request) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const body = await req.json();
    const { negocio_id, codigo_diagnostico, tipo } = body;
    const tipoFinal = tipo || 'novo_diagnostico';

    if (!negocio_id && !codigo_diagnostico) {
      return new Response(JSON.stringify({ ok: false, error: 'negocio_id ou codigo_diagnostico obrigatório' }), { headers: cors });
    }

    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Buscar negócio
    let query = db.from('negocios').select('*');
    if (negocio_id) query = query.eq('id', negocio_id);
    else query = query.eq('codigo_diagnostico', codigo_diagnostico);

    const { data: negs } = await query.single();
    if (!negs) {
      return new Response(JSON.stringify({ ok: false, error: 'negócio não encontrado' }), { headers: cors });
    }

    const n = negs;
    const d = n.dados_json || {};

    const nome        = d.nome_negocio || n.nome || 'Sem nome';
    const setor       = d.setor || '—';
    const local       = [d.cidade, d.estado].filter(Boolean).join('/');
    const nomeContato = d.nome_contato || '—';
    const whatsappRaw = d.whatsapp || '';
    const motivacao   = MOTIVACAO_MAP[d.motivacao] || d.motivacao || '—';
    const fatMensal   = d.fat_mensal || 0;
    const fatAnual    = d.fat_anual || 0;
    const roMensal    = d.ro_mensal || d.resultado_op || 0;
    const ise         = d.ise_parcial || '—';
    const expectativa = d.expectativa_val || 0;
    const dependencia = d.dependencia || '—';
    const codigo      = n.codigo_diagnostico || '—';
    const negId       = n.id;

    const wppFormatado = formatarWpp(whatsappRaw);
    const wppClicavel  = wppFormatado.length >= 12 ? `https://wa.me/${wppFormatado}` : whatsappRaw || '—';

    const agora = new Date();
    const dataHora = agora.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });

    // ════════════════════════════════════════════════════════════
    // BRANCH · tipo='ro_negativo' · alerta consultor antes do laudo
    // ════════════════════════════════════════════════════════════
    if (tipoFinal === 'ro_negativo') {
      // Anti-dup · só envia se ainda não foi
      if (n.alerta_consultor_enviado_em) {
        console.log('[ro_negativo] já enviado em', n.alerta_consultor_enviado_em, '· skip');
        return new Response(JSON.stringify({ ok: true, skipped: true, motivo: 'já enviado', enviado_em: n.alerta_consultor_enviado_em }), { headers: cors });
      }

      const margemPct = (fatMensal > 0) ? ((roMensal / fatMensal) * 100).toFixed(1) + '%' : '—';

      const msg = `🚨 *Diagnóstico com sinal de alerta · RO negativo*\n\n` +
        `*${nome}*\n` +
        `${setor} · ${local}\n\n` +
        `💰 Faturamento: ${brl(fatMensal)}/mês · ${brl(fatAnual)}/ano\n` +
        `📉 Resultado: ${brl(roMensal)}/mês (${margemPct})\n` +
        `📈 ISE: ${ise}/100\n` +
        (expectativa > 0 ? `🎯 Expectativa: ${brl(expectativa)}\n` : '') +
        `\n👤 *${nomeContato}*\n` +
        `📱 ${wppClicavel}\n\n` +
        `Cliente recebeu sugestão de falar com consultor antes do laudo ser gerado.\n\n` +
        `🔒 Painel:\n${BASE_URL}/painel-v3.html#aprovacoes\n\n` +
        `🕐 ${dataHora}`;

      try {
        await zapiSend(THIAGO_PHONE, msg);
      } catch (zErr) {
        console.error('[ro_negativo] Z-API falhou · NÃO marca alerta_consultor_enviado_em:', zErr);
        return new Response(JSON.stringify({ ok: false, error: 'envio Z-API falhou', detalhe: String(zErr) }), { status: 502, headers: cors });
      }

      // Sucesso · marca dedup
      await db.from('negocios').update({ alerta_consultor_enviado_em: new Date().toISOString() }).eq('id', negId);
      console.log('[ro_negativo] alerta enviado · negócio:', nome, '· id:', negId);

      return new Response(JSON.stringify({ ok: true, tipo: 'ro_negativo', nome, negocio_id: negId }), { headers: cors });
    }

    // ════════════════════════════════════════════════════════════
    // BRANCH · tipo='novo_diagnostico' (padrão · fluxo legado)
    // ════════════════════════════════════════════════════════════
    let recomendacao = '📞 Ligar — entender momento';
    if (d.motivacao === 'vender' && fatMensal >= 50000) {
      recomendacao = '🟢 Ligar e oferecer Guiado — perfil quente';
    } else if (d.motivacao === 'vender') {
      recomendacao = '📞 Ligar — quer vender, avaliar perfil';
    } else if (d.motivacao === 'curiosidade') {
      recomendacao = '💬 WhatsApp — nutrir, não pressionar';
    } else if (d.motivacao === 'captar_socio' || d.motivacao === 'socio') {
      recomendacao = '💬 Apresentar 1Sócio — potencial advisory';
    }

    const mensagem = `🚀 *NOVO DIAGNÓSTICO*\n\n` +
      `*${nome}*\n` +
      `${setor} · ${local}\n\n` +
      `💰 Fat: ${brl(fatMensal)}/mês · ${brl(fatAnual)}/ano\n` +
      `📊 RO: ${brl(roMensal)}/mês\n` +
      `📈 ISE: ${ise}/100\n` +
      `🎯 Expectativa: ${expectativa > 0 ? brl(expectativa) : '—'}\n` +
      `👤 Dependência: ${dependencia}\n` +
      `📋 Motivação: ${motivacao}\n\n` +
      `👤 *${nomeContato}*\n` +
      `📱 ${wppClicavel}\n\n` +
      `→ ${recomendacao}\n\n` +
      `🕐 ${dataHora}\n\n` +
      `📄 Laudo gratuito:\n${BASE_URL}/laudo-completo.html?id=${negId}\n\n` +
      `📄 Laudo pago:\n${BASE_URL}/laudo-pago.html?id=${negId}\n\n` +
      `🔒 Laudo admin:\n${BASE_URL}/laudo-admin.html?id=${negId}`;

    try {
      await zapiSend(THIAGO_PHONE, mensagem);
      console.log('[notificar-diagnostico][novo_diagnostico] enviado:', nome, brl(fatMensal));
    } catch (zErr) {
      console.error('[notificar-diagnostico][novo_diagnostico] Z-API falhou · negócio:', nome, '· id:', negId, '· detalhe:', String(zErr));
      return new Response(
        JSON.stringify({ ok: false, error: 'envio Z-API falhou', detalhe: String(zErr), negocio_id: negId, nome }),
        { status: 502, headers: cors },
      );
    }

    return new Response(JSON.stringify({ ok: true, nome, fat: brl(fatMensal) }), { headers: cors });

  } catch (e) {
    console.error('[notificar-diagnostico] Erro:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
