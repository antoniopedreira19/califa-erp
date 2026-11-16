# Vínculos de Colaborador — Modelo de dados

> Companion de [70-vinculos-colaborador.md](70-vinculos-colaborador.md). Esta doc fecha o **como** do banco: tabela, enums, triggers, policies, grants, backfill, e a ordem exata das migrations da Fase 1.

## 1. Tabela nova: `colaborador_vinculos`

```sql
create table public.colaborador_vinculos (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete restrict,
  colaborador_id            uuid not null references public.colaboradores(id) on delete cascade,

  tipo_contratacao          tipo_contratacao not null,
  data_inicio               date not null,
  data_fim                  date,
  motivo_encerramento       vinculo_motivo_encerramento,
  vinculo_anterior_id       uuid references public.colaborador_vinculos(id) on delete set null,

  observacao                text,
  created_by                uuid references public.profiles(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint chk_vinculo_datas        check (data_fim is null or data_fim >= data_inicio),
  constraint chk_motivo_so_encerrado  check (
    (data_fim is null and motivo_encerramento is null)
    or (data_fim is not null)
  )
);
```

### 1.1 Enum novo: `vinculo_motivo_encerramento`

```sql
create type vinculo_motivo_encerramento as enum (
  'rescisao_clt_para_novo_vinculo',  -- típico das 5 viradas
  'demissao',
  'pedido_demissao',
  'fim_de_contrato',                 -- ex: estágio terminou
  'outro'
);
```

### 1.2 Índices

```sql
create index idx_colab_vinculos_tenant_colab    on public.colaborador_vinculos(tenant_id, colaborador_id);
create index idx_colab_vinculos_ativo           on public.colaborador_vinculos(colaborador_id) where data_fim is null;
create index idx_colab_vinculos_anterior        on public.colaborador_vinculos(vinculo_anterior_id) where vinculo_anterior_id is not null;
```

### 1.3 Unique parcial: 1 vínculo ativo por colaborador

```sql
create unique index uniq_colab_vinculo_ativo
  on public.colaborador_vinculos(colaborador_id)
  where data_fim is null;
```

### 1.4 Constraint de overlap (trigger)

A unique parcial garante 1 ativo. Mas pode ter 2 vínculos encerrados com datas sobrepostas (ex: alguém pensou errado e cadastrou um vínculo que inclui parte de outro). Impedir via trigger:

```sql
create or replace function public.fn_vinculo_valida_overlap()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.colaborador_vinculos v
    where v.colaborador_id = new.colaborador_id
      and v.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and v.data_inicio <= coalesce(new.data_fim, 'infinity'::date)
      and coalesce(v.data_fim, 'infinity'::date) >= new.data_inicio
  ) then
    raise exception 'Já existe vínculo deste colaborador sobrepondo o período informado.';
  end if;
  return new;
end $$;

create trigger trg_vinculo_valida_overlap
  before insert or update on public.colaborador_vinculos
  for each row execute function public.fn_vinculo_valida_overlap();
```

## 2. Triggers de sincronização

### 2.1 `colaboradores.tipo_contratacao` sincroniza com vínculo ativo

Precisamos manter a coluna na linha do colaborador refletindo o vínculo ativo, pra todas as queries atuais continuarem funcionando (D2 da spec).

```sql
create or replace function public.fn_colab_sincroniza_tipo_do_vinculo_ativo()
returns trigger language plpgsql as $$
declare
  v_tipo tipo_contratacao;
  v_colab_id uuid;
begin
  v_colab_id := coalesce(new.colaborador_id, old.colaborador_id);

  select tipo_contratacao into v_tipo
    from public.colaborador_vinculos
   where colaborador_id = v_colab_id
     and data_fim is null
   limit 1;

  if v_tipo is not null then
    update public.colaboradores
       set tipo_contratacao = v_tipo
     where id = v_colab_id
       and tipo_contratacao <> v_tipo;
  end if;

  return new;
end $$;

create trigger trg_vinculo_sincroniza_colab
  after insert or update or delete on public.colaborador_vinculos
  for each row execute function public.fn_colab_sincroniza_tipo_do_vinculo_ativo();
```

### 2.2 `fn_gerar_ferias_periodos` passa a usar `vinculo_ativo.data_inicio`

A trigger atual usa `NEW.data_admissao`. Substituir por função helper que resolve a "data base de contagem":

```sql
create or replace function public.fn_data_base_ferias(p_colaborador_id uuid, p_fallback date)
returns date language sql stable as $$
  select coalesce(
    (select data_inicio from public.colaborador_vinculos
      where colaborador_id = p_colaborador_id
        and data_fim is null
      limit 1),
    p_fallback
  );
$$;
```

