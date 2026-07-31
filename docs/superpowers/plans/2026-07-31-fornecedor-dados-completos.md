# Cadastro completo de fornecedor — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expandir o cadastro de fornecedor para incluir endereço estruturado (com ViaCEP), dados bancários (combobox FEBRABAN) e chave PIX, de forma que o financeiro consiga pagar sem sair do sistema.

**Architecture:** Colunas novas em `public.fornecedores` (todas NULL-permitindo, obrigatoriedade só no Zod). Form reorganizado em 5 seções no mesmo scroll. Lista de bancos hardcoded em `lib/dados/bancos-febraban.ts` (200+ entradas) + script `scripts/atualizar-bancos-febraban.ts` que regenera via BrasilAPI. Combobox genérico novo em `components/ui/combobox.tsx`. Regra "banco tradicional OU PIX" via `superRefine` no Zod. Duplicidade de PIX tratada por warning suave no form (sem UNIQUE no banco).

**Tech Stack:** Next.js App Router 14, React 18, TypeScript 5, Supabase (Postgres + RLS), Tailwind, shadcn/ui + Radix, React Hook Form + Zod, `tsx` (nova devDep para scripts Node/TS).

## Global Constraints

- **Nunca** expor `SUPABASE_SERVICE_ROLE_KEY` no navegador.
- Toda tabela operacional tem `tenant_id`; `fornecedores` já tem — não alterar.
- RLS + GRANTs para `authenticated` já cobrem `fornecedores` (migration `20260722000001`); ALTER COLUMN não muda isso, **confirmar** no fim da Task 1.
- Chamar `log_audit_event` em criação/atualização (regra do projeto).
- Antes de commit em `app/(app)/**` ou `lib/supabase/**`, aplicar checklist de `docs/PERFORMANCE.md`.
- `<Link>` em lista de 5+ itens navegáveis → `prefetch={false}` — não se aplica aqui (não estamos criando novas listas).
- `PopoverContent` de form: **sempre** `side="bottom" avoidCollisions={false}` + largura fixa (memory: `feedback_radix_gotchas.md`).
- Migrations versionadas, nunca amend em migration já aplicada; nova migration por mudança.
- Enum values e nomes de campos exatamente como no spec (`docs/superpowers/specs/2026-07-31-fornecedor-dados-completos-design.md`).
- Fornecedores existentes **não** recebem backfill; permanecem com colunas novas NULL.

---

## Task 1: Migration do schema + tipos TypeScript

**Files:**
- Create: `supabase/migrations/20260731000001_fornecedor_dados_completos.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces:
  - Enums Postgres: `public.tipo_conta_bancaria` = `('corrente','poupanca','pagamento')`; `public.pix_tipo_chave` = `('cpf','cnpj','email','telefone','aleatoria')`.
  - Colunas novas em `public.fornecedores`: `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf`, `banco_codigo`, `banco_nome`, `agencia`, `agencia_dv`, `conta`, `conta_dv`, `tipo_conta`, `pix_tipo`, `pix_chave` — todas nullable.
  - Tipos TS exportados de `lib/types.ts`: `TipoContaBancaria`, `PixTipoChave`, `Fornecedor` (expandido).

- [ ] **Step 1: Criar arquivo da migration**

Create: `supabase/migrations/20260731000001_fornecedor_dados_completos.sql`

```sql
-- =====================================================================
-- Cadastro completo de fornecedor
--
-- Adiciona endereço estruturado, dados bancários e chave PIX ao cadastro
-- de fornecedor. Motivação: financeiro precisa pagar; hoje esses dados
-- ficam soltos em `observacoes` ou fora do sistema.
--
-- Decisões (spec 2026-07-31-fornecedor-dados-completos-design.md):
--   - Uma conta bancária / PIX por fornecedor (colunas diretas, sem
--     tabela auxiliar).
--   - Endereço estruturado; ViaCEP no form. Cidade texto livre (não FK
--     para `cidades`, que é curada por tenant).
--   - Titular = fornecedor sempre (sem campos separados).
--   - Todas as colunas novas nascem NULL. Obrigatoriedade fica no Zod.
--     Fornecedores existentes continuam válidos; badge "Dados
--     incompletos" na lista sinaliza que precisam ser completados.
--   - Sem UNIQUE em pix_chave — warning suave no form, casos legítimos
--     de PIX compartilhado existem.
--   - Sem GRANTs novos, sem RLS nova — `fornecedores` já tem cobertura
--     completa (migration 20260722000001).
-- =====================================================================

-- 1. Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_conta_bancaria') then
    create type public.tipo_conta_bancaria as enum ('corrente', 'poupanca', 'pagamento');
  end if;

  if not exists (select 1 from pg_type where typname = 'pix_tipo_chave') then
    create type public.pix_tipo_chave as enum ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria');
  end if;
end$$;

-- 2. Colunas novas
alter table public.fornecedores add column if not exists cep text;
alter table public.fornecedores add column if not exists logradouro text;
alter table public.fornecedores add column if not exists numero text;
alter table public.fornecedores add column if not exists complemento text;
alter table public.fornecedores add column if not exists bairro text;
alter table public.fornecedores add column if not exists cidade text;
alter table public.fornecedores add column if not exists uf char(2);

alter table public.fornecedores add column if not exists banco_codigo text;
alter table public.fornecedores add column if not exists banco_nome text;
alter table public.fornecedores add column if not exists agencia text;
alter table public.fornecedores add column if not exists agencia_dv text;
alter table public.fornecedores add column if not exists conta text;
alter table public.fornecedores add column if not exists conta_dv text;
alter table public.fornecedores add column if not exists tipo_conta public.tipo_conta_bancaria;

alter table public.fornecedores add column if not exists pix_tipo public.pix_tipo_chave;
alter table public.fornecedores add column if not exists pix_chave text;

