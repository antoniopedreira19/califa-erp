# Fase 2A — Cascata empresa→regional + empresa ativa no sidebar

**Data:** 2026-09-08
**Autor:** Daniel (via Claude)
**Escopo:** frontend + 1 migration curta de fechamento.
**Depende de:** hierarquia empresa→regional já aplicada (commits `ffe736d`, `857b9ad`).
**Sucessor:** Fase 2B — `empresa_members` + RLS por empresa (spec separado).

---

## Motivação

A migração da hierarquia entregou o modelo certo no banco (empresa é pai
de várias regionais), mas as telas de criação ainda tratam empresa e
regional como **combos independentes**. O operador pode escolher empresa
"CCH" e regional "NE" — o form deixa mandar, e só o trigger no banco
recusa (com erro cru).

Fase 2A entrega três coisas juntas, no mesmo pacote:

1. **Cascata empresa→regional em todos os forms** — o combo de regional
   fica desabilitado até o operador escolher empresa; ao escolher,
   lista só as regionais daquela empresa.
2. **Empresa ativa no sidebar** — dropdown ao lado do de tenant. Persiste
   em cookie. Forms nascem pré-preenchidos; listagens filtram por default;
   filtro na tela permite override pontual sem mexer no sidebar.
3. **`regional_id` NOT NULL nas 3 tabelas** (`contas_avulsas`,
   `lancamentos_financeiros`, `titulos_receber`) — fechamento do A1 da
   fase anterior, aplicado **depois** que a UI da (1) estiver estável
   e sem regressão.

Fase 2B — sistema de permissão (`empresa_members`, RLS) — fica para
outro spec/plan. Motivo: cada camada pode ser testada e revertida
independentemente. RLS mal escrita em 13 tabelas é o tipo de risco que
merece isolamento.

---

## Estado atual (leitura de 2026-09-08)

### Telas afetadas pela cascata

Levantamento de arquivos com Select de empresa e/ou regional:

| Tela | Arquivo | Regional hoje | Empresa hoje |
|---|---|---|---|
| Novo projeto | `app/(app)/orcamentos/novo/page.tsx` + `projeto-form.tsx` | MultiSelect aliadas + Select principal | Select |
| Editar projeto | idem, no mesmo `projeto-form.tsx` | idem | idem |
| Novo orçamento | `app/(app)/orcamentos/[projetoId]/novo/page.tsx` + `orcamento-form.tsx` | Select 1 regional (das do projeto) | herdada do projeto |
| Editar orçamento | idem | idem | idem |
| Abertura de job | `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/fluxo-abertura.tsx` | Select 1 (das do projeto) | herdada |
| Editor de job | `app/(app)/jobs/[jobId]/job-editor-drawer.tsx` | Select 1 | Select |
| Nova conta avulsa | `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx` + `rateio-regional-editor.tsx` | RateioRegionalEditor (N regionais + %) | Select |
| Nova conta recorrente | `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx` | RateioRegionalEditor | Select |
| Novo desembolso | `app/(app)/financeiro/desembolsos/desembolso-drawer.tsx` | RateioRegionalEditor | Select |
| Multi-jobs | `app/(app)/orcamentos/[projetoId]/multi/editor-multi-jobs.tsx` | Select 1 | herdada |
| Editar multi-jobs | idem | idem | idem |

### Zod schemas que já exigem regional_id

- `lib/validations/abertura-job.ts:76` — SelectOne.
- `lib/validations/conta-avulsa.ts:16` — rateio (schema `rateioSchema`).
- `lib/validations/desembolso.ts:9` — rateio (mesmo schema).
- `lib/validations/orcamentos.ts:39` — SelectOne, com nota "server action confere se é regional do projeto".

Nenhum dos schemas precisa mudar — a validação do dado que sobe já está OK.
Muda **como** a UI escolhe.

### Filtros de listagem que hoje têm dropdown de empresa/regional

- `app/(app)/financeiro/fluxo-caixa/page.tsx` — filtro empresa+regional.
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — filtro empresa.
- `app/(app)/financeiro/desembolsos/page.tsx` — filtro empresa.
- `app/(app)/orcamentos/page.tsx` — filtro empresa (talvez).
- `app/(app)/relatorios/rentabilidade/*` — filtros.

