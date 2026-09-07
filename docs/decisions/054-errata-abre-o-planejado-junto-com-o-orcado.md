# 054 — "Realizar errata": a errata abre o planejado junto com o orçado

**Data:** 2026-09-07
**Status:** aceita
**Contexto:** modo errata da Planilha Interna do job (`/jobs/[jobId]`,
aba "Planilha Interna", e a mesma seção em `/financeiro/jobs/[jobId]`).
Pedido do Tiago em 07/09/2026. Completa a 030 (errata na planilha) e a
040 (linha com PP não entra).

## A mudança em três frases

1. **O botão chama-se "Realizar errata"** (ligado: "Realizando errata").
   Era "Alterar orçado", e o nome prometia menos do que o botão faz.
2. **A errata abre o PLANEJADO da linha** — R$ Unit., QT e D/M — na
   linha nova e na linha existente cujo orçado foi corrigido.
3. **O planejado só abre quando o orçado da linha também mudou.** Sem
   mudança no orçado, as três células do planejado continuam de leitura,
   com o motivo no `title`.

## 1. Por que o planejado entra na errata

A planilha do job não tinha edição de planejado em lugar nenhum. A linha
criada por errata nascia com planejado zero "a ser preenchido pelo fluxo
normal do planejado" — e esse fluxo era o editor da versão do orçamento,
que a linha de errata não tem. O item corrigido ficava com o planejado
aprovado, mesmo quando a correção do orçado era exatamente o que mudava
o custo com que a agência conta.

## 2. A regra: o orçado é a porta

**Planejado sozinho não é errata.** A errata é o registro de uma correção
no orçado do job; o planejado que muda é consequência dela. Por isso:

| Linha | Planejado na errata |
|---|---|
| nova, normal | **abre** — orçado novo por definição |
| nova, vermelha | não (zero, cobrado pelo banco) |
| existente, orçado alterado (R$ Unit., QT ou D/M) | **abre** |
| existente, orçado igual ao salvo | não — "O planejado só abre depois de corrigir o orçado desta linha." |
| existente, só o tipo mudou | não |
| custo `A` ou `D`, qualquer caso | não — espelha o orçado (trigger `planejado_espelha_orcado`) |
| em save | não (zero) |
| com PP no financeiro | não — a linha inteira está fora (040) |

**A porta fecha no sentido inverso também.** Quem corrigiu o orçado,
digitou um planejado e depois devolveu o orçado ao valor original perde o
planejado digitado: ele volta ao salvo. Deixá-lo guardado faria ele
reaparecer do nada na próxima correção da mesma linha.

**Trocar o tipo não abre o planejado.** O tipo de custo muda o
faturamento sem mexer no custo orçado; se a intenção é replanejar,
corrige-se o orçado. A exceção é a troca para `A`/`D`, em que o trigger
passa a espelhar — e isso fica gravado no histórico como mudança de
planejado, porque foi o que aconteceu no banco.

## 3. `A` e `D` continuam espelhando

Em 04/09 o Tiago decidiu destravar o planejado de `A` e `D` (ficar como o
`AR`), e a implementação parou à espera da regra do REALIZADO desses
tipos. Esta decisão **não** antecipa aquela: na errata a célula de `A`/`D`
fica travada com a dica "Em custo A e D o planejado espelha o orçado."
Quando a outra decisão fechar, basta trocar `planejadoEspelhaOrcado`, que
é a única função consultada — na tela, no rascunho e no servidor.

## 4. Dos dois lados

- **Tela** (`errata-rascunho.ts`): `planejadoLiberado(chave)` e
  `motivoPlanejadoTravado(chave)` são a regra num lugar só; a tabela só
  pergunta. A lista `itens` — a planilha como ficaria — já aplica a regra:
  liberado, vale o digitado; `A`/`D`, o espelho; senão, o salvo.
- **Servidor** (`actions-errata.ts`, `planejadoQueFica`): o payload
  carrega `valor_unitario_planejado`, `quantidade_planejada` e
  `dias_meses_planejado` como **opcionais** em `alteracoes` e `novas`.
  Sem mudança no orçado o servidor ignora o planejado informado; em
  vermelha e save grava zero; em `A`/`D` grava o espelho.

## 5. O histórico guarda o planejado

`jobs_erratas_itens` ganhou `valor_unitario_planejado_de/para`,
`quantidade_planejada_de/para`, `dias_meses_planejado_de/para` e
`total_planejado_de/para` (migration `20260907210001`). Nulas nas erratas
anteriores — a tela mostra travessão, não inventa número. O card de
Erratas ganhou a coluna **Planejado**, e o pop-up de confirmação mostra a
sublinha "planejado R$ X → R$ Y" na linha em que ele mudou.

## O que NÃO mudou

- O planejado continua sem efeito em faturamento previsto e valor do
  job. A errata não muda de peso por ele.
- A versão aprovada não é tocada.
- Tudo o que a 030 e a 040 fecham continua fechado.
