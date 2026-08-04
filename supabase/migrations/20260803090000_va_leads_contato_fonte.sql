-- P4.3 · fonte do contato (kipflow · gmaps · manual) pra rastreabilidade
ALTER TABLE va_leads
  ADD COLUMN IF NOT EXISTS contato_fonte text NULL
    CHECK (contato_fonte IS NULL OR contato_fonte IN ('kipflow','gmaps','manual'));
