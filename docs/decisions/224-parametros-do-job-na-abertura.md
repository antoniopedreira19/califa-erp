# 224 — O financeiro edita os parâmetros do job na abertura

**Data:** 2026-10-28
**Status:** implementada em 28/10/2026; revista no mesmo dia (também depois da abertura).
**Quem decidiu:** Tiago. Pedido em 27/10/2026, com o print da linha de
parâmetros da versão internacional: "Quero que esses campos possam ser
acessados e editados pelo financeiro no momento da abertura do job (assim
como podem alterar a interna). Isso deve ser possível, não apenas nos casos
internacionais, [...] mas em qualquer caso." Protótipo aprovado no mesmo dia
(https://claude.ai/artifact/KazzTnoUX5e5nTYgFjYN5P).
**Revê:** a [206](206-excecao-no-fechamento-do-internacional.md) na fila da
abertura: lá, int. taxes, Impostos BR e custo de transação passam a ser
editados também pelo financeiro, sem a Exceção do administrador.
**Irmã de:** a [115](115-o-financeiro-edita-o-orcado-do-job.md) (o "Editar
orçado"): mesma permissão, mesma função de gravação, mesmo histórico.
**Migrations:** `20261027980001_parametros_do_job.sql` e
`20261028400001_parametros_do_job_depois_da_abertura.sql`.

## O que se edita

Na Planilha Interna de "Abrir job no financeiro", embaixo de "Planilha do
job · …", entra a mesma linha do cabeçalho da versão no orçamento:

| Modelo | Campos |
|---|---|
| Nacional e mensal | Honorários · Impostos (a lista de alíquotas do orçamento) |
| Internacional | Fee · Int. taxes · Impostos BR · Int. transaction costs; e, na linha de baixo, Moeda · Data da cotação · Cotação (compra e venda saem da cotação, −0,20 e +0,20) |
| Mídia Off | Honorários + base (do negociado / do líquido do veículo) · Veículo · Impostos |

Quem edita: quem tem `jobs.editar_orcado_financeiro` (administrador e
financeiro). A produção não vê a linha.

## As respostas do Tiago (27/10/2026)

1. **Grava no job.** A versão aprovada fica como o cliente aprovou. O
   retrato inteiro dos parâmetros passa a morar em `jobs_parametros` (1:1
   com `jobs`); sem linha, o job segue a versão aprovada.
2. **Confirmação A:** a linha abre com Salvar e Cancelar, e o Salvar abre um
   pop-up com o de → para de cada campo, o impacto no faturamento previsto,
   nos impostos e no valor do job, e o **motivo obrigatório**. Ele recusou o
   motivo como campo na própria linha e, no pop-up, o aviso "vale na hora,
   sem aprovação" ("está implícito").
3. **Internacional:** o financeiro edita também int. taxes, Impostos BR e
   custo de transação — sem passar pela Exceção do administrador (206).
4. **Depois da abertura, só o câmbio** continua editável (no internacional).
   Honorários, impostos e taxas ficam com o cadeado: travam na abertura. O
   câmbio não muda conta em reais, só a coluna da moeda.

## O que acompanha

- Na fila: `jobs.valor_total`, `faturamento_previsto` e a foto da abertura
  (`valor_job_abertura`, `faturamento_previsto_abertura`) — o job abre com o
  valor novo, como na 115 §10. O formulário da aba Abertura do Job lê os
  números novos e as parcelas de recebimento e os recolhimentos de imposto já
  preenchidos andam na proporção.
- Toda leitura de job que usa os percentuais passa a usar os do job: a conta
  dos espelhos (`lib/data/espelhos-do-job.ts`), o imposto previsto da
  abertura, a planilha e os Totais, o envio para faturamento (único, mensal e
  em lote), a exportação interna, a errata, a visão agregada de jobs do
  projeto e as views `vw_job_rentabilidade` e `vw_saves_por_job`. No TS, por
  `SELECT_PARAMETROS_DO_JOB` + `comParametrosDoJob`
  (`lib/data/parametros-do-job.ts`); no banco, por `vw_parametros_do_job`.
- O registro vai para **Alterações do Financeiro** (aba Informações do Job),
  como "Parâmetros do job", com o de → para. O selo "Alterado na abertura"
  da linha mostra o mesmo. A alteração só de parâmetros não aparece no
  Histórico da planilha (decisão 186): não muda linha nenhuma.

## Travas

- A action (`alterarParametrosDoJob`) e a função
  `registrar_alteracao_do_financeiro` recusam, depois da abertura, qualquer
  mudança que não seja o câmbio; e fora da janela (devolvido, cancelado,
  encerrado, finalizado), qualquer mudança.
- Fora do internacional, a alíquota de impostos sai da lista fechada de
  `lib/impostos.ts`, como no orçamento.

## Fora, de propósito

- Nada foi copiado para os jobs que já existem: sem linha em
  `jobs_parametros`, vale a versão aprovada, a mesma leitura de antes.
- A tela da versão no orçamento não mostra a alteração do job.

## ⚠️ Revisão de 2026-10-28 — também depois da abertura

Pedido do Tiago (28/10/2026): "Quero que os campos de fee e impostos e etc.
possam ser modificados depois da abertura pelo financeiro também. Assim como
os de câmbio. (não só no internacional, mas em qualquer tipo)". Escolha dele
entre as duas leituras: **as regras do "Editar orçado"** (decisão 115).

- Com o job aberto, honorários/fee, impostos e as taxas do internacional se
  editam **até a primeira nota emitida** (no mensal, qualquer mês com nota:
  os parâmetros mexem em todos os meses) **ou o encerramento**. Com nota, os
  campos ficam com o cadeado e o motivo na dica; o câmbio do internacional
  segue editável até o encerramento, porque não muda conta em reais.
- Acompanham como na 115 (P3, P4): a previsão de recebimento (no mensal, mês
  a mês), os recolhimentos de imposto e o envio para faturamento ainda sem
  nota, cada parcela na proporção dela e com a mesma data. A foto da
  abertura (`valor_job_abertura`) não muda depois da abertura.
- A função `registrar_alteracao_do_financeiro` perdeu a recusa "depois da
  abertura só o câmbio muda" (migration
  `20261028400001_parametros_do_job_depois_da_abertura.sql`); a trava da
  nota fica na action, como no "Editar orçado", e a parcela do envio que
  virou nota continua recusada pela função.
- Teste: TES-1036/26 aberto, fee 13 → 14%: valor do job e faturamento
  R$ 54.109,67 → 54.583,65; a parcela de recebimento e o recolhimento de
  imposto acompanharam (impostos R$ 10.619,67 → 10.713,65); a foto da
  abertura ficou em R$ 54.109,67. TES-1029/26 (nacional, sem nota) abre o
  "Editar" e o pop-up (sem gravar); TES-1001/26 (com nota) mostra o cadeado.

## ⚠️ Revisão de 2026-10-30 — os parâmetros entram no "Editar planilha"

Com o "Editar planilha" (decisão 115, §13), os parâmetros abrem junto com a
planilha e perdem o "Editar" e o "Editar câmbio" próprios; um pop-up só
grava linhas e parâmetros. Com o job aberto, nada acompanha sozinho: a aba
Abertura do Job revisa as previsões e grava junto. A Mídia Off (sem "Editar
planilha") e a planilha travada pela nota seguem com os botões próprios e
`alterarParametrosDoJob`.
