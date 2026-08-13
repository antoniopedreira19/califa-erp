# Contas a Receber — Faturamento + Títulos — design

**Data:** 2026-08-13
**Status:** proposto, aguardando revisão

## Contexto

Hoje o califa-erp não tem módulo de contas a receber. O que a California espera receber já está registrado, disperso em duas fontes:

- **Job aberto** (`app/(app)/financeiro/abertura-de-job/`): grava `jobs.faturamento_previsto` (valor calculado pela fórmula AR+B+C + honorários + imposto) e `jobs.data_prevista_faturamento`.
- **BV confirmado** (`app/(app)/_bv/bv-dialog.tsx`): grava `itens_bv.valor` (comissão que o fornecedor devolve) e `itens_bv.prazo_repasse`. O estado `recebido` no enum `bv_situacao` já existe reservado — literalmente esperando este módulo.

O que falta:

1. Consumir essas duas fontes numa fila "a faturar".
2. Emitir a NF (registrar dados + anexar PDF), definir parcelamento e gerar títulos.
3. Acompanhar títulos até a baixa.
4. Alimentar `lancamentos_financeiros` na baixa (natureza `entrada`) pra bater com Conciliação e Fluxo de Caixa.

## Objetivo

Criar o módulo `/financeiro/contas-a-receber` com 2 abas:

1. **Faturamento** — fila do que precisa virar NF (jobs com saldo + BVs confirmados + avulsos).
2. **A Receber** — títulos em aberto/pagos/inadimplentes, com baixa.

## Não-objetivos

- **OCR** de nota fiscal (fase 2).
- **Cobrança automática** por email/WhatsApp (fase 2 separada — tem risco operacional próprio).
- **Baixa parcial de título** (fase futura se aparecer demanda real; MVP atômico).
- Emissão fiscal automatizada via SEFAZ/NFS-e (fora de escopo).
- Régua de inadimplência (só marca calculado, sem workflow de cobrança).
- Conciliação e Fluxo de caixa continuam com o comportamento atual — só ganham a nova fonte de entrada.

## Modelagem

### 1. Tabela `faturamentos`

A NF emitida pela California. Uma linha por NF.

```
id                     uuid pk
tenant_id              uuid not null fk tenants
empresa_id             uuid not null fk empresas   -- California SP, RJ, etc.
origem_tipo            enum ('job','bv','avulso') not null
origem_id              uuid null                    -- FK lógica (job_id ou item_bv_id)
cliente_id             uuid null fk clientes        -- obrigatório se origem in ('job','avulso')
fornecedor_id          uuid null fk fornecedores    -- obrigatório se origem = 'bv'
numero_nf              text not null
serie                  text not null
data_emissao           date not null
valor_total            numeric(14,2) not null       -- soma dos títulos filhos
descricao              text not null                -- rótulo humano: derivado da origem ou digitado (avulso)
anexo_nf_path          text not null                -- storage path do PDF
plano_conta_tipo_id    uuid not null fk plano_contas_tipos
plano_conta_subtipo_id uuid not null fk plano_contas_subtipos
status                 enum ('emitido','cancelado') not null default 'emitido'
cancelado_em           timestamptz null
cancelado_por          uuid null fk profiles
motivo_cancelamento    text null
emitido_em             timestamptz not null default now()
emitido_por            uuid not null fk profiles

constraint chk_faturamento_contraparte check (
  (origem_tipo in ('job','avulso') and cliente_id is not null and fornecedor_id is null)
  or
  (origem_tipo = 'bv' and fornecedor_id is not null and cliente_id is null)
)
constraint chk_faturamento_origem check (
  (origem_tipo = 'avulso' and origem_id is null)
  or
  (origem_tipo in ('job','bv') and origem_id is not null)
)
constraint chk_faturamento_valor_positivo check (valor_total > 0)
constraint chk_faturamento_cancelado check (
  (status = 'cancelado' and cancelado_em is not null and cancelado_por is not null)
  or
  (status = 'emitido' and cancelado_em is null and cancelado_por is null)
)
```

