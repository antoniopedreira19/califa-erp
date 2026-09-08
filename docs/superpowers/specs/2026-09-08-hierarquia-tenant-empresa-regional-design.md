# Hierarquia tenant → empresa → regional

**Data:** 2026-09-08
**Autor:** Daniel (via Claude)
**Escopo:** modelagem de dados. Sem UI ainda (fase 2).

---

## Motivação

O organograma real da California é uma pirâmide de três níveis:

```
Ecossistema California (tenant)
├── Agência California (empresa)
│   ├── NE
│   ├── NO
│   ├── SP
│   ├── RJ
│   └── SS (São Sebastião)
├── CCH (empresa)
│   ├── Doca
│   └── Agency
└── Hitlab (empresa)
    └── Hitlab
```

O banco hoje modela **invertido**: a empresa é filha da regional (`empresas.regional_id NOT NULL`). Isso trava a operação porque só existe uma empresa "principal" e as regionais são coleção plana do tenant, sem noção de a qual empresa pertencem.

O objetivo é virar essa relação: **regional passa a ser filha de empresa**, empresa passa a ser filha direta do tenant.

---

## Estado atual (leitura do banco em 2026-09-08)

- `tenants`: 1 row — "Agência California" (id `d2a02c10-9c7e-4157-8dd5-84bbf5a7044c`)
- `empresas`: 2 rows
  - `304039bd-509d-4536-aa26-44e7091ee718` — razão "CALIFÓRNIA FILMES E PUBLICIDADE LTDA", fantasia "California", CNPJ 19437976000154, ativa
  - `a61067d9-b46b-40b0-8541-4850f13aa47c` — razão "HITLAB PRODUCAO MUSICAL LTDA", fantasia "Hitlab", CNPJ 04409741000181, ativa
- `regionais`: 2 rows
  - `54c627a6-e2d4-480b-9bd4-2f1acbf0ea91` — "NE"
  - `29b8e2d0-3fe9-4380-86b0-ede8299c2c32` — "SP"

Ambas as regionais existentes pertencem materialmente à empresa California (=Agência California) — foram criadas quando a Hitlab ainda não existia como operação separada.

**Tabelas que referenciam `empresas.id` (13):**
`cartoes_credito`, `contas_avulsas`, `contas_avulsas_recorrentes`, `contas_bancarias`, `desembolsos`, `faturamentos`, `jobs`, `lancamentos_financeiros`, `orcamentos`, `pedidos_compra`, `pp_verba_devolucoes`, `projetos`, `titulos_receber`.

**Tabelas que referenciam `regionais.id` (8, contando `empresas`):**
`contas_avulsas_regionais`, `contas_avulsas_recorrentes_regionais`, `desembolsos_regionais`, `empresas`, `jobs`, `orcamentos`, `projeto_regionais`, `projetos`.

**Uso operacional em jobs/orcamentos/projetos:**
- `jobs`: 32/32 com empresa, 32/32 com regional
- `orcamentos`: 51/51 com empresa, 44/51 com regional (7 sem regional)
- `projetos`: 19/19 com empresa, 16/19 com regional (3 sem regional)

Ou seja: `regional_id` já é opcional em orçamentos e projetos. `empresa_id` é sempre preenchido.

---

## Decisões travadas

1. **Tenant continua se chamando "Agência California"** — é como o ecossistema é referido no dia a dia. Sem rename.
2. **CCH é empresa nova**, criada sem CNPJ (será preenchido depois). Demais campos obrigatórios de `empresas` (razão social, endereço) recebem placeholders explícitos que forcem preenchimento antes de uso operacional — ver seção "Placeholders da CCH".
3. **Todas as regionais são criadas na migration**, mesmo sem uso imediato:
   - Agência California: NE, NO, SP, RJ, SS
   - CCH: Doca, Agency
   - Hitlab: Hitlab
4. **Empresa Hitlab tem uma regional "Hitlab"** com o mesmo nome (é como a operação funciona: Hitlab não tem subdivisão regional real, mas o modelo obriga a existência de pelo menos uma regional pra manter o tripé consistente).
5. **`empresa_id` continua em `jobs`/`orcamentos`/`projetos`** (modelo denormalizado). Trigger no banco garante `job.empresa_id = regionais[job.regional_id].empresa_id`. Formulários filtram regional pela empresa selecionada — camada UX. Trigger é defesa em profundidade contra scripts, Server Actions diretas, edições parciais e bugs futuros de form.

---

## Modelo alvo

### Estrutura de tabelas

**`tenants`** — sem mudança.

