import { createClient } from 'jsr:@supabase/supabase-js@2';

const ZAPI_INSTANCE   = '3F0B96941C16821DCD449E74568994AE';
const ZAPI_TOKEN      = '0BE4998D03035703BC118D92';
const ZAPI_CLIENT     = 'F547b97b8e03b4e45a4ac018295d569c1S';
const THIAGO_PHONE    = '5548999279320';
const BASE_URL        = 'https://1negocio.com.br';

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
  const r = await fetch(
    `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT },
      body: JSON.stringify({ phone, message }),
    }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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

    await zapiSend(THIAGO_PHONE, mensagem);
    console.log('[notificar-diagnostico] enviado:', nome, brl(fatMensal));

    return new Response(JSON.stringify({ ok: true, nome, fat: brl(fatMensal) }), { headers: cors });

  } catch (e) {
    console.error('[notificar-diagnostico] Erro:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