-- 3. CHECKs de formato (defesa em profundidade; Zod valida no app)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fornecedores_cep_formato') then
    alter table public.fornecedores
      add constraint fornecedores_cep_formato
      check (cep is null or cep ~ '^[0-9]{8}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_uf_formato') then
    alter table public.fornecedores
      add constraint fornecedores_uf_formato
      check (uf is null or uf in (
        'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
        'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_banco_codigo_formato') then
    alter table public.fornecedores
      add constraint fornecedores_banco_codigo_formato
      check (banco_codigo is null or banco_codigo ~ '^[0-9]{3}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_agencia_formato') then
    alter table public.fornecedores
      add constraint fornecedores_agencia_formato
      check (agencia is null or agencia ~ '^[0-9]{3,5}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_agencia_dv_formato') then
    alter table public.fornecedores
      add constraint fornecedores_agencia_dv_formato
      check (agencia_dv is null or agencia_dv ~ '^[0-9Xx]$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_conta_formato') then
    alter table public.fornecedores
      add constraint fornecedores_conta_formato
      check (conta is null or conta ~ '^[0-9]{4,12}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fornecedores_conta_dv_formato') then
    alter table public.fornecedores
      add constraint fornecedores_conta_dv_formato
      check (conta_dv is null or conta_dv ~ '^[0-9Xx]$');
  end if;

  -- Coerência banco: se qualquer campo bancário preenchido, banco_codigo e
  -- banco_nome devem estar juntos (server deriva nome do código).
  if not exists (select 1 from pg_constraint where conname = 'fornecedores_banco_nome_coerente') then
    alter table public.fornecedores
      add constraint fornecedores_banco_nome_coerente
      check (
        (banco_codigo is null and banco_nome is null)
        or (banco_codigo is not null and banco_nome is not null)
      );
  end if;
end$$;
```

- [ ] **Step 2: Aplicar a migration**

Rodar:
```powershell
supabase db push
```
(ou aplicar via SQL editor no dashboard se preferir).

Expected: 0 erros. Migration aparece em `supabase migration list`.

- [ ] **Step 3: Verificar schema aplicado**

Rodar SQL de verificação (via SQL editor do Supabase ou psql):
```sql
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'fornecedores'
   and column_name in (
     'cep','logradouro','numero','complemento','bairro','cidade','uf',
     'banco_codigo','banco_nome','agencia','agencia_dv','conta','conta_dv',
     'tipo_conta','pix_tipo','pix_chave'
   )
 order by column_name;

select typname, enumlabel
  from pg_type t join pg_enum e on t.oid = e.enumtypid
 where typname in ('tipo_conta_bancaria','pix_tipo_chave')
 order by typname, e.enumsortorder;
```

Expected:
- 16 colunas listadas, todas `is_nullable = 'YES'`.
- Enum `tipo_conta_bancaria` com 3 valores; `pix_tipo_chave` com 5 valores.

- [ ] **Step 4: Confirmar que GRANTs e RLS já cobrem os novos campos**

Rodar:
```sql
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'fornecedores'
   and grantee = 'authenticated';
```

Expected: linhas para `SELECT`, `INSERT`, `UPDATE` (herdadas da migration 20260722000001, valem para colunas novas automaticamente).

- [ ] **Step 5: Atualizar tipos TypeScript**

Modify: `lib/types.ts` — adicionar/expandir os tipos abaixo. Se `Fornecedor` já existe, expandir com os novos campos; se não, criar. Verificar o padrão do arquivo antes de editar (Read primeiro).

```ts
export type TipoContaBancaria = 'corrente' | 'poupanca' | 'pagamento';
export type PixTipoChave = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

export type UF =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO'
  | 'MA' | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI'
  | 'RJ' | 'RN' | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO';

// Expandir o tipo Fornecedor existente (adicionar as chaves abaixo, manter
// as que já existem):
export interface Fornecedor {
  // ...campos existentes (id, tenant_id, tipo_pessoa, nome, razao_social,
  //    cpf_cnpj, email, telefone, observacoes, status, created_by,
  //    created_at, updated_at)...

  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: UF | null;

  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  agencia_dv: string | null;
  conta: string | null;
  conta_dv: string | null;
  tipo_conta: TipoContaBancaria | null;

  pix_tipo: PixTipoChave | null;
  pix_chave: string | null;
}
```

- [ ] **Step 6: Rodar typecheck**

```powershell
npm run typecheck
```

Expected: 0 erros. Se houver, geralmente é porque algum consumidor de `Fornecedor` foi esquecido — ajustar.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/20260731000001_fornecedor_dados_completos.sql lib/types.ts
git commit -m "feat(fornecedores): schema para endereco, banco e PIX + tipos TS"
```

---

## Task 2: Lista hardcoded de bancos + script de regeneração

**Files:**
- Create: `scripts/atualizar-bancos-febraban.ts`
- Create: `lib/dados/bancos-febraban.ts` (gerado pelo script)
- Modify: `package.json` (script npm + devDep `tsx`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `BANCOS_FEBRABAN: readonly { codigo: string; nome: string }[]` — array ordenado por `codigo`, 3 dígitos.
  - `getBancoByCodigo(codigo: string): { codigo: string; nome: string } | null`.
  - Comando npm: `npm run atualizar:bancos`.

- [ ] **Step 1: Adicionar `tsx` como devDependency**

```powershell
npm install --save-dev tsx
```

Expected: `package.json` ganha `"tsx": "^..."` em `devDependencies`; `package-lock.json` atualizado.

- [ ] **Step 2: Adicionar script npm no `package.json`**

Modify: `package.json` — adicionar em `"scripts"`:

```json
"atualizar:bancos": "tsx scripts/atualizar-bancos-febraban.ts"
```

- [ ] **Step 3: Escrever o script de regeneração**

Create: `scripts/atualizar-bancos-febraban.ts`

```ts
/**
 * Regenera lib/dados/bancos-febraban.ts a partir da BrasilAPI.
 *
 * Uso: npm run atualizar:bancos
 *
 * Motivação: a lista fica hardcoded (fica próxima do código, zero
 * dependência em runtime), mas atualizar não pode ser trabalho manual.
 * Este script busca a lista canônica na BrasilAPI, filtra bancos com
 * código numérico + nome, formata código com 3 dígitos e sobrescreve
 * o arquivo `.ts` com um snapshot datado.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface BrasilApiBank {
  ispb: string;
  name: string | null;
  code: number | null;
  fullName: string | null;
}

async function main() {
  const res = await fetch("https://brasilapi.com.br/api/banks/v1");
  if (!res.ok) {
    throw new Error(`BrasilAPI retornou ${res.status}: ${res.statusText}`);
  }
  const bancos = (await res.json()) as BrasilApiBank[];

  const filtrados = bancos
    .filter((b): b is BrasilApiBank & { code: number; name: string } =>
      typeof b.code === "number" && !!b.name,
    )
    .map((b) => ({
      codigo: String(b.code).padStart(3, "0"),
      nome: (b.fullName ?? b.name).trim(),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  const dataStr = new Date().toISOString().slice(0, 10);

  const conteudo = `// Snapshot FEBRABAN em ${dataStr} — regenerar via \`npm run atualizar:bancos\`.
// Fonte: https://brasilapi.com.br/api/banks/v1
// NÃO editar manualmente — mudanças serão sobrescritas.

export interface BancoFebraban {
  readonly codigo: string;
  readonly nome: string;
}

export const BANCOS_FEBRABAN: readonly BancoFebraban[] = [
${filtrados.map((b) => `  { codigo: ${JSON.stringify(b.codigo)}, nome: ${JSON.stringify(b.nome)} },`).join("\n")}
];

export function getBancoByCodigo(codigo: string): BancoFebraban | null {
  return BANCOS_FEBRABAN.find((b) => b.codigo === codigo) ?? null;
}
`;

  const destino = resolve(process.cwd(), "lib/dados/bancos-febraban.ts");
  writeFileSync(destino, conteudo, "utf8");
  console.log(`OK — ${filtrados.length} bancos gravados em ${destino}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Rodar o script para gerar a lista inicial**

Primeiro, criar a pasta se não existir:

```powershell
if (-not (Test-Path lib/dados)) { New-Item -ItemType Directory -Path lib/dados | Out-Null }
```

Depois rodar:

```powershell
npm run atualizar:bancos
```

Expected: mensagem `OK — ~200 bancos gravados em .../lib/dados/bancos-febraban.ts`. Arquivo criado.

- [ ] **Step 5: Verificar o arquivo gerado**

Abrir `lib/dados/bancos-febraban.ts` e conferir:
- Cabeçalho com data e link da BrasilAPI.
- ≥ 100 entradas.
- Presença dos códigos comuns: `001` (Banco do Brasil), `033` (Santander), `104` (Caixa), `237` (Bradesco), `260` (Nu Pagamentos), `341` (Itaú).

Rodar quick check:

```powershell
npm run typecheck
```

Expected: 0 erros no novo arquivo.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json scripts/atualizar-bancos-febraban.ts lib/dados/bancos-febraban.ts
git commit -m "feat(fornecedores): lista FEBRABAN hardcoded + script de regeneracao"
```

---

## Task 3: Máscara CEP no MaskedInput

**Files:**
- Modify: `components/ui/masked-input.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `<MaskedInput mask="cep">` aceita e formata como `00000-000`; `value` interno permanece como string (com hífen); `onChange` continua compatível.

- [ ] **Step 1: Ler o arquivo atual**

Read: `components/ui/masked-input.tsx` para entender o padrão de máscaras existentes (cpf, cnpj, telefone).

- [ ] **Step 2: Adicionar máscara `cep`**

Modify: `components/ui/masked-input.tsx` — adicionar `cep` ao tipo `mask` e à função que aplica formatação. Seguir exatamente o padrão dos outros tipos.

Lógica de formatação (após `onlyDigits`, com no máx 8):
```ts
// CEP: 00000-000
function formatCep(digits: string): string {
  const d = digits.slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
```

- [ ] **Step 3: Typecheck**

```powershell
npm run typecheck
```

Expected: 0 erros.

- [ ] **Step 4: Smoke test manual (breve)**

Adicionar temporariamente `<MaskedInput mask="cep" name="teste-cep" />` numa página em dev, rodar `npm run dev`, digitar `01310100` no campo, ver se aparece `01310-100`. Remover o teste antes de commitar.

- [ ] **Step 5: Commit**

```powershell
git add components/ui/masked-input.tsx
git commit -m "feat(ui): mascara CEP no MaskedInput"
```

---

## Task 4: Componente Combobox genérico

**Files:**
- Create: `components/ui/combobox.tsx`

**Interfaces:**
- Consumes: `Popover`, `PopoverTrigger`, `PopoverContent` de `components/ui/popover.tsx`; `Input` de `components/ui/input.tsx`.
- Produces:
  ```ts
  interface ComboboxItem { value: string; label: string }
  interface ComboboxProps {
    items: ReadonlyArray<ComboboxItem>;
    value: string | null;
    onChange: (value: string | null) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    id?: string;
    name?: string;  // renderiza <input type="hidden" name={name} value={value ?? ""} />
  }
  export function Combobox(props: ComboboxProps): JSX.Element
  ```

- [ ] **Step 1: Ler exemplos de componentes UI existentes**

Read: `components/ui/popover.tsx` (para conferir a API do Popover), `components/ui/input.tsx` (padrão de estilos), `components/ui/select.tsx` (padrão de trigger com chevron).

- [ ] **Step 2: Criar o componente**

Create: `components/ui/combobox.tsx`

```tsx
"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboboxItem {
  value: string;
  label: string;
}

interface ComboboxProps {
  items: ReadonlyArray<ComboboxItem>;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
}

export function Combobox({
  items,
  value,
  onChange,
  placeholder = "Selecione...",
  disabled,
  className,
  id,
  name,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = React.useMemo(
    () => items.find((i) => i.value === value) ?? null,
    [items, value],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-lg border border-input bg-white px-3 py-2 text-sm ring-offset-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          >
            <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          avoidCollisions={false}
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="h-9"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado.</p>
            )}
            {filtered.map((item) => (
              <button
                type="button"
                key={item.value}
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                  item.value === value && "bg-accent/50",
                )}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    item.value === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

```powershell
npm run typecheck
```

Expected: 0 erros.

- [ ] **Step 4: Commit**

```powershell
git add components/ui/combobox.tsx
git commit -m "feat(ui): componente Combobox generico com busca"
```

---

## Task 5: Zod schema expandido + verificação via script

**Files:**
- Modify: `lib/validations/fornecedores.ts`
- Create: `scripts/testar-fornecedor-schema.ts`

**Interfaces:**
- Consumes: `BANCOS_FEBRABAN`, `getBancoByCodigo` de `lib/dados/bancos-febraban.ts`; `isValidCpf`, `isValidCnpj`, `onlyDigits` de `lib/utils`.
- Produces: `fornecedorSchema` (Zod) validando todos os campos novos, com regra "banco tradicional OU PIX (pelo menos um bloco completo)"; `FornecedorInput` (tipo inferido) inclui todos os novos campos.

- [ ] **Step 1: Escrever o script de verificação PRIMEIRO (falha esperada)**

Create: `scripts/testar-fornecedor-schema.ts`

```ts
/**
 * Verificação de contrato do fornecedorSchema. Não é framework de testes —
 * é um script tsx com assertions básicas para pegar regressões antes de
 * commitar. Cobre os casos que mais nos morderam na brainstorming:
 * banco parcial, PIX parcial, banco OU PIX, formato de chave PIX.
 */
import { fornecedorSchema } from "../lib/validations/fornecedores";

let passou = 0;
let falhou = 0;

function assertOk(nome: string, entrada: unknown) {
  const r = fornecedorSchema.safeParse(entrada);
  if (r.success) {
    passou++;
    console.log(`  OK  ${nome}`);
  } else {
    falhou++;
    console.log(`  FALHA (esperava OK)  ${nome}`);
    console.log("     issues:", JSON.stringify(r.error.issues, null, 2));
  }
}

function assertErroEm(nome: string, entrada: unknown, campoEsperado: string) {
  const r = fornecedorSchema.safeParse(entrada);
  if (r.success) {
    falhou++;
    console.log(`  FALHA (esperava erro em ${campoEsperado})  ${nome}`);
    return;
  }
  const tem = r.error.issues.some((i) => i.path.includes(campoEsperado));
  if (tem) {
    passou++;
    console.log(`  OK  ${nome}`);
  } else {
    falhou++;
    console.log(`  FALHA (erro em outro campo)  ${nome}`);
    console.log("     issues:", JSON.stringify(r.error.issues, null, 2));
  }
}

const base = {
  tipo_pessoa: "juridica",
  nome: "Prime Comunicação",
  razao_social: "Prime Comunicação e Marketing Ltda",
  cpf_cnpj: "64582932000172",
  email: "regularize@contabilidade.com.br",
  telefone: "11987654321",
  cep: "44245000",
  logradouro: "Rua João Hipólito de Azevedo",
  numero: "18",
  complemento: "Andar 01",
  bairro: "Centro",
  cidade: "Conceição do Jacuípe",
  uf: "BA",
};

const bancoCompleto = {
  banco_codigo: "260",
  agencia: "0001",
  agencia_dv: null,
  conta: "218443214",
  conta_dv: "7",
  tipo_conta: "pagamento",
};

const pixCompleto = {
  pix_tipo: "cnpj",
  pix_chave: "64582932000172",
};

console.log("\n== Fornecedor completo (banco + PIX) ==");
assertOk("banco + PIX preenchidos", { ...base, ...bancoCompleto, ...pixCompleto });

console.log("\n== Fornecedor só com banco ==");
assertOk("só banco", { ...base, ...bancoCompleto });

console.log("\n== Fornecedor só com PIX ==");
assertOk("só PIX (chave CNPJ válida)", { ...base, ...pixCompleto });

console.log("\n== Nem banco nem PIX ==");
assertErroEm("nenhum bloco de pagamento", base, "banco_codigo");

console.log("\n== Banco parcialmente preenchido ==");
assertErroEm(
  "banco sem conta_dv",
  { ...base, ...bancoCompleto, conta_dv: null },
  "conta_dv",
);

console.log("\n== PIX parcialmente preenchido ==");
assertErroEm(
  "pix_tipo sem chave",
  { ...base, ...pixCompleto, pix_chave: "" },
  "pix_chave",
);

console.log("\n== Chave PIX com formato inválido ==");
assertErroEm(
  "chave CPF com 10 dígitos",
  { ...base, pix_tipo: "cpf", pix_chave: "1234567890" },
  "pix_chave",
);
assertErroEm(
  "chave e-mail sem @",
  { ...base, pix_tipo: "email", pix_chave: "abcabc" },
  "pix_chave",
);
assertErroEm(
  "chave telefone com 8 dígitos",
  { ...base, pix_tipo: "telefone", pix_chave: "12345678" },
  "pix_chave",
);

console.log("\n== Endereço obrigatório ==");
assertErroEm("sem CEP", { ...base, cep: "", ...pixCompleto }, "cep");
assertErroEm("CEP com 7 dígitos", { ...base, cep: "1234567", ...pixCompleto }, "cep");
assertErroEm("UF inválida", { ...base, uf: "XX", ...pixCompleto }, "uf");

console.log("\n== Banco inválido ==");
assertErroEm(
  "banco_codigo não existe na FEBRABAN",
  { ...base, ...bancoCompleto, banco_codigo: "999" },
  "banco_codigo",
);

console.log(`\n== ${passou} OK / ${falhou} falha(s) ==`);
process.exit(falhou > 0 ? 1 : 0);
```

- [ ] **Step 2: Rodar o script — todas as asserções devem falhar (schema atual não conhece os campos novos)**

```powershell
npx tsx scripts/testar-fornecedor-schema.ts
```

Expected: várias falhas. Estamos justamente introduzindo os campos novos na próxima etapa.

- [ ] **Step 3: Expandir o schema Zod**

Modify: `lib/validations/fornecedores.ts` — expandir o schema existente. Manter os campos antigos como estão; adicionar os novos + `superRefine` de coerência.

Guia da implementação:

```ts
import { z } from "zod";
import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/utils";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";

const UFS_BRASIL = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
] as const;

const nullIfEmpty = (v: unknown) =>
  typeof v === "string" && v.trim().length === 0 ? null : v;

export const fornecedorSchema = z
  .object({
    // === campos existentes (mantidos como estão) ===
    tipo_pessoa: z.enum(["fisica", "juridica"]),
    nome: z.string().trim().min(2, "Informe o nome (mín. 2 caracteres).").max(200),
    razao_social: z.preprocess(nullIfEmpty, z.string().trim().max(200).nullable().optional()),
    cpf_cnpj: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().nullable().optional().transform((v) => (v ? v : null)),
    ),
    email: z.preprocess(nullIfEmpty, z.string().trim().max(200).nullable().optional())
      .refine(
        (v) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        "E-mail inválido.",
      ),
    telefone: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().nullable().optional(),
    )
      .refine((v) => v == null || v === "" || v.length === 10 || v.length === 11,
        "Telefone deve ter 10 ou 11 dígitos.")
      .transform((v) => (v ? v : null)),
    observacoes: z.preprocess(nullIfEmpty, z.string().trim().max(2000).nullable().optional()),

    // === endereço (todos obrigatórios, exceto complemento) ===
    cep: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().min(1, "CEP obrigatório."),
    ).refine((v) => /^[0-9]{8}$/.test(v), "CEP deve ter 8 dígitos."),
    logradouro: z.string().trim().min(1, "Logradouro obrigatório.").max(200),
    numero: z.string().trim().min(1, "Número obrigatório.").max(20),
    complemento: z.preprocess(nullIfEmpty, z.string().trim().max(100).nullable().optional()),
    bairro: z.string().trim().min(1, "Bairro obrigatório.").max(100),
    cidade: z.string().trim().min(1, "Cidade obrigatória.").max(100),
    uf: z.enum(UFS_BRASIL, { errorMap: () => ({ message: "UF inválida." }) }),

    // === banco (todos opcionais individualmente; coerência no superRefine) ===
    banco_codigo: z.preprocess(nullIfEmpty, z.string().nullable().optional()),
    agencia: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().nullable().optional().transform((v) => (v ? v : null)),
    ),
    agencia_dv: z.preprocess(nullIfEmpty, z.string().max(1).nullable().optional()),
    conta: z.preprocess(
      (v) => (typeof v === "string" ? onlyDigits(v) : v),
      z.string().nullable().optional().transform((v) => (v ? v : null)),
    ),
    conta_dv: z.preprocess(nullIfEmpty, z.string().max(1).nullable().optional()),
    tipo_conta: z.enum(["corrente", "poupanca", "pagamento"]).nullable().optional(),

    // === PIX (opcional individualmente; coerência no superRefine) ===
    pix_tipo: z.enum(["cpf", "cnpj", "email", "telefone", "aleatoria"]).nullable().optional(),
    pix_chave: z.preprocess(nullIfEmpty, z.string().nullable().optional()),
  })
  .superRefine((data, ctx) => {
    // --- Documento do fornecedor (CPF/CNPJ) — regra pré-existente ---
    if (data.cpf_cnpj) {
      if (data.tipo_pessoa === "fisica") {
        if (data.cpf_cnpj.length !== 11 || !isValidCpf(data.cpf_cnpj)) {
          ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: "CPF inválido." });
        }
      } else {
        if (data.cpf_cnpj.length !== 14 || !isValidCnpj(data.cpf_cnpj)) {
          ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: "CNPJ inválido." });
        }
      }
    }

    // --- Banco tradicional: se qualquer campo, todos os obrigatórios ---
    const bancoParcial =
      data.banco_codigo || data.agencia || data.conta || data.conta_dv || data.tipo_conta;
    const bancoCompleto =
      data.banco_codigo && data.agencia && data.conta && data.conta_dv && data.tipo_conta;

    if (bancoParcial && !bancoCompleto) {
      if (!data.banco_codigo) ctx.addIssue({ code: "custom", path: ["banco_codigo"], message: "Selecione o banco." });
      if (!data.agencia)      ctx.addIssue({ code: "custom", path: ["agencia"],      message: "Agência obrigatória." });
      if (!data.conta)        ctx.addIssue({ code: "custom", path: ["conta"],        message: "Conta obrigatória." });
      if (!data.conta_dv)     ctx.addIssue({ code: "custom", path: ["conta_dv"],     message: "Dígito da conta obrigatório." });
      if (!data.tipo_conta)   ctx.addIssue({ code: "custom", path: ["tipo_conta"],   message: "Tipo de conta obrigatório." });
    }
    if (data.banco_codigo && !getBancoByCodigo(data.banco_codigo)) {
      ctx.addIssue({ code: "custom", path: ["banco_codigo"], message: "Banco inválido." });
    }
    if (data.agencia && !/^[0-9]{3,5}$/.test(data.agencia)) {
      ctx.addIssue({ code: "custom", path: ["agencia"], message: "Agência deve ter 3 a 5 dígitos." });
    }
    if (data.agencia_dv && !/^[0-9Xx]$/.test(data.agencia_dv)) {
      ctx.addIssue({ code: "custom", path: ["agencia_dv"], message: "Dígito da agência inválido." });
    }
    if (data.conta && !/^[0-9]{4,12}$/.test(data.conta)) {
      ctx.addIssue({ code: "custom", path: ["conta"], message: "Conta deve ter 4 a 12 dígitos." });
    }
    if (data.conta_dv && !/^[0-9Xx]$/.test(data.conta_dv)) {
      ctx.addIssue({ code: "custom", path: ["conta_dv"], message: "Dígito da conta inválido." });
    }

    // --- PIX: se qualquer campo, os dois; e chave coerente com o tipo ---
    const pixParcial = data.pix_tipo || data.pix_chave;
    const pixCompleto = data.pix_tipo && data.pix_chave;

    if (pixParcial && !pixCompleto) {
      if (!data.pix_tipo)  ctx.addIssue({ code: "custom", path: ["pix_tipo"],  message: "Tipo de chave obrigatório." });
      if (!data.pix_chave) ctx.addIssue({ code: "custom", path: ["pix_chave"], message: "Chave PIX obrigatória." });
    }

    if (data.pix_tipo && data.pix_chave) {
      const chave = data.pix_chave;
      switch (data.pix_tipo) {
        case "cpf": {
          const d = onlyDigits(chave);
          if (d.length !== 11 || !isValidCpf(d))
            ctx.addIssue({ code: "custom", path: ["pix_chave"], message: "CPF inválido." });
          break;
        }
        case "cnpj": {
          const d = onlyDigits(chave);
          if (d.length !== 14 || !isValidCnpj(d))
            ctx.addIssue({ code: "custom", path: ["pix_chave"], message: "CNPJ inválido." });
          break;
        }
        case "email":
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave))
            ctx.addIssue({ code: "custom", path: ["pix_chave"], message: "E-mail inválido." });
          break;
        case "telefone": {
          const d = onlyDigits(chave);
          if (d.length !== 10 && d.length !== 11)
            ctx.addIssue({ code: "custom", path: ["pix_chave"], message: "Telefone deve ter 10 ou 11 dígitos." });
          break;
        }
        case "aleatoria": {
          const limpa = chave.replace(/-/g, "");
          if (limpa.length < 32 || limpa.length > 36 || !/^[a-zA-Z0-9]+$/.test(limpa))
            ctx.addIssue({ code: "custom", path: ["pix_chave"], message: "Chave aleatória inválida." });
          break;
        }
      }
    }

    // --- Regra final: pelo menos um bloco de pagamento completo ---
    if (!bancoCompleto && !pixCompleto) {
      ctx.addIssue({
        code: "custom",
        path: ["banco_codigo"],
        message: "Preencha os dados bancários OU o PIX (pelo menos um).",
      });
    }
  });

