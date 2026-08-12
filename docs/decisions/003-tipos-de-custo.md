# Decisão 003 - Tipos de Custo

## Status

Vigente. Revisada em 11/08/2026, quando A e F ganharam subdivisões e o
fechamento passou a produzir **dois** números em vez de um. Revisada em
12/08/2026: as subdivisões continuam valendo na conta, mas o painel de
fechamento passou a exibi-las somadas (ver "Como o fechamento aparece na
tela").

## Os dois números do fechamento

Até 11/08/2026 o card de Totais mostrava só "Faturamento previsto", e ele
somava **todo** o custo. Isso confundia duas coisas diferentes:

- **Faturamento previsto** — o que a California emite nota. Não inclui o
  principal dos custos que o cliente paga direto ao fornecedor.
- **Valor do Job** — o compromisso total do cliente, somando o que passa
  pela agência e o que ele paga direto. É o número que a planilha oficial
  chama de `FATURAMENTO`, e é ele que vai para `jobs.valor_total`.

Os dois compartilham honorários e imposto; mudam só em quais principais
entram. O **resultado operacional e o resultado geral usam o Valor do
Job** como base: o custo descontado é o do job inteiro, então a receita
comparada precisa ser a do job inteiro também.

## Matriz de tipos

A fonte no código é `REGRAS_TIPO_CUSTO`, em
`lib/calculos/versao-totais.ts`. Tabela e código não podem divergir.

| Tipo | Rótulo | Principal no faturamento previsto | Principal no valor do job | Base de honorários | Base de imposto | Calha |
|---|---|---|---|---|---|---|
| `A` | A · Direto | não | sim | sim | não | BV |
| `AR` | A · Repasse | **sim** | sim | sim | não | PP |
| `B` | B · Bi-trib. | sim | sim | sim | **sim** | PP |
| `C` | C · Sem honor. | sim | sim | **não** | **sim** | PP |
| `D` | D · Interno | não | **não** | sim | não | BV |
| `F` | F · Externo | não | sim | sim | não | PP |
| `FI` | F · Interno | não | sim | **não** | não | PP |

Fórmulas:

```
honorários = Σ(tipos com honorários) × %honor
imposto    = (Σ(tipos com imposto) + honorários) × t / (1 − t)     [gross-up]

faturamento previsto = Σ(AR, B, C)        + honorários + imposto
valor do job         = Σ(tudo menos D)    + honorários + imposto
```

Validado contra a planilha oficial `[INT] SJ PEPSI CG - NE - 2026`: as 5
abas batem em honorários, imposto e valor do job, célula a célula.

## Descrição de cada tipo

- **A · Direto** — faturamento direto para o cliente. O fornecedor recebe
  do cliente; a agência fatura só o honorário. Imposto sobre honorários.
  Usado em influenciadores, normalmente com 13% de honorários.
- **A · Repasse** — mesmo caso, mas o principal passa pela California, que
  o repassa ao fornecedor. Por isso entra no faturamento previsto. Não tem
  BV: sem pagamento direto, não há comissão a negociar com o fornecedor.
- **B · Bi-tributação** — faturamento via California. Imposto sobre o custo
  da operação mais honorários.
- **C · Sem honorários** — imposto sobre o custo, sem honorário da agência.
  Uso somente com permissão do Bruno.
- **D · Interno** — faturamento direto para o cliente, com visão interna
  para agência/GP. Fica fora até do valor do job: só os honorários dele
  chegam ao fechamento.
- **F · Externo** — hoje espelha o A · Direto. Subdivisão criada junto com
  o F · Interno; a diferença de negócio entre F e A ainda será definida.
- **F · Interno** — como o F · Externo, mas sem honorários da agência.

## Como o fechamento aparece na tela

A matriz acima é a **conta**. A leitura é mais curta: desde 12/08/2026 o painel
"Fechamento do orçado · por tipo de custo" mostra **cinco linhas**, com as
subdivisões somadas.

| Linha | Soma |
|---|---|
| Sub-total A | `A` + `AR` |
| Sub-total B | `B` |
| Sub-total C | `C` |
| Sub-total D | `D` |
| Sub-total F | `F` + `FI` |

O motivo é de leitura: quem confere o fechamento quer o custo A e o custo F
fechados. A quebra interna importa para a conta — `AR` fatura pela California e
`A` não, `F · Externo` tem honorário e `F · Interno` não — e não para o total.
**Nenhum número mudou**: faturamento previsto, valor do job, honorários e
imposto continuam saindo de `REGRAS_TIPO_CUSTO`, tipo a tipo.

Os rótulos são **só a letra** (13/08/2026), no formato `SUB-TOTAL A` que a
planilha oficial já usava — quem lê o painel e quem lê o XLSX exportado veem o
mesmo nome. Os descritores ("Bi-trib.", "Sem honor.", "Interno") saíram do
painel: o significado de cada letra está na legenda do rodapé e nesta decisão.

A fonte é `LINHAS_FECHAMENTO_POR_TIPO`, em `lib/calculos/versao-totais.ts`,
usada pelas quatro telas de Totais (versão do orçamento, projeto do orçamento,
projeto de jobs e realizado do job). Tem a mesma guarda de exaustividade do
`TIPOS_CUSTO`: tipo que entre em `TipoCusto` e não caia em nenhuma linha **para
de compilar**, em vez de sumir do painel em silêncio.

Duas coisas seguem com os tipos separados, de propósito: a **legenda do
rodapé**, que é onde se explica por que o total dá o que dá ("honorários sobre
A · Direto + A · Repasse + B + D + F · Externo"), e o **XLSX exportado**, que
mantém `SUB-TOTAL` por tipo cru porque é o formato da planilha oficial.

## BV × Pedido de Produção

O critério não é a letra, é **"o cliente paga o fornecedor diretamente"**.
Só `A · Direto` e `D` admitem BV. O resto mostra Pedido de Produção na
calha. A regra vive em dois lugares que precisam andar juntos:

- `TIPOS_COM_BV` / `aceitaBV()` em `lib/calculos/versao-totais.ts`;
- o trigger `bv_exige_item_com_bv` no Postgres.

Mudar um sem o outro deixa a tela oferecendo um BV que o banco recusa.

## O que fica de fora

A planilha exportada para o cliente continua mostrando **só o Valor do
Job**, no rótulo `FATURAMENTO` que sempre teve. A quebra entre o que a
California fatura e o que o cliente paga direto é leitura interna.

## Consequência no sistema

Tipo de custo não é etiqueta. Ele afeta faturamento previsto, valor do
job, honorários, base de imposto, visão do cliente, visão interna,
disponibilidade de BV e necessidade de aprovação especial.
