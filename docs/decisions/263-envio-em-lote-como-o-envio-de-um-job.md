# 263 — O envio em lote parecido com o envio de um job: cada nota num cartão, os jobs marcados na própria nota

**Data:** 2026-11-16
**Status:** aceita e implementada em 16/11/2026.
**Quem decidiu:** Tiago, sobre o protótipo interativo do envio em lote (oito
rodadas comentadas no próprio protótipo, 16/11/2026), com "Pode implementar.
Está aprovado". O pedido: "aproximar esse formulário do formulário de envio
individual, para que os usuários não precisem lidar com formulários muito
diferentes para fazer, essencialmente, a mesma coisa", pensando em quem
"sabe apenas fazer o envio do faturamento do job".
**Revê:** [188](188-envio-em-lote-para-faturamento.md) (regras 2, 3 e 5 e a
tela do pop-up).
**Relacionadas:** [123](123-o-envio-para-faturamento-vira-notas-fiscais.md) (o
envio de um job em notas fiscais, com parcelas), [184](184-faturar-drawer-que-abre-a-nota-e-cnpj-do-tomador.md)
(tomador no exterior).
**Migration:** nenhuma. O banco já guardava o CNAE e os vencimentos de cada
nota do lote; muda o que o envio grava.

## O problema

O pop-up do lote (188) era outro formulário: os jobs em cartões coloridos no
topo, as notas numa tabela com o "Rateio" em cada linha, e o vencimento, as
parcelas e o CNAE à direita, valendo para todas as notas. Quem só conhecia o
envio de um job não reconhecia nada, e a primeira tela não dizia por onde
começar. Com muitas notas (já houve envio de 18), cada nota ocupava metade do
formulário.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Abertura | O pop-up abre como o envio de um job: já com a **nota 1** preenchida (o CNPJ do cliente, o valor dos jobs e o vencimento sugerido). No título das notas, "Copiar de um envio anterior" e "Adicionar nota fiscal". |
| D2 | A nota | Cada nota é o **cartão do envio de um job**: CNPJ do cliente (ou tomador no exterior), valor, vencimento, CNAE sugerido e descritivo, com os atalhos de parcelas **1×, 2×, 3×, 6×**, "Nova parcela" e a lixeira. Só o CNPJ: o campo do nome do tomador sai, como no envio de um job. |
| D3 | Por nota (revê a regra 5 da 188) | O **vencimento, as parcelas e o CNAE** passam a ser de cada nota. Cada job entra em cada parcela da nota na proporção da parte dele na nota. O portal, a observação, os contatos e a PO de cada job continuam do envio. |
| D4 | Os jobs da nota (revê a regra 3 da 188) | No pé do cartão, cada job do lote com uma **caixa de marcar**, a porcentagem e o valor da nota. Os marcados dividem a nota **na proporção do que falta de cada um**; um só marcado leva a nota inteira ("Só o job"). **Regra nova:** marcar alguns jobs (2 de 3, por exemplo) divide a nota entre eles, na mesma proporção — antes só se fazia pelo "Dividir à mão". |
| D5 | Dividir à mão | "Dividir à mão", no canto da linha, abre na mesma linha o **valor e a porcentagem** de cada job. Escrever 50 na porcentagem dá metade do valor da nota, no centavo. "Voltar à proporção" volta com os mesmos jobs marcados. |
| D6 | Muitas notas | Só a nota em edição fica aberta; as outras viram uma linha com o número, o valor, o CNPJ, o vencimento, os jobs e o que falta ("Falta o CNPJ", em vermelho) ou "Pronta". O clique abre. O título conta as notas e as pendências; "Adicionar nota fiscal" também embaixo da lista. O descritivo começa com uma linha e cresce no foco. |
| D7 | Até 4 jobs numa linha | Os jobs da nota ficam numa linha só até 4 jobs; de 5 em diante, em duas. Cada job ocupa uma coluna estreita: código e porcentagem em cima, valor embaixo. |
| D8 | À direita | O valor a faturar, com cada job, a porcentagem dele no total e o que falta dele nas notas ("✓ nas notas" ou "faltam R$ …"), **sem barras nem cores**; a PO de cada job no lugar do "Número da PO"; portal, observação e contatos. O pop-up fica com 1.280 px, perto do envio de um job. |
| D9 | O nome do tomador | Vai ao financeiro quando o sistema o conhece: o do cliente, se o CNPJ é o dele; o do envio copiado, se o CNPJ é o mesmo de lá. Com outro CNPJ (uma filial), vai sem nome, e o Faturar mostra só o CNPJ e "Veio do envio em lote de …". |

