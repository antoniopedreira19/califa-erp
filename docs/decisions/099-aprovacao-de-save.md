# 099 — O save passa pela aprovação do financeiro, linha a linha

**Data:** 2026-09-22
**Decidido por:** Tiago (regras fechadas entre 21 e 22/09/2026, sobre o
protótipo clicável aprovado)
**Migrations:** `20260922140001_aprovacao_de_save.sql`,
`20260922140002_financeiro_ve_save_na_aprovacao.sql`,
`20260922140003_aprovacao_de_save_em_vigor.sql` (aplicada junto do deploy, em
23/09/2026),
`20260922140004_saldo_de_save_em_reais.sql`,
`20260922140005_rentabilidade_volta_ao_original.sql`,
`20260922140006_retirar_save_nao_enviado.sql`,
`20260922140007_recusa_de_save_com_errata.sql`,
`20260922140008_save_quem_pede_e_mes_enviado.sql`,
`20260922140009_save_revisao_das_correcoes.sql` (correções de 23/09),
`20260924100001_save_administrador_e_gp.sql` e
`20260924100006_mes_do_pedido_de_save.sql` (revisão de 24/09, §7).

Revê a [028](028-save-entre-jobs.md) na nota de 01/09/2026 (o saldo de save
só era oferecido depois do envio do job ao faturamento). O resto da 028 —
o que o save é, a conta, o saldo do job — continua valendo.

---

## 1. O problema

Qualquer GP marcava uma linha como save e, no envio para faturamento, o
crédito passava a existir para os outros jobs do cliente. Ninguém do
financeiro conferia se aquilo era mesmo save, e o consumo desse crédito por
outro job também não passava por ninguém. O save move dinheiro entre jobs:
precisa de dono.

## 2. A regra

1. **Cada linha que gera save e cada linha que consome save é um pedido**
   de aprovação (`saves_aprovacoes`). Só administrador ou financeiro decide.
2. **De onde vem o pedido:**
   - save ou consumo definido no **orçamento** segue com o envio para
     abertura e entra na fila quando o financeiro registra a abertura
     (momento `abertura`; `reenvio` no job devolvido e reenviado);
   - no **job aberto**, a errata de save vira pedido na hora e põe o job
     na revisão da abertura (momento `job_aberto`);
   - job aberto antes deste fluxo: botão **"Enviar N saves para
     aprovação"** acima da planilha (`legado_botao`);
   - job encerrado/finalizado ou já enviado ao faturamento: aprovado na
     migration (`legado_migracao`). Em 22/09/2026: JOB-0032 · Item 6.
3. **Números:** a produção vê o pedido **na hora** (planilha, cabeçalho e
   Totais calculam pelos itens); o financeiro vê **só na aprovação** — os
   espelhos `jobs.valor_total`, `faturamento_previsto` e
   `faturamento_save_previsto`, e o fluxo de caixa, não mudam por um pedido
   `job_aberto` que aguarda. A conta "como o financeiro vê" é uma só:
   `lib/calculos/save-financeiro.ts` (TypeScript) e
   `vw_itens_orcado_financeiro` / `vw_saves_consumos_financeiro` (banco).
4. **Recusa** desfaz só o efeito daquele pedido: a linha volta ao estado de
   logo antes dele. Pedido que o financeiro já contava (abertura, reenvio,
   legado) é errata de save ao ser recusado: os números mudam na hora e o
   job volta para a revisão. A linha recusada continua com o ícone de save
   (sem a hachura) e travada para errata — e, a que gerava save, também
   para PP e BV — até o GP arquivar a recusa ("Retirar").
5. **Saldo** para outros jobs: só save **aprovado**. Consumo que aguarda
   reserva a origem; edição de consumo aprovado reserva o maior entre antes
   e depois até a decisão. Um job nunca consome o próprio saldo.
6. **Aprovar é registrar a revisão da abertura:** "Aprovar save" leva à
   revisão do job no financeiro (`?aba=abertura&aprovarSave=<id>`), e só o
   registro dela aprova.
7. **Retirar:** sempre com aviso. Save gerado até o envio para
   encerramento; consumo até o envio para faturamento (mensal: por mês).
   Save aprovado cujo saldo já começou a ser usado não sai. Retirar um
   aprovado é errata de save, com os números do financeiro na hora.
8. **Depois do envio ao faturamento** gerar save continua possível;
   consumir não.
9. **Travas:** errata travada nas linhas com save; gerar save exige a linha
   sem PP e sem BV não cancelados; PP e BV travados na linha que gera save;
   encerramento travado com save pendente ou não enviado e com revisão
   pendente; envio para faturamento travado com consumo aguardando ou
   nunca enviado para aprovação.
10. **Links entre módulos:** saem os da produção para o financeiro e os
    redirects do financeiro para `/jobs`. Os do orçamento ficam.

Textos aprovados, estados do pop-up e o contrato completo:
`docs/handoffs/HANDOFF_JOBS.md` e `HANDOFF_FINANCEIRO.md` (notas de
22/09/2026).

