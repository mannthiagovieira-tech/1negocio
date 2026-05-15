-- Tabela de config global da plataforma (se não existir)
CREATE TABLE IF NOT EXISTS config_plataforma (
  chave text PRIMARY KEY,
  valor text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Inserir config padrão "modo de liberação" como manual
INSERT INTO config_plataforma (chave, valor)
VALUES ('modo_liberacao_dossie', 'manual')
ON CONFLICT (chave) DO NOTHING;

COMMENT ON TABLE config_plataforma IS
  'Configurações globais da plataforma (toggles operacionais)';
COMMENT ON COLUMN config_plataforma.valor IS
  'Modo de liberação dossiê: automatico (libera após NDA) ou manual (admin libera)';

-- Trigger pra auto-liberar quando NDA é assinado e modo = automatico
CREATE OR REPLACE FUNCTION auto_liberar_apos_nda()
RETURNS TRIGGER AS $$
DECLARE
  modo text;
BEGIN
  IF NEW.status::text = 'nda_assinado' AND
     (OLD.status IS NULL OR OLD.status::text <> 'nda_assinado') THEN

    SELECT valor INTO modo FROM config_plataforma
    WHERE chave = 'modo_liberacao_dossie';

    IF modo = 'automatico' THEN
      NEW.status := 'liberado';
      NEW.liberado_em := now();
      NEW.liberado_ate := now() + interval '7 days';
      NEW.liberado_por := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_liberar_apos_nda ON solicitacoes_info;
CREATE TRIGGER trg_auto_liberar_apos_nda
  BEFORE UPDATE ON solicitacoes_info
  FOR EACH ROW
  EXECUTE FUNCTION auto_liberar_apos_nda();