**Índices:**
- `(tenant_id, origem_tipo, origem_id)` — pra query "quanto já foi faturado deste job/BV".
- `(tenant_id, status)` — pra listar emitidos.
- `(tenant_id, cliente_id)` — pra "todas NFs de um cliente".

**RLS:** padrão tenant, `is_tenant_member(tenant_id)`.

**Storage bucket:** `faturamentos-nf` (privado). Path: `<tenant_id>/<faturamento_id>/nf.pdf`.

### 2. Tabela `titulos_receber`

Parcelas de uma NF. 1 faturamento → N títulos.

```
id                              uuid pk
tenant_id                       uuid not null fk tenants
empresa_id                      uuid not null fk empresas
faturamento_id                  uuid not null fk faturamentos on delete restrict
numero_parcela                  smallint not null              -- 1, 2, 3...
valor                           numeric(14,2) not null
data_vencimento                 date not null
status                          enum ('em_aberto','pago','cancelado') not null default 'em_aberto'
pago_em                         date null
pago_por                        uuid null fk profiles
conta_bancaria_recebimento_id   uuid null fk contas_bancarias
lancamento_id                   uuid null fk lancamentos_financeiros  -- criado na baixa
cancelado_em                    timestamptz null
cancelado_por                   uuid null fk profiles
created_at                      timestamptz not null default now()

constraint chk_titulo_pago_consistente check (
  (status = 'pago'
    and pago_em is not null
    and pago_por is not null
    and conta_bancaria_recebimento_id is not null
    and lancamento_id is not null)
  or
  (status <> 'pago'
    and pago_em is null
    and pago_por is null
    and conta_bancaria_recebimento_id is null
    and lancamento_id is null)
)
constraint chk_titulo_valor_positivo check (valor > 0)
```

**Índices:**
- `(tenant_id, status)` — filtros de aba.
- `(tenant_id, data_vencimento) where status = 'em_aberto'` — partial, pra listar próximos vencimentos e inadimplentes.
- `(faturamento_id)` — cascade lookup.

**Inadimplente** é calculado: `data_vencimento < current_date and status = 'em_aberto'`. Não persiste como estado — evita necessidade de cron pra virar flag e evita drift.

**RLS:** padrão tenant.

### 3. Extensão do enum `origem_lancamento`

Adiciona: `titulo_baixa`, `titulo_baixa_estornada`, `titulo_estorno`.

Mesma família dos existentes pra PP e avulsa (baixa cria linha, estorno inverte).

### 4. Nova coluna em `lancamentos_financeiros`

`titulo_receber_id uuid null fk titulos_receber` — pra rastrear.

Ajustar constraint `chk_origem_pp_tem_pp_id` (renomear pra `chk_origem_contraparte_tem_id`) pra também exigir `titulo_receber_id` quando `origem in ('titulo_baixa','titulo_baixa_estornada','titulo_estorno')`.

Unique parcial: `uniq_baixa_ativa_por_titulo on lancamentos_financeiros(titulo_receber_id) where origem = 'titulo_baixa'` (paralelo ao que já existe pra PP).

### 5. RPCs

**`emitir_faturamento(payload jsonb) returns uuid`** — transacional
- Valida gate (financeiro/admin).
- Valida contraparte coerente com origem.
- Cria linha em `faturamentos`.
- Cria N linhas em `titulos_receber` (payload traz array de parcelas).
- Retorna `faturamento_id`.

**`dar_baixa_titulo(p_titulo_id uuid, p_pago_em date, p_conta_bancaria_id uuid, p_criado_por uuid) returns uuid`** — transacional
- Valida `status='em_aberto'`.
- UPDATE `titulos_receber → pago` com fields de baixa.
- INSERT `lancamentos_financeiros` com `natureza='entrada'`, `origem='titulo_baixa'`.
- Se todos os títulos do faturamento com origem='bv' agora estão `pago` → UPDATE `itens_bv.situacao = 'recebido'`.
- Retorna `lancamento_id`.

