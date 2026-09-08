# 062 — O BV sai do planejado, vira vários por item e ganha alíquota própria; e o A · Repasse precisa fechar o orçado

**Data:** 2026-09-08
**Status:** aceita
**Migrations:** `20260908160001_bv_multiplo_por_item_e_aliquota_propria.sql`,
`20260908160002_planejado_livre_em_a_e_d.sql`
**Contexto:** planilha da versão do orçamento
(`/orcamentos/[projetoId]/[orcId]`), Planilha Interna do job
(`/jobs/[jobId]` e `/financeiro/jobs/[jobId]`), conferência da abertura e
as visões agregadas de projeto. Revê a
[022](022-bv-liquido-e-realizado-por-pp.md) §3, §4 e §7, e acrescenta uma
trava ao envio de PP da [039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md).
Decisões do Tiago em 08/09/2026.

## A mudança em cinco frases

1. **`A` e `D` voltam a ter planejado digitado.** O espelho do orçado,
   criado na 022 §4, acabou — nenhum tipo espelha mais.
2. **O BV deixa de descontar o PLANEJADO** e passa a descontar só o
   REALIZADO. Com isso caiu o congelamento do BV na aprovação da versão.
3. **O que se desconta é o BV BRUTO**, não mais o líquido.
4. **Um item aceita VÁRIOS BVs**, cada um com fornecedor, prazo, alíquota
   e situação próprios — e cada um confirmado sozinho, como as PPs.
5. **A alíquota virou campo do BV**, opcional enquanto se negocia e
   obrigatória para confirmar (que é o envio ao contas a receber).

E, fora do BV: **em custo `A · Repasse` a soma das PPs do item precisa
cobrir o orçado** antes de qualquer PP dele sair para o financeiro e
antes de o item poder ser marcado como concluído.

## 1. O planejado de `A` e `D`

A 022 §4 tirou o planejado próprio desses dois tipos: como o cliente paga
o fornecedor diretamente, entendeu-se que a agência não tinha custo a
planejar — o custo ERA o orçado, e o ganho era a comissão.

Na prática o GP precisa registrar **quanto o serviço custa de verdade**,
que é o que ele negociou, e esse número não é o que foi orçado ao
cliente. O `AR` nunca teve o espelho exatamente por isso; `A` e `D`
passam a se comportar como ele.

| Tipo | Planejado até 07/09 | Planejado agora |
|---|---|---|
| `A · Direto` | travado, espelhava o orçado | **digitado** |
| `D · Interno` | travado, espelhava o orçado | **digitado** |
| `AR`, `B`, `C`, `F`, `FI` | digitado | digitado |

Com `A` e `D` fora, **nenhum** tipo espelha mais. O que sobrou no trigger
`planejado_espelha_orcado` é o ramo do SAVE, que zera o planejado da
linha em save ([028 §9](028-save-entre-jobs.md)) — e é por ele que a
função continua existindo.

> ⚠️ **O nome da função é histórico e ficou.** Ela não espelha mais nada.
> Renomear objeto de banco compartilhado com outra frente de
> desenvolvimento quebra mais do que resolve; o comentário dela conta o
> que ela faz hoje.

**Sem backfill, de propósito.** Os 34 itens `A` das versões e os 20 das
cópias de job estavam com `planejado = orçado`, escrito pelo próprio
espelho. Continuam exatamente assim — o que muda é que agora dá para
editar. Zerá-los apagaria custo que já está na conta de job aberto. (Não
existe nenhum item `D` no banco.)

**O REALIZADO de `A` e `D` não mudou:** continua espelhando o orçado
(decisão do Tiago, entre três opções). Eles não geram PP, então não há de
onde montá-lo, e `realizadoBrutoDoItem` segue como estava.

## 2. O BV sai do planejado

| Bloco | BV que descontava | BV que desconta agora |
|---|---|---|
| ORÇADO | nenhum | nenhum |
| PLANEJADO | todos os ativos, congelados na aprovação | **nenhum** |
| REALIZADO | só `confirmado` e `recebido` | só `confirmado` e `recebido` |

O planejado passa a ser o custo que o GP registrou, e só isso. A comissão
aparece onde ela acontece, que é no realizado.

**Três coisas caíram junto:**

