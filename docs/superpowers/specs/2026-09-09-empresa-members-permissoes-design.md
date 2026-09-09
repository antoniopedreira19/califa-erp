# Fase 2B — Permissão por empresa e regional (`empresa_members`)

**Data:** 2026-09-09
**Autor:** Daniel (via Claude)
**Escopo:** modelagem de dados + RLS em 13 tabelas + UI em `/admin/usuarios` + trigger de convite + refactor do session context.
**Depende de:** Fase 2A (multi-select empresa ativa) + hierarquia empresa→regional já em prod.
**Não substitui:** `tenant_members` continua sendo o vínculo pessoa↔tenant + role global.

---

## Motivação

Hoje todo membro do tenant vê **todas** as empresas do grupo. Isso funciona pro time atual (~24 usuários), mas viola o princípio de que a operação da CCH não precisa (nem deve) enxergar a Hitlab, e vice-versa. A Fase 2A entregou a UI de filtro empresa/regional, mas a permissão real ainda é ilimitada.

Fase 2B fecha isso: cada usuário passa a ter **acesso explícito** a um subconjunto de empresas do tenant, e opcionalmente pode ser restringido a regionais específicas dentro de uma empresa.

## Decisões travadas (por Daniel em 2026-09-09)

1. **Modelo:** uma tabela só, `empresa_members(user_id, empresa_id, regional_id nullable)`. `regional_id=NULL` = todas as regionais da empresa. Múltiplas linhas = restrição a regionais específicas.
2. **Backfill inicial:** amplo. Todo usuário existente (viewer/operator) ganha 1 linha por empresa ativa com `regional_id=NULL`. Comportamento no dia 1 é idêntico ao de hoje.
3. **Admin bypassa:** `tenant_members.role='administrador'` **ignora** `empresa_members` inteiramente. Admin sempre vê tudo. Regra permanente.
4. **Freelancer/Produtor AND:** as regras existentes (escopo por projeto) somam com `empresa_members`. Só vê projeto se estiver associado E se tiver acesso à empresa dele. Nenhuma regra anula a outra.
5. **Restrição por regional aplica só em tabelas com `regional_id` próprio.** Contas bancárias, cartões, faturamentos, pp_verba_devolucoes, plano de contas etc — que pertencem à empresa inteira, não a uma regional — são filtradas só por empresa.
6. **UX de edição:** só na tela `/admin/usuarios` (drawer do user ganha seção "Acesso a empresas").
7. **UX de leitura na empresa:** linha resumo "N usuários com acesso · Ver detalhes" no rodapé do card em `/admin/empresas`. Clique abre modal read-only com lista + link "Editar" que leva ao drawer do user.
8. **Convite:** drawer de convidar ganha seção "Acesso a empresas" com radio (Todas / Personalizado). Default = Todas. Permissões pré-configuradas são aplicadas via metadata + trigger quando o convite é aceito.

## Estado atual (leitura)

- `tenant_members`: 24 rows (viewer/operator/admin do único tenant Agência California).
- `empresas`: 4 rows ativas (Agência California, CCH, Empresa Teste, Hitlab).
- `regionais`: 8 rows ativas (NE, NO, RJ, SP, SS na Agência; Doca, Agency na CCH; Hitlab na Hitlab).
- `profiles`: 24 rows correspondentes aos tenant_members.
- Nenhuma tabela `empresa_members`, `regional_members` ou similar.

## Modelo alvo

### Tabela nova