export type FornecedorInput = z.infer<typeof fornecedorSchema>;
```

- [ ] **Step 4: Rodar o script de verificação — tudo deve passar**

```powershell
npx tsx scripts/testar-fornecedor-schema.ts
```

Expected: `== N OK / 0 falha(s) ==` no fim. Se algo falhar, ajustar o schema até passar todos os cenários.

- [ ] **Step 5: Typecheck geral**

```powershell
npm run typecheck
```

Expected: 0 erros (o `FornecedorInput` mudou; qualquer consumidor que dependia da forma antiga vai reclamar — ajustar se necessário, mas provavelmente só a Task 6 usa).

- [ ] **Step 6: Commit**

```powershell
git add lib/validations/fornecedores.ts scripts/testar-fornecedor-schema.ts
git commit -m "feat(fornecedores): valida endereco, dados bancarios e PIX (banco OU PIX)"
```

---

## Task 6: Server actions — criar, atualizar e verificar PIX duplicado

**Files:**
- Modify: `app/(app)/fornecedores/actions.ts`

**Interfaces:**
- Consumes: `fornecedorSchema`, `FornecedorInput` de `lib/validations/fornecedores.ts`; `getBancoByCodigo` de `lib/dados/bancos-febraban.ts`; `onlyDigits` de `lib/utils`.
- Produces:
  - `criarFornecedor(formData: FormData): Promise<ActionResult>` — assinatura inalterada, aceita todos os campos novos via `FormData`.
  - `atualizarFornecedor(id: string, formData: FormData): Promise<ActionResult>` — idem.
  - `verificarPixDuplicado(chave: string, excludeId?: string): Promise<{ existe: true; id: string; nome: string } | { existe: false }>`.

- [ ] **Step 1: Ler o actions.ts atual**

Read: `app/(app)/fornecedores/actions.ts` inteiro. Entender:
- Como o `FormData` vira input para o Zod.
- Como o cliente Supabase é criado (server-side).
- Como `log_audit_event` é chamado hoje.
- O tipo `ActionResult`.

- [ ] **Step 2: Adaptar a leitura do FormData nas actions existentes**

Modify: `app/(app)/fornecedores/actions.ts` — nas actions `criarFornecedor` e `atualizarFornecedor`, extrair TODOS os novos campos do `FormData`:

```ts
const raw = {
  tipo_pessoa: formData.get("tipo_pessoa"),
  nome: formData.get("nome"),
  razao_social: formData.get("razao_social"),
  cpf_cnpj: formData.get("cpf_cnpj"),
  email: formData.get("email"),
  telefone: formData.get("telefone"),
  observacoes: formData.get("observacoes"),

  cep: formData.get("cep"),
  logradouro: formData.get("logradouro"),
  numero: formData.get("numero"),
  complemento: formData.get("complemento"),
  bairro: formData.get("bairro"),
  cidade: formData.get("cidade"),
  uf: formData.get("uf"),

  banco_codigo: formData.get("banco_codigo"),
  agencia: formData.get("agencia"),
  agencia_dv: formData.get("agencia_dv"),
  conta: formData.get("conta"),
  conta_dv: formData.get("conta_dv"),
  tipo_conta: formData.get("tipo_conta"),

  pix_tipo: formData.get("pix_tipo"),
  pix_chave: formData.get("pix_chave"),
};

