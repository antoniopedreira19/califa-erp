# PageHeader unificado + Multi-select de empresas

**Data:** 2026-09-08
**Autor:** Daniel (via Claude)
**Escopo:** frontend (novo componente + migração de N telas) + 1 migration curta (índices) + refactor do session/cookie.
**Depende de:** Fase 2A (single-select empresa ativa) já mergeada.
**Substitui parcialmente:** a Fase 2A da sidebar (dropdown lá é removido).

---

## Motivação

Três problemas descobertos após entregar a Fase 2A:

1. **Dropdown na sidebar não funciona.** A sidebar colapsa por `mouseleave`. O `<SelectContent>` do Radix é portalizado no `<body>` — quando o operador move o mouse pra clicar em uma opção, sai do bounds do `<aside>`, `hovered=false`, o bloco `{expanded && ...}` desmonta o `<Select>`, e o dropdown fecha sozinho. É um problema estrutural do padrão hover+portal.

2. **Cabeçalhos das páginas divergiram.** `/orcamentos` tem botões (Novo, Categorias) na linha do título; `/desembolsos` tem botão em outra linha. Nenhuma foi projetada errada — cada uma nasceu isolada e divergiu naturalmente por não haver componente compartilhado.

3. **Single-select limita o operador.** Financeiro pode querer olhar "Agência + Hitlab juntas" sem incluir CCH. Hoje só existe "1 empresa" ou "Todas".

Esta iteração:
- Extrai `<PageHeader>` compartilhado (título, descrição, ícone, eyebrow, dropdown opcional, actions padronizadas).
- Move o dropdown da sidebar pro PageHeader das telas onde faz diferença.
- Amplia single-select → multi-select ("quais empresas quero ver hoje").
- Cria os 3 índices em `empresa_id` que faltam para o filtro `.in([...])` não regredir performance em escala.
- Arruma o placeholder `null` no search de `/desembolsos`.

---

## Decisões travadas

Todas confirmadas por Daniel em 2026-09-08.

1. **Telas com dropdown:** `/orcamentos`, `/jobs`, `/relatorios/*` (todos), `/financeiro/fluxo-caixa`, `/financeiro/contas-a-pagar`, `/financeiro/desembolsos`.
2. **Telas sem dropdown (mas com PageHeader):** `/home`, `/financeiro` (hub), `/relatorios` (hub), `/cadastros/*`, `/admin/*`, `/configuracoes`.
3. **Sub-páginas mantêm header próprio** (contexto: já entrou num projeto/conta específico, header ali tem breadcrumb). PageHeader se aplica só nas telas raiz de cada domínio.
4. **Layout do PageHeader:** título+descrição à esquerda; dropdown opcional colado à direita do título; **actions vão na linha DE BAIXO** junto dos filtros/tabs (padroniza `/desembolsos`; `/orcamentos` desce os botões pra ficar igual).
5. **Multi-select:** default é "todas selecionadas". Desmarcar tudo = mostrar tudo (mesmo comportamento). Estado inconsistente é impossível.
6. **Trigger do dropdown:** 1 marcada → nome; 2+ (não todas) → "N selecionadas"; todas → "Todas selecionadas".
7. **CCH ativada com dados fake em 2026-09-08** (razão "CCH LTDA", CNPJ 14 zeros, endereço "a preencher"). Passa a aparecer no dropdown. Update de dados reais fica pra depois (5 min de UPDATE).
8. **Migration de índices** (`cartoes_credito`, `desembolsos`, `lancamentos_financeiros`) vai no mesmo pacote, aplicada antes de qualquer código do multi-select subir em prod.

---

## Modelo de mudanças

### Camada 1 — SessionContext ganha multi-empresa

Arquivo: `lib/types.ts` e `lib/auth/session.ts`.

Antes (Fase 2A):
```ts
activeEmpresa: Empresa | null;   // null = todas
empresas: Empresa[];
```

Depois:
```ts
activeEmpresas: Empresa[];       // subconjunto de empresas; vazio = todas
empresas: Empresa[];             // todas ativas do tenant (idem)
```

Cookie:
- **Antes:** `active_empresa_id` (1 UUID ou vazio).
- **Depois:** `active_empresa_ids` (CSV de UUIDs, ou vazio = todas).

Migração automática do cookie antigo: se `active_empresa_id` existir e `active_empresa_ids` não, `loadSession()` converte o valor pra CSV de 1 item e reescreve o cookie novo. Cookie antigo é apagado. Uma única passagem.

### Camada 2 — Server action `setActiveEmpresas`

Arquivo: `app/actions/set-active-empresas.ts` (**substitui** `set-active-empresa.ts`).

```ts
export async function setActiveEmpresas(ids: string[]): Promise<void>
```

