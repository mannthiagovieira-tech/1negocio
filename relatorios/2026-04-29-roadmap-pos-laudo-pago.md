# 1Negócio · Roadmap pós laudo-pago
**Data:** 29-30/04/2026
**Status:** laudo-pago v1→v2 commitado. Próximas 14 tarefas em ordem fixa.

## ORDEM DE EXECUÇÃO (não alterar sem autorização)

1. ✅ Terminar laudo-pago (port v1→v2) — concluído
2. Subir laudo-pago modelo novo no laudo-completo (gratuito) — adaptar mesma estrutura, versão reduzida
3. Ajeitar index cards — puxar dados de v2 (substituir DATA hardcoded)
4. Ajeitar negocio.html pré-NDA — info pública anônima
5. Ajeitar negocio.html pós-NDA — dossiê nível 2/3
6. Deletar skill-avaliadora v1 + limpa geral do repo (código morto: chartProgressao em laudo-pago, demais funções não-chamadas, fixtures antigas)
7. Teste fim-a-fim: diagnóstico → anúncio gratuito → termo de adesão → admin cria anúncio → interesse comprador → NDA → acesso aos detalhes
8. IA atendimento home: ensinar a passar valor sugerido via conversa
9. IA atendimento home: obrigar a coletar telefone antes de entregar resultado
10. Testar notificações e fluxos WhatsApp (Z-API + Twilio)
11. Testar plataforma admin e fazer mudanças
12. Testar plataforma marketing/conteúdo/scrapings
13. Testar e recriar plataforma do parceiro sócio + ajustar flow de vincular
14. Design geral do portal — todas as páginas públicas
15. Testar checkouts (Stripe — 99/588/397)

## REGRAS

- main = produção via Vercel = www.1negocio.com.br
- Fonte única de dados de exibição: laudos_v2.calc_json
- Cadeia: diagnóstico (negocios) → skill v2 → calc_json → laudos visuais
- v2 ganha — não retroceder pra parecer com v1
- Briefings curtos, uma demanda por briefing
- pbcopy ao final de TODOS os briefings pro Claude Code
- NÃO confiar no relatório textual quando algo crítico for relatado — abrir código e verificar
- Maquininha (scripts/testar-diagnostico.js) substitui cadastro manual em produção pra testes
- ANTHROPIC_API_KEY é secret Supabase, NUNCA pedir nem colar em chat

## COMMITS DA SESSÃO 29/04/2026 — laudo-pago port

- 8ad24a5: SECOES + Fix 3/4/5/8 (anterior)
- 919fec6: backup laudo-pago-v1backup.html  
- 16c1558: port modelo v1 -> v2

