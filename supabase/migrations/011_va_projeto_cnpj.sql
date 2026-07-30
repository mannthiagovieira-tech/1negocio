-- ═══════════════════════════════════════════════════════════════════
-- SLICE 10 · complemento · CNPJ da empresa à venda no projeto
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS cnpj text;