- `ids = []` → apaga o cookie (equivale a todas).
- `ids = [uuid1, uuid2]` → grava `"uuid1,uuid2"`.
- Valida que cada `id` pertence a `session.empresas` do tenant do usuário.
- `revalidatePath("/")`.

O arquivo antigo `set-active-empresa.ts` é **removido**.

### Camada 3 — Componente `<PageHeader>`

Arquivo: `components/ui/page-header.tsx`.

```tsx
type PageHeaderProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  eyebrow?: string;               // ex: "COMERCIAL", "FINANCEIRO"
  showEmpresaFilter?: boolean;    // default false
  actions?: React.ReactNode;      // botões alinhados à direita na linha DE BAIXO
  filters?: React.ReactNode;      // filtros/tabs alinhados à esquerda na linha DE BAIXO
};
```

Layout renderizado:

```
┌────────────────────────────────────────────────────────────┐
│ EYEBROW                            [ Empresas ▼ ]          │  ← só se showEmpresaFilter
│ 📄  Título da Página                                        │
│     Descrição opcional                                      │
├────────────────────────────────────────────────────────────┤
│ {filters}                                {actions}          │  ← só se filters ou actions
└────────────────────────────────────────────────────────────┘
```

Regras:
- Eyebrow vermelho California (`text-california-red text-xs font-semibold uppercase tracking-wider`).
- Ícone em card vermelho translúcido (`bg-california-red/10 rounded-lg p-2`).
- Divisória horizontal só aparece se houver `filters` ou `actions`.
- `filters` e `actions` são livres — não tem componente aninhado, a tela passa seu conteúdo.

### Camada 4 — Dropdown multi-select de empresas

Arquivo: `components/ui/multi-select-empresas.tsx`.

Interface:
```tsx
type MultiSelectEmpresasProps = {
  empresas: Empresa[];
  selecionadas: string[];              // ids selecionados
  onSelectionChange: (ids: string[]) => void;
};
```

Comportamento:
- Trigger mostra label conforme regra (`selecionadas.length`):
  - `0` → "Todas selecionadas"
  - `1` → nome (`nome_fantasia ?? razao_social`)
  - `N` (menor que `empresas.length`) → "N selecionadas"
  - `N === empresas.length` → "Todas selecionadas"
- Ao abrir (Popover):
  - Header com botões `[ Marcar todas ]  [ Limpar ]`.
  - Linha divisória.
  - Lista de empresas com `<Checkbox>` clicável em cada linha.
- Marcar/desmarcar chama `onSelectionChange(nova_lista)` imediatamente.
- **Não usa `<Select>` do shadcn** (não suporta múltipla seleção). Usa `<Popover>` + `<Checkbox>` do shadcn.

O consumidor típico (dentro do `<PageHeader>`) envolve o componente com `router.refresh()`:

```tsx
<MultiSelectEmpresas
  empresas={session.empresas}
  selecionadas={session.activeEmpresas.map(e => e.id)}
  onSelectionChange={async (ids) => {
    await setActiveEmpresas(ids);
    router.refresh();
  }}
/>
```

Isso mora dentro do `<PageHeader>` quando `showEmpresaFilter=true`. O session vem via prop pro PageHeader (ou é lido no server component pai e passado — a escolha fica pra Camada 6).

### Camada 5 — Sidebar volta ao estado pré-Fase-2A

Arquivo: `components/sidebar.tsx`.

- Remove `activeEmpresa`, `empresas`, `useRouter`, `setActiveEmpresa`, imports do Select.
- Remove o bloco `{expanded && empresas.length === 1 && ...}` e `{expanded && empresas.length >= 2 && ...}`.
- Volta a receber só `role` e `nome`.

Arquivo: `app/(app)/layout.tsx`.

- Volta a passar só `role={session.activeRole} nome={session.profile.nome}` pra `<Sidebar>`.

### Camada 6 — Migração das telas para PageHeader

Todas essas telas trocam seu `<div>...<h1>Título</h1>...</div>` atual por `<PageHeader ... />`. As com dropdown recebem `showEmpresaFilter={true}`; as sem, não passam a prop.

**Com dropdown (7 telas):**
- `app/(app)/orcamentos/page.tsx`
- `app/(app)/jobs/page.tsx`
- `app/(app)/relatorios/rentabilidade/page.tsx`
- `app/(app)/relatorios/faturamento/page.tsx`
- `app/(app)/financeiro/fluxo-caixa/page.tsx`
- `app/(app)/financeiro/contas-a-pagar/page.tsx`
- `app/(app)/financeiro/desembolsos/page.tsx`

