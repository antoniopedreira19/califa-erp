# 084 — O ajuste da fatura do cartão vira compra da fatura, com rateio

**Data:** 2026-09-15
**Decidido por:** Tiago
**Migration:** `20260915240001_o_ajuste_da_fatura_vira_compra.sql`

Terceiro lote da garantia de regional em todo lançamento, depois da
[069](069-a-regional-do-job-e-a-fonte.md) (a regional vem do job) e da
[082](082-a-despesa-sem-job-nasce-com-rateio-e-a-recorrencia-vira-titulo-30-dias-antes.md)
(a despesa sem job nasce com rateio).

---

## 1. O problema

O fechamento da fatura compara a soma das compras com o **valor cobrado pelo
banco**. A diferença — IOF, anuidade, juros, ou uma compra que ninguém lançou
— nascia como um lançamento solto: `papel_na_fatura = 'ajuste'`, origem
`manual`, **sem regional**.

Toda fatura tem IOF ou anuidade. Então todo mês entrava no DRE uma despesa
que nenhuma regional pagava. E não havia como consertar no formato antigo:
rateio existe para avulsa, recorrente e desembolso — cada um com a sua
tabela —, e o lançamento tem apenas a coluna `regional_id`, que comporta uma
regional só. Um IOF de fatura com compras de duas regionais não tinha onde
ser dividido.

As compras em si nunca foram o problema: cada uma já vira lançamento próprio
com o plano de contas dela ([031](031-o-cartao-de-credito-tem-conta-espelho.md)),
e desde a 082 cada uma carrega o seu rateio. Quem ficava de fora era só o
ajuste.

## 2. A regra

> **A diferença não é um ajuste contábil: é compra da fatura.** Ela nasce
> como conta avulsa do cartão, igual a qualquer outra — com plano de contas e
> com rateio de regional. E pode ser **mais de uma**, quando o que faltou
> foram várias compras que ninguém registrou.

- **Uma ou várias (1a).** O fechamento aceita N itens. Cada um com a sua
  descrição, o seu plano de contas, o seu valor e o seu rateio. Querendo
  registrar tudo como um ajuste único, é o mesmo caminho com uma linha.
- **A soma tem que fechar a diferença (2a)**, na tolerância de meio centavo.
  Com os itens dentro, a fatura fecha exatamente no valor cobrado.
- **O rateio vem sugerido (3a):** a proporção em que as regionais gastaram
  **nesta** fatura — a compra avulsa entra pelo rateio dela, a parcela de PP
  entra pela regional do job ([069](069-a-regional-do-job-e-a-fonte.md)).
  Estorno é `entrada` e abate. A sobra de centavo vai para as maiores
  frações, porque o banco exige soma 100,00.
- **Sem base, o financeiro diz de quem é (3b).** Fatura sem nenhum item com
  regional abre a linha em branco. Era a exceção combinada: sugerir quando dá
  para sugerir, perguntar quando não dá.
- **Diferença para baixo é estorno, não ajuste (4a).** Crédito no cartão só
  existe apontando para a compra que ele desfaz — é o que
  `chk_avulsa_credito_no_cartao_e_estorno` garante desde 29/08/2026.
  O fechamento recusa e manda usar o botão **Estornar** da compra.
- **Reabrir não ganhou regra nova (5a).** Os itens do ajuste são compras da
  fatura: ao reabrir, voltam para `aprovada` junto com as outras e podem ser
  editadas ou apagadas na lista. O fechamento seguinte já as conta, e por
  isso não aparece diferença duplicada.

## 3. O pagamento da fatura continua fora do DRE

O par de lançamentos da baixa (saída no banco, entrada na conta espelho do
cartão) é **transferência**: o dinheiro que sai já foi despesa quando a
compra aconteceu. Ele não ganha regional e não entra no DRE — confirmado com
o Tiago em 15/09/2026. O que entra são as compras, uma a uma, e agora também
o ajuste.

## 4. Onde fica

Diálogo **Fechar fatura** (Contas a Pagar → aba Cartão → fatura aberta).
Digitado o valor cobrado, se houver diferença aparece o bloco âmbar com o
primeiro item já montado: valor igual à diferença e rateio sugerido.
**Adicionar item** abre outra linha, com o que falta distribuir. O rodapé do
bloco mostra "Falta distribuir R$ X" ou "Diferença distribuída ✓", e o botão
de fechar só libera quando bate.

## 5. Banco

`20260915240001_o_ajuste_da_fatura_vira_compra.sql`:

- cria `rateio_proporcional_da_fatura(p_fatura_id)` — SECURITY INVOKER, é o
  rateio que a tela sugere;
- cria a assinatura nova de `fechar_fatura_cartao(p_fatura_id, p_valor_cobrado,
  p_ajustes jsonb)`, que valida os itens, cria cada um por
  `criar_conta_avulsa` (a mesma porta da 082, que recusa compra sem rateio) e
  só então roda o laço que transforma item em lançamento — os ajustes entram
  por ele, como compras;
- GRANT para `authenticated`, nada para `anon`.

