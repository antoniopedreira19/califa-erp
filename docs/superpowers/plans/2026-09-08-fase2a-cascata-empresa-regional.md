# Fase 2A — Cascata empresa→regional + empresa ativa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir cascata empresa→regional em todos os forms de criação/edição do sistema, empresa ativa persistida na sidebar (padrão TenantContext), filtros de listagem respeitando a empresa ativa, e migração final `regional_id NOT NULL` nas 3 tabelas.

**Architecture:** SessionContext ganha `activeEmpresa` + `empresas` (cookie-based). Componente reutilizável `SelectEmpresaRegional` (props: listas + callbacks). Sidebar ganha dropdown ao lado do de tenant. Trocar empresa quando há rateio/multiselect com valor pede confirmação. Filtros de listagem leem empresa ativa por default, com URL `?empresa=X` como override local.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase JS, shadcn/ui (Select, Dialog), cookies do Next.

**Spec:** [docs/superpowers/specs/2026-09-08-fase2a-cascata-empresa-regional-design.md](../specs/2026-09-08-fase2a-cascata-empresa-regional-design.md)

## Global Constraints

- Strings visíveis ao usuário em pt-BR com acento (labels, dialogs, mensagens). Identificadores em código sem acento.
- CCH é `ativo=false` — combos de empresa filtram `ativo=true` (a filtragem já existe hoje; manter).
- Empresa ativa vive em cookie `active_empresa_id`. Vazio = "Todas".
- Cookie: HttpOnly, SameSite=Lax, sem expiração explícita (sessão do browser). Em prod: Secure.
- Trigger `ck_empresa_bate_regional` no banco garante consistência — a UI é o cinto, o trigger é o suspensório.
- Todas as regionais existentes têm `empresa_id NOT NULL` (fase 1 já materializou).
- `regional_id` em `contas_avulsas`, `lancamentos_financeiros`, `titulos_receber` é nullable HOJE — vira NOT NULL na Task 12 (fim do plano), depois de 2-3 dias sem regressão observada.
- Regra do domínio (confirmada em brainstorm): cada projeto pertence a **uma** empresa; todas as regionais aliadas do projeto pertencem a essa mesma empresa. Orçamento e job herdam a empresa do projeto.
- Rateio ou MultiSelect com valor: trocar empresa aciona `<Dialog>` de confirmação. Cancelar mantém empresa atual. Confirmar limpa rateio/multiselect.
- Componente reutilizável: `components/ui/select-empresa-regional.tsx`. Recebe listas via prop, filtra internamente.
- Padrão existente: `lib/auth/session.ts` usa RPC `get_session_context` + `React.cache`. `Sidebar` é client component em `components/sidebar.tsx`, usada em `app/(app)/layout.tsx`.

---

### Task 1: SessionContext ganha empresa ativa

**Files:**
- Modify: `lib/types.ts:52-59` — interface `SessionContext` ganha 2 campos
- Modify: `lib/auth/session.ts` — `loadSession()` lê cookie + fetch das empresas
- Create: `app/actions/set-active-empresa.ts`

**Interfaces:**
- Consumes: nada (é a origem).
- Produces:
  - `SessionContext.activeEmpresa: Empresa | null`
  - `SessionContext.empresas: Empresa[]`
  - `setActiveEmpresa(empresaId: string | null): Promise<void>` — server action.

- [ ] **Step 1: Ampliar `SessionContext` em `lib/types.ts`**

Modifique a interface `SessionContext` (linhas 52-59) para:

```ts
export interface SessionContext {
  profile: Profile;
  memberships: TenantMembership[];
  /** Tenant "ativo" — no MVP é sempre o primeiro (Agência California). */
  activeTenant: Tenant;
  /** Role do usuário dentro do tenant ativo. */
  activeRole: AppRole;
  /**
   * Empresa "ativa" — persistida no cookie `active_empresa_id`.
   * null representa "Todas as empresas" (comportamento default do sistema
   * antes da fase 2A).
   */
  activeEmpresa: Empresa | null;
  /** Todas as empresas ativas do tenant. Alimenta dropdown de troca. */
  empresas: Empresa[];
}
```

- [ ] **Step 2: Estender `loadSession()` em `lib/auth/session.ts`**