Todas precisam respeitar a **empresa ativa** por default e permitir override.

### Componentes que já existem e vou reusar

- `RateioRegionalEditor` (`app/(app)/financeiro/contas-a-pagar/rateio-regional-editor.tsx`) — recebe lista de regionais como prop e faz a UI de rateio. Não precisa reescrever. Passa a receber a lista **já filtrada pela empresa selecionada** no form pai.
- `MultiSelect` (`components/ui/multi-select.tsx`) — usado em projeto para regionais aliadas. Idem: passa a receber lista filtrada.
- `Select` do shadcn — todos os Selects de regional single value.
- `TenantContext` / `getSessionContext()` — padrão que a empresa ativa vai imitar.

### Cookie/context de tenant hoje

`app/lib/session.ts` (checar caminho exato durante implementação) — a
sessão retorna `{ user, activeTenant, tenants }`. `activeTenant` é
persistido em cookie. A empresa ativa vai seguir o mesmo padrão exato,
lado a lado.

---

## Decisões travadas

Todas confirmadas por Daniel em 2026-09-08.

1. **Cada projeto pertence a UMA empresa.** Regionais aliadas do projeto
   são todas da mesma empresa.
2. **Empresa ativa no sidebar** (Dropdown ao lado do de tenant), persistida
   em cookie. Forms nascem com essa empresa; filtros de listagem
   respeitam por default; filtro na tela permite override pontual.
3. **Rateio quando troca empresa:** dialog de confirmação "Trocar empresa
   vai limpar o rateio. Continuar?". Se confirma, limpa. Se cancela,
   mantém empresa antiga.
4. **Componente reutilizável** vive em `components/ui/select-empresa-regional.tsx`,
   recebe `empresas: EmpresaOption[]` e `regionais: RegionalOption[]` (as
   duas listas via prop). Filtra internamente.
5. **Empresa ativa global vive em cookie + Server Context** (padrão
   TenantContext). Não usa URL param pra estado global.
6. **Filtro na tela é override local** — passa a empresa via URL
   (`?empresa=X`), não mexe no cookie. Cookie continua com a "intenção
   do dia", URL param é o override daquela navegação.
7. **Fatiar 2A e 2B.** Fase 2A NÃO adiciona `empresa_members` nem RLS
   por empresa. Empresa ativa aparece com opção "Todas" pra todo mundo
   (comportamento igual ao de hoje).
8. **Migration NOT NULL vem no FIM da fase 2A**, num commit separado do
   pacote de UI, aplicado depois de 2-3 dias sem regressão.

---

## Modelo de mudanças

### Camada 1 — Session context ganha empresa ativa

Arquivo: `lib/session.ts` (ou equivalente — verificar durante implementação).

Antes:
```ts
type Session = {
  user: User;
  activeTenant: Tenant;
  tenants: Tenant[];
}
```

Depois:
```ts
type Session = {
  user: User;
  activeTenant: Tenant;
  tenants: Tenant[];
  activeEmpresa: Empresa | null;   // null = "Todas" (comportamento default hoje)
  empresas: Empresa[];             // todas ativas do tenant
}
```

Server action para trocar empresa ativa:
```ts
// app/actions/set-active-empresa.ts
export async function setActiveEmpresa(empresaId: string | null): Promise<void>
```

Grava cookie `active_empresa_id` (ou apaga se null). Server components leem
via `getSessionContext()`.

Cookie:
- Nome: `active_empresa_id`
- HttpOnly, SameSite=Lax, Secure em prod
- Sem expiração explícita (sessão)
- Valor: uuid da empresa OU vazio (representa "Todas")

### Camada 2 — Sidebar

Arquivo: `components/sidebar/sidebar.tsx` (verificar caminho durante
implementação).

Adiciona ao lado do dropdown de tenant:

- Se `empresas.length === 0` → não renderiza nada (não deve acontecer).
- Se `empresas.length === 1` → badge não-clicável com o nome da empresa
  (`ativa` = essa mesma; cookie preenchido silenciosamente).
