# 103 — O relatório de rentabilidade separa o save

**Data:** 2026-09-24
**Decidido por:** Tiago
**Migration:** `20260924100004_rentabilidade_separa_o_save.sql`

Aplica ao relatório as regras da [028](028-save-entre-jobs.md) §4 e da
[099](099-aprovacao-de-save.md) §3. A view `vw_job_rentabilidade` é da
frente de relatórios (Antonio); a mudança foi decidida pelo Tiago em
24/09/2026.

---

## 1. Os dois desvios

**Save contava como receita do job que o gera.** O imposto e o custo do
relatório já deixavam as linhas em save de fora, mas o faturamento
previsto e o realizado incluíam a parte de save, que é crédito do
cliente. Em 24/09/2026:

- JOB-0043 (job inteiro em save, crédito de R$ 5.000): resultado de
  R$ 6.959,12 e 100% de rentabilidade;
- JOB-0039: resultado de R$ 45.196,46, dos quais R$ 27.836,46 eram a
  parte de save.

**Pedido que aguarda já contava.** O relatório lia as linhas cruas:
enquanto um "gerar save" aguardava o financeiro, o imposto e o custo da
linha já saíam, e o faturamento seguia o número antigo.

## 2. A regra

- **Faturamento previsto** = faturamento previsto do job − parte de save
  + receita migrada dos saves que o job consome.
- **Faturamento realizado** = soma dos envios ao faturamento − parte de
  save dos envios + receita migrada que a origem já enviou.
- **Receita migrada** (028 §4): o faturamento cheio da linha em save
  (principal + honorários + imposto) sai do job que gera e vai para o que
  consome, na proporção do consumo. É a mesma conta do fluxo de caixa:
  `consumo ÷ principal em save da origem × faturamento de save da origem`.
  No realizado, vale na proporção do save que a origem já enviou ao
  faturamento: só migra dinheiro que existe.
- As linhas são lidas **como o financeiro vê**
  (`vw_itens_orcado_financeiro`): um pedido que aguarda não muda nada até
  a aprovação.

Imposto e custo seguem as fórmulas de antes. O imposto realizado é
calculado sobre o faturamento realizado já ajustado.

## 3. Como foi conferido (24/09/2026)

- **Jobs sem save:** nenhuma diferença entre a view antiga e a nova.
  Das 10 linhas do relatório, as 6 que mudaram têm save ou pedido de
  save.
- **Jobs de teste:**

| Job | Faturamento previsto antes | Depois | Valor do job (conferência) |
|---|---:|---:|---:|
| JOB-0043 (tudo em save) | 6.959,12 | 0,00 | 0,00 |
| JOB-0039 (gera save) | 49.409,72 | 21.573,26 | 21.573,26 |
| JOB-0040 (gera e consome R$ 1.000 do JOB-0032) | 19.485,52 | 6.959,11 | 6.959,12 |

O JOB-0039 fecha com a planilha: R$ 21.573,26 − R$ 4.213,26 de imposto
− R$ 12.000 de planejado = R$ 5.360, o resultado planejado do cabeçalho
do job. O centavo do JOB-0040 é arredondamento da proporção do consumo.
