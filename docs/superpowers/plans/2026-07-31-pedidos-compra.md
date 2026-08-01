# Pedidos de Compra — Fase 1 (Emissão + Cancelamento) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Da linha do realizado no job, o GP/produção gera um Pedido de Compra formal (PDF impresso, anexos obrigatórios NF/comprovante) com fornecedor + empresa emissora selecionados; PP pode ser cancelada (hard delete de tudo).

**Architecture:** Nova tabela `pedidos_compra` (1:1 com `jobs_itens_realizado`, unique constraint) + `pedidos_compra_anexos`. Server actions com gates de tenant/status/ownership. PDF gerado via `pdfmake` no servidor (JS puro, serverless-friendly). Upload de anexos em 2 fases: client faz `supabase.storage.upload` direto (evita limite de 4.5MB do body Vercel), depois server action `finalizarPedidoCompra` persiste rows + gera PDF. Cancelamento apaga row + PDF + anexos via `storage.remove` + `DELETE` (cascade).

**Tech Stack:** Next.js 14 App Router, TypeScript 5, Supabase Postgres (RLS + GRANT + storage bucket), Supabase-js (server + browser), `pdfmake` (novo), Zod, Radix UI, Tailwind. Verificação via `npm run typecheck`, `npm run lint`, QA manual no browser.

## Global Constraints

- **Performance é feature** (`docs/PERFORMANCE.md`): `Promise.all` em queries independentes; migration nova → GRANT explícito pra `authenticated` + índices em FKs; RLS `is_tenant_member(tenant_id)`; `force-dynamic` nas pages autenticadas.
- **RLS ≠ GRANT** (`CLAUDE.md`): toda tabela nova termina com `grant select, insert, update, delete on ... to authenticated;`. Anexos: `grant select, insert, delete` (sem update — arquivo é imutável).
- **Larguras de layout** (`docs/09-identidade-visual-ui.md`): drawer sem restrição adicional (segue padrão `<DrawerContent>`); página do job já em `max-w-7xl`.
- **Header padrão** — não aplica (feature não introduz page nova; só drawer).
- **Radix `<SelectItem>` NUNCA aceita `value=""`** — usar sentinel `"__none__"` só se opcional; fornecedor e empresa são OBRIGATÓRIOS, então sem sentinel.
- **Radix `<PopoverContent>` de DatePicker**: `side="bottom"` + `sideOffset={6}` + `collisionPadding={16}` + `w-[300px]` + `<Calendar fixedWeeks>`.
- **Cores California**: vermelho `california-red` (`#E74B56`), fundo `bg-california-red/10` pra ícones em box.
- **Migration numbering**: usar `20260731000003_task010_pedidos_compra.sql` (confirmar via `ls supabase/migrations/` que ainda não foi tomado).
- **Sem emojis em código.**
- **Terminologia UI**: "Pedido de Compra" (não "PP" no visível ao usuário); "PP" só como código (PP-NNNNN) e em labels internos.
- **Windows environment**: `bash` tool com forward slashes; quotar paths com brackets.
- **PDF layout fiel ao anexo** exceto: sem Espécie/Formato/Cores/Meio/Acabamento; sem Prazo Entrega/Local Entrega; assinatura só do responsável do job.
- **Anexo limits**: 8 MB/arquivo, 25 MB total, mimetypes `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
- **Client-side Supabase**: `import { createClient } from "@/lib/supabase/client"` (padrão do projeto, usa `@supabase/ssr` browser client).
- **Snapshot na emissão**: `servico`, `valor`, `quantidade`, `especificacoes` gravados no ato; realizado mudar depois NÃO altera a PP.
- **Cancelamento**: hard delete (row + PDF + anexos); `jobs_itens_realizado.fornecedor_id` volta pra `null`.

---

## File Structure — mapa de mudanças

### Cria:

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260731000003_task010_pedidos_compra.sql` | ALTER `jobs_itens_realizado` (fornecedor_id) + tabelas `pedidos_compra` e `pedidos_compra_anexos` + bucket privado + policies + RLS + GRANTs + função `gerar_codigo_pp` |
| `lib/codigos/pedidos-compra.ts` | Helper `gerarCodigoPP(supabase, tenantId)` → chama RPC `gerar_codigo_pp` |
| `lib/pdf/pedido-compra.ts` | Função pura `renderPedidoCompraPDF(dados)` → `Buffer` — pdfmake docDefinition fiel ao layout do anexo |
| `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` | 6 server actions: `reservarPedidoCompra`, `finalizarPedidoCompra`, `abortarReserva`, `cancelarPedidoCompra`, `signedUrlPdf`, `signedUrlAnexo` |
| `app/(app)/jobs/[jobId]/realizado/pp-actions-cell.tsx` | Client component: renderiza ícones da trilha lateral (3 estados: Nenhum / Gerar / Ver+Cancelar) |
| `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx` | Client component: drawer com form + upload direto de anexos em 2 fases |

### Modifica:

| Arquivo | O que muda |
|---|---|
| `lib/types.ts` | Adiciona `PedidoCompra`, `PedidoCompraAnexo`, constantes `PP_ANEXO_*` |
| `lib/auth/audit.ts` | Adiciona 2 actions ao union: `"pedido_compra.emitida"`, `"pedido_compra.cancelada"` |
| `app/(app)/jobs/[jobId]/page.tsx` | Adiciona 3 queries ao `Promise.all`: PPs do job (com anexos), fornecedores ativos, empresas ativas. Passa `ppsPorItemId`, `fornecedores`, `empresas` pra `<JobRealizadoSection>` |
| `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx` | Passa `ppsPorItemId`, `fornecedores`, `empresas` down |
| `app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx` | Passa props down |
| `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` | Adiciona trilha lateral (`<div className="absolute left-full ml-2">`) com `<PPActionsCell>` alinhado por linha; recebe `ppsPorItemId`, `fornecedores`, `empresas`, `job.responsavel_id` como props |

### Deleta:
Nenhum arquivo.

---

## Task 1: Foundation — Migration + Types + Audit + Helper

**Files:**
- Create: `supabase/migrations/20260731000003_task010_pedidos_compra.sql`
- Create: `lib/codigos/pedidos-compra.ts`
- Modify: `lib/types.ts` (adicionar no fim, após tipos existentes)
- Modify: `lib/auth/audit.ts` (adicionar 2 actions ao union)

**Interfaces:**
- Consumes: nada (foundation).
- Produces:
  - Coluna `jobs_itens_realizado.fornecedor_id` (nullable, FK `fornecedores` on delete restrict).
  - Tabelas `public.pedidos_compra` e `public.pedidos_compra_anexos`.
  - Função Postgres `gerar_codigo_pp(p_tenant_id uuid) returns text`.
  - Bucket `pedidos-compra` (privado) com 3 policies em `storage.objects`.
  - Types `PedidoCompra`, `PedidoCompraAnexo` + constantes `PP_ANEXO_MIMETYPES_ACEITOS`, `PP_ANEXO_TAMANHO_MAX_BYTES`, `PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES`.
  - `AuditAction` inclui `"pedido_compra.emitida"` e `"pedido_compra.cancelada"`.
  - `gerarCodigoPP(supabase, tenantId): Promise<string>` — chama RPC.

- [ ] **Step 1: Confirmar número de migration disponível**

Rodar `ls supabase/migrations/ | tail -5`. Confirmar que `20260731000003_*` não existe. Se existir, usar o próximo disponível e ajustar todos os steps subsequentes.

- [ ] **Step 2: Criar arquivo de migration**

Criar `supabase/migrations/20260731000003_task010_pedidos_compra.sql`:

```sql
-- =====================================================================
-- Task 010 fase 1 — Pedidos de Compra (emissao + cancelamento)
-- Ver spec: docs/superpowers/specs/2026-07-31-pedidos-compra-design.md
-- =====================================================================

-- 1. jobs_itens_realizado ganha fornecedor_id (populado ao gerar PP)
alter table public.jobs_itens_realizado
  add column if not exists fornecedor_id uuid
    references public.fornecedores(id) on delete restrict;

create index if not exists idx_realizado_fornecedor
  on public.jobs_itens_realizado(fornecedor_id);

-- 2. pedidos_compra (1:1 com item_realizado)
create table if not exists public.pedidos_compra (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  codigo                text not null,

  item_realizado_id     uuid not null references public.jobs_itens_realizado(id) on delete restrict,
  job_id                uuid not null references public.jobs(id) on delete restrict,
  fornecedor_id         uuid not null references public.fornecedores(id) on delete restrict,
  empresa_id            uuid not null references public.empresas(id) on delete restrict,

  servico               text not null,
  quantidade            numeric(12,3) not null,
  especificacoes        text,
  valor                 numeric(14,2) not null,
  prazo_pagamento       date not null,

  pdf_path              text not null,

  emitida_por           uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uniq_pp_por_item_realizado unique (item_realizado_id),
  constraint uniq_pp_codigo_por_tenant  unique (tenant_id, codigo),
  constraint pp_servico_nao_vazio       check (length(trim(servico)) > 0),
  constraint pp_quantidade_positiva     check (quantidade > 0),
  constraint pp_valor_positivo          check (valor > 0)
);

create index if not exists idx_pp_tenant on public.pedidos_compra(tenant_id);
create index if not exists idx_pp_job on public.pedidos_compra(job_id);
create index if not exists idx_pp_fornecedor on public.pedidos_compra(fornecedor_id);
create index if not exists idx_pp_empresa on public.pedidos_compra(empresa_id);

drop trigger if exists trg_pp_updated_at on public.pedidos_compra;
create trigger trg_pp_updated_at
before update on public.pedidos_compra
for each row execute function public.set_updated_at();

-- 3. Anexos (N por PP, obrigatorio >=1 no server action)
create table if not exists public.pedidos_compra_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  pedido_compra_id      uuid not null references public.pedidos_compra(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  constraint anexo_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index if not exists idx_pp_anexos_pp on public.pedidos_compra_anexos(pedido_compra_id);
create index if not exists idx_pp_anexos_tenant on public.pedidos_compra_anexos(tenant_id);

-- 4. RLS + GRANTs
alter table public.pedidos_compra enable row level security;
alter table public.pedidos_compra_anexos enable row level security;

drop policy if exists pp_select on public.pedidos_compra;
create policy pp_select on public.pedidos_compra
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists pp_insert on public.pedidos_compra;
create policy pp_insert on public.pedidos_compra
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
drop policy if exists pp_update on public.pedidos_compra;
create policy pp_update on public.pedidos_compra
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
drop policy if exists pp_delete on public.pedidos_compra;
create policy pp_delete on public.pedidos_compra
  for delete to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_anexos_select on public.pedidos_compra_anexos;
create policy pp_anexos_select on public.pedidos_compra_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists pp_anexos_insert on public.pedidos_compra_anexos;
create policy pp_anexos_insert on public.pedidos_compra_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
drop policy if exists pp_anexos_delete on public.pedidos_compra_anexos;
create policy pp_anexos_delete on public.pedidos_compra_anexos
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.pedidos_compra to authenticated;
grant select, insert, delete on public.pedidos_compra_anexos to authenticated;

-- 5. Bucket privado pedidos-compra
insert into storage.buckets (id, name, public)
values ('pedidos-compra', 'pedidos-compra', false)
on conflict (id) do nothing;

drop policy if exists pp_storage_select on storage.objects;
create policy pp_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists pp_storage_insert on storage.objects;
create policy pp_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists pp_storage_delete on storage.objects;
create policy pp_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

-- 6. Sequencial PP-NNNNN por tenant (funcao com lock)
create or replace function public.gerar_codigo_pp(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prox integer;
  v_codigo text;
begin
  perform pg_advisory_xact_lock(hashtext('pp_seq_' || p_tenant_id::text));

  select coalesce(max(cast(substring(codigo from '^PP-(\d+)$') as integer)), 0) + 1
    into v_prox
    from public.pedidos_compra
    where tenant_id = p_tenant_id
      and codigo ~ '^PP-\d+$';

  v_codigo := 'PP-' || lpad(v_prox::text, 5, '0');
  return v_codigo;
end;
$$;

grant execute on function public.gerar_codigo_pp(uuid) to authenticated;
```

