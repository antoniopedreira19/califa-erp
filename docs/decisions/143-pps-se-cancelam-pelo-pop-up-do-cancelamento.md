# 143 — As PPs que travam o cancelamento se cancelam pelo próprio pop-up

**Data:** 2026-10-03
**Decidido por:** Tiago
**Migrations:** nenhuma.
**Prévia:** no chat, variantes A (dois passos) e B (tudo de uma vez); a A
foi escolhida.
**Revisa:** 057 §4 ("bloqueia com PP gerada, sem cascata") e o pop-up do
"Cancelar aprovação" da 128.

---

## 1. O problema

Em 03/10/2026 o Tiago desfez a abertura do ANI-1001/26 (o orçamento Always
On tinha só outubro, e deveria cobrir o trimestre). Ao clicar em "Cancelar
aprovação", o pop-up respondeu: "Antes de cancelar o envio, cancele as 2
PPs geradas na aba de Pedidos de Produção do job." Era preciso sair do
orçamento, ir ao job, cancelar uma PP de cada vez e voltar.

Nas palavras do Tiago: "Quero adicionar a possibilidade de, ao tentar
cancelar a versão, conseguir cancelar as PPs clicando no botão do pop-up
que aparece. Ao invés de precisar ir no job e cancelar cada uma. Aparecendo
um pop-up de 'tem certeza…'."

## 2. A regra em três frases

1. **A trava continua:** com PP fora de `cancelada`, o job de pré-abertura
   não se cancela (057 §4), e é o servidor quem recusa.
2. **O pop-up do cancelamento lista as PPs que travam e traz o botão que
   as cancela**, depois de um "Tem certeza?" com os códigos.
3. **São dois passos:** canceladas as PPs, a pessoa volta ao pop-up de
   baixo e confirma o cancelamento à parte. Cada ação que não se desfaz
   tem a sua confirmação.

## 3. O que foi decidido

| # | Pergunta | Decisão |
|---|---|---|
| 1 | As PPs e o cancelamento numa confirmação só? | **Não: dois passos (variante A).** "Cancelar as N PPs" → "Tem certeza?" → PPs canceladas → o pop-up de baixo libera o próprio botão. |
| 2 | Vale também para o "Cancelar envio à abertura" (job ainda esperando o financeiro)? | **Sim, nos dois pop-ups.** A trava e a mensagem eram as mesmas. |

## 4. Como ficou

### Pop-up de baixo ("Cancelar a aprovação da vN?" / "Cancelar o envio à abertura?")

- Sai a frase genérica "Se houver PP gerada no job, cancele-a antes."
- Com PP, entra o quadro vermelho: "Antes, as 2 PPs geradas no job
  precisam ser canceladas:", uma linha por PP (código · fornecedor ·
  valor) e o botão **"Cancelar as 2 PPs"** (no singular, "Cancelar a PP").
- O botão de confirmar ("Sim, cancelar aprovação" / "Sim, cancelar envio")
  fica travado enquanto houver PP na lista.

### Pop-up de cima ("Cancelar as 2 PPs?" / "Cancelar a PP-00100?")

- "Tem certeza? A PP-00100 e a PP-00101 serão canceladas, e os itens
  voltam a permitir uma nova PP. O PDF e os anexos ficam guardados no
  histórico." e "Depois você volta ao pop-up anterior para cancelar a
  aprovação" (ou "o envio").
- Botões "Voltar" e "Sim, cancelar as PPs". Esc, X, "Voltar" e clique fora
  fecham só ele.
- Depois do "ok" do servidor ele fica em "processando" até a lista nova
  chegar; então fecha, a lista some e o botão de baixo se libera, num
  passo só. Sem isso, havia alguns segundos em que o pop-up de baixo ainda
  oferecia o "Cancelar as N PPs" de PPs já canceladas.

## 5. Onde a regra mora

| Camada | O quê |
|---|---|
| Tela | `pps-que-travam.tsx` (quadro, botão e o pop-up de cima), usado por `AprovacaoActions` (job devolvido) e pelo `FluxoAbertura` (job aguardando abertura). A página do orçamento lê as PPs do job vivo de pré-abertura na onda 2, junto das outras consultas. |
| Servidor | `cancelarPPsQueTravamOEnvio(jobId, ppIds)`: só job de pré-abertura; recusa se a lista confirmada não for a lista de agora ("As PPs do job mudaram desde que o pop-up abriu, e nenhuma foi cancelada…"); cancela cada PP por `cancelarPedidoCompra`, com as regras, as permissões e a auditoria de sempre. `cancelarEnvio` continua barrando PP fora de `cancelada`. |
| Permissão | Nenhuma nova. `jobs.cancelar_pp` (administrador, GP, produtor) já cobre quem vê os dois pop-ups: o "Cancelar aprovação" é de administrador e GP, o "Cancelar envio" de quem tem `jobs.editar_metadata`, e na pré-abertura a PP só pode estar `gerada`, que o produtor também cancela. |
| Auditoria | `pedido_compra.cancelada` em cada PP e, no job, `job.pps_canceladas_no_cancelamento_do_envio` com os códigos. |

## 6. O que NÃO mudou

- A trava do servidor (057 §4) e o "Cancelar aprovação" da 128.
- O cancelamento de PP pela aba de Pedidos de Produção do job.
- Job aberto: nenhum dos dois pop-ups existe, e as PPs se cancelam pela
  aba do job.

## 7. Testado (03/10/2026, no TES-P001/26 · "Orçamento de Teste", dev local)

- **Cancelar envio à abertura:** envio (TES-1020/26), PP-00118 e PP-00119
  geradas; o pop-up listou as duas com o confirmar travado. Esc, X,
  "Voltar" e clique fora fecharam só o pop-up de cima.
- **Lista que mudou:** com o pop-up aberto, a PP-00119 foi cancelada por
  outra aba; o "Sim, cancelar as PPs" foi recusado sem cancelar nada, e a
  lista se atualizou para a PP-00118. Cancelada pelo pop-up, o "Sim,
  cancelar envio" se liberou; job cancelado, orçamento de volta a
  aprovado, auditoria completa.
- **Cancelar aprovação com o job devolvido:** reenvio (TES-1021/26),
  PP-00120, devolução como financeiro; PP cancelada pelo pop-up e
  aprovação cancelada (job com `codigo_reservado`, faixa "Em correção").
- **"Processando" até a lista nova:** aprovação de novo, envio (o job
  voltou como TES-1021/26 e o cancelado virou TES-1021/26-C1), PP-00121
  cancelada pelo pop-up: o de cima ficou travado até a lista chegar (3 s
  no dev) e fechou junto com ela. Limpeza: envio cancelado; o orçamento
  terminou aprovado, sem job vivo.
- Não testado logado como GP ou produtor: a permissão foi conferida pelo
  código (§5).
