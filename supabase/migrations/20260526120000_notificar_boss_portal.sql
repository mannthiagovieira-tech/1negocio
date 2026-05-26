-- notificar-boss-portal · triggers que chamam a edge via pg_net.http_post
-- Schema supabase_functions não está disponível nesse projeto, então usamos
-- um wrapper PL/pgSQL próprio com pg_net (que está habilitado).
-- Aplicada via MCP apply_migration.

CREATE OR REPLACE FUNCTION public.notificar_boss_portal_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END,
    'old_record', CASE WHEN TG_OP = 'INSERT' THEN NULL::jsonb ELSE to_jsonb(OLD) END
  );
  PERFORM net.http_post(
    url := 'https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/notificar-boss-portal',
    body := payload,
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_boss_portal_negocios_insert ON public.negocios;
DROP TRIGGER IF EXISTS trg_boss_portal_solinfo_insert ON public.solicitacoes_info;
DROP TRIGGER IF EXISTS trg_boss_portal_solassess_insert ON public.solicitacoes_assessorado;
DROP TRIGGER IF EXISTS trg_boss_portal_agenda_insert ON public.admin_agenda;
DROP TRIGGER IF EXISTS trg_boss_portal_agenda_pago ON public.admin_agenda;
DROP TRIGGER IF EXISTS trg_boss_portal_teses_insert ON public.teses_investimento;

CREATE TRIGGER trg_boss_portal_negocios_insert
AFTER INSERT ON public.negocios
FOR EACH ROW EXECUTE FUNCTION public.notificar_boss_portal_webhook();

CREATE TRIGGER trg_boss_portal_solinfo_insert
AFTER INSERT ON public.solicitacoes_info
FOR EACH ROW EXECUTE FUNCTION public.notificar_boss_portal_webhook();

CREATE TRIGGER trg_boss_portal_solassess_insert
AFTER INSERT ON public.solicitacoes_assessorado
FOR EACH ROW EXECUTE FUNCTION public.notificar_boss_portal_webhook();

CREATE TRIGGER trg_boss_portal_agenda_insert
AFTER INSERT ON public.admin_agenda
FOR EACH ROW EXECUTE FUNCTION public.notificar_boss_portal_webhook();

CREATE TRIGGER trg_boss_portal_agenda_pago
AFTER UPDATE ON public.admin_agenda
FOR EACH ROW
WHEN (NEW.pagamento_status = 'pago' AND OLD.pagamento_status IS DISTINCT FROM 'pago')
EXECUTE FUNCTION public.notificar_boss_portal_webhook();

CREATE TRIGGER trg_boss_portal_teses_insert
AFTER INSERT ON public.teses_investimento
FOR EACH ROW EXECUTE FUNCTION public.notificar_boss_portal_webhook();