- [ ] **Step 3: Aplicar migration via MCP Supabase**

Usar `mcp__supabase-write__apply_migration` com:
- `name`: `task010_pedidos_compra`
- `query`: conteúdo do arquivo SQL acima.

- [ ] **Step 4: Validar migration aplicada**

Usar `mcp__supabase__list_tables` (schemas: `["public"]`) e confirmar que `pedidos_compra` e `pedidos_compra_anexos` aparecem com RLS enabled.

Também validar bucket via `mcp__supabase__execute_sql`:
```sql
select id, name, public from storage.buckets where id = 'pedidos-compra';
```
Deve retornar 1 row com `public = false`.

Validar função:
```sql
select public.gerar_codigo_pp('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid);
```
Deve retornar `PP-00001` (ou próximo disponível se já rodou antes).

- [ ] **Step 5: Adicionar types em `lib/types.ts`**

Localizar a região de types de Job (procurar por `export interface JobItemRealizado`). Depois desse bloco, adicionar:

```ts
// ---------- Task 010: Pedidos de Compra ----------

export interface PedidoCompra {
  id: string;
  tenant_id: string;
  codigo: string;
  item_realizado_id: string;
  job_id: string;
  fornecedor_id: string;
  empresa_id: string;
  servico: string;
  quantidade: number;
  especificacoes: string | null;
  valor: number;
  prazo_pagamento: string;
  pdf_path: string;
  emitida_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface PedidoCompraAnexo {
  id: string;
  tenant_id: string;
  pedido_compra_id: string;
  arquivo_path: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
  arquivo_mimetype: string;
  created_by: string | null;
  created_at: string;
}

export const PP_ANEXO_MIMETYPES_ACEITOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PPAnexoMimetype = (typeof PP_ANEXO_MIMETYPES_ACEITOS)[number];

export const PP_ANEXO_TAMANHO_MAX_BYTES = 8 * 1024 * 1024;
export const PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES = 25 * 1024 * 1024;
```

- [ ] **Step 6: Adicionar audit actions em `lib/auth/audit.ts`**

Localizar o union `AuditAction`. Depois da última entry de `job.*`, adicionar:

```ts
  | "pedido_compra.emitida"
  | "pedido_compra.cancelada"
```

- [ ] **Step 7: Criar helper `lib/codigos/pedidos-compra.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Gera o proximo codigo PP-NNNNN sequencial por tenant.
 * Chama a funcao Postgres gerar_codigo_pp que usa advisory lock pra
 * serializar geracoes concorrentes sem penalizar leitura.
 */
export async function gerarCodigoPP(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("gerar_codigo_pp", {
    p_tenant_id: tenantId,
  });
  if (error) throw new Error(`Falha ao gerar codigo PP: ${error.message}`);
  return data as string;
}
```

- [ ] **Step 8: Typecheck**

Rodar: `npm run typecheck`
Esperado: passa sem erros.

- [ ] **Step 9: Commit**

```powershell
git add supabase/migrations/20260731000003_task010_pedidos_compra.sql lib/codigos/pedidos-compra.ts lib/types.ts lib/auth/audit.ts
git commit -m "task010: migration pedidos_compra + types + audit + helper de codigo"
```

---

## Task 2: PDF renderer

**Files:**
- Create: `lib/pdf/pedido-compra.ts`

**Interfaces:**
- Consumes:
  - Types `PedidoCompra`, `Empresa`, `Fornecedor`, `Job`, `Projeto`, `Orcamento`, `Cliente` de `@/lib/types` (Task 1 adicionou PedidoCompra; os outros já existem).
- Produces:
  - `renderPedidoCompraPDF(dados): Promise<Buffer>` — função pura, sem side effects.

- [ ] **Step 1: Instalar pdfmake**

```powershell
npm install pdfmake
npm install --save-dev @types/pdfmake
```

- [ ] **Step 2: Criar `lib/pdf/pedido-compra.ts`**