E dentro de `fn_gerar_ferias_periodos`, trocar `NEW.data_admissao` por `fn_data_base_ferias(NEW.id, NEW.data_admissao)`. Fallback pro valor antigo garante que, se o vínculo ainda não existe (edge-case de ordem em migrations), o comportamento antigo é preservado.

Também precisa disparar quando `colaborador_vinculos` muda. Adicionar trigger em `colaborador_vinculos` que chama `fn_gerar_ferias_periodos` via `UPDATE no_op` em `colaboradores`:

```sql
create or replace function public.fn_vinculo_regenera_ferias()
returns trigger language plpgsql as $$
begin
  -- Toca updated_at pra disparar fn_gerar_ferias_periodos no colaborador.
  update public.colaboradores
     set updated_at = now()
   where id = coalesce(new.colaborador_id, old.colaborador_id);
  return null;
end $$;

create trigger trg_vinculo_regenera_ferias
  after insert or update or delete on public.colaborador_vinculos
  for each row execute function public.fn_vinculo_regenera_ferias();
```

### 2.3 Marcar aquisitivos de vínculo encerrado como `pago_rescisao`

Quando um vínculo é encerrado (ou quando novo vínculo é criado substituindo antigo), aquisitivos com `aquisitivo_inicio < vinculo_atual.data_inicio` devem virar `pago_rescisao`.

Lógica dentro de `fn_gerar_ferias_periodos` (já existente) — na regeneração, antes de criar novos períodos, marcar os anteriores como `pago_rescisao` em vez de deletar. Preserva lançamentos antigos (que têm FK em `periodo_id`).

## 3. RLS + GRANT

Policies seguem padrão do módulo RH — `is_tenant_admin` + `is_tenant_rh` podem CRUD, colaborador normal lê só se for dele.

```sql
alter table public.colaborador_vinculos enable row level security;

create policy vinculos_select on public.colaborador_vinculos
  for select to authenticated
  using (
    is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id)
    or exists (
      select 1 from public.colaboradores c
       where c.id = colaborador_id and c.user_id = (select auth.uid())
    )
  );

create policy vinculos_insert on public.colaborador_vinculos
  for insert to authenticated
  with check (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

create policy vinculos_update on public.colaborador_vinculos
  for update to authenticated
  using (is_tenant_admin(tenant_id) or is_tenant_rh(tenant_id));

create policy vinculos_delete on public.colaborador_vinculos
  for delete to authenticated
  using (is_tenant_admin(tenant_id));

grant select, insert, update, delete on public.colaborador_vinculos to authenticated;
```

## 4. Migrations da Fase 1 (ordem + conteúdo resumido)

### Migration 1 — Fundação (`20261116100001_vinculos_colaborador_fundacao.sql`)

- `CREATE TYPE vinculo_motivo_encerramento`
- `CREATE TABLE colaborador_vinculos` + constraints
- Índices + unique parcial
- Policies RLS + GRANT
- Trigger `trg_vinculo_valida_overlap`
- Função helper `fn_data_base_ferias`

Sem backfill ainda. **Aditivo e seguro**.

### Migration 2 — Backfill de vínculos ativos (`20261116100002_vinculos_backfill_ativos.sql`)

- Pra cada colaborador ativo do tenant Califa:
  ```sql
  insert into colaborador_vinculos (tenant_id, colaborador_id, tipo_contratacao, data_inicio, created_by)
  select tenant_id, id, tipo_contratacao, data_admissao, created_by
    from colaboradores
   where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  ```
- Guarda de tenant (igual aos imports anteriores).
- Backup: `_backup_20261116_califa_colaboradores_pre_vinculos` (snapshot da tabela).

Após essa migration: todo colaborador ativo tem 1 vínculo ativo igual ao estado atual. **Nenhuma férias regenerada ainda** porque o `fn_gerar_ferias_periodos` ainda não foi atualizado.

### Migration 3 — Trigger de férias usando vínculo (`20261116100003_vinculos_ferias_trigger.sql`)

- `CREATE OR REPLACE FUNCTION fn_gerar_ferias_periodos` substituindo `NEW.data_admissao` por `fn_data_base_ferias(NEW.id, NEW.data_admissao)`.
- Ajustar lógica interna: aquisitivos com `aquisitivo_inicio < data_base` são marcados como `pago_rescisao` em vez de deletados.
- Criar `fn_vinculo_regenera_ferias` + trigger em `colaborador_vinculos`.
- Criar `fn_colab_sincroniza_tipo_do_vinculo_ativo` + trigger em `colaborador_vinculos`.

**Primeira migration com impacto comportamental.** Mas como pra todos os colaboradores `vinculo_ativo.data_inicio == colaborador.data_admissao`, não há mudança prática — os aquisitivos existentes continuam válidos.

