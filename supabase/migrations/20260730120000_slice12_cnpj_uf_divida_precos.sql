-- ═══════════════════════════════════════════════════════════════════
-- SLICE 12 · CNPJ obrigatório, dívida e preço split
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_projetos · adicionar UF (cidade e cnpj já existem) ────────
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS uf text;

-- 2) va_empresas · dívida (dataset debts do Kipflow) ──────────────
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS divida_total numeric(14,2);
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS divida_previdenciaria numeric(14,2);
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS divida_nao_previdenciaria numeric(14,2);
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS divida_fgts numeric(14,2);
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS divida_bruto jsonb;
ALTER TABLE va_empresas ADD COLUMN IF NOT EXISTS divida_consultada_em timestamptz;

-- 3) va_precos · split similares_preview / similares_import ───────
-- Desativa item anterior (não deleta pra preservar histórico do razão)
UPDATE va_precos SET ativo = false WHERE tipo = 'similares_busca';

INSERT INTO va_precos (tipo, rotulo, unidade, preco, custo_real, fornecedor, ativo, ordem)
VALUES ('similares_preview', 'Busca de similares · preview', 'resultado', 0.05, 0.02, 'kipflow', true, 31)
ON CONFLICT (tipo) DO UPDATE SET rotulo=EXCLUDED.rotulo, unidade=EXCLUDED.unidade,
  preco=EXCLUDED.preco, custo_real=EXCLUDED.custo_real, fornecedor=EXCLUDED.fornecedor, ativo=true;

INSERT INTO va_precos (tipo, rotulo, unidade, preco, custo_real, fornecedor, ativo, ordem)
VALUES ('similares_import', 'Similar importado (com enriquecimento)', 'empresa', 0.78, 0.39, 'kipflow', true, 32)
ON CONFLICT (tipo) DO UPDATE SET rotulo=EXCLUDED.rotulo, unidade=EXCLUDED.unidade,
  preco=EXCLUDED.preco, custo_real=EXCLUDED.custo_real, fornecedor=EXCLUDED.fornecedor, ativo=true;
