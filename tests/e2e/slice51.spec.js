// @ts-check
// P5.1 · biblioteca de templates · E2E · 3 asserções mínimas.
const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
const PROJ_ID = 'b676073a-6074-48d4-a608-7947de006dff';

test.beforeAll(() => { if (!EMAIL || !PASS) throw new Error('E2E_EMAIL/E2E_PASS obrigatórios'); });

async function loginToken() {
  const ctx = await pwrequest.newContext();
  const r = await ctx.post(`${SB_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SB_ANON, 'Content-Type':'application/json' },
    data: { email: EMAIL, password: PASS },
  });
  const d = await r.json(); await ctx.dispose(); return d.access_token;
}

test.describe('P5.1 · templates', () => {

  test('1 · 4 templates fundadores existem e estão ativos', async () => {
    const ctx = await pwrequest.newContext({ extraHTTPHeaders: { apikey: SB_ANON, 'Content-Type':'application/json' } });
    const r = await ctx.get(`${SB_URL}/rest/v1/va_criativo_templates?status=eq.ativo&select=slug&order=slug`);
    const rows = await r.json();
    const slugs = rows.map(x => x.slug);
    expect(slugs).toContain('classificado_feed');
    expect(slugs).toContain('card_financeiro_feed');
    expect(slugs).toContain('teaser_dado_story');
    expect(slugs).toContain('chamada_comprador_feed');
    await ctx.dispose();
  });

  test('2 · geração do template · sem débito · rascunho criado', async () => {
    const tok = await loginToken();
    // Pega classificado_feed
    const ctx = await pwrequest.newContext({ extraHTTPHeaders: { apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' } });
    const rT = await ctx.get(`${SB_URL}/rest/v1/va_criativo_templates?slug=eq.classificado_feed&select=id`);
    const [tpl] = await rT.json();
    const rG = await ctx.post('https://www.1negocio.com.br/api/va-gerar-do-template', {
      data: { projeto_id: PROJ_ID, template_id: tpl.id },
    });
    const d = await rG.json();
    expect(d.ok).toBe(true);
    expect(d.criativo_id).toBeTruthy();
    // Confirma criativo com origem='template' e template_id preenchido
    const rC = await ctx.get(`${SB_URL}/rest/v1/va_criativos?id=eq.${d.criativo_id}&select=origem,template_id,status`);
    const [c] = await rC.json();
    expect(c.origem).toBe('template');
    expect(c.template_id).toBe(tpl.id);
    expect(c.status).toBe('rascunho');
    // Cleanup
    await ctx.delete(`${SB_URL}/rest/v1/va_criativos?id=eq.${d.criativo_id}`);
    await ctx.dispose();
  });

  test('3 · template indisponível quando slot obrigatório falta', async () => {
    const tok = await loginToken();
    // Projeto FAKE sem setor/uf/valor não existe · usamos overrides pra remover
    // Simulação: cria template temporário com campo obrigatório inexistente
    const ctx = await pwrequest.newContext({ extraHTTPHeaders: { apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' } });
    // Inserimos template com campo obrigatório "campo_inexistente"
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_criativo_templates`, {
      data: { slug: 'e2e_test_' + Date.now(), nome: 'E2E test', formato: 'feed_1080', layout: 'classificado',
              campos_obrigatorios: ['campo_inexistente'] },
      headers: { Prefer: 'return=representation' },
    });
    const [tpl] = await rIns.json();
    const rG = await ctx.post('https://www.1negocio.com.br/api/va-gerar-do-template', {
      data: { projeto_id: PROJ_ID, template_id: tpl.id },
    });
    expect(rG.status()).toBe(422);
    const d = await rG.json();
    expect(d.faltando).toContain('campo_inexistente');
    // Cleanup
    await ctx.delete(`${SB_URL}/rest/v1/va_criativo_templates?id=eq.${tpl.id}`);
    await ctx.dispose();
  });

});
