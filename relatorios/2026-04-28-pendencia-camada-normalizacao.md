# Pendência arquitetural — camada de normalização do D

A varredura completa (commit anterior) encontrou:
- 9 campos fantasmas (skill consome, diag nunca salva)
- 5 mismatches de nome
- 2 fallbacks ocos
- Múltiplos mismatches de domínio

Padrão estrutural: skill foi escrita assumindo nomes/domínios diferentes do que diagnóstico produz. Falta contrato explícito entre as duas peças.

## Proposta para próximo ciclo de trabalho (P1, fora do escopo atual)

Criar função normalizarDiagnostico(D_raw) que:
1. Recebe D como vem do diagnóstico
2. Aplica todos os mapeamentos de nome conhecidos
3. Aplica padronizações de domínio conhecidas
4. Devolve D_normalizado com schema explícito

Vantagens:
- Único ponto de verdade
- Adicionar campo novo = mexer em 1 lugar
- Testar fica trivial
- Documentação do schema = código

Esforço estimado: 4-6 horas. Não bloqueia trabalho atual de upsides. Atacar após merge do refactor v2026.05 em main.

Bugs do ISE em produção (~20 pontos abaixo do correto) serão corrigidos pontualmente em commit dedicado pós-commit 3 do refactor de upsides.
