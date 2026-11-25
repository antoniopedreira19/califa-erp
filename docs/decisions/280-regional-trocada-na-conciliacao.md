# 280 — A regional trocada na linha da conciliação, como o centro de custo

**Data:** 2026-11-25
**Status:** aceita e implementada em 25/11/2026.
**Quem decidiu:** Tiago, no pedido de 23/11/2026 e nas duas respostas de
25/11/2026 (com os números de produção abaixo).
**Relaciona-se com:** [069](069-a-regional-do-job-e-a-fonte.md) (a regional
do job é a fonte; o rateio só existe onde não há job), [262](262-conciliacao-acertar-e-conciliar.md)
(o centro de custo trocado na linha), [272](272-recorrencias-lista-unica-e-conta-que-varia.md)
(o TD da recorrência pela tabela da empresa) e [247](247-save-avulso.md)
(a nota do save avulso fica na regional do job que consumir).

## O pedido

Na Conciliação automática, trocar a regional (coluna Reg) no momento da
conciliação, do mesmo jeito que o Tipo e o Subtipo: as regionais da empresa
do lançamento e o **TD**, o rateio definido na tabela da empresa (como o
colaborador TD do RH).

## Os números (produção, baixas desde 01/10/2026)

| De onde vem a regional | Baixas |
|---|---|
| PP (o job) | 408 |
| Nota a receber (o rateio da nota avulsa ou o job) | 72 |
| Avulso e recorrência (o rateio do avulso) | 64 |
| Manual e regra do extrato (a própria baixa; sem regional = TD) | 103 |
| Transferência, mútuo, devolução | 250 |

A regional **não mora na baixa**: a `vw_fluxo_caixa` e o Extrato a tiram do
documento (o job, o rateio do avulso, da nota avulsa, do desembolso) e, só no
que não tem documento, da própria baixa.

## O que foi decidido

1. **O que é de job não troca.** PP, estorno de verba, nota de job,
   recebimento antes da NF e qualquer baixa com job ficam na regional do job,
   100% (a 069 continua valendo). A célula mostra a regional com a dica
   "a regional é a do job X; para trocar, troque a regional do job".
2. **No que não tem job, a troca grava no documento** (e não só no
   pagamento): Títulos, Fluxo e DRE passam a mostrar a nova regional, e o
   previsto e o realizado continuam iguais.

| Lançamento | Onde a troca grava |
|---|---|
| Avulso, recebimento avulso, rendimento | `contas_avulsas_regionais` (o título inteiro) |
| Recorrência | o avulso desta ocorrência (a recorrência fica como está) |
| Nota avulsa a receber | `faturamentos_regionais` (a NF inteira) |
| Desembolso | `desembolsos_regionais` |
| Baixa manual / de regra | `lancamentos_financeiros.regional_id` (TD = sem regional, como a tarifa) |
| Linha da planilha ainda sem banco | `historico_movimentos` (TD = `regional_todas`, como a planilha escreve) |

3. **As opções** são as regionais ativas da empresa do lançamento (as mesmas
   que o formulário do avulso oferece) e o **TD** quando a empresa tem a
   tabela de rateio completa (hoje: Agência California NE 25 · NO 20 · RJ 25 ·
   SP 30; CCH Agency 50 · Doca 50). Hitlab e Ventura têm uma regional só e
   não têm TD.
4. **O TD é copiado da tabela** do ano da data do lançamento (ou do último
   antes dele), como a recorrência TD da 272. Se a tabela mudar depois, o
   documento fica com o rateio que tinha.
5. **Não trocam:** folha (a regional vem da alocação no RH), notas de sócio,
   nota do save avulso (247), imposto (o rateio vem da apuração), fatura do
   cartão (cada compra tem a dela), transferência e mútuo (sem regional).

## Como funciona

- A célula Reg vira um campo de busca, como o Subtipo, nas três tabelas da
  Conciliação automática (o lançamento na linha, a sugestão e o Só no
  sistema). A lista diz onde a troca vai gravar ("Ao conciliar, a regional
  muda no avulso (o título inteiro)").
- A escolha é rascunho, guardada em `conciliacao_regionais` (como
  `conciliacao_centros`): sobrevive a recarregar a página e outra pessoa do
  financeiro continua. Voltar à regional do documento tira o rascunho.
- No **Conciliar** (da linha ou "Conciliar tudo o que foi acertado"), antes
  da baixa e da ligação, `trocar_regional_pela_conciliacao` grava no
  documento. As travas são do banco: job, folha, notas de sócio, save avulso,
  imposto, fatura, transferência; linha da planilha já conciliada; período
  fechado em qualquer baixa do documento (`_exige_periodo_aberto`). Cada
  documento trocado gera auditoria `*.regional_alterada` (de/para).

## Banco

Migration `20261125600001_regional_na_linha_da_conciliacao.sql` (aditiva):
tabela `conciliacao_regionais` (RLS, só leitura direta para admin e
financeiro) e as funções `salvar_regional_da_conciliacao`,
`trocar_regional_pela_conciliacao` e a interna
`_rateio_da_regional_escolhida`.
