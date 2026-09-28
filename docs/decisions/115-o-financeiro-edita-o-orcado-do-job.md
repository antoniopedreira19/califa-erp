# 115 — O financeiro edita o orçado do job na Planilha Interna, sem aprovação, até a primeira nota ou o encerramento

**Data:** 2026-09-28
**Decidido por:** Tiago, sobre protótipo navegável (artifact `Re8sXDJpj8gzEk1tnCrt48`, v2), com uma segunda rodada de respostas no mesmo dia, sobre a entrega
**Migrations:** `20260928300001_alteracoes_do_financeiro.sql`,
`20260928300002_alteracao_financeiro_curva_do_interno.sql` (desfeita pela
seguinte) e
`20260928300003_alteracao_financeiro_so_recebimento_e_trava_no_encerramento.sql`.

---

## 1. O pedido

Nas palavras do Tiago, em 28/09/2026, com prints do AMB-1001/26 (antigo
JOB-0024):

> Quero que inclua um botão de "Editar Orçado", na visão do financeiro da
> planilha interna, o qual ficara no mesmo local do atual botão de
> "Realizar Errata" na visao da produção da planilha interna. Quero que
> essas modificações fiquem registradas do mesmo modo que as erratas sao
> registradas atualmente, em um card, como o atual de erratas, porem
> chamado de "Alterações do Financeiro", registrando o que foi feito, o
> qual devera registrar o usuario que as fez do mesmo jeito. (não precisara
> de aprovações, e poderao ser feitas, desde o momento da abertura de jobs).

Até aqui só a produção mexia no orçado de um job aberto, pela errata, e
toda errata devolve o job ao financeiro para a revisão da abertura
(decisão 059). O financeiro não tinha como corrigir um valor sem pedir à
produção.

## 2. As respostas que fecharam a regra

Sobre o protótipo, o Tiago respondeu em 28/09/2026:

| | Pergunta | Resposta |
|---|---|---|
| P1 | O que o financeiro edita | **Só os valores** do orçado: R$ Unit., QT e D/M |
| P2 | Linha com PP já no financeiro (a errata trava, decisão 040) | **Editável** |
| P3 | A previsão de recebimento | **Acompanha** a alteração |
| P4 | Até quando | "Até o faturamento do job (mesmo que parcial)" — confirmado como: até a **primeira nota emitida**; no mensal, **só o mês faturado** trava |
| P5 | A produção vê | **Sim**: o card e o aviso na Comunicação |
| — | O card "Alterações do Financeiro" | **Oculto até a primeira alteração** |

Quatro pontos foram ditos a ele antes do "pode implementar" e seguiram sem
objeção: editam o **administrador e o financeiro**; o **motivo é
obrigatório**; o item A · Repasse já **concluído continua concluído**, e a
diferença vira rentabilidade; o selo do cabeçalho troca de "Somente
leitura" para **"Editando orçado"** durante a edição.

Depois de ver a entrega, no mesmo dia, ele respondeu:

- **A curva de desembolso não acompanha.** A entrega tinha ligado a curva
  no serviço Interno, e ele recusou: "É a previsão de recebimento que deve
  acompanhar, como vc colocou o design." Perguntado em seguida sobre os
  recolhimentos de imposto previstos, que a entrega também fazia
  acompanhar, confirmou: "Impostos acompanham sim".
- **O encerramento também trava.** Perguntado se o Interno — que nunca tem
  nota — devia travar ao finalizar: "Sim, isso devemos travar, tanto
  faturar, quanto ao encerrar o job (desse modo, sempre estará travado ao
  ser finalizado)."
- **No Interno o planejado acompanha o orçado**, "até quando o financeiro o
  edita", e não há trava por PP: "as PPs preenchem o realizado, não o
  planejado".

## 3. A regra

1. **Quem:** administrador e financeiro (`jobs.editar_orcado_financeiro`
   em `lib/permissoes.ts`). A produção continua corrigindo pela errata.
2. **Onde:** botão "Editar orçado" na Planilha Interna do job **no
   financeiro** (`/financeiro/jobs/[jobId]?aba=planilha`), no lugar em que
   a produção tem o "Realizar errata". A planilha da produção e a da fila
   de abertura não têm o botão.
3. **Quando:** do job aberto no financeiro (`data_abertura_financeiro`
   preenchido) até a **primeira nota emitida**, parcial ou total, **ou o
   encerramento** do job, o que vier antes. Na prática, o status precisa
   ser aberto ou em produção (`JOB_STATUS_ABERTO`): encerrado e finalizado
   nunca editam, nem o Interno, que não tem nota. No modelo mensal
   (decisão 078) a trava da nota é por mês: as linhas do mês com nota não
   abrem; as dos outros meses, sim.
4. **O quê:** R$ Unit., QT e D/M do orçado. Tipo de custo, linha nova,
   linha vermelha e planejado continuam sendo da errata. Linha com PP é
   editável (P2). **Linha com save não:** o save tem porta própria (o
   pop-up da coluna Save), e o banco já recusa (`save_trava_linha_job`).
