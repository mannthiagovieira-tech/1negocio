// @ts-check
// Slice 4.6 · Modo manual · E2E mínimo (3 asserções).
// 1. Fixo verified=false que passa no portão vai pra sem_contato (pool LIGAR).
// 2. Tick com config modo='manual' devolve skipped='modo_manual' sem enviar.
// 3. POST /api/va-lead-contato-manual grava linha em va_leads_log.

const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
const PREFIXO = 'E2E46·';
const PROJ_ID = 'b676073a-6074-48d4-a608-7947de006dff'; // Arte Deli

test.beforeAll(() => {
  if (!EMAIL || !PASS) throw new Error('E2E_EMAIL/E2E_PASS obrigatórios');
});

async function loginToken() {
  const ctx = await pwrequest.newContext();
  const r = await ctx.post(`${SB_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SB_ANON, 'Content-Type':'application/json' },
    data: { email: EMAIL, password: PASS },
  });
  const d = await r.json();
  await ctx.dispose();
  return d.access_token;
}
async function api(tok) {
  return pwrequest.newContext({
    extraHTTPHeaders: {
      apikey: SB_ANON, Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
  });
}
async function limpar(tok) {
  const ctx = await api(tok);
  await ctx.delete(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.dispose();
}

test.describe('Slice 4.6 · modo manual + pool LIGAR', () => {

  test('1 · portão · fixo verified=false vai pra sem_contato (pool LIGAR)', async () => {
    const tok = await loginToken();
    await limpar(tok);
    const ctx = await api(tok);
    const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id`);
    const [arq] = await rA.json();
    test.skip(!arq, 'sem arquétipo aprovado');
    // Cria antessala com telefone MAS whatsapp_verificado=false
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_leads`, {
      data: { projeto_id: PROJ_ID, origem:'manual', arquetipo_id: arq.id,
              razao_social:`${PREFIXO}FixoSemWA`, cnpj:'20.046.001/0001-01',
              telefone:'551130000000', whatsapp_verificado: false },
    });
    const [lead] = await rIns.json();
    const rPort = await ctx.post('https://www.1negocio.com.br/api/va-portao-leads', {
      headers: { Authorization: `Bearer ${tok}` },
      data: { projeto_id: PROJ_ID, lead_ids:[lead.id] },
    });
    expect(rPort.ok(), 'portão HTTP').toBeTruthy();
    const rC = await ctx.get(`${SB_URL}/rest/v1/va_leads?id=eq.${lead.id}&select=funil_etapa,status,telefone,whatsapp_verificado`);
    const [after] = await rC.json();
    expect(after.status).toBe('aprovado');
    expect(after.funil_etapa).toBe('sem_contato');   // pool LIGAR
    expect(after.telefone).toBeTruthy();
    await ctx.dispose();
    await limpar(tok);
  });

  test('2 · tick em modo=manual devolve skipped=modo_manual (não envia)', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    // Garante config manual do Arte Deli
    await ctx.post(`${SB_URL}/rest/v1/va_cadencia_config`, {
      data: { projeto_id: PROJ_ID, ativa: true, modo: 'manual',
              teto_diario: 4, janela_inicio:'00:00', janela_fim:'23:59',
              dias_uteis_apenas: false, intervalo_toques_dias: 2 },
      headers: { Prefer: 'resolution=merge-duplicates' },
    });
    const rT = await ctx.post('https://www.1negocio.com.br/api/va-cadencia-tick', {
      headers: { Authorization: `Bearer ${tok}` },
      data: { projeto_id: PROJ_ID },
    });
    const d = await rT.json();
    expect(d.ok).toBe(true);
    const p = (d.projetos || []).find(x => x.projeto_id === PROJ_ID);
    expect(p, 'projeto Arte Deli no relatório').toBeTruthy();
    expect(p.skipped).toBe('modo_manual');
    expect(p.disparos.length).toBe(0);
    await ctx.dispose();
  });

  test('3 · /api/va-lead-contato-manual grava linha em va_leads_log', async () => {
    const tok = await loginToken();
    await limpar(tok);
    const ctx = await api(tok);
    const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id`);
    const [arq] = await rA.json();
    test.skip(!arq, 'sem arquétipo aprovado');
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_leads`, {
      data: { projeto_id: PROJ_ID, origem:'manual', fonte:'manual', status:'aprovado',
              arquetipo_id: arq.id, razao_social:`${PREFIXO}LogTeste`, cnpj:'20.046.002/0001-02',
              whatsapp:'5548999999999', whatsapp_verificado: true, funil_etapa:'na_fila',
              aprovado_em: new Date().toISOString() },
    });
    const [lead] = await rIns.json();
    const rM = await ctx.post('https://www.1negocio.com.br/api/va-lead-contato-manual', {
      data: { lead_id: lead.id, acao:'contato_manual_iniciado', detalhe:'e2e wa.me', mover_para_contatado: true },
    });
    const d = await rM.json();
    expect(d.ok).toBe(true);
    expect(d.etapa_depois).toBe('contatado');
    // Confirma linha no log
    const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads_log?lead_id=eq.${lead.id}&select=acao,detalhe&order=criado_em.desc&limit=1`);
    const [log] = await rL.json();
    expect(log.acao).toBe('contato_manual_iniciado');
    expect(log.detalhe).toMatch(/e2e wa\.me/);
    await ctx.dispose();
    await limpar(tok);
  });

});
