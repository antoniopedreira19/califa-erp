# 016 — Títulos a Pagar: baixa por parcela, data de pagamento e repactuação

**Data:** 2026-08-17
**Status:** aceita
**Contexto:** `/financeiro/contas-a-pagar`. Design de referência:
`Contas a Pagar - Titulos a Pagar.dc.html` (projeto Claude Design
`69342d83`), protótipo interativo de 25 estados. Fecha o adiamento
explícito da [decisão 014](014-pps-parciais-e-parcelas.md) §7 ("a baixa
por parcela entra na Tela 3.2, que vai refazer essa máquina de todo
jeito").

## Decisão

### 1. O que se paga é a PARCELA, não o Pedido de Produção

Até aqui o financeiro aprovava e baixava a PP inteira, num lançamento
só, com o valor cheio. PP de 3 parcelas mentia duas vezes: concentrava
num dia o que sai em três, e não tinha como registrar que a 1ª saiu e as
outras não.

Agora a unidade de pagamento é a parcela. `dar_baixa_pp_parcela` marca
uma parcela, gera o lançamento com **o valor dela**, e a PP só vira
`pago` quando a última parcela é quitada.

### 2. "Título a pagar" não é tabela

A aba unificada nasce de consulta sobre o que já existe — sem
tabela-espelho, como o plano exigia:

| Origem | Fonte |
|---|---|
| `PP-NNNNN` | `pedidos_compra_parcelas` de PP `aprovada` ou `pago` |
| `AVULSO` | `contas_avulsas` com `recorrente_id` nulo |
| `RECORRÊNCIA` | `contas_avulsas` com `recorrente_id` preenchido |

A recorrência não precisou de nada novo: `gerar_ocorrencias_recorrentes`
já materializava cada ocorrência como uma `contas_avulsas`.

### 3. Duas datas onde havia uma

- **Vencimento original** — o prazo que a produção negociou com o
  fornecedor, impresso no PDF. É `pedidos_compra_parcelas.data_vencimento`
  (ou `contas_avulsas.data_prevista_pagamento`), e **ninguém escreve nele
  depois da emissão**.
- **Data de pagamento** — quando o financeiro vai pagar. Nasce na
  aprovação, é repactuável, e é a coluna nova `data_pagamento`.

Quando as duas divergem, a tela pinta a data de pagamento de vermelho:
título repactuado se enxerga de longe.

### 4. Repactuação guarda a primeira data, por trigger

O pop-up do lápis promete ao usuário que "ambas ficam registradas para
sempre". Promessa de tela não é garantia: `data_pagamento_primeira` é
gravada na aprovação e **congelada pelo trigger
`congela_data_pagamento_primeira`** — qualquer update que tente
sobrescrevê-la é silenciosamente revertido para o valor original.

Exercitado no banco antes de liberar: update forçando a 1ª data para
1999 gravou a nova data de pagamento e manteve a 1ª intacta.

### 5. PP parcelada: a data escolhida desloca TODAS as parcelas

O formulário de aprovação tem **um** campo de data, e a PP tem N
parcelas. Decisão do Tiago: a data escolhida é aplicada à 1ª parcela e as
demais são deslocadas **pelo mesmo número de dias**.

Aprovar em 08/09 uma PP que vencia 01/09 · 01/10 · 01/11 gera pagamentos
em 08/09 · 08/10 · 08/11. O espaçamento que a produção negociou é
preservado; só o ponto de partida muda. Depois disso, cada parcela é
repactuável individualmente pelo lápis.

*(As duas alternativas descartadas: aplicar só à 1ª parcela, o que
deixaria a PP com uma parcela repactuada e as outras não; e pedir uma
data por parcela na aprovação, que diverge do quadro do protótipo.)*

### 6. "Centro de custo do pagamento" é o plano de contas

O protótipo pede um campo obrigatório chamado "centro de custo", com
opções do tipo `CC-01 · Regional SP`. **Não existe centro de custo no
banco** — e a legenda do próprio protótipo ("define onde o custo entra no
DRE") descreve exatamente o par Tipo + Subtipo do plano de contas, que a
baixa já exigia (`lancamentos_financeiros.plano_conta_tipo_id` e
`plano_conta_subtipo_id`, ambos `NOT NULL`).

Decisão do Tiago: **é o plano de contas, com rótulo novo**. Nenhuma
estrutura nasce por causa desse campo. Vem sugerido quando a origem já
tem plano (avulsa e recorrência) e é editável; a escolha vai para o
lançamento, e a classificação da avulsa feita na criação não é reescrita
— são coisas diferentes, e por isso `lancamentos_financeiros` tem colunas
próprias de plano de contas.

### 7. Nenhuma conta bancária padrão

A conta que realiza o pagamento é escolhida na mão em toda baixa, de
propósito — o protótipo traz isso como *tweak* explícito.

### 8. Aprovação e rejeição não moram na aba de títulos

Regra escrita pelo próprio protótipo, no rodapé da aba: "Nesta aba só é
possível dar baixa. A aprovação e a rejeição continuam na aba de Pedidos
de Produção."

### 9. O estorno saiu da UI

Decisão do Tiago: seguir o protótipo à risca, que não tem estorno em
lugar nenhum — título pago exibe apenas "Conciliação".

`estornarBaixaPP` e `cancelar-baixa-modal.tsx` continuam no repositório,
funcionando, **sem porta na UI**. Consequência assumida: reverter uma
baixa errada hoje exige intervenção fora da tela. Se voltar, precisa
antes de uma RPC de estorno **por parcela** — a existente reverte a PP
inteira.

## Onde a regra mora

- **Banco (o portão de fato):** `supabase/migrations/20260817000004_titulos_a_pagar.sql`
  — `aprovar_pp_com_data` (o deslocamento uniforme),
  `dar_baixa_pp_parcela` (valor da parcela + promoção da PP a paga),
  `dar_baixa_avulsa_com_plano`, e o trigger
  `congela_data_pagamento_primeira`.
- **Servidor:** `app/(app)/financeiro/contas-a-pagar/actions-titulos.ts`
  — `aprovarPPComData`, `darBaixaTitulo`, `repactuarDataPagamento`.
- **Agregação da lista:** `app/(app)/financeiro/contas-a-pagar/page.tsx`.
- **Telas:** `titulos-pagar-list.tsx`, `pp-drawer-financeiro.tsx`,
  `documentos-pp-overlay.tsx`, `editar-data-pagamento-dialog.tsx`,
  `components/financeiro/baixa-titulo-dialog.tsx`.

## O que ficou de fora, de propósito

- **`pedidos_compra.prazo_pagamento_financeiro` não foi removida.** Virou
  espelho da data de pagamento da 1ª parcela e ganhou comentário no banco
  dizendo isso. Remover coluna é destrutivo e não era necessário.
- **`dar_baixa_pp` e `estornar_baixa_pp`** (da PP inteira) continuam
  existindo no banco. A UI parou de usá-las.
- **As views `vw_a_pagar` e `vw_fluxo_caixa` foram redefinidas** para uma
  linha por parcela em aberto — sem isso o Fluxo de Caixa (Tela 3.4)
  nasceria contando errado. Nenhum código da aplicação as lê hoje.
- **A aba "Lançamentos Avulsos" deixou de existir.** A avulsa virou um
  título de origem `AVULSO`, e a criação passou a ser o botão
  "+ Lançamento Avulso" da aba unificada. As rotas de detalhe
  (`/financeiro/contas-a-pagar/avulsa/[id]`) continuam funcionando.

---

## ⚠️ Nota de 2026-08-18 — a §1 só passou a valer de fato agora

A verificação no navegador mostrou que a regra desta decisão — "a
unidade de pagamento é a parcela, e a PP só vira `pago` quando a última é
quitada" — **não estava em vigor**. Um índice único herdado da
`20260805000003_lancamentos_financeiros.sql`,
`uniq_baixa_ativa_por_pp`, admitia **um lançamento de baixa por PP**, de
quando uma PP tinha uma baixa só. A migration desta decisão passou a
inserir um lançamento por parcela sem substituí-lo: a 1ª parcela baixava
e a 2ª morria numa violação de constraint.

Corrigido pela `20260818000001_baixa_por_parcela_e_data_aprovacao.sql`,
que troca a unicidade para `(pedido_compra_parcela_id)`. A decisão não
muda — o que muda é que ela finalmente acontece.

Na mesma migration, a exigência da **data de pagamento na aprovação**
(§3) desceu para a RPC `aprovar_pp`. A action legada `aprovarPP`, sem
chamador na UI mas ainda exposta pela rede, aprovava sem data e gerava
títulos sem data de pagamento nem 1ª data registrada — o que quebrava a
repactuação que esta mesma decisão criou.

---

## Decisão de 2026-08-18 — a granularidade, dita por inteiro

A verificação perguntou o que "estornar" deveria significar numa PP
parcelada. O Tiago fechou a regra dos três verbos de uma vez:

> "As PPs sempre chegarão 'por parcela' no contas a pagar e cada baixa ou
> estorno deverá ser feito por parcela. Porém, quanto à aprovação, essa
> deverá ser feita por PP, e criar os títulos referentes a cada parcela em
> títulos a pagar."

| Verbo | Granularidade | Onde vive |
|---|---|---|
| **Aprovar** | **PP inteira** — e gera um título por parcela | `aprovar_pp_com_data` / `aprovarPPComData` |
| **Dar baixa** | **parcela** | `dar_baixa_pp_parcela` / `darBaixaTitulo` |
| **Estornar** | **parcela** | `estornar_baixa_pp_parcela` / `estornarBaixaParcela` |

Aprovação e baixa já eram assim. O estorno não: era o
`estornar_baixa_pp`, herdado de quando uma PP tinha uma baixa só, que
pegava `limit 1` dos lançamentos e devolvia a PP a `aprovada` **sem
limpar `pago_em` das parcelas** — numa PP de 3 parcelas pagas, deixaria
uma PP "aprovada" com as 3 parcelas ainda pagas.

A `20260818000002_estorno_por_parcela.sql` cria a versão por parcela —
que gera o lançamento reverso, devolve a parcela para em aberto e traz a
PP de `pago` para `aprovada`, simétrica à baixa — e **desarma** a antiga,
que passa a levantar exceção apontando para a substituta.

**O estorno continua SEM PORTA NA UI**, como esta mesma decisão
determinou: o protótipo não tem estorno em lugar nenhum. O que mudou é
que, no dia em que ele voltar, a semântica está certa —
`cancelar-baixa-modal.tsx` já aponta para a action nova.

**Exercitado ao vivo em 18/08/2026:** PP-00009 (3×R$ 4.000,00) com as três
parcelas pagas, estorno da 3/3 → parcela voltou a em aberto, PP voltou a
`aprovada`, o lançamento original virou `pp_baixa_estornada` e nasceu um
`pp_estorno` de entrada; nova baixa da 3/3 → PP de volta a `pago`. As
parcelas 1 e 2 nunca foram tocadas.

---

## Decisão de 2026-08-18 (2) — o estorno VOLTA para a tela

A §"o estorno sai da UI" desta decisão **fica revogada**. Ela seguia o
protótipo à risca, que não tem estorno em lugar nenhum, e a consequência
registrada na época era que "reverter uma baixa errada exige intervenção
fora da tela". Com o estorno já corrigido para a granularidade de parcela
(nota anterior), o Tiago pediu de volta:

> "Pode adicionar a opção de fazer um estorno ao clicar em um título
> sobre o qual já foi dado baixa (com um botão no formulário aberto com o
> clique)."

**Como ficou.** Título `PAGO` passa a ser clicável — a linha inteira e o
chip "Conciliação", que virou botão. Abre o **`BaixaRegistradaDialog`**,
espelho em leitura do modal de baixa: título, origem, parcela, venc.
original, data de pagamento e valor, mais um bloco verde "Enviado para a
conciliação" com **pago em · conta · centro de custo** — o que a baixa
efetivamente registrou.

O estorno vive dentro desse formulário, em **dois tempos**: primeiro o
botão "Estornar baixa" sozinho; só depois o campo de motivo (mínimo 10
caracteres) e o "Confirmar estorno". É a ação mais destrutiva da aba —
desfaz dinheiro que já foi para a conciliação —, então não fica a um
clique de quem só queria conferir.

**Título em aberto continua não sendo clicável na linha**: as ações dele
são os botões próprios (o lápis da data e o "Dar baixa"), e um clique
solto não pode disparar pagamento.

A action é `estornarBaixaTitulo({origem, id, motivo})`, irmã de
`darBaixaTitulo` e com a mesma assinatura: origem `pp` cai no estorno por
parcela, `avulso` e `recorrencia` no da `contas_avulsas`. A aba não
precisa saber que por baixo existem duas tabelas.

**Exercitado pela tela em 18/08/2026:** parcela 3/3 da PP-00009, paga,
aberta pelo clique → "Estornar baixa" → motivo de 5 caracteres manteve o
confirmar desabilitado, motivo completo liberou → estornada. A linha
saiu de "Pagos" (3 → 2), voltou para "A pagar" (1 → 2), "Em aberto"
subiu para R$ 6.000,00, a PP voltou a `aprovada` e nasceu o par
`pp_baixa_estornada` + `pp_estorno` no extrato.
