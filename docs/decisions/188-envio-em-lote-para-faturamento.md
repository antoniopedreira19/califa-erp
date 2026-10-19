# 188 — Envio em lote para faturamento: vários jobs de um cliente, com as notas que o cliente pediu e o rateio entre notas e jobs

**Data:** 2026-10-19
**Status:** aceita. **Entregas 1, 2 e 3 implementadas em 19/10/2026** (o
envio pela lista de Jobs; a nota do lote na fila do financeiro e no Faturar;
"Repetir" e "Copiar de um envio anterior", §6a).
**Quem decidiu:** Tiago, de 16 a 19/10/2026, sobre o protótipo interativo
("Envio em Lote", quatro versões comentadas no próprio protótipo) e o e-mail
real do faturamento do Fee Ânima.
**Relaciona-se com:** [123](123-o-envio-para-faturamento-vira-notas-fiscais.md) (o envio
em notas fiscais), [184](184-faturar-drawer-que-abre-a-nota-e-cnpj-do-tomador.md)
(a nota sai na empresa do job; tomador no exterior),
[078](078-orcamento-mensal-fee-e-always-on.md) (jobs mensais: Fee e Always On, mês a
mês), [167](167-job-da-midia-off-abrir-e-faturar.md) (Mídia Off),
[050](050-portal-do-cliente-nasce-de-dentro-do-envio-para-faturamento.md) (portal do
cliente cadastrado no envio), [099](099-aprovacao-de-save.md) (consumo de save trava o
envio) e [159](159-errata-pronta-para-envio.md) (errata pronta trava o envio).
**Migrations:** `20261019500001_envio_em_lote_para_faturamento.sql` e
`20261019500002_envio_em_lote_indices_das_fks.sql`, aplicadas pelo MCP em
19/10/2026.

## O pedido

> "Seria possível adicionarmos uma maneira da produção poder fazer o envio de
> vários jobs de um mesmo cliente para faturamento de uma vez?"

E, sobre a primeira proposta (um envio por job):

> "Não quero que necessariamente os 3 jobs sejam divididos em três envios cada
> um com sua NF. Deve ser possível ter os 3 jobs cobertos por uma NF, assim
> como os 3 podem ser divididos entre uma série de NF (inclusive mais de 3),
> as quais terão um rateio a ser definido."

O caso que guiou o desenho é o **Fee Ânima**: 4 jobs mensais (MG e RJ,
Nordeste, SP, Sul) e um e-mail do cliente pedindo **18 notas**, uma por
instituição, com CNPJ, valor e descritivo. Conferido no banco: nenhum grupo
de notas inteiras fecha o valor de um job — o rateio é a regra, não a
exceção. Hoje não existe rastro entre essas notas e os jobs; com o lote
passa a existir.

## 1. A regra

