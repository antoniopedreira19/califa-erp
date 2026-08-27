# Save — Design

**Data:** 2026-08-24
**Status:** proposto, aguardando o layout do Claude Design
**Decisão de negócio:** [`docs/decisions/028-save-entre-jobs.md`](../../decisions/028-save-entre-jobs.md)
**Brief de design:** [`docs/design-briefs/2026-08-24-save-brief.md`](../../design-briefs/2026-08-24-save-brief.md)

> ⚠️ **Superada em parte pela nota de 26/08/2026 da decisão 028.** Depois
> do design `Orcamento - Versao com Save.dc.html`, o modelo mudou: o saldo
> é do **job**, não da linha; uma linha consome de **vários jobs**; acabou
> a alocação exclusiva; rascunho **reserva** mas não segura saldo; e no job
> gerar ou consumir save é **Errata**. Onde esta spec fala de `jobs_saves`
> por linha e de alocação exclusiva (§4.2, §4.3), o que vale é
> `saves_consumos` + `vw_saves_por_job`, como implementado em
> `supabase/migrations/20260827010002_save_consumos.sql`. O resto da spec
> — cálculo, faturamento, riscos, ordem de implementação — segue válido.

## Contexto

O cliente fecha um orçamento e não usa todas as linhas dele naquele
projeto. Essas linhas são faturadas assim mesmo e viram crédito para um
projeto seguinte — o **save**.

Hoje `calcularTotaisVersao` ([lib/calculos/versao-totais.ts:202](../../../lib/calculos/versao-totais.ts))
calcula honorários e imposto **uma vez** e soma nos dois totais que devolve,
`faturamentoPrevisto` e `valorJob`. Os dois compartilham a conta e só diferem
em quais principais entram. O save quebra isso: ele precisa que os dois
números tenham bases independentes.

## Objetivo

1. Uma linha do orçamento ou do job pode ser marcada como **save** e sair do
   valor do job sem sair do faturamento.
2. Um item de outro job pode **consumir** esse saldo, entrando no valor do
   job sem entrar no faturamento.
3. O saldo é rastreável ponta a ponta: quem gerou, para quem foi, quanto
   sobrou.
4. A nota fiscal do job de origem separa o que é faturamento do job do que é
   saldo em save.
5. **Nenhum número de nenhum job existente muda.**

## Não-objetivos

- Save entre clientes diferentes.
- Uma linha de save consumida por mais de um job.
- Validade ou expiração de saldo.
- Devolução de saldo em dinheiro.
- Marcar ou desmarcar save por errata (ver §9.1).
- Correção do ponto cego de NF agrupada (ver §9.5) — fica registrado como
  pendência, salvo se a fatia 4 provar que o save não funciona sem ela.

## 3. Decisões arquiteturais

### 3.1. Duas bases por linha, uma função só

Cada linha passa a ter dois valores efetivos:

```
baseFaturamento(linha) = total_orcado − save_consumido
baseValorJob(linha)    = em_save ? 0 : total_orcado
```

O fechamento inteiro roda uma vez com cada base. **Sem save as duas bases
são iguais ao `total_orcado`**, os dois fechamentos coincidem, e o resultado
é bit a bit o de hoje. É essa propriedade que garante o objetivo 5.

### 3.2. `REGRAS_TIPO_CUSTO` não muda

O save é ortogonal ao tipo de custo. A linha em save continua sendo A, B ou
C para efeito de `honorarios` e `imposto` — o que muda é **quanto dela**
entra em cada base, não **quais alavancas** ela aciona. A matriz de sete
linhas e as duas guardas de exaustividade ficam intactas.

### 3.3. Três fechamentos, não dois

