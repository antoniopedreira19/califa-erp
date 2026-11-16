# 257 — A PP paga diz que está paga: "Pago <data>", a linha da prestação e o job na lista de PPs

**Data:** 2026-11-15
**Status:** aceita e implementada em 15/11/2026; lista de PPs em grade fixa e PP urgente em seção própria em 16/11/2026 (notas no fim).
**Quem decidiu:** Tiago, de 12 a 15/11/2026, escolhendo no protótipo "Verba paga no status" (telas reais com dados fictícios), depois de uma pergunta do financeiro.
**Revê:** a [081](081-a-producao-presta-contas-da-verba-e-o-financeiro-aprova.md) na lista de PPs do Contas a Pagar — a verba paga volta a mostrar "Pago", e o andamento da prestação vai para uma linha própria —, e o selo em duas linhas da aba PPs do job ([189](189-prestacao-de-contas-da-verba-documento-a-documento.md)), que deixa de ser preciso com os nomes curtos.
**Migration:** nenhuma.

## O problema

O financeiro perguntou se a PP de verba "baixada, mas com o status Aguardando prestação" não ia para a conciliação. Ia: a situação da verba só existe com a PP paga, e o Extrato da conciliação lê toda baixa da conta, sem olhar a prestação. A confusão vinha da lista de PPs, que mostrava o selo da prestação **no lugar** do "Pago" — nada na linha dizia que a verba já tinha saído da conta.

No mesmo caminho apareceram mais três coisas: os selos da verba eram longos e alargavam a coluna de Status; a verba cuja sobra já foi devolvida aparecia como "Concluída", igual à aprovada sem sobra; e o financeiro não tinha, na lista de PPs, a abertura e o faturamento do job nem um atalho para a linha da planilha de onde veio a PP.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | "Pago <data>" | Toda PP paga — e todo título pago em Títulos a Pagar — mostra o dia do pagamento embaixo do selo: "Pago 03/11/2026". Vale na lista de PPs, em Títulos a Pagar, na aba PPs do job e no cartão da PP no painel do item. Na verba (fora da lista de PPs), a data fica embaixo do selo da prestação. Na aba PPs do job, a data é a da parcela |
| D2 | Nomes curtos da verba | O selo da situação da verba mostra **A prestar**, **Prestação**, **Reprovada**, **A devolver** e **Concluída**, nas cores de hoje, em todas as telas que usam o selo. O nome inteiro ("Aguardando prestação", "Prestação em avaliação"…) fica no filtro da coluna Status e aparece ao passar o mouse, com o que ele quer dizer. "A devolver" é o nome que Títulos a Pagar já dava ao título da devolução |
| D3 | A linha da prestação | Na lista de PPs, a verba paga fica "Pago", e a prestação de contas vira **outra linha da mesma PP**, logo embaixo (o código com o selo "Prestação"). Ela aparece quando a produção **envia** a prestação ao financeiro (o envio exige a verba paga; o rascunho é da produção) e segue até Devolvido ou Concluída. É sempre **uma** linha: o banco tem uma prestação por PP (`uniq_prestacao_por_pp`) e uma devolução por prestação, então a prestação reprovada volta a "Prestação" quando é reenviada, e o histórico fica na tela da PP |
| D4 | O que a linha da prestação mostra | **Valor:** o comprovado, e a sobra embaixo. **Enviada por:** quem enviou a prestação, e quando. **Status:** o andamento com a data do momento — Prestação; Reprovada (dia); A devolver (dia previsto); **Devolvido** (dia, selo novo, que separa a sobra devolvida da "Concluída" sem sobra); Concluída (dia da aprovação). As outras colunas ficam vazias. Clicar abre a tela da PP, que já mostra os comprovantes. No filtro Prestação de Contas, a própria linha é a da prestação |
| D5 | Colunas da lista de PPs | Código, Valor, Parcela, Fornecedor, Prazo original, Enviada por, Job, Abertura do job, Faturamento, Status e o ícone da planilha. A **Emissão saiu**. No filtro Prestação de Contas: Código, Valor, Comprovado, Saldo, Fornecedor… — o "Enviada em" saiu junto com a Emissão (a data está em Enviada por). O selo Verba fica embaixo do código |
| D6 | Abertura do job | Coluna própria, com filtro: `jobs.data_abertura_financeiro`, o dia em que o financeiro abriu o job |
| D7 | Faturamento do job | Coluna própria, com filtro: a esteira de Visualizar Jobs (`faturamentoPorJob`), com o mesmo selo — Aguardando envio, Enviado, **Faturado** (nota emitida, ainda não recebida e sem parcela vencida), **Inadimplente** (selo próprio, como em Visualizar Jobs), Liquidado e Sem faturamento. Job que não aparece na esteira é "Aguardando envio" (a regra escrita na função) |
| D8 | A linha na Planilha Interna | Um ícone no fim da linha (o do protótipo de Suprimentos) abre a Planilha Interna do job no pop-up de leitura da abertura, com a linha de onde veio a PP na borda vermelha e já rolada até ela |