1. **O lote é de um cliente e de uma empresa** (Tiago, 19/10/2026: "Não deve
   ser possível fazer um lote com mais do que uma empresa. Sempre de jobs de
   um mesmo cliente que estão em uma mesma empresa."). A empresa gerencial e a
   regional continuam as de cada job; a contábil é a do CNPJ que emite a nota,
   escolhido pelo financeiro no Faturar. Como o lote não mistura empresas, a
   regra da 184 (a nota sai na empresa do job) segue valendo.
2. **As notas são as que o cliente pediu.** Cada uma tem tomador, CNPJ (ou
   "exterior", 184), valor e descritivo. Uma nota pode juntar jobs; um job
   pode ser dividido entre notas.
3. **Rateio** de cada nota:
   - **Proporcional** (padrão): a nota se divide entre os jobs na proporção do
     que falta de cada um. Fecha sozinho, no centavo, quando as notas somam o
     valor dos jobs;
   - **Só o job X**: a nota é toda daquele job;
   - **Dividir à mão**: quem envia escreve quanto vai para cada job.
4. **O valor de cada job não é editável**: é o faturamento previsto, ou o do
   mês no Fee e no Always On, relido no servidor como no envio de um job só.
5. **Vale para todas as notas:** o vencimento, o número de parcelas (1 a 3,
   de 30 em 30 dias; cada parcela leva os jobs na proporção deles na nota), o
   CNAE sugerido e o portal do cliente (com o "+" para cadastrar um novo, 050).
   **Por job:** o número da PO.
6. **Observação** opcional para o financeiro (pedido do Tiago em 19/10): vai
   com o envio e não sai na nota.
7. **Contatos de cobrança:** a união dos contatos dos jobs; a lista revista no
   envio passa a ser a de cada job (D1 da 123).
8. **Jobs mensais:** entram com o próximo mês a enviar. O lote é de um mês só:
   o mensal que está em outro mês fica fora, com o motivo.
9. **Mídia Off fica fora do lote:** o envio dela tem as travas da veiculação e
   o encerramento junto do último mês (167), só pela página do job.
10. **As mesmas travas do envio de um job:** status, consumo de save
    aguardando ou nunca enviado, revisão da abertura, errata pronta parada,
    "já enviado" e o autor (administrador ou GP). O job que não passa fica
    fora do lote, com o motivo, e os outros seguem.

## 2. A tela (design aprovado em 19/10/2026)

Na **lista de Jobs**, o botão **"Enviar para faturamento"** liga o modo de
seleção: a calha de cada job vira uma caixa; o job que não pode ir fica
apagado e mostra o motivo ao passar o mouse; o primeiro marcado prende o lote
ao cliente e à empresa dele. Uma barra no rodapé (o padrão do Faturamento
Agrupado) mostra quantos, o total e o cliente, e abre o pop-up.

O **pop-up**, de cima para baixo:
- **os jobs em cartões**: cor, valor (o do mês no mensal, "mês 2 de 3") e uma
  barra de quanto do job já está nas notas; o Nº da PO de cada um;
- **as notas numa tabela**: tomador e CNPJ (ou exterior), valor, descritivo e
  **Rateio** (Proporcional, Só o job X, Dividir à mão — os campos por job abrem
  na própria linha), com uma barra colorida de quanto da nota é de cada job.
  Para começar: "Uma nota para todos os jobs", "Uma nota por job" ou "Adicionar
  nota". O "Adicionar nota" fica embaixo da última nota e já vem com o valor
  que falta e o cursor no tomador;
- **à direita**: o valor a faturar, o que vale para todas as notas, a
  observação e os contatos;
- **a confirmação** lista as notas com o rateio de cada uma.

Saíram durante o desenho, a pedido do Tiago: o "Colar do e-mail do cliente"
(cada GP e cada cliente escreve de um jeito; só voltaria com leitura por IA,
o mesmo caminho da 178 opção A) e a aba da matriz nota × job (o rateio já se
faz e se vê na linha da nota).

## 3. No banco

O modelo de cada job não muda: cada job do lote continua com o seu envio
(`jobs_envio_faturamento`), as suas notas e parcelas, com todas as travas de
sempre. O lote acrescenta o rastro:

- `envios_faturamento_lote`: cliente, empresa, mês, observação, portal, autor;
- `envios_faturamento_lote_notas`: as notas do cliente (tomador, CNPJ ou
  exterior, valor, CNAE, descritivo, rateio);
- `jobs_envio_faturamento.lote_id` e `jobs_envio_faturamento_notas.lote_nota_id`:
  a parte de cada job em cada nota do lote é uma nota do envio daquele job.

`enviar_lote_para_faturamento(payload)` grava tudo numa transação (SECURITY
INVOKER: RLS, GRANT e as travas de cada tabela valem). Ela garante o que não
pode depender do navegador: mesmo cliente e mesma empresa; cada nota do lote
fecha com as partes dos jobs; o envio de cada job fecha com o valor dele.
`enviar_job_para_faturamento` ganhou dois campos opcionais (`lote_id`,
`lote_nota_id`), aceitos só para um lote criado na mesma transação. Sem UPDATE
nem DELETE para o app nas tabelas novas: envio é evento.

No código, a conferência do envio de um job saiu da action da página do job
para `lib/faturamento/conferir-envio-do-job.ts`, e as duas portas (página do
job e lote) usam a mesma. O rateio é uma função pura
(`lib/calculos/envio-em-lote.ts`, com testes): a tela mostra e o servidor
refaz a mesma conta com os valores relidos.

## 4. Testado (19/10/2026)

- No banco, em transação desfeita: o lote grava certo; recusa nota que não
  fecha com as partes; recusa job de outro cliente.
- No navegador (TES-P001/26), lote de 4 marcados: o TES-1025/26 ficou fora
  (revisão da abertura pendente); TES-1002/26 (Always On, outubro),
  TES-1004/26 e TES-1014/26 foram em 2 notas — uma proporcional entre os três
  e uma "exterior" só do TES-1002 —, em 2 parcelas, com observação. Conferido
  no banco: as partes fecham cada nota e cada job; o TES-1004 e o TES-1014
  viraram "Em faturamento"; o TES-1002 seguiu aberto com outubro enviado; a
  fila do financeiro mostra as partes. Ficaram enviados como dado de teste.
- O envio pela página do job, depois da troca para a conferência comum,
  recusou a revisão pendente (TES-1025) e o "já enviado" (TES-1004), com a
  auditoria `acao_negada`.
- **Entrega 2:** na fila do TES-P001/26, as 6 parcelas da nota 1 do lote
  (3 jobs × 2 vencimentos) viraram uma linha "Lote · 1/2", e a nota 2 outra.
  O Faturar abriu a nota 1 com R$ 123.866,54 em 2 × R$ 61.933,27. A emissão
  pelo `emitir_faturamento`, como administrador e em transação desfeita,
  gravou 7 itens (o save do TES-1004 em item próprio) e 2 títulos, tirou as
  partes da nota 1 da fila e deixou a nota 2.

## 4a. A nota do lote no financeiro (entrega 2)

- **Fila:** as partes dos jobs de uma nota do lote são uma linha só (selo
  "Lote"): os jobs com "+", os códigos, o tomador quando não é o cliente, o
  CNPJ, a posição no lote ("1/18") e os vencimentos pelas datas. O Fee de 18
  notas e 4 jobs fica com 18 linhas, e não 72.
- **Faturar:** "Faturar a nota 1 de 18 do lote", com os jobs, o tomador, o
  descritivo da nota já na Descrição da NF, a observação do envio no quadro
  de quem enviou e uma parcela por vencimento (a soma das partes do dia).
  Faturamento parcial e remover um job seguem como no agrupado.
- **Botão `i`:** a PO de cada job, os contatos de todos e a observação.
- **O número da aba Faturamento** conta as linhas da fila, não as parcelas.
- Sem migration: a página lê a nota do lote das notas pendentes, numa
  segunda onda paralela à dos contatos.
- **Pendente:** a linha do lote não oferece o recebimento antes da NF (130),
  que se prende a uma nota de job; o que já estiver numa parte entra na
  parcela 1 do Faturar. Como receber antes pela nota do lote fica para
  decidir.

## 5. Auditoria

`jobs.enviados_em_lote` no lote; `job.enviado_para_faturamento` em cada job
(com `origem: envio_em_lote` e o `lote_id`); `job.contatos_cobranca_alterados`
quando a lista de contatos do job mudou.

## 6. Próximas entregas

- **Entrega 2 — financeiro (feita em 19/10/2026, §4a):** a fila de
  faturamento e o Faturar lendo a nota do lote de uma vez.
- **Entrega 3 — "Copiar de um envio anterior" (feita em 19/10/2026, §6a).**

## 6a. Repetir e copiar as notas de um envio anterior (entrega 3)

- **De onde vêm:** os envios já feitos para o cliente, do mais recente ao mais
  antigo (até 12): os lotes, com as notas e o rateio de cada uma, e os envios
  de um job só que têm notas (decisão 123) — nesses, a nota é toda do job e o
  tomador é o cliente. `carregarEnvioEmLote` lê os dois junto da conferência.
- **"Repetir as notas de {mês}":** aparece quando o envio mais recente com
  **estes mesmos jobs** existe (no mensal, o mês anterior deles). Repete as
  notas com os valores iguais.
- **"Copiar de um envio anterior"** (ou "de outro envio", quando há o
  Repetir): a lista dos envios à esquerda; à direita, as notas do escolhido e
  os **Valores** — "Na mesma proporção, ajustados a R$ X" (padrão quando o
  total mudou; cada nota mantém a sua parte, e a última fecha os centavos) ou
  "Iguais aos de {mês}".
- **Ao copiar:** vêm tomador, CNPJ (ou exterior), valor e descritivo. O mês do
  envio vira o do lote nos descritivos, na caixa em que estava, e o ano vira
  junto quando vem colado ("dezembro/2026" → "janeiro/2027"); mês com outro
  ano no texto fica. A nota "Só o job X" continua assim se o job é deste
  lote; a de outro job e a dividida à mão voltam para Proporcional.
- **O aviso** acima das notas diz o que foi feito (repetiu ou copiou, trocou
  o mês, ajustou os valores, quantas voltaram para Proporcional) e pede para
  conferir. Nada é enviado sem passar pelas pendências e pela confirmação de
  sempre.
- As contas são funções puras com testes (`copiarNotas`, `escalarCentavos`,
  `trocarMesNoTexto`, em `lib/calculos/envio-em-lote.ts`).
- **Testado:** no TES-P001/26 (TES-1002 + TES-1003, novembro), a lista trouxe
  os 6 envios do cliente Teste; copiar o lote de outubro ajustou as 2 notas a
  R$ 167.018,77, manteve a nota 2 "Só o TES-1002/26" e "exterior", e o envio
  ficou pronto (fechado sem enviar). O "Repetir" e a troca do mês nos 18
  descritivos foram conferidos no pop-up real com o Fee Ômega fictício
  (protótipo https://claude.ai/artifact/KYSb95HrtonmB4TvpPw54J): nenhum envio
  real tem hoje os mesmos jobs de um lote livre.

## 7. Pendente fora do sistema

Os always on da Ânima são da CCH (Tiago, 19/10/2026), mas o **ANI-1008/26**
(Nordeste) e o **ANI-1011/26** (Ânima Educação) estão na Agência California.
Com o lote de uma empresa só, eles não entram no lote com os da CCH. O Tiago
trata depois da implementação.
