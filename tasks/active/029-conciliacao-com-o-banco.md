## Task 029 — Conciliação com o banco (títulos, baixa, cartão, OFX e fechamento)

> **Status (21/10/2026):** desenho aprovado no protótipo; a implementação
> começa pela Fase 1.
>
> **Especificação completa:** `docs/handoffs/2026-10-21-conciliacao-com-o-banco/README.md`.
> **Protótipo** (referência visual e de comportamento): `docs/handoffs/2026-10-21-conciliacao-com-o-banco/prototipo/conciliacao-banco.html`.
> A versão a implementar é a **Alternativa**, com as escolhas da seção 2 da especificação.

## Objetivo

Levar para o sistema, exatamente como no protótipo:

1. as planilhas de títulos no formato do Extrato (Conciliação › Títulos,
   Contas a Pagar, Contas a Receber, Impostos a Pagar e o próprio Extrato);
2. o popup de baixa do sistema com juros e multa no boleto, forma PIX
   como padrão, caixas no lugar das chaves, fatura escolhida no cartão e
   cartão no lote;
3. o cartão no novo layout;
4. a importação do extrato OFX com o motor de correspondência, as seções
   da conciliação automática, a correção da baixa com motivo e o
   histórico no ⓘ;
5. o fechamento da conciliação (trava até reabrir).

## Fases

Cada fase é testada e publicada antes da próxima.

- **Fase 1:** planilhas de títulos e Extrato (só tela).
- **Fase 2:** popup de baixa e cartão (juros, fatura escolhida, lote no cartão).
- **Fase 3:** importação do extrato e conciliação automática.
- **Fase 4:** fechamento da conciliação.

## Decisões travadas

Seção 4 da especificação. Registrar como decisões numeradas: o próximo
número livre era 195 em 21/10/2026, e deve ser reservado antes.

## Critérios

- [ ] Cada fase: typecheck, lint, build e os testes `node --test` limpos.
- [ ] Cada fase: conferida no navegador contra o protótipo.
- [ ] Migrations no ciclo do `docs/FLUXO-BANCO.md`; os itens **[CONFIRMAR]** perguntados ao Tiago antes de aplicar.
- [ ] `lib/types.ts` atualizado junto de cada migration, com a divergência de `LancamentoFinanceiro` corrigida.
- [ ] Handoff retrospectivo em `docs/handoffs/` e linha no índice `docs/HANDOFF.md`.
- [ ] Task movida para `tasks/done/`.