## 3. Onde a regra mora no banco

- `saves_aprovacoes` é **só leitura** para o cliente. Tudo muda por RPC
  SECURITY DEFINER, numa transação só com a linha, a errata e os números:
  `save_pedir`, `save_enviar_pendentes`, `decidir_pedido_save`,
  `cancelar_pedido_save`, `save_retirar`, `save_retirar_nao_enviado`.
  O fluxo antigo gravava a errata antes da linha e, quando a linha
  falhava, deixava errata fantasma.
- Em job aberto, a marca de save e o consumo da linha só mudam pelas RPCs
  (a partir da `20260922140003`); em pré-abertura e job devolvido a cópia
  segue editável direto.
- `save_uso_linhas` é a conta do saldo usada pela tela e pelo trigger, fora
  da RLS do pedido — senão um GP de outra regional via mais saldo do que o
  banco aceita.
- `save_marcado_por`, `save_marcado_em` e `planejado_antes_save` nas linhas:
  quem marcou e o planejado que o save zerou, devolvido quando o save sai.
- **Quem pede, retira ou envia o legado** é conferido no banco
  (`save_pode_mexer_no_job`, desde a `20260922140008`): administrador, ou
  GP/produtor **responsável** pelo job — a mesma regra de `quemPodeMexer` da
  tela. As actions conferem o mesmo antes (`acao_negada` na auditoria).
  Cancelar pedido segue aberto a quem enxerga o job, como a especificação
  pede. ⚠️ **Revisto em 24/09/2026 (§7):** administrador ou qualquer GP,
  responsável ou não; o produtor não mexe no save, e cancelar pedido
  passa pela mesma regra. Sem isso, pela API, o financeiro pedia save num job aberto e
  aprovava o próprio pedido. ⚠️ A trava do banco é das RPCs de job
  **aberto**: na cópia do job em pré-abertura ou devolvido a escrita segue
  direta, por desenho, e ali a conferência do responsável é só da action
  (ver §6).
- O cache `jobs_itens_orcado.save_consumido` também só muda pelo fluxo de
  save em job aberto, no UPDATE e no INSERT (`trg_save_consumido_trava`, só
  com a `140003` ligada): a trava de errata da linha que consome lê esse
  cache.
