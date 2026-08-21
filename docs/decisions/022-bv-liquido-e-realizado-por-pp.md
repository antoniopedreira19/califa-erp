# 022 — BV líquido na planilha, e o realizado montado pelas PPs

**Data:** 2026-08-21
**Status:** aceita
**Contexto:** planilha do orçamento (`/orcamentos/.../versoes/[versaoId]`)
e Planilha Interna do job (`/jobs/[jobId]`), com efeito nas telas
consolidadas de projeto e na conferência do financeiro. Design de
referência: `Job - A com Repasse - BV e PP.dc.html` (projeto Claude
Design `69342d83`), telas **4a** (formulário do BV) e **3b** (chave Bruto
⇄ Líquido). Regras definidas pelo Tiago em 21/08/2026.

## A mudança em três frases

1. O **BV passa a mexer nos números** da planilha, e sempre pelo valor
   **líquido** (valor − alíquota do job). Antes ele era um registro
   paralelo: existia, aparecia no formulário e não alterava nada.
2. **`A` e `D` param de ter planejado próprio** — nele o cliente paga o
   fornecedor diretamente, então o custo da agência É o orçado.
3. O **realizado deixa de ser digitado**: ele nasce zerado e é montado
   pelas PPs emitidas no item.

Nada disso muda o **orçado**, o **faturamento previsto**, o **valor do
job**, os **honorários** ou o **imposto do fechamento**. Esses continuam
saindo de `REGRAS_TIPO_CUSTO` como sempre (decisão 003).

## 1. O BV líquido

`BV líquido = valor do BV − (valor do BV × alíquota do job)`

Multiplicação direta, **não** o gross-up do fechamento da versão. Lá a
agência precisa faturar bruto o bastante para sobrar a base líquida; aqui
o valor do BV já é o bruto negociado com o fornecedor, e o imposto é uma
fatia dele. Do design 4a: R$ 10.000,00 a 19,54% dá R$ 1.954,00 de imposto
e R$ 8.046,00 de líquido — e não R$ 2.428,52.

A alíquota é `versoes_orcamento.percentual_imposto`. **Ela já é imutável
depois da aprovação** — versão aprovada é read-only inteira —, então não
existe snapshot de alíquota a guardar. Mudar a alíquota no orçamento
muda o BV junto, que é o que o Tiago pediu.

**O que a planilha subtrai é sempre o líquido.** O bruto nunca entra: a
parte que vira imposto não volta para a agência.

## 2. As duas vistas

O BV não é um detalhe de uma célula — é um jeito de ler a planilha. Em
vez de decorar cada Total, a página ganha **uma chave**:

| | Bruto (padrão) | Líquido (− BV) |
|---|---|---|
| ORÇADO | igual | **igual** — não recebe BV |
| PLANEJADO | custo cheio | custo − BV líquido |
| REALIZADO | custo cheio | custo − BV líquido |

**Uma chave por PÁGINA**, não por grupo. O design 3b a desenha no
cabeçalho do card do grupo; dois grupos em modos diferentes na mesma tela
produziriam um card de Totais que não bate com nenhum deles.

Onde ela existe: versão do orçamento, editores de rascunho (multi e
agregado), Planilha Interna do job (a mesma seção serve `/jobs/[jobId]` e
`/financeiro/jobs/[jobId]`), conferência da abertura e as duas telas de
projeto consolidado.

Na vista Líquido cada Total ganha uma **sub-linha** `BV −1.050,00`, que
é o que torna a dedução auditável sem abrir o formulário. Ela aparece na
célula do item **e no subtotal do grupo**, ali com a soma dos BVs de
todos os itens dele — foi isso que substituiu as pílulas "BV do grupo"
que o design 3b propunha (decisão do Tiago).

Quando há BV lançado mas ainda `a_negociar`, o REALIZADO mostra **"BV
não emitido"** em vez de uma dedução de zero, que pareceria "não tem BV".

## 3. Quem deduz o quê, e quando

A assimetria entre os dois blocos é deliberada:

| Bloco | BV que conta | Congelado? |
|---|---|---|
| PLANEJADO | todos os ativos (`a_negociar`, `confirmado`, `recebido`) | **sim**, na aprovação da versão |
| REALIZADO | só `confirmado` e `recebido` | não — sempre o BV vigente |

O planejado é projeção: a comissão ainda em negociação já conta, porque é
ela que o GP considerou ao montar o custo. E ele **congela**: depois da
aprovação o BV continua editável, mas na planilha do JOB, e lá ele já não
pode mexer no planejado — o planejado é o compromisso que o financeiro
confere e abre. O valor novo só se materializa no REALIZADO, e só quando
confirmado.

O congelamento mora em `versoes_orcamento_itens.bv_liquido_planejado`,
escrito por `aprovarVersao` e copiado para `jobs_itens_orcado` no envio
para abertura. `null` = versão ainda aberta, e aí a conta é feita ao vivo.