Depois de calcular `active` (~linha 89), antes do `return`, buscar as empresas + resolver a ativa via cookie. Substitua o bloco final por:

```ts
  // Empresas do tenant + resolução da empresa ativa via cookie.
  const supabaseForEmpresas = supabase; // já criado no topo
  const { data: empresasData } = await supabaseForEmpresas
    .from("empresas")
    .select("id, tenant_id, razao_social, nome_fantasia, cnpj, inscricao_estadual, inscricao_municipal, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email, local_pagamento, instrucoes_nf, principal, ativo, created_by, created_at, updated_at")
    .eq("tenant_id", active.tenant.id)
    .eq("ativo", true)
    .order("nome_fantasia", { ascending: true });

  const empresas = (empresasData ?? []) as Empresa[];

  const { cookies } = await import("next/headers");
  const cookieEmpresaId = cookies().get("active_empresa_id")?.value;
  const activeEmpresa =
    cookieEmpresaId && cookieEmpresaId.length > 0
      ? (empresas.find((e) => e.id === cookieEmpresaId) ?? null)
      : null;

  return {
    kind: "ok",
    session: {
      profile,
      memberships,
      activeTenant: active.tenant,
      activeRole: active.role,
      activeEmpresa,
      empresas,
    },
  };
```

Adicione `Empresa` ao `import type` do topo do arquivo:
```ts
import type {
  AppRole,
  Empresa,
  Profile,
  SessionContext,
  Tenant,
  TenantMembership,
  TenantMemberStatus,
} from "@/lib/types";
```

- [ ] **Step 3: Criar server action `setActiveEmpresa`**

Criar `app/actions/set-active-empresa.ts` com o conteúdo:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";

/**
 * Grava/limpa o cookie `active_empresa_id`. Recebe:
 *   - null → apaga o cookie (equivale a "Todas as empresas")
 *   - uuid → grava o id (precisa ser de uma empresa do tenant do usuário)
 *
 * Depois de gravar, revalida `/` para forçar rerun de server components.
 */