- Se `empresas.length >= 2` → dropdown com:
  - "Todas as empresas" (grava cookie vazio)
  - Uma linha por empresa ativa

Ao trocar, chama `setActiveEmpresa()` e faz `router.refresh()` — todos os
server components rerodam com a nova ativa.

### Camada 3 — Componente reutilizável `SelectEmpresaRegional`

Arquivo: `components/ui/select-empresa-regional.tsx`.

Interface:
```ts
type EmpresaOption = { id: string; nome: string };
type RegionalOption = { id: string; nome: string; empresa_id: string };

type Props = {
  empresas: EmpresaOption[];
  regionais: RegionalOption[];    // TODAS do tenant; componente filtra por empresa selecionada
  empresaId: string | "";
  regionalId: string | "";
  onEmpresaChange: (id: string) => void;
  onRegionalChange: (id: string) => void;
  empresaLabel?: string;          // default "Empresa"
  regionalLabel?: string;         // default "Regional"
  required?: boolean;             // default true
  disabled?: boolean;
  errorEmpresa?: string;
  errorRegional?: string;
};
```

Regras internas:
- Combo de regional **disabled** enquanto `empresaId === ""`.
- Ao mudar empresa, limpa regionalId (chama `onRegionalChange("")`).
- Lista de regionais no combo = `regionais.filter(r => r.empresa_id === empresaId)`.

Uso típico numa tela:
```tsx
<SelectEmpresaRegional
  empresas={empresas}
  regionais={regionais}
  empresaId={empresaId}
  regionalId={regionalId}
  onEmpresaChange={setEmpresaId}
  onRegionalChange={setRegionalId}
  errorEmpresa={fieldErrors.empresa_id?.[0]}
  errorRegional={fieldErrors.regional_id?.[0]}
/>
```

### Camada 4 — Variante para rateio (MultiSelect e RateioRegionalEditor)

Não vai virar um novo componente — vai ser **adaptação nos consumidores**:

- `RateioRegionalEditor` já recebe `regionais` como prop. Passa a receber
  a lista **já filtrada** pela empresa do form pai (`regionais.filter(r
  => r.empresa_id === empresaIdSelecionada)`). Componente em si não
  muda.
- `MultiSelect` idem — a lista de items que sobe já vem filtrada pelo pai.

**Trocar empresa quando já tem rateio ou regionais MultiSelect com valor:**

Adição num helper local em cada drawer (avulsa, desembolso, projeto):

```tsx
const handleEmpresaChange = (novaEmpresa: string) => {
  if (rateio.length > 0 || regionaisAliadas.length > 0) {
    setPendingEmpresa(novaEmpresa);      // guarda a intenção
    setConfirmDialog(true);
  } else {
    setEmpresaId(novaEmpresa);
  }
};
```

Dialog usa o `<Dialog>` do shadcn:
> **Trocar empresa vai limpar o rateio.** As regionais escolhidas pertencem
> à empresa atual e não podem coexistir com a nova. Deseja continuar?
> [ Cancelar ] [ Confirmar ]

Se confirma: `setEmpresaId(pendingEmpresa)`, `setRateio([])`, fecha dialog.

### Camada 5 — Server components das telas afetadas

Cada `page.tsx` server component ganha um fetch extra em `Promise.all`:
```ts
supabase.from("empresas").select("id, nome_fantasia, razao_social").eq("tenant_id", session.activeTenant.id).eq("ativo", true),
supabase.from("regionais").select("id, nome, empresa_id").eq("tenant_id", session.activeTenant.id).eq("ativo", true),
```

Passa via prop para o form/drawer.

Se `session.activeEmpresa != null`, os forms de criação já nascem com
`empresaId = session.activeEmpresa.id`.

### Camada 6 — Filtros de listagem

Cada listagem que hoje tem filtro empresa:

- Lê `session.activeEmpresa` para calcular o **default** do filtro.
- Se o URL tem `?empresa=X`, esse valor sobrescreve o default (override
  local).
- Filtro renderizado na tela mostra a empresa vigente com badge "×"
  para voltar ao default (empresa ativa).

