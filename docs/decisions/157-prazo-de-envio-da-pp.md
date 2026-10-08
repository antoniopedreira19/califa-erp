# 157 — A PP chega ao financeiro até 15 dias antes da janela de pagamento

**Data:** 2026-10-07
**Status:** aceita e implementada (07/10/2026).
**Quem decidiu:** Tiago, em 07/10/2026, a partir do "Calendário de envio de PPs" que o financeiro divulgou (janelas de agosto a dezembro de 2026, "prazo para envio: até 15 dias antes de cada janela de pagamento").
**Completa:** a [077](077-o-prazo-da-pp-cai-em-janela-e-a-pp-pode-ser-urgente.md) (o prazo da PP só cai em janela de pagamento) e a [153](153-pp-a-emitir.md) (a PP gerada não se edita), que ganha uma exceção.
**Migration:** nenhuma. A regra é de código; os feriados vêm do cadastro que o Fiscal já tem (`fiscal_feriados`).

## A regra

1. **Data-limite de envio = dia 08 ou 20 do calendário − 15 dias corridos.**
   A conta parte do dia nominal, não do dia em que o pagamento cai: a
   janela de 08/11/2026 paga na segunda 09/11, e o limite é 08/11 − 15 =
   24/10, como no calendário do financeiro.
2. **Caindo em dia não útil, volta ao dia útil anterior.** São dias não
   úteis o sábado, o domingo e os **feriados nacionais** do cadastro de
   feriados (`municipio` nulo). Os municipais (Salvador, São Paulo, Santo
   André, Fortaleza) ficam de fora, por escolha do Tiago. Domingo volta
   para sexta, e não para sábado: o "dia corrido anterior" de um domingo
   também não é útil, e a regra se aplica de novo.
3. **Vale na escolha do prazo e no envio.**
   - Formulário da PP: o calendário só acende janela com envio aberto; o
     prazo sugerido é a primeira delas (era a primeira janela depois de
     hoje); embaixo do campo aparece "Envio ao financeiro até dd/mm/aaaa".
   - Servidor: salvar a PP a emitir (data que mudou), gerar a PP (sempre) e
     enviar ao financeiro (`enviarPedidoCompraAoFinanceiro`). A recusa do
     envio grava `acao_negada` com `motivo: prazo_de_envio_encerrado`.
   - Só o 1º vencimento conta: as parcelas seguintes caem em janelas
     depois dele, com data-limite depois.
4. **A PP gerada antes de 08/10/2026 passa como está** (como a PP anterior
   às janelas na 077, pergunta 6a). Em 07/10/2026 eram 16 PPs geradas e não
   enviadas, 9 já fora do prazo (8 reais, com vencimento 08/10 ou 20/10, e
   1 de teste). Corte: `INICIO_DO_PRAZO_DE_ENVIO`, pelo `created_at` da PP
   no dia de São Paulo.