const parsed = fornecedorSchema.safeParse(raw);
if (!parsed.success) {
  return { ok: false, message: "Dados inválidos.", fieldErrors: parsed.error.flatten().fieldErrors };
}
```

- [ ] **Step 3: Derivar `banco_nome` e normalizar PIX antes do insert/update**

```ts
const input = parsed.data;

// Derivar banco_nome do código (o form envia só o código).
let banco_nome: string | null = null;
if (input.banco_codigo) {
  const banco = getBancoByCodigo(input.banco_codigo);
  if (!banco) {
    return { ok: false, message: "Banco selecionado é inválido." };
  }
  banco_nome = banco.nome;
}

// Normalizar chave PIX antes de gravar.
let pix_chave_normalizada = input.pix_chave;
if (input.pix_tipo && input.pix_chave) {
  switch (input.pix_tipo) {
    case "cpf":
    case "cnpj":
    case "telefone":
      pix_chave_normalizada = onlyDigits(input.pix_chave);
      break;
    case "email":
    case "aleatoria":
      pix_chave_normalizada = input.pix_chave.trim().toLowerCase();
      break;
  }
}
```

- [ ] **Step 4: Montar o payload de insert/update com os novos campos**

```ts
const payload = {
  ...(/* campos antigos: tipo_pessoa, nome, razao_social, cpf_cnpj,
        email, telefone, observacoes, status, created_by (só no insert) */),
  cep: input.cep,
  logradouro: input.logradouro,
  numero: input.numero,
  complemento: input.complemento,
  bairro: input.bairro,
  cidade: input.cidade,
  uf: input.uf,

  banco_codigo: input.banco_codigo,
  banco_nome,
  agencia: input.agencia,
  agencia_dv: input.agencia_dv,
  conta: input.conta,
  conta_dv: input.conta_dv,
  tipo_conta: input.tipo_conta,

  pix_tipo: input.pix_tipo,
  pix_chave: pix_chave_normalizada,
};