### Para registro

- **"Prazo original"** é `pedidos_compra.prazo_pagamento`: o vencimento que a produção pediu ao emitir a PP. Nas 1.004 PPs de uma parcela, é o vencimento dela; nas 41 parceladas, o da 1ª parcela. Não muda quando o financeiro reprograma o pagamento (270 PPs tinham a data de pagamento diferente do vencimento em 15/11).
- **Números de 15/11/2026, na produção:** 73 verbas pagas — 70 a prestar e 3 em avaliação; nenhuma aprovada, reprovada ou devolvida. Dos 102 jobs com PP, 82 estão em Aguardando envio, 14 em Enviado e 6 em Sem faturamento; **nenhum faturado**, porque o sistema tem 1 nota emitida, sem job. Enquanto as notas não forem emitidas pelo sistema, a coluna Faturamento não mostra Faturado.

## No código

- `components/financeiro/situacao-verba-chip.tsx`: os nomes curtos e a dica com o nome inteiro; a prop `duasLinhas` saiu.
- `components/financeiro/planilha-de-titulos/planilha.tsx` (`SeloDoStatus`), `app/(app)/jobs/[jobId]/pps/job-pps-section.tsx` (`PagoEm`) e `app/(app)/jobs/[jobId]/realizado/painel-pps-item.tsx`: o "Pago <data>". O `PPDoItem` ganhou `pagoEm`, obrigatório, montado em `job-item-realizado-table.tsx`; a PP a emitir manda `null`.
- `app/(app)/financeiro/contas-a-pagar/dados-dos-titulos.ts`: o `SELECT_PP_DO_FINANCEIRO` lê `jobs.data_abertura_financeiro` e `jobs_itens_realizado.job_item_orcado_id`; o `PPRow` ganhou `job_aberto_em`, `job_faturamento` e `item_orcado_id`, obrigatórios. O faturamento só a página de Contas a Pagar preenche, com `faturamentoPorJob` no mesmo `Promise.all`; quem monta a linha sem ele manda `null`.
- `app/(app)/financeiro/contas-a-pagar/pedidos-compra-list.tsx`: as colunas, a `LinhaDaPrestacao`, o ícone e o pop-up, carregado com `dynamic` só ao abrir.
- `app/(app)/financeiro/abertura-de-job/[jobId]/planilha-em-leitura.tsx`: o `PopUpDaPlanilha` ganhou `rolarAte` (a linha fica à vista ao abrir, pelo `data-calha`, como a da PP no Comitê). A abertura não passa, e abre no topo como sempre.

## Fora desta decisão

- A linha da prestação existe só na lista de PPs do Contas a Pagar. Títulos a Pagar, a aba PPs do job e o painel do item seguem com o selo da prestação e o "Pago <data>" embaixo.
- O cabeçalho da tela da PP mostra "Concluída" na verba cuja sobra já foi devolvida: o selo recebe só a situação.
- No filtro da coluna Status, "Aguardando prestação" traz as verbas pagas que ainda não têm a linha da prestação (a linha delas mostra "Pago").

## ⚠️ Revisão de 2026-11-16 — a lista de PPs em grade fixa, como no protótipo

