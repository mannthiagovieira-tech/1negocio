-- HERMES v4 · pg_cron jobs
-- Anon key usada no header pra passar verify_jwt do edge hermes-cron
-- Aplicada via MCP apply_migration

DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY[
    'hermes-relatorio-diario',
    'hermes-followup',
    'hermes-apify-poll',
    'hermes-expirar-auth',
    'hermes-limpeza-sessoes'
  ] LOOP
    BEGIN PERFORM cron.unschedule(j); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;

-- 1) Relatório diário · 08h BRT (11h UTC)
SELECT cron.schedule(
  'hermes-relatorio-diario',
  '0 11 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/hermes-cron',
    body := '{"job":"relatorio"}'::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb
  );
  $cmd$
);

-- 2) Follow-up leads inativos · a cada 6h
SELECT cron.schedule(
  'hermes-followup',
  '0 */6 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/hermes-cron',
    body := '{"job":"followup"}'::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb
  );
  $cmd$
);

-- 3) Polling Apify · a cada 1h
SELECT cron.schedule(
  'hermes-apify-poll',
  '0 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/hermes-cron',
    body := '{"job":"apify_poll"}'::jsonb,
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb
  );
  $cmd$
);

-- 4) Expirar autorizações pendentes há mais de 24h · diário 07h50 BRT (10h50 UTC)
SELECT cron.schedule(
  'hermes-expirar-auth',
  '50 10 * * *',
  $cmd$
  UPDATE hermes_autorizacoes
     SET status = 'expirada'
   WHERE status = 'pendente'
     AND created_at < now() - interval '24 hours'
  $cmd$
);

-- 5) Limpeza sessões arquivadas após 7 dias inativas · semanal domingo 03h UTC
SELECT cron.schedule(
  'hermes-limpeza-sessoes',
  '0 3 * * 0',
  $cmd$
  UPDATE hermes_sessoes
     SET arquivada = true
   WHERE ultima_atividade < now() - interval '7 days'
     AND arquivada = false
  $cmd$
);