`calcularTotaisVersao` devolve `faturamento`, `job` e `bruto`. O terceiro usa
`total_orcado` cru — é literalmente "o número de hoje" — e existe por um
motivo concreto: o export XLSX ao cliente
([app/api/orcamentos/.../export/route.ts:224](../../../app/api/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/export/route.ts))
mostra `valorJob` sob o rótulo FATURAMENTO. Num orçamento de save o valor do
job é zero e a planilha do cliente sairia zerada. Trocando para `bruto.*`, o
documento fica byte-idêntico ao atual em todos os orçamentos existentes.

### 3.4. Os campos planos apontam para o lado `job`

`honorarios`, `imposto`, `faturamentoPrevisto` e `valorJob` continuam
existindo na interface. `imposto` passa a ser o **imposto embutido no valor
do job**, porque é ele que `calcularResultadoOperacional(valorJob, imposto,
custo)` precisa — a conta é `valorJob − imposto − custo`, e usar o imposto do
faturamento daria margem errada no job de origem.

São 8 chamadores dessa função, em `totais-card.tsx`, `versoes/[versaoId]/page.tsx`,
`encerrar-dialog.tsx`, `editor-agregado.tsx`, `editor-multi-jobs.tsx`,
`components/painel-resultado.tsx` e `components/resumo-resultado.tsx` (dois).
Amarrar os campos planos ao lado `job` conserta os 8 sem tocar em nenhum.

### 3.5. A marca é coluna, não tabela

`em_save` vive em `versoes_orcamento_itens` **e** em `jobs_itens_orcado`, e a
cópia do job carrega a sua própria.

É o oposto da escolha de `itens_bv` (`20260807000001_itens_bv.sql:8-20`), e
de propósito: o BV tem ciclo de vida próprio e precisa ser **um registro
único** compartilhado entre orçamento e job. O save é atributo intrínseco da
linha, como `tipo_custo` — que também é duplicado —, e **precisa poder
divergir** entre a versão aprovada (o que o cliente aprovou) e a cópia do job
(o que a errata moveu).

Duplicar também evita que os ~11 caminhos que hoje fazem
`.select("tipo_custo, total_orcado")` passem a pagar um join.

### 3.6. O saldo é derivado, não materializado

`jobs_saves` **não tem coluna de valor**. O saldo sai de
`jobs_itens_orcado.total_orcado`, que é `GENERATED` e que a errata pode
mexer. Um saldo materializado mentiria na primeira errata — pelo mesmo motivo
que as telas recalculam tudo dos itens em vez de ler `jobs.valor_total`
(`carregar-detalhe.ts:481`, com o comentário explícito).

A exceção é `jobs_itens_orcado.save_consumido`, mantida por trigger: sem ela,
todo caminho de leitura pagaria uma agregação, que é o anti-padrão C de
`docs/PERFORMANCE.md`.

### 3.7. A separação na nota mora nos itens

`faturamentos.origem_tipo` continua `'job'` — a nota é do job. O que separa
faturamento próprio de saldo em save são os `faturamento_itens`, que é
exatamente para isso que a `20260817000005` criou aquela tabela (decisão 017
§2). O enum `faturamento_origem` ganha o quarto valor `save`.

### 3.8. Permissões e RLS

Nenhum gate novo de perfil: os 10 profiles do tenant estão todos em
`administrador`. As tabelas novas seguem o padrão das 40+ policies do schema
— `public.is_tenant_member(tenant_id)`, que é `stable security definer` e
resolve `auth.uid()` internamente, produzindo o mesmo initplan que a regra do
`(select auth.uid())` persegue.

`DELETE` é concedido nas duas tabelas novas (diferente de `faturamento_itens`,
que é imutável): desmarcar uma alocação é operação normal de planilha, não
correção de documento emitido.

### 3.9. Auditoria

Registrar em `audit_log`: marcar/desmarcar save, alocar save a job, criar e
remover consumo, e devolução de saldo no encerramento. São alterações que
mexem em dinheiro entre jobs.

## 4. Modelo de dados

### 4.1. Colunas novas — migration 1

