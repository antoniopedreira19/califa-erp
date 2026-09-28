# 113 — Job não aberto não existe no financeiro, e o cancelado antes da abertura volta a ser só orçamento

**Data:** 2026-09-28
**Decidido por:** Tiago
**Migration:** `20260928100001_chat_de_pps_so_pp_enviada.sql`.

---

## 1. A regra

Nas palavras do Tiago, em 28/09/2026:

> Job devolvido / cancelado antes da abertura no financeiro, não deve nem
> ficar aparecendo para o financeiro. Apenas os que foram abertos e
> denominados e associados a um projeto, pelo financeiro.
>
> Cancelados antes da abertura deverão voltar a serem apenas orçamentos
> registrados no sistema mas não deverão entrar no financeiro.

Daí três regras:

1. **O financeiro só vê job que ele abriu.** A exceção é a fila de
   abertura, que é a entrada do job no financeiro. O devolvido
   (`rejeitado_financeiro`) e o cancelado antes da abertura não aparecem em
   tela nenhuma do financeiro.
2. **O cancelado antes da abertura some também da produção.** Ele volta a
   ser só o orçamento, que o cancelamento do envio já devolvia a
   `aprovado` (decisão 057). A linha do job fica no banco, com a auditoria,
   e o código JOB-NNNN continua queimado. Nada é apagado.
3. **O financeiro só vê PP que foi enviada a ele.** A decisão 039 já
   escondia a PP `gerada`; agora também a cancelada que nunca foi enviada.

O cancelamento só é possível sem PP ou com todas as PPs canceladas:
`cancelarEnvioParaAbertura` recusa se houver PP em outro status. Era a
condição que o Tiago pediu, e ela já valia desde a 057.

## 2. O que é "aberto" e o que é "cancelado antes da abertura"

- **Aberto pelo financeiro** é ter passado por `abrirJobNoFinanceiro`, que
  grava juntos `data_abertura_financeiro`, `aberto_por`, `nome_financeiro`,
  `projeto_financeiro_id`, `categoria_id` e `servico_id`. Em 28/09/2026 os
  13 jobs abertos ou finalizados tinham os três primeiros, e os 10 não
  abertos (4 na fila, 1 devolvido, 5 cancelados) não tinham nenhum.
- **Cancelado antes da abertura** é `status = 'cancelado'` sem
  `data_abertura_financeiro` (`jobCanceladoAntesDaAbertura` em
  `lib/types.ts`; nas consultas, `FILTRO_SEM_CANCELADO_ANTES_DA_ABERTURA`).
  O cancelamento depois da abertura não tem tela hoje (decisão 020) e não
  entra nesta regra.

## 3. Por que a PP entra na regra do job

A produção pode gerar PP antes da abertura (`jobAceitaGerarPP`), mas não
pode enviá-la (`jobAceitaEnvioDePP`). Para cancelar o envio do job, tem de
cancelar essas PPs. Até aqui o financeiro escondia só a PP com status
`gerada`: a cancelada saía de `gerada` sem ter passado por ele e aparecia
no filtro "Canceladas" do Contas a Pagar, com o código do job e o link
para a página dele. Era o caminho pelo qual um job não aberto chegava ao
financeiro.

O mesmo acontecia em job aberto. Em 28/09/2026 eram 4 PPs canceladas sem
nunca terem sido enviadas (PP-00092, PP-00047, PP-00046 e PP-00042), e as
4 apareciam para o financeiro. Perguntado, o Tiago decidiu que o financeiro
deixa de ver as 4: ele só vê PP enviada a ele. A PP-00042 já tinha tido o
envio desfeito de propósito, a pedido dele (`20260908180001`).

O critério é `enviada_financeiro_em` preenchido, o carimbo que a action de
envio grava (`20260902160002`, com backfill das PPs anteriores).

## 4. O que muda, por tela

**Financeiro**

- **Página do job** (`/financeiro/jobs/[jobId]`): o devolvido e o cancelado
  antes da abertura vão para a fila (`/financeiro/abertura-de-job?aba=aguardando`),
  como a página da abertura já fazia. Antes, os dois abriam a página
  inteira, com as abas e o chat.
- **"Jobs do projeto" na ficha do job:** passa a usar o mesmo filtro da
  faixa do projeto (`STATUS_NA_LISTA`). Antes, não tinha filtro nenhum.
- **Contas a Pagar › PPs:** só PP enviada. "Canceladas" passou de 6 para 2
  e "Todas", de 43 para 39.
- **Chat de PPs:** a caixa de entrada (`chat_pps_conversas`), o fio do job
  e a trava de envio de mensagem só contam PP enviada. A caixa passou de 8
  para 7 conversas; o JOB-0040, que só tinha a PP-00092, saiu. Ele não
  tinha mensagem.
- **Lista de PPs do job no financeiro** (`financeiro/jobs/[jobId]/dados.ts`):
  só PP enviada.

**Produção**

- **Lista de Jobs:** o cancelado antes da abertura sai da lista, da busca,
  das contagens e do total do projeto. A opção "Cancelado" saiu do filtro
  de status, porque ficaria sempre vazia.
- **Página do job:** o link para um cancelado antes da abertura leva ao
  orçamento dele.
- **"Jobs do projeto" na ficha:** o cancelado sai. A faixa do projeto e a
  agregada já o escondiam.
- **Fio de PPs do job** (`montarThreadChatPPs`, o mesmo do financeiro): a
  PP cancelada sem envio não gera card. Os dois lados do chat continuam
  iguais.
- **Coluna Save da versão** (`saveDaVersao`): o aviso "consumido por
  JOB-…" citava o primeiro job do orçamento consumidor, que podia ser o
  cancelado. Agora cita o vivo. Em 28/09/2026 não havia consumo nessa
  situação.
- **Home** do GP, do produtor e do freelancer (`lib/home/carregar.ts`): as
  contagens de "Mensagens no chat" e de "PPs emitidas por mim" deixam de
  contar o job cancelado antes da abertura. É código da frente do Antonio;
  o Tiago autorizou a mudança em 28/09/2026. As outras contagens da home já
  deixavam o cancelado de fora pelo status.

## 5. O que fica como está

- **Save consumido por job ainda não aberto** continua aparecendo no fluxo
  de caixa e na planilha do job de origem: o valor sai do saldo de um job
  aberto. Não havia caso em 28/09/2026.
- **A versão que gerou o job cancelado** continua sem poder ser apagada: a
  linha do job ainda aponta para ela.
- **A exportação da planilha do job** (`/api/jobs/[jobId]/export`) não
  confere o status. Só a página do job tinha o botão, e ela agora
  redireciona.
