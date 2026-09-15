# 069 — A regional do job é a fonte; o rateio só existe onde não há job

**Data:** 2026-09-10
**Status:** aceita · revisada em 2026-09-11 (o BV entrou) e em 2026-09-15 (rateio conferido, reforço no banco e a [082](082-a-despesa-sem-job-nasce-com-rateio-e-a-recorrencia-vira-titulo-30-dias-antes.md))
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

- ~~**Como o rateio é preenchido** em desembolso, recorrência e avulsa sem
  job.~~ Conferido em 15/09/2026: já estava certo nos três (ver a revisão
  de 15/09 no fim).
- ~~**Despesa sem job e sem rateio.**~~ Resolvido em 15/09/2026. Desembolso:
  soma 100% no banco e rateio exigido na aprovação. Avulsa e recorrente:
  deixaram de ter job e passaram a nascer com o rateio numa transação só,
  com trava no banco — ver a [082](082-a-despesa-sem-job-nasce-com-rateio-e-a-recorrencia-vira-titulo-30-dias-antes.md).
- ~~**Pagamento de fatura de cartão** agrega N compras e não tem job
  único.~~ Não é furo: cada compra vira lançamento próprio com o rateio da
  avulsa. O par de lançamentos do pagamento é transferência entre contas e
  tem que ficar FORA do DRE, não ser rateado.
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

---

## Revisão de 2026-09-15 — rateio conferido, tarefa encerrada, e reforço no banco

**O rateio da despesa sem job já estava certo nos três tipos.** Conferido
da gravação até a leitura na `vw_fluxo_caixa`, e o Tiago encerrou a
tarefa:

| | Formulário | Linhas derivadas | Previsto | Realizado |
|---|---|---|---|---|
| Avulsa | mín. 1 regional, soma 100%; com job força 100% na do job | parcelas do cartão e estorno de compra copiam a divisão | por percentual | lançamento com `conta_avulsa_id` herda a divisão |
| Recorrente | igual à avulsa | a rotina diária copia a divisão da recorrente para cada ocorrência | por percentual | igual à avulsa |
| Desembolso | mín. 1 regional, soma 100%; sem job | — | por percentual | lançamento com `desembolso_id` herda a divisão |

Compra no cartão também está coberta: `fechar_fatura_cartao` cria um
lançamento por compra, com a avulsa de cada uma. Editar a divisão de uma
recorrente vale para as ocorrências geradas dali em diante.

**Reforço no banco — desembolso** (migration
`20260915200001_reforco_rateio_desembolso.sql`):

1. `trg_desembolso_rateio_soma` — soma 100% conferida no fim da
   transação, espelho exato da avulsa e da recorrente (aceita zero linhas).
2. `trg_desembolso_aprovado_exige_rateio` — a transição `em_avaliacao` →
   `aprovada` é barrada sem nenhuma linha de rateio.

A exigência de "ao menos uma linha" mora **na aprovação**, e não na
criação, porque a tela grava desembolso, parcelas e divisão em três
requisições separadas: uma trava no insert quebraria toda criação — o erro
de 08/09. A aprovação é sempre posterior e é o momento em que o desembolso
entra no fluxo de caixa. O estorno de baixa (`pago` → `aprovada`) não é
barrado.

Verificado com sonda em transação desfeita: soma 60% barrada, aprovação
sem rateio barrada, 33,33 + 33,33 + 33,34 aceito, aprovação com rateio
aceita, caminho do estorno livre. Nenhum resíduo.

**Avulsa e recorrente ficaram de fora deste reforço, de propósito.** As
duas nascem aprovadas (não há etapa entre criar e entrar no fluxo) e a
edição apaga a divisão numa requisição e grava a nova em outra.

⚠️ **Resolvido no mesmo dia pela [082](082-a-despesa-sem-job-nasce-com-rateio-e-a-recorrencia-vira-titulo-30-dias-antes.md) (2026-09-15).** O Tiago decidiu
que avulsa e recorrente também não têm job, que o rateio é definido na
criação, e que a recorrência vira título 30 dias antes do vencimento. A
despesa e o rateio passaram a ser gravados numa transação só, o que
permitiu a trava no banco que aqui não cabia.
