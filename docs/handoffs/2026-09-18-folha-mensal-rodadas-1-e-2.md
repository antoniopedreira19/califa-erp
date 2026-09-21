# Módulo RH · Folha Mensal — Rodadas 1 e 2 (2026-09-18)

Subsistema de Folha Mensal em pé (R1: modelo + geração; R2: edição). RH gera folha por competência e edita valor e alocação de cada linha. Envio ao financeiro entra na Rodada 3 (arquivo separado). Aba dedicada em `/financeiro/contas-a-pagar` foi decidida em 18/09, posicionada entre "Recorrências" e "Títulos a Pagar".

## O que entrou

- Enum novo `folha_linha_status` (`rascunho, enviada, aprovada, pendente_correcao, paga`) com CHECK exigindo `motivo_pendencia` quando reprovada.
- `folhas_pagamento_alocacoes` com constraint trigger `DEFERRABLE INITIALLY DEFERRED` validando soma = 100.
- Helper `is_tenant_financeiro(uuid)` no padrão dos outros.
- `gerarFolha` idempotente: retorna lista de colaboradores pulados por falta de salário/alocação vigente — RH corrige e regera sem duplicar quem já entrou.

## Migrations aplicadas

```
20260918000001_rh_folha_mensal.sql
```

## Docs / ADRs relacionados

- `docs/modulos/rh/20-folha-mensal.md` (spec)
- `docs/decisions/088-folha-mensal-em-duas-camadas.md` (ADR)

## Commits relevantes

- `fa2ab44` — Rodada 1 (geração)
- `ac6ba2f` — Rodada 2 (edição)

## Pontos de atenção pra próxima sessão

- Ver Rodada 3 (arquivo `2026-09-18-folha-mensal-rodada-3.md`) para o envio ao financeiro e a integração com contas_avulsas.