```ts
import PdfPrinter from "pdfmake/src/printer";
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import fs from "node:fs";
import path from "node:path";
import type {
  PedidoCompra,
  Empresa,
  Fornecedor,
  Job,
  Projeto,
  Orcamento,
  Cliente,
} from "@/lib/types";

// Fontes stock do pdfmake (bundled com o pacote em vfs_fonts).
// Usa Helvetica (built-in) — sem custom fonts pra manter bundle enxuto.
const printer = new PdfPrinter({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
});

// Cache do logo em base64 (le do disco 1x por processo)
let LOGO_BASE64: string | null = null;
function getLogoBase64(): string {
  if (LOGO_BASE64) return LOGO_BASE64;
  const logoPath = path.join(process.cwd(), "public", "brand", "logo-icon.png");
  const buffer = fs.readFileSync(logoPath);
  LOGO_BASE64 = `data:image/png;base64,${buffer.toString("base64")}`;
  return LOGO_BASE64;
}

// Formatters
function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function fmtCNPJ(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function fmtCPFCNPJ(digits: string | null): string {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return fmtCNPJ(d);
  return digits;
}
function fmtCEP(digits: string | null): string {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.length !== 8) return digits;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
function fmtFone(digits: string | null): string {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return digits;
}

// Estilos de faixa (labels de secao)
function faixaTitulo(texto: string): Content {
  return {
    text: texto,
    style: "faixa",
    alignment: "center",
    fillColor: "#e5e5e5",
    margin: [0, 4, 0, 4],
  };
}

interface Dados {
  pp: Pick<
    PedidoCompra,
    | "codigo"
    | "servico"
    | "quantidade"
    | "especificacoes"
    | "valor"
    | "prazo_pagamento"
    | "created_at"
  >;
  empresa: Empresa;
  fornecedor: Fornecedor;
  job: Pick<Job, "nome" | "produto">;
  projeto: Pick<Projeto, "codigo" | "campanha">;
  orcamento: Pick<Orcamento, "codigo">;
  cliente: Pick<Cliente, "nome_fantasia">;
  responsavelNome: string;
}

export async function renderPedidoCompraPDF(dados: Dados): Promise<Buffer> {
  const { pp, empresa, fornecedor, job, projeto, orcamento, cliente, responsavelNome } = dados;

  const logo = getLogoBase64();

  const enderecoEmpresa = [
    empresa.logradouro,
    empresa.numero,
    empresa.complemento,
    empresa.bairro,
  ]
    .filter(Boolean)
    .join(", ");

  const enderecoFornecedor = [
    fornecedor.logradouro,
    fornecedor.numero,
    fornecedor.complemento,
    fornecedor.bairro,
  ]
    .filter(Boolean)
    .join(", ");

  const content: Content[] = [
    // 1. HEADER — logo + dados California | box PP + codigo
    {
      columns: [
        {
          width: "60%",
          stack: [
            { image: logo, width: 60, margin: [0, 0, 0, 4] },
            { text: empresa.razao_social, bold: true, fontSize: 9 },
            { text: enderecoEmpresa, fontSize: 8 },
            {
              text: `${fmtCEP(empresa.cep)} ${empresa.cidade} - ${empresa.uf}`,
              fontSize: 8,
            },
            {
              text: `FONE ${fmtFone(empresa.telefone)}`,
              fontSize: 8,
            },
            { text: `CNPJ: ${fmtCNPJ(empresa.cnpj)}`, fontSize: 8 },
            {
              text: `Inscricao Estadual: ${empresa.inscricao_estadual ?? "ISENTO"}`,
              fontSize: 8,
            },
            {
              text: `Inscricao Municipal: ${empresa.inscricao_municipal ?? ""}`,
              fontSize: 8,
            },
            { text: `E-mail: ${empresa.email ?? ""}`, fontSize: 8 },
          ],
        },
        {
          width: "40%",
          stack: [
            {
              text: "Pedido de Producao",
              alignment: "center",
              bold: true,
              fontSize: 12,
              margin: [0, 20, 0, 8],
            },
            {
              text: pp.codigo,
              alignment: "center",
              bold: true,
              fontSize: 20,
            },
          ],
        },
      ],
      margin: [0, 0, 0, 8],
    },

    // 2. GRID metadata (Cliente/Fornecedor/Emissao | Produto/Orcamento/Projeto | Titulo/Campanha)
    {
      columns: [
        {
          width: "60%",
          stack: [
            { text: [{ text: "Cliente: ", bold: true }, cliente.nome_fantasia], fontSize: 9 },
            { text: [{ text: "Fornecedor: ", bold: true }, fornecedor.razao_social ?? fornecedor.nome], fontSize: 9 },
            { text: [{ text: "Produto: ", bold: true }, job.produto ?? ""], fontSize: 9 },
            { text: [{ text: "Titulo: ", bold: true }, job.nome], fontSize: 9 },
            { text: [{ text: "Campanha: ", bold: true }, projeto.campanha ?? ""], fontSize: 9 },
          ],
        },
        {
          width: "40%",
          stack: [
            { text: [{ text: "Emissao: ", bold: true }, fmtDate(pp.created_at)], fontSize: 9 },
            { text: [{ text: "Orcamento: ", bold: true }, orcamento.codigo], fontSize: 9 },
            { text: [{ text: "Projeto: ", bold: true }, projeto.codigo], fontSize: 9 },
          ],
        },
      ],
      margin: [0, 0, 0, 8],
    },

    // 3. Faixa SOLICITAMOS
    faixaTitulo("SOLICITAMOS POR ORDEM DO SACADO, O SEGUINTE SERVICO"),

    // 4. Servico + quantidade + prazo pagto
    {
      columns: [
        { width: "70%", text: [{ text: "Servico: ", bold: true }, pp.servico], fontSize: 9 },
        { width: "30%", text: [{ text: "Quantidade: ", bold: true }, String(pp.quantidade)], fontSize: 9 },
      ],
      margin: [0, 4, 0, 4],
    },
    {
      text: [{ text: "Prazo de Pagto: ", bold: true }, fmtDate(pp.prazo_pagamento)],
      fontSize: 9,
      margin: [0, 0, 0, 8],
    },

    // 5. Especificacoes (condicional)
    ...(pp.especificacoes && pp.especificacoes.trim()
      ? [
          faixaTitulo("ESPECIFICACOES DO SERVICO"),
          {
            text: pp.especificacoes,
            fontSize: 9,
            margin: [0, 4, 0, 8],
          } as Content,
        ]
      : []),

    // 6. Dados para faturamento (empresa emissora)
    faixaTitulo("DADOS PARA FATURAMENTO DA COBRANCA"),
    {
      columns: [
        {
          width: "60%",
          stack: [
            { text: [{ text: "Nome do Sacado: ", bold: true }, empresa.razao_social], fontSize: 9 },
            { text: [{ text: "Endereco: ", bold: true }, enderecoEmpresa], fontSize: 9 },
            { text: [{ text: "Municipio: ", bold: true }, empresa.cidade], fontSize: 9 },
            {
              text: [
                { text: "Local de Pagto: ", bold: true },
                empresa.local_pagamento ?? enderecoEmpresa,
              ],
              fontSize: 9,
            },
            { text: [{ text: "CNPJ: ", bold: true }, fmtCNPJ(empresa.cnpj)], fontSize: 9 },
          ],
        },
        {
          width: "40%",
          stack: [
            { text: [{ text: "CEP: ", bold: true }, fmtCEP(empresa.cep)], fontSize: 9 },
            { text: [{ text: "UF: ", bold: true }, empresa.uf], fontSize: 9 },
            { text: [{ text: "Telefone: ", bold: true }, fmtFone(empresa.telefone)], fontSize: 9 },
            {
              text: [
                { text: "IE: ", bold: true },
                empresa.inscricao_estadual ?? "ISENTO",
              ],
              fontSize: 9,
            },
            {
              text: [
                { text: "IM: ", bold: true },
                empresa.inscricao_municipal ?? "",
              ],
              fontSize: 9,
            },
          ],
        },
      ],
      margin: [0, 4, 0, 8],
    },

    // 7. Dados bancarios fornecedor
    faixaTitulo("DADOS BANCARIOS DO FORNECEDOR PARA PAGAMENTO"),
    {
      columns: [
        {
          width: "50%",
          stack: [
            {
              text: [
                { text: "Banco: ", bold: true },
                `${fornecedor.banco_codigo ?? ""} - ${fornecedor.banco_nome ?? ""}`,
              ],
              fontSize: 9,
            },
            { text: [{ text: "Agencia: ", bold: true }, fornecedor.agencia ?? ""], fontSize: 9 },
            { text: [{ text: "Conta: ", bold: true }, `${fornecedor.conta ?? ""}${fornecedor.conta_dv ? "-" + fornecedor.conta_dv : ""}`], fontSize: 9 },
            { text: [{ text: "Tipo de Conta: ", bold: true }, fornecedor.tipo_conta ?? ""], fontSize: 9 },
          ],
        },
        {
          width: "50%",
          stack: [
            {
              text: [
                { text: "Nome: ", bold: true },
                fornecedor.razao_social ?? fornecedor.nome,
              ],
              fontSize: 9,
            },
            {
              text: [
                { text: "CNPJ/CPF: ", bold: true },
                fmtCPFCNPJ(fornecedor.cpf_cnpj),
              ],
              fontSize: 9,
            },
            {
              text: [
                { text: "Tipo de Chave PIX: ", bold: true },
                fornecedor.pix_tipo ?? "",
              ],
              fontSize: 9,
            },
            {
              text: [
                { text: "Chave PIX: ", bold: true },
                fornecedor.pix_chave ?? "",
              ],
              fontSize: 9,
            },
          ],
        },
      ],
      margin: [0, 4, 0, 8],
    },

    // 8. VALOR destacado
    {
      table: {
        widths: ["*"],
        body: [
          [
            {
              text: [
                { text: "Valor:  ", bold: true, fontSize: 12 },
                { text: fmtBRL(pp.valor), bold: true, fontSize: 14 },
              ],
              alignment: "right",
              fillColor: "#e5e5e5",
              margin: [8, 6, 8, 6],
            },
          ],
        ],
      },
      layout: "noBorders",
      margin: [0, 4, 0, 8],
    },

    // 9. Dados do fornecedor (endereco/contato)
    faixaTitulo("DADOS DO FORNECEDOR"),
    {
      columns: [
        {
          width: "60%",
          stack: [
            {
              text: [
                { text: "Razao Social: ", bold: true },
                fornecedor.razao_social ?? fornecedor.nome,
              ],
              fontSize: 9,
            },
            { text: [{ text: "Endereco: ", bold: true }, enderecoFornecedor], fontSize: 9 },
            {
              text: [
                { text: "Municipio: ", bold: true },
                `${fornecedor.cidade ?? ""}/${fornecedor.uf ?? ""} CEP: ${fmtCEP(fornecedor.cep)}`,
              ],
              fontSize: 9,
            },
            { text: [{ text: "CNPJ/CPF: ", bold: true }, fmtCPFCNPJ(fornecedor.cpf_cnpj)], fontSize: 9 },
            { text: [{ text: "E-mail: ", bold: true }, fornecedor.email ?? ""], fontSize: 9 },
          ],
        },
        {
          width: "40%",
          stack: [
            { text: [{ text: "Fone: ", bold: true }, fmtFone(fornecedor.telefone)], fontSize: 9 },
          ],
        },
      ],
      margin: [0, 4, 0, 20],
    },

    // 10. Assinaturas (footer)
    {
      columns: [
        {
          width: "50%",
          stack: [
            { text: "Concordamos com as condicoes do presente pedido.", alignment: "center", fontSize: 8, margin: [0, 20, 0, 20] },
            { canvas: [{ type: "line", x1: 30, y1: 0, x2: 220, y2: 0, lineWidth: 0.5 }] },
            { text: "Assinatura do Fornecedor", alignment: "center", fontSize: 8, margin: [0, 4, 0, 0] },
          ],
        },
        {
          width: "50%",
          stack: [
            { text: empresa.razao_social, alignment: "center", fontSize: 8, margin: [0, 20, 0, 20] },
            { canvas: [{ type: "line", x1: 30, y1: 0, x2: 220, y2: 0, lineWidth: 0.5 }] },
            {
              text: [
                { text: "Assinatura do resp. pelo pedido\n", fontSize: 8 },
                { text: responsavelNome.toUpperCase(), fontSize: 8, bold: true },
              ],
              alignment: "center",
              margin: [0, 4, 0, 0],
            },
          ],
        },
      ],
    },
  ];

  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [30, 30, 30, 30],
    content,
    defaultStyle: { font: "Helvetica", fontSize: 9 },
    styles: {
      faixa: { bold: true, fontSize: 10 },
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: empresa.razao_social, alignment: "left", fontSize: 7, margin: [30, 0, 0, 0] },
        { text: `Pagina: ${currentPage}/${pageCount}`, alignment: "center", fontSize: 7 },
        { text: `Data ${fmtDate(pp.created_at)}`, alignment: "right", fontSize: 7, margin: [0, 0, 30, 0] },
      ],
    }),
  };

  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
```

- [ ] **Step 3: Typecheck**

Rodar: `npm run typecheck`
Esperado: passa. Se der erro sobre `pdfmake/src/printer` não encontrado, adicionar declaração de tipo:

Criar `types/pdfmake.d.ts` (se ainda não existir):
```ts
declare module "pdfmake/src/printer" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";
  export default class PdfPrinter {
    constructor(fontDescriptors: Record<string, unknown>);
    createPdfKitDocument(docDefinition: TDocumentDefinitions): NodeJS.ReadableStream;
  }
}
```

E confirmar que `tsconfig.json` inclui `types/**/*.d.ts` no `include` (já deve incluir por padrão via glob).

- [ ] **Step 4: Sanity test do renderer (opcional mas recomendado)**