- **Mensal:** o envio do mês guarda a parte de save dele
  (`jobs_envio_faturamento.valor_save`), que a fila do contas a receber e o
  fluxo de caixa leem. Toda RPC que muda os números do financeiro regrava
  também o `valor_save` dos meses já enviados (`saves_por_mes` no
  `p_totais`, calculado por `totaisParaRpc` com a mesma conta do envio). Se
  um mês for enviado entre a leitura da tela e a gravação, o banco recusa
  ("Um mês deste job acabou de ser enviado para faturamento. Tente de
  novo.") em vez de deixar o `valor_save` dele velho.
- **Imposto previsto da abertura ([decisão 100](100-previsao-de-impostos-na-abertura.md)):**
  `impostoDoJob` segue a mesma conta "como o financeiro vê" do faturamento
  — pedido `job_aberto` aguardando desfeito, o pedido que a revisão aprova
  contado —, na página da revisão e na action que a registra (ajuste feito
  no merge das duas decisões, 23/09/2026).

## 4. Decisões tomadas na implementação (confirmadas pelo Tiago em 22/09/2026)

- **Consumo de rascunho** não conta como uso para a trava de retirada
  (segue a 028: rascunho reserva e avisa, não impede). A aprovação da
  versão revalida o saldo e recusa se o crédito tiver saído.
- **PP e BV** travam só na linha que **gera** save; a linha que consome é
  serviço que acontece no job e continua aceitando PP e BV.
- **Permissão de aprovar:** a mesma de registrar a abertura
  (`jobs.abrir_financeiro`), porque aprovar é registrar a revisão.

## 5. Correções da conferência final (23/09/2026)

A conferência no navegador antes do merge — como administrador, como
financeiro (o usuário de teste com o papel trocado e devolvido) e como GP —
achou oito defeitos desta própria entrega, todos corrigidos e retestados:

1. O bloco **"Saves deste job"** da conferência da abertura nunca aparecia:
   a fila não lia `status` (linha `any`, nenhum verificador acusava).
2. **Mensal:** aprovar ou retirar save num mês já enviado não mudava a parte
   de save do envio daquele mês — o financeiro via o mês inteiro como
   receita própria (ver §3).
3. As actions de save da produção não conferiam o **responsável** do job.
4. As RPCs de pedir, retirar e enviar legado não conferiam **papel**.
5. O cache `save_consumido` não tinha trava (brecha da errata com a `140003`
   ligada).
6. No **reenvio** do job devolvido, o formulário e a confirmação mostravam o
   fechamento da versão, e o reenvio grava o da cópia do job. Agora mostram
   "Fechamento do job devolvido", com os números que serão gravados.
7. O pedido que nasce na abertura/reenvio gravava como **autor** o
   financeiro que registrou a abertura; agora é quem marcou a linha ou gravou
   o consumo.
8. O "livre" do pop-up no orçamento em rascunho somava de volta um consumo
   que o saldo nunca descontou (rascunho não conta como uso, §4).

As travas da `140003` foram provadas numa simulação com rollback (22
tentativas diretas pela API, com a chave ligada só dentro da transação),
antes de ligá-las em produção. Ligadas em 23/09/2026, depois do deploy do
merge (`cbb9321`, Vercel verde), e conferidas de novo com elas valendo:
escrita direta recusada (marcar save, cache do consumo, consumo, linha
nova em save, orçado da linha em save, planejado da linha que consome,
remoção), planejado da linha sem save aceito; pela tela, errata comum,
pedido de save e cancelamento do pedido gravaram normalmente.

Uma revisão adversarial dessas correções, antes do merge, achou mais seis
pontos menores, corrigidos na `20260922140009` e no código: autor do pedido
só vale se o perfil existe (senão o INSERT quebrava a abertura); trava do
cache também no INSERT; corrida entre o envio de um mês e a gravação;
"Ver dados do job" depois do envio mostra os números gravados (a cópia
enquanto aguarda abertura; os `*_abertura` depois); a frase "itens do job"
no reenvio; e a página do orçamento não lê mais os meses do mensal só para
o fechamento.

## 6. Fora desta entrega

- **Cópia do job em pré-abertura ou devolvido:** a marca de save e o
  consumo seguem graváveis direto por qualquer membro que edita o job (a
  RLS de `jobs_itens_orcado` e `saves_consumos`), e o autor gravado
  (`save_marcado_por`, `created_by` do consumo) vem do cliente. A trava do
  responsável ali é só da action. Fechar no banco muda o que a cópia aceita
  nesses estados: é decisão do Tiago.

- **Regra 21 — nota já emitida:** a aprovação ou retirada de save depois da
  nota deveria redividir job × save nos títulos EM ABERTO dela. Não
  implementado: pede desenho próprio (a divisão hoje é derivada de
  `faturamento_itens` em `vw_titulo_partes`, e mudar ali mudaria também os
  títulos recebidos). ⚠️ **Resolvida em 24/09/2026 pela
  [102](102-rateio-da-nota-acompanha-o-save.md):** o rateio se refaz na
  hora da mudança de save, e o save se apropria também do que já foi
  recebido.
- `vw_job_rentabilidade` (relatórios, frente do Antonio) segue lendo a
  linha crua: durante um pedido aguardando, o relatório já tira a linha do
  imposto previsto e do custo, com o faturamento previsto antigo. A troca
  foi feita e desfeita no mesmo dia (`20260922140005`); a decisão é do
  Tiago com o Antonio. ⚠️ **Resolvido em 24/09/2026 pela
  [103](103-rentabilidade-separa-o-save.md):** o relatório lê as linhas
  como o financeiro vê e tira o save do faturamento do job que o gera.

## 7. Revisão de 24/09/2026 (Tiago)

- **Quem mexe no save:** administrador ou **qualquer GP** — gerar,
  consumir, retirar, cancelar pedido e enviar o legado, no orçamento e no
  job, responsável pelo job ou não. O produtor não mexe no save. O que o
  financeiro precisa é saber quem fez, e isso já vai no pedido
  (`enviado_por`), que a aprovação mostra.
  - Banco: `save_pode_mexer_no_job` passou a "administrador ou GP ativo";
    `cancelar_pedido_save` também confere
    (`20260924100001_save_administrador_e_gp.sql`).
  - Permissões: `jobs.consumir_save` e `orcamentos.marcar_em_save` ficam
    com administrador e GP. A de orçamento existia na matriz, mas nada a
    conferia: agora a tela e as actions do orçamento conferem.
  - A troca de responsável do job deixou de ser risco para o save e segue
    como era.
- **O mês no pedido do mensal:** fila, pop-up de aprovação, bloco "Saves
  deste job" da conferência e card da Comunicação mostram "Outubro de 2026
  · Agrupamento 1". O mês vem do campo calculado `mes_do_pedido`
  (`20260924100006`).
- **Pedido cancelado ou recusado na revisão:** a errata que o pedido gerou
  fica no histórico, mas a lista de erratas da revisão e o resumo da fila
  marcam "pedido cancelado" ou "save recusado".
- **Cabeçalho do job no financeiro:** valor do job, resultado planejado e o
  card de Erratas passam a usar a conta do financeiro. Um pedido que
  aguarda não mexe neles até a aprovação.
- **Home do financeiro e do administrador:** o card "Jobs aguardando
  abertura" soma os saves a aprovar, como a aba da fila, e o subtítulo diz
  quantos são jobs e quantos são saves.
- **Pop-up do orçamento:** diz que o crédito só fica disponível para
  outros jobs depois que o financeiro aprovar, na abertura do job.
- **Consumo aguardando no mensal:** segue travando o envio de todos os
  meses. A revisão aberta já trava todos.