> Aprovação e abertura coincidem na prática: entre uma e outra o BV já é
> intocável pelas travas que existiam (`carregarContexto` recusa a origem
> `orcamento` em versão aprovada, e `jobAceitaAcoesPlanilha` só libera
> `aberto`/`em_producao`).

## 4. `A` e `D`: o planejado espelha o orçado

Nesses dois tipos o cliente paga o fornecedor diretamente, então a
agência não escolhe um custo próprio: o custo É o orçado, e o que ela
ganha é a comissão. As três células do PLANEJADO deixaram de ser
digitáveis e passam a espelhar as do ORÇADO.

Com um BV de R$ 1.000,00 líquido num item orçado em R$ 10.000,00: o
planejado bruto é R$ 10.000,00 e o líquido, R$ 9.000,00.

**`AR` fica de fora de propósito.** Nele o principal passa pela
California e é repassado ao fornecedor — há custo próprio a planejar, e
ele continua digitado, como em `B`, `C`, `F` e `FI`.

A regra mora no trigger `planejado_espelha_orcado`, e não na Server
Action, porque são **seis caminhos de escrita** chegando na mesma tabela
(`atualizarCampoItem`, `adicionarItem`, `atualizarItem`,
`importar-actions`, `_rascunho/actions`, `agregado/actions`). Perseguir
os seis é como a regra se perde: o sétimo aparece depois.

## 5. O realizado vem das PPs

| Tipo | Realizado bruto |
|---|---|
| `A`, `D` | o **orçado**, desde a abertura do job |
| `AR`, `B`, `C`, `F`, `FI` | **soma das PPs** não canceladas do item |

**"Desde a abertura" é literal.** Em `aguardando_abertura` e
`rejeitado_financeiro` o REALIZADO fica inteiro em zero — total e quebra
—, inclusive nas linhas `A` e `D`. A produção pode já ter gastado, mas o
job ainda pode voltar, e o orçado ali leria como "já saiu". Nos tipos que
geram PP isso acontecia sozinho (não há PP antes da abertura); em `A` e
`D` precisou do flag `jobAberto`, em `realizadoBrutoDoItem`.

Job **encerrado** continua mostrando o realizado: ali ele é histórico. Por
isso o flag é "já foi aberto", e não `jobAceitaAcoesPlanilha`.

`A` e `D` nunca geram PP: o custo saiu do bolso do cliente, no valor
orçado, e não há documento a acompanhar. Essa substituição é de LEITURA,
feita em `realizadoBrutoDoItem` — na tabela a linha deles fica em zero.

Para os demais, `jobs_itens_realizado` passou a ser mantida pelo trigger
`trg_pp_recalcula_realizado`: total, quantidade e o unitário que ela
implica são reescritos a cada PP emitida, editada ou cancelada. Contam
todas menos as **canceladas** — inclusive as `rejeitada`, que seguem
ocupando saldo pela regra da decisão 014.

**Não existe rascunho de PP.** O enum `pp_status` tem `em_avaliacao`,
`aprovada`, `pago`, `rejeitada` e `cancelada`: o botão "Gerar PP" já
emite direto.

### O que saiu junto

- `upsertItemRealizado` foi **removida**, e não apenas escondida na
  interface: Server Action é endpoint, e um realizado digitado por fora
  romperia a igualdade com as PPs sem nada avisar.
- Com ela saíram a navegação por Tab e os overrides otimistas do bloco
  REALIZADO. Nenhuma célula da Planilha Interna é editável hoje.
- A linha de `jobs_itens_realizado` passou a nascer **no envio para
  abertura**, zerada, para servir de âncora à PP (`item_realizado_id`).

## 6. O saldo das PPs sai do ORÇADO

Consequência direta da 5: com o realizado virando a própria soma das PPs,
a trava antiga ("soma das PPs ≤ realizado") passaria a comparar o número
consigo mesmo e nunca barraria nada — e a primeira PP de um item nunca
caberia.

**Agora: soma das PPs ≤ orçado do item na cópia do job**
(`jobs_itens_orcado.total_orcado`), que é o que a errata altera. E o valor
da PP passou a ser `quantidade × (total_orcado ÷ quantidade_orcada)` — a
mesma fatia medida em quantidade da decisão 014, só que sobre outra base.

O **BV não consome saldo de PP**: ele aparece na vista Líquido, não no
teto. Um item orçado em R$ 5.000,00 com R$ 5.000,00 em PPs e um BV
líquido de R$ 1.000,00 confirmado tem saldo zero e realizado líquido de
R$ 4.000,00.

Efeito na calha: a metade "PP" da linha `AR` **nasce visível**. Antes ela
só aparecia com realizado lançado — o que, com a regra nova, nunca
aconteceria.

