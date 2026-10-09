# 115 — O financeiro edita o orçado do job na Planilha Interna, sem aprovação, da abertura até a primeira nota ou o encerramento

**Data:** 2026-09-28
**Decidido por:** Tiago, sobre protótipo navegável (artifact `Re8sXDJpj8gzEk1tnCrt48`, v2), com mais duas rodadas de respostas no mesmo dia, sobre a entrega
**Migrations:** `20260928300001_alteracoes_do_financeiro.sql`,
`20260928300002_alteracao_financeiro_curva_do_interno.sql` (desfeita pela
seguinte),
`20260928300003_alteracao_financeiro_so_recebimento_e_trava_no_encerramento.sql`,
`20260928300004_alteracao_financeiro_na_abertura_do_job.sql` e, na revisão
de 08/10/2026 (o tipo de custo), `20261008800001_alteracao_financeiro_troca_tipo_de_custo.sql`.

> ⚠️ **Revisada em 08/10/2026 — o financeiro também troca o tipo de
> custo.** Até aqui o "Editar orçado" mexia só em R$ Unit., QT e D/M, e o
> tipo era da errata (§3, item 4). Agora o tipo muda também, para qualquer
> tipo, enquanto nada foi lançado no item. Ver §9.

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

Com a entrega no main, ainda no mesmo dia:

- **A edição vale também durante a abertura.** "Percebi que não está sendo
  possível editar o orçado, durante o momento de abertura do job, como eu
  havia mencionado. Isso deverá ser possível." O pedido original dizia
  "desde o momento da abertura de jobs", e a entrega o tinha lido como
  "desde que o job foi aberto".

## 3. A regra

1. **Quem:** administrador e financeiro (`jobs.editar_orcado_financeiro`
   em `lib/permissoes.ts`). A produção continua corrigindo pela errata.
2. **Onde:** botão "Editar orçado" na Planilha Interna do job **no
   financeiro**, no lugar em que a produção tem o "Realizar errata": na
   tela da abertura (`/financeiro/abertura-de-job/[jobId]?aba=planilha`) e
   na do job aberto (`/financeiro/jobs/[jobId]?aba=planilha`). A planilha
   da produção não tem o botão.
3. **Quando:** **desde a abertura** — o job na fila (`aguardando_abertura`),
   enquanto o financeiro o confere — até a **primeira nota emitida**,
   parcial ou total, **ou o encerramento** do job, o que vier antes. Depois
   de aberto, o status precisa ser aberto ou em produção
   (`JOB_STATUS_ABERTO`): encerrado e finalizado nunca editam, nem o
   Interno, que não tem nota. O devolvido à produção (`rejeitado_financeiro`)
   não edita. No modelo mensal (decisão 078) a trava da nota é por mês: as
   linhas do mês com nota não abrem; as dos outros meses, sim.
4. **O quê:** R$ Unit., QT e D/M do orçado e, desde 08/10/2026, o **tipo
   de custo**, enquanto nada foi lançado no item (§9). Linha nova, linha
   vermelha e planejado continuam sendo da errata. Os valores da linha com
   PP são editáveis (P2). **Linha com save não:** o save tem porta própria
   (o pop-up da coluna Save), e o banco já recusa (`save_trava_linha_job`).

   > ⚠️ **08/10/2026:** este item dizia que o tipo de custo era só da
   > errata. Deixou de ser — ver §9.
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

   **Na abertura** ainda não há previsão gravada, envio nem nota: o que
   acompanha é o **formulário da aba Abertura do Job**, na mesma página.
   Faturamento, imposto e custo previstos passam a ser os novos; o que o
   financeiro já preencheu fica (nome, projeto, contas, datas); as parcelas
   de recebimento que ele montou andam pela mesma regra — cada uma na
   proporção dela, com a mesma data, ou, no mensal, o valor novo de cada
   mês —, e os impostos que seguem as parcelas se refazem. A foto da
   abertura, ao confirmar, já sai com os números novos.

   O mesmo formulário, na aba Abertura do Job do **job aberto**, relê as
   previsões gravadas depois de uma edição do orçado (antes ficava com os
   valores de antes até recarregar a página); com o Editar registro aberto,
   acompanha como na abertura.