- **O congelamento na aprovação.** `aprovarVersao` gravava
  `versoes_orcamento_itens.bv_liquido_planejado` para que editar o BV no
  job não reescrevesse o planejado da versão aprovada (022 §3). Sem
  dedução no planejado não há o que congelar — e, com vários BVs por
  item, o valor único da coluna não representaria nenhum deles. **A
  coluna não foi apagada**: ela guarda o que já foi congelado, como
  histórico, e ninguém mais a lê.
- **A linha `+ BVs` da ótica PLANEJADA** do painel Resultado. A conta era
  `Valor do Job − Impostos − Custo bruto + BVs`, algebricamente igual a
  `− Custo líquido`. Sem a dedução no planejado, somar ali faria o painel
  discordar da coluna PLANEJADO ao lado. Na ótica REALIZADA a linha
  continua, agora com o bruto. A prop `bvPlanejado` de `PainelResultado`
  foi **removida**, e não zerada: regra que depende de um zero acidental
  volta na primeira distração.
- **A chave Bruto ⇄ Líquido nas telas de orçamento** — a planilha da
  versão e o editor agregado do rascunho. Nelas não há REALIZADO, então a
  chave não mudaria número nenhum. A vista dessas telas ficou **fixa em
  "bruto"**, senão a coluna continuaria rotulada "Total líquido" sem
  deduzir nada.

A chave **continua nas três telas do job**: Planilha Interna (a mesma
seção serve `/jobs/[jobId]` e `/financeiro/jobs/[jobId]`), conferência da
abertura no financeiro e visão agregada de jobs do projeto.

## 3. Bruto, e não líquido

O que o REALIZADO subtrai é o **valor cheio negociado com o fornecedor**.

Isso desfaz a assimetria que a 022 §8 documentava como "o único lugar do
produto onde os dois números convivem": a fila de faturamento
(`vw_faturamento_pendente`) sempre propôs `bv.valor`, o bruto. Agora a
planilha desconta o mesmo número que a fila fatura.

`bvLiquido` e `impostoDoBv` continuam existindo — o formulário mostra o
líquido, e é ele que diz o que de fato sobra para a agência. Só deixaram
de alimentar a planilha.

## 4. Vários BVs por item

Um item pode ter mais de uma comissão a negociar. O painel "BV do item"
virou **lista**, no desenho do painel de PPs, e **cada BV anda sozinho**
(decisão do Tiago, entre duas opções):

- confirmado e enviado ao contas a receber individualmente;
- alíquota própria, cobrada no Confirmar dele;
- **dá para lançar um BV novo com outro já confirmado ou recebido** — que
  é o caso que motivou a lista. A alternativa (um botão que confirma
  todos de uma vez e fecha o item) engessaria a comissão negociada
  depois.

O que a planilha desconta do realizado é a **soma** dos que já contam.

**No banco:** caíram `uniq_bv_item` (constraint) e `uniq_bv_por_copia`
(índice único), e voltaram como índices comuns — "os BVs deste item" é a
consulta de toda planilha que mostra a dedução, e sem índice ela vira seq
scan. Isso **afrouxa** uma restrição: os 16 BVs existentes seguem
válidos, um por item, como estavam.

**Cancelar passou a ser por BV.** O `update` do cancelamento mirava
`item_versao_id`; mantido assim, cancelaria todos os BVs da linha de uma
vez.

**O BV continua sendo lançável no ORÇAMENTO** (decisão do Tiago). Ele já
não mexe em número nenhum daquela tela — o realizado só existe depois que
o job abre —, mas segue como registro da comissão já combinada, e viaja
para o job na abertura.

## 5. A alíquota é do BV

Até aqui o imposto do BV saía de `versoes_orcamento.percentual_imposto`,
a alíquota do job, e o formulário só a exibia. Agora ela é
`itens_bv.percentual_imposto`: **nullable**, digitada, e exigida só para
confirmar.

Nullable é o ponto: vindo do job ela nunca estava vazia, e "obrigatória
para o envio" não teria como virar código. O campo em branco mostra a
alíquota do job como *placeholder*, apenas de referência.

**Duas linhas de defesa**, porque `situacao` também se move por trigger
(a baixa do título leva a `recebido`), e ali não passa Server Action
nenhuma:

- `confirmarBv` recusa em português;
- `chk_bv_confirmado_tem_aliquota` recusa no banco.

