-- ═══════════════════════════════════════════════════════════════════
-- SLICE · Modalidades + Arquitetura de Números + Publicação Portal
-- ═══════════════════════════════════════════════════════════════════
-- va_zapi_telefones: criada mínima (se não existir) + tipo/ativo/observacao
CREATE TABLE IF NOT EXISTS va_zapi_telefones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL, instancia text, token text, client_token text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE va_zapi_telefones ADD COLUMN IF NOT EXISTS tipo text CHECK (tipo IN ('prospeccao','receptivo','atendimento'));
ALTER TABLE va_zapi_telefones ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE va_zapi_telefones ADD COLUMN IF NOT EXISTS observacao text;

-- va_projetos: números + modalidade + publicação
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS zapi_telefone_saida_id uuid REFERENCES va_zapi_telefones(id);
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS zapi_telefone_receptivo_id uuid REFERENCES va_zapi_telefones(id);
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS modalidade text NOT NULL DEFAULT 'assessorada' CHECK (modalidade IN ('gratuito','guiado','assessorada'));
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS negocio_publicado_id uuid;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS publicado_em timestamptz;

-- va_modalidade_etapas + seed (gratuito/guiado/assessorada)
CREATE TABLE IF NOT EXISTS va_modalidade_etapas (
  modalidade text NOT NULL CHECK (modalidade IN ('gratuito','guiado','assessorada')),
  etapa_chave text NOT NULL, ativa boolean NOT NULL DEFAULT true, observacao text,
  PRIMARY KEY (modalidade, etapa_chave)
);
-- Seed completo no MCP · resumo: gratuito bloqueia arquetipos/criativos/campanha/operacao;
-- guiado libera todo setup e teaser mas bloqueia arquetipos+; assessorada libera tudo.

-- Fn va_etapa_ativa(projeto_id, etapa_chave) returns boolean
CREATE OR REPLACE FUNCTION va_etapa_ativa(p_projeto_id uuid, p_etapa_chave text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_mod text; v_ativa boolean;
BEGIN
  SELECT modalidade INTO v_mod FROM va_projetos WHERE id = p_projeto_id;
  IF v_mod IS NULL THEN RETURN true; END IF;
  SELECT ativa INTO v_ativa FROM va_modalidade_etapas WHERE modalidade=v_mod AND etapa_chave=p_etapa_chave;
  RETURN COALESCE(v_ativa, true);
END; $$;
GRANT EXECUTE ON FUNCTION va_etapa_ativa(uuid, text) TO authenticated, service_role;

-- Nova etapa 'publicacao' em va_projeto_etapas (ordem 9, entre teaser_ok e preco)
INSERT INTO va_projeto_etapas (projeto_id, chave, titulo, ordem, offset_dias, responsavel, status, data_prevista)
SELECT p.id, 'publicacao', 'Publicação no portal', 9, 9, 'voce', 'pendente', p.data_inicio + 9
FROM va_projetos p
WHERE NOT EXISTS (SELECT 1 FROM va_projeto_etapas e WHERE e.projeto_id=p.id AND e.chave='publicacao');
-- Reordena etapas seguintes se necessário (executado inline).

-- Upsell metric · media alcançados por ciclo dos assessorados
CREATE OR REPLACE VIEW va_upsell_metrica_assessorada AS
SELECT ROUND(AVG(cnt), 1) AS media_alcancados_por_ciclo, COUNT(*) AS base_projetos
FROM (
  SELECT p.id, COUNT(c.id) AS cnt FROM va_projetos p
  LEFT JOIN va_contatos c ON c.projeto_id = p.id AND c.criado_em > now() - interval '30 days'
  WHERE p.modalidade = 'assessorada' AND p.status = 'ativo' GROUP BY p.id
) x;
GRANT SELECT ON va_upsell_metrica_assessorada TO authenticated, service_role, anon;

-- Cliente view publicação
CREATE OR REPLACE FUNCTION va_cli_publicacao(p_projeto uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE r record;
BEGIN
  SELECT publicado_em, negocio_publicado_id INTO r FROM va_projetos WHERE id = p_projeto;
  IF r.publicado_em IS NULL THEN RETURN jsonb_build_object('publicado', false); END IF;
  RETURN jsonb_build_object('publicado', true, 'desde', r.publicado_em,
    'negocio_id', r.negocio_publicado_id, 'link', '/negocio.html?id='||r.negocio_publicado_id);
END; $$;
GRANT EXECUTE ON FUNCTION va_cli_publicacao(uuid) TO authenticated;