Criar temporariamente um script standalone:
```powershell
node -e "const {renderPedidoCompraPDF} = require('./lib/pdf/pedido-compra.ts'); /* ... */"
```

Ou, mais prático: fazer o QA manual junto com a Task 5 (drawer + geração real de PP).

- [ ] **Step 5: Commit**

```powershell
git add lib/pdf/pedido-compra.ts package.json package-lock.json types/pdfmake.d.ts
git commit -m "task010: renderer de PDF do pedido de compra com pdfmake"
```

Se `types/pdfmake.d.ts` não foi criado, remove do `git add`.

---

## Task 3: Server actions

**Files:**
- Create: `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`

**Interfaces:**
- Consumes:
  - `requireSession()` de `@/lib/auth/session`.
  - `createClient()` de `@/lib/supabase/server`.
  - `logAuditEvent()` de `@/lib/auth/audit`.
  - `gerarCodigoPP()` de `@/lib/codigos/pedidos-compra` (Task 1).
  - `renderPedidoCompraPDF()` de `@/lib/pdf/pedido-compra` (Task 2).
  - Types de `@/lib/types` (Task 1).
- Produces:
  - `reservarPedidoCompra(itemRealizadoId): Promise<{ok, pp_id, upload_prefix} | {ok:false, message}>`
  - `finalizarPedidoCompra(pp_id, dados, anexos): Promise<{ok, codigo} | {ok:false, message}>`
  - `abortarReserva(pp_id): Promise<{ok} | {ok:false, message}>`
  - `cancelarPedidoCompra(pp_id): Promise<{ok} | {ok:false, message}>`
  - `signedUrlPdf(pp_id): Promise<{ok, url} | {ok:false, message}>`
  - `signedUrlAnexo(anexo_id): Promise<{ok, url} | {ok:false, message}>`

- [ ] **Step 1: Criar arquivo com estrutura completa**

Criar `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { gerarCodigoPP } from "@/lib/codigos/pedidos-compra";
import { renderPedidoCompraPDF } from "@/lib/pdf/pedido-compra";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  type PPAnexoMimetype,
} from "@/lib/types";

const BUCKET = "pedidos-compra";
const PDF_TTL_SEGUNDOS = 3600;

type Ok<T = Record<string, never>> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T = Record<string, never>> = Ok<T> | Err;

const dadosSchema = z.object({
  fornecedor_id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  prazo_pagamento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD"),
  servico: z.string().trim().min(1).max(500),
  quantidade: z.number().positive(),
  especificacoes: z.string().max(2000).nullable().optional(),
});

const anexoUploadedSchema = z.object({
  anexo_id: z.string().uuid(),
  path: z.string().min(1),
  nome_original: z.string().min(1),
  tamanho_bytes: z.number().int().positive(),
  mimetype: z.enum(PP_ANEXO_MIMETYPES_ACEITOS),
});

type AnexoUploaded = z.infer<typeof anexoUploadedSchema>;

/**
 * Gates comuns: sessao, tenant, job existe, status editavel, ownership.
 * Retorna { ok, session, job, item } ou { ok:false, message }.
 */
async function checarGatesRealizado(itemRealizadoId: string): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; item: any; job: any; supabase: ReturnType<typeof createClient> }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: item, error: itemErr } = await supabase
    .from("jobs_itens_realizado")
    .select("id, tenant_id, job_id, total_realizado, quantidade_realizada, item_id")
    .eq("id", itemRealizadoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (itemErr || !item) {
    return { ok: false, message: "Item realizado nao encontrado." };
  }

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, tenant_id, status, responsavel_id, empresa_id, produto, nome, projeto_id, orcamento_id")
    .eq("id", item.job_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !job) {
    return { ok: false, message: "Job nao encontrado." };
  }

  if (job.status !== "aberto" && job.status !== "em_producao") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: null,
      metadata: {
        acao_tentada: "pedido_compra.emitida",
        motivo: "status_bloqueia_edicao",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message: "PP so pode ser gerada com o job em 'Aberto' ou 'Em producao'.",
    };
  }

  const podeEditar =
    session.activeRole === "administrador" ||
    job.responsavel_id === session.profile.id;

  if (!podeEditar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: null,
      metadata: {
        acao_tentada: "pedido_compra.emitida",
        motivo: "usuario_nao_e_responsavel_nem_admin",
      },
    });
    return {
      ok: false,
      message: "Apenas o responsavel do job ou admin pode gerar PP.",
    };
  }

  return { ok: true, session, item, job, supabase };
}

/**
 * Fase 1 do fluxo: reserva um pp_id UUID e retorna o path prefix pra
 * client fazer upload direto dos anexos pro bucket. NAO persiste no DB.
 */
export async function reservarPedidoCompra(
  itemRealizadoId: string,
): Promise<Result<{ pp_id: string; upload_prefix: string }>> {
  const gate = await checarGatesRealizado(itemRealizadoId);
  if (!gate.ok) return gate;

  const { item, job, session, supabase } = gate;

  if (Number(item.total_realizado ?? 0) <= 0) {
    return { ok: false, message: "Item ainda nao tem realizado lancado." };
  }

  // Rejeita se ja existe PP
  const { data: ppExistente } = await supabase
    .from("pedidos_compra")
    .select("id")
    .eq("item_realizado_id", itemRealizadoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppExistente) {
    return {
      ok: false,
      message: "Ja existe PP para este item. Cancele a atual antes de gerar outra.",
    };
  }

  const pp_id = crypto.randomUUID();
  const upload_prefix = `${session.activeTenant.id}/${job.id}/${pp_id}/anexos/`;

  return { ok: true, pp_id, upload_prefix };
}

/**
 * Fase 2: client ja subiu anexos direto pro bucket. Envia metadata,
 * server persiste tudo + gera PDF.
 */
export async function finalizarPedidoCompra(
  pp_id: string,
  dados: z.input<typeof dadosSchema>,
  anexos: z.input<typeof anexoUploadedSchema>[],
  itemRealizadoId: string,
): Promise<Result<{ codigo: string }>> {
  const gate = await checarGatesRealizado(itemRealizadoId);
  if (!gate.ok) return gate;
  const { session, item, job, supabase } = gate;

  // Valida dados
  const dadosParsed = dadosSchema.safeParse(dados);
  if (!dadosParsed.success) {
    return {
      ok: false,
      message: `Dados invalidos: ${dadosParsed.error.issues[0]?.message ?? "erro"}.`,
    };
  }
  const d = dadosParsed.data;

  // Valida anexos array
  if (anexos.length < 1) {
    return { ok: false, message: "Pelo menos um anexo e obrigatorio." };
  }
  const anexosParsed = z.array(anexoUploadedSchema).safeParse(anexos);
  if (!anexosParsed.success) {
    return { ok: false, message: "Formato de anexo invalido." };
  }

  // Valida tamanhos + prefix
  const expectedPrefix = `${session.activeTenant.id}/${job.id}/${pp_id}/anexos/`;
  const somaBytes = anexosParsed.data.reduce((s, a) => s + a.tamanho_bytes, 0);
  if (somaBytes > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
    return { ok: false, message: "Anexos somam mais que 25 MB." };
  }
  for (const a of anexosParsed.data) {
    if (a.tamanho_bytes > PP_ANEXO_TAMANHO_MAX_BYTES) {
      return { ok: false, message: `Anexo ${a.nome_original} > 8 MB.` };
    }
    if (!a.path.startsWith(expectedPrefix)) {
      return { ok: false, message: "Anexo em path invalido." };
    }
  }

  // Verifica que arquivos existem no bucket (defense-in-depth contra metadata forjada)
  const { data: arquivosNoBucket, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(expectedPrefix.replace(/\/$/, ""));

  if (listErr) {
    return { ok: false, message: `Falha ao listar anexos: ${listErr.message}` };
  }
  const nomesNoBucket = new Set(
    (arquivosNoBucket ?? []).map((f) => `${expectedPrefix}${f.name}`),
  );
  for (const a of anexosParsed.data) {
    if (!nomesNoBucket.has(a.path)) {
      return {
        ok: false,
        message: `Anexo ${a.nome_original} nao foi encontrado no bucket. Refaca o upload.`,
      };
    }
  }

  // Valida FKs (fornecedor + empresa pertencem ao tenant)
  const [fornRes, empRes] = await Promise.all([
    supabase
      .from("fornecedores")
      .select("*")
      .eq("id", d.fornecedor_id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .maybeSingle(),
    supabase
      .from("empresas")
      .select("*")
      .eq("id", d.empresa_id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .maybeSingle(),
  ]);

  if (!fornRes.data) return { ok: false, message: "Fornecedor invalido ou inativo." };
  if (!empRes.data) return { ok: false, message: "Empresa emissora invalida ou inativa." };

  // Gera codigo
  let codigo: string;
  try {
    codigo = await gerarCodigoPP(supabase, session.activeTenant.id);
  } catch (err: any) {
    return { ok: false, message: err?.message ?? "Falha ao gerar codigo." };
  }

  // INSERT pedidos_compra (pdf_path = '' placeholder)
  const { error: insertErr } = await supabase.from("pedidos_compra").insert({
    id: pp_id,
    tenant_id: session.activeTenant.id,
    codigo,
    item_realizado_id: itemRealizadoId,
    job_id: job.id,
    fornecedor_id: d.fornecedor_id,
    empresa_id: d.empresa_id,
    servico: d.servico,
    quantidade: d.quantidade,
    especificacoes: d.especificacoes ?? null,
    valor: Number(item.total_realizado),
    prazo_pagamento: d.prazo_pagamento,
    pdf_path: "",
    emitida_por: session.profile.id,
  });

  if (insertErr) {
    // Limpa anexos do bucket (rollback)
    await supabase.storage.from(BUCKET).remove(anexosParsed.data.map((a) => a.path));
    return { ok: false, message: `Falha ao salvar PP: ${insertErr.message}` };
  }

  // INSERT anexos bulk
  const anexosRows = anexosParsed.data.map((a) => ({
    id: a.anexo_id,
    tenant_id: session.activeTenant.id,
    pedido_compra_id: pp_id,
    arquivo_path: a.path,
    arquivo_nome_original: a.nome_original,
    arquivo_tamanho_bytes: a.tamanho_bytes,
    arquivo_mimetype: a.mimetype,
    created_by: session.profile.id,
  }));
  const { error: anexosErr } = await supabase.from("pedidos_compra_anexos").insert(anexosRows);
  if (anexosErr) {
    await supabase.from("pedidos_compra").delete().eq("id", pp_id);
    await supabase.storage.from(BUCKET).remove(anexosParsed.data.map((a) => a.path));
    return { ok: false, message: `Falha ao salvar anexos: ${anexosErr.message}` };
  }

  // Carrega dados enriquecidos pro PDF
  const [projetoRes, orcRes] = await Promise.all([
    supabase
      .from("projetos")
      .select("id, codigo, campanha, cliente:clientes(nome_fantasia), responsavel:profiles!responsavel_id(nome)")
      .eq("id", job.projeto_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("orcamentos")
      .select("id, codigo")
      .eq("id", job.orcamento_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
  ]);

  const projeto = projetoRes.data as any;
  const orcamento = orcRes.data as any;
  const responsavelNome = projeto?.responsavel?.nome ?? "";
  const clienteNome = projeto?.cliente?.nome_fantasia ?? "";

  // Renderiza PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPedidoCompraPDF({
      pp: {
        codigo,
        servico: d.servico,
        quantidade: d.quantidade,
        especificacoes: d.especificacoes ?? null,
        valor: Number(item.total_realizado),
        prazo_pagamento: d.prazo_pagamento,
        created_at: new Date().toISOString(),
      },
      empresa: empRes.data as any,
      fornecedor: fornRes.data as any,
      job: { nome: job.nome, produto: job.produto },
      projeto: { codigo: projeto?.codigo ?? "", campanha: projeto?.campanha ?? null },
      orcamento: { codigo: orcamento?.codigo ?? "" },
      cliente: { nome_fantasia: clienteNome },
      responsavelNome,
    });
  } catch (err: any) {
    await supabase.from("pedidos_compra").delete().eq("id", pp_id);
    await supabase.storage.from(BUCKET).remove(anexosParsed.data.map((a) => a.path));
    return { ok: false, message: `Falha ao gerar PDF: ${err?.message ?? err}` };
  }

  const pdfPath = `${session.activeTenant.id}/${job.id}/${pp_id}/pp-${codigo}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(pdfPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadErr) {
    await supabase.from("pedidos_compra").delete().eq("id", pp_id);
    await supabase.storage.from(BUCKET).remove(anexosParsed.data.map((a) => a.path));
    return { ok: false, message: `Falha ao subir PDF: ${uploadErr.message}` };
  }

  // Update pdf_path + fornecedor no realizado
  const [updPP, updReal] = await Promise.all([
    supabase.from("pedidos_compra").update({ pdf_path: pdfPath }).eq("id", pp_id),
    supabase
      .from("jobs_itens_realizado")
      .update({ fornecedor_id: d.fornecedor_id })
      .eq("id", itemRealizadoId)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (updPP.error || updReal.error) {
    // Cleanup total
    await supabase.storage.from(BUCKET).remove([pdfPath, ...anexosParsed.data.map((a) => a.path)]);
    await supabase.from("pedidos_compra").delete().eq("id", pp_id);
    return {
      ok: false,
      message: `Falha ao finalizar: ${updPP.error?.message ?? updReal.error?.message}`,
    };
  }

  // Audit
  await logAuditEvent({
    acao: "pedido_compra.emitida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: codigo,
      valor: Number(item.total_realizado),
      fornecedor_id: d.fornecedor_id,
      item_realizado_id: itemRealizadoId,
      job_id: job.id,
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  return { ok: true, codigo };
}

/**
 * Best-effort cleanup se user fechar drawer sem finalizar.
 * Nao persistiu nada no DB, so remove arquivos orfaos do bucket.
 */
export async function abortarReserva(pp_id: string, jobId: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const prefix = `${session.activeTenant.id}/${jobId}/${pp_id}`;
  const { data: arquivos } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit: 100 });

  if (arquivos && arquivos.length > 0) {
    const paths = arquivos.map((f) => `${prefix}/${f.name}`);
    await supabase.storage.from(BUCKET).remove(paths);
  }
  // Tambem verifica subpasta anexos/
  const { data: anexosLista } = await supabase.storage
    .from(BUCKET)
    .list(`${prefix}/anexos`, { limit: 100 });
  if (anexosLista && anexosLista.length > 0) {
    const paths = anexosLista.map((f) => `${prefix}/anexos/${f.name}`);
    await supabase.storage.from(BUCKET).remove(paths);
  }

  return { ok: true };
}

export async function cancelarPedidoCompra(pp_id: string): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select(
      "id, tenant_id, codigo, job_id, item_realizado_id, pdf_path, jobs!inner(id, status, responsavel_id), anexos:pedidos_compra_anexos(id, arquivo_path)",
    )
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP nao encontrada." };

  const job = (pp as any).jobs;
  if (job.status !== "aberto" && job.status !== "em_producao") {
    return { ok: false, message: "Job nao esta em estado editavel." };
  }

  const podeCancelar =
    session.activeRole === "administrador" || job.responsavel_id === session.profile.id;
  if (!podeCancelar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: pp_id,
      metadata: { acao_tentada: "pedido_compra.cancelada", motivo: "sem_permissao" },
    });
    return { ok: false, message: "Sem permissao pra cancelar esta PP." };
  }

  const anexosPaths = ((pp as any).anexos ?? []).map((a: any) => a.arquivo_path);
  const paths = [pp.pdf_path, ...anexosPaths].filter(Boolean);

  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr) {
      // Log mas prossegue — arquivos orfaos sao aceitaveis
      console.error("[pp.cancelar.storage]", rmErr.message);
    }
  }

  // DELETE cascade limpa anexos rows
  const { error: delErr } = await supabase
    .from("pedidos_compra")
    .delete()
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (delErr) return { ok: false, message: `Falha ao apagar PP: ${delErr.message}` };

  // Volta fornecedor_id do realizado pra null
  await supabase
    .from("jobs_itens_realizado")
    .update({ fornecedor_id: null })
    .eq("id", pp.item_realizado_id)
    .eq("tenant_id", session.activeTenant.id);

  await logAuditEvent({
    acao: "pedido_compra.cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      item_realizado_id: pp.item_realizado_id,
      job_id: pp.job_id,
    },
  });

  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

