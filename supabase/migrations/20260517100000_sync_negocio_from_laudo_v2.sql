-- v9.39.4 · trigger laudos_v2 → negocios (sincroniza dados financeiros)
-- Aplicada via MCP apply_migration em 2026-05-17 (commit 1d44543+).
-- Repo tem divergência migration history; `db push` quebra. Arquivo aqui é só registro.
--
-- Quando um laudo ativo é inserido/atualizado, propaga calc_json.dre pra negocios.
-- Resolve staleness de negocios.ebitda_anual=0 quando o laudo já tem ro_anual real.

CREATE OR REPLACE FUNCTION public.sync_negocio_from_laudo_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  dre jsonb;
  v_fat_anual numeric;
  v_ro_anual numeric;
  v_ro_mensal numeric;
BEGIN
  IF NEW.ativo IS NOT TRUE OR NEW.negocio_id IS NULL THEN
    RETURN NEW;
  END IF;

  dre := NEW.calc_json -> 'dre';
  IF dre IS NULL THEN
    RETURN NEW;
  END IF;

  v_fat_anual  := NULLIF(dre->>'fat_anual',  '')::numeric;
  v_ro_anual   := NULLIF(dre->>'ro_anual',   '')::numeric;
  v_ro_mensal  := NULLIF(dre->>'ro_mensal',  '')::numeric;

  UPDATE public.negocios SET
    faturamento_anual        = COALESCE(v_fat_anual, faturamento_anual),
    ebitda_anual             = COALESCE(v_ro_anual,  ebitda_anual),
    resultado_liquido_mensal = COALESCE(v_ro_mensal, resultado_liquido_mensal)
  WHERE id = NEW.negocio_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_negocio_from_laudo_v2 ON public.laudos_v2;
CREATE TRIGGER trg_sync_negocio_from_laudo_v2
  AFTER INSERT OR UPDATE OF ativo, calc_json ON public.laudos_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_negocio_from_laudo_v2();

-- Backfill (rodado uma vez após criação):
-- UPDATE public.laudos_v2 SET ativo = ativo WHERE ativo = true;
-- → 793 laudos processados, 0 divergências.
