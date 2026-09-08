# 058 — O chat de PPs ganha uma caixa de entrada no financeiro, e a área da mensagem passa a vir da tela

**Data:** 2026-09-08
**Status:** aceita
**Contexto:** aba "Pedidos de Produção (PPs)" de Contas a Pagar
(`/financeiro/contas-a-pagar`), aba de PPs do job (`/jobs/[jobId]`), aba
Comunicação do job nos dois módulos, e a matriz de `lib/permissoes.ts`.
Pedido do Tiago em 08/09/2026, com as sete respostas registradas na seção
"O que foi decidido".

## O problema

O chat de PPs existia só de um lado. A produção abria o job, clicava no
balão do canto inferior direito e falava com o financeiro. O financeiro
não tinha por onde responder: em Contas a Pagar não havia chat nenhum, e
o papel `financeiro` sequer passava no gate de escrita (`chat.enviar` era
de administrador, gerente de produção e produtor).

Pior: o rótulo do balão mentia. A área da mensagem vinha do PAPEL
(`areaDoPapel`), que carimbava `administrador` como "Financeiro" — e 19
dos 20 usuários da agência são administradores. Toda mensagem escrita
dentro do Job saía marcada como se fosse do financeiro. As 5 mensagens que
existiam no banco em 08/09/2026 estavam todas com `area = 'financeiro'`,
inclusive a automática de reabertura de item, que é da produção.

## A regra em três frases

1. **A área da mensagem vem da TELA de origem, nunca do papel.** Escreveu
   por `/jobs` é "Produção"; escreveu por `/financeiro/**` é "Financeiro".
2. **Cada lado tem seu gate.** `chat.enviar` fala pela Produção,
   `chat.enviar_financeiro` fala pelo Financeiro. Ninguém se passa pelo
   outro time porque a área não vem do cliente: cada Server Action fixa a
   sua e revalida o papel.
3. **PP registrada no fio não notifica.** O card de PP é derivado de
   `pedidos_compra` na leitura; só mensagem de gente conta como não lida e
   só mensagem de gente reordena a lista.

## O que foi decidido

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Como liberar a escrita para o financeiro? | **Recurso novo `chat.enviar_financeiro`** (administrador + financeiro). Adicionar `financeiro` ao `chat.enviar` daria a ele o campo de escrita dentro do módulo Jobs também, e o Tiago fechou o contrário: "o usuário financeiro não poderá enviar mensagens pelo chat em Jobs". Os dois gates existem porque são dois lados, não dois níveis. |
| 2 | Quais jobs aparecem na lista? | **Todo job que já mandou alguma PP ao financeiro** (`status <> 'gerada'`) — 12 dos 31 jobs em 08/09. Inclusive os que ninguém escreveu ainda: é assim que o financeiro puxa a primeira conversa. |
| 3 | Universo da busca | **O mesmo:** só jobs com PP enviada. O financeiro não abre conversa sobre job que nunca chegou nele. |
| 4 | Ordem da lista | **Quem tem mensagem primeiro, pela mensagem mais recente; quem só tem PP depois, pela PP mais recente.** Uma PP nova não reordena a lista de quem já conversa — se reordenasse, seria notificar, e PP não notifica. |
| 5 | Onde fica o botão flutuante | **Só na aba de PPs**, espelhando o job. Contas a Pagar abre em "Títulos a Pagar", então o FAB fica escondido até alguém clicar na aba — e é por isso que o badge da aba existe (nº 6). |
| 6 | Badge do botão flutuante | **No financeiro conta CHATS com mensagem não lida**; **no job continua contando MENSAGENS**, porque lá existe um fio só. Pedido literal do Tiago. |
| 7 | Badge novo ao lado do título da aba | **Chats com mensagem não lida** — mesma conta do FAB, um número só, coerente nos dois lugares. Fica ao lado do badge de "PPs em avaliação", com ícone de balão e cor diferente para os dois não se confundirem. |

## Como ficou

### A caixa de entrada (`/financeiro/contas-a-pagar`, aba PPs)

O mesmo botão flutuante do job, no mesmo canto, com o mesmo drawer de
420px. A diferença é o que ele abre: em vez do fio de um job, a lista de
conversas — código do job, nome, cliente · projeto, prévia da última
mensagem com autor e time, horário e badge de não lidas. Campo de busca no
topo, que filtra por código, nome do job, cliente e projeto, ignorando
acento.

