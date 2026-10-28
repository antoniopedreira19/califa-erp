# 115 — O financeiro edita o orçado do job na Planilha Interna, sem aprovação, da abertura até a primeira nota ou o encerramento

**Data:** 2026-09-28
**Decidido por:** Tiago, sobre protótipo navegável (artifact `Re8sXDJpj8gzEk1tnCrt48`, v2), com mais duas rodadas de respostas no mesmo dia, sobre a entrega
**Migrations:** `20260928300001_alteracoes_do_financeiro.sql`,
`20260928300002_alteracao_financeiro_curva_do_interno.sql` (desfeita pela
seguinte),
`20260928300003_alteracao_financeiro_so_recebimento_e_trava_no_encerramento.sql`,
`20260928300004_alteracao_financeiro_na_abertura_do_job.sql` e, na revisão
de 08/10/2026 (o tipo de custo), `20261008800001_alteracao_financeiro_troca_tipo_de_custo.sql`
e, na revisão de 13/10/2026 (a edição na fila entra no valor inicial),
`20261013800001_alteracao_na_fila_entra_na_abertura.sql`; na de 14/10/2026
(o planejado na fila), `20261014600001_financeiro_edita_planejado_na_fila.sql`
e a correção do AMB-1008/26, `20261014600002_amb_1008_planejado_das_influenciadoras.sql`;
na de 28/10/2026 (o tipo da linha com PP e a data do faturamento que nasce),
`20261028600001_editar_orcado_tipo_com_pp_e_recebimento_novo.sql`.

> ⚠️ **Revisada em 08/10/2026 — o financeiro também troca o tipo de
> custo.** Até aqui o "Editar orçado" mexia só em R$ Unit., QT e D/M, e o
> tipo era da errata (§3, item 4). Agora o tipo muda também, para qualquer
> tipo, enquanto nada foi lançado no item. Ver §9.

> ⚠️ **Revisada em 13/10/2026 — a edição na fila entra no valor
> inicial.** Até aqui a foto da abertura (`valor_job_abertura`,
> `faturamento_previsto_abertura`) ficava com o número do envio, e um
> ajuste feito pelo financeiro antes de abrir o job aparecia como
> "inicial" × "atual". Agora a edição com o job na fila da abertura anda
> junto com a foto: o job abre com o valor editado. Depois da abertura,
> nada muda. Ver §10.

> ⚠️ **Revisada em 14/10/2026 — o financeiro edita também o planejado na
> fila.** Até aqui o planejado não era do financeiro (§3, item 8). Agora,
> com o job em `aguardando_abertura`, o "Editar orçado" abre também o
> planejado; depois da abertura ele continua travado. Ver §11.

> ⚠️ **Revisada em 28/10/2026 — a linha com PP troca de tipo, entre os
> tipos com PP, e o faturamento sem previsão pede a data.** Até aqui o tipo
> só mudava sem nada lançado no item (§9), e o job que abriu sem faturamento
> recusava a alteração que cria faturamento, mandando pedir errata (§4).
> Agora a linha com PP ou PP a emitir troca entre AR, B, C, F e FI (o BV
> segue travando), e o pop-up pede a data de recebimento do valor que entra
> sem previsão para acompanhar. Ver §12.

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
   `faturamento_previsto_abertura`) **depois que o job abriu** — na fila,
   ela anda junto (§10) — e a **curva de desembolso**, com o
   `custo_previsto_total`. O planejado só muda no serviço Interno (decisão
   105), em que o banco o faz espelhar o orçado (`planejado_espelha_orcado`),
   e, desde 14/10/2026, com o job na fila da abertura, pelo próprio
   financeiro (§11).
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
| Previsão de recebimento vazia que precisaria andar | "O job abriu sem faturamento previsto e não tem previsão de recebimento para acompanhar a alteração. Valor novo precisa de data: peça a errata à produção, que devolve o job para a revisão da abertura." (e a variante do mês, no mensal). ⚠️ Desde 28/10/2026, só quando o faturamento DIMINUI; quando ele entra, o pop-up pede a data (§12) |
| Faturamento que entra sem previsão e sem a data do pop-up (28/10/2026) | "Novembro não tem previsão de recebimento para acompanhar a alteração: informe a data de recebimento no pop-up da alteração." (ou "O job …") |
| Parcela do envio que zeraria | "Com essa alteração, uma parcela do envio para faturamento ficaria zerada ou negativa, e o envio não aceita parcela sem valor." |
| Troca de tipo em linha com PP, PP a emitir ou BV (na action e no banco; 08/10/2026) | "\"Item\" já tem Pedido de Produção: o tipo de custo só muda enquanto nada foi lançado no item." (ou "PP a emitir", ou "BV"). ⚠️ Desde 28/10/2026 vale só para o BV e para a PP em linha A ou D (dado antigo) |
| Troca de tipo em linha com PP ou PP a emitir para A ou D (na action e no banco; 28/10/2026) | "\"Item\" já tem Pedido de Produção: o tipo de custo só muda entre os tipos que geram PP (A · Repasse, B, C, F · Externo e F · Interno)." (ou "PP a emitir") |
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