export async function setActiveEmpresa(empresaId: string | null): Promise<void> {
  const session = await requireSession();

  if (empresaId !== null) {
    const pertence = session.empresas.some((e) => e.id === empresaId);
    if (!pertence) {
      throw new Error("Empresa fora do escopo do tenant.");
    }
  }

  const store = cookies();
  if (empresaId === null) {
    store.delete("active_empresa_id");
  } else {
    store.set("active_empresa_id", empresaId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  revalidatePath("/");
}
```

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: sem erros. O build vai passar mesmo que nada consuma `activeEmpresa` ainda.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/auth/session.ts app/actions/set-active-empresa.ts
git commit -m "feat(sessao): SessionContext ganha activeEmpresa + server action setActiveEmpresa"
```

---

### Task 2: Componente `SelectEmpresaRegional`

**Files:**
- Create: `components/ui/select-empresa-regional.tsx`

**Interfaces:**
- Consumes: `Select` do shadcn (`@/components/ui/select`), `Label` (`@/components/ui/label`).
- Produces:
  ```ts
  type EmpresaOption = { id: string; nome: string };
  type RegionalOption = { id: string; nome: string; empresa_id: string };

  type SelectEmpresaRegionalProps = {
    empresas: EmpresaOption[];
    regionais: RegionalOption[];      // TODAS do tenant
    empresaId: string;                // "" quando vazio
    regionalId: string;               // "" quando vazio
    onEmpresaChange: (id: string) => void;
    onRegionalChange: (id: string) => void;
    empresaLabel?: string;            // default "Empresa"
    regionalLabel?: string;           // default "Regional"
    required?: boolean;               // default true
    disabled?: boolean;
    errorEmpresa?: string;
    errorRegional?: string;
  };
  ```

- [ ] **Step 1: Criar arquivo com o componente**

Criar `components/ui/select-empresa-regional.tsx`:

```tsx
"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type EmpresaOption = { id: string; nome: string };
export type RegionalOption = { id: string; nome: string; empresa_id: string };

export type SelectEmpresaRegionalProps = {
  empresas: EmpresaOption[];
  regionais: RegionalOption[];
  empresaId: string;
  regionalId: string;
  onEmpresaChange: (id: string) => void;
  onRegionalChange: (id: string) => void;
  empresaLabel?: string;
  regionalLabel?: string;
  required?: boolean;
  disabled?: boolean;
  errorEmpresa?: string;
  errorRegional?: string;
};

/**
 * Cascata empresa → regional. Combo de regional fica desabilitado até
 * empresa ter valor. Ao trocar empresa, chama `onRegionalChange("")`
 * para o pai limpar a regional. Filtro interno: regionais.filter(r =>
 * r.empresa_id === empresaId).
 */
export function SelectEmpresaRegional(props: SelectEmpresaRegionalProps) {
  const {
    empresas,
    regionais,
    empresaId,
    regionalId,
    onEmpresaChange,
    onRegionalChange,
    empresaLabel = "Empresa",
    regionalLabel = "Regional",
    required = true,
    disabled = false,
    errorEmpresa,
    errorRegional,
  } = props;

  const regionaisDisponiveis = React.useMemo(
    () => regionais.filter((r) => r.empresa_id === empresaId),
    [regionais, empresaId],
  );

  const handleEmpresaChange = (id: string) => {
    onEmpresaChange(id);
    // Limpa regional sempre que empresa mudar (mesmo se o mesmo id).
    onRegionalChange("");
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="select-empresa">
          {empresaLabel}
          {required && " *"}
        </Label>
        <Select
          value={empresaId}
          onValueChange={handleEmpresaChange}
          disabled={disabled}
        >
          <SelectTrigger id="select-empresa">
            <SelectValue placeholder="Selecione a empresa" />
          </SelectTrigger>
          <SelectContent>
            {empresas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errorEmpresa && (
          <p className="text-sm text-destructive">{errorEmpresa}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="select-regional">
          {regionalLabel}
          {required && " *"}
        </Label>
        <Select
          value={regionalId}
          onValueChange={onRegionalChange}
          disabled={disabled || empresaId === ""}
        >
          <SelectTrigger id="select-regional">
            <SelectValue
              placeholder={
                empresaId === ""
                  ? "Escolha a empresa primeiro"
                  : "Selecione a regional"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {regionaisDisponiveis.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errorRegional && (
          <p className="text-sm text-destructive">{errorRegional}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/ui/select-empresa-regional.tsx
git commit -m "feat(ui): componente SelectEmpresaRegional com cascata empresa->regional"
```

---

### Task 3: Dropdown de empresa ativa na sidebar

**Files:**
- Modify: `components/sidebar.tsx` — adiciona bloco de empresa perto do bloco de perfil/tenant no rodapé

**Interfaces:**
- Consumes: `SessionContext.activeEmpresa`, `SessionContext.empresas` (Task 1), `setActiveEmpresa` (Task 1).
- Produces: nada (é UI final).

- [ ] **Step 1: Localizar como a sidebar recebe dados de sessão**

Ler `components/sidebar.tsx` inteiro (é ~200 linhas) e o `app/(app)/layout.tsx` que a instancia. Confirmar se a sidebar já recebe `session` como prop OU se lê via hook. O padrão do projeto costuma passar via prop do layout server component.

Se recebe via prop: adicionar `activeEmpresa` e `empresas` ao tipo Props existente e usar direto.

Se não recebe: modificar `app/(app)/layout.tsx` pra passar `session.activeEmpresa` e `session.empresas` como props para `<Sidebar>`.

- [ ] **Step 2: Renderizar o bloco de empresa**

Perto do rodapé da sidebar (onde já mostra o perfil/tenant), adicionar:

```tsx
{empresas.length === 1 && (
  <div className="px-3 py-2 text-xs text-muted-foreground">
    Empresa: <span className="font-medium text-foreground">{empresas[0].nome_fantasia ?? empresas[0].razao_social}</span>
  </div>
)}

{empresas.length >= 2 && (
  <div className="px-3 py-2">
    <label className="mb-1 block text-xs text-muted-foreground">Empresa ativa</label>
    <Select
      value={activeEmpresa?.id ?? "todas"}
      onValueChange={async (val) => {
        await setActiveEmpresa(val === "todas" ? null : val);
        router.refresh();
      }}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todas">Todas as empresas</SelectItem>
        {empresas.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.nome_fantasia ?? e.razao_social}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

Imports a adicionar no topo do sidebar:
```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "next/navigation";
import { setActiveEmpresa } from "@/app/actions/set-active-empresa";
```

E `const router = useRouter();` dentro do componente.

- [ ] **Step 3: Testar no navegador**

```bash
npm run dev
```

Abrir `http://localhost:3000/home`. Como só tem 3 empresas ativas (Agência California, Hitlab; CCH inativa não aparece), esperar o dropdown mostrando **2 empresas + "Todas"**.

Trocar entre elas. Recarregar a página. A ativa persiste.

Abrir DevTools → Application → Cookies → conferir `active_empresa_id`.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add components/sidebar.tsx app/\(app\)/layout.tsx
git commit -m "feat(sidebar): dropdown de empresa ativa (padrao TenantContext)"
```

---

### Task 4: Confirm dialog "trocar empresa limpa rateio"

**Files:**
- Create: `components/ui/confirm-troca-empresa-dialog.tsx`

**Interfaces:**
- Consumes: `Dialog` do shadcn.
- Produces:
  ```ts
  type ConfirmTrocaEmpresaDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    contexto?: "rateio" | "regionais_aliadas";  // decide o texto
  };
  ```

- [ ] **Step 1: Criar arquivo**

`components/ui/confirm-troca-empresa-dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ConfirmTrocaEmpresaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  contexto?: "rateio" | "regionais_aliadas";
};