**Sem dropdown (7 telas):**
- `app/(app)/home/page.tsx`
- `app/(app)/financeiro/page.tsx` (hub)
- `app/(app)/relatorios/page.tsx` (hub)
- `app/(app)/cadastros/page.tsx` e `app/(app)/cadastros/**/page.tsx` (só as raizes de cadastro)
- `app/(app)/admin/page.tsx` e sub-raízes de admin (se houver)
- `app/(app)/configuracoes/page.tsx`
- `app/(app)/clientes/page.tsx` e `app/(app)/fornecedores/page.tsx` (se existem lists raiz)

Não migrar sub-páginas (drawers, editores, `[projetoId]`, `[orcId]/versoes/[versaoId]`, etc). Elas mantêm header próprio com breadcrumb.

Cada migração passa a receber `session` (server component pai) e deriva:
```ts
const empresaFiltroIds: string[] =
  typeof searchParams.empresa === "string" && searchParams.empresa.length > 0
    ? searchParams.empresa.split(",").filter(Boolean)
    : session.activeEmpresas.map(e => e.id);

// Query passa a usar .in(...) quando lista não vazia
let q = supabase.from("...").select("...").eq("tenant_id", ...);
if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
```

O chip visual "voltar para ativas" continua funcionando — só compara arrays em vez de strings.

### Camada 7 — Migration de índices

Arquivo: `supabase/migrations/AAAAMMDD000001_indices_empresa_id_faltantes.sql`.

```sql
create index if not exists idx_cartoes_credito_empresa on public.cartoes_credito(empresa_id);
create index if not exists idx_desembolsos_empresa on public.desembolsos(empresa_id);
create index if not exists idx_lancamentos_financeiros_empresa on public.lancamentos_financeiros(empresa_id);
```

Aditivo puro. Aplicado antes de qualquer código do multi-select subir em prod.

### Camada 8 — Bug do "null" no search de `/desembolsos`

`app/(app)/financeiro/desembolsos/*` tem input de busca cujo `placeholder` ou `defaultValue` recebe algo que resolve pra string `"null"`. Grep durante implementação (`grep -n 'placeholder="null"' app/(app)/financeiro/desembolsos`) e corrigir com fallback `?? ""` no callsite. Já que a task migra essa tela pro PageHeader, essa correção sai de brinde.

---

## Impacto no TypeScript

- `SessionContext.activeEmpresa` → `activeEmpresas` (nome muda; tipo muda). Todo consumidor (5 arquivos server component da Fase 2A: fluxo-caixa, contas-a-pagar, desembolsos, orcamentos, rentabilidade) reflete a mudança.
- `EmpresaOption`, `RegionalOption` (em `SelectEmpresaRegional`) não mudam.
- `MultiSelectEmpresasProps` é novo.
- `PageHeaderProps` é novo.

---

## Riscos e mitigação

- **Risco: URL `?empresa=X` do usuário salvo/compartilhado quebra.** Formato mudou de UUID pra CSV. Mitigação: parser aceita ambos (`split(",")` num único UUID retorna array de 1 elemento). Zero regressão.
- **Risco: cookie antigo `active_empresa_id` fica órfão nos browsers.** Mitigação: `loadSession()` faz a migração automática na primeira request de cada user autenticado (lê antigo, escreve novo, apaga antigo). Após alguns dias, todos migrados.
- **Risco: alguém escreveu server action fora dos consumidores listados que ainda usa `setActiveEmpresa`.** Mitigação: o arquivo antigo é **deletado**, tsc quebra e sinaliza consumidores órfãos.
- **Risco: SelectEmpresaRegional (dead code criado na Fase 2A) fica ainda mais órfão.** Mitigação: continua parkado. Se em fase 2B ou 3 aparecer uso, mantém; senão remove numa limpa-tudo depois.

---

## Fora de escopo

- **Fase 2B** (empresa_members + RLS por empresa) segue como próximo item depois deste PR.
- Reescrita das sub-páginas (drawers, editores) pra usarem PageHeader.
- Componente `SelectEmpresaRegional` continua dead code (deleção pode vir numa faxina futura).
- Preenchimento dos dados reais da CCH (CNPJ, endereço).
- Skeleton loading do PageHeader (usar padrão do Next).

---

## Checklist de execução

1. Migration de índices (3 CREATE INDEX aditivos).
2. Session/cookie: `activeEmpresa` → `activeEmpresas`, cookie `active_empresa_id` → `active_empresa_ids` com migração automática.
3. Server action `setActiveEmpresas` (arquivo novo); deletar `set-active-empresa.ts`.
4. Componente `<MultiSelectEmpresas>` (novo).
5. Componente `<PageHeader>` (novo).
6. Reverter sidebar (retirar dropdown/badge, voltar props a `role`+`nome`).
7. Migrar 6 telas com dropdown pro PageHeader + filtro `.in(...)`.
8. Migrar N telas sem dropdown pro PageHeader (só título/desc/actions).
9. Corrigir placeholder "null" em `/desembolsos`.
10. tsc + build + teste visual em cada tela do dropdown.