## 10. A revisão de 13/10/2026: a edição na fila entra no valor inicial

### O pedido

Com o AMB-1030/26 na tela: o financeiro ajustou o Transporte Equipe de
R$ 3.500,00 para R$ 3.500,89 às 21:48 de 08/10, abriu o job às 21:50, e o
cabeçalho do job mostrou "Valor do job · inicial R$ 229.998,76" e "atual
R$ 230.000,00". Pedido do Tiago: *"caso o financeiro fizesse alguma edição
antes da abertura, esse valor viesse como o valor inicial."*

### A regra

1. **Edição com o job na fila da abertura** (`aguardando_abertura`): a foto
   da abertura — `valor_job_abertura` e `faturamento_previsto_abertura` —
   anda junto com os números do job. O job abre com o valor já editado, e
   o "inicial" é esse valor.
2. **Edição depois da abertura:** nada muda. A foto fica, e o cabeçalho, o
   card de Erratas e o card de Totais continuam separando inicial e atual
   (§3, item 8).
3. **O Resultado op. (planejado)** usa o valor do job da abertura, então
   também passa a contar a edição da fila.
4. **Retroativo, nos jobs já abertos:** autorizado pelo Tiago em 13/10/2026
   ("Sim, os 10"). Os dois campos receberam o `*_depois` da última edição
   feita antes da abertura — em todos, o mesmo número da foto nº 1 de
   `jobs_aberturas`:

   | Job | Valor do job na abertura | Faturamento previsto na abertura |
   |---|---|---|
   | AMB-1006/26 | 145.000,12 → 145.000,00 | igual ao valor |
   | AMB-1007/26 | 6.999,99 → 7.000,00 | igual ao valor |
   | AMB-1008/26 | 307.000,02 → 283.000,00 (5 influenciadoras zeradas e o gerador ajustado) | 286.550,02 → 283.000,00 |
   | AMB-1029/26 | 23.720,03 → 23.753,72 | 3.299,03 → 23.753,72 (5 linhas de A para AR) |
   | AMB-1030/26 | 229.998,76 → 230.000,00 | igual ao valor |
   | ANI-1011/26 | 135.000,02 → 135.000,00 | igual ao valor |
   | ASO-1004/26 | 55.000,12 → 55.000,00 | igual ao valor |
   | EDU-1001/26 | 120.000,02 → 120.000,00 | igual ao valor |
   | TES-1014/26 | 9.464,40 (editado e desfeito: não mudou) | — |
   | TES-1025/26 | 172.620,85 → 176.261,34 | 142.620,85 → 161.261,34 |

   Nos 8 jobs reais não houve errata nem edição depois da abertura: o
   cabeçalho passou a mostrar um valor só.

### Onde mora

- **Banco:** `registrar_alteracao_do_financeiro` grava os dois campos da
  foto quando o job está em `aguardando_abertura`
  (`20261013800001_alteracao_na_fila_entra_na_abertura.sql`, que também
  faz o retroativo).
- **Tela:** o "inicial" é recalculado da versão aprovada (decisão 151) e
  conferido contra o `valor_job_abertura`. Agora a versão entra com as
  edições da fila aplicadas — `itensDaVersaoComAsEdicoesDaFila`, em
  `lib/calculos/abertura-do-job.ts`, alimentada em `carregarDetalheDoJob`
  pelo histórico de `jobs_alteracoes_financeiro` anterior a
  `data_abertura_financeiro` (a última edição de cada linha vence; o total
  é `R$ Unit. × QT × D/M`, a mesma conta da coluna gerada). Vale para a
  conta do job e para o orçado de cada linha na abertura, que é a base da
  rentabilidade planejada.

### Conferência (13/10/2026)