/**
 * Confirmação de troca de empresa quando há dados dependentes que
 * ficarão inválidos (rateio de regionais ou lista de regionais
 * aliadas — todas pertencem à empresa atual e não podem coexistir
 * com a nova).
 */
export function ConfirmTrocaEmpresaDialog(props: ConfirmTrocaEmpresaDialogProps) {
  const { open, onOpenChange, onConfirm, contexto = "rateio" } = props;

  const descricao =
    contexto === "rateio"
      ? "As regionais do rateio pertencem à empresa atual. Trocar a empresa vai limpar o rateio."
      : "As regionais escolhidas pertencem à empresa atual e não podem coexistir com a nova. Trocar a empresa vai limpar a seleção.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trocar empresa?</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/confirm-troca-empresa-dialog.tsx
git commit -m "feat(ui): ConfirmTrocaEmpresaDialog para troca com rateio existente"
```

---

### Task 5: Adaptar telas de projeto (novo + editar)

**Files:**
- Modify: `app/(app)/orcamentos/novo/page.tsx` — server component: fetch de empresas + passa como prop; empresa ativa preencherá form
- Modify: `app/(app)/orcamentos/projeto-form.tsx` — usa `SelectEmpresaRegional` + `ConfirmTrocaEmpresaDialog`; MultiSelect de regionais aliadas filtrado

**Interfaces:**
- Consumes: `SelectEmpresaRegional` (Task 2), `ConfirmTrocaEmpresaDialog` (Task 4), `session.activeEmpresa` (Task 1).
- Produces: nada.

- [ ] **Step 1: Server component — buscar empresas e passar**

Em `app/(app)/orcamentos/novo/page.tsx`, adicionar no `Promise.all` de fetches:

```ts
supabase
  .from("empresas")
  .select("id, razao_social, nome_fantasia")
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true)
  .order("nome_fantasia", { ascending: true }),
```

Passar como prop:
```tsx
<ProjetoForm
  ...
  empresas={(empresasRes.data ?? []).map(e => ({ id: e.id, nome: e.nome_fantasia ?? e.razao_social }))}
  regionais={(regionaisRes.data ?? []).map(r => ({ id: r.id, nome: r.nome, empresa_id: r.empresa_id }))}
  empresaIdInicial={session.activeEmpresa?.id ?? ""}
/>
```

**Cuidado:** `regionaisRes` no query existente provavelmente já filtra por tenant e ativo — só garanta que `empresa_id` está no `select("...")`.

- [ ] **Step 2: `projeto-form.tsx` — usar `SelectEmpresaRegional`**

Substituir o Select de empresa + Select de regional principal por:

```tsx
<SelectEmpresaRegional
  empresas={empresas}
  regionais={regionais}
  empresaId={empresaId}
  regionalId={regionalPrincipalId}
  onEmpresaChange={handleEmpresaChange}
  onRegionalChange={setRegionalPrincipalId}
  regionalLabel="Regional principal"
  errorEmpresa={fieldErrors.empresa_id?.[0]}
  errorRegional={fieldErrors.regional_id?.[0]}
