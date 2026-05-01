-- Cria automaticamente registro em nda_solicitacoes (com status=aprovado +
-- token gerado + expira em 72h) quando solicitacao_info nasce com
-- status='nda_pendente'. Permite portal mostrar "Assinar NDA" imediatamente,
-- sem aprovação manual prévia.
CREATE OR REPLACE FUNCTION criar_nda_solicitacao_pendente()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status::text = 'nda_pendente' THEN
    IF NOT EXISTS (
      SELECT 1 FROM nda_solicitacoes
      WHERE solicitacao_info_id = NEW.id
    ) THEN
      INSERT INTO nda_solicitacoes (
        usuario_id, negocio_id, solicitacao_info_id,
        status, expira_em, aprovado_em
      ) VALUES (
        NEW.comprador_id, NEW.negocio_id, NEW.id,
        'aprovado', now() + interval '72 hours', now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_criar_nda_solicitacao_pendente ON solicitacoes_info;
CREATE TRIGGER trg_criar_nda_solicitacao_pendente
  AFTER INSERT OR UPDATE ON solicitacoes_info
  FOR EACH ROW
  EXECUTE FUNCTION criar_nda_solicitacao_pendente();