**O que o Tiago viu:** a lista publicada não batia com o protótipo.
- Faturamento ficava cortado, e Status e o ícone da planilha não apareciam.
- Cada linha passava de duas linhas de texto.

**Causa:**
- O protótipo rodou com dados fictícios e curtos, e coube.
- A implementação copiou a marcação dele, com largura automática.
- Com os textos reais em `nowrap` (fornecedor de até 72 caracteres, job de até 54, quem enviou de até 43), a tabela foi a 1.887 px.
- A caixa tinha 1.615 px e `overflow-hidden`, que cortava o fim sem rolagem.

**Agora:**
- **Grade fixa** (`table-fixed` + `colgroup`): Código 168, Valor 144, Parcela 92, Fornecedor (o que sobra), Prazo original 108, Enviada por 160, Job (o que sobra), Abertura do job 108, Faturamento 168, Status 152 e ícone 44.
- **Filtro Prestação de Contas:** Comprovado 132 e Saldo 124 no lugar de Parcela e Prazo original.
- **Na largura do Tiago** (1.616 px de conteúdo), Fornecedor e Job ficam com 234 px cada.
- **Teto de duas linhas:**
  - Fornecedor e Job quebram em até duas linhas, e o resto abre no cartão.
  - O nome de quem enviou fica numa linha só.
  - O **Urgente** desceu para baixo do código, ao lado do selo Verba/Reembolso. Os dois juntos medem 133 px, e há 10 PPs urgentes de reembolso em aberto.
- **Janela mais estreita:** a lista rola de lado dentro da caixa (`overflow-x-auto`, mínimo de 1.520 px), e nenhuma coluna some.

**Conferido:**
- **Na tela publicada, sem gravar nada:** as larguras novas foram aplicadas por JS às 498 PPs em avaliação. Nenhum valor, data ou selo transbordou; transbordavam só os textos que agora quebram ou cortam.
- **No servidor local, com o Sandbox:**
  - A 1.838 px, a tabela tem 1.614 px, e as linhas, de 67 a 73 px.
  - Com textos do tamanho dos maiores reais, nada transbordou e nenhuma linha passou de duas.
  - A 1.440 px, só a caixa rola, e a página não.

**Regra geral:** "Listas com texto livre" em `docs/09-identidade-visual-ui.md`.

## ⚠️ Revisão de 2026-11-16 (2) — a PP urgente na lista: seção "Urgentes", sem etiqueta na linha

**O que o Tiago viu:** a grade fixa da manhã pôs o Urgente embaixo do código, na frente do selo Verba. Com isso, o Verba saiu do lugar aprovado, logo embaixo do código. Ele pediu para reverter e perguntou se a etiqueta podia sair, ficando só um título de seção.

**Protótipo:** duas opções, com urgentes em avaliação e aprovadas e nomes do tamanho dos maiores reais.
- **A — só a seção:** escolhida.
- **B — etiqueta ao lado do código, como antes:** descartada.

**Agora:**
- **Etiqueta:** a linha não tem mais "Urgente". O código fica sozinho na primeira linha, e o selo Verba/Reembolso logo embaixo.
- **Seção:** "URGENTES · N" no topo, com a faixa vermelha, junta as urgentes que esperam o financeiro: **em avaliação e aprovadas**, as mesmas que levavam a etiqueta. Antes, só as em avaliação subiam, e as aprovadas urgentes ficavam no meio da lista. Elas eram 79 das 152 aprovadas em 16/11.
- **Justificativa:** aparece ao passar o mouse no código. Inteira, ela continua no topo do dossiê da tela da PP.
- **Coluna Código:** cai de 168 para 112 px. A sobra vai para Fornecedor e Job.
- **Busca:** digitar "urgente" no filtro da coluna Código continua achando as urgentes.

**Não muda:** a tela da PP (etiqueta Urgente no cabeçalho e justificativa no dossiê) e Títulos a Pagar (o título urgente no topo, com etiqueta).

**Revê** o §6 da [077](077-o-prazo-da-pp-cai-em-janela-e-a-pp-pode-ser-urgente.md) na lista de aprovação.