/>
```

Adicionar estado e handler:
```tsx
const [empresaId, setEmpresaId] = React.useState<string>(
  projeto?.empresa_id ?? empresaIdInicial ?? ""
);
const [dialogTrocaEmpresa, setDialogTrocaEmpresa] = React.useState(false);
const [empresaPendente, setEmpresaPendente] = React.useState<string>("");

const handleEmpresaChange = (nova: string) => {
  if (regionalIds.length > 0 || regionalPrincipalId) {
    setEmpresaPendente(nova);
    setDialogTrocaEmpresa(true);
  } else {
    setEmpresaId(nova);
  }
};

const confirmarTroca = () => {
  setEmpresaId(empresaPendente);
  setRegionalIds([]);
  setRegionalPrincipalId("");
};
```

E no JSX, depois do form:
```tsx
<ConfirmTrocaEmpresaDialog
  open={dialogTrocaEmpresa}
  onOpenChange={setDialogTrocaEmpresa}
  onConfirm={confirmarTroca}
  contexto="regionais_aliadas"
/>
```

O MultiSelect de regionais aliadas passa a receber:
```tsx
<MultiSelect
  items={regionais.filter(r => r.empresa_id === empresaId).map(r => ({ value: r.id, label: r.nome }))}
  ...
  disabled={empresaId === ""}
/>
```

- [ ] **Step 3: Testar no navegador**

Abrir `http://localhost:3000/orcamentos/novo`:
- Empresa ativa preenchida no combo empresa (se topbar setou uma).
- Regional principal e MultiSelect só mostram regionais da empresa.
- Trocar empresa com regionais selecionadas → dialog aparece.
- Confirmar → limpa; Cancelar → mantém.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/orcamentos/novo/page.tsx app/\(app\)/orcamentos/projeto-form.tsx
git commit -m "feat(projeto): cascata empresa->regional em novo/editar projeto"
```

---

### Task 6: Adaptar orçamento (novo + editar) + fluxo-abertura

**Files:**
- Modify: `app/(app)/orcamentos/[projetoId]/novo/page.tsx`
- Modify: `app/(app)/orcamentos/[projetoId]/orcamento-form.tsx`
- Modify: `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/fluxo-abertura.tsx`

**Interfaces:**
- Consumes: componentes das Tasks 2, 4; sessão da Task 1.
- Produces: nada.

**Nota:** orçamento herda empresa do projeto pai. Não expõe combo de empresa; só combo de regional filtrado pelas regionais do projeto — que **já são todas da mesma empresa** por natureza da regra. A mudança aqui é sutil: só remover `regional:regionais(empresa_id)` do embed se estiver ambíguo, e confirmar que o pool de regionais que sobe pra tela é o do projeto (via `projeto_regionais`).

- [ ] **Step 1: Ler `orcamento-form.tsx` e confirmar pool de regionais**

O form hoje deve receber `regionaisDoProjeto` como prop (as regionais aliadas do projeto). Se sim: só garantir que essa lista chega correta pós-cascata. Se não: o server component precisa fetchar `projeto_regionais` do projeto e passar.

- [ ] **Step 2: Ajustar apenas se necessário**

Se o combo de regional já está funcionando bem (limitado às do projeto), esta task pode ser um no-op de leitura + confirmação. Se está listando todas as regionais do tenant, restringir ao pool do projeto.

- [ ] **Step 3: Idem para `fluxo-abertura.tsx`**

Confirmar que a regional escolhida na abertura de job vem do pool do orçamento aprovado / projeto.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit (mesmo que só de confirmação)**

```bash
git add app/\(app\)/orcamentos/\[projetoId\]/
git commit -m "chore(orcamento): confirma pool de regionais herdadas do projeto"
```

Se não houver mudança real, pular o commit e registrar no ledger.

---

### Task 7: Adaptar editor de job (`job-editor-drawer`)

**Files:**
- Modify: `app/(app)/jobs/[jobId]/carregar-detalhe.ts` — fetch de empresas/regionais
- Modify: `app/(app)/jobs/[jobId]/job-editor-drawer.tsx` — usa `SelectEmpresaRegional`

**Interfaces:**
- Consumes: componentes das Tasks 2, 4; sessão da Task 1.
- Produces: nada.

- [ ] **Step 1: Carregar empresas + regionais no server**

Em `carregar-detalhe.ts`, junto dos outros fetches:

```ts
supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("tenant_id", session.activeTenant.id).eq("ativo", true).order("nome_fantasia"),
supabase.from("regionais").select("id, nome, empresa_id").eq("tenant_id", session.activeTenant.id).eq("ativo", true).order("nome"),
```

Passar pro drawer via prop.

- [ ] **Step 2: `job-editor-drawer.tsx` — usar `SelectEmpresaRegional`**

Aplicar mesmo padrão da Task 5 (empresaId + regionalId como state, handleEmpresaChange com dialog se tiver algo dependente).

Jobs normalmente têm 1 regional, não têm rateio nem MultiSelect. Confirm dialog só precisa disparar se `regionalId !== ""` na troca.

- [ ] **Step 3: Testar no navegador**

Abrir um job existente, tentar trocar empresa. Verificar cascata.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/
git commit -m "feat(job): cascata empresa->regional no editor de job"
```