// insert (criar) ou update (atualizar) — manter o resto do fluxo,
// incluindo a chamada de log_audit_event.
```

- [ ] **Step 5: Criar a action `verificarPixDuplicado`**

Adicionar no fim do mesmo arquivo:

```ts
export async function verificarPixDuplicado(
  chave: string,
  excludeId?: string,
): Promise<{ existe: true; id: string; nome: string } | { existe: false }> {
  const chaveLimpa = chave.trim();
  if (!chaveLimpa) return { existe: false };

  const supabase = /* mesmo helper server-side usado nas outras actions */;

  let query = supabase
    .from("fornecedores")
    .select("id, nome")
    .eq("pix_chave", chaveLimpa)
    .eq("status", "ativo")
    .limit(1);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return { existe: false };
  return { existe: true, id: data.id, nome: data.nome };
}
```

Notas:
- Recebe a chave **normalizada** (o form deve normalizar antes de chamar; ou o server normaliza aqui — escolher e documentar). Escolha: o form normaliza aplicando as mesmas regras da Task 5 antes de chamar. Isso evita duplicar lógica no server.
- Sem `count(*)` — apenas um `select limit 1` para saber se existe.
- Confia em RLS: retorna só fornecedores do tenant do usuário logado.

- [ ] **Step 6: Typecheck + build**

```powershell
npm run typecheck
npm run build
```

Expected: 0 erros em ambos.

- [ ] **Step 7: Commit**

```powershell
git add app/(app)/fornecedores/actions.ts
git commit -m "feat(fornecedores): actions gravam banco/PIX e verificam duplicidade de chave"
```

---

## Task 7: Form em seções com ViaCEP, combobox banco, PIX e sticky submit

**Files:**
- Modify: `app/(app)/fornecedores/fornecedor-form.tsx` (reescrita ampla — manter a exportação e assinatura de props)

**Interfaces:**
- Consumes: `Combobox` de `components/ui/combobox.tsx`; `BANCOS_FEBRABAN` de `lib/dados/bancos-febraban.ts`; `MaskedInput` (com máscara `cep` nova); `verificarPixDuplicado` de `./actions`; `Fornecedor`, `TipoContaBancaria`, `PixTipoChave` de `lib/types`.
- Produces: componente `<FornecedorForm fornecedor?={Fornecedor}>` — assinatura inalterada. Rende form com 5 seções (Identificação, Endereço, Bancário, PIX, Observações) + submit sticky no rodapé.

- [ ] **Step 1: Reescrever o form em seções**

Modify: `app/(app)/fornecedores/fornecedor-form.tsx`

Estrutura geral:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Save } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import { Combobox } from "@/components/ui/combobox";
import { BANCOS_FEBRABAN } from "@/lib/dados/bancos-febraban";
import { onlyDigits, cn } from "@/lib/utils";
import type { Fornecedor, TipoPessoa, TipoContaBancaria, PixTipoChave, UF } from "@/lib/types";
import {
  atualizarFornecedor,
  criarFornecedor,
  verificarPixDuplicado,
  type ActionResult,
} from "./actions";

const UFS: UF[] = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

interface Props { fornecedor?: Fornecedor }

export function FornecedorForm({ fornecedor }: Props) {
  const router = useRouter();
  const isEdit = Boolean(fornecedor);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // Estado controlado só do que precisa reagir (toggle, combobox, PIX tipo,
  // avisos assíncronos). O restante fica em uncontrolled inputs.
  const [tipoPessoa, setTipoPessoa] = React.useState<TipoPessoa>(fornecedor?.tipo_pessoa ?? "juridica");
  const [bancoCodigo, setBancoCodigo] = React.useState<string | null>(fornecedor?.banco_codigo ?? null);
  const [pixTipo, setPixTipo] = React.useState<PixTipoChave | "">(fornecedor?.pix_tipo ?? "");
  const [pixChave, setPixChave] = React.useState<string>(fornecedor?.pix_chave ?? "");
  const [pixWarning, setPixWarning] = React.useState<string | null>(null);

  // ... (ViaCEP + PIX duplicado abaixo)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("tipo_pessoa", tipoPessoa);
    formData.set("banco_codigo", bancoCodigo ?? "");
    formData.set("pix_tipo", pixTipo);
    formData.set("pix_chave", pixChave);
    formData.set("cpf_cnpj", onlyDigits(formData.get("cpf_cnpj")?.toString() ?? ""));
    formData.set("telefone", onlyDigits(formData.get("telefone")?.toString() ?? ""));
    formData.set("cep", onlyDigits(formData.get("cep")?.toString() ?? ""));

    startTransition(async () => {
      const res: ActionResult = isEdit
        ? await atualizarFornecedor(fornecedor!.id, formData)
        : await criarFornecedor(formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        // Rolar até primeiro campo com erro
        const firstField = res.fieldErrors ? Object.keys(res.fieldErrors)[0] : null;
        if (firstField) {
          const el = document.querySelector<HTMLElement>(`[data-field="${firstField}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      if (isEdit) router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-24">
      {/* 5 sections + sticky footer */}
    </form>
  );
}
```

- [ ] **Step 2: Implementar a seção Identificação (mantendo comportamento atual)**

Dentro do form, primeira `<section>`:

```tsx
<section className="rounded-2xl border border-border bg-white p-6 space-y-4">
  <h3 className="text-base font-semibold">Identificação</h3>

  {/* Toggle PF/PJ — igual ao existente */}
  {/* Nome / Nome fantasia + Razão social (só PJ) */}
  {/* CPF/CNPJ + E-mail + Telefone */}