**`empresas`** — `regional_id` **removido**. Empresa passa a ser filha direta do tenant.
- FK removida: `empresas.regional_id → regionais.id`
- Coluna `regional_id` removida.

**`regionais`** — ganha `empresa_id NOT NULL`.
- Nova coluna: `empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT`.
- Índice: `create index on regionais(empresa_id)`.
- Constraint de unicidade: `unique(empresa_id, nome)` — duas empresas podem ter regional "Hitlab" ou "SP", mas não a mesma empresa.

**`jobs`, `orcamentos`, `projetos`** — sem mudança estrutural. Continuam com `empresa_id` + `regional_id`. Ganham o trigger de consistência.

### Trigger de consistência empresa ↔ regional

```sql
create or replace function public.ck_empresa_bate_regional() returns trigger
language plpgsql as $$
declare
  v_empresa_da_regional uuid;
begin
  if new.regional_id is null then
    return new;
  end if;

  select empresa_id into v_empresa_da_regional
    from public.regionais where id = new.regional_id;

  if v_empresa_da_regional is null then
    raise exception 'regional_id % nao existe', new.regional_id;
  end if;

  if new.empresa_id is not null and new.empresa_id <> v_empresa_da_regional then
    raise exception 'empresa_id % nao bate com a empresa da regional_id % (esperado %)',
      new.empresa_id, new.regional_id, v_empresa_da_regional;
  end if;

  -- Se empresa_id vier null mas houver regional, deriva a empresa automaticamente.
  if new.empresa_id is null then
    new.empresa_id := v_empresa_da_regional;
  end if;

  return new;
end;
$$;
```

Aplicado em `before insert or update` em `jobs`, `orcamentos`, `projetos`.

Efeitos:
- Se salvar linha com `empresa_id` e `regional_id` que não batem → erro do banco.
- Se salvar linha só com `regional_id` → banco preenche `empresa_id` sozinho.
- Se salvar linha só com `empresa_id` (sem regional) → passa (regional é opcional em orçamentos/projetos).

### Placeholders da CCH

Como `empresas` tem campos NOT NULL (`razao_social`, `cnpj`, `logradouro`, `cidade`, `uf`, `cep`), a inserção da CCH recebe:

- `razao_social` = `'CCH (a preencher)'`
- `nome_fantasia` = `'CCH'`
- `cnpj` = `'00000000000000'` (14 zeros — passa no `check` de formato `^[0-9]{14}$`, sem constraint de unicidade no CNPJ hoje, verificado)
- `logradouro` = `'a preencher'`, `cidade` = `'a preencher'` (sem check de formato)
- `cep` = `'00000000'` — 8 zeros, obrigatório pelo `check` `^[0-9]{8}$`
- `uf` = `'SP'` — passa no `check` `^[A-Z]{2}$`
- `principal` = `false`
- `ativo` = `false` — **CCH nasce inativa** para não aparecer em selects operacionais até que os dados reais sejam preenchidos.

Frontend futuro precisa tratar o caso "empresa ativo=false não aparece em combobox de novo job/orcamento".

---

## Backfill dos dados existentes

Ordem obrigatória (dentro de uma única transação `BEGIN…COMMIT`):

1. **Renomear `nome_fantasia` da empresa `304039bd-…`** de "California" para "Agência California". Razão social ("CALIFÓRNIA FILMES E PUBLICIDADE LTDA") **não muda** — é o nome legal.
2. **Criar empresa CCH** (placeholders acima). Como `empresas.regional_id` ainda existe e é NOT NULL, a inserção usa temporariamente a regional NE (`54c627a6-…`) — será dropada no passo 8.
3. **Adicionar `empresa_id` a `regionais`** (nullable no primeiro momento).
4. **Backfill de `regionais`**: as 2 existentes (NE, SP) apontam pra empresa `304039bd-…` (Agência California).
5. **Criar as regionais faltantes**, referenciando IDs por variáveis PL/pgSQL ou CTEs simples:
   - Agência California (`304039bd-…`): NO, RJ, SS
   - CCH (id novo, capturado do passo 2): Doca, Agency
   - Hitlab (`a61067d9-…`): Hitlab
6. **`alter table regionais alter column empresa_id set not null`**.
7. **Índice em `regionais(empresa_id)` e unique `(empresa_id, nome)`**.
8. **`alter table empresas drop column regional_id`** — destrutivo, confirmado por Daniel em 2026-09-08.
9. **Criar trigger de consistência** nas 3 tabelas (`jobs`, `orcamentos`, `projetos`).
10. **Dry-run do trigger no final da transação** — `update jobs set id=id; update orcamentos set id=id; update projetos set id=id;` só pra confirmar que todas as linhas existentes já são consistentes. Se alguma falhar, a transação inteira faz rollback e a migration aborta.