---

### Task 8: Adaptar telas financeiras (conta avulsa + recorrente + desembolso)

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx`
- Modify: `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` (só se precisar mudar server action; provavelmente não)
- Modify: `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx` (server component + client form)
- Modify: `app/(app)/financeiro/desembolsos/desembolso-drawer.tsx`

**Interfaces:**
- Consumes: componentes das Tasks 2, 4; sessão da Task 1.
- Produces: nada.

**Cuidado especial:** essas 3 telas usam `RateioRegionalEditor` compartilhado. O rateio deve receber **apenas regionais da empresa selecionada** e limpar quando empresa muda (com confirm dialog).

- [ ] **Step 1: `conta-avulsa-drawer.tsx`**

O drawer já tem `empresaId` como state (linha ~159). Adicionar:

```tsx
const [dialogTrocaEmpresa, setDialogTrocaEmpresa] = React.useState(false);
const [empresaPendente, setEmpresaPendente] = React.useState<string>("");

const handleEmpresaChange = (nova: string) => {
  if (rateio.length > 0) {
    setEmpresaPendente(nova);
    setDialogTrocaEmpresa(true);
  } else {
    setEmpresaId(nova);
  }
};

const confirmarTroca = () => {
  setEmpresaId(empresaPendente);
  setRateio([]);
};
```

O `<Select>` de empresa (linha ~540) passa a chamar `handleEmpresaChange` em vez de `setEmpresaId` direto.

O `<RateioRegionalEditor>` (linha ~791) passa a receber:
```tsx
<RateioRegionalEditor
  regionais={props.regionais.filter(r => r.empresa_id === empresaId)}
  ...
/>
```

E o dialog é adicionado ao final do drawer:
```tsx
<ConfirmTrocaEmpresaDialog
  open={dialogTrocaEmpresa}
  onOpenChange={setDialogTrocaEmpresa}
  onConfirm={confirmarTroca}
  contexto="rateio"
/>
```

- [ ] **Step 2: Verificar que `props.regionais` tem `empresa_id`**

O server component pai (`/financeiro/contas-a-pagar/page.tsx` e `/avulsa/[id]/page.tsx`) precisa incluir `empresa_id` no select de regionais. Grep pra confirmar:

```bash
grep -n "from(\"regionais\")" app/\(app\)/financeiro/contas-a-pagar/ -r
```

Se algum select não trouxer `empresa_id`, ajustar.

- [ ] **Step 3: `desembolso-drawer.tsx`**

Mesmo padrão. `empresaId` já existe (linha ~346). Aplicar `handleEmpresaChange` + confirm dialog + filter no `RateioRegionalEditor` (linha ~569 na versão atual).

- [ ] **Step 4: Recorrente**

Server component `recorrente/[id]/page.tsx` já fetcha regionais. Client form recebe. Aplicar o mesmo padrão do drawer avulsa.

- [ ] **Step 5: Testar no navegador as 3 telas**

- Criar uma nova conta avulsa: escolher empresa → rateio só lista regionais dela.
- Adicionar linha ao rateio → trocar empresa → dialog aparece → confirmar → rateio zera.
- Idem desembolso e recorrente.

- [ ] **Step 6: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/ app/\(app\)/financeiro/desembolsos/
git commit -m "feat(financeiro): cascata empresa->regional em avulsa/recorrente/desembolso"
```