```sql
-- A linha está em SAVE: o cliente paga, o serviço não acontece neste
-- projeto. Sai da base do VALOR DO JOB e permanece na do FATURAMENTO.
alter table public.versoes_orcamento_itens
  add column if not exists em_save boolean not null default false;

alter table public.jobs_itens_orcado
  add column if not exists em_save boolean not null default false;

-- Quanto DESTA linha é pago por save de outro job. Mantida por trigger a
-- partir de jobs_saves_consumos. Só existe na cópia do job: a alocação
-- acontece na planilha do JOB consumidor, nunca no orçamento.
alter table public.jobs_itens_orcado
  add column if not exists save_consumido numeric(14,2) not null default 0;

alter table public.jobs_itens_orcado
  add constraint chk_jio_save_consumido_cabe
  check (save_consumido >= 0 and save_consumido <= total_orcado);

-- Uma linha não é save e consumidora ao mesmo tempo.
alter table public.jobs_itens_orcado
  add constraint chk_jio_save_exclusivo
  check (not (em_save and save_consumido > 0));

create index if not exists idx_jio_em_save
  on public.jobs_itens_orcado(job_id) where em_save;

-- Chave do orçamento de save: DEFAULT de linha nova, não trava.
alter table public.versoes_orcamento
  add column if not exists save_por_padrao boolean not null default false;
```

Mais o trigger `item_nasce_em_save()` (`before insert` em
`versoes_orcamento_itens`), que marca a linha quando a versão tem
`save_por_padrao`. **Só INSERT** — desmarcar depois é UPDATE e o trigger não
pisa. Existe porque são seis caminhos de escrita que criam item, e perseguir
os seis é como a regra se perde.

### 4.2. `jobs_saves` — o crédito

Uma linha por item com `em_save = true`, criada em `enviarJobParaAbertura`.

| Coluna | Tipo | Papel |
|---|---|---|
| `id`, `tenant_id` | uuid | |
| `job_origem_id` | uuid → `jobs` | quem faturou |
| `job_item_orcado_id` | uuid → `jobs_itens_orcado` **UNIQUE** | a linha; uma linha gera um crédito só |
| `cliente_id` | uuid → `clientes` | dono do saldo; denormalizado para o seletor não pagar dois joins |
| `job_consumidor_id` | uuid → `jobs`, **nulo = livre** | a reserva exclusiva |
| `alocado_em`, `alocado_por`, `observacao` | | |

CHECK: `job_consumidor_id <> job_origem_id`. Índice parcial
`(tenant_id, cliente_id) where job_consumidor_id is null` — é a consulta do
seletor.

### 4.3. `jobs_saves_consumos` — o consumo

| Coluna | Tipo | Papel |
|---|---|---|
| `id`, `tenant_id` | uuid | |
| `save_id` | uuid → `jobs_saves` **on delete restrict** | consumo não some por acidente |
| `job_id` | uuid → `jobs` | redundante de propósito: a view e o gate do encerramento filtram sem join |
| `job_item_orcado_id` | uuid → `jobs_itens_orcado` | a linha consumidora |
| `valor` | numeric(14,2) > 0 | quanto do **principal** |

UNIQUE `(save_id, job_item_orcado_id)`: uma linha pode beber de mais de um
save, de cada um uma vez.

Quatro invariantes cross-row num trigger `save_consumo_valida()`
(`before insert or update`), no molde de `bv_exige_item_com_bv()`
(`20260813000001_bv_aceita_a_repasse.sql:32-78`):

1. `Σ consumos do save ≤ total_orcado` da linha de origem — o saldo.
2. `Σ consumos do item ≤ total_orcado` do item consumidor — senão a base de
   faturamento fica negativa.
3. `consumo.job_id = save.job_consumidor_id` e `= jobs_itens_orcado.job_id` —
   a exclusividade da regra 7, fechada no banco.
4. A linha consumidora não é `em_save`, e o tenant bate.