**`estornar_baixa_titulo(p_titulo_id uuid, p_motivo text, p_criado_por uuid) returns uuid`** — transacional
- Valida `status='pago'`.
- INSERT lançamento reverso.
- UPDATE original: `origem='titulo_baixa_estornada'`.
- UPDATE `titulos_receber → em_aberto` (limpa fields).
- Se origem='bv' e faturamento não tem mais títulos pagos → volta `itens_bv.situacao='confirmado'`.

**`cancelar_faturamento(p_faturamento_id uuid, p_motivo text, p_cancelado_por uuid) returns void`** — transacional
- Valida `status='emitido'`.
- Verifica: se existe algum título com `status='pago'` → RAISE `Existe título já baixado. Estorne a baixa antes de cancelar a NF.`
- UPDATE `faturamentos → cancelado`.
- UPDATE todos os `titulos_receber` filhos `em_aberto → cancelado`.
- Se origem='bv': UPDATE `itens_bv.situacao = 'confirmado'` (volta pra fila).
- (Se origem='job': o job automaticamente volta a ter saldo — cálculo é derivado.)

### 6. Views

**`vw_faturamento_pendente`** — o que a aba Faturamento consome:

```sql
-- Jobs abertos com saldo a faturar
select 'job'::text as origem_tipo, j.id as origem_id, j.tenant_id, j.empresa_id,
       j.codigo, j.nome as descricao,
       coalesce(p.cliente_id, null) as cliente_id, null::uuid as fornecedor_id,
       j.faturamento_previsto as valor_previsto,
       coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0) as valor_ja_faturado,
       j.faturamento_previsto - coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0) as saldo,
       j.data_prevista_faturamento as data_prevista
  from public.jobs j
  join public.projetos p on p.id = j.projeto_id
  left join public.faturamentos f
    on f.origem_tipo = 'job' and f.origem_id = j.id
 where j.status = 'aberto'
   and j.faturamento_previsto > 0
 group by j.id, p.cliente_id
having j.faturamento_previsto - coalesce(sum(f.valor_total) filter (where f.status = 'emitido'), 0) > 0

union all

-- BVs confirmados sem faturamento ativo
select 'bv', bv.id, bv.tenant_id, /* empresa vem do escolhe-na-hora */ null::uuid as empresa_id,
       null as codigo, /* descrição derivada do item da versão */ 'BV — ' || v.descricao,
       null::uuid as cliente_id, bv.fornecedor_id,
       bv.valor as valor_previsto, 0 as valor_ja_faturado, bv.valor as saldo,
       bv.prazo_repasse as data_prevista
  from public.itens_bv bv
  join public.versoes_orcamento_itens v on v.id = bv.item_versao_id
 where bv.situacao = 'confirmado'
   and not exists (
     select 1 from public.faturamentos f
      where f.origem_tipo = 'bv' and f.origem_id = bv.id and f.status = 'emitido'
   );
```

Nomes exatos das colunas de `jobs` e `versoes_orcamento_itens` confirmar no wiring da migration.

**`vw_fluxo_caixa`** — atualizada para incluir títulos em aberto como previsto de entrada:

```sql
-- ... branches existentes de PP/avulsa/lançamento ...
union all
select 'previsto', 'titulo', t.id, t.tenant_id, t.empresa_id,
       null::uuid as conta_bancaria_id,
       t.data_vencimento as data_evento,
       t.valor,
       'entrada'::natureza_lancamento,
       ('Título ' || f.numero_nf || '/' || t.numero_parcela) as descricao,
       null::uuid as fornecedor_id, f.cliente_id, null::uuid as job_id
  from public.titulos_receber t
  join public.faturamentos f on f.id = t.faturamento_id
 where t.status = 'em_aberto';
```

## Front-end

### Rota nova

`/financeiro/contas-a-receber` (server component + client components).

### Arquivos previstos

