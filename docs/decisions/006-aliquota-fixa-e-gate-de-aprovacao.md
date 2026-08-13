# 006 — Alíquota de imposto sai de campo livre, e aprovar a versão exige alíquota e valor

## Status

Vigente. Decidida em 13/08/2026, na revisão do formulário de orçamento.

## A regra em uma frase

**O imposto deixa de ser digitado e passa a ser escolhido entre duas
alíquotas fixas — 19,53% e 24,269914% — e a aprovação da versão só é liberada
quando existe alíquota escolhida E ao menos um item da planilha com valor.**

## Por que campo livre não servia

O percentual era um `<input>` numérico de 0 a 100. O banco tinha, nas 21
versões existentes, quatro valores diferentes: 19,53 (11 versões), 0 (5),
19,54 (4) e 20 (1). O 19,54 é erro de digitação do 19,53 — quatro versões
foram para o financeiro com um imposto que a California não pratica.

Uma lista fechada elimina a classe inteira de erro. As duas alíquotas são as
praticadas; qualquer outra é engano.

## Escolher NÃO é obrigatório para criar ou editar

Criar versão e editar versão seguem funcionando com o imposto em branco:

- **Criar** sem escolher grava o default `0`.
- **Editar** sem escolher preserva a alíquota que já estava lá, igual aos
  demais campos do drawer.

A exigência vale **só na aprovação**. O motivo é o custo do momento: aprovar
trava os valores da versão e é o que alimenta o job. Um imposto errado que
passe daqui só reaparece no financeiro, quando corrigir já significa
desaprovar. Antes disso, a versão ainda é rascunho e obrigar a decidir só
atrapalharia quem está montando a planilha.

## O que bloqueia a aprovação

Três checagens, nesta ordem, em `bloqueioAprovacaoVersao`
(`lib/validations/versoes.ts`):

1. **Alíquota fora da lista** — inclui o `0` com que versão importada nasce.
2. **Nenhum item.**
3. **Nenhum item com valor** — `total_orcado > 0`. Regra nova: antes bastava
   existir item. Linha criada e não preenchida tem total zero (a coluna é
   gerada: `unitário × quantidade × dias`), e aprovar assim travava a versão
   e abria job com orçado zerado.

A função mora em `lib/validations/versoes.ts` de propósito: roda no servidor,
dentro de `aprovarVersao`, e também no cliente, para desabilitar o botão
"Aprovar versão" com o motivo à vista. Mensagem única impede o botão dizer uma
coisa e o servidor recusar por outra. O servidor é quem de fato barra — a tela
só antecipa.

## O que mudou no banco

`versoes_orcamento.percentual_imposto` foi de `numeric(6,3)` para
`numeric(10,6)` — migration `20260813000002_imposto_seis_casas.sql`.

Com três casas, o Postgres gravava `24.269914` como `24.270` e a tela exibia
"24,27" logo depois de o usuário escolher 24,269914. Em dinheiro a diferença é
de R$ 0,09 a cada R$ 100 mil, irrelevante; o problema era a tela contradizer a
escolha. Ampliar escala não perde dado, nenhuma view depende da coluna, e o
CHECK `versoes_orcamento_percentuais_validos` compara contra numeric genérico.

`percentual_honorarios` continua `numeric(6,3)`: vem do cadastro do cliente e
não tem caso de seis casas hoje.

## O dado que já existia

Nenhuma das 11 versões **já aprovadas** é afetada — todas têm alíquota válida
e itens com valor. Entre as 6 ainda aprováveis, 3 passam a ser barradas: duas
por alíquota `0` e uma por ter dois itens sem valor. As 4 versões com 19,54 e
a com 20 **não foram corrigidas** — mexer nelas sobrescreveria valor existente
e recalcularia imposto de versão alheia. Quem for aprovar escolhe a alíquota
certa na hora, e o gate garante que ninguém aprova sem passar por isso.

## Onde as opções moram

`lib/impostos.ts` — `ALIQUOTAS_IMPOSTO`. Alíquota nova entra ali e aparece nas
três telas de uma vez: parâmetros do rascunho, nova versão e edição da versão.
Não escrever percentual solto no JSX.
