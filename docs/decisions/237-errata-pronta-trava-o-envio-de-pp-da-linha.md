# 237 — A errata pronta para envio trava o envio de PP da linha que ela altera

**Data:** 2026-11-04
**Status:** aceita e implementada em 04/11/2026.
**Quem decidiu:** Tiago, em 04/11/2026, entre três opções (A travar o
envio, B só avisar, C tirar a linha da pronta sozinho). Escolheu a A, que
era a recomendada.
**Completa:** [159](159-errata-pronta-para-envio.md) (errata pronta),
[040](040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md) §1 (linha
com PP no financeiro não entra em errata) e
[185](185-errata-trava-o-envio-de-pp-so-na-linha-alterada.md) (a revisão
trava só a linha alterada).
**Migration:** nenhuma. A trava é de código, como a da 185.

## O caso

No TNT-1001/26, a produção deixou pronta em 29/10 uma errata que zerava o
orçado de uma linha de cenografia (R$ 3.900 → R$ 0). Em 31/10 uma PP de
R$ 66 da mesma linha foi enviada ao financeiro. Quando a GP foi confirmar a
errata, o servidor recusou: "Linha com PP emitida não entra em errata"
(decisão 040 §1).

A trava da 040 é conferida quando a pronta é salva e de novo quando ela é
confirmada. O envio da PP não olhava a pronta, então o conflito nasceu no
meio, sem aviso a ninguém, e só a GP soube, no fim.

Levantamento em 04/11/2026: das 23 prontas do banco (18 enviadas, 4
paradas, 1 descartada), esse foi o único caso. Mas o AMB-1042/26 tinha,
nesse dia, uma PP gerada numa linha da pronta parada dele.

## A regra

1. **Com errata pronta parada no job, a PP da linha que ela altera ou
   cancela não vai ao financeiro.** Gerar, editar e cancelar a PP seguem
   livres; só o envio fecha.
2. **As outras linhas enviam normalmente.** A linha nova da pronta ainda
   não existe no job; a organização da planilha (decisão 162) e os
   parâmetros do job (decisão 233) não mexem em linha. Nada disso trava.
3. **A trava sai quando a pronta sai**: enviada pelo GP (e aí vale a 185,
   enquanto a revisão da abertura não for salva), editada sem aquela linha,
   ou descartada.
4. **Sem conseguir ler a pronta, trava.** O envio é o passo que compromete
   dinheiro, como na 185.

Texto na tela (painel do item e dica do botão na aba Pedidos de Produção):
"Esta linha está na errata pronta para envio. Envie a errata ao
financeiro, tire esta linha dela ou descarte-a antes de enviar as PPs
desta linha."

O servidor recusa com o nome do item e registra `acao_negada` com o motivo
`linha_na_errata_pronta` (ou `errata_pronta_nao_conferida`, quando a
leitura falha).

## Por que não as outras

- **B, só avisar:** quem envia é o GP, e quem trava no fim também é o GP.
  O aviso deixaria o conflito possível, só mais visível.
- **C, tirar a linha da pronta sozinho:** mudaria a errata sem ninguém ver.
  No TNT-1001/26, o desconto de R$ 9.911 cairia para o que sobrasse das
  outras linhas.

## O que não muda

- A PP já enviada antes da regra continua onde está. No TNT-1001/26 a saída
  é a de sempre: cancelar a PP enquanto está em avaliação, confirmar a
  errata e emitir a PP de novo.
- A RLS de `jobs_erratas_prontas` mostra a pronta a administrador, GP e
  produtor, que são todos os papéis que enviam PP (`jobs.enviar_pp` e o
  produtor com a chave, decisão 174). A trava não depende de outro acesso.

## Onde está

- `lib/data/linhas-da-revisao.ts`: `linhasDaErrataPronta` (as linhas de
  `alteracoes` e `cancelamentos`) e `linhasNaErrataProntaDoJob` (a leitura
  para a action).
- `realizado/actions-pp.ts`, `barrarEnvioDePP`: a trava no servidor, depois
  da pré-abertura e da revisão.
- `carregar-detalhe.ts` → `linhasNaErrataPronta`, passado ao painel do item
  (`job-item-realizado-table.tsx`) e à aba de PPs (`job-pps-section.tsx`,
  como `realizadosNaErrataPronta`).

## Testado

Em 04/11/2026, no TES-1035/26 (projeto P-0006/26), pelos fluxos da tela:
o Produtor Teste Claude gerou a PP-00825 (R$ 100) em "Produção de posts" e
deixou pronta uma errata mudando o planejado da linha (R$ 4.000 → R$
3.500). Como GP Teste: o "Enviar ao financeiro" do painel e o da aba de PPs
vieram desabilitados, com o texto acima; a action chamada direto recusou
com a mensagem do servidor e gravou `acao_negada`
(`linha_na_errata_pronta`). Depois de descartar a pronta, o botão voltou.
A PP de teste foi cancelada e a pronta ficou `descartada`.
`npm run test:linhas-da-revisao` cobre o helper.