```sql
create table public.empresa_members (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  regional_id  uuid null references public.regionais(id) on delete cascade,
  status       public.tenant_member_status not null default 'ativo',
  created_by   uuid null references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Não pode duplicar (user + empresa + regional). NULL é tratado como
  -- valor distinto — user pode ter 1 linha (empresa, NULL) OU N linhas
  -- (empresa, regional_X). Uma constraint separada (abaixo) impede as
  -- duas ao mesmo tempo.
  unique nulls not distinct (user_id, empresa_id, regional_id)
);

-- Integridade: regional pertence à empresa da linha (mesmo empresa_id)
create or replace function public.ck_empresa_members_regional_bate_empresa()
returns trigger language plpgsql set search_path = public as $$
declare v_empresa uuid;
begin
  if new.regional_id is null then return new; end if;
  select empresa_id into v_empresa from public.regionais where id = new.regional_id;
  if v_empresa <> new.empresa_id then
    raise exception 'regional_id % pertence a empresa % , nao a % (empresa_id)',
      new.regional_id, v_empresa, new.empresa_id;
  end if;
  return new;
end $$;

create trigger tr_empresa_members_regional_bate
  before insert or update of empresa_id, regional_id on public.empresa_members
  for each row execute function public.ck_empresa_members_regional_bate_empresa();

-- Integridade: por (user, empresa), OU tem linha com regional=NULL (acesso amplo)
-- OU tem N linhas com regional preenchida (restrito). Nunca as duas.
create or replace function public.ck_empresa_members_amplo_xor_restrito()
returns trigger language plpgsql set search_path = public as $$
declare v_amplo int; v_restrito int;
begin
  select
    count(*) filter (where regional_id is null),
    count(*) filter (where regional_id is not null)
  into v_amplo, v_restrito
  from public.empresa_members
  where user_id = new.user_id and empresa_id = new.empresa_id;

  if v_amplo > 0 and v_restrito > 0 then
    raise exception 'user % empresa %: nao pode ter acesso amplo (regional NULL) e restrito ao mesmo tempo',
      new.user_id, new.empresa_id;
  end if;
  return new;
end $$;

create trigger tr_empresa_members_amplo_xor_restrito
  after insert or update on public.empresa_members
  for each row execute function public.ck_empresa_members_amplo_xor_restrito();

-- Índices para RLS e queries
create index idx_empresa_members_user_empresa
  on public.empresa_members(user_id, empresa_id);
create index idx_empresa_members_user_status
  on public.empresa_members(user_id) where status = 'ativo';
create index idx_empresa_members_empresa_status
  on public.empresa_members(empresa_id) where status = 'ativo';
```

### Regra semântica canônica

**"User X pode ver dado da empresa E, regional R?"** (R pode ser null pra tabelas sem regional):

```
IF user tem tenant_members.role='administrador' no tenant → TRUE (bypass)

acessa_empresa := EXISTS(
  SELECT 1 FROM empresa_members
  WHERE user_id = X AND empresa_id = E AND status = 'ativo'
)

IF NOT acessa_empresa → FALSE

IF R IS NULL (tabela sem regional, ex: contas_bancarias)
  → TRUE (já passou empresa)

-- Tem regional na linha. Verifica se user tem acesso amplo OU específico:
tem_amplo := EXISTS(
  SELECT 1 FROM empresa_members
  WHERE user_id = X AND empresa_id = E AND regional_id IS NULL AND status = 'ativo'
)
IF tem_amplo → TRUE

tem_essa_regional := EXISTS(
  SELECT 1 FROM empresa_members
  WHERE user_id = X AND empresa_id = E AND regional_id = R AND status = 'ativo'
)
IF tem_essa_regional → TRUE

ELSE → FALSE
```

Essa regra vira função SQL `can_access_empresa_regional(u, e, r)` reusada em RLS e code.

### Helpers no banco (reutilizáveis)

```sql
-- Retorna as empresas que o user pode ver (bypass ou membership ativo)
create or replace function public.empresas_visiveis_do_user(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  -- Admin do tenant: vê TODAS as empresas ativas dos tenants a que pertence
  select e.id from public.empresas e
  join public.tenant_members tm on tm.tenant_id = e.tenant_id
  where tm.user_id = p_user_id
    and tm.role = 'administrador'
    and tm.status = 'ativo'
    and e.ativo = true
  union
  -- Demais: por membership explícita
  select distinct em.empresa_id from public.empresa_members em
  where em.user_id = p_user_id and em.status = 'ativo';
$$;

-- Retorna { empresa_id, regional_id? } — se regional_id null pra uma empresa,
-- o user tem acesso a todas regionais dela.
create or replace function public.regionais_visiveis_do_user(p_user_id uuid)
returns table(empresa_id uuid, regional_id uuid)
language sql stable security definer set search_path = public as $$
  -- Admin: pares (empresa, cada regional dela) — resulta em "vê tudo"
  select e.id, r.id from public.empresas e
  join public.tenant_members tm on tm.tenant_id = e.tenant_id
  left join public.regionais r on r.empresa_id = e.id and r.ativo = true
  where tm.user_id = p_user_id
    and tm.role = 'administrador'
    and tm.status = 'ativo'
    and e.ativo = true
  union
  -- Membership amplo: pares (empresa, cada regional dela)
  select em.empresa_id, r.id
  from public.empresa_members em
  left join public.regionais r on r.empresa_id = em.empresa_id and r.ativo = true
  where em.user_id = p_user_id
    and em.status = 'ativo'
    and em.regional_id is null
  union
  -- Membership restrito: pares exatos
  select em.empresa_id, em.regional_id
  from public.empresa_members em
  where em.user_id = p_user_id
    and em.status = 'ativo'
    and em.regional_id is not null;
$$;
```

