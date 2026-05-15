-- Fix: trigger criava nda_solicitacoes sem 'nome_completo' (NOT NULL),
-- causando 23502 ao postar solicitacoes_info via frontend.
-- Solução: SELECT nome em usuarios e usar como nome_completo.
CREATE OR REPLACE FUNCTION criar_nda_solicitacao_pendente()
RETURNS TRIGGER AS $$
DECLARE
  v_nome text;
BEGIN
  IF NEW.status::text = 'nda_pendente' THEN
    IF NOT EXISTS (
      SELECT 1 FROM nda_solicitacoes
      WHERE solicitacao_info_id = NEW.id
    ) THEN
      SELECT COALESCE(NULLIF(TRIM(nome), ''), '—')
        INTO v_nome
      FROM usuarios
      WHERE id = NEW.comprador_id;

      IF v_nome IS NULL THEN v_nome := '—'; END IF;

      INSERT INTO nda_solicitacoes (
        usuario_id, negocio_id, solicitacao_info_id,
        nome_completo, status, expira_em, aprovado_em
      ) VALUES (
        NEW.comprador_id, NEW.negocio_id, NEW.id,
        v_nome, 'aprovado', now() + interval '72 hours', now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
