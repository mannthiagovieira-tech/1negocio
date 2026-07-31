-- ═══════════════════════════════════════════════════════════════════
-- SLICE · Carta de Intenções + Flexibilidade de Preço
-- ═══════════════════════════════════════════════════════════════════
-- Nomenclatura: "Carta de Intenções" (nunca "Proposta") · não vinculante
-- ⚠ Modelo NÃO revisado juridicamente — submeter a advogado antes do primeiro uso.

-- Flexibilidade na etapa Preço
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS flexibilidade_percent numeric(5,2);
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS aceita_parcelamento boolean DEFAULT false;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS parcelamento_max_meses int;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS entrada_minima_percent numeric(5,2);
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS observacoes_negociacao text;

CREATE TABLE IF NOT EXISTS va_cartas_intencao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES va_contatos(id) ON DELETE CASCADE,
  nda_id uuid REFERENCES va_ndas(id),
  ofertante_tipo text CHECK (ofertante_tipo IN ('pf','pj')),
  ofertante_nome text, ofertante_documento text,
  ofertante_endereco text, ofertante_email text, ofertante_telefone text,
  ofertante_representante text, ofertante_representante_cpf text,
  valor_ofertado numeric(14,2),
  forma_pagamento text, percentual_entrada numeric(5,2),
  prazo_parcelamento_meses int, condicoes_suspensivas text,
  prazo_due_diligence_dias int, prazo_validade_dias int,
  transicao_desejada_meses int, observacoes text,
  corpo_gerado text, template_versao int,
  token_publico text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  status text NOT NULL DEFAULT 'gerada'
    CHECK (status IN ('gerada','enviada','assinada','recusada','expirada','aceita_pelo_vendedor','recusada_pelo_vendedor')),
  assinado_em timestamptz, assinado_ip text,
  decidido_em timestamptz, decisao_justificativa text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_cartas_intencao_projeto_idx ON va_cartas_intencao (projeto_id, status);
CREATE INDEX IF NOT EXISTS va_cartas_intencao_token_idx  ON va_cartas_intencao (token_publico);

-- Template inicial (marca NÃO revisado juridicamente)
INSERT INTO va_documento_templates (tipo, nome, corpo, versao, ativo)
SELECT 'carta_intencao', 'Carta de Intenções · modelo inicial (NÃO REVISADO)', $T$[TEMPLATE COMPLETO NO CÓDIGO — 12 CLÁUSULAS, NÃO-VINCULÂNCIA EXPLÍCITA]$T$, 1, true
WHERE NOT EXISTS (SELECT 1 FROM va_documento_templates WHERE tipo='carta_intencao');

-- RPCs (código completo aplicado via MCP, resumo aqui pra referência):
--   va_gerar_carta_intencao(contato_id) — exige NDA assinado, RAISE se não
--   va_registrar_assinatura_carta(token, dados jsonb, ip) — congela corpo, move contato pra 'proposta', notifica
--   va_decidir_carta(carta_id, decisao, justificativa) — aceita_pelo_vendedor|recusada_pelo_vendedor
--   va_carta_publica(token) — busca sem RLS pra renderizar página pública
