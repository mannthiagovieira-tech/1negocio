# Backup Master — Skill Avaliadora v2

Esta pasta contém cópias imutáveis da `skill-avaliadora-v2.js` 
(single source of truth do sistema 1Negócio).

## Regras

- A versão ATIVA do sistema é `/skill-avaliadora-v2.js` na raiz do repo.
- Os arquivos nesta pasta são SOMENTE para referência histórica e 
  rollback de emergência.
- **NUNCA editar arquivos nesta pasta.**
- Para criar novo checkpoint: copiar a skill ativa ao lado com nome 
  `skill-avaliadora-v2-DDMMMAAAA.js` e versionar tag git correspondente.

## Histórico

- `skill-avaliadora-v2-01mai2026.js` — Checkpoint v1.0. 
  Estado pós-FIX-CONSOLIDADO Mariah/Thiago. 
  Tag: `v1.0-checkpoint-01mai2026`