### Consistência das 32 linhas de jobs, 44 orçamentos com regional e 16 projetos com regional

Como hoje TODAS as regionais existentes pertencem à mesma empresa (a única com dado, "California" → renomeada "Agência California"), e todos os jobs/orçamentos/projetos com `empresa_id` preenchido também apontam pra essa empresa, o backfill fica consistente por construção. O trigger rodando em dry-run confirma isso.

---

## Migrations

Um único arquivo, prefixado com o número seguinte disponível (a checar via `list_migrations` na hora), nome sugerido:

```
supabase/migrations/AAAAMMDD000000_hierarquia_empresa_regional.sql
```

Estrutura interna do arquivo, com racional comentado no topo:

```sql
-- Motivo: inverter a relação empresa↔regional. Antes: empresa é filha de regional.
-- Agora: regional é filha de empresa; empresa é filha do tenant.
-- Ver docs/superpowers/specs/2026-09-08-hierarquia-tenant-empresa-regional-design.md
-- Destrutivo: remove empresas.regional_id (confirmado por Daniel em 2026-09-08).

begin;

-- IDs conhecidos (existentes hoje):
--   tenant Agência California: d2a02c10-9c7e-4157-8dd5-84bbf5a7044c
--   empresa California (→ vira Agência California): 304039bd-509d-4536-aa26-44e7091ee718
--   empresa Hitlab: a61067d9-b46b-40b0-8541-4850f13aa47c
--   regional NE: 54c627a6-e2d4-480b-9bd4-2f1acbf0ea91
--   regional SP: 29b8e2d0-3fe9-4380-86b0-ede8299c2c32

-- 1. Rename só do nome_fantasia da empresa California → Agência California.
--    razao_social e cnpj (nome legal) ficam intactos.
update public.empresas
   set nome_fantasia = 'Agência California'
 where id = '304039bd-509d-4536-aa26-44e7091ee718';

-- 2. Criar empresa CCH. Como empresas.regional_id ainda existe e é NOT NULL,
--    preenche temporariamente com NE — coluna é dropada no passo 8.
do $mig$
declare v_cch uuid := gen_random_uuid();
begin
  insert into public.empresas (
    id, tenant_id, razao_social, nome_fantasia, cnpj,
    logradouro, cidade, uf, cep,
    principal, ativo, regional_id
  ) values (
    v_cch, 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
    'CCH (a preencher)', 'CCH', '00000000000000',
    'a preencher', 'a preencher', 'SP', '00000000',
    false, false, '54c627a6-e2d4-480b-9bd4-2f1acbf0ea91'
  );

  -- 3. regionais.empresa_id nullable
  alter table public.regionais
    add column empresa_id uuid references public.empresas(id) on delete restrict;

  -- 4. Backfill: NE e SP viram filhas da Agência California
  update public.regionais
     set empresa_id = '304039bd-509d-4536-aa26-44e7091ee718'
   where empresa_id is null;

  -- 5. Regionais faltantes
  insert into public.regionais (id, tenant_id, nome, empresa_id, ativo) values
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'NO', '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'RJ', '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'SS', '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Doca',   v_cch, true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Agency', v_cch, true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Hitlab', 'a61067d9-b46b-40b0-8541-4850f13aa47c', true);
end
$mig$;

-- 6. Fechar empresa_id como NOT NULL
alter table public.regionais alter column empresa_id set not null;

-- 7. Unicidade (empresa, nome) e índice na FK
create unique index if not exists idx_regionais_empresa_nome on public.regionais(empresa_id, nome);
create index if not exists idx_regionais_empresa on public.regionais(empresa_id);

-- 8. Destrutivo: remover empresas.regional_id (não faz mais sentido no modelo novo)
alter table public.empresas drop column regional_id;

-- 9. Trigger de consistência empresa↔regional
create or replace function public.ck_empresa_bate_regional() returns trigger
language plpgsql as $$
declare v_empresa uuid;
begin
  if new.regional_id is null then return new; end if;
  select empresa_id into v_empresa from public.regionais where id = new.regional_id;
  if v_empresa is null then raise exception 'regional_id % nao existe', new.regional_id; end if;
  if new.empresa_id is not null and new.empresa_id <> v_empresa then
    raise exception 'empresa_id % nao bate com regional_id % (esperado %)',
      new.empresa_id, new.regional_id, v_empresa;
  end if;
  if new.empresa_id is null then new.empresa_id := v_empresa; end if;
  return new;
end $$;

create trigger tr_jobs_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.jobs
  for each row execute function public.ck_empresa_bate_regional();

create trigger tr_orcamentos_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.orcamentos
  for each row execute function public.ck_empresa_bate_regional();

create trigger tr_projetos_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.projetos
  for each row execute function public.ck_empresa_bate_regional();

-- 10. Dry-run: confirma que todas as linhas existentes já são consistentes.
--     Se alguma falhar, a transação toda faz rollback.
update public.jobs       set id=id;
update public.orcamentos set id=id;
update public.projetos   set id=id;

commit;
```