5. **Motivo obrigatório**, de 5 a 500 caracteres.
6. **Sem aprovação e sem revisão da abertura:** vale na hora.
   `abertura_em_revisao` não muda, e o envio para faturamento não trava.
7. **O que acompanha, na mesma transação:**
   - os números do job — valor do job, faturamento previsto e parte de
     save —, pela conta do financeiro (`totaisDoFinanceiro`, decisão 099),
     a mesma que a errata grava;
   - a **previsão de recebimento** (P3): cada parcela na proporção dela,
     sem mudar a data, e a última fecha o centavo. A soma continua batendo
     com o faturamento previsto do job, que é o que a abertura confere. No
     mensal, só as parcelas do mês mexido, pela mesma conta do envio do mês
     e da abertura (`lerFaturamentoPorMesDoJob`, sem os parâmetros do
     internacional);
   - os **recolhimentos de imposto previstos** (decisão 100), do mesmo
     jeito, porque precisam fechar com o imposto previsto, que muda junto.
     O imposto sai da mesma conta que a abertura usa para conferir o
     cronograma (`impostoDoJob`: imposto da nota + int. taxes, com as
     linhas como o financeiro vê);
   - o **envio para faturamento ainda sem nota** (P4): o valor enviado e as
     parcelas, do mesmo jeito, com as mesmas datas.
     `faturamento_enviado_em` não muda.
8. **O que não muda:** o orçado aprovado da versão
   (`versoes_orcamento_itens`), o realizado, as PPs, o status de conclusão
   do A · Repasse, a foto da abertura (`valor_job_abertura`,
   `faturamento_previsto_abertura`) e a **curva de desembolso**, com o
   `custo_previsto_total`. O planejado só muda no serviço Interno (decisão
   105), em que o banco o faz espelhar o orçado (`planejado_espelha_orcado`).
   Ali o custo previsto muda e a curva não: se o financeiro quiser a curva
   nova, ajusta no Editar registro da aba Abertura do Job, que confere a
   soma contra o custo previsto.
9. **O registro:** cada confirmação vira uma linha de
   `jobs_alteracoes_financeiro`, com as linhas em
   `jobs_alteracoes_financeiro_itens`. É histórico imutável: sem UPDATE nem
   DELETE, nem na policy nem no grant. Aparece:
   - no card **"Alterações do Financeiro"**, na aba Informações do Job, no
     financeiro e na produção, abaixo do card de Erratas, só depois da
     primeira alteração. Uma linha por alteração, com data, hora, motivo,
     "N itens · autor"; aberta, o antes → depois de cada item, os efeitos
     no faturamento previsto e no valor do job, e as parcelas que
     acompanharam;
   - no fio da **Comunicação**, como card de sistema;
   - na auditoria, `job.orcado_alterado_financeiro`.

## 4. As recusas

A action (`registrarAlteracaoDoFinanceiro`) confere tudo no servidor. A
função do banco repete a trava do status (aberto ou em produção) e a das
parcelas do envio que já viraram nota:

| Situação | Mensagem |
|---|---|
| Job encerrado ou finalizado | "O job já foi encerrado: o orçado não muda mais pelo financeiro." |
| Job fora da janela (não aberto, cancelado, devolvido) | "O orçado só é editado pelo financeiro com o job aberto no financeiro." |
| Job com nota emitida | "O job já tem nota emitida (faturamento parcial ou total): o orçado não muda mais pelo financeiro." |
| Linha de mês com nota (mensal) | "Novembro já tem nota emitida: as linhas desse mês não mudam mais pelo financeiro." |
| Linha com save | "\"Item\" tem save. Linha com save não entra na edição do orçado — o save muda pelo pop-up da coluna Save." |
| Parcela do envio que já virou nota (no banco) | "Uma parcela do envio já virou nota emitida: o orçado desse faturamento não muda mais." |
| Status fora da janela (no banco) | "O orçado só é editado pelo financeiro com o job aberto: depois do encerramento, não muda mais." |
| Previsão de recebimento vazia que precisaria andar | "O job abriu sem faturamento previsto e não tem previsão de recebimento para acompanhar a alteração. Valor novo precisa de data: peça a errata à produção, que devolve o job para a revisão da abertura." (e a variante do mês, no mensal) |
| Parcela do envio que zeraria | "Com essa alteração, uma parcela do envio para faturamento ficaria zerada ou negativa, e o envio não aceita parcela sem valor." |

Na tela, o botão fica desabilitado, com o motivo, no job encerrado e no
job com nota — no mensal, só quando todos os meses têm nota. As linhas do
mês com nota não abrem, e as linhas com save mostram o motivo ao passar o
mouse.

## 5. Por que uma tabela nova, e não `jobs_erratas`

Toda errata registrada depois da última foto da abertura é "pendente de
revisão" (decisão 059): o mural, a faixa da revisão e o histórico das
fotos contam com isso. A alteração do financeiro não é revisada por
ninguém. Misturar as duas faria cada leitor de errata precisar de um
filtro, e o primeiro que esquecesse devolveria o job ao mural.