8. **O que não muda:** o orçado aprovado da versão
   (`versoes_orcamento_itens`), o realizado, as PPs, o status de conclusão
   do A · Repasse, a foto da abertura (`valor_job_abertura`,
   `faturamento_previsto_abertura`) e a **curva de desembolso**, com o
   `custo_previsto_total`. O planejado só muda no serviço Interno (decisão
   105), em que o banco o faz espelhar o orçado (`planejado_espelha_orcado`).
   Ali o custo previsto muda e a curva não: se o financeiro quiser a curva
   nova, ajusta no Editar registro da aba Abertura do Job, que confere a
   soma contra o custo previsto.

   > ⚠️ **08/10/2026:** com a troca de tipo, duas coisas deste item mudam
   > na linha trocada: o **realizado** passa a seguir o tipo novo (em A e D
   > é o orçado; nos tipos com PP, a soma das PPs), e o **custo previsto**
   > muda quando o tipo entra ou sai dos que geram PP. A curva continua sem
   > acompanhar, pela mesma regra do Interno; o pop-up avisa quanto o custo
   > previsto mudou e onde ajustar a curva.
9. **O registro:** cada confirmação vira uma linha de
   `jobs_alteracoes_financeiro`, com as linhas em
   `jobs_alteracoes_financeiro_itens`. É histórico imutável: sem UPDATE nem
   DELETE, nem na policy nem no grant. Aparece:
   - no card **"Alterações do Financeiro"**, na aba Informações do Job — na
     abertura, no job aberto no financeiro e na produção —, depois da ficha
     e do card de Erratas, só depois da primeira alteração. Uma linha por alteração, com data, hora, motivo,
     "N itens · autor"; aberta, o antes → depois de cada item, os efeitos
     no faturamento previsto e no valor do job, e as parcelas que
     acompanharam;
   - no fio da **Comunicação**, como card de sistema;
   - na auditoria, `job.orcado_alterado_financeiro`.

## 4. As recusas

A action (`registrarAlteracaoDoFinanceiro`) confere tudo no servidor. A
função do banco repete a trava do status (na fila da abertura, aberto ou
em produção) e a das parcelas do envio que já viraram nota:

| Situação | Mensagem |
|---|---|
| Job encerrado ou finalizado | "O job já foi encerrado: o orçado não muda mais pelo financeiro." |
| Job fora da janela (devolvido, cancelado) | "O orçado só é editado pelo financeiro com o job na abertura ou já aberto no financeiro." |
| Job com nota emitida | "O job já tem nota emitida (faturamento parcial ou total): o orçado não muda mais pelo financeiro." |
| Linha de mês com nota (mensal) | "Novembro já tem nota emitida: as linhas desse mês não mudam mais pelo financeiro." |
| Linha com save | "\"Item\" tem save. Linha com save não entra na edição do orçado — o save muda pelo pop-up da coluna Save." |
| Parcela do envio que já virou nota (no banco) | "Uma parcela do envio já virou nota emitida: o orçado desse faturamento não muda mais." |
| Status fora da janela (no banco) | "O orçado só é editado pelo financeiro na abertura do job ou com o job aberto: depois do encerramento, não muda mais." |
| Previsão de recebimento vazia que precisaria andar | "O job abriu sem faturamento previsto e não tem previsão de recebimento para acompanhar a alteração. Valor novo precisa de data: peça a errata à produção, que devolve o job para a revisão da abertura." (e a variante do mês, no mensal) |
| Parcela do envio que zeraria | "Com essa alteração, uma parcela do envio para faturamento ficaria zerada ou negativa, e o envio não aceita parcela sem valor." |
| Troca de tipo em linha com PP, PP a emitir ou BV (na action e no banco; 08/10/2026) | "\"Item\" já tem Pedido de Produção: o tipo de custo só muda enquanto nada foi lançado no item." (ou "PP a emitir", ou "BV") |
| Troca de tipo no serviço Interno (no banco; 08/10/2026) | "No serviço Interno o tipo de custo é sempre F · Interno." |

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

**Na abertura** (terceira rodada):

- **TES-1014/26**, criado para o teste pelos fluxos da produção: a versão
  do orçamento TES-P001/26-14 ("Teste importação 110", nacional, três
  linhas B) foi aprovada e enviada para a abertura. Na tela da abertura, com
  o formulário já mexido (nome do job trocado, recebimento em duas
  parcelas de R$ 4.732,20), o Produtor foi de R$ 6.000 para R$ 7.000 na
  aba Planilha. De volta à aba Abertura do Job: o nome continuou o
  digitado, as parcelas foram para 2 × R$ 5.428,11 (R$ 10.856,22), os
  impostos para 2 × R$ 1.060,11 (R$ 2.120,22), e as duas previsões
  fecharam. O card apareceu na aba Informações. Desfeito do mesmo jeito,
  e o formulário voltou a 2 × R$ 4.732,20. Nenhuma previsão foi gravada no
  banco antes da abertura.