Clicar numa linha abre o fio daquele job, com uma seta de voltar no
cabeçalho. O fio é o MESMO componente que o job usa
(`components/chat/thread-pps.tsx`) — cards automáticos de PP e balões de
gente, idênticos. O pedido era "o mesmo layout", e a única forma de isso
continuar verdade daqui a três meses é os dois renderizarem o mesmo
componente.

### O rótulo do balão

Produção à direita, em vermelho; Financeiro à esquerda, em azul. Nome de
quem escreveu, time e horário — como já era. O que mudou é que agora o
time está certo: o mesmo administrador escrevendo pelas duas telas produz
"Tiago Mendonça · Financeiro" de um lado e "Tiago Mendonça · Produção" do
outro.

### Carregamento

Contas a Pagar já é a página mais pesada do sistema, e montar 12 fios no
load estava fora de questão. São dois tempos:

- **A lista** vem de uma RPC agregada (`chat_pps_conversas`), uma linha
  por job, dentro do `Promise.all` que a página já tinha. Duas queries no
  total (a RPC + os nomes dos jobs), nenhuma em série.
- **O fio** carrega sob demanda, quando a conversa é aberta.

Nenhuma action do chat chama `revalidatePath` da página: recarregar PPs,
títulos, cartões e recorrências a cada mensagem seria absurdo. O drawer
pede de volta só o que mudou.

## Duas armadilhas do Realtime que custaram a verificação

Ambas falham **em silêncio** — nada quebra, nada loga, a lista só nunca
atualiza. Ficam registradas porque a próxima assinatura vai esbarrar nelas.

1. **`filter` não funciona em coluna de enum.** `filter: "escopo=eq.pps"`
   engolia todos os eventos. O canal do job escapa porque filtra por
   `job_id`, que é uuid, e confere o escopo no JS. Onde não há um job só,
   o recorte inteiro vai para o JS.
2. **Assinar no mesmo tick do mount abre o canal como `anon`.** O token
   chega ao Realtime de forma assíncrona; quem assina antes disso cai no
   RLS de `jobs_mensagens` e é descartado. O diagnóstico está em
   `select claims_role from realtime.subscription` — tem que dizer
   `authenticated`. A correção é `await supabase.auth.getSession()` e
   `realtime.setAuth(token)` antes do `.subscribe()`.

## Verificação

Os **quatro** pontos de escrita foram exercitados no navegador logado, com
o mesmo usuário administrador, conferindo `jobs_mensagens.area` no banco a
cada envio: chat de PPs em Contas a Pagar (`financeiro`), aba PPs do job
(`producao`), aba Comunicação do job (`producao`) e aba Comunicação em
`/financeiro/jobs` (`financeiro`). A mensagem automática de reabertura de
item também: `producao`.

Detalhe do que foi conferido, e os resíduos de teste que ficaram no banco,
em `docs/handoffs/HANDOFF_FINANCEIRO.md`.

## O que NÃO entrou

- **Backfill das 5 mensagens antigas mal rotuladas.** Sobrescrever valor
  existente é mudança destrutiva e depende de decisão do Tiago.
- **Notificação fora da tela** (e-mail, push, badge no menu lateral). O
  aviso vive na tela de Contas a Pagar e na do job.
- **Anexos no chat.** O clipe segue desabilitado com tooltip, como no job.

## Arquivos

| Camada | Arquivo |
|--------|---------|
| Migrations | `20260908120001_conversas_do_chat_de_pps.sql`, `20260908120002_conversas_do_chat_de_pps_partem_das_pps.sql` |
| Dados | `lib/data/chat-pps-conversas.ts`, `lib/data/job-chat-pps.ts` (tipo de entrada alargado) |
| Actions | `app/(app)/financeiro/contas-a-pagar/chat/actions.ts` |
| UI (financeiro) | `chat/chat-pps-provider.tsx`, `chat/chat-pps-fab.tsx`, `chat/chat-pps-lista.tsx`, `chat/chat-pps-conversa.tsx` |
| UI (compartilhada) | `components/chat/thread-pps.tsx` |
| Permissões | `lib/permissoes.ts`, `lib/permissoes.test.ts`, `app/(app)/admin/usuarios/permissoes/matriz-permissoes.tsx`, `docs/10-permissoes-por-perfil.md` |
| Área por origem | `lib/types.ts` (`AREA_PRODUCAO`/`AREA_FINANCEIRO` no lugar de `areaDoPapel`), actions de `jobs/[jobId]/comunicacao`, `jobs/[jobId]/pps`, `jobs/[jobId]/realizado/conclusao-item.ts` |