- **A conta**, com as funções do código sobre os dados do banco: nos 10
  jobs a foto com as edições da fila reproduz o `valor_job_abertura` novo
  ao centavo; só com a versão, como era, não reproduziria em 9 deles.
- **A função, por simulação desfeita como o usuário Financeiro Teste:** no
  TES-1012/26 (na fila), valor do job de R$ 139.182,30 para R$ 139.200,00
  levou junto `valor_job_abertura` e `faturamento_previsto_abertura`; no
  TES-1013/26 (aberto), +R$ 10,00 mudou o valor do job e deixou a foto em
  R$ 1.391,82. Nada ficou gravado.
- **A tela, logada (14/10/2026):** AMB-1030/26 com "Valor do job
  R$ 230.000,00" único e Resultado op. (planejado) R$ 83.001,00 (era
  R$ 83.000,00 sobre o inicial antigo); TES-1025/26 com R$ 176.261,34 único
  (antes, inicial R$ 172.620,85 × atual R$ 176.261,34); TES-1014/26, cuja
  errata mudou o valor, continua dividindo inicial R$ 9.464,40 × atual
  R$ 9.631,42; AMB-1008/26 com R$ 283.000,00 único.

### O que o retroativo mostrou no AMB-1008/26

As 5 influenciadoras (A · Direto) foram zeradas no orçado pela edição da
fila (D/M 0), mas o planejado delas continua em R$ 20.450,00 — a edição do
financeiro não mexe no planejado (§3, item 8), e o planejado é o da
abertura (decisão 151). Com o inicial antigo, os R$ 24.000,02 delas
compensavam esse custo; com o inicial novo, o Resultado op. (planejado)
foi de R$ 54.596,80 (17,8%) para R$ 31.290,10 (11,1%), e os grupos INFLUS
mostram rentabilidade planejada de −R$ 16.500,00 e −R$ 3.950,00. A conta
está certa para o job como abriu; o que fazer com esse planejado ficou
para o Tiago decidir.

> ⚠️ **Decidido em 14/10/2026.** As influenciadoras eram de outra
> abertura: o planejado delas foi zerado (D/M 0) pelo banco, com as
> linhas conferidas com o Tiago antes, e o financeiro passou a editar o
> planejado na fila para o caso não se repetir. Ver §11.

## 11. A revisão de 14/10/2026: o financeiro edita o planejado na fila

### O pedido

Sobre o AMB-1008/26 (§10): "os itens zerados deveriam estar em outras
planilhas, o financeiro ajustou para não gerar tanto retrabalho e informou
a abertura a fazer outra abertura com os influs. Desse modo, para que
situações como essa possam ser facilmente resolvidas, penso que o
financeiro deve poder editar o planejado também enquanto o job ainda não
tiver sido aberto." E, no caso específico, zerar o planejado pelo D/M,
"para manter as linhas e o histórico na planilha", conferindo as linhas
antes.

### A regra (confirmada pelo Tiago no mesmo dia)

1. **Na fila da abertura** (`aguardando_abertura`), o "Editar orçado" abre
   também R$ Unit., QT e D/M do **planejado**.
2. **Depois da abertura**, o planejado continua travado para o
   financeiro — ele é o da abertura (decisão 151). A célula diz "O
   planejado é o da abertura do job: o financeiro só o edita com o job na
   fila da abertura.", a action e a função do banco recusam.

   > ⚠️ **15/10/2026 (decisão 175):** o planejado deixou de ser "o da
   > abertura" — depois dela ele muda pela errata da produção. O
   > financeiro segue editando-o só na fila; a célula agora diz "O
   > financeiro só edita o planejado com o job na fila da abertura. Depois
   > dela, o planejado muda pela errata."
3. **As exceções do orçado valem:** Interno (o planejado espelha o orçado,
   decisão 105), linha com save, linha vermelha e linha cancelada ficam
   fechados.
4. **Motivo obrigatório**, como antes. O pop-up passa a "O que muda na
   planilha" e mostra o planejado de → para da linha, na cor do bloco
   Planejado; o card "Alterações do Financeiro" ganha o selo "Planejado"
   (quando só ele mudou) e o planejado de → para embaixo do valor orçado;
   o fio da Comunicação diz "Planejado · item: de → para".