Mais um trigger `after insert/update/delete` que mantém
`jobs_itens_orcado.save_consumido`, e um trigger **defensivo em
`jobs_itens_orcado`** que bloqueia `update` derrubando `total_orcado` abaixo
de `Σ consumos` — dos dois lados. É a errata que dispara isso; a mensagem
legível sai da Server Action, o banco fecha a porta do absurdo.

### 4.4. `vw_saves` — o saldo

`principal` (= `total_orcado` da origem), `consumido` (soma dos consumos),
`saldo`, `disponivel` (= saldo quando `job_consumidor_id is null`, senão 0),
mais `percentual_honorarios` e `percentual_imposto` da versão da origem —
quem calcula a receita da linha é o TypeScript, com a mesma
`REGRAS_TIPO_CUSTO`, então a matriz fica num lugar só.

**Não filtra status do job de origem.** A intuição vinda de
`vw_faturamento_pendente` (que filtra `j.status='aberto'`) seria errada aqui:
o saldo é do cliente e **sobrevive ao encerramento da origem**.

`security_invoker` segue o padrão vigente do projeto
(`20260817000006:195-210`) — não abre caso novo.

### 4.5. Regra 9 no banco — linha em save não tem custo

Três guardas, cada uma estendendo função existente:

- `planejado_espelha_orcado()` (`20260821000002:29-44`) ganha um ramo
  `if new.em_save then zerar as três colunas; elsif tipo in ('A','D') then
  espelhar;`. A **ordem importa**: uma linha `A` em save deve zerar, não
  espelhar.
- `bv_exige_item_com_bv()` (`20260813000001:32-78`) rejeita linha `em_save`.
  Espelho no TypeScript: `aceitaBV()` passa a receber a linha, não só o tipo.
- Trigger novo em `pedidos_compra` que caminha
  `item_realizado_id → jobs_itens_realizado.item_id → jobs_itens_orcado` e
  recusa se `em_save`. A âncora do realizado continua nascendo para a linha
  em save, como já nasce para `A` e `D` — uma exceção ali só criaria mais um
  caso.

### 4.6. `lib/types.ts`

Escrito à mão, sem tipos gerados. Cada migration acompanha a atualização do
tipo correspondente **no mesmo commit**, conforme `docs/FLUXO-BANCO.md`.

## 5. Cálculo

### 5.1. Assinatura

```ts
export interface ItemParaTotais {
  tipo_custo: TipoCusto;
  total_orcado: number | string | null;
  em_save?: boolean | null;
  save_consumido?: number | string | null;
}

export interface FechamentoLado {
  baseHonorarios: number; honorarios: number;
  baseImposto: number;    imposto: number;
  principal: number;      // o principal que entra NESTE lado
  total: number;          // principal + honorários + imposto
}
```

`VersaoTotais` ganha `faturamento`, `job` e `bruto` do tipo `FechamentoLado`,
mais `totalEmSave`, `totalSaveConsumido` e `receitaSave`. `subtotaisPorTipo` e
`subtotalGeral` continuam sendo a soma crua de `total_orcado` de todas as
linhas — é o custo, e o custo não muda.

Internamente vira um `fechar(valorPorItem)` chamado três vezes. Três laços
sobre ≤ ~100 itens não custam nada.

### 5.2. `calcularEfeitoDaMudanca`

Hoje tem **um** `delta(lever)` e um `comum = deltaHonorarios + deltaImposto`
somado nos dois retornos (`versao-totais.ts:276-289`). Passa a ter **dois
deltas independentes** — um sobre `total − saveConsumido`, outro sobre
`emSave ? 0 : total` — e `comum` **desaparece**: os dois lados param de
compartilhar honorários e imposto.

A linearidade continua valendo em cada lado, então a propriedade que sustenta
o card de Erratas — a soma dos efeitos por item fecha com o delta total —
continua verdadeira para os **dois** números. É o teste que precisa existir.

### 5.3. Dois helpers, sem duplicar fórmula

