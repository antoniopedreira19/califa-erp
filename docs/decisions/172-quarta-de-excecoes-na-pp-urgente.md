# 172 — Quarta de exceções na PP urgente, e as datas das parcelas que se adiam

**Data:** 2026-10-14
**Status:** aceita e implementada (14/10/2026), por cima da
[173](173-pp-gerada-volta-a-se-editar.md) — a edição da PP gerada segue as
mesmas regras.
**Quem decidiu:** Tiago, em 13/10/2026 (pedido e respostas) e 14/10/2026
(aprovação do protótipo: selo vermelho e calendário no "Atualizar
vencimento").
**Revê:** a [077](077-o-prazo-da-pp-cai-em-janela-e-a-pp-pode-ser-urgente.md)
§3 (datas das parcelas travadas) e §5 ("a urgência não libera prazo fora
das janelas"), e a [157](157-prazo-de-envio-da-pp.md) §6 (a mesma regra no
prazo de envio).
**Migration:** nenhuma. Não há regra de janela no banco: as travas são das
Server Actions.

## O pedido

> Quando a opção de "Pagamento Urgente" for selecionada, possamos
> selecionar as quartas-feiras como data de pagamento — a "Quarta de
> exceções". Até sexta de uma semana, deverá ser possível selecionar a
> quarta da semana seguinte, ou outras quartas futuras, além das janelas
> de pagamento já cadastradas.

## A regra

### 1. Quarta de exceções

- Com **Pagamento urgente** ligado, o prazo de pagamento (o 1º
  vencimento) aceita, além das janelas 08/20, **qualquer quarta-feira**
  futura, escolhida **até a sexta anterior**, o dia inteiro. Em terça
  13/10/2026 a primeira é a de 21/10; no sábado 17/10, a de 28/10.
- A mesma sexta é a **data-limite de envio** ao financeiro (resposta 1a).
  Caindo em feriado nacional, vale o dia útil anterior: a quarta
  25/11/2026 fecha na quinta 19/11, porque 20/11 é a Consciência Negra.
- **Quarta em feriado nacional não existe** (21/04/2027, Tiradentes).
  Como na 157, só os feriados nacionais do cadastro do Fiscal contam.
- A quarta que **também é janela** (o 08 ou o 20 numa quarta, como
  20/01/2027) segue só a regra da janela, para a data não ter duas
  datas-limite.
- **Desligar a urgência** com uma quarta no prazo devolve o prazo à
  primeira janela aberta, com o aviso "Sem urgência, a quarta dd/mm/aaaa
  não vale: o prazo voltou para dd/mm/aaaa." O servidor recusa quarta sem
  urgência.
- A data escolhida na aprovação do financeiro continua livre (077 §6).

### 2. Datas das parcelas (resposta 2a com ajuste)

- **A 2ª parcela nunca cai na janela logo seguinte à 1ª**: vai para a
  outra. Quarta 21/10 → 2ª em 20/11 (pula 09/11); quarta 03 → dia 20 do
  mesmo mês (pula o 08). Para a 1ª numa janela isso é a mesma janela no
  mês seguinte, como já era (09/11 → 08/12).
- As seguintes, mês a mês, pela mesma regra: cada parcela pula ao menos
  uma janela depois da anterior. 21/10 → 20/11 → 21/12 → 20/01.
- As datas **deixam de ser travadas**. O padrão é o de cima; da 2ª em
  diante a data abre um calendário que só acende **janelas a partir da
  data padrão** — só adia, nunca antecipa. A parcela adiada ganha o ↺,
  que volta para a data padrão. Vale para **toda PP**, urgente ou não.
- Quando a anterior anda (o prazo mudou, ou outra parcela foi adiada), a
  adiada fica se ainda couber; se ficar cedo demais, vai para a primeira
  data possível e volta a ser padrão.
- A **quarta só vale para o 1º pagamento**: as parcelas seguintes são
  sempre janelas.
- O rodapé das parcelas diz: "Cada parcela pula ao menos uma janela · a
  última fecha os 100%".

### 3. Financeiro: o selo da quarta (aprovado em 14/10)

Na tela da PP, no quadro **Vencimento original** da coluna Dados da PP,
a PP urgente com o 1º vencimento numa quarta ganha o selo **"✓ quarta de
exceções"**, em vermelho, da cor da etiqueta "Urgente". Sem ele, a quarta
cairia em "fora das janelas". As 3 PPs antigas em avaliação com vencimento
numa quarta (PP-00032, PP-00041 e PP 24663, de setembro, sem urgência)
continuam "fora das janelas": são anteriores à regra da 077.

### 4. "Atualizar vencimento" da PP urgente (aprovado em 14/10)

O atalho da 157 §5 — a PP gerada que perdeu o prazo de envio escolhe uma
data nova sem cancelar e refazer — passa a abrir, **na PP urgente, um
calendário** com as janelas abertas e as quartas de exceções (o ponto
vermelho e a legenda), com "envio até" embaixo. A PP sem urgência segue
com a lista de janelas de hoje. Depois da troca, as parcelas seguintes
ficam onde estão se ainda couberem; senão, vão para a primeira data
possível.

## O que o servidor confere

Em todas as portas que gravam o prazo e as parcelas — salvar a PP a
emitir, gerar a PP, editar a PP gerada, corrigir a rejeitada, enviar ao
financeiro e atualizar o vencimento:

- 1º vencimento: janela com envio aberto **ou** quarta de exceções aberta
  com a PP urgente. Quarta sem urgência é recusada, mesmo sem a data
  mudar.
- Da 2ª parcela em diante: janela, e não antes da primeira data possível
  depois da anterior. A data gravada que não mudou, com a anterior também
  igual, passa como está (PP anterior à regra, 077 pergunta 6a).

## Onde está

- `lib/calculos/janelas-pagamento.ts` — `ehQuarta`, `dataLimiteDaQuarta`,
  `quartaDeExcecoesAberta`, `tipoDoPrazo`, `primeiraDataPossivelDoPrazo`,
  `primeiraDataDaProximaParcela`, `acomodarDatasDasParcelas`,
  `parcelaForaDaRegra`; `dataLimiteDeEnvio` passou a responder pela
  quarta. Testes em `janelas-pagamento.test.ts`.
- `components/ui/date-picker.tsx` — `diasMarcados` e `legenda`.
- `realizado/prazo-e-urgencia-pp.tsx` — o calendário do prazo com a
  quarta, a legenda, o aviso da urgência desligada e o texto novo do bloco
  de urgência.
- `realizado/parcelas-da-pp.tsx` — o calendário de cada parcela e o ↺.
- `realizado/prazo-de-envio-pp.tsx` — "Quarta de exceções · envio até" e o
  calendário do "Atualizar vencimento".
- `financeiro/contas-a-pagar/pp-dossie.tsx` — o selo.
- `realizado/gerar-pp-drawer.tsx` — o calendário do prazo com a urgência,
  a urgência desligada que devolve o prazo à janela, as parcelas que se
  adiam e as mensagens; vale para a PP nova, a PP a emitir e a PP gerada em
  edição (173).
- `realizado/actions-pp.ts` — `validarVencimentosNasJanelas` ganhou a
  urgência e a regra das parcelas (todas as portas passam por ela); o envio
  recusa quarta sem urgência; o "Atualizar vencimento" aceita quarta na PP
  urgente e acomoda as parcelas.
- `realizado/painel-pps-item.tsx` e `job-item-realizado-table.tsx` — a
  urgência chega ao cartão da PP (`urgente` obrigatório em `PPDoItem`).

## Conferido em 14/10/2026 (TES-1001/26 · Item 5, servidor local)

- **Formulário (PP de verba de produção, "GP Teste"):** com a urgência, o
  calendário de outubro só acendeu 21 e 28, com o ponto e a legenda; 21/10
  com 3 parcelas deu 21/10 → 20/11 → 21/12 e "Quarta de exceções · envio
  até 16/10/2026". A 2ª adiada para 21/12 levou a 3ª para 20/01/2027 e
  ganhou o ↺ (o calendário dela só acendeu janelas a partir de 20/11).
  Desligar a urgência devolveu o prazo para 09/11 com o aviso, e a adiada
  ficou. Religada, 21/10 de novo.
- **PP a emitir:** salva com 21/10 · 21/12 · 20/01 e urgente (conferido no
  banco); o cartão do painel ficou sem aviso; reaberta, voltou com a 2ª
  adiada e o ↺, sem o aviso de "anterior à regra".
- **Gerar:** a revisão mostrou "3 parcelas, a 1ª em 21/10/2026"; nasceu a
  PP-00170, gerada, com as mesmas datas.
- **Atualizar vencimento:** com o "hoje" antecipado para 17/10 só no
  servidor local (revertido antes do commit), o cartão mostrou "terminou em
  16/10/2026", o "Enviar ao financeiro" travado e o calendário sugerindo
  28/10 (novembro com 4, 11, 18 e 25 marcadas e as janelas 9 e 20). Com
  04/11, a PP ficou 04/11 · 21/12 · 20/01, com os mesmos valores.
- **Financeiro:** enviada no dia real (04/11 aceita envio até 30/10), a tela
  da PP-00170 em Contas a Pagar mostrou o selo "✓ quarta de exceções" em
  vermelho no Vencimento original, com a etiqueta "Urgente". Sem erros no
  console. A PP foi rejeitada ("PP de teste da decisão 172") e cancelada
  pela tela no fim.
- **Servidor chamado por fora da tela** (`salvarPPAEmitir`, transporte real
  da action): 5 recusas, nada gravado — quarta sem urgência, 2ª parcela na
  janela logo seguinte (09/11), 2ª parcela numa quarta (25/11), a quarta da
  mesma semana (14/10, "fechou em 09/10") e uma quinta-feira.
- **Testes:** `node --import tsx --test lib/calculos/janelas-pagamento.test.ts`
  — 16 testes, 8 deles novos. `tsc` e `eslint` dos arquivos alterados limpos.

**Não exercitado no navegador:** a edição de uma PP gerada com quarta (173)
— passa pelo mesmo formulário e pelo mesmo validador do servidor — e o
"Atualizar vencimento" da PP sem urgência, que não mudou (a lista de 6
janelas).

## Protótipo

https://claude.ai/artifact/Te6aeYHavb9UrSqTzFQ16S — as três telas reais
(formulário da PP, tela da PP no financeiro e o painel do item com o
"Atualizar vencimento"), aprovado em 14/10/2026.
