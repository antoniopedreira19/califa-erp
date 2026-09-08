# 057 — A rejeição volta ao orçamento, e o envio à abertura se cancela de lá

**Data:** 2026-09-08
**Status:** aceita
**Contexto:** página do job (`/jobs/[jobId]`), tela do orçamento na versão
aprovada (`/orcamentos/[projetoId]/[orcId]`) e a action
`enviarJobParaAbertura`. Pedido do Tiago em 08/09/2026, com as seis
respostas registradas na seção "O que foi decidido". Continua a 020
(cancelar job só antes da abertura).

## O problema

O job devolvido pelo financeiro tinha, na própria página do job, um botão
"Reenviar pra aprovação" que só trocava o status de volta para
`aguardando_abertura` e apagava o motivo. Ninguém revia nada: o formulário
de abertura, que é o que o financeiro conferiu e devolveu, mora no
orçamento e não era reaberto.

A tela do orçamento, por sua vez, nem lia o status do job. Com o job
rejeitado ela continuava dizendo "Job enviado para abertura · aguardando
abertura pelo financeiro".

E não existia como desistir de um envio enquanto o financeiro ainda não
tinha olhado. O "Cancelar job" da página do job cancelava o job e deixava
o orçamento em `job_criado` sem job vivo — preso: não reenviava (o envio
exige `aprovado`) nem desaprovava (a tela lê "Job criado"). Aconteceu com
TESTE-0005/26-01 e o JOB-0019.

## A regra em três frases

1. **O envio à abertura nasce, se revisa e se cancela no orçamento.** A
   página do job só aponta para lá.
2. **Reenviar é refazer o formulário sobre o mesmo job.** O código não
   muda, e o que a produção já registrou na pré-abertura fica.
3. **`orcamentos.status` diz se existe job vivo.** `job_criado` quando
   existe job fora de `cancelado`; `aprovado` quando a versão está
   aprovada e não há job vivo. Nenhum caminho pode deixar os dois em
   desacordo.

## O que foi decidido

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Reenvio: mesmo job ou job novo? | **Mesmo job.** O rejeitado guarda a cópia da planilha, o consumo de save, os BVs e as PPs já geradas (056). Job novo obrigaria a mover tudo isso. |
| 2 | Orçamento volta a `aprovado` no banco com o job rejeitado? | **Não: fica `job_criado`.** A regra 3 continua verdadeira, "Nova versão" segue travada (a planilha já foi copiada para o job) e nenhuma migration é preciso. A tela é que muda: banner com o motivo e o botão de envio de volta, decididos pelo status do **job**. |
| 3 | Cancelar envio: o que acontece com o job? | **`cancelado`**, orçamento de volta a `aprovado`, saves e BVs devolvidos à versão. É o inverso exato do envio, com histórico e auditoria. O código JOB-NNNN fica queimado, como em qualquer job cancelado. Apagar a linha reaproveitaria o código, mas sumiria com o rastro. |
| 4 | Cancelar envio com PP gerada ou realizado lançado? | **Bloqueia com PP gerada, sem cascata.** A PP gerada é contratação fechada com fornecedor; quem desfaz é o usuário, uma a uma, na aba de PPs. A mensagem diz o que falta: "Antes de cancelar o envio, cancele a PP gerada na aba de Pedidos de Produção do job." **O realizado saiu da conta** — ver a nota logo abaixo. |
| 5 | "Cancelar job" na página do job, antes da abertura? | **Sai.** Dois botões em dois módulos fazendo quase a mesma coisa foi o que prendeu o TESTE-0005/26-01. A barra passa a apontar para o orçamento. A action `atualizarStatusJob` continua aceitando o cancelamento (020) — nenhuma superfície do módulo de Jobs a oferece. |
| 6 | TESTE-0005/26-01 preso | **Corrigido na migration** `20260908100001`, com `update` restrito a `job_criado` sem job vivo. Uma linha, idempotente. |

## Como ficou cada tela

### Página do job devolvido

O cartão com o motivo continua; o botão virou **"Revisar abertura"**, um
link para o orçamento na versão aprovada com `?abertura=revisar`. A barra
diz "Job devolvido pelo financeiro. Revise a abertura pelo orçamento, com
o motivo acima, e reenvie". Sem "Cancelar job" — nem no `aguardando_abertura`,
cuja barra ganhou "Para cancelar o envio, use o orçamento".

### Tela do orçamento

`FluxoAbertura` ganhou a etapa **`devolvida`**: o job existe e está
`rejeitado_financeiro`.