5. **O custo previsto acompanha** (é o planejado dos tipos com PP); **o
   cronograma de desembolsos não**: fica com o que o financeiro já
   distribuiu, o formulário mostra "Falta" ou "Sobra" com o "Distribuir",
   e a abertura não confirma até a soma bater com o custo previsto. Foi o
   que o Tiago confirmou ao perguntar o que "a curva não acompanha"
   queria dizer. Valor do job, faturamento, recebimento e impostos não
   mudam com o planejado.

### Onde mora

- **Banco** (`20261014600001`): `jobs_alteracoes_financeiro_itens` ganha
  o planejado de → para (R$ Unit., QT, D/M e total), nulo nas alterações
  de antes desta revisão; `registrar_alteracao_do_financeiro` grava o
  planejado que vem no payload e recusa a mudança fora da fila. Payload sem
  planejado (aba aberta antes) mantém o de hoje.
- **Tela:** `useRascunhoErrata(…, planejadoAberto)` libera o planejado das
  linhas comuns; a seção liga com o modo financeiro e o job na fila;
  `linhasAlteradasPeloFinanceiro` conta a linha em que só o planejado
  mudou; a action manda o planejado só na fila e fora do Interno.
- O selo usa `SELO_PLANEJADO`, novo em `app/(app)/_planilha/blocos.ts`.

### A correção do AMB-1008/26 (`20261014600002`)

As 5 linhas conferidas com o Tiago — ordem 89 a 93, grupos INFLUS -
SALVADOR e INFLUS - RECIFE, tipo A, sem PP, BV, save nem realizado —
tiveram o D/M do planejado de 1 para 0 (R$ 20.450,00 → R$ 0,00); R$ Unit.
e QT ficaram. Registrada no card "Alterações do Financeiro" em nome do
Tiago, como ele pediu, com o motivo. A migration só roda se encontrar
exatamente essas 5 linhas. Resultado op. (planejado): R$ 31.290,10 (11,1%)
→ R$ 51.740,10 (18,3%). Custo previsto (R$ 175.990,00), curva e fluxo de
caixa não mudaram: o tipo A não entra neles.

### Conferência (14/10/2026)

- **AMB-1008/26, na tela:** os grupos INFLUS com orçado e planejado
  zerados e sem rentabilidade negativa; cabeçalho com R$ 51.740,10; o card
  com a entrada nova, selo "Planejado" e "D/M 1 → 0" em cada linha.
- **De ponta a ponta, na fila (TES-1029/26, criado para o teste):** o
  orçamento "Teste A" (TES-P001/26-07) foi aprovado e enviado à abertura
  pela tela, renomeado "ZZ Teste 115 planejado na fila". Na aba Planilha
  da abertura, com o "Editar orçado", o planejado do Item 2 de outubro foi
  de R$ 8.000,00 para R$ 7.000,00: o pop-up mostrou o planejado de → para
  e "O custo previsto muda −R$ 1.000,00"; gravou. A aba Abertura do Job
  passou a custo previsto R$ 35.000,00 com o cronograma em R$ 36.000,00 e
  "Sobra de R$ 1.000,00"; o card e o fio da Comunicação mostraram
  "Planejado · Item 2: R$ 8.000,00 → R$ 7.000,00". O job ficou na fila.
- **Depois da abertura (TES-1013/26):** no "Editar orçado" o planejado não
  abre e mostra o motivo; saída sem gravar. Por simulação desfeita como o
  Financeiro Teste, a função recusou a mudança do planejado.

## ⚠️ Os parâmetros do job — 2026-10-28 (decisão 224)

A mesma permissão, a mesma função (`registrar_alteracao_do_financeiro`, que
agora aceita `p->'parametros'` com o de → para) e o mesmo card de
Alterações do Financeiro passam a registrar também os **parâmetros do job**
— honorários/fee, impostos, as taxas do internacional e o câmbio — editados
na linha de parâmetros da Planilha Interna. Na fila tudo se edita; depois da
abertura, só o câmbio. A alteração só de parâmetros chega ao card como
"Parâmetros do job" e não entra no Histórico da planilha. Ver a
[224](224-parametros-do-job-na-abertura.md).

## 12. A revisão de 28/10/2026: o tipo da linha com PP e a data do faturamento que nasce

### O pedido

O UER-1002/26 (Always On da Universal, aberto no financeiro, com PPs) nasceu
com as 35 linhas em F · Interno, e devia ser A · Repasse com os honorários
zerados. A errata da produção não serve: ela não mexe em linha com PP no
financeiro (decisão 040), e 9 das 35 linhas tinham. O "Editar orçado"
também não: travava o tipo em linha com PP (§9) e recusava a alteração que
cria faturamento num job que abriu sem faturamento (§4). O Tiago pediu para
"liberar que o financeiro possa alterar o tipo de custo em sua função
alterar orçado", e respondeu às duas perguntas que isso abria:

