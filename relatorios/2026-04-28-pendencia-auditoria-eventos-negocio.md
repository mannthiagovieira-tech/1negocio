# Pendência arquitetural — log de eventos do negócio + invalidação de textos IA

Discutido em sessão de 28/04/2026. Adiado para próximo bloco arquitetural (junto com Edge Functions de IA — Fase 4 do roadmap).

## Necessidade

Laudo-admin precisa exibir log de eventos relevantes do negócio:
- Foi publicado
- Voltou pra standby
- Foi despublicado
- Admin alterou valor de venda
- (outros eventos a definir)

Quando admin altera valor de venda, os textos comerciais gerados pelas Edge Functions de IA precisam ser invalidados/regerados, porque os textos referenciam valores específicos que ficaram obsoletos.

## Escopo arquitetural

1. Criar tabela eventos_negocio (ou negocios_historico) com schema:
   - id, negocio_id, tipo_evento, payload (JSON com detalhes), criado_em, criado_por

2. Definir tipos de evento:
   - status_alterado (de X para Y)
   - valor_venda_alterado (de X para Y)
   - publicado, despublicado, vendido, etc.
   - texto_ia_invalidado, texto_ia_regerado

3. Implementar mecanismo de gravação:
   - Trigger no banco? Hook na UI admin? Edge Function?
   - Decisão pendente — tem trade-offs.

4. Lógica de invalidação de textos IA:
   - Quais campos do calc_json/negocio invalidam quais textos?
   - Marcar como obsoleto automaticamente? Botão manual?
   - Definir contratos entre Edge Functions e tabela de eventos.

## Por que adiado

- Edge Functions de IA ainda não foram implementadas (Fase 4 do roadmap)
- Não dá pra invalidar texto se o texto ainda não existe
- Tema arquitetural denso (não é só criar tabela)
- Faz mais sentido implementar junto com Edge Functions, porque contratos são interdependentes

## Quando atacar

Bloco dedicado, depois que os laudos estiverem prontos e antes de ativar Edge Functions de IA. Estimativa: 6-10h focadas.

## Como o laudo-admin lida hoje

Sem log. Mostra apenas status atual + datas básicas (created_at, publicado_em) lidas direto da tabela negocios. Tag de status conforme decisão D-I do mapeamento.