**Conferência pós-aplicação (passo 4 do FLUXO-BANCO):**
- `select count(*) from empresas` = 3 (Agência California, CCH, Hitlab)
- `select count(*) from regionais` = 8 (NE, NO, SP, RJ, SS, Doca, Agency, Hitlab)
- `select empresa_id from regionais where empresa_id is null` = 0 rows
- `information_schema.columns` sem `empresas.regional_id`
- Trigger presente nos 3 targets: `select tgname from pg_trigger where tgname like 'tr_%_empresa_bate_regional'` = 3 rows
- **Teste do trigger**: `update jobs set empresa_id = <id_da_cch> where id = <um_job>` deve dar exceção (a regional do job é da Agência).
- Advisors: `get_advisors` sem novo alerta apontando pras 3 tabelas.

---

## Impacto no TypeScript (`lib/types.ts`)

Ajustes no mesmo commit da migration:

- `Empresa`: remover propriedade `regional_id`.
- `Regional`: adicionar `empresa_id: string`.
- `Job`, `Orcamento`, `Projeto`: sem mudança de tipo (colunas continuam existindo).

Ver `lib/types.ts` e ajustar cada interface. Nada compila fora disso — grep por `regional_id` em `app/empresas/**` pra confirmar que não sobra referência a `empresa.regional_id`.

---

## Impacto na UI (fora do escopo desta migration; documentar pra fase 2)

- **Combobox de empresa** no filtro top-bar / novo job / novo orcamento / novo projeto: passa a listar 3 empresas (Agência California, CCH, Hitlab). CCH aparece só se `ativo=true`; enquanto inativa, é invisível pro usuário operacional.
- **Combobox de regional** em todos os formulários citados: fica **dependente da empresa** — se empresa não escolhida, combobox desabilitado; se escolhida, lista só as regionais daquela empresa. Ao trocar empresa, limpa o valor de regional.
- **Filtros de dashboard financeiro** (`/financeiro/*`): filtro por empresa continua funcionando via `jobs.empresa_id` etc, sem join. Filtro por regional passa a poder ser combinado com o filtro por empresa (redundância dá conforto).
- **Cadastro de empresas**: tela existente perde o campo "regional" (era 1-pra-1 antigamente).
- **Cadastro de regionais**: tela existente (se houver) passa a exigir escolha de empresa.

Nada disso entra na migration desta task. É lista de itens que a próxima entra:
`docs/superpowers/plans/2026-09-08-hierarquia-empresa-regional-frontend-plan.md` (a criar na fase 2 com writing-plans).

---

## RLS e permissões

Nenhuma tabela nova. `regionais` e `empresas` já têm RLS. O acréscimo de `empresa_id` em `regionais` não muda a superfície de segurança — a policy existente já filtra por `tenant_id`. Empresa e regional são visíveis a todos os membros do tenant que já podiam ler essas tabelas.

Se no futuro quisermos limitar operador da CCH a ver só dados da CCH, essa é decisão de outra task (permissões por empresa). **Fora de escopo aqui.**

---

## Auditoria

A migration é infraestrutura, então não gera `audit_events` por linha. Mas o commit e o arquivo em `supabase/migrations/` são o registro histórico canônico — é o que o `docs/FLUXO-BANCO.md` chama de "história completa do banco".

---

## Riscos e mitigação

- **Risco: alguém tem uma tela em rascunho local que ainda usa `empresas.regional_id`.**
  Mitigação: grep no repo antes de aplicar. Se aparecer, arruma no mesmo commit.
- **Risco: script externo (não versionado) grava direto em `jobs` ignorando o trigger.**
  Mitigação: trigger é `BEFORE INSERT OR UPDATE`, sem `EXCEPT` — passa por qualquer client (Server Action, MCP, psql). Não tem escapatória.