---

### Task 9: Adaptar editor multi-jobs

**Files:**
- Modify: `app/(app)/orcamentos/[projetoId]/multi/editor-multi-jobs.tsx`
- Modify: `app/(app)/orcamentos/[projetoId]/multi/page.tsx` — se precisar passar regionais com `empresa_id`

**Interfaces:**
- Consumes: componentes das Tasks 2, 4.
- Produces: nada.

Multi-jobs edita várias regionais de uma vez dentro do mesmo projeto. Como projeto tem uma empresa fixa, aqui **não há troca de empresa** — só filtro do pool de regionais que apareceu por regional escolhida em cada linha.

- [ ] **Step 1: Confirmar que regionais que sobem já são só do projeto**

O pool deve vir de `projeto_regionais` (regionais aliadas do projeto). Como já são todas da mesma empresa (regra do domínio), nenhum filtro adicional é necessário.

- [ ] **Step 2: Se alguma linha permite escolher regional fora do pool, restringir**

Confirmar por leitura. Provavelmente esta task é confirmação sem mudança.

- [ ] **Step 3: Commit se houve mudança, senão registrar no ledger**

---

### Task 10: Filtros de listagem — fluxo de caixa

**Files:**
- Modify: `app/(app)/financeiro/fluxo-caixa/page.tsx`

**Interfaces:**
- Consumes: sessão da Task 1 (`activeEmpresa`).
- Produces: nada.

- [ ] **Step 1: Ler search params + calcular filtro efetivo**

No topo do server component:

```ts
const empresaFiltroId: string | null =
  typeof searchParams.empresa === "string" && searchParams.empresa.length > 0
    ? searchParams.empresa
    : (session.activeEmpresa?.id ?? null);
```

- [ ] **Step 2: Aplicar filtro na query**

```ts
let queryFluxo = supabase.from("vw_fluxo_caixa").select("*").eq("tenant_id", session.activeTenant.id);
if (empresaFiltroId) queryFluxo = queryFluxo.eq("empresa_id", empresaFiltroId);
```

- [ ] **Step 3: Renderizar chip do filtro na tela**

Perto do topo do body, se `empresaFiltroId != null`, mostrar chip "Empresa: [nome] ×" com link `?empresa=` (vazio) para voltar a "Todas" ou "activeEmpresa".

Se `empresaFiltroId === session.activeEmpresa?.id`, o chip mostra "Empresa: [nome] (ativa)" sem ×.

Se diferente (override local), mostra "Empresa: [nome] × ← voltar para ativa".

- [ ] **Step 4: Testar no navegador**

- Setar empresa ativa "Agência California" no topbar. Ir pro fluxo. Ver que só mostra linhas de Agência.
- Adicionar `?empresa=<id_hitlab>` na URL. Ver que passa a mostrar Hitlab (override).
- Voltar pra `/financeiro/fluxo-caixa` limpo. Volta pra Agência.
- Setar "Todas" no topbar. Fluxo mostra tudo.

- [ ] **Step 5: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/financeiro/fluxo-caixa/
git commit -m "feat(fluxo-caixa): filtro respeita empresa ativa; ?empresa= override local"
```

---

### Task 11: Filtros de listagem — contas a pagar, desembolsos, orçamentos, rentabilidade

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/page.tsx`
- Modify: `app/(app)/financeiro/desembolsos/page.tsx`
- Modify: `app/(app)/orcamentos/page.tsx`
- Modify: `app/(app)/relatorios/rentabilidade/carregar-linhas.ts` (ou o server component da tela)

**Interfaces:**
- Consumes: sessão da Task 1.
- Produces: nada.

**Reviewer note:** essas 4 telas seguem o mesmo padrão da Task 10 — aplicar o snippet de `empresaFiltroId` em cada uma. Como é trabalho small same-shape, pode ser feito em 1 batch de subagent.

- [ ] **Step 1: Aplicar o padrão em cada uma das 4 telas**