- **Linha com PP:** troca "só entre tipos com PP" — AR, B, C, F e FI, a
  calha PP da decisão 004. A e D continuam fora: neles o cliente paga o
  fornecedor direto, e a PP emitida perderia o sentido.
- **Job sem previsão de recebimento:** "pedir a data no Salvar", em vez de
  voltar o job à revisão da abertura.

### A regra

1. Sem nada lançado no item, o tipo muda para qualquer tipo, como desde
   08/10/2026.
2. Com PP (qualquer situação fora de cancelada, inclusive a que já chegou
   ao financeiro) ou PP a emitir, a lista só traz AR, B, C, F e FI. A PP
   fica como está: valor, NF e pagamento não mudam.
3. Com BV fora de cancelado, o tipo continua travado — o BV só existe em A,
   AR e D e não se resolve por efeito colateral. A PP numa linha A ou D
   (dado antigo; o banco não deixa nascer) também.
4. O job (ou o mês do mensal) sem nenhuma parcela de previsão de
   recebimento, em que a alteração FAZ ENTRAR faturamento, mostra no pop-up
   "Meses sem previsão de recebimento: informe a data", com um campo por
   mês e o valor que entra. A confirmação espera todas as datas. Cada mês
   ganha uma parcela com a data informada e o valor que entra; o
   calendário abre no mês seguinte ao de referência, como na abertura
   (decisão 149). Com o job na fila, nada disso: a previsão é do formulário
   da abertura.
5. Faturamento que DIMINUI sem previsão nenhuma segue recusado, com a frase
   antiga (dado fora do lugar, que a errata resolve).
6. Os recolhimentos de imposto previstos não ganham parcela nova: se o
   imposto previsto passar a existir num job sem recolhimento, ele fica sem
   previsão de recolhimento, como já ficava (não foi pedido; ver a
   conferência).

### Onde mora

- **Regra pura:** `lib/calculos/alteracao-financeiro.ts` (`travaDoTipo`,
  `trocaDeTipoPermitida`, `motivoDaTrocaRecusada`), com
  `lib/calculos/alteracao-financeiro.test.ts`.
- **Banco:** `travas_do_tipo_nas_linhas_do_job` (definer, PP / PP a emitir /
  BV separados; a antiga `lancamentos_nas_linhas_do_job` fica, sem uso) e
  `registrar_alteracao_do_financeiro` com a trava nova e o bloco
  `recebimento_novo` (insere a parcela; recusa na fila e quando o mês já tem
  previsão). Migration `20261028600001`.
- **Action:** `registrarAlteracaoDoFinanceiro` aceita `recebimentos_novos`
  (mês e data; o valor é a conta do servidor) e grava o "depois" da
  previsão com a parcela nova.
- **Tela:** a célula de tipo na Planilha Interna (`job-item-realizado-table`)
  e o pop-up (`edicao-financeiro-confirmar-dialog`).

### Conferência (28/10/2026)

- **TES-1035/26** (Always On do P-0006/26, novembro com faturamento e sem
  parcela de previsão, herança da decisão 219): no "Editar orçado", a linha
  de novembro foi de R$ 5.000 a R$ 5.100. O pop-up pediu a data de novembro
  (R$ 139,18) e travou o Confirmar até a data; com 21/12/2026, gravou a
  parcela 2 (novembro, 21/12/2026, R$ 139,18), o job foi a R$ 14.057,41 e o
  card registrou o antes → depois. Desfeito pelo mesmo caminho: a parcela
  acompanhou (R$ 139,18 → R$ 0,00) e o job voltou a R$ 13.918,23; a parcela
  ficou com R$ 0,00.
- **UER-1002/26**, sem gravar: na linha com PP (Shook Na Vozz) a lista trouxe
  só AR, B, C, F e FI, com o motivo no `title`; na linha sem PP (Artista J.),
  os sete tipos. Saída pelo Descartar.
- **Banco, em transação desfeita (como o Tiago):** FI → A na linha com PP
  foi recusado com a frase nova; FI → AR na mesma linha, com
  `recebimento_novo`, passou e criou a parcela. Depois do rollback, o job
  seguia com 35 linhas FI e nenhuma previsão.
