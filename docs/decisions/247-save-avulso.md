# 247 — Save avulso: o save faturado sem job, crédito do cliente

**Data:** 2026-11-09
**Status:** aceita e implementada em 09/11/2026.
**Quem decidiu:** Tiago, de 03 a 09/11/2026, sobre o protótipo interativo
"Save Avulso" (telas reais, dados fictícios), aprovado na versão 8:
https://claude.ai/artifact/9BCJA12mG18xN5rp7fib9P.
**Estende:** a [028](028-save-entre-jobs.md) (o save é do cliente e vale em
qualquer job dele), a [154](154-save-do-orcamento-inteiro.md) (o orçamento
inteiro consome um saldo) e a [155](155-save-aprovado-na-abertura.md) (o
consumo é aprovado na abertura). Abre uma exceção na
[086](086-a-nota-avulsa-nasce-com-rateio-de-regional.md): a nota do save avulso não
leva rateio de regional.
**Migrations:** `20261109940001_save_avulso.sql` e
`20261109940002_save_avulso_sem_rateio.sql`, aplicadas pelo MCP em
09/11/2026.

## O problema

O cliente às vezes paga agora por um serviço que ainda não tem job. Até
aqui, o save só nascia de uma linha de orçamento ou de job: sem job, a nota
saía como avulsa comum e o crédito do cliente ficava fora do sistema.

## A regra

1. **Faturar → "Save avulso"**, entre "Referente a um job" e "Sem job".
   - Seção 1: cliente, empresa (gerencial) e **Nome do save** (obrigatório),
     que é como o save aparece em todas as telas. Faixa "Save de {cliente}
     · Valor do crédito · Regional: a do job que consumir". Nº e anexo da
     PO opcionais. Sem rateio de regional.
   - Seção 2: Valor total da NF | **Honorários (%)** (nasce com o padrão do
     cadastro do cliente, editável) e **Imposto (%)** (as alíquotas de
     `ALIQUOTAS_IMPOSTO`; hoje só 19,53%). Embaixo, o **Crédito do cliente**
     ao lado do **Centro de custo 01 · Receita** e do **Subtipo Save**, os
     dois travados. O subtipo "Save" (001) é novo e só aparece aqui.
2. **O crédito é o principal da nota**, como o saldo de save de um job:
   `NF × (1 − imposto) ÷ (1 + honorários)`. NF de R$ 12.000,00 com 12% e
   19,53% → R$ 8.621,79. O banco grava o mesmo número
   (`saves_avulsos.credito`, coluna gerada).
3. **Vale assim que a NF é emitida.** Quem fatura é o financeiro: não há
   aprovação do crédito. NF cancelada não oferece saldo, e a NF cujo save
   já foi consumido não se cancela.
4. **Qualquer job do mesmo cliente consome**, aos poucos, em várias linhas e
   vários jobs, até zerar.
5. **O consumo segue o save de hoje:** na planilha, o save avulso aparece na
   lista de saldos ao lado dos jobs ("Save avulso · faturado sem job"); o
   orçamento inteiro pode consumi-lo ("Consumir um saldo do cliente…"). O
   rascunho reserva e não segura saldo (028); a versão aprovada e a linha do
   job seguram; o pedido é aprovado com a abertura do job (155). A linha que
   consome sai do faturamento do job e entra no valor do job (028).
6. **Contas a Receber → "Créditos de save":** uma lista por cliente, com o
   save avulso e os saves de jobs (Crédito, Consumido, Reservado, Saldo). O
   cliente expande nas origens; o ícone de cada origem abre "Onde o save foi
   consumido". Os jobs vão pelo **nome do financeiro**, nunca pelo código.

## Onde a regra mora

| Onde | O quê |
|---|---|
| `saves_avulsos`, `vw_saves_avulsos` | O crédito (um por nota) e o saldo dele |
| `saves_consumos.save_avulso_id` | A segunda origem do consumo (`chk_save_consumo_uma_origem`: job **ou** save avulso) |
| `versoes_orcamento.save_consumo_avulso_id` | O orçamento inteiro que consome um save avulso |
| `emitir_faturamento_save_avulso` | Emite a nota e registra o save avulso numa transação só |
| `save_avulso_uso_linhas`, `save_avulso_disponivel` | A mesma conta de `save_uso_linhas` e `save_disponivel_do_job` |
| `save_normalizar_origens` | A forma canônica das origens nos pedidos (`job_origem_id` **ou** `save_avulso_id`) |
| `save_consumo_valida`, `save_pedir`, `decidir_pedido_save`, `save_reverter_pedido`, `save_origens_da_linha` | Reconhecem as duas origens |
| `versao_save_consumir_avulso`, `save_modo_*` | O orçamento inteiro |
| `trg_save_avulso_trava_cancelamento` | A NF com save consumido não se cancela |
| `exige_rateio_nota_avulsa` | A nota do save avulso fica sem rateio |
| `lib/data/saves.ts` | Saldos, origens das linhas e dos pedidos (`origensParaOBanco`, `rotulosDasOrigens`) |
| `contas-a-receber/faturar-drawer.tsx`, `actions.ts` | O Faturar |
| `contas-a-receber/creditos-de-save.tsx`, `dados-creditos-de-save.ts` | A aba nova |

## O que ficou de fora, de propósito

- **A receita do save avulso não migra para o job que consome** na
  `vw_job_rentabilidade` nem na `vw_fluxo_caixa`, que fazem isso para o save
  de job (028 §4, 103). As duas views são relatórios de outra frente; o job
  que consome um save avulso mostra nelas o faturamento sem a parte paga
  pelo crédito. Pede decisão do Tiago.
- **Regional:** a receita da nota de save avulso não tem regional nos
  relatórios por regional até ser consumida.
- **A nota sai como avulsa** (item `avulso`), e não como item `save`: o item
  `save` é a parte de save da nota de um job, e o fluxo de caixa, o rateio da
  102 e a rentabilidade da 103 leem a origem dele como o job.

## Como foi conferido (09/11/2026)

Pela tela, no tenant de teste: NF **TESTE-247** (Empresa Teste, cliente
Teste) de R$ 12.000,00, 12% e 19,53% → crédito R$ 8.621,79, gravado em 01 ·
Receita · Save, sem rateio, com um título. No P-0006/26 · Teste, a linha
"Gerente de Projetos" do "ZZ Teste 154 save inteiro" consome R$ 5.000,00 e
o "ZZ Teste 148 importação" inteiro consome R$ 6.800,00, os dois em
rascunho; o Contas a Receber mostra o save avulso com R$ 11.800,00
reservados e o saldo inteiro, e o pop-up lista os três consumos.
**Não conferido pela tela:** a aprovação da versão e a abertura do job com
consumo de save avulso, e a errata de save no job aberto.
