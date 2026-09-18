# 091 — A conciliação começa pela lista de contas

**Data:** 2026-09-18
**Decidido por:** Tiago
**Migrations:** `20260918100001_conciliacao_resumo_contas.sql` (aditiva — uma função nova)

---

## 1. O problema

`/financeiro/conciliacao` abria direto no extrato da **primeira conta da
lista**, escolhida por `ordem, nome`. Quem chegava pela Central Financeira
caía dentro de uma conta qualquer sem ter escolhido nenhuma, e para ver
outra precisava passar pelo `Select`, uma de cada vez. Não havia lugar
nenhum no sistema que respondesse "quanto a agência tem em banco hoje".

## 2. A regra

> **A conciliação começa pela lista de contas.** A tela inicial mostra
> todas as contas com o saldo de hoje e a movimentação do período; o
> extrato de uma conta é o segundo passo, não o primeiro.

A rota é a **mesma**: `/financeiro/conciliacao` sem `?conta=` é a lista;
com `?conta=` é o extrato de sempre. Foi a opção escolhida contra a de
criar `/financeiro/conciliacao/[contaId]`, porque os 12
`revalidatePath("/financeiro/conciliacao")` espalhados por Contas a Pagar
e Contas a Receber, e os links com `&highlight=`, continuam valendo sem
nenhuma mudança — cada um deles seria um lugar onde esquecer.

`?conta=` com algo que não é UUID cai na lista, em vez de derrubar a
consulta no PostgREST e deixar a tela vazia.

## 3. O que a tela mostra

Em cima, uma faixa com o consolidado: saldo, entradas, saídas, resultado e
lançamentos do período (mês atual, mês anterior, 90 dias ou o ano). Abaixo,
as duas quebras do saldo — **por tipo de conta** e **por empresa** — cada
fatia com valor, percentual do total e contagem de contas. Depois, a
tabela: uma linha por conta, **agrupada por empresa contábil**, com
subtotal por grupo e total geral.

Colunas: Conta · Banco · Situação · Último mov. · Lanç. · Entradas ·
Saídas · Saldo atual. A linha inteira abre o extrato daquela conta, já com
o período escolhido.

**Por que o resumo em cima, e não num painel lateral:** a tabela tem oito
colunas e precisa da largura; num painel de 300px as quebras ficam em
corpo 12px, informação secundária por construção. O custo — o resumo
empurra a tabela para baixo — não pesa com ~10 contas.

**"Lanç." é a contagem de lançamentos no período.** Ela separa dois casos
que o saldo confunde: conta parada em R$ 0,00 sem movimento nenhum e conta
que movimentou no mês e fechou em zero. É também o primeiro sinal de conta
esquecida: extrato do banco com movimento e sistema dizendo "—".

## 4. A conta do cartão sai da conciliação

A conta-espelho de cartão (`tipo = 'cartao_credito'`, que nasce e morre com
o cartão por trigger) **não aparece** na lista nem entra no consolidado.

Conciliação bancária bate com **extrato de banco**; cartão não tem extrato
bancário, tem fatura, e fatura é passivo, não saldo. Somá-la ao
consolidado mistura as duas coisas — hoje passa despercebido porque ela
está zerada, mas no dia em que tiver movimento o total do hub deixa de
bater com o que a agência tem em banco.

A conciliação era a **única** tela do financeiro que ainda a mostrava:
Contas a Pagar, o detalhe da avulsa, Contas a Receber e o Fluxo de caixa
já filtram `tipo <> 'cartao_credito'`. Agora a lista e o seletor do extrato
também.

**Exceção deliberada:** aberta por link direto (`?conta=<id da conta do
cartão>`), o extrato funciona e a conta aparece no seletor — senão o campo
apareceria vazio. Só não se chega nela pela lista.

**Pendente (combinado com o Tiago em 18/09/2026):** a conciliação do
cartão vai para a **aba Cartões de Contas a Pagar** — o valor da fatura
conciliado com a conta que a pagou, expansível nos itens que a compõem. O
dado já existe: o pagamento é lançamento com `papel_na_fatura =
'pagamento'`, e os itens estão ligados por `fatura_cartao_id`. Fica para
depois desta tela.

## 5. Conta inativa fica fora do consolidado

A lista traz conta ativa e inativa — é o que dá sentido à coluna Situação.
Mas **só conta ativa soma**: consolidado, quebras, subtotal por empresa e
total geral. O saldo da conta inativa aparece em cinza na linha, e uma
linha discreta diz o que ficou de fora ("Fora do total: 1 conta inativa,
com R$ …").

O raciocínio do Tiago: uma conta é liquidada antes de ser inativada, então
o saldo residual, quando existe, é resto esquecido — e resto esquecido não
deve inflar o total da agência.

Hoje não existe nenhuma conta inativa no banco; o caminho foi exercitado
com a simulação em memória durante o desenvolvimento.

## 6. Os números vêm do Postgres, não do Node

`conciliacao_resumo_contas(p_tenant_id, p_de, p_ate)` devolve **uma linha
por conta**: saldo de hoje, créditos, débitos, lançamentos do período e
data do último movimento. `stable`, `security invoker` (as policies de
`contas_bancarias` e `lancamentos_financeiros` continuam valendo),
`execute` só para `authenticated`.

A alternativa — ler `lancamentos_financeiros` e agregar em JavaScript — é
o anti-padrão que `docs/PERFORMANCE.md` proíbe: hoje são 29 linhas, e a
tabela só cresce. O índice `idx_lanc_conta_data` (tenant, conta, data) já
existia e serve ao join; nenhum índice novo foi preciso.

`saldo_atual` segue a mesma regra de `lib/calculos/saldo-conta.ts`: só
conta lançamento a partir de `saldo_inicial_data` e **até hoje** —
lançamento com data futura não infla o saldo de hoje.

## 7. Arquivos

| arquivo | o quê |
|---|---|
| `app/(app)/financeiro/conciliacao/page.tsx` | bifurca: sem `?conta` renderiza a lista; com `?conta` segue o extrato |
| `app/(app)/financeiro/conciliacao/hub.tsx` | a tela: faixa do consolidado, quebras, tabela |
| `app/(app)/financeiro/conciliacao/hub-tabela.tsx` | tabela agrupada, busca, subtotais (client) |
| `app/(app)/financeiro/conciliacao/hub-resumo.tsx` | consolidado e as quebras do saldo |
| `app/(app)/financeiro/conciliacao/hub-dados.ts` | leitura: contas + a função agregada |
| `app/(app)/financeiro/conciliacao/hub-periodo.ts` | períodos, rótulos e tipos (módulo puro) |

O breadcrumb do extrato passou a voltar para a **lista de contas**, não
mais direto para a central financeira.