## 7. O painel Resultado ganha "+ BVs"

```
Valor do Job − Impostos − Custo (bruto) + BVs = Resultado operacional
```

Isso é **algebricamente idêntico** a `− Custo líquido`: o BV que a
planilha desconta do custo é o mesmo que aqui volta como receita. A
diferença é de leitura — a comissão aparece, em vez de sumir dentro de um
custo menor.

Consequência assumida: **o Resultado dá o mesmo número nas duas vistas.**
A chave não mexe nele, só na planilha e nos subtotais.

Na ótica planejada somam todos os BVs ativos; na realizada, só os
confirmados. O mesmo ajuste entrou nos resumos de cabeçalho
(`ResumoRentabilidade`, `ResumoResultado`), senão eles e o card de Totais
mostrariam resultados diferentes para a mesma tela.

## 8. Confirmar o BV envia mesmo para o faturamento

A esteira existe desde 13/08/2026 e está ligada ponta a ponta — não era
uma promessa. Confirmar não emite a nota; ele coloca o BV **na fila de
quem emite**:

| Passo | O que acontece |
|---|---|
| **Confirmar** na planilha | `itens_bv.situacao = 'confirmado'` |
| Imediatamente | o BV entra em `vw_faturamento_pendente` e aparece na aba Faturamento de `/financeiro/contas-a-receber` (e na Central), com chip de origem **BV** e o fornecedor como contraparte |
| O financeiro emite | nasce o `faturamentos` (origem `bv`) e os `titulos_receber` |
| Baixa do último título | `dar_baixa_titulo` move o BV para **`recebido`**, fechando o ciclo |

Isso valida a regra do realizado: quando o Tiago diz "só será preenchido
quando o BV for confirmado **e enviado para faturamento**", os dois são o
mesmo evento — confirmar É o envio.

### ⚠️ A fila fatura o BRUTO; a planilha desconta o LÍQUIDO

`vw_faturamento_pendente` propõe `bv.valor` — os R$ 15,00 cheios. A
planilha desconta R$ 12,07. **Os dois estão certos e medem coisas
diferentes:** a nota contra o fornecedor é pelo valor cheio da comissão,
e o imposto sai de dentro dela; o que sobra para a agência, e portanto o
que abate o custo do item, é o líquido.

É o único lugar do produto onde os dois números convivem. Quem for mexer
na fila de faturamento precisa saber que a diferença é intencional.

## 9. O formulário do BV (design 4a)

- **Situação sai do corpo** e vira pílula com ponto de cor no canto
  direito do cabeçalho. Ela é estado, não campo: ninguém a escolhe.
- O corpo termina em **Impostos** (alíquota, leitura) e **BV líquido**,
  que é o número que a planilha desconta.
- O subtítulo deixou de dizer "cliente paga o fornecedor diretamente" em
  linha `AR` — lá o principal passa pela California.
- Os mini-blocos passaram a ler `_planilha/blocos.ts`. Eles tinham
  paleta própria, com o **PLANEJADO em azul** — herança de antes de
  11/08, quando o azul era dele. Hoje azul é do ORÇADO.
- **O botão "Confirmar" foi liberado.** Ele nascia desabilitado com o
  aviso "o módulo de faturamento ainda não existe", que envelheceu — a
  esteira entrou em 14/08 (decisão 009). E sem confirmar não há como o BV
  chegar ao realizado, que é o centro desta decisão.

## Onde a regra mora

- **Contas (fonte única, cliente e servidor):** `lib/calculos/bv-planilha.ts`
  — `impostoDoBv`, `bvLiquido`, `blocosDoItem`, `somarBlocosDosItens`,
  `planejadoEspelhaOrcado`, `realizadoVemDasPPs`, `valorNaVisao`.
- **Saldo e fatia da PP:** `lib/calculos/pps-item.ts` (base trocada para o
  orçado).
- **Banco:**
  - `planejado_espelha_orcado` — trigger em `versoes_orcamento_itens` e
    `jobs_itens_orcado`;
  - `recalcular_realizado_do_item` + `pp_recalcula_realizado` — trigger em
    `pedidos_compra`;
  - `pp_valida_saldo_do_item` — reescrita para o orçado.
  - Migrations `20260821000001` e `20260821000002`.
- **Chave e sub-linha:** `app/(app)/_planilha/chave-bruto-liquido.tsx`.

## O que ficou de fora, de propósito

- **Permissão por vista.** O Tiago pediu que, mais adiante, alguns
  usuários vejam só a Bruta e nem mesmo o seletor. Hoje a chave aparece
  para todos.
- **O XLSX exportado** continua em Bruto e sem BV: a quebra é leitura
  interna, como a decisão 003 já dizia.
- **Baixar o orçado abaixo da soma das PPs** continua possível, como o
  realizado permitia antes. Travar a errata por causa disso não foi
  decidido.