- **TES-1013/26**, aberto: depois de uma edição, a aba Abertura do Job
  passou a mostrar o recebimento e o imposto novos sem recarregar a página
  (R$ 1.531,01 e R$ 299,01), e voltou ao desfazer.
- **TES-1002/26**, mensal e aberto, com o Editar registro ligado:
  novembro foi de R$ 118.304,96 para R$ 119.696,78 no formulário, as datas
  ficaram, e os impostos que seguem as parcelas refizeram a soma
  (R$ 74.751,34). O registro foi cancelado sem salvar, e o orçado,
  desfeito.

Ficaram entradas de teste em Alterações do Financeiro, sempre em pares (o
teste e o desfazer): 6 no TES-1013/26, 4 no TES-1002/26, 2 no TES-1009/26
e 2 no TES-1014/26. O histórico é imutável. O TES-1014/26 ficou na fila
da abertura, com os valores do orçamento aprovado, para quem quiser
repetir o teste.

## 9. A revisão de 08/10/2026: o tipo de custo

### O pedido

Nas palavras do Tiago, em 08/10/2026, com um print do AMB-1029/26 na tela
"Abrir job no financeiro" (influenciadores, todas as linhas em A):

> Quero que também seja possível modificar o tipo de custo em "Editar
> Orçado" pelo financeiro

Perguntado se a linha que já tem PP podia trocar de tipo (60 linhas de
jobs abertos tinham PP ativa naquele dia, 23 com PP aprovada ou paga), com
três opções — só entre tipos com PP, qualquer tipo, nenhum —, respondeu:

> Qualquer tipo, porém, do mesmo modo que com a realização de erratas, só
> será possível realizar modificações enquanto nada tiver sido adicionado
> no item.

### A regra

1. **Qualquer tipo**, de A a FI, na abertura e no job aberto, nas mesmas
   telas e janelas do §3.
2. **Só enquanto nada foi lançado no item:** sem PP (gerada, em avaliação,
   aprovada, paga ou rejeitada), sem PP a emitir (decisão 153) e sem BV (a
   negociar, confirmado ou recebido). PP e BV **cancelados não contam**.
   Foi a leitura do "nada tiver sido adicionado no item"; a errata, que ele
   citou, trava a linha com PP já no financeiro e a troca de tipo com BV
   confirmado.
3. **Os valores da linha com PP continuam editáveis** (P2). A trava nova é
   só do tipo.
4. **Continuam fechados:** o Interno (sempre F · Interno, decisão 105), a
   linha vermelha, a linha cancelada, a linha com save e o mês com nota no
   mensal — como os valores.
5. **O que acompanha** é o mesmo do §3, item 7: números do job, previsão
   de recebimento, impostos e envio sem nota, pela conta do financeiro com
   o tipo novo. A **curva de desembolso não acompanha** (§3, item 8): quando
   o tipo entra ou sai dos que geram PP, o custo previsto muda pelo
   planejado da linha, e o pop-up diz quanto e onde ajustar a curva (na
   abertura, o cronograma de desembolsos; no job aberto, o Editar
   registro).
6. **Como fica no AMB-1029/26** se a Flávia (R$ 5.500) sai de A, com 13% de
   honorários e 19,53% de imposto: faturamento previsto R$ 3.303,72 → AR
   R$ 8.803,72 · B R$ 10.138,56 · C R$ 9.250,03; valor do job R$ 23.753,72
   → AR igual · B R$ 25.088,56 · C R$ 24.200,03. Em AR e B o custo previsto
   sobe R$ 5.500.

### Onde mora