Mais `chk_bv_percentual_imposto_faixa` (`>= 0` e `< 100`): alíquota fora
disso produziria um BV líquido maior que o bruto na tela do financeiro.

## 6. `A · Repasse`: as PPs precisam fechar o orçado

No `AR` o principal passa pela California e é **repassado** ao
fornecedor. Não é margem, é dinheiro de passagem — fechar o item com PPs
somando menos que o orçado deixaria a agência com o que era do
fornecedor.

**A trava barra as duas coisas** (decisão do Tiago, entre três opções):

| | Enquanto a soma não cobre o orçado |
|---|---|
| Enviar uma PP do item ao financeiro | **barrado** |
| Marcar "todas as PPs deste item já foram geradas" ([052](052-todas-as-pps-do-item-foram-geradas.md)) | **barrado** |

Na prática: **gere todas as PPs do item `AR` antes de enviar a primeira.**

**Só `AR`.** Em `B`, `C`, `F` e `FI` o orçado é preço, e gastar menos que
ele é lucro legítimo — eles seguem como a [039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md)
deixou, sem teto e sem piso. Linha em **save** fica de fora: ela não
emite PP neste job, e travaria para sempre.

### Os três detalhes que decidem se a regra funciona

1. **Contam as PPs NÃO CANCELADAS — a `gerada` inclusive.** A trava barra
   o envio; contar só as que já chegaram ao financeiro seria esperar
   exatamente o que ela impede, e o item nunca destravaria. A
   `rejeitada` conta pela regra de sempre: vai ser corrigida e reenviada.
2. **O orçado é o da CÓPIA do job** (`jobs_itens_orcado.total_orcado`) —
   o que a errata altera.
3. **É "não pode ser MENOR que o orçado", não igualdade estrita.** Passar
   do orçado já tem tratamento próprio desde a 039 (o envio acima do
   planejado pede confirmação do responsável). Exigir igualdade exata
   criaria um beco: não existe "des-enviar PP". Meio centavo de
   tolerância, a mesma do planejado e pelo mesmo motivo — o valor da PP é
   `R$ Unit. × QT × D/M` arredondado.

### O resguardo do orçado

Pedido do Tiago: item `AR` já marcado como concluído **não entra em
errata**. Deixar o orçado se mover depois do fechamento quebraria a
invariante por trás das costas de quem já repassou.

Na prática o caso quase não acontece — em `A`, `AR` e `D` o repasse só
sai depois de o cliente pagar, e a essa altura o job está faturado e a
errata já não abre. A trava existe para o "quase". Ela **soma-se** à da
[040](040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md), que já
barra qualquer linha com PP no financeiro, de qualquer tipo.

## Onde a regra mora

| | Arquivo |
|---|---|
| Contas do BV (fonte única) | `lib/calculos/bv-planilha.ts` — `deducaoBvDoRealizado`, `temBvPendente`, `blocosDoItem` (recebe LISTA de BVs) |
| A trava do `AR` | `lib/calculos/pps-item.ts` — `exigeSomaIgualAoOrcado`, `somaDasPPsNaoCanceladas`, `faltaParaFecharOOrcado` |
| Envio de PP | `actions-pp.ts` — `barrarARComOrcadoEmAberto`, antes da conta do planejado |
| Marco "PPs concluídas" | `conclusao-item.ts` — na gravação, que é por onde os três caminhos passam |
| Errata do `AR` concluído | `actions-errata.ts` — `barrarARConcluido` |
| BV por id | `app/(app)/_bv/actions.ts` — `salvarBv(…, bvId?)`, `confirmarBv(bvId)`, `cancelarBv(bvId)` |
| Lista e alíquota no formulário | `app/(app)/_bv/bv-dialog.tsx` |
| Banco | migrations `20260908160001` e `20260908160002` |

## O que ficou de fora, de propósito

- **Apagar `bv_liquido_planejado`.** É histórico; remover coluna é
  destrutivo e não há ganho.
- **Renomear `planejado_espelha_orcado`.** Banco compartilhado.
- **Trocar a alíquota de BVs já confirmados.** Eles seguem travados.
- **A trava do `AR` no banco.** Ela mora nas Server Actions, como o gate
  do planejado da 039 — o teto em trigger foi justamente o que a 039
  removeu.