Nenhuma dessas funções é chamada dentro do hot path das telas normais — o session context materializa e cacheia. Elas existem pra RLS e pra APIs administrativas.

Além delas, uma função **escalar** de checagem direta, usada nas policies RLS:

```sql
create or replace function public.can_access_empresa_regional(
  p_user_id uuid,
  p_empresa_id uuid,
  p_regional_id uuid  -- pode ser null (tabela sem regional)
)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- Bypass admin do tenant
    exists(
      select 1 from public.tenant_members tm
      join public.empresas e on e.tenant_id = tm.tenant_id
      where tm.user_id = p_user_id
        and tm.role = 'administrador'
        and tm.status = 'ativo'
        and e.id = p_empresa_id
    )
    or
    -- Membership à empresa
    exists(
      select 1 from public.empresa_members em
      where em.user_id = p_user_id
        and em.empresa_id = p_empresa_id
        and em.status = 'ativo'
        and (
          -- Tabela sem regional próprio: só precisa da empresa
          p_regional_id is null
          -- Acesso amplo (regional_id NULL na membership)
          or em.regional_id is null
          -- Acesso específico a essa regional
          or em.regional_id = p_regional_id
        )
    );
$$;
```

## RLS nas 13 tabelas com `empresa_id`

Regra a aplicar em cada policy `select`:

**Tabelas SEM `regional_id` próprio** (contas_bancarias, cartoes_credito, faturamentos, pp_verba_devolucoes, plano_contas_tipos, plano_contas_subtipos, ...):

```sql
using (
  can_access_empresa_regional(auth.uid(), empresa_id, null)
)
```

**Tabelas COM `regional_id` próprio** (jobs, orcamentos, projetos, contas_avulsas, lancamentos_financeiros, titulos_receber):

```sql
using (
  can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
)
```

Pra jobs/orcamentos/projetos com regra de freelancer/produtor existente — combina com AND:

```sql
using (
  can_access_empresa_regional(auth.uid(), empresa_id, regional_id)
  and (
    -- regra existente do freelancer/produtor
    case session_role() when 'freelancer' then is_freelancer_do_projeto(projeto_id)
                        else true end
  )
)
```

`can_access_empresa_regional` já embute o bypass do admin, então não precisa mais chamar `is_tenant_admin` na policy.

**Não muda:** policies `insert`/`update`/`delete` seguem o padrão atual (com o mesmo predicado).

## Session context — materialização (performance)

`lib/auth/session.ts` ganha 2 campos novos derivados dos helpers acima:

```ts
export interface SessionContext {
  // ... existentes
  /** Empresas que este user pode ver (permitidas). Substitui `empresas` na
   *  maioria dos consumers de tela; `empresas` (todas do tenant) fica
   *  apenas pra admin gerenciar. */
  empresasVisiveis: Empresa[];
  /** Por empresa, quais regionais o user pode ver. Se um id aparece com
   *  valor "all", tem acesso amplo; senão, é o array literal. */
  regionaisVisiveisPorEmpresa: Map<string, "all" | string[]>;
}
```

`loadSession()` faz 1 query (`empresa_members` ativas do user), aplica bypass do admin, e monta as duas estruturas em memória.

**Cache:** `unstable_cache` com TTL 5 min + tag `user-permissions:{userId}`. Invalidado pelas actions em `/admin/usuarios` ao mexer em `empresa_members`.

**Custo:** +30ms na primeira request de cada 5 min por user. Cache hit = 0ms.

## UX

### `/admin/usuarios` — drawer do user

Ganha seção nova, abaixo de "Papel no tenant":