```ts
/** O faturamento que UMA linha gera na origem. R$ 30.000 tipo B a
 *  10%/19,53% → R$ 41.009,07; a mesma linha tipo A → R$ 3.728,10. */
receitaDeFaturamentoDaLinha(total, tipoCusto, pctHon, pctImp)

/** Rateio proporcional ao consumo do principal.
 *  25.000 de 30.000 sobre 41.009,07 → 34.174,23. */
receitaSaveMigrada(receitaOrigem, principal, consumido)
```

O primeiro é `calcularEfeitoDaMudanca` de 0 até o total — não reescreve a
conta.

### 5.4. Os chamadores

Onze sítios em dez arquivos precisam de `em_save` e `save_consumido` no
`.select(...)`; **nenhum precisa mudar de lógica**:

`_rascunho/rascunho.ts:160` · `orcamentos/[projetoId]/page.tsx:236` ·
`abertura-actions.ts:233,242,325` · `versoes/[versaoId]/page.tsx:262` ·
`totais-card.tsx:69,100` · `carregar-planilhas.ts:245` ·
`actions-errata.ts:218,326,336` · `job-totais-card.tsx:149` ·
`carregar-detalhe.ts:481` · `alterar-orcado-drawer.tsx:149,158`.

Um muda de verdade: `export/route.ts:232`, que passa a ler `totais.bruto.*`.

### 5.5. `recalcularTotaisDoJob` — extrair

`registrarErrata` reescreve `jobs.valor_total` e `jobs.faturamento_previsto`
no fim (`actions-errata.ts:487-496`). Criar, editar ou remover um **consumo**
muda os mesmos dois números. Extrair
`recalcularTotaisDoJob(supabase, jobId, tenantId)` para `lib/data/` e chamar
dos dois lugares — senão a action de consumo vira uma segunda cópia da regra,
e as duas divergem.

### 5.6. Rentabilidade

A regra 9 tira a linha em save da rentabilidade da origem. Isso faz
`subtotalGeral` divergir de `somarBlocosDosItens().orcado`, hoje o mesmo
número — e pelo menos `carregar-planilhas.ts:265` assume que são iguais
(`orcado: subtotalGeral`).

Tratar a exclusão em `blocosDoItem`
([lib/calculos/bv-planilha.ts:257](../../../lib/calculos/bv-planilha.ts)),
que é o funil por onde toda planilha, subtotal, card e visão agregada já
passam. É o ponto de alavancagem único.

## 6. Faturamento

### 6.1. O enum, em migration isolada

```sql
alter type faturamento_origem add value if not exists 'save';
```

Sozinho na migration: `add value` precisa de commit antes de ser usado em
constraint ou função. Precedente:
`20260820000007_desembolso_enum_lancamentos.sql`.

### 6.2. O CHECK — o único item destrutivo

```sql
alter table public.faturamento_itens drop constraint chk_fat_item_origem;
alter table public.faturamento_itens add constraint chk_fat_item_origem check (
     (origem_tipo = 'avulso' and origem_id is null and envio_parcela_id is null)
  or (origem_tipo = 'bv'     and origem_id is not null and envio_parcela_id is null)
  or (origem_tipo = 'job'    and origem_id is not null)
  or (origem_tipo = 'save'   and origem_id is not null and envio_parcela_id is not null)
);
```

O CHECK novo é estritamente **mais permissivo** e a tabela tem 2 linhas, mas
substituição de constraint cai do lado destrutivo da régua do
`docs/FLUXO-BANCO.md`. **Exige confirmação explícita do Tiago.**

### 6.3. A nota do job de origem

R$ 109.357,52 sai com dois itens apontando para a **mesma** parcela do envio:

| origem_tipo | origem_id | envio_parcela_id | valor |
|---|---|---|---:|
| `job` | Job A | parcela 1/1 | 68.348,45 |
| `save` | save da L2 | parcela 1/1 | 41.009,07 |

**`jobs_envio_faturamento` não muda.** `enviarJobParaFaturamento`
(`actions-faturamento.ts:82-100`) relê `jobs.faturamento_previsto`, que já
inclui o save, e a trava da soma das parcelas continua valendo. O formulário
só ganha a leitura "deste total, R$ 41.009,07 é saldo em save".