### Migration 4 — 4 casos de virada (`20261116100004_vinculos_viradas_4_casos.sql`)

Pra cada um dos 4 casos (nomes + UUIDs + datas no handoff da sessão, não aqui por PII):

```sql
-- 1. Encerrar o vínculo ativo atual com motivo e data_fim = dia anterior à virada
update colaborador_vinculos
   set data_fim = '<data virada - 1>',
       motivo_encerramento = 'rescisao_clt_para_novo_vinculo',
       updated_at = now()
 where colaborador_id = '<uuid>' and data_fim is null;

-- 2. Criar o vínculo novo ativo com data_inicio = data da virada
insert into colaborador_vinculos (
  tenant_id, colaborador_id, tipo_contratacao, data_inicio,
  vinculo_anterior_id, created_by
)
values (
  '<tenant_califa>', '<uuid>', 'pj', '<data virada>',
  '<id_vinculo_anterior>', '<admin_id>'
);
```

Trigger dispara, regenera aquisitivos. Aquisitivos pré-virada viram `pago_rescisao`. Lançamentos antigos ficam preservados.

**Backup antes**: `_backup_20261116_califa_ferias_periodos_pre_viradas` + `_lancamentos`.

### Migration 5 — Nada (reservada se precisar correções)

Sem conteúdo. Placeholder caso aparecer ajuste pós-aplicação.

## 5. Tipos TypeScript (lib/types.ts)

Adicionar após `ColaboradorFerias*`:

```ts
export type VinculoMotivoEncerramento =
  | "rescisao_clt_para_novo_vinculo"
  | "demissao"
  | "pedido_demissao"
  | "fim_de_contrato"
  | "outro";

export interface ColaboradorVinculo {
  id: string;
  tenant_id: string;
  colaborador_id: string;
  tipo_contratacao: TipoContratacao;
  data_inicio: string;
  data_fim: string | null;
  motivo_encerramento: VinculoMotivoEncerramento | null;
  vinculo_anterior_id: string | null;
  observacao: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

## 6. Auditoria

Novos valores em `AuditAction` (`lib/auth/audit.ts`):

```ts
| "colaborador.vinculo_criado"
| "colaborador.vinculo_encerrado"
| "colaborador.vinculo_editado"
```

Gravado pelas migrations de virada (log manual) e pelas futuras actions da Fase 2.

## 7. Impacto em views e queries

**Impacto zero na Fase 1** porque:
- `colaboradores.tipo_contratacao` continua existindo, sincronizada com vínculo ativo.
- `colaboradores.data_admissao` continua sendo a admissão original — nenhuma query que lê essa coluna muda de comportamento (exceto `fn_gerar_ferias_periodos` que agora usa `fn_data_base_ferias` com fallback pra ela).

Fase 3 vai migrar queries pra ler de `colaborador_vinculos` diretamente. Lista preliminar do que vai ser tocado:
- `vw_people_aprovar_financeiro` (view do contas a pagar)
- `vw_dre_despesa_pessoal_ajustada_mensal`
- `lib/financeiro/colaboradores-pagamento.ts`
- Queries de folha mensal (`criarFolhaDaCompetencia` etc.)
- Queries de benefícios (`fn_beneficios_custo_mensal`)
- Página `/rh/colaboradores`, `/rh/ferias`, etc.

## 8. Checklist de aplicação (Fase 1)

Antes de rodar migration 4:

- [ ] Confirmar os 4 casos com RH + datas exatas.
- [ ] Rodar migrations 1–3 no Sandbox (`california-sandbox`).
- [ ] Validar que Quadro de Férias continua com os mesmos aquisitivos no Sandbox (nada mudou pra ninguém).
- [ ] Rodar migration 4 no Sandbox com os 4 casos.
- [ ] Validar pro caso principal escolhido: aquisitivo novo começa na data da virada, antigos viraram `pago_rescisao`.
- [ ] Repetir em prod.

## 9. Riscos conhecidos

- **R1 — Lançamentos antigos com `periodo_id` apontando pra aquisitivo que vira `pago_rescisao`**. Preservados — só muda o status do período, não deleta. Mas pode confundir em relatórios que agrupam por status.
- **R2 — Triggers em cascata**. Mudança em `colaborador_vinculos` dispara sincronização em `colaboradores`, que por sua vez já tem trigger `fn_gerar_ferias_periodos`. Possível loop ou dupla regeneração. Testar no Sandbox.
- **R3 — Backfill muito grande**. ~200 colaboradores, 1 insert cada. Rápido. Sem risco.
- **R4 — Overlap entre vínculos novos e migrados**. Migration 4 encerra vínculo com `data_fim = virada - 1`, novo vínculo começa em `virada`. Sem overlap por construção, mas testar.
