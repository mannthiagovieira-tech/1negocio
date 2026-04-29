# Decisões pendentes para refactor do laudo-gratuito

**Data:** 29/04/2026
**Status:** Decisões tomadas, refactor adiado para após Fase 4 (Edge Functions IA)
**Razão do adiamento:** evitar retrabalho — Edge Function gerar_textos_laudo vai 
preencher campos que o laudo-gratuito precisa.

---

## CONTEXTO

Mapeamento dos 46+ hardcodes do laudo-gratuito.html foi concluído em 29/04 
(relatorios/2026-04-29-mapeamento-hardcodes-laudo-gratuito.md).

Antes de iniciar o refactor, foram tomadas 4 decisões sobre pendências bloqueantes 
(campos que não tinham correspondência direta no calc_json atual).

Esse documento registra essas decisões para a sessão futura que vai executar o refactor.

---

## DECISÕES TOMADAS

### Decisão 1 — Tipo de venda (subtexto do valor de venda)

**Onde aparece:** Card valor de venda, linha "Porteira fechada — inclui estoque, 
equipamentos e ponto comercial"

**Decisão:** Texto FIXO (não vem do calc_json nem do dossie_json). Mesma mensagem 
para todos os negócios. Faz par com a pergunta sobre expectativa de valor durante 
o diagnóstico (o vendedor responde com base nessa mesma definição).

**Texto a usar:**
> "Valor porteira fechada — inclui o negócio com todos os ativos e passivos atuais. 
> Mesma base usada na sua expectativa inicial durante o diagnóstico."

(Texto pode ser refinado pelo Thiago no momento do refactor.)

---

### Decisão 2 — Stats da plataforma (caixa "1N Performance")

**Onde aparece:** Caixa com "2.847 negócios avaliados", "R$ 1.2B volume total", 
"1.423 compradores ativos".

**Decisão temporária:** Hardcoded com números FAKE.

**Backlog futuro:** Criar aba "Estatísticas" no painel admin (admin-parametros.html) 
para edição manual desses números. O laudo-gratuito (e outras superfícies) leem 
de lá. Custo: 1-2h. Atacar quando o painel admin tiver aba de parâmetros 
(Fase 7 da spec rev3).

---

### Decisão 3 — Texto hero contextual

**Onde aparece:** Descrição de 2-3 linhas embaixo do nome do negócio. Hoje 
hardcoded como "Restaurante consolidado com 8 anos de operação no centro de 
Florianópolis. Equipe de 10 colaboradores com processos definidos. Base de 
clientes recorrentes."

**Decisão:** Ler de calc_json.textos_ia.texto_contexto_negocio (campo que já 
existe no schema, mas vazio até Fase 4 estar implementada).

**Fallback temporário:** Quando textos_ia.texto_contexto_negocio estiver vazio, 
mostrar template seco derivado de fatos do calc_json:
> "{setor.label} em {cidade}/{estado}, {tempo_operacao_anos} anos de operação."

(Sem invenção, só estrutura factual. Quando IA vier, substitui automaticamente.)

---

### Decisão 4 — Nota termômetro contextual

**Onde aparece:** Frase abaixo do termômetro: "Boa notícia: sua avaliação ficou 
55% acima da sua expectativa inicial."

**Decisão:** Manter hardcoded nesta etapa. Não é prioridade re-derivar agora.

**Refinamento futuro (não agora):** Trocar texto prescritivo "Boa notícia / Atenção" 
por neutro tipo "Avaliação 1N {pct}% acima da sua expectativa inicial." Cálculo do 
pct deriva de números do calc_json (não inventa, só compara). Custo: 30 min.

---

## REQUISITOS INVIOLÁVEIS DO REFACTOR FUTURO

Quando o refactor do laudo-gratuito for executado, manter:

**REQ-1: Após o refactor, o laudo-gratuito carregado com Forste demo deve mostrar 
EXATAMENTE os mesmos números do laudo-admin com Forste demo.**

Números esperados (Forste sintético, calc_json v2026.07):
- valuation.valor_venda: R$ 631.976
- potencial_12m.potencial_final.valor_projetado_brl: R$ 791.441
- potencial_12m.potencial_final.brl: R$ 159.466 (+25.23%)
- ise.total: 84.1 → arredondado 84
- atratividade.total: 77/100
- identificacao.setor.label: "Serviços B2B"

**REQ-2: Preservar 100% dos caminhos de continuidade do arquivo.**

INTOCÁVEIS — não mexer em estrutura, lógica de fluxo ou texto destes elementos:
- CTAs principais ("Publicar Gratuitamente", "Publicação Guiada R$588")
- Caixa Consultoria completa (rename "1Sócio" → "1N Consultoria" mantendo cor roxa)
- Caixa Laudo R$99
- Sticky footer
- Popups completos (incluindo POPUP PUBLICAR GRÁTIS com fluxo termo-adesao)
- Funções JavaScript de fluxo (abrirPopup, irParaTermo, _stripeUrlPendente, STRIPE_LAUDO)
- Redirect e link patterns (/termo-adesao.html, URLs Stripe)

---

## ORDEM SUGERIDA DO REFACTOR (12 passos, 4-6h)

Quando voltar ao laudo-gratuito:

1. (P) renderHero ro_anual vs ro_mensal alinhar com A1 do laudo-pago
2. (P) renderTermometro valor_1n*1.40 → potencial_12m.potencial_final.valor_projetado_brl
3. (P) renderTributario deletar 2 frases prescritivas + "ótimo"→"ideal"
4. (P) renderAtratividade deletar 4 frases prescritivas
5. (P) Corrigir "10 pilares" → "8 pilares" linha 627
6. (P) Rename "1Sócio" → "1N Consultoria" (6+ ocorrências)
7. (M) renderICD eliminar CAMPOS_ICD hardcoded → consumir calcJson.icd direto
8. (G) REVAMP renderOport pra {ativos, paywalls} + categorias técnicas + R$ no card. 
   PAYWALLS BLOQUEADOS (diferente do laudo-pago que revela)
9. (G) REVAMP renderSocio usando potencial_12m.potencial_final
10. (P) Regenerar DEMO_DATA via fixture
11. (P) Corrigir 2 comentários internos linhas 755, 760
12. Validar Forste demo (REQ-1)

---

## REFERÊNCIAS

- Mapeamento: relatorios/2026-04-29-mapeamento-hardcodes-laudo-gratuito.md
- Spec: relatorios/spec-v2-final-rev3.md (decisões #11, #15, #16, #22-26)
- Pendência relacionada: relatorios/2026-04-29-pendencia-breakdown-upsides.md
