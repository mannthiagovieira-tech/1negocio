-- Migration 019: Coluna origem em anuncios_v2
-- Distingue anúncios reais de clientes vs povoamento/parceiros/teste

BEGIN;

ALTER TABLE anuncios_v2
ADD COLUMN origem TEXT NOT NULL DEFAULT 'cliente'
CHECK (origem IN ('cliente','povoamento_inicial','parceiro_indicacao','maquininha_teste'));

CREATE INDEX idx_anuncios_v2_origem ON anuncios_v2(origem);

COMMENT ON COLUMN anuncios_v2.origem IS
'Origem do anúncio: cliente=real do diagnóstico, povoamento_inicial=criado pelo Thiago pra povoar plataforma, parceiro_indicacao=via parceiro, maquininha_teste=teste de validação';

COMMIT;