```
┌─ Acesso a empresas ────────────────────────┐
│                                             │
│  ○ Todas as empresas do tenant             │
│  ○ Personalizado ← (mostra lista abaixo)   │
│                                             │
│  Se "Personalizado":                        │
│                                             │
│    ☑ Agência California                     │
│       Regionais: [Todas ▼]  ou  [NE, SP ▼] │
│                                             │
│    ☐ CCH                                    │
│                                             │
│    ☑ Hitlab                                 │
│       Regionais: [Todas ▼]                  │
│                                             │
└─────────────────────────────────────────────┘
```

- Radio: "Todas" = 1 linha por empresa ativa com `regional_id=NULL` (auto-atualizado se admin adicionar nova empresa depois — via trigger).
  Alternativa mais simples: "Todas" = flag no `tenant_members` (não em empresa_members), evitando desatualização. **Decisão: mesma tabela, sem flag. Se admin criar empresa nova, users com "Todas" NÃO ganham acesso automático — é decisão dele adicionar.** Motivo: previsibilidade > conveniência.
- "Personalizado": checkboxes por empresa. Ao marcar empresa, aparece sub-dropdown de regionais (`Checkbox` do shadcn ou `MultiSelect`). Vazio no sub-dropdown = "Todas" (linha com `regional_id=NULL`).

Salvar: diff calcula linhas a criar, atualizar, deletar em `empresa_members`.

### `/admin/empresas` — card

Rodapé de cada card ganha 1 linha resumo:

```
👥 4 usuários com acesso · Ver detalhes →
```

Clique abre modal read-only:

```
┌─ Quem tem acesso a CCH ─────────┐
│  🟢 Daniel Gedeon · Todas       │
│  🟢 Débora Brito · Regional Doca│
│  🟢 Antônio Pedreira · Todas    │
│  🟢 Rafael · Regional Agency    │
│                                  │
│  [ Editar acesso em Usuários → ]│
└──────────────────────────────────┘
```

Sem edição direta aqui — mantém uma fonte-verdade.

### `/admin/usuarios` — drawer de convidar

Ganha a mesma seção "Acesso a empresas" acima do botão de envio. Default: radio "Todas".

## Convite — aplicação após aceitação

Fluxo:

1. Admin preenche drawer de convite + seção "Acesso a empresas".
2. Server action envia convite via `supabase.auth.admin.inviteUserByEmail(email, { data: { permissoes: ... } })`.
   - `data` (JSONB metadata) carrega a intenção. Ex: `{ escopo_empresas: "todas" }` ou `{ escopo_empresas: [{empresa_id: X, regionais: ["all"] | [uuid1, uuid2]}, ...] }`.
3. User aceita e cria conta. Trigger `handle_new_user` já existe pra criar `profile` + `tenant_members`. É **estendido** pra ler `raw_user_meta_data.permissoes` e criar as linhas em `empresa_members`.
4. Trigger é idempotente: se falhar em qualquer parte, faz rollback do INSERT do user (bloqueia criação).

Metadata é limpo depois da aplicação.

## Backfill de compat

Migration inclui:

```sql
insert into public.empresa_members (tenant_id, user_id, empresa_id, regional_id, status, created_by)
select
  tm.tenant_id,
  tm.user_id,
  e.id,
  null,
  'ativo',
  null
from public.tenant_members tm
join public.empresas e on e.tenant_id = tm.tenant_id and e.ativo = true
where tm.status = 'ativo'
  and tm.role in ('financeiro', 'produtor', 'freelancer', 'gerente_producao')
  -- Admin não precisa (bypass permanente)
on conflict do nothing;
```

Depois desse INSERT, todo user vê tudo (comportamento igual ao pré-migration).

## Consumers das telas

Cada `page.tsx` que hoje faz `.in("empresa_id", session.activeEmpresas.map(...))`:

- **Antes:** `activeEmpresas` era subset de `empresas` (todas do tenant).
- **Depois:** `activeEmpresas` é subset de `empresasVisiveis` (permitidas). O user nunca pode "escolher" empresa que não tem permissão de ver, então a UI já filtra o dropdown.

**Regra do dropdown de empresa ativa:**

- Se `empresasVisiveis.length === 1`: badge não-clicável (igual hoje quando `empresas.length === 1`).
- Se `>= 2`: multi-select com `empresasVisiveis` (não `empresas`).
- Cookie `active_empresa_ids` é sanitizado no `loadSession`: ids que não estão em `empresasVisiveis` são ignorados.

**Filtro em queries com `regional_id`:**

