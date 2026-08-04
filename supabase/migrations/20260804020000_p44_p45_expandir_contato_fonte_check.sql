-- Expande contato_fonte pra incluir 'cadastral' (BrasilAPI, Adendo 4.4)
-- e 'site' (fetch direto do site do enriquecer, já usado em 4.4 · faltava
-- adicionar na constraint). Sem esses, os UPDATEs do enriquecer explodem.
ALTER TABLE va_leads DROP CONSTRAINT IF EXISTS va_leads_contato_fonte_check;
ALTER TABLE va_leads ADD CONSTRAINT va_leads_contato_fonte_check CHECK (
  contato_fonte IS NULL OR contato_fonte = ANY (ARRAY[
    'kipflow'::text, 'cadastral'::text, 'site'::text, 'gmaps'::text, 'manual'::text
  ])
);