5. **PP gerada que perdeu o prazo: "Atualizar vencimento"**, no lugar de
   "Cancelar e refazer" (pedido do Tiago). No cartão da PP, no painel do
   item, aparece o aviso "O prazo de envio do vencimento X terminou em Y",
   uma lista com as 6 próximas janelas abertas ("20/11/2026 · envio até
   05/11/2026") e o botão. O "Enviar ao financeiro" fica travado até lá.
   A PP continua a mesma (código, documentos, valores, dados de
   pagamento); mudam o 1º vencimento, as parcelas seguintes (a mesma janela
   nos meses seguintes, como na 077, com os mesmos valores) e o PDF, que é
   refeito com a data de emissão de antes, o CNPJ da PP (156) e os dados
   de pagamento da foto da PP (067 e 127). Auditoria
   `pedido_compra.vencimento_atualizado` com as datas de antes e de depois.
   Quem pode: quem gera PP (`jobs.emitir_pp`). O servidor só aceita na PP
   `gerada` cujo vencimento já perdeu o prazo; fora disso a PP gerada segue
   sem edição (153).
6. **Pagamento urgente não libera a data-limite**, pela mesma lógica da 077:
   a produção marca e justifica; quem antecipa é o financeiro, ao escolher
   a data na aprovação, que continua livre.
7. **PP a emitir com data que perdeu o prazo**: o cartão dela no painel
   avisa; o formulário salva, mas não gera ("Escolha outra data para gerar
   a PP").

## As próximas datas-limite

| Janela | Paga em | 15 dias antes | Data-limite |
|---|---|---|---|
| 20/10/2026 | ter 20/10 | seg 05/10 | 05/10 |
| 08/11/2026 | seg 09/11 | sáb 24/10 | **sex 23/10** |
| 20/11/2026 | sex 20/11 | qui 05/11 | 05/11 |
| 08/12/2026 | ter 08/12 | seg 23/11 | 23/11 |
| 20/12/2026 | seg 21/12 | sáb 05/12 | **sex 04/12** |
| 08/01/2027 | sex 08/01 | qui 24/12 | 24/12 |
| 08/02/2027 | seg 08/02 | dom 24/01 | **sex 22/01** |

Em 07/10/2026 a primeira janela possível é a de 08/11 (paga 09/11). Até o
fim de 2027 nenhuma data-limite cai em feriado nacional cadastrado; só o
fim de semana muda alguma coisa.

## Onde está

- `lib/calculos/janelas-pagamento.ts` — `dataLimiteDeEnvio`,
  `vencimentoAceitaEnvio`, `janelasComEnvioAberto`,
  `primeiraJanelaComEnvioAberto`, `ppSegueOPrazoDeEnvio`. Testes em
  `janelas-pagamento.test.ts` (as linhas do calendário do financeiro,
  domingo, feriado, virada de ano, corte de 08/10 no fuso de São Paulo).
- `lib/data/feriados-nacionais.ts` — a leitura dos feriados nacionais.
- `realizado/actions-pp.ts` — as travas (`erroDoPrazoDeEnvio`, envio) e as
  actions `atualizarVencimentoDaPP` e `feriadosNacionaisParaPP`.
- `realizado/prazo-de-envio-pp.tsx` — `useFeriadosNacionais`, `EnvioAte`,
  `AtualizarVencimento`. `prazo-e-urgencia-pp.tsx` — o calendário e o
  aviso do formulário.

## Conferido em 07/10/2026 (TES-1008/26, projeto TES-P002/26)

Com o corte antecipado só no servidor local, para as PPs geradas antes de
hoje entrarem na regra (revertido antes do commit):

- **PP-00088** (Fornecedor Teste, vencimento 08/10): o painel mostrou o
  aviso "terminou em 23/09/2026", a sugestão 09/11/2026 · envio até
  23/10/2026 e o "Enviar" travado. Por fora da tela, o envio foi recusado
  com a mensagem do prazo, e o atualizar recusou 20/10 (prazo encerrado) e
  10/11 (fora das janelas), sem gravar. Pela tela, "Atualizar vencimento"
  gravou 09/11 na PP e na parcela, regravou o PDF (Emissão 25/09/2026,
  Prazo de Pagto 09/11/2026, CNPJ da PP, PIX da foto) e a auditoria. Depois
  dele, o envio passou do prazo e parou na NF que falta, e um segundo
  atualizar foi recusado ("ainda aceita envio até 23/10").
- **PP-00122** (2 parcelas de R$ 3.500, vencimento 08/10): escolhida a
  2ª opção da lista, 20/11/2026; as parcelas ficaram 20/11 e 21/12 (o
  20/12 é domingo), com os mesmos valores.
- **Formulário de nova PP** (aberto e cancelado): prazo sugerido 09/11,
  "Envio ao financeiro até 23/10/2026"; outubro inteiro apagado no
  calendário e, em novembro, só 09 e 20.
- Sem o corte antecipado: a PP-00088 ainda com 08/10 aparecia sem aviso e
  com o "Enviar" liberado.

**Conferido em 08/10/2026 — PP a emitir que perdeu o prazo (TES-1001/26,
Item 3 · Agrupamento 2).** Nenhum fluxo cria esse estado no mesmo dia: a
PP a emitir foi salva pela tela com o vencimento 09/11 (válido; cartão sem
aviso) e, só no servidor local, a antecedência subiu de 15 para 40 dias,
como se o tempo tivesse passado (revertido depois, sem commit):

- O cartão no painel mostrou "O prazo de envio do vencimento 09/11/2026 já
  passou. Edite a PP a emitir e escolha outra data antes de gerar."
- "Gerar PP" no cartão abriu a revisão, e o "Gerar PP" dela foi recusado
  pelo servidor ("terminou em 29/09/2026 [...] A primeira janela possível
  hoje é 20/11/2026"), sem gerar PP.
- "Editar" na revisão abriu o formulário com "Envio ao financeiro até
  29/09/2026" e o aviso "Para gerar a PP, escolha a partir de 20/11/2026".
  "Gerar PP" ali foi barrado na tela; "Salvar" sem mexer na data gravou.
- No calendário, o 09 (data gravada) seguiu clicável e o 20 também; com
  20/11 o aviso sumiu, "Salvar" gravou e o cartão ficou sem aviso.
- A PP a emitir de teste foi excluída pela tela no fim.

## O que ficou de fora

- A troca de vencimento não entra na linha do tempo da PP
  (`pedidos_compra_eventos`): só na auditoria. Entrar lá pede migration
  (evento novo e gatilho).
- As janelas em si (dia 08 e 20) continuam rolando só no fim de semana,
  sem feriado — a pendência da 077 segue como estava.
