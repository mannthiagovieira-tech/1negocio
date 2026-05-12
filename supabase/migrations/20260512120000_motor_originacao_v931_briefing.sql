-- v9.31 · Motor de Originação · Briefing Inteligente
-- Aplicada via MCP apply_migration em 2026-05-12
-- Operador trocou Chat Tese por Briefing pré-preenchido editável

ALTER TABLE projetos_originacao
  ADD COLUMN IF NOT EXISTS briefing_jsonb jsonb,
  ADD COLUMN IF NOT EXISTS briefing_gerado_em timestamptz,
  ADD COLUMN IF NOT EXISTS alcance_geografico text
    CHECK (alcance_geografico IS NULL OR alcance_geografico IN
      ('cidade', 'raio_30km', 'raio_100km', 'estado', 'regiao', 'brasil', 'internacional'));

-- Estrutura esperada de briefing_jsonb (documentação):
-- {
--   "identidade": { nome, setor, sub_setor, cidade, estado,
--                   tempo_operacao_anos, funcionarios, fonte_confianca },
--   "economics": { faturamento_anual, ebitda_mensal, margem_percentual,
--                  crescimento_3a_percentual, recorrencia, fonte_confianca },
--   "diferenciais": [<3-5 bullets>],
--   "riscos": [<2-3 bullets>],
--   "momento_mercado": "<2-3 frases>",
--   "motivo_venda": "aposentadoria|sucessao|cash_out|conflito_socios|pivo|saude|outro",
--   "motivo_venda_obs": "string opcional",
--   "alcance_geografico": "cidade|raio_30km|raio_100km|estado|regiao|brasil|internacional",
--   "alcance_geografico_justificativa": "string",
--   "observacoes_livres": ""
-- }