Onde hoje há `.in("empresa_id", ...)`, quando a tela toca em tabela com regional (ex: `contas_avulsas`), adicionar filtro complementar por regionais visíveis. RLS já cobre — mas cliente filtrar economiza round-trip de dados que RLS ia recusar.

## Aud`itoria

Cada mudança em `empresa_members` gera `audit_events`:
- `empresa_member.criado`
- `empresa_member.atualizado` (mudança de escopo amplo↔restrito)
- `empresa_member.removido`
- `empresa_member.status_alterado`

Metadata: user_id afetado, empresa_id, regional_id, ator (admin que fez), escopo antes/depois.

## Migração e ordem

1. **Migration 1** — cria `empresa_members` + índices + funções + triggers.
2. **Migration 2** — backfill de compat (todo user existente ganha acesso amplo).
3. **Migration 3** — RLS nas 13 tabelas (usa as funções). Zero regressão porque backfill garante que ninguém perde acesso.
4. **Migration 4** — extensão do trigger `handle_new_user` para aplicar metadata de convite.
5. **Frontend:** `loadSession` ganha `empresasVisiveis` e `regionaisVisiveisPorEmpresa` + cache.
6. **Frontend:** telas migram `session.empresas` → `session.empresasVisiveis` no dropdown de empresa ativa e nos filtros de query.
7. **Frontend:** `/admin/usuarios` drawer ganha seção "Acesso a empresas".
8. **Frontend:** `/admin/usuarios` convite ganha mesma seção (metadata).
9. **Frontend:** `/admin/empresas` card ganha linha resumo + modal read-only.

Cada passo é independente e pode ser deployado separado. **Ordem crítica:** 1 → 2 → 3 (banco). 5 pode subir junto do 3 (session já materializa antes das UIs precisarem).

## Impacto de performance esperado

| Etapa | Custo hoje | Custo depois |
|---|---|---|
| `loadSession` empresas | 100ms (query) | 30ms (query + cache 5min) |
| `loadSession` permissões | 0 (n/a) | +30ms (query + cache 5min) |
| Filtro por empresa em cada tela | idem | idem (usa lista pré-carregada) |
| Query com RLS de empresa/regional | 0 overhead | +1-2ms (subquery com índice) |
| Total por request | ~250ms sessão | ~30-60ms sessão + 1-2ms/query |

Ganho líquido: **negativo** de 5-10ms na pior das hipóteses. **Zero** com cache quente. Imperceptível.

## Riscos e mitigação

- **Risco: admin cria empresa nova depois do backfill, users com "todas" NÃO ganham automaticamente.** Ruling: comportamento previsível > conveniência. Admin decide adicionar cada user manualmente. Documentado.
- **Risco: cache de 5 min pode fazer user com permissão nova esperar até 5 min pra ver a empresa.** Mitigação: `revalidateTag` na action já invalida na hora. Só afeta caso admin edite em outra aba/sessão.
- **Risco: trigger de convite falha por metadata malformado.** Mitigação: schema JSON validado antes do envio; trigger tem try/except que loga em `audit_events` sem quebrar a criação do user (permissões vazias, admin corrige depois).
- **Risco: freelancer com escopo por projeto + empresa_members criando estranheza.** AND puro: se admin bloqueou empresa Y, freelancer não vê projeto de Y mesmo estando no time. Documentar no fluxo do admin.

## Fora de escopo

- Convite bulk (múltiplos users de uma vez com mesmas permissões).
- Interface de auditoria de "quem mudou o quê em empresa_members".
- Notificação por e-mail quando permissão muda.
- Grupos/roles reutilizáveis (ex: "acesso CCH-Doca" como template). YAGNI.

## Checklist de execução

1. Migration `empresa_members` + funções + triggers + índices.
2. Migration backfill de compat.
3. Migration RLS nas 13 tabelas.
4. Migration extensão de `handle_new_user`.
5. `loadSession` materializa e cachea permissões.
6. Dropdown de empresa ativa passa a usar `empresasVisiveis`.
7. Cookie `active_empresa_ids` sanitiza contra `empresasVisiveis`.
8. `/admin/usuarios` drawer de edição.
9. `/admin/usuarios` drawer de convite (com metadata).
10. `/admin/empresas` card com linha resumo + modal.
11. Auditoria nas actions.
12. Teste manual: admin (vê tudo), viewer restrito a 1 empresa+1 regional, freelancer com AND.
