-- v9.32 · rastreabilidade de versão do briefing
-- Aplicada via MCP apply_migration em 2026-05-12

ALTER TABLE projetos_originacao
  ADD COLUMN IF NOT EXISTS briefing_versao text DEFAULT 'v2_enxuto';

-- Estrutura V2 do briefing_jsonb (documentação · sem schema validation):
-- {
--   "negocio": {
--     "setor": "<canônico · 12 valores>",
--     "sub_setor": "<nicho>",
--     "modelos_operacao": ["<canônicos · 8 valores>"],
--     "cidade", "estado", "alcance_operacao", "fonte_confianca"
--   },
--   "tamanho": {
--     "faturamento_bruto_anual", "resultado_operacional_anual",
--     "margem_operacional_pct", "tempo_operacao_anos",
--     "funcionarios", "valor_venda_pedido", "fonte_confianca"
--   },
--   "diferenciais_ativos": [<3-5 bullets>],
--   "sinergia": {
--     "indicadores_acima_media": [<bullets>],
--     "ganho_consolidador": "<1-2 frases>"
--   },
--   "tipos_comprador_buscar": ["concorrente_direto|antes_cadeia|depois_cadeia|adjacente|investidor_financeiro"],
--   "alcance_geografico_comprador": "<cidade|raio_30km|raio_100km|estado|regiao|brasil|internacional>",
--   "alcance_geografico_justificativa": "",
--   "observacao": ""
-- }
--
-- Removido vs V1 (v9.31): identidade · economics · momento_mercado · motivo_venda · riscos
-- Adicionado: negocio + tamanho (vocabulário canônico) · sinergia · tipos_comprador_buscar
