# 052 — "Todas as PPs deste item já foram geradas", e a previsão de custo por item

**Data:** 2026-09-04
**Status:** aceita
**Migrations:** `20260904200001_pps_concluidas_por_item.sql`,
`20260904200002_previsao_de_custo_por_item_marcado.sql`
**Revisão:** 05/09/2026 — o marco ganhou o alcance da planilha inteira
**Design:** `Planilha Interna - Item com Todas as PPs.dc.html`, projeto
Claude Design `69342d83` (revisto em 05/09/2026, quando ganhou o botão
da barra)
**Contexto:** Planilha Interna do job (`/jobs/[jobId]`), fluxo de caixa e
encerramento do job. Completa a [027](027-pp-aprovada-e-a-composicao-do-fluxo-do-job.md)
e a [004](004-previsao-de-desembolso.md).

## O problema

Um item da planilha pode gerar várias PPs, e o sistema não tinha como
saber se ainda viria mais alguma. A previsão de custo chutava: bastava
**uma** PP do item ser aprovada para o planejado **inteiro** daquele item
sair do Cronograma de desembolsos ([027 §1](027-pp-aprovada-e-a-composicao-do-fluxo-do-job.md)).

Item planejado em R$ 20.000 com uma PP de R$ 10.000 aprovada saía assim:
previsão zero, título R$ 10.000. Os outros R$ 10.000 que ainda iam virar
PP sumiam do fluxo de caixa até alguém emiti-las.

## A regra nova

Quem responde é a produção, no formulário da PP ou no painel do item. A
resposta é sobre o ITEM, não sobre a PP: **"não sai mais PP daqui"**.

| Estado do item | Quanto ele pesa na previsão de custo |
|---|---|
| **Em aberto** | planejado − PPs que já viraram título, com piso zero |
| **Marcado** | as PPs que existem e ainda **não** são título (gerada, em avaliação, rejeitada) |

PP vira título quando é **aprovada** pelo financeiro — isso não mudou
([027](027-pp-aprovada-e-a-composicao-do-fluxo-do-job.md)). O que a PP
gerada faz agora é segurar previsão no item marcado, para o custo não
sumir do fluxo entre gerar e aprovar.

O caso conversado com o Tiago, item planejado em R$ 20.000:

| Situação | Previsão | Título | Total do item |
|---|---|---|---|
| PP de R$ 12.000 aprovada, item em aberto | 8.000 | 12.000 | 20.000 |
| \+ PP de R$ 9.000 só gerada, item em aberto | 8.000 | 12.000 | 20.000 |
| item marcado | **9.000** | 12.000 | **21.000** |
| a segunda PP é aprovada | 0 | 21.000 | 21.000 |

Marcar pode **aumentar** o total do item, e é o correto: o planejado
deixou de mandar, e o que manda passa a ser o que foi de fato pedido.

Quando as PPs somam menos que o planejado e o item é marcado, a economia
sai do fluxo — é o único jeito de a previsão parar de contar dinheiro que
ninguém vai gastar.

## Onde se responde

1. **No formulário da PP**, como pergunta obrigatória: *"Esta é a última
   PP deste item?"*, último campo antes dos botões. Sem resposta, não
   gera. Vale para gerar e para editar uma PP ainda gerada — a correção
   da PP **rejeitada** não pergunta, porque ali se conserta um documento
   que já existe.
2. **No painel "Destrinchar realizado"**, no botão verde do rodapé, sem
   abrir formulário e sem gerar nada. É o caminho do item antigo, da
   resposta dada errado, e do **item que nunca vai gerar PP** — que
   também precisa ser marcado.
3. **Na barra da planilha, em "Concluir PPs"** (05/09/2026): o mesmo
   marco para a planilha INTEIRA, de uma vez. É o caminho do fim do job,
   quando a produção sabe que não sai mais nada de lugar nenhum — item a
   item seriam trinta cliques.

   O aviso antes de gravar conta quantos itens serão marcados e, no
   "Ver quais", lista cada um com a situação dele (*"2 PPs · R$ 10.000,00"*
   ou *"nenhuma PP"*). Não é formalidade: marcar tira o saldo do
   planejado da previsão de cada um, e num job de trinta linhas ninguém
   tem de cabeça quais estão em aberto. Quem já está marcado não é
   tocado, e a lista é **refeita no servidor** antes de gravar — a da
   tela é explicação, não regra.

   Sem ninguém em aberto o botão vira um selo apagado, *"PPs
   concluídas"*, e não abre nada.

