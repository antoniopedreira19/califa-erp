# 233 — A produção altera os parâmetros do job pela errata

**Data:** 2026-11-03
**Status:** implementada e testada pela tela em 03/11/2026 (migration
`20261103600001_parametros_do_job_pela_errata.sql`); revista no mesmo dia
(sem selo na linha, histórico com os parâmetros, PP liberada).
**Quem decidiu:** Tiago. Pedido em 03/11/2026: "Assim como o financeiro
consegue editar impostos, honorários e os campos de job internacional, com o
job já aberto quero que produção também possa pelo módulo de job, clicando
em 'editar planilha' e gerando uma errata sujeita a aprovação do financeiro
para que seja aprovado."
**Estende:** a [224](224-parametros-do-job-na-abertura.md) (os parâmetros do
job, até aqui só do financeiro) e a [159](159-errata-pronta-para-envio.md) (a
errata pronta do produtor).

## As respostas do Tiago (03/11/2026)

1. **Vale como a errata de hoje.** Os números do job mudam na hora (valor do
   job, faturamento previsto) e o job volta ao mural "Erratas" do
   financeiro, que revisa a abertura — a mesma "aprovação" de qualquer
   errata. Sem botão de recusar. (A outra leitura, os parâmetros esperando a
   aprovação como o pedido de save da 099, foi recusada.)
2. **Quem: como a errata.** O produtor deixa a errata pronta com os
   parâmetros; o GP (ou o administrador) revisa e envia ao financeiro.
3. **Até quando: a trava da errata.** Job aberto e **sem envio para
   faturamento** — no mensal, nenhum mês enviado, porque os parâmetros mexem
   em todos os meses. Depois disso, só o financeiro, pelo "Editar planilha"
   dele, que já acompanha o envio sem nota (224). Em 03/11/2026 eram 19 jobs
   abertos com envio e sem nota (13 nacionais, 1 internacional, 5 mensais):
   nesses, a produção vê o cadeado. A produção nunca mexe em envio.

## Como fica

- **Planilha Interna da produção:** a linha de parâmetros da 224 (Honorários
  · Impostos; no internacional Fee · Int. taxes · Impostos BR · Int.
  transaction costs e a linha do câmbio) aparece também aqui. Fora do
  "Editar planilha" é só leitura. Com ele, abre junto com a planilha — sem
  botão próprio —, como no financeiro. Mídia Off fica de fora (não tem
  errata).
