# 103 — O relatório de rentabilidade separa o save

**Data:** 2026-09-24
**Decidido por:** Tiago
**Migrations:** `20260924100004_rentabilidade_separa_o_save.sql` e
`20260924100007_rentabilidade_save_a_consumir.sql` (§4)

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

## 4. Save a consumir, e o Relatório de Faturamento (24/09/2026, mesma data)

**O save que ninguém consumiu ainda aparece no relatório.** Com a §2 ele
saía do job que o gerou e só entrava no job que o consome: enquanto
ninguém consumia, não aparecia em linha nenhuma, e o total do relatório
ficava menor que o faturado. O Tiago pediu uma linha por job de origem,
não uma por cliente:

- dentro de cada cliente (ou marca), depois dos jobs, uma linha
  **"Save a consumir · JOB-XXXX · nome"** para cada job com crédito ainda
  não consumido; na visão por Job, a linha fica embaixo do próprio job;
- o valor é `faturamento de save × (1 − consumido ÷ principal)` no
  previsto e a parte de save já enviada ao faturamento, na mesma
  proporção, no realizado. Somado à receita que já migrou para os
  consumidores, fecha com o faturamento de save de cada origem;
- **entra no Faturamento** do grupo e do total, que voltam a bater com o
  faturado. **Não entra no Result. Op nem no Rent %**, que continuam
  calculados só sobre os jobs. Uma nota embaixo da tabela explica;
- a representatividade (Rep %) é sobre o faturamento com o save; o
  filtro "Faturamento acima de" e a ordem dos grupos também;
- no comparativo, o faturamento do grupo inclui o save a consumir, sem
  linhas próprias.

No cliente Teste, em 24/09: grupo de R$ 855.848,13 (faturado R$
855.848,14, arredondamento), com seis linhas de save a consumir somando
R$ 77.246,18.

**O Relatório de Faturamento tinha mudado junto, e voltou.**
`/relatorios/faturamento` lê a mesma view e usava `faturamento_previsto`
e `faturamento_realizado` como "valor do job" e "valor faturado". Com a
§2 ele passou a mostrar os valores sem o save — que é cobrado na nota. O
JOB-0043 aparecia com R$ 0,00 a faturar, com nota de R$ 6.959,12. A view
ganhou `faturamento_previsto_bruto` e `faturamento_realizado_bruto`, os
valores de antes, e o Relatório de Faturamento lê esses.
