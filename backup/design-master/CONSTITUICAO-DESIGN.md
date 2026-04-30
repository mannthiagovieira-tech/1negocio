# CONSTITUIÇÃO DO DESIGN MASTER

**Data:** 30/04/2026
**Autor:** Thiago Mann
**Status:** Imutável até autorização explícita do dono

## PREMISSA MASTER

O design visual da home (index.html) e dos cards de anúncio NÃO PODE
mudar sem autorização explícita do Thiago.

## O QUE PODE MUDAR (refatoração permitida)

- Fonte dos dados: substituir DATA hardcoded por queries em anuncios_v2 + laudos_v2
- Lógica JS de cálculo no front: substituir por leitura direta do calc_json
- Endpoints de API consumidos
- Performance / loading states

## O QUE NÃO PODE MUDAR (proibido)

- HTML estrutural dos cards
- CSS (cores, fontes, espaçamentos, layout)
- Disposição das 4 abas (Resumo, Financeiro, Indicadores, 1N Análise)
- Filtros (categorias, estados, contadores)
- Header (logo, botão Avalie e Publique, menu)
- Footer / barra de status superior (oportunidades, setores, estados, etc)
- Animações e transições
- Visual do botão "Solicitar Informações"
- Posicionamento de qualquer elemento visual

## VALIDAÇÃO OBRIGATÓRIA PÓS-REFATORAÇÃO

Quando alterar index.html ou negocio.html, sempre:

1. Abrir backup/design-master/index-30abr2026.html no navegador
2. Abrir versão nova ao lado
3. Comparar visualmente cada uma das 4 abas do card
4. Verificar header, footer, filtros
5. Se houver QUALQUER diferença visual, REVERTER e investigar antes de prosseguir

## RESTAURAÇÃO

Se algum Claude (ou commit) alterar o visual e for descoberto depois:

```
git log --oneline -- index.html
git checkout {hash-pré-mudança} -- index.html
```

Ou copiar do backup direto:

```
cp backup/design-master/index-30abr2026.html index.html
```