- **Barra e pop-up da errata:** contam os parâmetros ("1 parâmetro
  alterado"), fazem a conta do faturamento e do valor do job com eles e
  mostram o bloco "O que muda nos parâmetros" com o de → para. A errata só
  de parâmetros é errata (não cai no "Salvar linha vermelha" da 226).
- **Errata pronta:** guarda os parâmetros em `conteudo.parametros`; o GP a
  reabre com eles. O resumo da faixa diz "parâmetros do job alterados".
- **Financeiro:** o resumo da errata no mural, a faixa da revisão da
  abertura e o card de Erratas (aba Informações do Job) mostram o de → para
  dos parâmetros. A revisão em si é a de sempre: as previsões de recebimento
  e de impostos ficam com o "Falta R$ …" até o financeiro ajustar e
  registrar.

## Banco

`20261103600001_parametros_do_job_pela_errata.sql` (aditiva):

- `jobs_erratas.parametros` — `{de, para, campos}`: `de`/`para` no formato de
  `jobs_parametros`; `campos`, os rótulos de → para como o pop-up mostrou,
  congelados como os nomes da organização (162). Nulo nas outras erratas.
- `gravar_parametros_da_errata(errata)` — grava o `para` em
  `jobs_parametros`. `SECURITY DEFINER`, porque a escrita direta na tabela
  continua só de administrador e financeiro (policies da 224) — o GP não
  ganha porta para mudar honorários sem errata. Só aceita a errata que o
  próprio usuário (GP ou administrador) registrou na mesma transação
  (`created_at = now()`), recusa job com envio para faturamento e recusa se o
  `de` não for o de hoje ("os parâmetros do job mudaram enquanto a errata
  estava aberta").
- `registrar_errata_do_job` — grava `parametros` na errata e chama a função
  acima antes dos números do job.

## Código

- `lib/calculos/parametros-do-job.ts` — a conferência do pedido
  (`parametrosDoPedido`), o schema, a leitura da view e o
  `camposDaAlteracao` (saiu do componente para o servidor poder congelar os
  rótulos). A action do financeiro (`actions-alteracao-financeiro.ts`) passou
  a usar o mesmo módulo, sem mudança de comportamento.
- `actions-errata.ts` — `conteudo.parametros`; trava do envio
  (`MENSAGEM_PARAMETROS_DEPOIS_DO_ENVIO`); a conta do "depois" e o efeito de
  cada linha com os parâmetros novos; auditoria `parametros_alterados` em
  `job.errata_registrada`.
- `ConteudoErrata.parametros` é **obrigatório** no tipo: no primeiro teste a
  leitura da pronta (`carregar-detalhe.ts`) remontava o conteúdo campo a
  campo e descartava os parâmetros em silêncio — o GP reabria a errata sem
  eles.

## Teste (03/11/2026, TES-1029/26 do P-0006/26)

Pela tela, no servidor do worktree: o **Produtor Teste Claude** abriu
"Editar planilha", passou honorários de 12% para 15% (valor do job
R$ 69.591,15 → R$ 71.455,20 = 50.000 × 1,15 ÷ 0,8047) e deixou a errata
pronta — job intacto no banco. O **GP Teste** reabriu a pronta com 15% e
confirmou: job em R$ 71.455,20, `jobs_parametros` em 15%, errata com
`parametros` e `preparada_por`, pronta `enviada`, job no mural. O financeiro
(administrador) viu o de → para no mural e na revisão; **a revisão ficou
pendente** (o TES-1029/26 segue na faixa Erratas, para o Tiago conferir a
aprovação). No TES-1036/26 (internacional, enviado para faturamento) o GP vê
o cadeado com o motivo e sem "Editar câmbio".

**Não testado na tela:** a errata de parâmetros num job internacional
editável (não havia nenhum aberto e sem envio) e no mensal.

## ⚠️ Revisão de 2026-11-03 — sem selo, histórico com os parâmetros, PP liberada

Pedido do Tiago, sobre os prints: "Não precisa do ícone 'parâmetros
alterados' ou alterado pelo financeiro, ao lado do campo. Isso fica
registrado nas erratas e histórico de versões. Além disso, ao realizar esse
tipo de errata, PPs devem continuar podendo ser geradas [...] (apenas o envio
a faturamento e encerramento, como qualquer errata)".

- **O selo saiu** da linha de parâmetros, nas telas da produção e do
  financeiro ("Alterado na abertura", "Alterado pelo financeiro", "Alterado
  por errata", "Parâmetros alterados"). O registro fica no card de Erratas,
  no de Alterações do Financeiro e no Histórico.
- **O Histórico registra os parâmetros** (decisão 186), no job e no
  orçamento: o momento que mudou honorários, impostos, taxas ou câmbio — a
  errata e também a alteração do financeiro só de parâmetros, que antes não
  aparecia — mostra "1 parâmetro alterado" na lista e o chip "Honorários
  12% → 15%" na faixa. Cada versão guarda os parâmetros que valiam nela
  (`VersaoDaPlanilha.parametros`, desfeitos momento a momento a partir de
  `vw_parametros_do_job`): o valor do job da versão, a planilha e a linha de
  parâmetros da versão antiga saem deles, e não dos de hoje. Antes, a versão
  anterior a uma mudança de parâmetro mostrava o valor com os parâmetros
  novos. Na versão "Aprovada pelo cliente" do orçamento continua valendo a
  versão.
- **PP:** a errata só de parâmetros não trava PP. Gerar nunca dependeu da
  revisão; o envio ao financeiro trava só na linha que a errata alterou
  (decisão 185), e esta não altera linha. Travam, como em qualquer errata, o
  envio para faturamento e o envio para encerramento até a revisão da
  abertura. Conferido pela tela: com o TES-1029/26 em revisão, o GP gerou a
  PP-00729 (R$ 100,00, Item 2 · Novembro) e o painel mostra "Enviar ao
  financeiro" livre, sem aviso de errata; o rodapé mostra faturamento e
  encerramento travados pela revisão. A PP-00729 ficou gerada, sem envio.

## ⚠️ Revisão de 2026-11-03 (2) — o orçamento mostra os parâmetros do job, versão a versão

Pedido do Tiago: "O orçamento deve ser modificado [...] de modo que as
modificações nesses campos fiquem atreladas a versões no histórico também."

- A versão aprovada do orçamento que mostra o job (decisão 226) passa a
  mostrar também os **parâmetros do job**: a linha "Honorários · Impostos"
  (e a do internacional), o resumo do topo (valor do job, resultado,
  rentabilidade), a planilha, o card de Totais, o percentual da aba e as
  exportações (a da versão e a do projeto). `planilhaDoJobNaVersao` traz
  `parametros` (`jobs_parametros`, nulo quando nada mudou) e quem a usa passa
  a versão por `comParametrosDoJob`. A versão gravada não muda.
- **Histórico do orçamento:** cada versão escolhida fecha a planilha e os
  Totais com os parâmetros dela — "Aprovada pelo cliente" com os da versão,
  e cada errata ou alteração do financeiro com os que deixou. No mensal, os
  meses também. O valor de cada versão na lista sai da mesma conta.
- **O cabeçalho acompanha** (pedido do Tiago no mesmo dia): com uma versão
  escolhida no Histórico, a linha "Honorários · Impostos" e o resumo do topo
  (valor do job, resultado, rentabilidade) mostram os dela. O estado do
  Histórico (`HistoricoDoOrcamento`) passou a envolver a página inteira da
  versão; a faixa ficou acima da planilha (`FaixaDoHistorico`), e o
  cabeçalho usa `MetaVersaoDoHistorico` e `ResumoDoHistorico`
  (`cabecalho-do-historico.tsx`). Conferido: "Aprovada pelo cliente" 12% ·
  R$ 69.591,15 · R$ 20.000,00 · 28,7%; honorários zerados 0% ·
  R$ 62.134,96; errata 233 15% · R$ 71.455,20 · R$ 22.500,00 · 31,5% — os
  mesmos números do card de Totais de cada versão.
- Teste no TES-1029/26: o orçamento mostra 15% e R$ 71.455,20; no Histórico,
  "Aprovada pelo cliente" fecha com Honorários (12%) R$ 6.000,00 e valor
  R$ 69.591,15, e a errata 233 com Honorários (15%) R$ 7.500,00 e
  R$ 71.455,20. A exportação da versão saiu com honorários 0,15 e
  faturamento R$ 71.455,20.

