# 073 — O BV não depende da versão aprovada: qualquer linha do job aceita, se o tipo permitir

**Data:** 2026-09-11
**Status:** aceita
**Contexto:** Planilha Interna do job (`/jobs/[jobId]` e
`/financeiro/jobs/[jobId]`), formulário de BV compartilhado
(`app/(app)/_bv/`) e planilha da versão do orçamento. Responde a pergunta
que a [071](071-o-bv-do-job-se-grava-pelo-item-da-versao.md) deixou aberta
no mesmo dia e **substitui a segunda metade da regra dela**.

## A regra

> **O BV não depende de a linha ter vindo da versão aprovada.** Qualquer
> linha da planilha do job aceita BV — inclusive a nascida de errata —
> **desde que o tipo de custo permita: `A`, `AR` (A · Repasse) e `D`.**
>
> O BV lançado **não entra no realizado nem na rentabilidade do job
> enquanto não for confirmado** e enviado ao faturamento. Enquanto está
> `a_negociar` ele é intenção, e a linha mostra "BV não emitido".

## O que mudou em relação à 071

A 071, de ontem, consertou a gravação do BV pela planilha do job. Ao
fazê-lo, fechou a linha nascida de errata: sem `item_versao_id` não havia
onde endereçar, então a calha deixou de oferecer o botão. Aquilo foi
registrado lá como **pergunta de negócio, não como conclusão** — e a
resposta veio hoje.

| | 071 (10→11/09) | 073 (11/09) |
|---|---|---|
| Endereço do BV | sempre o item da versão | versão **ou** cópia do job |
| Linha de errata | não tem BV | **tem BV, se o tipo permitir** |
| Gate de quem pode | ter item na versão **e** tipo A/AR/D | **só o tipo** A/AR/D |

A primeira metade da 071 continua inteira: a chave vai **marcada**, nunca
como string solta. Foi a ambiguidade de `item.id` que causou o bug de lá,
e soltar a segunda chave sem marcar o espaço reintroduziria exatamente o
mesmo defeito — agora com duas formas de errar em vez de uma.

## Por que a errata não podia ser o gate

O tipo de custo é que diz se existe comissão a negociar: em `A`, `AR` e
`D` o cliente paga o fornecedor direto, e o BV é o repasse dessa
comissão. Em `B`, `C`, `F` e `FI` o dinheiro passa pela California e o
instrumento é o Pedido de Produção.

De onde a LINHA veio — versão aprovada ou errata posterior — não muda nada
disso. Um serviço acrescentado por errata é um serviço como outro
qualquer: tem fornecedor, tem valor, e pode ter comissão negociada. A
trava da 071 era consequência de uma limitação técnica (o endereço), não
de uma regra de negócio, e estava barrando **6 linhas reais** — 2 delas no
`0-0001/26`, tipos `A` e `AR`.

## O que mudou, em código

**Banco** (`20260911110001_bv_na_linha_de_errata.sql`, aditiva):

- `bv_exige_item_com_bv()` resolve o item pelas **duas** chaves. Com
  `item_versao_id`, o caminho de sempre — inclusive a regra de 27/08 em
  que a errata de **tipo** na cópia destrava um item que a versão tinha
  como B ou C. Sem ela, `jobs_itens_orcado` é a única fonte de tipo,
  tenant e `em_save`.
- O trigger passou a vigiar também `job_item_orcado_id` no UPDATE.
- Nasceu `chk_bv_tem_item`: pelo menos uma das duas chaves. As duas eram
  opcionais e nada impedia um BV órfão — invisível nas duas telas.

**Banco, correção** (`20260911110002_bv_de_errata_chega_ao_faturamento.sql`),
achada na conferência ao vivo: a `vw_faturamento_pendente` fazia **INNER
JOIN** em `versoes_orcamento_itens`, então o BV de errata era confirmado e
**sumia da fila do contas a receber**. Virou `LEFT JOIN`, e a descrição
passou a ser `coalesce(v.item, jio.item)`. `vw_fluxo_caixa` e
`vw_job_rentabilidade` já entravam pela cópia do job e não foram tocadas.