## 6. O centavo dos efeitos

Honorário e imposto são lineares, mas cada efeito por item, arredondado à
parte, podia somar 1 centavo diferente do antes → depois do job: no teste
do TES-1013/26, R$ 278,36 nas linhas contra R$ 278,37 no job. A action
distribui o centavo que sobra, e a última linha fecha o total. O card
mostra linhas que batem com o total da alteração.

## 7. O que foi desfeito, e as decisões tomadas pela entrega

- **A curva de desembolso chegou a acompanhar** no serviço Interno
  (migration `20260928300002`, testada no TES-1009/26). O Tiago recusou no
  mesmo dia, e a `20260928300003` devolveu a função ao que era: ela não toca
  mais em `jobs_previsao_custo` nem em `custo_previsto_total`. As colunas
  `curva_antes` / `curva_depois` de `jobs_alteracoes_financeiro` ficaram,
  porque removê-las seria mudança destrutiva. Só as 2 alterações de teste
  do TES-1009/26 as preenchem, e nada mais escreve nelas.
- **Previsão de recebimento vazia:** o mês que não tinha faturamento na
  abertura não tem parcela de recebimento. Uma alteração que criaria
  faturamento nesse mês é recusada, porque o valor novo precisaria de uma
  data que ninguém informou. Em 28/09/2026 nenhum job aberto estava nesse
  caso. Foi levada ao Tiago na entrega e seguiu sem objeção.
- **Recolhimentos de imposto:** acompanham desde a entrega, que os listou
  entre as decisões tomadas sem ele. Na segunda rodada o Tiago disse que a
  previsão de recebimento "é a única" que muda com o orçado; perguntado
  sobre os impostos, confirmou que acompanham (§2).

## 8. Conferência (28/09/2026)

Tudo em jobs do projeto de teste, pelos fluxos da tela, e cada teste
desfeito por uma segunda alteração:

- **TES-1013/26** (normal, uma linha B): 1.000 → 1.200 → 1.000 e, depois
  da segunda rodada, 1.000 → 1.100 → 1.000. Previsão de recebimento,
  impostos e espelhos acompanharam; curva e `custo_previsto_total`
  intocados; autor gravado; card no financeiro e na produção; card no fio
  da Comunicação; a planilha da produção só com o "Realizar errata".
- **TES-1002/26** (mensal): Item 1 de novembro, 10.000 → 11.000 → 10.000.
  Só a parcela de novembro andou (R$ 118.304,96 → R$ 119.696,78).
- **TES-1009/26** (Interno, finalizado): na primeira rodada, 3.000 → 3.500
  → 3.000, com a curva acompanhando (desfeito). Depois da segunda: botão
  travado com o motivo do encerramento; a action e a função do banco
  recusam.
- **TES-1004/26:** as linhas com save ficam travadas, com o motivo.
- **TES-1001/26:** botão desabilitado pela nota.
- **Chamada direta da action**, sem passar pela tela: recusou job com nota,
  job encerrado, linha de outro job, linha com save e motivo curto.
- **Simulações no banco, com rollback:** o envio sem nota acompanha
  (R$ 1.391,82 → R$ 1.670,19, parcelas de R$ 835,10 e R$ 835,09, carimbo
  do envio preservado); a função recusa parcela que já virou nota e job
  finalizado.
- **Sob as travas de escrita direta** (`20260928400001`, de outra frente,
  aplicada no mesmo dia, que já conta com esta função): a mesma simulação,
  com o envio criado pelo `enviar_job_para_faturamento` e a alteração
  gravada pelo usuário Financeiro Teste. Envio, parcelas, carimbo, status
  (`aberto`), números do job, linha e previsões ficaram certos, e o autor
  gravado foi o financeiro. Tudo desfeito.
- **Build completo** da árvore que subiu (com o main de 28/09), com as
  dependências instaladas numa cópia isolada: `tsc`, lint e `next build`
  limpos.
- **Recebimento e impostos contra a conta da abertura**, no TES-1013/26
  (linha B, honorários de 12%, imposto de 19,53%): com a linha em
  R$ 1.000, R$ 1.100 e R$ 1.200, o faturamento sai em R$ 1.391,82,
  R$ 1.531,01 e R$ 1.670,19 e o imposto em R$ 271,82, R$ 299,01 e
  R$ 326,19 — exatamente o que ficou gravado na previsão de recebimento e
  no cronograma de impostos em cada teste. A parcela mensal passou a usar
  a conta do envio do mês depois dessa conferência (a action passava os
  parâmetros do internacional, que o leitor do mês não usa; nenhum job
  internacional existia).
- **AMB-1001/26** (job real): as 4 linhas com PP abrem na edição; a edição
  foi descartada, sem gravar.

Ficaram entradas de teste em Alterações do Financeiro, sempre em pares (o
teste e o desfazer): 4 no TES-1013/26, 2 no TES-1002/26 e 2 no
TES-1009/26. O histórico é imutável.