</section>
```

Manter a lógica atual do toggle e dos campos existentes; apenas envolver em `<section>` e usar `data-field="{name}"` no wrapper de cada campo pra o scrollIntoView achar.

- [ ] **Step 3: Implementar a seção Endereço com ViaCEP**

```tsx
<section className="rounded-2xl border border-border bg-white p-6 space-y-4">
  <h3 className="text-base font-semibold">Endereço</h3>

  <div className="grid gap-4 md:grid-cols-2">
    <Field label="CEP" name="cep" required errors={fieldErrors}>
      <div className="relative">
        <MaskedInput
          mask="cep"
          name="cep"
          defaultValue={fornecedor?.cep ?? ""}
          onBlur={handleCepBlur}
          ref={cepRef}
        />
        {cepLoading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 border-california-red/30 border-t-california-red animate-spin" />
        )}
      </div>
      {cepError && <p className="text-xs text-muted-foreground mt-1">{cepError}</p>}
    </Field>

    {/* Logradouro, Número, Complemento, Bairro, Cidade, UF */}
  </div>
</section>
```

Handler ViaCEP (adicionar no topo do componente):

```tsx
const cepRef = React.useRef<HTMLInputElement>(null);
const logradouroRef = React.useRef<HTMLInputElement>(null);
const bairroRef = React.useRef<HTMLInputElement>(null);
const cidadeRef = React.useRef<HTMLInputElement>(null);
const ufRef = React.useRef<HTMLSelectElement>(null);
const [cepLoading, setCepLoading] = React.useState(false);
const [cepError, setCepError] = React.useState<string | null>(null);