export async function signedUrlPdf(pp_id: string): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("pdf_path")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP nao encontrada." };

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pp.pdf_path, PDF_TTL_SEGUNDOS);

  if (error || !data) return { ok: false, message: error?.message ?? "Falha URL" };
  return { ok: true, url: data.signedUrl };
}

export async function signedUrlAnexo(anexo_id: string): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("pedidos_compra_anexos")
    .select("arquivo_path")
    .eq("id", anexo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!anexo) return { ok: false, message: "Anexo nao encontrado." };

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, PDF_TTL_SEGUNDOS);

  if (error || !data) return { ok: false, message: error?.message ?? "Falha URL" };
  return { ok: true, url: data.signedUrl };
}
```

- [ ] **Step 2: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: ambos passam.

- [ ] **Step 3: Commit**

```powershell
git add "app/(app)/jobs/[jobId]/realizado/actions-pp.ts"
git commit -m "task010: server actions PP (reservar, finalizar, cancelar, abortar, signedUrls)"
```

---

## Task 4: PPActionsCell + wire into page.tsx

**Files:**
- Create: `app/(app)/jobs/[jobId]/realizado/pp-actions-cell.tsx`
- Modify: `app/(app)/jobs/[jobId]/page.tsx` (adicionar 3 queries + passar props)
- Modify: `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx` (passa props down)
- Modify: `app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx` (passa props down)
- Modify: `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` (trilha lateral)

**Interfaces:**
- Consumes:
  - `PedidoCompra`, `Empresa`, `Fornecedor` de `@/lib/types`.
  - Server actions `cancelarPedidoCompra`, `signedUrlPdf` de `./actions-pp` (Task 3).
- Produces:
  - `<PPActionsCell itemRealizadoId totalRealizado pp editable onGerar />` — client component com 3 estados.
  - `page.tsx` passa `Map<item_realizado_id, PedidoCompra>` + arrays de fornecedores/empresas down.
  - Table renderiza trilha lateral igual `itens-table.tsx` da versão.

- [ ] **Step 1: Criar `pp-actions-cell.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FilePlus, Eye, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { PedidoCompra } from "@/lib/types";
import { cancelarPedidoCompra, signedUrlPdf } from "./actions-pp";

interface Props {
  itemRealizadoId: string;
  totalRealizado: number;
  pp: PedidoCompra | null;
  editable: boolean;
  onGerar: (itemRealizadoId: string) => void;
}

const BOTAO_CLASSES =
  "rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50";

