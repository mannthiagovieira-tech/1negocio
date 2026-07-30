-- ═══════════════════════════════════════════════════════════════════
-- SLICE 12b · alcance por CNPJ e sócio decisor
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_arquetipos_catalogo · alcance + canal recomendado ─────────
ALTER TABLE va_arquetipos_catalogo ADD COLUMN IF NOT EXISTS alcancavel_por_cnpj boolean;
ALTER TABLE va_arquetipos_catalogo ADD COLUMN IF NOT EXISTS canal_recomendado text;

-- Deriva de captavel_por já existente (scrapper/midia/rede)
UPDATE va_arquetipos_catalogo SET
  alcancavel_por_cnpj = (captavel_por = 'scrapper'),
  canal_recomendado = CASE captavel_por
    WHEN 'scrapper' THEN 'busca_cnpj'
    WHEN 'midia'    THEN 'midia_paga'
    WHEN 'rede'     THEN 'rede'
    ELSE 'busca_cnpj'
  END
WHERE alcancavel_por_cnpj IS NULL OR canal_recomendado IS NULL;

ALTER TABLE va_arquetipos_catalogo
  ALTER COLUMN alcancavel_por_cnpj SET NOT NULL,
  ALTER COLUMN canal_recomendado   SET NOT NULL;

-- 2) va_contatos · sócio decisor importado do similares ───────────
-- (nome e cargo já existiam)
ALTER TABLE va_contatos ADD COLUMN IF NOT EXISTS socio_faixa_etaria  text;
ALTER TABLE va_contatos ADD COLUMN IF NOT EXISTS socio_data_entrada  date;
ALTER TABLE va_contatos ADD COLUMN IF NOT EXISTS socio_identificador text;
ALTER TABLE va_contatos ADD COLUMN IF NOT EXISTS socios_extras       jsonb;