- **Na tela:** a coluna Tipo abre no "Editar orçado" com a mesma lista da
  errata. Na linha com lançamento ela não abre, e o motivo aparece ao
  passar o mouse ("Linha com Pedido de Produção: o tipo de custo só muda
  enquanto nada foi lançado no item. Os valores do orçado continuam
  editáveis."). O pop-up mostra o de → para do tipo na linha; o card
  "Alterações do Financeiro" ganha o selo "Tipo de custo" e o de → para na
  coluna Tipo, como o card de Erratas; o fio da Comunicação diz "Tipo de
  custo · item: A · Direto → A · Repasse".
- **Na action** (`registrarAlteracaoDoFinanceiro`): `tipo_custo` opcional
  em cada linha (ausente = o mesmo, para aba aberta antes da revisão);
  confere os lançamentos pela função do banco antes de qualquer conta.
- **No banco** (`20261008800001`):
  `jobs_alteracoes_financeiro_itens.tipo_custo_para` (as 32 linhas que já
  existiam receberam o próprio tipo); `lancamentos_nas_linhas_do_job`,
  SECURITY DEFINER porque a RLS de `pedidos_compra` filtra por empresa e a
  trava não pode depender do que o usuário enxerga; e
  `registrar_alteracao_do_financeiro` grava o tipo e recusa a troca com
  lançamento e no Interno (o trigger regravaria F · Interno).

### Conferência (08 e 09/10/2026)

- **TES-1013/26** (aberto, uma linha B de R$ 1.000, enviado e sem nota),
  pela tela: B → A e de volta. O pop-up mostrou e o banco gravou
  faturamento R$ 1.391,82 → R$ 149,12, valor do job → R$ 1.149,12,
  recebimento → R$ 149,12, imposto R$ 271,82 → R$ 29,12 e o envio com
  parcelas de R$ 1.000 / 195,91 / 195,91 → R$ 107,14 / 20,99 / 20,99, com o
  carimbo do envio intacto — os números calculados antes pela mesma conta.
  O desfazer voltou tudo ao centavo. Card no financeiro e na produção com
  "Tipo de custo" e "B · Bi-trib. → A · Direto"; card no fio da
  Comunicação.
- **TES-1025/26, na abertura, de ponta a ponta** (criado para o teste em
  09/10/2026 pelo "Enviar Job para Abertura" do "Orçamento de Teste",
  TES-P001/26-01, versão 4): no formulário da abertura, o recebimento foi
  dividido em R$ 100.000,00 (30/10) e R$ 42.620,85 (29/11), e o projeto,
  escolhido. Na aba Planilha Interna, o Item 2 (A, R$ 15.000, planejado
  R$ 10.000) foi para B. De volta à aba Abertura do Job, sem recarregar:
  faturamento R$ 142.620,85 → R$ 161.261,34, parcelas → R$ 113.069,96 e
  R$ 48.191,38 (mesmas datas, mesma proporção), impostos R$ 25.900,85 →
  R$ 20.713,20 + R$ 8.828,14, custo previsto R$ 84.000 → R$ 94.000 e a
  curva parada em R$ 84.000 com "Falta R$ 10.000,00" — o "Distribuir" a
  fechou em 2 × R$ 47.000. O projeto continuou escolhido. O job foi aberto
  com esses números: previsões, `custo_previsto_total` e a foto nº 1 de
  `jobs_aberturas` gravados com os valores novos; `valor_job_abertura` e
  `faturamento_previsto_abertura` ficaram com os do envio, como o §3,
  item 8, manda. O Item 1, A com um BV "a negociar" vindo da versão, ficou
  com o Tipo travado e o motivo "Linha com BV".
- **TES-1014/26:** na linha Produtor, com PP, o Tipo não abre e mostra o
  motivo; o R$ Unit. abre. Saída sem gravar.
- **AMB-1029/26** (job real, na fila da abertura): a Flávia de A para AR no
  rascunho; o pop-up mostrou R$ 3.303,72 → R$ 8.803,72, valor do job igual
  e "O custo previsto muda +R$ 5.500,00". Descartado, sem gravar.
- **Simulações no banco, como usuário logado e com rollback:** a função
  recusa a troca na linha com PP (TES-1014/26) e no Interno (CAL-1001/26);
  aceita a troca na fila da abertura (AMB-1029/26); a função de leitura
  devolve "pp" e "bv" nas linhas certas. Nada ficou gravado.
- A chamada direta da action, pelo console, foi barrada pelo modo
  automático da sessão: a trava foi conferida na função do banco, que é a
  mesma que a action consulta.

Ficaram 2 entradas de teste em Alterações do Financeiro no TES-1013/26 (a
troca e o desfazer) e 1 no TES-1025/26, que ficou aberto no financeiro
(projeto TES-F001/26, contas "Conta Teste") com o Item 2 em B.
