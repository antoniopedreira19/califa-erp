# Módulo RH · Folha Mensal — Rodada 3 (2026-09-18)

Folha mensal ponta-a-ponta ficou de pé. RH gera folha, edita, envia; financeiro revisa em aba nova "Folhas de Pagamento" (dentro de `/financeiro/contas-a-pagar`, entre Recorrências e Títulos a Pagar), pode ajustar valor/alocação e aprovar — aprovação gera N `contas_avulsas` rateadas por alocação e some da aba Folhas, aparecendo em Títulos a Pagar. Reprovação com motivo obrigatório volta linha pra RH em `pendente_correcao`. Ao aprovar com edição, o valor/alocação novos propagam pra Camada 1 (`colaboradores_salarios` e `colaboradores_alocacoes` fecham vigente e abrem novo) — próxima folha nasce já com o corrigido.

## O que entrou

- Aba nova "Folhas de Pagamento" em `/financeiro/contas-a-pagar`, entre Recorrências e Títulos a Pagar.
- Actions RH: `enviarLinhaFolha`, `enviarFolhaInteira`.
- Actions financeiro: `aprovarLinhaFolha`, `reprovarLinhaFolha`.
- `contas_avulsas` ganhou coluna `folha_id` para rastreabilidade + idempotência.
- Propagação de edição na aprovação: `colaboradores_salarios` e `colaboradores_alocacoes` fecham vigente e abrem novo com o valor corrigido.

## Migrations aplicadas

```
20260918000001_rh_folha_mensal.sql        (estrutura, já da R1/R2)
20260918000002_contas_avulsas_folha_id.sql (rastreabilidade + idempotência)
```

## Docs / ADRs relacionados

- `docs/decisions/093-*.md` (folha mensal rodada 3)
- `docs/modulos/rh/20-folha-mensal.md`

## Commits relevantes

- `b5d4e83` — ui(rh): renomeia card do hub para "Folha de Pagamento"
- `f59fe48` — feat(rh,financeiro): folha mensal — envio, aprovação e geração de títulos (rodada 3)
- `5a1730e` — ui(financeiro): status de PP e desembolso em uma linha só nas tabelas de contas a pagar
- `6df7167` — docs(rh): ADR 088, estado das rodadas na spec da folha, HANDOFF atualizado

## Pontos de atenção pra próxima sessão

- Ver ADR 093 para o modelo completo. Fluxo de propagação Camada 2 → Camada 1 tem que ser reafirmado em qualquer feature nova que toque em salário ou alocação.