- `app/(app)/financeiro/contas-a-receber/page.tsx` — server, Promise.all das queries.
- `app/(app)/financeiro/contas-a-receber/actions.ts` — server actions.
- `app/(app)/financeiro/contas-a-receber/tabs.tsx` — client, tabs Faturamento | A Receber.
- `app/(app)/financeiro/contas-a-receber/faturamento-list.tsx` — client, fila a faturar.
- `app/(app)/financeiro/contas-a-receber/faturar-drawer.tsx` — client, drawer que emite NF.
- `app/(app)/financeiro/contas-a-receber/faturar-avulso-drawer.tsx` — client, drawer sem origem.
- `app/(app)/financeiro/contas-a-receber/titulos-list.tsx` — client, lista de títulos com chips.
- `app/(app)/financeiro/contas-a-receber/cancelar-faturamento-modal.tsx` — modal com motivo.
- **Modificar:** `app/(app)/financeiro/page.tsx` — adicionar 5º card "Contas a Receber".
- **Modificar:** `components/financeiro/baixa-avulsa-dialog.tsx` — reusar direto (já compartilhado); passa como `tipoLabel="Título"`.
- **Modificar:** `lib/types.ts` — enums `FaturamentoStatus`, `TituloReceberStatus`, tipos das rows.

### UI da aba Faturamento

Tabela com colunas:
- Origem (chip: Job / BV / Avulso)
- Descrição (código do job, nome do item BV, ou descrição avulsa)
- Cliente/Fornecedor
- Previsto (R$)
- Já faturado (R$) — só relevante pra Job (BV é 1:1, avulso é 1:1)
- Saldo (R$)
- Data prevista
- Ação: **Faturar**

Header da aba tem botão `+ Novo Faturamento avulso` (abre `faturar-avulso-drawer`).

### Drawer "Faturar"

Campos:
- **Cliente/Fornecedor** (auto-preenchido se job/BV, editável se avulso)
- **Empresa emissora** (auto pra job; escolhe pra BV/avulso)
- **Descrição** (auto-preenchida: `job.nome` se job, `item.descricao` se BV, digitação livre se avulso — sempre editável)
- **Upload PDF da NF** (obrigatório)
- **Número da NF, Série, Data de emissão**
- **Valor total** — pré-preenchido com saldo (job) ou valor (BV/avulso), editável
- Se `valor_total != saldo previsto`: banner amarelo "Valor difere do previsto (R$ X vs R$ Y). Confirme se está correto."
- **Plano de contas** (tipo + subtipo)
- **Parcelas** (editor):
  - 1 parcela por default (data = data_emissao + 30 dias sugerido)
  - Botão "+ Nova parcela" adiciona linha (data + valor)
  - Soma das parcelas deve bater com valor total (validação client + server)
  - Reset button "Aplicar parcelamento padrão" (30/60/90 dias em partes iguais)
- **Confirmar** → chama RPC `emitir_faturamento` → toast → refresh

### UI da aba A Receber

Chips filtro: `Em aberto | Pagos | Inadimplentes | Todos`
Contadores em cada chip.

Tabela:
- Cliente
- NF (número + série)
- Parcela (ex: "2/3")
- Vencimento (vermelho + "atrasado" se inadimplente)
- Valor
- Status (badge)
- Ação: **Dar baixa** (se em_aberto) | **Estornar** (se pago)

Baixa reusa `BaixaAvulsaDialog` (já compartilhado em `components/financeiro/`).

### Landing `/financeiro`

Ganha card "Contas a Receber":
- Contagem: `a_faturar_count + inadimplente_count` (dois números pequenos separados por `|`).
- Ícone: `Receipt` ou similar.
- Descrição: "Emitir NF a partir de jobs e BVs, acompanhar títulos a receber."

## Auditoria

Cada ação nova gera `logAuditEvent`:
- `faturamento.emitido` — metadata: origem_tipo, origem_id, numero_nf, valor_total, cliente_id/fornecedor_id.
- `faturamento.cancelado` — metadata: numero_nf, motivo.
- `titulo.baixado` — metadata: faturamento_id, valor, conta_bancaria_id, lancamento_id.
- `titulo.baixa_estornada` — metadata: motivo, lancamento_reverso_id.

Adicionar ao union `AuditAction` em `lib/auth/audit.ts`.

## Fluxo end-to-end (exemplo)