`itens_bv` **não mudou de forma**: as duas colunas existem, opcionais e
indexadas, desde 27/08/2026.

**Código:**

- `ChaveItemBv` (`lib/types.ts`) — `{ espaco: "versao" | "job", id }`. O
  espaço é lido pelo servidor para saber onde procurar o item.
- `ChaveBvNoDialog` — a mesma, mais `"rascunho"`, que é a chave local do
  editor e nunca chega a uma Server Action.
- `carregarContexto` virou duas rotas (`contextoPelaVersao` e
  `contextoPelaCopiaDoJob`) com as travas de job compartilhadas em
  `barreiraDoJob`.
- `salvarBv`, `confirmarBv` e `cancelarBv` deixaram de exigir
  `item_versao_id`; as duas últimas derivam a chave do próprio BV.
- A calha do job voltou a oferecer o botão na linha de errata — agora o
  filtro é só `aceitaBV(tipo_custo)` e `em_save`.

## O realizado não mudou

Nada nesta decisão toca a conta. `bvContaNoRealizado()` já devolvia
verdadeiro só para `confirmado` e `recebido`
([bv-planilha.ts](../../lib/calculos/bv-planilha.ts)) — o BV `a_negociar`
nunca entrou no realizado nem na rentabilidade. A segunda metade da regra
acima é **descrição do que já valia**, escrita aqui para que não se perca.

## Conferido no banco (2026-09-11)

Quatro inserções dentro de um bloco com rollback ao final — nenhuma linha
sobrou (10 BVs antes, 10 depois):

| caso | resultado |
|---|---|
| linha de errata tipo `A` (JOB-0029, "Item 2") | **aceita** |
| linha de errata tipo `AR` (JOB-0029, "Item 3") | **aceita** |
| linha de errata tipo `B` (JOB-0025, "Aereos Time") | recusada — "tipo A, A - Repasse ou D" |
| BV sem nenhuma das duas chaves | recusada — "precisa apontar para um item" |

`tsc`, `next lint` e `npm run build` limpos.

## Conferido logado, no JOB-0029 (2026-09-11)

O percurso inteiro na Planilha Interna, na linha **Item 2** (tipo `A`,
nascida de errata), que até hoje não oferecia o botão:

| passo | resultado |
|---|---|
| calha | 2 botões — `Item 2` (A) e `Item 3` (AR); `Item 1` (B) sem, como deve |
| abrir o BV | diálogo abre na linha de errata |
| salvar R$ 1.500,00 | grava com `item_versao_id` **nulo** e `job_item_orcado_id` preenchido — o primeiro BV do sistema numa linha de errata |
| enquanto `a_negociar` | realizado **inalterado** (R$ 24.420,00 · 58,3%) e a linha diz "BV não emitido" |
| reabrir | o BV salvo volta na lista — a leitura também entra pela cópia |
| confirmar sem alíquota | recusado: "Informe a alíquota…" — a trava da 062 responde, e **não** o velho "Item não encontrado." |
| confirmar com 19,53% | `confirmado`, líquido R$ 1.207,05 |
| realizado depois | Item 2 cai de R$ 10.000,00 para **R$ 8.500,00**, com "BV −R$ 1.500,00" na linha; resultado do job sobe para R$ 25.920,00 · 61,8% |
| Contas a Receber | **"BV — Item 2" · JOB-0029 · R$ 1.500,00**, com o fornecedor certo |

O degrau do faturamento só apareceu porque o percurso foi até o fim — é o
achado que gerou a segunda migration. Confirmar a regra no banco não
teria pego: o BV gravava, e sumia depois.

## Resíduo deste teste

`JOB-0029 · Item 2` ficou com um **BV confirmado de R$ 1.500,00**
(fornecedor Airbnb Brasil), no `0-0001/26 · Projeto Teste`. BV confirmado
não pode ser editado nem removido, então ele fica — e é dado de teste, no
projeto de teste, que é onde deve ficar.