Query no server component:
```ts
const empresaFiltro = searchParams.empresa ?? session.activeEmpresa?.id ?? null;
const query = supabase.from("...").select("...").eq("tenant_id", ...);
if (empresaFiltro) query.eq("empresa_id", empresaFiltro);
```

### Camada 7 — Migration NOT NULL (fim da fase 2A)

Arquivo separado, aplicado 2-3 dias depois de todo o resto estar no ar
sem regressão. Nome sugerido:
`supabase/migrations/AAAAMMDD000001_regional_id_not_null.sql`

```sql
-- Fecha o loop do A1: agora que a UI exige regional em todas as telas
-- de criação, regional_id nas 3 tabelas passa a ser NOT NULL.
alter table public.contas_avulsas          alter column regional_id set not null;
alter table public.lancamentos_financeiros alter column regional_id set not null;
alter table public.titulos_receber         alter column regional_id set not null;
```

Antes de aplicar, `select count(*) from ... where regional_id is null`
para cada tabela — precisa dar 0. Se der > 0, é sinal de que a UI deixou
passar. Corrigir a UI, não abaixar a régua.

---

## Impacto no TypeScript

`Session` type ganha 2 campos (`activeEmpresa`, `empresas`). Nenhum outro
tipo muda — `Empresa` e `Regional` já foram atualizados na fase 1.

---

## Fluxo de escopo (imagem mental)

```
1. Operador abre novo lançamento
2. Se sidebar tem empresa ativa X:
   - form nasce com empresaId = X
   - combo de regional lista só regionais de X
3. Se sidebar = "Todas":
   - form nasce com empresa vazia
   - combo de regional disabled até escolher empresa
4. Operador troca empresa no form (override local):
   - se tem rateio/multiselect com valor → confirm dialog
   - se limpo → troca direto, regional/rateio zera
5. Submit:
   - server action valida (Zod já exige regional)
   - trigger do banco garante consistência empresa↔regional
```

---

## Riscos e mitigação

- **Risco: alguma tela existente monta o objeto sem passar por form
  (ex: importação de planilha).** Mitigação: grep por INSERT em
  `contas_avulsas`, `lancamentos_financeiros`, `titulos_receber` fora
  das telas listadas. Se aparecer, tratar caso a caso.
- **Risco: `router.refresh()` no sidebar não propaga o novo cookie a
  server components porque os componentes leem `getSessionContext()`
  antes do refresh.** Mitigação: o `refresh` do Next 14+ re-executa server
  components — testar em dev. Se falhar, uso `window.location.reload()`
  como fallback (ruim UX mas garante).
- **Risco: um projeto multi-empresa legado (não deveria existir, mas
  vale conferir) fica órfão.** Mitigação: `select p.id, count(distinct
  r.empresa_id) from projetos p join projeto_regionais pr on … join
  regionais r on r.id = pr.regional_id group by p.id having count(*) >
  1` — se retornar linha, tratar antes da migration NOT NULL.
- **Risco: CCH nasce inativa. Filtro `.eq("ativo", true)` em todo
  fetch de empresas para o sidebar/forms.** Já feito na fase 1;
  confirmar durante implementação.

---

## Fora de escopo (fase 2B ou depois)

- Tabela `empresa_members` e RLS por empresa.
- Tela de admin para atribuir empresas a usuários.
- Restringir sidebar dropdown pra "empresas que o user pode ver" (hoje
  todo mundo vê todas).
- CRUD de empresas (só a CCH será editada por SQL até a fase 3).
- CRUD de regionais (idem).

---

## Checklist de execução

1. Session context ganha `activeEmpresa` + `empresas`.
2. Server action `setActiveEmpresa`.
3. Sidebar renderiza dropdown de empresa.
4. Componente `SelectEmpresaRegional`.
5. Telas de criação (11 pontos listados em "Telas afetadas") passam a usar
   o componente + confirm dialog no caso de rateio.
6. Filtros de listagem respeitam empresa ativa.
7. `router.refresh()` no trocar empresa (teste em dev).
8. Grep final por `empresa_id` sem par `regional_id` — se acha, revisar.
9. Aguardar 2-3 dias sem regressão.
10. Migration NOT NULL nas 3 tabelas.