async function handleCepBlur() {
  const cep = onlyDigits(cepRef.current?.value ?? "");
  if (cep.length !== 8) return;

  setCepLoading(true);
  setCepError(null);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 3000);

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal });
    const data = await res.json();
    if (data.erro) {
      setCepError("CEP não encontrado, preencha manualmente.");
      return;
    }
    // Só preenche o que está vazio
    if (logradouroRef.current && !logradouroRef.current.value) logradouroRef.current.value = data.logradouro ?? "";
    if (bairroRef.current && !bairroRef.current.value) bairroRef.current.value = data.bairro ?? "";
    if (cidadeRef.current && !cidadeRef.current.value) cidadeRef.current.value = data.localidade ?? "";
    if (ufRef.current && !ufRef.current.value && data.uf) ufRef.current.value = data.uf;
  } catch {
    setCepError("Não foi possível consultar o CEP, preencha manualmente.");
  } finally {
    clearTimeout(to);
    setCepLoading(false);
  }
}
```

Os inputs do endereço usam `ref={logradouroRef}` etc. e `defaultValue={fornecedor?.logradouro ?? ""}`.

- [ ] **Step 4: Implementar a seção Dados Bancários com Combobox**

```tsx
<section className="rounded-2xl border border-border bg-white p-6 space-y-4">
  <div>
    <h3 className="text-base font-semibold">Dados bancários</h3>
    <p className="text-xs text-muted-foreground">Preencha os dados bancários OU o PIX (pelo menos um).</p>
  </div>

  <Field label="Banco" name="banco_codigo" errors={fieldErrors}>
    <Combobox
      items={BANCOS_FEBRABAN.map(b => ({ value: b.codigo, label: `${b.codigo} - ${b.nome}` }))}
      value={bancoCodigo}
      onChange={setBancoCodigo}
      placeholder="Selecione o banco"
      name="banco_codigo"
    />
  </Field>

  <div className="grid gap-4 md:grid-cols-4">
    <Field label="Agência" name="agencia" errors={fieldErrors}>
      <Input name="agencia" inputMode="numeric" maxLength={5} defaultValue={fornecedor?.agencia ?? ""} />
    </Field>
    <Field label="Dígito" name="agencia_dv" errors={fieldErrors}>
      <Input name="agencia_dv" maxLength={1} defaultValue={fornecedor?.agencia_dv ?? ""} />
    </Field>
    <Field label="Conta" name="conta" errors={fieldErrors}>
      <Input name="conta" inputMode="numeric" maxLength={12} defaultValue={fornecedor?.conta ?? ""} />
    </Field>
    <Field label="Dígito" name="conta_dv" errors={fieldErrors}>
      <Input name="conta_dv" maxLength={1} defaultValue={fornecedor?.conta_dv ?? ""} />
    </Field>
  </div>

  <Field label="Tipo de conta" name="tipo_conta" errors={fieldErrors}>
    <select name="tipo_conta" defaultValue={fornecedor?.tipo_conta ?? ""}
      className="flex h-10 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm">
      <option value="">Selecione</option>
      <option value="corrente">Conta corrente</option>
      <option value="poupanca">Conta poupança</option>
      <option value="pagamento">Conta de pagamento</option>
    </select>
  </Field>
</section>
```

- [ ] **Step 5: Implementar a seção PIX (tipo dinâmico + warning duplicado)**

```tsx
<section className="rounded-2xl border border-border bg-white p-6 space-y-4">
  <h3 className="text-base font-semibold">PIX</h3>

  <div className="grid gap-4 md:grid-cols-2">
    <Field label="Tipo de chave" name="pix_tipo" errors={fieldErrors}>
      <select
        value={pixTipo}
        onChange={(e) => { setPixTipo(e.target.value as PixTipoChave | ""); setPixChave(""); setPixWarning(null); }}
        className="flex h-10 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm"
      >
        <option value="">Selecione</option>
        <option value="cpf">CPF</option>
        <option value="cnpj">CNPJ</option>
        <option value="email">E-mail</option>
        <option value="telefone">Telefone</option>
        <option value="aleatoria">Chave aleatória</option>
      </select>
    </Field>

    <Field label="Chave PIX" name="pix_chave" errors={fieldErrors}>
      <PixChaveInput
        tipo={pixTipo}
        value={pixChave}
        onChange={setPixChave}
        cpfCnpjDoFornecedor={/* pega do input de cpf_cnpj se preenchido */}
      />
      {pixWarning && (
        <div className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{pixWarning}</span>
        </div>
      )}
    </Field>
  </div>
