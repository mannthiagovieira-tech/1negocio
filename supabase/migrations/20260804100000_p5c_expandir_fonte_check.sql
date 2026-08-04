-- Expande va_leads.fonte pra aceitar meta_ctwa (CTWA nativo) + meta_ctwa_manual (conversão órfã)
ALTER TABLE va_leads DROP CONSTRAINT IF EXISTS va_leads_fonte_check;
ALTER TABLE va_leads ADD CONSTRAINT va_leads_fonte_check CHECK (
  fonte IS NULL OR fonte = ANY (ARRAY[
    'kipflow'::text, 'apify_gmaps'::text, 'meta_ads'::text,
    'meta_ctwa'::text, 'meta_ctwa_manual'::text, 'manual'::text
  ])
);