**`vw_faturamento_pendente` não muda para o saldo:** o CTE `parcela_faturada`
(`20260817000005:339-347`) soma `fi.valor` por `envio_parcela_id` sem olhar
`origem_tipo`, então os dois itens abatem a mesma parcela sozinhos. Ganha
duas colunas informativas **no fim** — `create or replace` exige preservar
nome, tipo e ordem das antigas.

Rateio entre parcelas: **proporcional**
(`receita_save_total / faturamento_previsto` aplicado ao valor de cada
parcela, resíduo de centavo na última). É a única forma que mantém cada
parcela derivável isoladamente.

### 6.4. `receita_save_da_linha` em SQL

Quem calcula é o servidor — o próprio código já cravou o princípio: "é valor
de nota fiscal; o navegador não é fonte confiável para ele"
(`actions-faturamento.ts:27-31`). Isso obriga a fórmula a existir também em
SQL.

⚠️ **A matriz de alavancas passa a existir em dois lugares.** Já havia
precedente (`20260811000005_jobs_faturamento_previsto.sql:30-42`). Mitigação:
comentário cruzado nos dois arquivos e um teste comparando os 7 tipos.

`emitir_faturamento` (`20260817000005:519-700`) ganha, dentro do laço de itens
que já existe (linhas 602-644), um ramo `'save'`: confere que `origem_id` é um
`jobs_saves` do tenant e que
`valor ≤ receita_save_da_linha(save) − já faturado em NF emitida`. O portão do
saldo da parcela continua valendo por cima, inalterado.

### 6.5. Cancelamento

`cancelar_faturamento` (`20260817000005:820-905`) **já devolve o saldo
sozinho**: tudo que lê "já faturado" filtra `f.status = 'emitido'`.

Falta um **portão novo**, no mesmo lugar do "Existem N títulos já baixados"
(linhas 866-874): não cancelar NF que contenha item de save cujo crédito já
foi consumido por job **encerrado**. Sem ele, cancelar uma nota reescreve a
margem de um job que a decisão 008 §4 declara congelado.

## 7. Server actions

| Action | O que faz |
|---|---|
| `marcarItensEmSave(versaoId \| jobId, itemIds[], marcar)` | liga/desliga a marca em lote. Recusa item com PP ou BV ativo |
| `definirSavePorPadrao(versaoId, ligado)` | a chave do orçamento de save |
| `alocarSave(saveId, jobId)` | reserva o save ao job. Recusa se já alocado, se o cliente não bate, ou se o job já foi enviado para faturamento |
| `registrarConsumo(jobItemOrcadoId, saveId, valor)` | cria/edita o consumo. Chama `recalcularTotaisDoJob` |
| `removerConsumo(consumoId)` | idem, ao contrário |
| `devolverSaldoDoJob(jobId)` | chamada por `encerrarJob`: solta `job_consumidor_id` dos saves do job, mantém os consumos |

Todas começam com `requireSession()` e terminam com `revalidatePath`,
conforme o checklist de `docs/PERFORMANCE.md`.

## 8. UI

Depende do layout que voltar do Claude Design (variantes 1a/1b/1c para o
marcador, 2a/2b/2c para o saldo e o rastro). O que já está fixo:

- **Planilha da versão** — marcador, chave "Orçamento de save", tratamento da
  linha marcada, "Saldo em save" no card de Totais.
- **Planilha Interna do job** — marcador, seletor de save, pílulas de rastro,
  números de save nos Totais.
- **Seletor de saves** — job de origem, descrição, tipo, saldo, estado, aviso
  de percentuais divergentes.
- **Fila de faturamento** — quebra job × save na linha e no drawer.
- **Encerramento** — "Saldo em save devolvido ao cliente".

