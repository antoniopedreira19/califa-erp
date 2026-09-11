# 069 — A regional do job é a fonte; o rateio só existe onde não há job

**Data:** 2026-09-10
**Status:** aceita · revisada em 2026-09-11 (o BV entrou)
**Contexto:** `vw_fluxo_caixa`, `jobs`, `desembolsos`, conciliação e todo
lançamento que alimentará o DRE por regional. Fecha a pendência deixada
aberta pela reversão `20260909180001_regional_id_volta_a_ser_nullable.sql`.

## A regra

> **Origem em job → a regional é a do job, 100%, sem divisão.**
> **Sem job → destrincha em N regionais (rateio da despesa).**

O job não se divide entre regionais. Quem se divide é a despesa que não
tem job — e só ela.

## O problema

O DRE por regional precisa que todo lançamento tenha regional. A Fase 2A
tentou garantir isso tornando `regional_id` NOT NULL em `contas_avulsas`,
`lancamentos_financeiros` e `titulos_receber`. Quebrou seis fluxos de
escrita e ficou 24h no ar: baixa de título, estorno de baixa, fechamento
de fatura de cartão, criação de conta avulsa, compra parcelada no cartão
e emissão de faturamento.

A causa foi mirar o lugar errado. A coluna singular `regional_id` nunca
foi a fonte da regional — é o último fallback. A fonte é o rateio ou o
job, e a `vw_fluxo_caixa` já lia nessa ordem. Tornar obrigatório o
terceiro item da precedência inverteu a hierarquia.

O sanity check não pegou porque contou nulos em três tabelas **vazias**.
Contar nulos em tabela vazia sempre dá zero.

## A decisão

Se a regional do job é a fonte de tudo que nasce de job, então a trava é
**uma só, e fica no job**: `jobs.regional_id` passa a ser NOT NULL. Não
há mais nenhum check por tabela de lançamento, porque não é preciso —
quem tem job herda uma regional que não pode faltar.

E o desembolso deixa de se vincular a job: *"tudo do job deverá ser
lançado pelo job"*. O desembolso passa a ser, por definição, o
instrumento da despesa **sem** job.

## O que mudou

**1. `jobs.regional_id` é NOT NULL.** O formulário de abertura já exigia;
a **edição** do job é que oferecia "Sem regional" e gravava nulo. Foi
corrigida no mesmo commit — sem isso, a migration repetiria o episódio de
08/09, devolvendo erro cru do Postgres numa tela que antes salvava.

**2. Desembolso não tem job.** CHECK `desembolso_nao_tem_job`, e o campo
saiu do formulário, do detalhe e da validação. A coluna `job_id` ficou no
banco porque remover coluna é destrutivo; está barrada e comentada.

**3. A `vw_fluxo_caixa` lê `desembolsos_regionais`.** O rateio do
desembolso era gravado pelo formulário e **nunca lido** — a view usava a
regional do job. Sem job, todo desembolso ficaria sem regional. Agora o
rateio entra com fator, como já acontecia com a avulsa, e um desembolso
sem rateio nenhum ainda produz uma linha (com regional nula) em vez de
sumir com o dinheiro de vista.

**4. A baixa de título herda a regional do job.** `dar_baixa_titulo`
grava o lançamento sem `job_id` e sem `regional_id`. A view já derivava o
job certo pelo título → `faturamento_itens` — inclusive rateando entre N
jobs quando a nota cobre vários — mas descartava isso na hora da
regional, que vinha de um CTE cego para a derivação. **Toda receita
realizada entrava no DRE sem regional.** Agora os dois se encontram em
`COALESCE(jlj.regional_id, lr.regional_id)`.

## O que NÃO mudou de número

A ordem dos CTEs de rateio foi invertida (job primeiro, rateio depois)
para o código dizer o mesmo que a regra. Isso não altera resultado nenhum
hoje: a escrita da avulsa e da recorrente **já forçava** rateio único de
100% na regional do job quando havia job — a regra desta decisão já era a
prática em três dos cinco caminhos de escrita. A inversão é para quem ler
depois, e para o caso de a escrita um dia divergir.

## Em aberto

- **Como o rateio é preenchido** em desembolso, recorrência e avulsa sem
  job. É o próximo lote.
- **Despesa sem job e sem rateio** sai com regional nula. Não há trava de
  "pelo menos uma linha de rateio", nem trigger de soma 100 em
  `desembolsos_regionais` — avulsa e recorrente têm.
- **Pagamento de fatura de cartão** agrega N compras e não tem job único.
- **Título com origem `avulso`** não tem job — esse fica para o próximo
  lote. O de origem `bv` **tem**, e desde 11/09/2026 a view percorre o
  caminho (ver a revisão no fim).
- **A conciliação** lê `lancamentos_financeiros` direto, não a view: o job
  derivado da baixa de título não aparece ali, e a linha sai sem regional.

## Referências

- Migration `20260910210001_regional_do_job_e_a_fonte.sql`
- Reversão anterior: `20260909180001_regional_id_volta_a_ser_nullable.sql`
- `docs/handoffs/HANDOFF_FINANCEIRO.md`, seção do `regional_id`

---

## Revisão de 2026-09-11 — o BV se associa ao job

O BV tinha ficado de fora por omissão da view, não por regra. Corrigido
pela migration `20260911100001_bv_se_associa_ao_job.sql`, a pedido do
Tiago: *"que o BV seja associado ao job logo, como deve"*.

O caminho é `itens_bv.job_item_orcado_id` → `jobs_itens_orcado.job_id`, e
a `vw_faturamento_pendente` **já o percorria** para listar o BV a faturar.
Quem não percorria era a `vw_fluxo_caixa`: o CTE `fat_composicao`
resolvia o job só para `origem_tipo = 'job'`. Com isso, o título de BV
aparecia sem job e sem regional — e a baixa dele também, porque
`lancamento_job` deriva o job do lançamento a partir de `fat_composicao`.

**Por que o elo direto basta, e não um COALESCE com o `item_versao_id`.**
Levantado no banco antes de escrever, nos 8 BVs existentes: os 5 que têm
cópia no job têm o elo direto preenchido, e a rota alternativa devolve o
MESMO job; os 3 sem elo não têm cópia no job nenhuma — são BVs de
orçamento, cujo job ainda não existe. Some-se que só BV `confirmado`
chega ao faturamento, e `confirmarBv` exige job aberto. BV faturado
sempre tem job. Resolver pelas duas rotas seria inventar regra que o dado
não pede, e faria as duas views divergirem.

**Efeito colateral bom:** `fat_composicao` agrupa o faturamento por job
também quando o item é BV. Como é ele que reparte o título entre N jobs,
uma nota que misture faturamento de job e BV passa a dividir certo —
antes o pedaço do BV caía todo no grupo nulo.