A assinatura antiga (`p_ajuste_tipo_id`, `p_ajuste_subtipo_id`,
`p_ajuste_descricao`) **fica no banco por ora** e sai numa migration própria,
depois que o código que chama a nova estiver no ar. É a ordem que faltou em
08/09/2026, quando a trava chegou antes do código e derrubou seis fluxos.

## 6. Conferido em 15/09/2026

**Pela tela** (cartão ZZ Teste Fatia 2, fatura FC-00003, aberta com duas
compras: R$ 300 em SP e R$ 100 no RJ):

- Digitado o valor cobrado de **R$ 450,00**, o bloco do ajuste apareceu com a
  diferença de R$ 50,00 e o **item 1 já montado**, com o rateio sugerido
  **SP 75% / RJ 25%** — a proporção exata dos gastos da fatura, vinda do
  banco.
- **Adicionar item** abriu o item 2 já valendo o que faltava (R$ 30,00). O
  botão de fechar ficou **desabilitado** enquanto o item 2 estava sem plano de
  contas, e o rodapé alternou entre "Falta distribuir" e "Diferença
  distribuída ✓".
- A lista de regionais do item 2 ofereceu NE, NO, SP e SS — sem o RJ, que já
  estava na outra linha do mesmo rateio. Escolhido **NE**, o rateio do item 2
  ficou NE 75% / RJ 25%, diferente do item 1.
- Fechada: a aba Cartão passou a mostrar "FC-00003 · fatura fechada · **4
  itens · R$ 450,00** · aguardando baixa em Títulos a Pagar", e o título
  desceu para Títulos a Pagar como **R$ 450,00, 1/1, vencimento 05/10/2026**.

**No banco:** as quatro compras da fatura ficaram `baixada`, sem job e com
rateio — AV-00003 "IOF e anuidade" R$ 20 (SP 75% + RJ 25%, 04 · Assinaturas) e
AV-00004 R$ 30 (NE 75% + RJ 25%, 04 · Celular). Os lançamentos são **4 de
papel `item` e nenhum de papel `ajuste`**, e no `vw_fluxo_caixa` **toda linha
tem regional**: 300 SP, 100 RJ, 15 SP + 5 RJ, 22,50 NE + 7,50 RJ — somando os
R$ 450 cobrados. A auditoria gravou `itens_de_ajuste: 2, valor_do_ajuste: 50`.

**As travas, pelo transporte real da action** (fatura FC-00002, que soma
R$ 200) — todas recusaram e **nada ficou para trás** (a fatura seguiu
`aberta`, com `valor_cobrado` nulo e zero lançamentos):

| Tentativa | Resposta |
|---|---|
| Diferença sem nenhum item | "A fatura fecha em 200.00 e o banco cobrou 250.00 — diferença de 50.00. Registre o que falta…" |
| Banco cobrou **menos** | "…50.00 a menos. Diferença para baixo é estorno: registre o estorno da compra correspondente…" |
| Itens somando menos que a diferença | "Os itens do ajuste somam 40.00 e a diferença é 50.00." |
| Item sem rateio | "Adicione pelo menos uma regional." |
| Rateio somando 50% | "A soma dos percentuais deve ser 100,00." |

**O arredondamento**, em transação desfeita: três compras iguais em SP, RJ e
NE deram **33,34 / 33,33 / 33,33**, somando exatamente 100,00.

**Reabrir e fechar de novo** (regra 5a), pelo transporte real da action: com
o motivo, as quatro compras voltaram para `aprovada` e `pago_em` nulo —
**inclusive as duas do ajuste** —, os quatro lançamentos foram apagados, as
seis linhas de rateio ficaram intactas e a auditoria gravou
`itens_reabertos: 4, lancamentos_apagados: 4, valor_cobrado_anterior: 450`.
Fechada de novo nos mesmos R$ 450,00 e **sem informar ajuste nenhum**, passou:
os itens do ajuste já contavam como compras, não houve diferença e nenhuma
compra nova nasceu. A fatura voltou ao mesmo estado — 4 compras baixadas, 4
lançamentos `item`, nenhum `ajuste` — com o fluxo em SP R$ 315,00, RJ
R$ 112,50 e NE R$ 22,50.

**A fatura sem base para sugerir** (caso 3b), conferida em 16/09/2026 durante a
limpeza: com a FC-00003 reaberta e vazia, o valor cobrado de R$ 10,00 abriu o
item 1 com a regional **em branco** ("Selecione a regional", 100%) e o botão de
fechar desabilitado. O diálogo foi fechado sem gravar.

**Dados de teste apagados em 16/09/2026.** A FC-00003 foi reaberta e as quatro
compras excluídas pela action da tela (com auditoria). A fatura vazia, que não
tem exclusão pela tela, saiu por SQL com a autorização do Tiago, protegida para
só apagar se continuasse aberta e sem nada apontando para ela. O banco voltou a
0 contas avulsas, 0 linhas de rateio e 19 lançamentos.

## 7. O que ficou de fora

- Os **recebimentos avulsos**: a nota sem job ainda não pergunta a regional.
  É o próximo item da fila, combinado com o Tiago.