Cores de bloco de `app/(app)/_planilha/blocos.ts`, grade compartilhada entre
planilha e Totais, calha de 116px que não alarga, strings em pt-BR completo.

## 9. Riscos e mitigações

### 9.1. Ainda aguardando o Tiago

- **Save consumível antes de a NF sair?** Recomendação: sim (decisão 028 §6).
- **Errata pode marcar/desmarcar save?** Recomendação: não, na fatia 1.
- **O CHECK de `faturamento_itens`** (§6.2) — item destrutivo.

### 9.2. Job consumidor com faturamento zero

Todas as linhas pagas por save ⇒ `faturamento_previsto = 0` ⇒
`enviarJobParaFaturamento` recusa (`actions-faturamento.ts:84-90`) ⇒ e a
decisão 008 §1 só encerra quem foi enviado. **O job ficaria preso.**
Resolvido pela regra 15 da decisão 028: exceção explícita.

### 9.3. Consumo criado depois do envio para faturamento

`jobs_envio_faturamento.valor_faturado` é cópia congelada;
`jobs.faturamento_previsto` teria mudado, e a nota sairia errada. **Travar
alocação e consumo depois do envio**, no espírito da divergência
errata × envio que a decisão 008 §3 já trata.

### 9.4. Errata sobre linha em save ou consumidora

Baixar o valor abaixo dos consumos quebra o saldo (origem) ou deixa a base de
faturamento negativa (consumidor) — trigger no banco, mensagem legível na
action. Trocar o `tipo_custo` de uma linha em save muda a receita dela; se a
NF de save já saiu, muda um número já faturado. Barrar junto de
`barrarTrocaDeTipo` (`actions-errata.ts:41-103`), com a mesma granularidade
por item.

### 9.5. Ponto cego de NF agrupada

`lib/data/faturamento-por-job.ts:47` e
`app/(app)/financeiro/abertura-de-job/consumo.ts:41` ainda leem
`faturamentos.origem_id`, que a decisão 017 §2 tornou nulo em nota agrupada.
O save agrava. Decidir na fatia 4 se entra no escopo ou fica como pendência.

### 9.6. Encerrar o job de origem com save não consumido

O saldo **sobrevive** (regra 8 da decisão 028). É contra-intuitivo e está
documentado; `vw_saves` não filtra status da origem de propósito.

### 9.7. Backfill

Volumes hoje: 217 itens de versão, 93 itens de job, 16 jobs, 1 faturamento, 2
`faturamento_itens`. Colunas novas com default ⇒ **backfill zero**; tabelas
novas nascem vazias; `add value` no enum não toca dado. Só o CHECK de §6.2 é
destrutivo.

## 10. Ordem de implementação

| Fatia | Conteúdo | Entrega |
|---|---|---|
| **0** | Refator de `versao-totais.ts` (três lados, dois deltas, dois helpers) + testes com os números de A e B | A conta nova existe e está provada. Nenhum número de produção muda |
| **1** | Colunas + trigger + `lib/types.ts` + marca na planilha + chave no orçamento + export para `bruto.*` | Dá para marcar linha; a origem já nasce com os dois números certos |
| **2** | `jobs_saves` + `vw_saves` + criação em `enviarJobParaAbertura` + as três guardas de §4.5 | O saldo existe, é consultável, a origem está protegida |
| **3** | `jobs_saves_consumos` + triggers + `recalcularTotaisDoJob` + seletor + travas de errata e envio | O ciclo fecha: A gera, B consome, os dois números batem |
| **4** | Enum → CHECK + `receita_save_da_linha` + `emitir_faturamento` + `vw_faturamento_pendente` + portão de cancelamento + drawer | A nota separa job de save |
| **5** | Devolução em `encerrarJob` + linha no resumo + exceção do job com faturamento zero | A sobra volta; nenhum job fica preso |

A fatia 0 é pré-requisito de todas e **não depende do design** — pode
adiantar. 1 → 2 → 3 são sequenciais; 4 depende de 2; 5 depende de 3.