## Como funciona

- **Conta** (`lib/calculos/envio-em-lote.ts`, `ratearNotas`): a nota
  proporcional ganha `jobs` (os marcados). Ordem: as notas de um job só e as
  divididas à mão; depois as de **alguns jobs**, cada uma na proporção do que
  falta dos jobs dela; por último as de todos os jobs, que fecham cada job no
  centavo como antes. Sem nota de todos, a última nota de alguns jobs fecha os
  jobs dela quando o valor bate com o que falta. Sem nota de alguns jobs, a
  conta é a de antes. Testes em `envio-em-lote.test.ts` (5 novos, 13 no total).
- **Schema** (`lib/validations/envio-faturamento-lote.ts`): a nota ganha
  `cnae_sugerido`, `parcelas` (valor e vencimento, até 12) e `jobs_da_nota`;
  o `vencimento` do envio virou opcional e `parcelas` passou a 1 por padrão.
- **Action** (`app/(app)/jobs/actions-envio-lote.ts`): confere que as parcelas
  de cada nota fecham com o valor dela e que os jobs marcados são do lote; o
  CNAE da nota vai para a nota do lote e para a nota de cada job; a parte de
  cada job se divide pelas parcelas da nota (`partesNasParcelas`, a última
  leva o centavo). A RPC `enviar_lote_para_faturamento` não mudou.
- **Tela** (`app/(app)/jobs/envio-em-lote-dialog.tsx`): o formulário inteiro.
- **No banco**, a nota de alguns jobs é gravada como `rateio = 'proporcional'`
  (o check aceita proporcional, job e manual); as partes de cada job dizem
  quais jobs entraram.
- **Financeiro** (`financeiro/contas-a-receber`): `tomador_nome` da nota do
  lote passou a `string | null` no tipo, e o Faturar não mostra mais
  "Tomador:" vazio.

## Testado (16/11/2026, Sandbox)

Três jobs do cliente Teste 22 criados pelas telas no P-0006/26 (TET-1006,
TET-1007 e TET-1008/26) e enviados como GP Sandbox, num envio de 3 notas com
CNPJs de teste da raiz 11.222.333:
- nota 1, R$ 200.000,00, só o TET-1006 e o TET-1007 (o TET-1008 desmarcado),
  em 2 parcelas (30/11 e 30/12), CNAE 73.11-4-00;
- nota 2, R$ 100.000,00, dividida à mão pela porcentagem (50% e 50%);
- nota 3, o resto, com os três jobs.

O banco gravou o CNAE só na nota 1, duas parcelas por job na nota 1 e cada job
fechado no centavo. No Faturamento as três notas aparecem como "nota N de 3",
e o Faturar da nota 1 traz "Sugerido pelo GP: 73.11-4-00".

## Fica de fora

- **Copiar de um envio anterior:** a nota de alguns jobs volta como nota de
  todos os jobs (o banco grava "proporcional" e a cópia não lê as partes).
- **Esc fecha o pop-up inteiro** e perde as notas — já era assim antes.
- **5 jobs ou mais** em duas linhas: a conta da grade está escrita, mas o
  Sandbox não tinha 5 jobs do mesmo cliente para conferir na tela.

## Protótipo

https://claude.ai/artifact/5HnwtzWcSTGbKL81aMyEqE (`.claude/prototipos/envio-em-lote/`,
dados fictícios). As opções que não foram escolhidas (abrir com "Adicionar
nota" em destaque ou com três caminhos; todas as notas abertas; escrever o
valor de cada job; o quadro notas × jobs) ficaram só no protótipo.