export function PPActionsCell({
  itemRealizadoId,
  totalRealizado,
  pp,
  editable,
  onGerar,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [askCancelar, setAskCancelar] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  function handleVer() {
    if (!pp) return;
    startTransition(async () => {
      const res = await signedUrlPdf(pp.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleCancelarConfirm() {
    if (!pp) return;
    startTransition(async () => {
      const res = await cancelarPedidoCompra(pp.id);
      setAskCancelar(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
    });
  }

  // Estado: sem realizado → trilha vazia (mantem altura)
  if (totalRealizado <= 0) {
    return <div className="h-9" />;
  }

  // Estado: com PP → Ver + Cancelar
  if (pp) {
    return (
      <div className="flex items-center h-9 gap-1">
        <button
          type="button"
          onClick={handleVer}
          disabled={pending}
          title={`Ver PDF · ${pp.codigo}`}
          className={BOTAO_CLASSES}
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        {editable && (
          <button
            type="button"
            onClick={() => setAskCancelar(true)}
            disabled={pending}
            title={`Cancelar ${pp.codigo}`}
            className={BOTAO_CLASSES}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <ConfirmDialog
          open={askCancelar}
          onOpenChange={setAskCancelar}
          title="Cancelar Pedido de Compra?"
          description={
            <>
              <strong className="text-foreground">{pp.codigo}</strong> sera
              cancelada e o PDF + anexos apagados definitivamente. Voce podera
              gerar uma nova PP depois.
            </>
          }
          confirmLabel="Cancelar PP"
          cancelLabel="Voltar"
          variant="destructive"
          pending={pending}
          onConfirm={handleCancelarConfirm}
        />
        {erro && (
          <div
            className="absolute right-0 top-full mt-1 whitespace-nowrap rounded border border-california-red/40 bg-white px-2 py-1 text-[10px] text-california-red shadow z-10"
            onClick={() => setErro(null)}
          >
            {erro}
          </div>
        )}
      </div>
    );
  }

  // Estado: sem PP, editable → Gerar
  if (editable) {
    return (
      <div className="flex items-center h-9">
        <button
          type="button"
          onClick={() => onGerar(itemRealizadoId)}
          disabled={pending}
          title="Gerar PP"
          className={cn(BOTAO_CLASSES, "text-california-red")}
        >
          <FilePlus className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Estado: sem PP, read-only → trilha vazia
  return <div className="h-9" />;
}
```

- [ ] **Step 2: Modificar `job-item-realizado-table.tsx` — adicionar trilha lateral**

Localizar o componente. Precisa adicionar:
1. Novas props na interface: `ppsPorItemId: Map<string, PedidoCompra>`, `fornecedores: Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">[]`, `empresas: Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">[]`, `jobResponsavelId: string`.
2. Refs de wrapper e tbody + layoutEffect que mede `railTop` (mesmo padrão de `itens-table.tsx` linhas 179-200 da versão).
3. Estado `<GerarPPDrawer>` aberto/fechado + `itemRealizadoIdAtual` selecionado.
4. Trilha `<div className="absolute left-full ml-2 flex flex-col" style={{ top: railTop }}>` com `<PPActionsCell>` por linha.

Passos concretos:

a) Adicionar imports no topo:
```tsx
import type { PedidoCompra, Fornecedor, Empresa } from "@/lib/types";
import { PPActionsCell } from "./pp-actions-cell";
import { GerarPPDrawer } from "./gerar-pp-drawer";
```

**Nota**: `GerarPPDrawer` é criado na Task 5. Nesta task, importar mesmo assim — vai dar erro de módulo se rodar antes; alternativa: criar arquivo stub temporário. Escolha: criar stub agora.

Criar stub `gerar-pp-drawer.tsx`:
```tsx
"use client";
import * as React from "react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemRealizadoId: string | null;
  jobId: string;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null }>;
  empresas: Array<{ id: string; razao_social: string; principal: boolean }>;
  defaultEmpresaId: string;
  itemDescricao: string;
  valorRealizado: number;
  quantidadeRealizada: number;
}
export function GerarPPDrawer(_props: Props) {
  return null; // stub — sera implementado na Task 5
}
```

b) Estender a interface `Props` do table:
```tsx
interface Props {
  jobId: string;
  itens: VersaoOrcamentoItem[];
  realizadosMap: Map<string, JobItemRealizado>;
  moeda: string;
  editable: boolean;
  // NOVO:
  ppsPorItemId: Map<string, PedidoCompra>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  jobEmpresaId: string;
  jobResponsavelId: string;
}
```

c) Dentro do componente, adicionar refs + estado:
```tsx
const wrapperRef = React.useRef<HTMLDivElement>(null);
const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
const [railTop, setRailTop] = React.useState(0);
const [drawerOpen, setDrawerOpen] = React.useState(false);
const [itemIdAtual, setItemIdAtual] = React.useState<string | null>(null);

React.useLayoutEffect(() => {
  const wrapper = wrapperRef.current;
  const tbody = tbodyRef.current;
  if (!wrapper || !tbody) return;
  const medir = () =>
    setRailTop(
      tbody.getBoundingClientRect().top - wrapper.getBoundingClientRect().top,
    );
  medir();
  const observer = new ResizeObserver(medir);
  observer.observe(wrapper);
  return () => observer.disconnect();
}, [itens.length, editable]);

function abrirDrawer(itemRealizadoId: string) {
  setItemIdAtual(itemRealizadoId);
  setDrawerOpen(true);
}
```

d) Localizar o `<div>` que envolve a `<table>` (deve ser `<div className="overflow-x-auto ...">`). Wrappear num `<div ref={wrapperRef} className="relative">`. Adicionar `ref={tbodyRef}` no `<tbody>`.

e) DEPOIS de fechar a table, adicionar a trilha lateral e o drawer:

```tsx
{editable && (
  <div
    className="absolute left-full ml-2 flex flex-col"
    style={{ top: railTop }}
  >
    {itens.map((item) => {
      const realizado = realizadosMap.get(item.id);
      const total = realizado ? Number(realizado.total_realizado ?? 0) : 0;
      const pp = ppsPorItemId.get(realizado?.id ?? "") ?? null;
      return (
        <PPActionsCell
          key={item.id}
          itemRealizadoId={realizado?.id ?? ""}
          totalRealizado={total}
          pp={pp}
          editable={editable}
          onGerar={abrirDrawer}
        />
      );
    })}
  </div>
)}

<GerarPPDrawer
  open={drawerOpen}
  onOpenChange={setDrawerOpen}
  itemRealizadoId={itemIdAtual}
  jobId={jobId}
  fornecedores={fornecedores.filter((f) => f.status === "ativo")}
  empresas={empresas.filter((e) => e.ativo)}
  defaultEmpresaId={jobEmpresaId}
  itemDescricao={(() => {
    const it = itens.find((i) => (realizadosMap.get(i.id)?.id ?? "") === itemIdAtual);
    return it?.item ?? "";
  })()}
  valorRealizado={(() => {
    const it = itens.find((i) => (realizadosMap.get(i.id)?.id ?? "") === itemIdAtual);
    const r = it ? realizadosMap.get(it.id) : null;
    return r ? Number(r.total_realizado ?? 0) : 0;
  })()}
  quantidadeRealizada={(() => {
    const it = itens.find((i) => (realizadosMap.get(i.id)?.id ?? "") === itemIdAtual);
    const r = it ? realizadosMap.get(it.id) : null;
    return r ? Number(r.quantidade_realizada ?? 0) : 0;
  })()}
/>
```

Importante: PPActionsCell só faz sentido se `realizado?.id` existir. Se não existir (item sem realizado ainda), renderiza `<div className="h-9" />` (via check interno).

- [ ] **Step 3: Modificar `page.tsx` — adicionar 3 queries + passar props**

No `Promise.all` da segunda onda de queries (que já busca grupos+itens+realizados), adicionar:

```ts
supabase
  .from("pedidos_compra")
  .select("*")
  .eq("job_id", raw.id)
  .eq("tenant_id", session.activeTenant.id),
supabase
  .from("fornecedores")
  .select("id, nome, razao_social, status")
  .eq("tenant_id", session.activeTenant.id)
  .eq("status", "ativo")
  .order("nome"),
supabase
  .from("empresas")
  .select("id, razao_social, nome_fantasia, ativo, principal")
  .eq("tenant_id", session.activeTenant.id)
  .eq("ativo", true)
  .order("principal", { ascending: false })
  .order("razao_social"),
```

Renomear a destructuring pra incluir os novos results (ex: `[gruposRes, itensRes, realizadosRes, ppsRes, fornecedoresRes, empresasRes]`).

Depois de mapear os realizados, criar o mapa:
```ts
const pps = (ppsRes.data ?? []).map((pp: any) => ({
  ...pp,
  quantidade: Number(pp.quantidade),
  valor: Number(pp.valor),
})) as PedidoCompra[];
const ppsPorItemId = new Map<string, PedidoCompra>();
for (const pp of pps) ppsPorItemId.set(pp.item_realizado_id, pp);

const fornecedores = (fornecedoresRes.data ?? []) as any[];
const empresas = (empresasRes.data ?? []) as any[];
```

Passar pra JobRealizadoSection:
```tsx
<JobRealizadoSection
  job={{ ... , empresa_id: job.empresa_id, responsavel_id: job.responsavel_id }}
  ...
  ppsPorItemId={ppsPorItemId}
  fornecedores={fornecedores}
  empresas={empresas}
/>
```

Adicionar import: `import type { PedidoCompra } from "@/lib/types";`.

- [ ] **Step 4: Modificar `job-realizado-section.tsx` — passa props down**

Adicionar 3 props na interface: `ppsPorItemId: Map<string, PedidoCompra>`, `fornecedores`, `empresas`. Passar pra `<JobGrupoCard>` no loop.

Adicionar em `Props`:
```ts
ppsPorItemId: Map<string, import("@/lib/types").PedidoCompra>;
fornecedores: Array<{ id: string; nome: string; razao_social: string | null; status: string }>;
empresas: Array<{ id: string; razao_social: string; nome_fantasia: string | null; ativo: boolean; principal: boolean }>;
```

E no `<JobGrupoCard>`:
```tsx
<JobGrupoCard
  ...
  ppsPorItemId={ppsPorItemId}
  fornecedores={fornecedores}
  empresas={empresas}
  jobEmpresaId={job.empresa_id}
  jobResponsavelId={job.responsavel_id}
/>
```

Extender também as props que o `job` prop passa (Pick precisa incluir `empresa_id` e `responsavel_id`).

- [ ] **Step 5: Modificar `job-grupo-card.tsx` — passa props down**

Idem: adicionar props e passar pra `<JobItemRealizadoTable>`.

- [ ] **Step 6: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: passam.

- [ ] **Step 7: QA parcial (opcional, útil pra debug)**

Como o drawer é stub nesta task, testar:
- Abrir job com item que tem realizado → ícone `<FilePlus>` aparece na trilha lateral.
- Criar PP manualmente via SQL:
```sql
insert into pedidos_compra (tenant_id, codigo, item_realizado_id, job_id, fornecedor_id, empresa_id, servico, quantidade, valor, prazo_pagamento, pdf_path)
values ('<TENANT>', 'PP-TEST', '<ITEM_REALIZADO_ID>', '<JOB_ID>', '<FORNECEDOR_ID>', '<EMPRESA_ID>', 'teste', 1, 100, '2026-08-15', 'placeholder');
```
- Recarregar página → ícones mudam pra `<Eye>` + `<Trash2>`. Clicar `<Trash2>` → confirm → delete + realizado.fornecedor_id → null.
- Voltar SQL: DELETE FROM pedidos_compra WHERE codigo = 'PP-TEST';

- [ ] **Step 8: Commit**

```powershell
git add "app/(app)/jobs/[jobId]/realizado/pp-actions-cell.tsx" "app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx" "app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx" "app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx" "app/(app)/jobs/[jobId]/realizado/job-grupo-card.tsx" "app/(app)/jobs/[jobId]/page.tsx"
git commit -m "task010: trilha lateral do PP na tabela do realizado + fetch de dados"
```

---

## Task 5: GerarPPDrawer — form + upload em 2 fases

**Files:**
- Modify: `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx` (substitui stub pelo form real)

**Interfaces:**
- Consumes:
  - `createClient` de `@/lib/supabase/client` (browser client).
  - Server actions `reservarPedidoCompra`, `finalizarPedidoCompra`, `abortarReserva` de `./actions-pp`.
  - Constantes `PP_ANEXO_*` de `@/lib/types`.
  - UI primitives: `<Dialog>`, `<DrawerContent>`, `<DialogHeader>`, `<DialogTitle>`, `<Select>`, `<DatePicker>`, `<Input>`, `<Textarea>`.
- Produces: nenhum novo export (só o componente `GerarPPDrawer` já declarado).

- [ ] **Step 1: Substituir stub pelo form real**

Sobrescrever `gerar-pp-drawer.tsx` completamente:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X, Upload, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  type PPAnexoMimetype,
} from "@/lib/types";
import {
  reservarPedidoCompra,
  finalizarPedidoCompra,
  abortarReserva,
} from "./actions-pp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemRealizadoId: string | null;
  jobId: string;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null }>;
  empresas: Array<{ id: string; razao_social: string; principal: boolean }>;
  defaultEmpresaId: string;
  itemDescricao: string;
  valorRealizado: number;
  quantidadeRealizada: number;
}

interface AnexoLocal {
  anexo_id: string;
  file: File;
  path: string;
  status: "uploading" | "ok" | "erro";
  mensagem?: string;
}

const BUCKET = "pedidos-compra";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function iconePorMime(mime: string): typeof FileText {
  if (mime.startsWith("image/")) return ImageIcon;
  return FileText;
}

function defaultPrazoPagamento(): string {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return d.toISOString().slice(0, 10);
}

export function GerarPPDrawer({
  open,
  onOpenChange,
  itemRealizadoId,
  jobId,
  fornecedores,
  empresas,
  defaultEmpresaId,
  itemDescricao,
  valorRealizado,
  quantidadeRealizada,
}: Props) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [pending, startTransition] = React.useTransition();

  const [ppId, setPpId] = React.useState<string | null>(null);
  const [uploadPrefix, setUploadPrefix] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const [fornecedorId, setFornecedorId] = React.useState<string>("");
  const [empresaId, setEmpresaId] = React.useState<string>(defaultEmpresaId);
  const [prazoPagamento, setPrazoPagamento] = React.useState<string>(defaultPrazoPagamento());
  const [servico, setServico] = React.useState<string>(itemDescricao);
  const [quantidade, setQuantidade] = React.useState<string>(String(quantidadeRealizada || 1));
  const [especificacoes, setEspecificacoes] = React.useState<string>("");

  const [anexos, setAnexos] = React.useState<AnexoLocal[]>([]);
  const abortedRef = React.useRef(false);

  // Reset ao abrir/fechar
  React.useEffect(() => {
    if (!open || !itemRealizadoId) return;
    abortedRef.current = false;
    setErro(null);
    setPpId(null);
    setUploadPrefix(null);
    setFornecedorId("");
    setEmpresaId(defaultEmpresaId);
    setPrazoPagamento(defaultPrazoPagamento());
    setServico(itemDescricao);
    setQuantidade(String(quantidadeRealizada || 1));
    setEspecificacoes("");
    setAnexos([]);

    // Reserva pp_id + upload_prefix
    (async () => {
      const res = await reservarPedidoCompra(itemRealizadoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setPpId(res.pp_id);
      setUploadPrefix(res.upload_prefix);
    })();
  }, [open, itemRealizadoId, defaultEmpresaId, itemDescricao, quantidadeRealizada]);

  // Cleanup ao fechar sem finalizar
  React.useEffect(() => {
    return () => {
      if (!ppId || abortedRef.current) return;
      // Best-effort — nao aguarda
      abortarReserva(ppId, jobId).catch(() => {});
    };
  }, [ppId, jobId]);

  async function onFileSelect(files: FileList | null) {
    if (!files || !uploadPrefix) return;

    const somaAtual = anexos.reduce((s, a) => s + a.file.size, 0);
    const novos: AnexoLocal[] = [];

    for (const file of Array.from(files)) {
      // Validacao client
      if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as PPAnexoMimetype)) {
        setErro(`${file.name}: tipo nao aceito (${file.type}).`);
        continue;
      }
      if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
        setErro(`${file.name}: excede 8 MB.`);
        continue;
      }
      if (somaAtual + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        setErro("Total de anexos excederia 25 MB.");
        break;
      }
      const anexo_id = crypto.randomUUID();
      const path = `${uploadPrefix}${anexo_id}-${sanitizeName(file.name)}`;
      novos.push({ anexo_id, file, path, status: "uploading" });
    }

    if (novos.length === 0) return;

    setAnexos((prev) => [...prev, ...novos]);

    // Upload em paralelo
    await Promise.all(
      novos.map(async (a) => {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(a.path, a.file, {
            contentType: a.file.type,
            upsert: false,
          });
        setAnexos((prev) =>
          prev.map((p) =>
            p.anexo_id === a.anexo_id
              ? {
                  ...p,
                  status: error ? "erro" : "ok",
                  mensagem: error?.message,
                }
              : p,
          ),
        );
      }),
    );
  }

  async function removerAnexo(anexo_id: string) {
    const alvo = anexos.find((a) => a.anexo_id === anexo_id);
    if (!alvo) return;
    setAnexos((prev) => prev.filter((p) => p.anexo_id !== anexo_id));
    if (alvo.status === "ok") {
      await supabase.storage.from(BUCKET).remove([alvo.path]);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!ppId || !itemRealizadoId) return;
    if (!fornecedorId) {
      setErro("Escolha um fornecedor.");
      return;
    }
    if (!empresaId) {
      setErro("Escolha uma empresa emissora.");
      return;
    }
    if (!prazoPagamento) {
      setErro("Prazo de pagamento e obrigatorio.");
      return;
    }
    if (!servico.trim()) {
      setErro("Servico e obrigatorio.");
      return;
    }
    const qtdNum = Number(quantidade.replace(",", "."));
    if (!Number.isFinite(qtdNum) || qtdNum <= 0) {
      setErro("Quantidade deve ser um numero positivo.");
      return;
    }
    if (anexos.length === 0) {
      setErro("Pelo menos um anexo e obrigatorio.");
      return;
    }
    if (anexos.some((a) => a.status !== "ok")) {
      setErro("Aguarde ou remova anexos com falha de upload.");
      return;
    }

    startTransition(async () => {
      const res = await finalizarPedidoCompra(
        ppId,
        {
          fornecedor_id: fornecedorId,
          empresa_id: empresaId,
          prazo_pagamento: prazoPagamento,
          servico: servico.trim(),
          quantidade: qtdNum,
          especificacoes: especificacoes.trim() || null,
        },
        anexos.map((a) => ({
          anexo_id: a.anexo_id,
          path: a.path,
          nome_original: a.file.name,
          tamanho_bytes: a.file.size,
          mimetype: a.file.type as PPAnexoMimetype,
        })),
        itemRealizadoId,
      );

      if (!res.ok) {
        setErro(res.message);
        return;
      }

      abortedRef.current = true;
      onOpenChange(false);
      router.refresh();
    });
  }

  if (!open || !itemRealizadoId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Gerar Pedido de Compra</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 p-6 overflow-y-auto">
          {erro && (
            <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <span>{erro}</span>
              <button type="button" onClick={() => setErro(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Item</p>
            <p className="font-medium">{itemDescricao}</p>
            <p className="mt-2 text-xs text-muted-foreground">Valor realizado</p>
            <p className="font-mono font-semibold">{formatCurrency(valorRealizado, "BRL")}</p>
          </div>

          {/* Fornecedor & Empresa */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fornecedor & Empresa
            </h3>

            <div>
              <label className="text-xs font-medium">Fornecedor *</label>
              <Select value={fornecedorId} onValueChange={setFornecedorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  {fornecedores.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.razao_social ?? f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium">Empresa emissora *</label>
              <Select value={empresaId} onValueChange={setEmpresaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.razao_social}
                      {e.principal ? " (principal)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium">Prazo de pagamento *</label>
              <DatePicker value={prazoPagamento} onChange={setPrazoPagamento} />
            </div>
          </div>

          {/* Servico */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Servico
            </h3>

            <div>
              <label className="text-xs font-medium">Descricao do servico *</label>
              <Input
                value={servico}
                onChange={(e) => setServico(e.target.value)}
                maxLength={500}
              />
            </div>

            <div>
              <label className="text-xs font-medium">Quantidade</label>
              <Input
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                className="no-spinner"
                inputMode="decimal"
              />
            </div>

            <div>
              <label className="text-xs font-medium">Especificacoes (opcional)</label>
              <textarea
                value={especificacoes}
                onChange={(e) => setEspecificacoes(e.target.value)}
                maxLength={2000}
                rows={3}
                className="w-full rounded border border-border p-2 text-sm"
              />
            </div>
          </div>

          {/* Anexos */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Anexos * (min 1, max 8MB/arquivo, 25MB total)
            </h3>

            <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border p-3 text-sm hover:border-california-red/40">
              <Upload className="h-4 w-4" />
              <span>Selecionar arquivos (PDF ou imagem)</span>
              <input
                type="file"
                multiple
                accept={PP_ANEXO_MIMETYPES_ACEITOS.join(",")}
                onChange={(e) => onFileSelect(e.target.files)}
                className="hidden"
              />
            </label>

            {anexos.length > 0 && (
              <ul className="space-y-1">
                {anexos.map((a) => {
                  const Icon = iconePorMime(a.file.type);
                  return (
                    <li
                      key={a.anexo_id}
                      className={cn(
                        "flex items-center gap-2 rounded border p-2 text-xs",
                        a.status === "erro"
                          ? "border-california-red/40 bg-california-red/5"
                          : a.status === "ok"
                            ? "border-emerald-200 bg-emerald-50"
                            : "border-border bg-muted/30",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1 truncate">{a.file.name}</span>
                      <span className="text-muted-foreground">
                        {(a.file.size / 1024).toFixed(0)} KB
                      </span>
                      <span className="text-muted-foreground">
                        {a.status === "uploading"
                          ? "enviando..."
                          : a.status === "ok"
                            ? "ok"
                            : a.mensagem ?? "falha"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removerAnexo(a.anexo_id)}
                        className="text-california-red hover:opacity-70"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || !ppId}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
            >
              {pending ? "Gerando..." : "Gerar PP"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Confirmar imports/APIs**

Verificar que existem no projeto:
- `@/components/ui/dialog` com `Dialog`, `DrawerContent`, `DialogHeader`, `DialogTitle`
- `@/components/ui/select` com `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`
- `@/components/ui/date-picker` com `DatePicker` que aceita `value` (ISO string) e `onChange` (ISO string)
- `@/components/ui/input` com `Input`
- `formatCurrency` em `@/lib/utils`

Se `DatePicker` tiver interface diferente, ajustar props conforme o padrão do projeto (procurar por outro `<DatePicker>` no código pra ver como é usado).

- [ ] **Step 3: Typecheck + Lint**

```powershell
npm run typecheck; if ($?) { npm run lint }
```
Esperado: passam.

- [ ] **Step 4: QA manual completo (usuário/controller)**

1. Job em `aberto`, item com realizado → ícone `<FilePlus>` na trilha.
2. Clicar → drawer abre com todos os defaults corretos.
3. Escolher fornecedor + empresa + prazo + anexar 1 PDF + 1 imagem.
4. Clicar "Gerar PP" → drawer fecha → trilha muda pra `<Eye>` + `<Trash2>`.
5. Clicar `<Eye>` → PDF abre em nova aba com layout fiel ao anexo.
6. Conferir dados do PDF: código PP-NNNNN, empresa (dados de faturamento), fornecedor (dados bancários + endereço), valor, prazo, serviço, responsável do job.
7. Clicar `<Trash2>` → confirm → deleta PDF + anexos do bucket + row.
8. Verificar `jobs_itens_realizado.fornecedor_id` no DB — após gerar deve estar populado; após cancelar deve voltar pra null.
9. Testar anexo > 8 MB → rejeitado no client.
10. Testar 4 anexos somando > 25 MB → rejeitado no client.
11. Testar fechar drawer sem submeter → `abortarReserva` roda no cleanup, anexos temporários somem do bucket.

- [ ] **Step 5: Commit**

```powershell
git add "app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx"
git commit -m "task010: drawer de gerar PP com upload em 2 fases + form completo"
```

---

## Task 6: HANDOFF update + QA final

**Files:**
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: nada.
- Produces: HANDOFF atualizado com Task 010 fase 1.

- [ ] **Step 1: Atualizar linha "Última atualização" no topo**

Substituir o bloco atual por:
```markdown
**Última atualização** (2026-07-31): Task 010 fase 1 — Pedidos de Compra. Tabela `pedidos_compra` (1:1 com item_realizado, unique constraint) + `pedidos_compra_anexos` + bucket privado `pedidos-compra`. Server actions com fluxo 2-fases (client upload direto pro bucket via `supabase.storage`, depois `finalizarPedidoCompra` persiste rows + gera PDF via `pdfmake`). Trilha lateral na tabela do realizado com 3 estados (Gerar / Ver+Cancelar / vazio). Drawer com fornecedor+empresa+prazo+serviço+especificações+anexos. Cancelamento = hard delete (row + PDF + anexos + `fornecedor_id=null` no realizado). PDF layout fiel ao PDF anexo referência.
```

- [ ] **Step 2: Adicionar Task 010 na lista de migrations**

Localizar o bloco de migrations aplicadas e adicionar:
```
20260731000003  task010_pedidos_compra
```

Atualizar linha "Última: ..." pra refletir.

- [ ] **Step 3: Adicionar nova seção após "Task 009 — Empresas"**

```markdown
### Task 010 — Pedidos de Compra (fase 1: emissão + cancelamento)
- **Tabela `pedidos_compra`** (1:1 com `jobs_itens_realizado` via unique constraint) + `pedidos_compra_anexos` (N por PP). Snapshot dos dados no ato da emissão (`servico`, `valor`, `quantidade`, `especificacoes`) — realizado mudar depois NÃO altera PP.
- **Sem coluna `status`** por agora — cancelar = hard delete (row + PDF + anexos + `fornecedor_id=null` no realizado). Fase 2 (fluxo financeiro) reintroduz status quando entrarem `aprovada`/`baixada`/`reprovada`.
- **Código `PP-NNNNN` sequencial por tenant** via função `gerar_codigo_pp(tenant_id)` com `pg_advisory_xact_lock` (serializa geração concorrente sem penalizar leitura).
- **Bucket privado `pedidos-compra`** com policies por prefix path = tenant_id (mesmo padrão de `orcamento-importacoes`).
- **Fluxo 2 fases pra upload**: client faz `supabase.storage.upload` direto pro bucket (evita limite de 4.5 MB do body Vercel), depois `finalizarPedidoCompra` valida paths existentes + persiste rows + gera PDF.
- **PDF via `pdfmake`** (JS puro, serverless-friendly). Layout fiel ao anexo de referência, EXCETO: sem Espécie/Formato/Cores/Meio/Acabamento; sem Prazo Entrega/Local Entrega; assinatura só do responsável do job.
- **UI**: trilha lateral fora do card da tabela (mesmo padrão do `itens-table.tsx` da versão). 3 estados: sem realizado (vazio), com realizado sem PP (ícone `FilePlus`), com PP (ícones `Eye` + `Trash2`).
- **Drawer** com defaults inteligentes: empresa = `job.empresa_id`, prazo = hoje+15 dias, serviço = item.item, quantidade = qtd_realizada.
- **Permissão**: admin OR responsável do job (mesma regra do editar realizado). Job precisa estar em `aberto` ou `em_producao`.
- **Anexos**: PDF + imagem, 8 MB/arquivo, 25 MB total, obrigatório ≥1 no ato de gerar.
- **Audit**: `pedido_compra.emitida` + `pedido_compra.cancelada`. Denials registram `acao_negada`.
- Migration `20260731000003_task010_pedidos_compra.sql`.
```

- [ ] **Step 4: Adicionar entrada em "Próximos passos"**

Localizar seção "Próximos passos". Como fase 2 (fluxo financeiro) foi promovida da nossa lista de prioridades, adicionar:

```markdown
### 🟡 Prioridade 2 — Pedidos de Compra fase 2 (fluxo financeiro)

Extensão natural da fase 1. Adicionar:
- Coluna `status pp_status` na tabela `pedidos_compra` (enum: `emitida`, `aprovada`, `baixada`, `reprovada`).
- Rota `/financeiro/pedidos-compra` com caixa de entrada + tabela de PPs `emitida`.
- Server actions `aprovarPP`, `reprovarPP` (com motivo), `baixarPP`, `estornarBaixaPP`.
- Regra: PP `emitida` pode ser cancelada por GP/admin; PP `aprovada` só admin/financeiro cancela (e antes precisa estornar baixa se aplicável).
- Audit: `pedido_compra.aprovada`, `pedido_compra.reprovada`, `pedido_compra.baixada`, `pedido_compra.estornada`.
```

- [ ] **Step 5: QA end-to-end final**

Rodar os 15 testes de aceitação do spec ([docs/superpowers/specs/2026-07-31-pedidos-compra-design.md](../docs/superpowers/specs/2026-07-31-pedidos-compra-design.md), seção "Testes manuais (aceitação)").

Anotar falhas ou comportamentos inesperados. Se algo falhar, criar issue/nota antes de fechar a task.

- [ ] **Step 6: Commit**

```powershell
git add docs/HANDOFF.md
git commit -m "task010 final review: QA end-to-end + HANDOFF atualizado"
```

---

## Auto-verificação do plano

**Cobertura do spec:**
- [x] Migration + tabelas + bucket + função — Task 1
- [x] Types + audit actions + helper de código — Task 1
- [x] PDF renderer — Task 2
- [x] Todas as 6 server actions — Task 3
- [x] PPActionsCell + trilha lateral + wire de dados — Task 4
- [x] Drawer com upload 2 fases + validações — Task 5
- [x] HANDOFF + QA final — Task 6
- [x] Performance: `Promise.all`, GRANT explícito, índices em FKs, RLS `is_tenant_member` — Tasks 1, 4
- [x] Auditoria de denials + successes — Task 3
- [x] Rollback em falhas — Task 3

**Tipos consistentes:**
- `PedidoCompra`, `PedidoCompraAnexo`, `PPAnexoMimetype`, constantes — definidos em Task 1, usados em Tasks 3, 4, 5.
- Server action signatures — definidas em Task 3, consumidas em Tasks 4, 5.
- `renderPedidoCompraPDF` — definido em Task 2, chamado em Task 3.
- `gerarCodigoPP` — definido em Task 1, chamado em Task 3.

**Placeholders:** nenhum "TBD", "TODO", "similar to Task N", ou passo sem código concreto.