</section>
```

Componente `PixChaveInput` (helper local, no mesmo arquivo):
- Se `tipo === "cpf"` ou `"cnpj"` → `<MaskedInput mask={tipo} ...>` + botão "Usar do cadastro" que copia o valor do campo `cpf_cnpj` do fornecedor atual (via ref) para o PIX.
- Se `tipo === "telefone"` → `<MaskedInput mask="telefone" ...>`.
- Se `tipo === "email"` → `<Input type="email" ...>`.
- Se `tipo === "aleatoria"` → `<Input maxLength={36} ...>`.
- Se `tipo === ""` → input desabilitado com placeholder "Selecione o tipo primeiro".

Debounce da verificação (dentro do form principal):

```tsx
React.useEffect(() => {
  if (!pixTipo || !pixChave) { setPixWarning(null); return; }

  // Normaliza igual à Task 6 (importante: bater com o que fica no banco)
  let chaveNormalizada = pixChave;
  if (pixTipo === "cpf" || pixTipo === "cnpj" || pixTipo === "telefone") {
    chaveNormalizada = onlyDigits(pixChave);
  } else {
    chaveNormalizada = pixChave.trim().toLowerCase();
  }
  if (!chaveNormalizada) { setPixWarning(null); return; }

  const t = setTimeout(async () => {
    const res = await verificarPixDuplicado(chaveNormalizada, fornecedor?.id);
    if (res.existe) {
      setPixWarning(`Já existe fornecedor com esta chave PIX: "${res.nome}". Confirme se está correto.`);
    } else {
      setPixWarning(null);
    }
  }, 500);

  return () => clearTimeout(t);
}, [pixTipo, pixChave, fornecedor?.id]);
```

- [ ] **Step 6: Implementar a seção Observações + footer sticky**

```tsx
<section className="rounded-2xl border border-border bg-white p-6 space-y-4">
  <h3 className="text-base font-semibold">Observações</h3>
  <Field label="Observações" name="observacoes" errors={fieldErrors}>
    <Textarea name="observacoes" defaultValue={fornecedor?.observacoes ?? ""} rows={4}
      placeholder="Especialidade, forma de pagamento habitual..." />
  </Field>
</section>

{error && (
  <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
    <span>{error}</span>
  </div>
)}

{/* Footer sticky */}
<div className="sticky bottom-0 -mx-6 border-t border-border bg-white/95 backdrop-blur px-6 py-4 flex items-center justify-end gap-3">
  <Link href="/fornecedores" className="...cancelar...">Cancelar</Link>
  <button type="submit" disabled={pending} className="...salvar...">
    {pending ? "Salvando..." : (isEdit ? "Salvar alterações" : "Criar fornecedor")}
  </button>
</div>
```

- [ ] **Step 7: Typecheck + build**

```powershell
npm run typecheck
npm run build
```

Expected: 0 erros.

- [ ] **Step 8: Smoke test manual**

```powershell
npm run dev
```

Roteiro (executar tudo antes de commitar):
1. Ir em `/fornecedores/novo`.
2. Preencher só o nome e clicar Criar → deve mostrar erro "Preencha os dados bancários OU o PIX" + erros de endereço em vermelho.
3. Preencher CEP `01310100`, sair do campo → auto-preenche logradouro/bairro/cidade/uf.
4. Selecionar banco `260 - Nu Pagamentos S.A.` no combobox (digitar "nu" e filtrar).
5. Preencher agência `0001`, conta `218443214`, dígito `7`, tipo `Conta de pagamento`.
6. Salvar sem PIX → deve criar com sucesso (banco completo basta).
7. Editar o mesmo fornecedor. Adicionar PIX CNPJ com o CNPJ dele. Salvar.
8. Criar OUTRO fornecedor com a mesma chave PIX → warning amarelo aparece.
9. Editar fornecedor antigo (sem os dados novos): abrir edição, ver que os campos aparecem vazios, tentar salvar sem completar → erro de validação; completar e salvar.
10. Cadastrar um fornecedor PF com só chave PIX telefone → deve funcionar.

Se algo quebrar, ajustar e re-rodar o roteiro.

- [ ] **Step 9: Commit**

```powershell
git add app/(app)/fornecedores/fornecedor-form.tsx
git commit -m "feat(fornecedores): form em secoes com endereco, banco, PIX e submit sticky"
```

---

## Task 8: Badge "Dados incompletos" na lista + verificação final

**Files:**
- Modify: `app/(app)/fornecedores/fornecedores-list.tsx`
- Modify (se necessário): `app/(app)/fornecedores/page.tsx` (para incluir os campos novos no `select`)

**Interfaces:**
- Consumes: `Fornecedor` (com campos novos).
- Produces: linha da lista mostra badge âmbar quando `cep IS NULL OR (banco_codigo IS NULL AND pix_chave IS NULL)`.

- [ ] **Step 1: Ler `fornecedores-list.tsx` e `page.tsx`**

Read: `app/(app)/fornecedores/fornecedores-list.tsx` e `app/(app)/fornecedores/page.tsx` para ver como os fornecedores são carregados e renderizados.

- [ ] **Step 2: Ajustar o `select` do Supabase se necessário**

Se `page.tsx` (ou onde carrega a lista) usa `select("*")`, já vem tudo. Se especifica colunas, adicionar `cep`, `banco_codigo`, `pix_chave` à lista.

- [ ] **Step 3: Renderizar o badge no item da lista**

Modify: `fornecedores-list.tsx` — na renderização de cada fornecedor, adicionar helper e badge:

```tsx
function fornecedorIncompleto(f: Fornecedor): boolean {
  return !f.cep || (!f.banco_codigo && !f.pix_chave);
}

// No render:
<span className="inline-flex items-center gap-2">
  {fornecedor.nome}
  {fornecedorIncompleto(fornecedor) && (
    <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      Dados incompletos
    </span>
  )}
</span>
```

Manter a regra do memory: linha inteira continua clicável; o badge é visual (`span`, sem interatividade).

- [ ] **Step 4: Typecheck + build**

```powershell
npm run typecheck
npm run lint
npm run build
```

Expected: 0 erros em todos.

- [ ] **Step 5: Smoke test da lista**

```powershell
npm run dev
```

- Ir em `/fornecedores`.
- Fornecedor recém-criado com todos os campos → sem badge.
- Fornecedor antigo (criado antes da migration) → badge "Dados incompletos".
- Clicar em fornecedor com badge → abre detalhe normalmente.

- [ ] **Step 6: Checklist de performance (docs/PERFORMANCE.md)**

Rodar mentalmente contra `docs/PERFORMANCE.md`:
- Nenhum `<Link>` novo em lista → ok.
- `verificarPixDuplicado`: `.limit(1)` + filtro por `pix_chave` (sem índice; ok pra escala do MVP; anotar como candidato a índice futuro se lista de fornecedores crescer >5k).
- ViaCEP: chamada client-side com timeout, não afeta SSR.
- Migration: sem novas tabelas → GRANTs herdados. `is_tenant_member` já é usado nas policies existentes (não estamos criando novas policies).
- `force-dynamic`: verificar em `/fornecedores` e `/fornecedores/[id]` — se já existia, manter.

- [ ] **Step 7: Commit final**

```powershell
git add app/(app)/fornecedores/fornecedores-list.tsx app/(app)/fornecedores/page.tsx
git commit -m "feat(fornecedores): badge de dados incompletos na lista"
```

---

## Ordem de execução

1. Task 1 (migration + tipos) — bloqueia tudo.
2. Task 2 (bancos + script) — pode ir em paralelo com Task 3 e Task 4.
3. Task 3 (máscara CEP) — sem dependências.
4. Task 4 (combobox) — sem dependências.
5. Task 5 (Zod) — depende de Task 1 (tipos) e Task 2 (getBancoByCodigo).
6. Task 6 (actions) — depende de Task 1, 2, 5.
7. Task 7 (form) — depende de Task 1, 2, 3, 4, 5, 6.
8. Task 8 (badge + verificação final) — depende de Task 1 e 7.