Mesmo bloco de leitura de `searchParams.empresa`, mesmo `if (empresaFiltroId) query.eq("empresa_id", empresaFiltroId)`. Chip do filtro na tela (opcional em relatorios, essencial em telas com muita listagem).

- [ ] **Step 2: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/page.tsx app/\(app\)/financeiro/desembolsos/page.tsx app/\(app\)/orcamentos/page.tsx app/\(app\)/relatorios/
git commit -m "feat(listagens): filtro por empresa ativa em contas-a-pagar/desembolsos/orcamentos/rentabilidade"
```

---

### Task 12: Migration `regional_id NOT NULL` — fim da fase 2A

**Files:**
- Create: `supabase/migrations/AAAAMMDD000001_regional_id_not_null.sql` (nome real definido ao aplicar; usa o prefixo seguinte livre)

**Interfaces:**
- Consumes: todo o pacote anterior aplicado (11 tasks).
- Produces: `contas_avulsas.regional_id NOT NULL`, `lancamentos_financeiros.regional_id NOT NULL`, `titulos_receber.regional_id NOT NULL`.

**Só executar depois de 2-3 dias de uso do sistema em produção sem regressão observada.** Se algum registro com `regional_id IS NULL` for criado durante esse período, é sinal de que uma tela deixou passar — a correção é no form, não abaixar a régua.

- [ ] **Step 1: Sanity check — nenhum registro nulo**

Via MCP:
```sql
select 'contas_avulsas' as t, count(*) filter (where regional_id is null) as nulos, count(*) as total from public.contas_avulsas
union all
select 'lancamentos_financeiros', count(*) filter (where regional_id is null), count(*) from public.lancamentos_financeiros
union all
select 'titulos_receber', count(*) filter (where regional_id is null), count(*) from public.titulos_receber;
```

Expected: `nulos = 0` nas 3. Se qualquer uma tiver > 0, PARAR — investigar qual tela deixou passar antes de continuar.

- [ ] **Step 2: Descobrir próximo prefixo livre**

Via MCP `mcp__supabase__list_migrations`. Usar o próximo número livre (`AAAAMMDD000001` onde AAAAMMDD = data de aplicação).

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/<prefix>_regional_id_not_null.sql`:

```sql
-- Fecha o loop da Fase 2A: agora que a UI cascata empresa->regional
-- exige regional em toda tela de criação, regional_id nas 3 tabelas
-- passa a ser NOT NULL. Se algum registro veio null, é bug de tela —
-- corrigir a tela antes de aplicar esta migration.
--
-- Ver docs/superpowers/specs/2026-09-08-fase2a-cascata-empresa-regional-design.md

alter table public.contas_avulsas          alter column regional_id set not null;
alter table public.lancamentos_financeiros alter column regional_id set not null;
alter table public.titulos_receber         alter column regional_id set not null;
```

- [ ] **Step 4: Aplicar via MCP `apply_migration`**

- [ ] **Step 5: Conferir pós-aplicação**

```sql
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema='public'
  and table_name in ('contas_avulsas','lancamentos_financeiros','titulos_receber')
  and column_name='regional_id';
```

Expected: `is_nullable = NO` nas 3.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<prefix>_regional_id_not_null.sql
git commit -m "feat(hierarquia): regional_id NOT NULL em avulsa/lancamento/titulo (fim fase 2A)"
```

---

## Nota sobre execução

- Tasks 1-4 são fundação — dependência linear.
- Tasks 5-9 são adaptações independentes de telas — podem ser batchadas se o SDD skill preferir, mas cada uma tem nuances (rateio vs single vs multi).
- Tasks 10-11 são filtros — small same-shape, ideal pra 1 batch.
- Task 12 é uma migration final aplicada dias depois — deve ser um PR separado se o processo de review preferir.

Total esperado: **~10-12 commits pequenos**, 1 migration final.

## Nota sobre o que fica pra fase 2B

- Tabela `empresa_members` (permissão por empresa).
- Backfill de todos usuários com role viewer/operator → `empresa_members` de todas ativas.
- RLS por empresa nas 13 tabelas com `empresa_id`.
- Restringir dropdown do topbar às "empresas permitidas do user".
- Tela admin pra atribuir empresas.