- **Risco: no futuro, alguém precisar de um job "corporativo" sem regional.**
  Mitigação: `regional_id` já é nullable. Trigger aceita null. Passa direto.
- **Risco: CCH inserida sem CNPJ acaba sendo usada por engano.**
  Mitigação: `ativo=false`. Frontend filtra `ativo=true` no combobox.

---

## Fora de escopo (fase 2 ou depois)

- Reescrita das telas de combobox empresa→regional em cascata.
- Cadastro visual de empresas/regionais (CRUD com wizard).
- Permissões por empresa (usuário X só vê dados da empresa Y).
- Migração de CNPJ e endereço real da CCH.
- Renomeação semântica no docs (o texto do CLAUDE.md e outros ainda fala em "tenant Agência California" — permanece correto).

---

## Aditamento A1 (aplicado em 2026-09-08 durante a execução)

O `apply_migration` original falhou porque `empresas.regional_id` tinha
dependência escondida: a view `vw_fluxo_caixa` (e a dependente
`vw_fluxo_caixa_job_totais`) usava o padrão
`COALESCE(job.regional_id, empresa.regional_id)` em quatro pontos, tratando
a regional da empresa como fallback para lançamentos/contas/títulos sem job.

No modelo novo esse fallback deixa de existir — empresa é pai de várias
regionais, "regional da empresa" não faz mais sentido semântico. Daniel
observou que a correção real é tornar `regional_id` uma coluna direta
nessas tabelas.

**Ruling A1 (Daniel, 2026-09-08):**

1. Adicionar coluna `regional_id uuid nullable` com FK para `regionais(id)`
   em `contas_avulsas`, `lancamentos_financeiros` e `titulos_receber`.
   Índice em cada FK.
2. Backfill preservando o comportamento da view atual:
   - `contas_avulsas`: pega a regional do rateio único (14/14 rows têm
     rateio de 1 linha em `contas_avulsas_regionais`).
   - `lancamentos_financeiros`: `COALESCE(job.regional_id,
     rateio_via_avulsa.regional_id, NE)`. Os 19 lançamentos sem job nem
     rateio ficam com NE (`54c627a6-…`) — mesma regional que a Agência
     California apontava no fallback antigo.
   - `titulos_receber`: NE direto (todos os 4 títulos existentes são da
     Agência California).
3. Recriar `vw_fluxo_caixa` sem o fallback — os quatro
   `COALESCE(x.regional_id, e.regional_id)` viram
   `COALESCE(x.regional_id, alvo.regional_id)` (alvo = a própria tabela
   avulsa/lancamento/titulo). `LEFT JOIN empresas e ON e.id = ...` sai
   dos CTEs afetados.
4. Recriar `vw_fluxo_caixa_job_totais` com texto idêntico ao atual —
   ela só agrega valores, não usa `regional_id` direto, mas precisa ser
   redeclarada porque depende de `vw_fluxo_caixa`.
5. Manter `regional_id` nullable nas 3 tabelas por enquanto. Torná-lo
   NOT NULL só depois da UI cascata (fase 2 — o operador vai ser
   obrigado a escolher regional na criação do lançamento sem job).
6. `GRANT SELECT` explícito para `authenticated` nas duas views
   recriadas — o `create view` puro não herda os grants antigos.
7. `SET search_path = public` na função `ck_empresa_bate_regional` para
   fechar o WARN do advisor `function_search_path_mutable`.

O aditamento está integrado na migration `20260908000001` — nada foi
resolvido "por fora". Ver `.superpowers/sdd/2026-09-08-hierarquia-empresa-regional/progress.md`
para a linha do tempo detalhada da decisão.

**Fica de fora deste aditamento (segue para fase 2):**
- Torne `regional_id` NOT NULL nas 3 tabelas quando a UI passar a exigir.
- Reavaliar os 19+4 registros que herdaram NE por convenção — o
  operador pode querer editar quando a UI cascata estiver pronta.

---

## Checklist de aplicação

1. `list_migrations` no MCP pra pegar próximo número.
2. Criar arquivo em `supabase/migrations/`.
3. Grep `regional_id` no repo pra descobrir tudo que precisa mudar em conjunto (`lib/types.ts`, telas de cadastro de empresas).
4. `apply_migration` via `supabase-write`.
5. Conferir os 6 pontos da seção "Conferência pós-aplicação".
6. Atualizar `lib/types.ts`.
7. Commit único: migration + tipos + eventuais ajustes de tela que ficaram quebrados.
8. Push. Fim desta task; UI cascata vai pra próxima.
