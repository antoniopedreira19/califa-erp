# 167 — Job da Mídia Off, entrega 2: abrir e faturar por mês, e o último envio encerra o job

**Data:** 2026-10-13
**Status:** aceita e implementada (13/10/2026).
**Quem decidiu:** Tiago, em 07 e 13/10/2026, sobre o plano do job em quatro entregas e o protótipo da entrega 2 (https://claude.ai/artifact/FrKQYCiCbjGtPyQ2TAveyR).
**Continua:** a [147](147-planilha-midia-off.md) (a planilha e a conta da mídia, até a aprovação) e a [150](150-cadastro-de-veiculos.md) (o veículo).
**Segue o modelo de:** a [078](078-orcamento-mensal-fee-e-always-on.md) e a [149](149-envio-para-abertura-por-tipo-de-job.md) (Fee e Always On: um envio de faturamento e uma data de recebimento por mês).
**Migrations:** `20261013500001_job_da_midia_off_guarda_o_veiculo.sql`, `20261013500002_rentabilidade_da_midia_off.sql` e `20261013500003_resultado_sem_custo_da_midia_off.sql`.

## O que aconteceu

Até a 147 o orçamento de Mídia Off ia só até a aprovação: "Enviar Job para
Abertura" ficava travado, porque o job gravaria o fechamento nacional
(honorários e imposto por cima dos custos) no lugar da conta da mídia. O
Tiago descreveu o ciclo da mídia:

```text
orçamento na planilha → aprovação do cliente → abertura do job no financeiro
→ AP e PI (gerados por fora, anexados no sistema) → veiculação
→ faturamento e encerramento (o job encerra logo depois do faturamento)
```

O job foi dividido em quatro entregas: **2 · abrir e faturar** (esta),
**3 · PP do repasse** (as linhas em A · Repasse, a nota do veículo e o
pagamento), **4 · AP e PI por veículo e mês** e **5 · errata e cancelamento
da veiculação** (campanha cancelada antes do fim cobra só os dias
veiculados). A 2 sobe sozinha (Tiago, 07/10/2026, opção 1a).

## A regra

1. **Envio para abertura igual ao do Fee e do Always On.** Início e fim
   vêm do período da campanha e não mudam no envio; a Data Evento fica
   "Não se aplica" (Tiago, opção 2a); o recebimento é uma data por mês da
   campanha que tem faturamento — até 24 meses, o teto da campanha (147).
2. **A conta é a da mídia em todo lugar do job** (`lib/calculos/midia-off.ts`):
   - valor do job = Σ (veículo + honorários);
   - faturamento previsto = honorários + notas dos veículos em A · Repasse;
   - imposto = alíquota × honorários (sai de dentro dos honorários);
   - custo planejado = as notas de todos os veículos.
   O envio grava `valor_total`, `faturamento_previsto` e os dois `_abertura`
   por essa conta, e o reenvio do job devolvido também
   (`lib/data/espelhos-do-job.ts`). A mídia não tem save.
3. **Abertura no financeiro.** Custo previsto = as notas dos veículos em
   A · Repasse, que a California paga ("Notas dos veículos em A · Repasse,
   que a California paga — no A · Direto o veículo cobra do cliente");
   impostos previstos = alíquota × honorários ("… sobre os honorários");
   uma parcela de recebimento por mês. A aba Planilha Interna mostra a
   planilha da mídia.
4. **Página do job.** A Planilha Interna é a planilha da mídia, só leitura,
   com a régua "Meses do job" e a situação de cada mês. O cabeçalho mostra
   o valor do job e o resultado planejado pela conta da mídia; o realizado
   fica "—" até a entrega 3.
5. **Faturamento por mês, depois da veiculação do mês** (Tiago, 07/10/2026).
   Cada mês só vai ao faturamento **no dia seguinte à última veiculação das
   linhas dele** (aprovado em 13/10/2026): o maior dia com inserção nas
   linhas de grade, ou o maior fim de período nas linhas por período — que
   pode cair no mês seguinte, porque a linha que cruza o mês entra inteira
   no mês em que começa (147). Antes disso o mês aparece "Em veiculação",
   com a data em que o envio libera. O servidor confere a data de novo no
   envio (`enviarJobParaFaturamento`).
6. **O envio do último mês encerra o job junto** (Tiago, 07/10/2026; um
   botão só). Quando falta um mês só, o botão vira "Enviar {mês} e encerrar
   o job", e o envio só passa sem pendência de encerramento — a mesma régua
   do "Enviar para encerramento". A trilha "Encerramento" da Mídia Off não
   tem botão: mostra as pendências, ou "Nenhuma pendência: o job encerra
   junto com o envio do último mês". Com todo o faturamento enviado, o banco
   grava `finalizado`. Se o encerramento falhar depois do envio (alguém
   emitiu uma PP entre as duas conferências), o envio fica e a trilha volta
   a mostrar o botão de encerrar.
7. **Consequência aceita (Tiago, 13/10/2026, opção a):** linha em
   A · Repasse sem a PP do repasse é pendência de encerramento ("N linhas
   A · Repasse sem a PP do repasse"). Até a entrega 3, um job com Repasse
   abre e fatura, mas **não envia o último mês**. Job só com A · Direto
   fecha o ciclo nesta entrega.
8. **O que o job de Mídia Off ainda não tem**, travado na tela e no
   servidor: errata (entrega 5), "Editar orçado" do financeiro (entrega 5),
   PP (entrega 3) e a exportação da planilha interna do job.
9. **Custo realizado** (Tiago, 13/10/2026, "Nota do veículo"): no
   A · Direto, a nota do veículo — o mesmo critério do A nacional, que
   espelha o planejado; no A · Repasse, as PPs do repasse (zero até a
   entrega 3). Vale no cabeçalho do job e na visão agregada do projeto, onde
   o planejado da linha também é a nota.
10. **Relatório de Rentabilidade** (Tiago, 13/10/2026, "Conta da mídia";
    migration `20261013500002`): imposto previsto = alíquota × honorários;
    imposto realizado = a mesma conta nos meses já enviados; custo = as PPs
    do repasse — o A · Direto fica fora do custo, como já fica fora do
    faturamento. A conta dos outros modelos não mudou (as 59 linhas não-mídia
    da view conferidas iguais, antes e depois).

## No código

- Envio: `orcamentos/.../abertura-actions.ts` (conta da mídia, datas,
  recebimento por mês, cópia das colunas da mídia para `jobs_itens_orcado`)
  e `fluxo-abertura.tsx` (o botão destravado).
- Faturamento por mês: `faturamento-por-mes.ts` (situação `em_veiculacao`
  e `ultimaVeiculacao`), `lib/data/faturamento-mensal.ts`,
  `jobs/[jobId]/actions-faturamento.ts` (`conferirEnvioDoMesDaMidia`, o
  encerramento depois do envio).
- Barra e trilha: `barra-faturamento-mensal.tsx`, `barra-acoes-job.tsx`
  (`pendenciasDoEncerramento`), `enviar-faturamento-dialog.tsx`,
  `enviar-encerramento-dialog.tsx` (o "Ver envio" mostra os Totais da
  campanha).
- Planilha do job: `realizado/planilha-midia-do-job.tsx`, com o modo
  `doJob` da `PlanilhaMidiaOff`; `carregar-detalhe.ts` monta as linhas.
- Financeiro: `abertura-de-job/actions.ts`, `aprovacao-save.ts`,
  `imposto-previsto.ts`, `[jobId]/page.tsx` e `abertura-form.tsx`.
- Leituras comuns: `lib/data/midia-do-job.ts` (`lerMidiaDoJob`,
  `lerUltimaVeiculacaoDoMes`, `lerFechamentoMidiaDoJob`,
  `travaDoJobDeMidia`).
- Visão agregada do projeto: os totais do job de mídia pela conta da mídia
  (`carregar-planilhas.ts`).

## Banco

`20261013500001`: `jobs_itens_orcado` ganha as colunas da linha da mídia
que a versão já tinha — `fornecedor_id` (o veículo), `praca`, `peca`,
`formato`, `insercoes_por_dia`, `data_inicio`, `data_fim`,
`unidade_periodo`, `valor_unitario_tabela`, `percentual_desconto`,
`detalhe` —, com as mesmas checagens e um índice parcial no veículo. Sem
elas a cópia do job não sabia o veículo nem a veiculação. Mudança aditiva;
nulas fora da Mídia Off.

## Conferido no navegador (13/10/2026)

- `TES-P001/26-21 · ZZ Teste Mídia Off 147` (v2, novembro e dezembro de
  2026, com A · Repasse) virou o job **TES-1026/26**: envio com período
  travado, Data Evento "Não se aplica", recebimento de novembro
  (R$ 1.601,60) e de dezembro (R$ 18.080,00); abertura no financeiro com
  custo previsto R$ 16.000,00, impostos R$ 719,02 e rentabilidade
  R$ 2.962,58; página do job com os dois meses "Em veiculação" (novembro
  até 10/11, dezembro até 31/12) e a pendência da PP do repasse.
- Recusas do servidor, chamando as actions direto: envio de novembro em
  veiculação, envio sem mês, errata e PP no job de mídia.
- `TES-P001/26-34 · ZZ Teste Mídia Off 167 encerra` (agosto e setembro de
  2026, só A · Direto, criado pelas telas) virou o **TES-1027/26**: agosto
  enviado (R$ 240,00); setembro como "Enviar setembro e encerrar o job"
  (R$ 600,00); o job ficou `finalizado`, com "Encerrado com o envio do
  último mês" e os Totais da campanha no "Ver envio".

- Depois das decisões 9 e 10: o cabeçalho do TES-1027/26 mostra o
  realizado R$ 675,95 (10,5%), igual ao planejado; a agregada, planejado e
  realizado R$ 5.600,00 no TES-1027/26 e realizado R$ 12.320,00 (só as
  notas do A · Direto) no TES-1026/26; a view, imposto R$ 164,05 e custo 0
  no TES-1027/26.
- Depois da decisão 11: no relatório de Rentabilidade, o TES-1027/26
  mostra faturamento R$ 840,00, resultado R$ 675,95 e 80,5%; o TES-1026/26
  segue com "—" (tem Repasse e ainda não tem PP).

## O relatório de Rentabilidade e o "—" (13/10/2026)

11. O relatório só mostrava resultado com custo
    (`calcularResultadoOperacional`: custo zero dá "—"). Com o A · Direto
    fora do custo, o job de mídia só com A · Direto ficava sempre com "—".
    O Tiago escolheu (opção 1): **manter a regra do relatório também na
    mídia** — resultado ÷ faturamento, a base que a spec do relatório
    (`docs/superpowers/specs/2026-08-28-relatorio-rentabilidade-design.md`,
    §3.2) usa para todos os jobs — e mostrar o resultado mesmo sem custo no
    job de Mídia Off **sem A · Repasse**. Com Repasse, o "—" segue até a PP
    do repasse. Migration `20261013500003` (coluna `resultado_sem_custo` na
    view) e `computarResultado` (`lib/relatorios/rentabilidade.ts`).
    - O resultado em R$ é o mesmo da página do job (R$ 675,95 no
      TES-1027/26); o percentual muda pelo divisor: 10,5% na página do job
      (÷ valor do job), 80,5% no relatório (÷ faturamento). O Tiago vai
      revisar a base do relatório quando tratar dos relatórios.

## Para conferir depois

- **A base do % do relatório** (faturamento × valor do job) — o Tiago
  revisa quando tratar dos relatórios.
- **Relatório nacional com A · Direto:** o R$ do relatório fica abaixo do
  da página do job pelo principal do A · Direto, que a view tira do
  faturamento mas mantém no custo (DEE-1001/26: R$ 336.000), contra a §3.2
  da spec do relatório. É do relatório do Antonio; levado ao Tiago em
  13/10/2026, sem mudança.
- **BV no A · Direto da mídia** — pedido do Tiago em 13/10/2026; fica para
  a entrega 3 (PP do repasse), com protótipo antes, decidindo também se o
  BV trava o encerramento junto com o último mês.
- A exportação da planilha interna do job de mídia.