1. GP abre job "PJ-123" no valor de R$ 100k. Fica em `jobs.faturamento_previsto = 100000`, `data_prevista_faturamento = 2026-09-15`.
2. Aba Faturamento mostra: `PJ-123 | Cliente X | Previsto R$ 100k | Faturado R$ 0 | Saldo R$ 100k | 15/09`.
3. Financeiro clica "Faturar", anexa NF-1234 no valor de R$ 40k em 1 parcela vencendo 30/09.
   - Cria 1 `faturamento` (valor_total=40k) + 1 `titulo_receber` (valor=40k, venc=30/09).
   - Job continua na fila com saldo R$ 60k.
4. Aba A Receber mostra o novo título "Cliente X | NF-1234 1/1 | 30/09 | R$ 40k | Em aberto".
5. Fluxo de caixa mostra +40k previsto no bucket 30/09.
6. Cliente paga em 05/10 (5 dias atrasado). Enquanto isso, aba A Receber já mostra o título em vermelho como "Inadimplente" (calculado).
7. Financeiro dá baixa: registra data 05/10, conta bancária Y.
   - Título vira `pago`.
   - Cria `lancamento_financeiro` (natureza=entrada, valor=40k, origem=titulo_baixa).
   - Aparece na Conciliação em 05/10.
   - No Fluxo de caixa, o bucket 30/09 perde o previsto e o 05/10 ganha o realizado.
8. Financeiro fatura os R$ 60k restantes: nova NF-1235 em 3 parcelas (20k cada, venc 15/10, 15/11, 15/12).
   - Job sai da fila (saldo = 0).
   - 3 novos títulos aparecem em A Receber.

## Migrations previstas

1. `20260813000001_faturamentos_tabela.sql` — enum + tabela + índices + RLS + storage bucket + policies.
2. `20260813000002_titulos_receber_tabela.sql` — enum + tabela + índices + RLS.
3. `20260813000003_lancamentos_financeiros_extensao.sql` — adiciona valores no enum `origem_lancamento`, coluna `titulo_receber_id`, unique parcial, atualiza constraint `chk_origem_*`.
4. `20260813000004_rpc_emitir_faturamento.sql` — RPC + GRANT.
5. `20260813000005_rpc_baixa_titulo_e_estorno.sql` — RPCs + GRANT + trigger BV→recebido.
6. `20260813000006_rpc_cancelar_faturamento.sql` — RPC + GRANT.
7. `20260813000007_views.sql` — `vw_faturamento_pendente` + atualização de `vw_fluxo_caixa` + GRANTs.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Errata muda `faturamento_previsto` depois de emitir NF, valor faturado passa a divergir | UI mostra ambos ("Previsto agora R$ X, foi R$ Y na abertura") + auditoria já registra o valor congelado. Financeiro decide se emite nota adicional. |
| Job cancelado que tem NF já emitida | Bloquear cancelamento do job se `sum(faturamentos.valor_total) > 0` — regra vive fora deste módulo, no cancelamento do job. Fora de escopo aqui. |
| BV cancelado depois de faturado | Mesma coisa: bloquear cancelamento de BV se já tem `faturamento` associado. Regra vive no módulo BV. |
| Parcelas somam != valor_total | Validação no client + server (RAISE na RPC). |
| Volume de títulos vencidos cresce (query lenta) | Índice partial `where status = 'em_aberto'` + `data_vencimento < current_date` combina bem. Se virar problema, materializar. |
| Anexo PDF muito grande | Limite no upload (10MB por default do bucket). |

## Critérios de sucesso

1. Job aberto com valor previsto aparece na fila Faturamento automaticamente.
2. BV confirmado aparece na fila Faturamento automaticamente.
3. Emitir NF (parcial ou total) gera títulos corretamente.
4. Dar baixa no título cria lançamento em `lancamentos_financeiros` que aparece na Conciliação e no Fluxo de Caixa (bucket realizado).
5. Título vencido não pago aparece marcado como Inadimplente sem cron.
6. Último título de BV baixado vira o BV pra `recebido` automaticamente.
7. Cancelar NF só permite se nenhum título foi baixado.
8. Faturamento avulso funciona sem origem.
9. Estorno de baixa desfaz tudo e devolve título pra `em_aberto`.