**Não existe "Reabrir item".** Quem precisa de mais uma PP num item
marcado clica em "Nova PP"; um aviso explica que isso reabre o item e
devolve o planejado à previsão, e só então o formulário abre. A
reabertura vira mensagem no chat da Comunicação, com autor e data.

**Quem pode:** qualquer pessoa com acesso ao job (decisão do Tiago).
Diferente de gerar PP, que exige o responsável do job ou um administrador
— marcar não cria compromisso de pagamento.

## Os dois sinais da calha

O chip do item ganha um **✓ verde** quando o item está marcado, no lugar
do olho. Ele convive com o **círculo vermelho** das PPs geradas e ainda
não enviadas ([039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md)):
um diz "não sai mais PP daqui", o outro diz "tem PP esperando ir ao
financeiro". Item sem nenhuma PP segue com o "Gerar PP" vermelho de
sempre, e ganha só o ✓ no lugar do ícone quando marcado.

## O encerramento trava

Job não vai para encerramento com item de custo em aberto. A conta é a
mesma trava das PPs sem baixa e do saldo a faturar, e o diálogo de
fechamento lista os itens que faltam pelo nome.

Entram na trava só as linhas que geram PP — `AR`, `B`, `C`, `F`, `FI`
(decisão do Tiago). `A · Direto` e `D · Interno` pagam por BV, não têm
calha de PP e não têm o que marcar. **Linha em save** também fica de
fora: ela não emite PP neste job ([028 §9](028-save-entre-jobs.md)), então
travaria o encerramento para sempre.

## Onde a regra mora

| | Arquivo |
|---|---|
| As colunas do marco | `jobs_itens_realizado.pps_concluidas_em` / `_por` |
| A gravação (compartilhada) | `app/(app)/jobs/[jobId]/realizado/conclusao-item.ts` |
| Marcar, reabrir e concluir o job inteiro | `app/(app)/jobs/[jobId]/realizado/actions-conclusao.ts` |
| O botão da barra e o aviso | `app/(app)/jobs/[jobId]/realizado/concluir-pps-button.tsx` |
| Quais linhas precisam responder | `lib/calculos/pps-item.ts` — `itemPrecisaDeConclusao` |
| A pergunta obrigatória | `gerar-pp-drawer.tsx` + `actions-pp.ts` (`finalizarPedidoCompra`, `editarPedidoCompraGerada`) |
| Faixa, botão e aviso | `painel-pps-item.tsx` |
| O ✓ da calha | `calha-linha.tsx` (e `corIcone` em `_planilha/calha-acoes.tsx`) |
| A previsão por item | `vw_fluxo_caixa`, CTEs `pps_do_item` e `abatimento_curva` |
| A trava do encerramento | `actions-encerramento.ts`, `carregar-detalhe.ts`, `encerrar-dialog.tsx` |

**De quebra**, o abatimento passou a ler o planejado da **cópia do job**
(`jobs_itens_orcado`) em vez da versão aprovada. Pela versão, a errata
alterava a planilha e o fluxo continuava usando o número velho, e a linha
vermelha — que não existe na versão — ficava fora da conta inteira.

## Fora desta decisão

- **Marcar por grupo.** O alcance é o item ou a planilha inteira; um
  agrupamento no meio do caminho não foi pedido.
- **Faixa de status do job** abaixo da planilha ("N itens ainda em
  aberto"), que o design de 05/09 desenha. O botão já diz o número, e a
  trava do encerramento diz o resto.
- **Aviso na tela do financeiro** de que a previsão de um job mudou de
  base. O fluxo de caixa mostra o número novo, sem histórico da troca.
- **A pergunta na correção da PP rejeitada** (`pps/editar-pp-drawer.tsx`).
