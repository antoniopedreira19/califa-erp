# 154 — O save do orçamento inteiro: gerar em todas as linhas ou consumir o saldo de um job

**Data:** 2026-10-07
**Status:** aceita e implementada (07/10/2026).
**Quem decidiu:** Tiago, em 07/10/2026, a partir do protótipo interativo
com quatro opções de comando (https://claude.ai/artifact/2fyxzYA64SdGuLcRVDiS8b).
Escolheu a opção 1 (botão "Save" com menu) e respondeu cada regra abaixo.
**Revê:** a [028 §10](028-save-entre-jobs.md) ("Orçamento de save inteiro"),
em que a chave só marcava a linha nova.
**Migrations:** `20261007900001_save_do_orcamento_inteiro.sql` e
`20261007900002_save_do_orcamento_inteiro_interno.sql`.

## A ideia em uma frase

O orçamento pode ser dedicado **inteiro** a uma de duas coisas que se
excluem: **gerar save** em todas as linhas, ou **consumir o saldo de um
único job** em todas as linhas — e "Retirar todos os saves" desfaz tudo num
clique.

## O comando: o botão "Save" (opção 1 do protótipo)

A chave "Orçamento de save" saiu da barra da planilha. No lugar dela, ao
lado do "Exibir" e com o mesmo desenho, fica o botão **Save**, com o menu
"Save do orçamento inteiro":

| Item do menu | O que faz |
|---|---|
| Gerar save em todas as linhas | Todas as linhas viram save, e a linha nova já nasce em save. Pede confirmação com o faturamento previsto, o valor do job (vai a zero) e o crédito que vira saldo. |
| Consumir o saldo de um job… | Abre a lista dos saldos aprovados do cliente; escolhido o job, todas as linhas consomem o próprio orçado do saldo dele. Ligado, vira "Trocar o job do saldo…". |
| Retirar todos os saves | Só aparece quando há algum save. Desfaz o save gerado e o consumo de todas as linhas e desliga o modo, com confirmação. |

O rótulo do botão diz o modo ligado ("Orçamento de save" ou "Consumindo
TES-1003/26"), em grafite. Uma faixa sobre a planilha mostra os números:
no gerar, o faturamento previsto e o crédito que vira saldo; no consumir,
o saldo do job, o que este orçamento usa e o **restante**.

## As regras

| Situação | O que acontece |
|---|---|
| Ligar um modo com alguma linha com save de outro tipo | **Recusado, com o motivo** e a lista das linhas. Linha que consome não vira save; linha que gera save, ou que consome de OUTRO job, trava o consumo. O pop-up oferece "Retirar todos os saves". |
| Linha que já consome do MESMO job escolhido | É absorvida: passa a consumir o valor inteiro dela, como as outras. |
| Ligar o consumo com o orçamento maior que o saldo disponível | **Erro, nada grava** ("O orçamento soma R$ … e o saldo disponível do … é de R$ …: faltam R$ …. Nada foi gravado."). A lista já mostra "não cabe: faltam R$ …" nos jobs que não cabem. |
| Consumo ligado: mudança de valor ou linha nova que passaria do saldo | **Não grava** ("Passa do saldo do …: restam R$ …, e esta mudança pede mais R$ …. O valor não foi gravado."). O que cabe grava, e o consumo acompanha o orçado da linha. |
| Modo ligado: clicar no save de uma linha | O pop-up da linha não abre; um aviso diz que o save é do orçamento inteiro e que, para mudar uma linha só, retira-se antes o save do orçamento. |
| Trocar de "gera" para "consome" (ou o contrário) | Pede retirar antes; o aviso oferece "Retirar todos os saves". |
| Retirar todos | O planejado que o save zerou volta; o consumo volta ao saldo do job; o modo desliga. |
| Serviço Interno | Sem o botão, como já era sem a chave (decisão 105). |
| Versão aprovada | Sem o botão: dali em diante é a errata do job, linha a linha (099). |

O saldo "disponível" é o mesmo da lista de saldos (`vw_saves_por_job`): o
aprovado menos o que outros jobs e versões aprovadas já usam. Rascunho
continua não segurando saldo para os outros (028, nota de 26/08), e a
aprovação da versão revalida o consumo, como sempre.

No modelo mensal (Fee e Always On) o modo vale para a versão inteira: os
números contam todos os meses, não só o mês aberto.

## Quem pode

A mesma permissão da chave desde 07/10/2026 (`b024adcd`, nota ⚠️ (4) do
HANDOFF_ORCAMENTO): **`orcamentos.editar`** — administrador, GP e produtor.
O Tiago manteve o produtor: o save só se efetiva quando o GP ou o
administrador envia ao financeiro e o financeiro aprova (099); preencher a
planilha com save é trabalho de quem monta o orçamento. O save linha a
linha continua com `orcamentos.marcar_em_save` (administrador e GP).

## Onde a regra mora

| Onde | O quê |
|---|---|
| `versoes_orcamento.save_por_padrao` | O orçamento que gera save (a coluna de sempre, agora com as linhas que já existem) |
| `versoes_orcamento.save_consumo_job_id` | O job cujo saldo a versão inteira consome (coluna nova, FK para `jobs`). `chk_versao_save_um_modo` impede os dois juntos |
| `versao_save_gerar_tudo`, `versao_save_consumir_tudo`, `versao_save_retirar_tudo` | As três operações, numa transação cada, com as recusas e as mensagens. Rodam como quem chama (RLS vale) |
| `trg_save_modo_da_versao_na_linha` | Com um modo ligado, a marca de save da linha acompanha o modo |
| `trg_save_modo_consumo_acompanha_linha` | Com o consumo ligado, o consumo da linha é o orçado dela, e o que passaria do saldo não grava |
| `save_disponivel_do_job` / `save_disponivel_para_rascunho` | A conta do saldo, fora da RLS de `jobs` (que filtra por empresa e regional) |
| `versoes/[versaoId]/save-actions.ts` | `gerarSaveNoOrcamentoInteiro`, `consumirSaldoNoOrcamentoInteiro`, `retirarTodosOsSaves` (substituem `definirSavePorPadrao`); o save da linha recusa com um modo ligado |
| `versoes/[versaoId]/save-do-orcamento.tsx` | O botão, o menu, a faixa e os pop-ups |
| `versoes/importar-actions.ts` | O "Importar planilha" por cima de uma versão que consome confere o saldo ANTES de apagar as linhas |

## O que ficou de fora, de propósito

- **O caminho até o financeiro não muda.** Cada linha continua sendo um
  pedido de aprovação (099), e cada pedido se aprova numa revisão própria.
  Com o orçamento inteiro em save, isso vira uma revisão por linha. O
  "Aprovar todos" do financeiro é a **entrega seguinte**, escolha do Tiago,
  e está sendo desenhado em outra frente.
- **Linha com BV não vira save** (028 §9: linha em save não aceita BV). O
  gerar recusa e diz quais linhas — regra que já existia, agora conferida
  também aqui.
- **A duplicação de versão continua sem copiar save**, como sempre. A
  versão nova da importação do projeto herda o gerar (a chave e as marcas,
  como antes), mas **não o consumir**: o consumo linha a linha também nunca
  foi herdado ali.

## Conferência (07/10/2026)

- **Banco**, numa transação desfeita no fim, como usuário logado, no
  "Teste X" v2 (TES-P002/26): gerar e consumir recusados pela linha que já
  consome do TES-1004/26; consumir do TES-1004/26 recusado por faltar
  R$ 137.775,00; gerar marcou as 49 linhas e zerou o planejado, que voltou
  ao retirar; com o gerar ligado, tirar o save de uma linha só foi recusado
  e a linha nova nasceu em save; com o consumo ligado, a mudança que
  passaria do saldo e a linha nova acima do restante foram recusadas, e a
  que cabia ajustou o consumo. Essa simulação achou um defeito das funções
  (a conferência do Interno chamava uma função sem permissão para
  `authenticated`), corrigido pela `20261007900002`.
- **Navegador**, logado como administrador, no orçamento "ZZ Teste 154 save
  inteiro" criado pela tela no TES-P001/26: o ciclo inteiro (gerar,
  aviso da linha, bloqueio do consumo com o gerar ligado, retirar, consumir
  do TES-1001/26 recusado por faltar R$ 80,00, consumir do TES-1003/26,
  célula que passaria do saldo, célula que cabia, linha nova acima do
  restante, trocar de job recusado, retirar). A planilha mensal ("Teste 1",
  TES-P003/26) abriu com o botão e contou a versão inteira (25 linhas,
  R$ 299.241,95), sem gravar nada. O teste achou outro defeito: a gravação
  de célula trocava a recusa do banco por "Não foi possível salvar a
  alteração."; as ações de linha passaram a repassar as frases do save.
- **Não conferido no navegador:** o "Importar planilha" por cima de uma
  versão que consome (a conferência é TypeScript direto, sem upload no
  teste) e a recusa para quem não edita o orçamento (a trava é a mesma
  `checarPermissao` da chave).