| Etapa | Banner | Barra | Botões |
|---|---|---|---|
| `aprovada` | "Versão v1 aprovada" | "Próximo passo: abrir o job" | Enviar Job para Abertura |
| `enviada` | "Job enviado para abertura" | recebimento previsto | Cancelar envio à abertura · Ver dados do job |
| `devolvida` | **"Abertura devolvida pelo financeiro"**, vermelho, com o motivo | "devolvido pelo financeiro · revise e reenvie" | Cancelar envio à abertura · Enviar Job para Abertura |

Com `?abertura=revisar` o formulário abre sozinho, preenchido com o que o
job devolvido tinha (nome, cidade, regional, datas, data do evento,
recebimento, descritivo e contatos). O parâmetro é retirado da URL com
`router.replace`, para um reload não reabrir o modal — um
`history.replaceState` solto não serve: o router do Next ressincroniza a
URL na primeira server action e o parâmetro volta.

O "Cancelar envio à abertura" vale nos dois status de pré-abertura: o job
devolvido também precisa de uma saída além do reenvio, e o "Cancelar job"
da página do job saiu.

### O reenvio (`enviarJobParaAbertura`)

Com um job vivo em `rejeitado_financeiro` no orçamento, a action **não
cria job**: atualiza no mesmo registro o que o formulário decide (nome,
produto, cidade, regional, datas, data do evento, recebimento, descritivo,
GP e produtor relidos do orçamento), volta o status a `aguardando_abertura`,
apaga o motivo, substitui os contatos de cobrança e grava as mesmas
alterações no orçamento. Valor do job, cópia da planilha, saves, BVs e
PPs ficam como estão — a versão aprovada não mudou (errata só existe
depois da abertura). Auditoria `job.reenviado_para_aprovacao`, com
os mesmos campos do envio.

Qualquer outro job vivo continua barrando ("Este orçamento já tem um job
ativo"). A antiga `reenviarJobParaAprovacao` foi removida: mantida, seria
um caminho paralelo que devolve o job à fila sem ninguém rever o que o
financeiro apontou.

### Por que o realizado não entra no bloqueio

A pergunta 4 foi respondida com "PP **ou** realizado lançado", e a
primeira versão do código somava os dois. **Está errado, e a verificação
de 08/09/2026 mostrou por quê:** o realizado não é digitado desde
21/08/2026. `app/(app)/jobs/[jobId]/actions-realizado.ts` guarda o aviso
no lugar da action removida, e hoje o valor é derivado das PPs pelo
trigger `recalcular_realizado_do_item`, que soma as não canceladas.

Duas consequências:

1. **Contar os dois é contar a mesma PP duas vezes.** Em job de
   pré-abertura o realizado é sempre zero, porque a PP só pode estar
   `gerada` e o trigger ignora essa.
2. **A mensagem mandava fazer o impossível.** "Zere o realizado lançado
   no item" aponta para uma célula que não é editável em tela nenhuma —
   quem lesse ficaria sem saída.

O bloqueio ficou só na PP, que é o que de fato existe e o que o usuário
consegue desfazer. O único caso que o realizado pegaria são linhas
digitadas antes de 21/08/2026; nelas o cancelamento agora passa, e nada
se perde: as linhas ficam no job cancelado, que é histórico.

### O cancelamento (`cancelarEnvioParaAbertura`)

Permissão `jobs.editar_metadata`, a mesma do antigo reenvio. Ordem:

1. job em `aguardando_abertura` ou `rejeitado_financeiro`, senão recusa
   ("o cancelamento depois da abertura é ação do financeiro");
2. bloqueio da decisão 4 — PP fora de `cancelada`;
3. `saves_consumos` das cópias do job voltam para `item_versao_id` da
   linha da versão — as duas pontas nunca convivem
   (`chk_save_consumo_uma_ponta`), então é um update por consumo;
4. `itens_bv` das cópias soltam `job_item_orcado_id` (o `item_versao_id`
   nunca foi apagado pelo envio);
5. job → `cancelado`; o motivo da rejeição, se havia, fica;
6. orçamento `job_criado` → `aprovado`;
7. auditoria `job.envio_abertura_cancelado`, com o status anterior e
   quantos saves voltaram.

A cópia da planilha, as âncoras do realizado e os contatos ficam no job
cancelado, como histórico.

## O que NÃO mudou

- A fila do financeiro segue listando só `aguardando_abertura` (e a
  revisão por errata). O reenvio reentra nela pelo status; o cancelado
  some.
- `rejeitarAberturaJob` (a devolução em si) e o diálogo de rejeição.
- `JOB_STATUS_TRANSICOES` e `atualizarStatusJob` (020).
- Os gates de PP e realizado na pré-abertura (013, 056).
- `cancelarAprovacaoVersao`: continua exigindo nenhum job vivo. Com o job
  devolvido, o caminho para desaprovar é cancelar o envio primeiro.
