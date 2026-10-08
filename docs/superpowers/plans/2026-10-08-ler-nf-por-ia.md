# Leitura automática de NF por IA — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Ler NF automaticamente" no card do anexo tipo NF (nos dois lugares em que o `ZonaDeAnexos` aparece — drawer "Novo PP" e modal "Enviar ao financeiro") que envia o PDF pra OpenAI `gpt-5-mini`, recebe JSON estruturado validado, pré-preenche os 4 campos do anexo (número, data, valor, tomador) e exibe avisos de match de empresa/fornecedor. Nada é salvo automaticamente — usuário confirma.

**Architecture:** Server action `lerDadosDaNFPorIA` orquestra: baixa PDF do bucket `pedidos-compra`, calcula hash SHA-256, consulta cache (tabela nova `nf_extracao_cache`), chama OpenAI Responses API com Structured Outputs em cache-miss, valida dígito verificador de CNPJ + sanity de data/valor, matcha CNPJ tomador com empresas do tenant e CNPJ emissor com fornecedores, grava cache, loga audit e retorna. UI é um botão + badge "IA" em cada campo preenchido + bloco de avisos. Zero mudança no fluxo de upload/save existente.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Supabase Postgres + RLS + Storage, `openai` npm SDK (Responses API), `node --test` + `tsx`.

**Spec:** [docs/superpowers/specs/2026-10-08-ler-nf-por-ia.md](../specs/2026-10-08-ler-nf-por-ia.md)

## Global Constraints

- **Linguagem UI:** PT-BR com acentuação completa em qualquer string renderizada ou de erro visível (CLAUDE.md "Ortografia em português").
- **Banco pelo fluxo do MCP:** migration via `apply_migration`, conferência pelo MCP, commit junto do código que depende (`docs/FLUXO-BANCO.md`).
- **GRANT para `authenticated`:** sempre explícito; `anon` fica sem acesso. RLS obrigatória em tabela nova com `(select current_tenant_id())` (não `auth.uid()` direto).
- **`lib/types.ts` à mão:** atualizar no MESMO commit da migration (CLAUDE.md).
- **Audit log:** `logAuditEvent({ acao: "pp.anexo.nf_lida_por_ia", ... })` em toda chamada à action, hit ou miss do cache.
- **Chave OpenAI:** `process.env.OPENAI_API_KEY`. Nunca no cliente. Lida via helper em `lib/ia/openai-client.ts`.
- **Modelo:** `gpt-5-mini` fixo em constante exportada. Trocar modelo = bump de versão + cache invalidado implicitamente (coluna `modelo` grava, e cache-match é `(tenant, hash)` — modelos diferentes com mesmo hash retornariam o cache antigo. Mitigação: incluir `modelo` no `.eq()` do SELECT do cache).
- **Fonte dos dados pro match:** `tomadores: TomadorDaNf[]` (já vem no form) + `fornecedores` (já vem). A action **recebe** essas listas pequenas via parâmetro — não as busca de novo (evita round-trip no banco).
- **Formato aceito:** só `application/pdf` nesta versão. Qualquer outro mimetype → botão desabilitado.

## Review Focus

1. **Path do anexo com tenant de outro:** usuário malicioso passa `anexo_path = "outro-tenant/pps/.../nf.pdf"` tentando ler NF de outro tenant via cache. A action valida que o path começa com o `tenant_id` do session (Task 6, step de validação de input).
2. **JSON sem schema:** se o SDK da OpenAI mudar sem avisar e o `response_format` falhar silenciosamente, dados chegam sem estrutura. Teste da Task 5 verifica que a resposta validada pelo Zod bate com o schema esperado — Zod `.safeParse` reflete qualquer divergência.
3. **CNPJ com dígito verificador errado passando:** NF com "CNPJ" `99.999.999/9999-99` (dígitos repetidos, aceito só pela regex) tem que virar `null`. Task 3 testa `cnpjs com 11 dígitos repetidos`, `0`, `com formatação`, `sem formatação`.
4. **Match de CNPJ ignora formatação:** `tomadores[].cnpj` vem formatado (`"19.437.976/0001-54"`), IA retorna só dígitos (`"19437976000154"`). Task 4 normaliza os dois lados antes de comparar.
5. **Cache cruza modelo:** chamada com `gpt-5-mini` grava `(hash, gpt-5-mini)`; se amanhã trocar pra `gpt-5`, SELECT precisa filtrar por modelo também — senão lê cache stale. Task 6 inclui `.eq("modelo", MODELO_ATUAL)` no SELECT.

---

## File Structure

**Create:**
- `supabase/migrations/20261008000001_nf_extracao_cache.sql`
- `lib/ia/openai-client.ts` — singleton OpenAI
- `lib/ia/validacoes-nf.ts` — helpers puros (CNPJ, data, valor)
- `lib/ia/validacoes-nf.test.ts`
- `lib/ia/matches-nf.ts` — helpers puros (match CNPJ tomador/emissor)
- `lib/ia/matches-nf.test.ts`
- `lib/ia/ler-nf.ts` — chamada OpenAI + parse structured output
- `lib/ia/ler-nf.test.ts`
- `app/(app)/jobs/[jobId]/realizado/actions-ler-nf.ts` — server action
- `app/(app)/jobs/[jobId]/realizado/actions-ler-nf.test.ts`

**Modify:**
- `lib/types.ts` — adicionar `NfExtracaoCache`, `DadosExtraidosNF`
- `lib/auth/audit.ts` — adicionar `"pp.anexo.nf_lida_por_ia"` em `AuditAction`
- `package.json` — adicionar `openai` em `dependencies`
- `.env.local.example` — adicionar `OPENAI_API_KEY=sk-...`
- `app/(app)/jobs/[jobId]/realizado/anexos-da-pp.tsx` — botão + estados + badge + avisos no `NfDoAnexo`

---

## Task 1: Migration — tabela `nf_extracao_cache` + tipos

**Files:**
- Create: `supabase/migrations/20261008000001_nf_extracao_cache.sql`
- Modify: `lib/types.ts`
- Modify: `lib/auth/audit.ts`

**Interfaces:**
- Produces: tabela `nf_extracao_cache (tenant_id, hash_sha256, dados jsonb, modelo, extraido_em)` com unique `(tenant_id, hash_sha256)`. Consumida pela Task 6 (cache lookup/insert).
- Produces: tipo `NfExtracaoCache` e `DadosExtraidosNF` em `lib/types.ts`. Consumidos pelas Tasks 5, 6 e 7.
- Produces: audit action `"pp.anexo.nf_lida_por_ia"`. Consumida pela Task 6.

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20261008000001_nf_extracao_cache.sql`:

```sql
-- Cache de leitura de NF por IA. Chave: (tenant_id, hash_sha256 do arquivo).
-- Modelo fica guardado pra permitir trocar sem ler cache stale (SELECT filtra
-- por modelo). Imutável: sem UPDATE/DELETE; invalidar = DROP + recria.
-- Spec: docs/superpowers/specs/2026-10-08-ler-nf-por-ia.md (D9)

create table public.nf_extracao_cache (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  hash_sha256 text not null check (char_length(hash_sha256) = 64),
  dados       jsonb not null,
  modelo      text not null,
  extraido_em timestamptz not null default now(),
  unique (tenant_id, hash_sha256, modelo)
);

create index nf_extracao_cache_tenant_hash_modelo_idx
  on public.nf_extracao_cache (tenant_id, hash_sha256, modelo);

alter table public.nf_extracao_cache enable row level security;

create policy nf_extracao_cache_tenant_select
  on public.nf_extracao_cache for select
  to authenticated
  using (tenant_id = (select current_tenant_id()));

create policy nf_extracao_cache_tenant_insert
  on public.nf_extracao_cache for insert
  to authenticated
  with check (tenant_id = (select current_tenant_id()));

grant select, insert on public.nf_extracao_cache to authenticated;
```

- [ ] **Step 2: Aplicar a migration via MCP**

Rodar `mcp__supabase-write__apply_migration` com o SQL acima e nome `nf_extracao_cache`.

- [ ] **Step 3: Conferir pelo MCP**

Rodar `mcp__supabase__list_tables` filtrando por schema `public` e confirmar que:
- Tabela existe com todas as colunas.
- RLS está habilitado.
- 2 policies presentes (select, insert).
- Nenhum GRANT pra `anon`; GRANTs pra `authenticated` (select, insert).

- [ ] **Step 4: Atualizar `lib/types.ts`**

Adicionar depois da seção de tipos existentes, antes de `// ---------- Task fornecedor` ou em bloco próprio no final:

```typescript
// ---------- Leitura de NF por IA (spec 2026-10-08) ----------

export interface NfExtracaoCache {
  id: string;
  tenant_id: string;
  hash_sha256: string;
  dados: DadosExtraidosNF;
  modelo: string;
  extraido_em: string;
}

/** O que a IA extrai da NF, já validado. Null = não identificado com
 *  segurança (nunca string vazia). */
export interface DadosExtraidosNF {
  numero_nf: string | null;
  data_emissao: string | null;      // ISO YYYY-MM-DD
  valor_total: number | null;
  descricao_servico: string | null;
  tomador: {
    cnpj: string | null;             // 14 dígitos
    razao_social: string | null;
    estabelecimento_id_match: string | null;
  };
  emissor: {
    cnpj: string | null;             // 14 dígitos
    razao_social: string | null;
    fornecedor_id_match: string | null;
  };
  confianca_baixa: boolean;
}
```

- [ ] **Step 5: Adicionar audit action em `lib/auth/audit.ts`**

Adicionar na union type `AuditAction` (em bloco próprio no final):

```typescript
  // Leitura de NF por IA (spec 2026-10-08-ler-nf-por-ia). Loga TODA chamada,
  // hit ou miss do cache. Metadata guarda modelo, tokens, custo estimado.
  | "pp.anexo.nf_lida_por_ia"
```

- [ ] **Step 6: Rodar `tsc` para garantir que os tipos compilam**

Run: `npx tsc --noEmit`
Expected: PASS (sem erros).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261008000001_nf_extracao_cache.sql \
        lib/types.ts \
        lib/auth/audit.ts
git commit -m "feat(nf-ia): tabela nf_extracao_cache + tipos + audit action"
```

---

## Task 2: Setup do OpenAI SDK + variável de ambiente + cliente

**Files:**
- Modify: `package.json`
- Modify: `.env.local.example`
- Create: `lib/ia/openai-client.ts`

**Interfaces:**
- Produces: função `getOpenAIClient(): OpenAI` em `lib/ia/openai-client.ts`. Lazy, cacheia a instância. Consumida pela Task 5.
- Produces: constante `MODELO_LEITURA_NF = "gpt-5-mini"` exportada. Consumida pelas Tasks 5 e 6.

- [ ] **Step 1: Instalar o SDK**

Run: `npm install openai@^4`
Expected: `openai` listado em `dependencies` do `package.json`.

- [ ] **Step 2: Adicionar `OPENAI_API_KEY` em `.env.local.example`**

Adicionar linha no final:

```
# OpenAI — leitura automática de NF por IA (spec 2026-10-08)
OPENAI_API_KEY=sk-...
```

- [ ] **Step 3: Criar `lib/ia/openai-client.ts`**

```typescript
import OpenAI from "openai";

/** O modelo escolhido pra leitura de NF (spec D3). Trocar aqui invalida o
 *  cache automaticamente: `nf_extracao_cache` guarda o modelo e o SELECT
 *  filtra por ele. */
export const MODELO_LEITURA_NF = "gpt-5-mini";

let clienteCached: OpenAI | null = null;

/** O cliente OpenAI, lazy. Lê `OPENAI_API_KEY` do ambiente só na primeira
 *  chamada. Falha explicitamente se a chave estiver faltando — melhor do
 *  que inicializar com undefined e explodir no primeiro request. */
export function getOpenAIClient(): OpenAI {
  if (clienteCached) return clienteCached;
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) {
    throw new Error(
      "OPENAI_API_KEY não configurada. Adicione em .env.local (dev) e em Vercel " +
        "→ Settings → Environment Variables (Production + Preview).",
    );
  }
  clienteCached = new OpenAI({ apiKey: chave });
  return clienteCached;
}
```

- [ ] **Step 4: Rodar `tsc` para checar imports**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.local.example lib/ia/openai-client.ts
git commit -m "feat(nf-ia): setup do SDK OpenAI + cliente lazy"
```

**Nota pro executor:** o `OPENAI_API_KEY` real NÃO vai no commit. O usuário gera a chave em https://platform.openai.com/api-keys e cola em `.env.local` local + nas env vars da Vercel (dev + prod). Avisar o usuário no fim do PR se essa etapa ainda está pendente.

---

## Task 3: Validações puras (CNPJ, data, valor, número NF)

**Files:**
- Create: `lib/ia/validacoes-nf.ts`
- Create: `lib/ia/validacoes-nf.test.ts`

**Interfaces:**
- Produces: `validarCnpj(bruto: string | null): string | null` — retorna 14 dígitos se válido (DV correto), senão `null`.
- Produces: `validarDataEmissao(iso: string | null, hojeIso: string): string | null` — retorna ISO se parseável, > "2015-01-01" e ≤ `hojeIso`, senão `null`.
- Produces: `validarValor(bruto: number | null): number | null` — retorna número se > 0 e < 10_000_000, senão `null`.
- Produces: `validarNumeroNF(bruto: string | null): string | null` — trim; retorna `null` se vazio.
- Produces: `validarDescricao(bruto: string | null): string | null` — trim; `null` se vazio; corta em 500 chars.

Consumidos pela Task 6.

- [ ] **Step 1: Escrever os testes falhando**

Arquivo `lib/ia/validacoes-nf.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarCnpj,
  validarDataEmissao,
  validarValor,
  validarNumeroNF,
  validarDescricao,
} from "./validacoes-nf";

test("validarCnpj — null para entrada vazia", () => {
  assert.equal(validarCnpj(null), null);
  assert.equal(validarCnpj(""), null);
  assert.equal(validarCnpj("   "), null);
});

test("validarCnpj — null para número de dígitos errado", () => {
  assert.equal(validarCnpj("1943797600015"), null); // 13 dígitos
  assert.equal(validarCnpj("194379760001544"), null); // 15 dígitos
});

test("validarCnpj — null para dígitos repetidos", () => {
  assert.equal(validarCnpj("00000000000000"), null);
  assert.equal(validarCnpj("99999999999999"), null);
  assert.equal(validarCnpj("11111111111111"), null);
});

test("validarCnpj — null para DV inválido", () => {
  assert.equal(validarCnpj("19437976000199"), null); // DV errado
});

test("validarCnpj — aceita formatado e devolve só dígitos", () => {
  assert.equal(validarCnpj("19.437.976/0001-54"), "19437976000154");
});

test("validarCnpj — aceita sem formatação", () => {
  assert.equal(validarCnpj("19437976000154"), "19437976000154");
});

test("validarDataEmissao — null para entrada vazia ou inválida", () => {
  assert.equal(validarDataEmissao(null, "2026-10-08"), null);
  assert.equal(validarDataEmissao("", "2026-10-08"), null);
  assert.equal(validarDataEmissao("abacaxi", "2026-10-08"), null);
  assert.equal(validarDataEmissao("2026-13-01", "2026-10-08"), null); // mês inválido
});

test("validarDataEmissao — null se data futura", () => {
  assert.equal(validarDataEmissao("2027-01-01", "2026-10-08"), null);
});

test("validarDataEmissao — null se antes de 2015", () => {
  assert.equal(validarDataEmissao("2014-12-31", "2026-10-08"), null);
});

test("validarDataEmissao — aceita data válida no intervalo", () => {
  assert.equal(validarDataEmissao("2026-10-01", "2026-10-08"), "2026-10-01");
  assert.equal(validarDataEmissao("2015-01-01", "2026-10-08"), "2015-01-01");
  assert.equal(validarDataEmissao("2026-10-08", "2026-10-08"), "2026-10-08");
});

test("validarValor — null para zero, negativo ou acima de 10M", () => {
  assert.equal(validarValor(null), null);
  assert.equal(validarValor(0), null);
  assert.equal(validarValor(-100), null);
  assert.equal(validarValor(10_000_001), null);
});

test("validarValor — aceita valor no intervalo", () => {
  assert.equal(validarValor(0.01), 0.01);
  assert.equal(validarValor(5000), 5000);
  assert.equal(validarValor(9_999_999.99), 9_999_999.99);
});

test("validarNumeroNF — null se vazio", () => {
  assert.equal(validarNumeroNF(null), null);
  assert.equal(validarNumeroNF(""), null);
  assert.equal(validarNumeroNF("   "), null);
});

test("validarNumeroNF — trim e retorna", () => {
  assert.equal(validarNumeroNF("  00012345  "), "00012345");
});

test("validarDescricao — null se vazia; corta em 500", () => {
  assert.equal(validarDescricao(null), null);
  assert.equal(validarDescricao(""), null);
  assert.equal(validarDescricao("Produção audiovisual"), "Produção audiovisual");
  assert.equal(validarDescricao("x".repeat(600))?.length, 500);
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npx tsx --test lib/ia/validacoes-nf.test.ts`
Expected: FAIL com "Cannot find module './validacoes-nf'".

- [ ] **Step 3: Implementar `lib/ia/validacoes-nf.ts`**

```typescript
/** Helpers puros de validação dos campos extraídos da NF. Falhou? vira
 *  null — nunca inventa, nunca aceita algo duvidoso. Spec D5. */

/** Dígitos verificadores do CNPJ pelo módulo 11. Retorna 14 dígitos
 *  limpos se válido, senão null. */
export function validarCnpj(bruto: string | null): string | null {
  if (!bruto) return null;
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length !== 14) return null;
  // 00000000000000, 11111111111111, etc.
  if (/^(\d)\1{13}$/.test(digitos)) return null;

  const calcularDV = (base: string, pesos: number[]): number => {
    const soma = base.split("").reduce((s, d, i) => s + Number(d) * pesos[i]!, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const base = digitos.slice(0, 12);
  const dv1 = calcularDV(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = calcularDV(base + dv1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (dv1 !== Number(digitos[12]) || dv2 !== Number(digitos[13])) return null;
  return digitos;
}

/** Data ISO entre 2015-01-01 e `hojeIso` (inclusive, ambos). */
export function validarDataEmissao(iso: string | null, hojeIso: string): string | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  // Rejeita algo tipo "2026-13-01" que `new Date` deixaria rolar como 2027-01-01.
  if (d.toISOString().slice(0, 10) !== iso) return null;
  if (iso < "2015-01-01" || iso > hojeIso) return null;
  return iso;
}

export function validarValor(bruto: number | null): number | null {
  if (bruto === null) return null;
  if (typeof bruto !== "number" || !Number.isFinite(bruto)) return null;
  if (bruto <= 0 || bruto >= 10_000_000) return null;
  return bruto;
}

export function validarNumeroNF(bruto: string | null): string | null {
  if (!bruto) return null;
  const t = bruto.trim();
  return t === "" ? null : t;
}

export function validarDescricao(bruto: string | null): string | null {
  if (!bruto) return null;
  const t = bruto.trim();
  if (t === "") return null;
  return t.length > 500 ? t.slice(0, 500) : t;
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `npx tsx --test lib/ia/validacoes-nf.test.ts`
Expected: PASS — todos os ~15 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/ia/validacoes-nf.ts lib/ia/validacoes-nf.test.ts
git commit -m "feat(nf-ia): validações puras (CNPJ, data, valor, número, descrição)"
```

---

## Task 4: Helpers de match (CNPJ tomador vs empresas; CNPJ emissor vs fornecedores)

**Files:**
- Create: `lib/ia/matches-nf.ts`
- Create: `lib/ia/matches-nf.test.ts`

**Interfaces:**
- Produces: `acharEstabelecimentoPorCnpj(cnpj: string, tomadores: Array<{ id: string; cnpj: string }>): string | null`. Normaliza antes de comparar (CNPJ pode vir formatado em um lado, não no outro). Consumido pela Task 6.
- Produces: `acharFornecedorPorCnpj(cnpj: string, fornecedores: Array<{ id: string; cpf_cnpj?: string | null }>): string | null`. Normaliza e ignora fornecedores PF (CPF). Consumido pela Task 6.

- [ ] **Step 1: Escrever os testes falhando**

Arquivo `lib/ia/matches-nf.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { acharEstabelecimentoPorCnpj, acharFornecedorPorCnpj } from "./matches-nf";

test("acharEstabelecimentoPorCnpj — match com CNPJ formatado no lado dos tomadores", () => {
  const tomadores = [
    { id: "emp-1", cnpj: "19.437.976/0001-54" },
    { id: "emp-2", cnpj: "22.222.222/0001-22" },
  ];
  assert.equal(acharEstabelecimentoPorCnpj("19437976000154", tomadores), "emp-1");
});

test("acharEstabelecimentoPorCnpj — null se CNPJ não bate", () => {
  const tomadores = [{ id: "emp-1", cnpj: "19.437.976/0001-54" }];
  assert.equal(acharEstabelecimentoPorCnpj("33333333333333", tomadores), null);
});

test("acharEstabelecimentoPorCnpj — null se lista vazia", () => {
  assert.equal(acharEstabelecimentoPorCnpj("19437976000154", []), null);
});

test("acharFornecedorPorCnpj — match em fornecedor PJ formatado", () => {
  const fornecedores = [
    { id: "forn-1", cpf_cnpj: "11.222.333/0001-44" },
    { id: "forn-2", cpf_cnpj: "55.666.777/0001-88" },
  ];
  assert.equal(acharFornecedorPorCnpj("11222333000144", fornecedores), "forn-1");
});

test("acharFornecedorPorCnpj — ignora fornecedor PF (CPF 11 dígitos)", () => {
  const fornecedores = [
    { id: "pf-1", cpf_cnpj: "123.456.789-00" }, // CPF
    { id: "pj-1", cpf_cnpj: "11.222.333/0001-44" },
  ];
  // CNPJ emissor da NF nunca vai bater com CPF.
  assert.equal(acharFornecedorPorCnpj("11222333000144", fornecedores), "pj-1");
});

test("acharFornecedorPorCnpj — null se cpf_cnpj faltando ou nulo", () => {
  const fornecedores = [
    { id: "forn-1", cpf_cnpj: null },
    { id: "forn-2" },
  ];
  assert.equal(acharFornecedorPorCnpj("11222333000144", fornecedores), null);
});

test("acharFornecedorPorCnpj — null se CNPJ não bate", () => {
  const fornecedores = [{ id: "forn-1", cpf_cnpj: "11.222.333/0001-44" }];
  assert.equal(acharFornecedorPorCnpj("99888777000166", fornecedores), null);
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npx tsx --test lib/ia/matches-nf.test.ts`
Expected: FAIL com "Cannot find module './matches-nf'".

- [ ] **Step 3: Implementar `lib/ia/matches-nf.ts`**

```typescript
/** Helpers puros de match entre CNPJ extraído da NF e as listas que já
 *  vêm no formulário (tomadores e fornecedores do tenant). Spec D6 e D7. */

function soDigitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export function acharEstabelecimentoPorCnpj(
  cnpjDigitos: string,
  tomadores: Array<{ id: string; cnpj: string }>,
): string | null {
  const alvo = soDigitos(cnpjDigitos);
  if (alvo.length !== 14) return null;
  const match = tomadores.find((t) => soDigitos(t.cnpj) === alvo);
  return match ? match.id : null;
}

export function acharFornecedorPorCnpj(
  cnpjDigitos: string,
  fornecedores: Array<{ id: string; cpf_cnpj?: string | null }>,
): string | null {
  const alvo = soDigitos(cnpjDigitos);
  if (alvo.length !== 14) return null;
  const match = fornecedores.find((f) => {
    const d = soDigitos(f.cpf_cnpj);
    return d.length === 14 && d === alvo; // ignora CPF (11 dígitos)
  });
  return match ? match.id : null;
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `npx tsx --test lib/ia/matches-nf.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ia/matches-nf.ts lib/ia/matches-nf.test.ts
git commit -m "feat(nf-ia): helpers de match de CNPJ (tomador e emissor)"
```

---

## Task 5: Chamada à OpenAI Responses API com Structured Output

**Files:**
- Create: `lib/ia/ler-nf.ts`
- Create: `lib/ia/ler-nf.test.ts`

**Interfaces:**
- Produces: `lerDadosBrutosDaNF(pdfBuffer: Buffer): Promise<{ dados: DadosBrutosNF; tokensIn: number; tokensOut: number }>`. Chama OpenAI, parseia o JSON do structured output, retorna dados crus (ainda não validados — Task 6 valida).
- Produces: tipo `DadosBrutosNF` (todos os campos do schema, incluindo `confianca_baixa`).

- [ ] **Step 1: Escrever os testes falhando (com mock da OpenAI)**

Arquivo `lib/ia/ler-nf.test.ts`:

```typescript
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { lerDadosBrutosDaNF, SCHEMA_DADOS_NF } from "./ler-nf";

// Mock do cliente OpenAI (import antes do SUT via dynamic import pattern)
function fakeOpenAIClient(respostaJson: string, tokensIn = 1000, tokensOut = 100) {
  return {
    responses: {
      create: async () => ({
        output_text: respostaJson,
        usage: { input_tokens: tokensIn, output_tokens: tokensOut },
      }),
    },
  };
}

test("SCHEMA_DADOS_NF tem todos os 9 campos obrigatórios do spec", () => {
  const required = SCHEMA_DADOS_NF.required ?? [];
  assert.deepEqual(required.sort(), [
    "cnpj_emissor",
    "cnpj_tomador",
    "confianca_baixa",
    "data_emissao",
    "descricao_servico",
    "numero_nf",
    "razao_social_emissor",
    "razao_social_tomador",
    "valor_total",
  ]);
});

test("lerDadosBrutosDaNF parseia resposta e retorna tokens", async (t) => {
  const resposta = JSON.stringify({
    numero_nf: "12345",
    data_emissao: "2026-10-01",
    razao_social_emissor: "FORNECEDOR TESTE LTDA",
    cnpj_emissor: "11222333000144",
    razao_social_tomador: "CALIFORNIA FILMES",
    cnpj_tomador: "19437976000154",
    valor_total: 5000,
    descricao_servico: "Produção audiovisual",
    confianca_baixa: false,
  });

  // Monkey-patch do getOpenAIClient só pra este teste
  const mod = await import("./openai-client");
  const original = mod.getOpenAIClient;
  (mod as unknown as { getOpenAIClient: () => unknown }).getOpenAIClient = () =>
    fakeOpenAIClient(resposta, 2000, 200);

  const r = await lerDadosBrutosDaNF(Buffer.from("fake-pdf"));

  assert.equal(r.dados.numero_nf, "12345");
  assert.equal(r.dados.cnpj_emissor, "11222333000144");
  assert.equal(r.dados.valor_total, 5000);
  assert.equal(r.dados.confianca_baixa, false);
  assert.equal(r.tokensIn, 2000);
  assert.equal(r.tokensOut, 200);

  (mod as unknown as { getOpenAIClient: () => unknown }).getOpenAIClient = original;
});

test("lerDadosBrutosDaNF retorna nulls quando IA diz que não identificou", async () => {
  const resposta = JSON.stringify({
    numero_nf: null,
    data_emissao: null,
    razao_social_emissor: null,
    cnpj_emissor: null,
    razao_social_tomador: null,
    cnpj_tomador: null,
    valor_total: null,
    descricao_servico: null,
    confianca_baixa: true,
  });

  const mod = await import("./openai-client");
  const original = mod.getOpenAIClient;
  (mod as unknown as { getOpenAIClient: () => unknown }).getOpenAIClient = () =>
    fakeOpenAIClient(resposta);

  const r = await lerDadosBrutosDaNF(Buffer.from("fake"));
  assert.equal(r.dados.numero_nf, null);
  assert.equal(r.dados.confianca_baixa, true);

  (mod as unknown as { getOpenAIClient: () => unknown }).getOpenAIClient = original;
});

test("lerDadosBrutosDaNF lança erro se resposta não é JSON válido", async () => {
  const mod = await import("./openai-client");
  const original = mod.getOpenAIClient;
  (mod as unknown as { getOpenAIClient: () => unknown }).getOpenAIClient = () =>
    fakeOpenAIClient("isto não é json");

  await assert.rejects(() => lerDadosBrutosDaNF(Buffer.from("fake")));

  (mod as unknown as { getOpenAIClient: () => unknown }).getOpenAIClient = original;
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npx tsx --test lib/ia/ler-nf.test.ts`
Expected: FAIL com "Cannot find module './ler-nf'".

- [ ] **Step 3: Implementar `lib/ia/ler-nf.ts`**

```typescript
import { getOpenAIClient, MODELO_LEITURA_NF } from "./openai-client";

export interface DadosBrutosNF {
  numero_nf: string | null;
  data_emissao: string | null;
  razao_social_emissor: string | null;
  cnpj_emissor: string | null;
  razao_social_tomador: string | null;
  cnpj_tomador: string | null;
  valor_total: number | null;
  descricao_servico: string | null;
  confianca_baixa: boolean;
}

/** O schema que o Structured Output da OpenAI força. `strict: true` garante
 *  conformance no decoder (não é só prompt). Spec D4. */
export const SCHEMA_DADOS_NF = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "numero_nf",
    "data_emissao",
    "razao_social_emissor",
    "cnpj_emissor",
    "razao_social_tomador",
    "cnpj_tomador",
    "valor_total",
    "descricao_servico",
    "confianca_baixa",
  ],
  properties: {
    numero_nf: { type: ["string", "null"] as const },
    data_emissao: {
      type: ["string", "null"] as const,
      description: "ISO YYYY-MM-DD, só se identificar com certeza",
    },
    razao_social_emissor: { type: ["string", "null"] as const },
    cnpj_emissor: {
      type: ["string", "null"] as const,
      description: "14 dígitos, só números, sem formatação",
    },
    razao_social_tomador: { type: ["string", "null"] as const },
    cnpj_tomador: {
      type: ["string", "null"] as const,
      description: "14 dígitos, só números, sem formatação",
    },
    valor_total: { type: ["number", "null"] as const },
    descricao_servico: {
      type: ["string", "null"] as const,
      description: "Resumo em 1 linha do serviço/produto da NF",
    },
    confianca_baixa: {
      type: "boolean" as const,
      description: "true se o documento está borrado, incompleto ou se há dúvida relevante",
    },
  },
};

const PROMPT = `Você está lendo o PDF de uma Nota Fiscal brasileira (DANFE ou NFSe).
Extraia os dados nos campos do schema. Use null quando não puder identificar com certeza — nunca invente, nunca chute.
CNPJ emissor é de quem EMITIU a NF (fornecedor). CNPJ tomador é de quem RECEBEU o serviço/produto (destinatário).
Marque confianca_baixa=true se o documento estiver borrado, incompleto, cortado ou se houver qualquer dúvida relevante.`;

/** Chama a Responses API com o PDF em base64 e retorna os dados brutos +
 *  contagem de tokens pra audit. Não valida: Task 6 valida depois. */
export async function lerDadosBrutosDaNF(
  pdfBuffer: Buffer,
): Promise<{ dados: DadosBrutosNF; tokensIn: number; tokensOut: number }> {
  const cliente = getOpenAIClient();
  const b64 = pdfBuffer.toString("base64");

  const resp = await cliente.responses.create({
    model: MODELO_LEITURA_NF,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "nf.pdf",
            file_data: `data:application/pdf;base64,${b64}`,
          },
          { type: "input_text", text: PROMPT },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "dados_nf", strict: true, schema: SCHEMA_DADOS_NF },
    },
    max_output_tokens: 1024,
  } as never); // SDK types pra Responses API mudam entre versões; `as never` evita conflito aqui.

  const texto = (resp as { output_text?: string }).output_text ?? "";
  const usage = (resp as { usage?: { input_tokens: number; output_tokens: number } }).usage;
  const dados = JSON.parse(texto) as DadosBrutosNF;

  return {
    dados,
    tokensIn: usage?.input_tokens ?? 0,
    tokensOut: usage?.output_tokens ?? 0,
  };
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `npx tsx --test lib/ia/ler-nf.test.ts`
Expected: PASS.

**Nota pro executor:** se o SDK da OpenAI tiver mudado a assinatura da Responses API (`responses.create`), ajustar os nomes dos campos (`output_text`, `usage.input_tokens`) conforme a versão instalada. O teste mocka a estrutura, então rodar o teste real contra a API de verdade é out-of-scope aqui (feito manualmente na Task 7).

- [ ] **Step 5: Commit**

```bash
git add lib/ia/ler-nf.ts lib/ia/ler-nf.test.ts
git commit -m "feat(nf-ia): leitor OpenAI com Structured Output (gpt-5-mini)"
```

---

## Task 6: Server action `lerDadosDaNFPorIA` (orquestração)

**Files:**
- Create: `app/(app)/jobs/[jobId]/realizado/actions-ler-nf.ts`
- Create: `app/(app)/jobs/[jobId]/realizado/actions-ler-nf.test.ts`

**Interfaces:**
- Consumes: tabela `nf_extracao_cache` (Task 1), `DadosExtraidosNF` (Task 1), audit action (Task 1), `MODELO_LEITURA_NF` (Task 2), `lerDadosBrutosDaNF` (Task 5), validações (Task 3), matches (Task 4).
- Produces: server action `lerDadosDaNFPorIA(input)` com assinatura:

```typescript
export async function lerDadosDaNFPorIA(input: {
  anexo_path: string;
  mimetype: string;
  tomadores: Array<{ id: string; cnpj: string }>;
  fornecedores: Array<{ id: string; cpf_cnpj?: string | null }>;
}): Promise<
  | { ok: true; dados: DadosExtraidosNF; cache_hit: boolean }
  | { ok: false; message: string }
>;
```

Consumida pela Task 7 (UI).

- [ ] **Step 1: Escrever os testes falhando**

Arquivo `actions-ler-nf.test.ts` (foca na validação de input e orquestração — a chamada à OpenAI já é testada na Task 5):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarInputLeituraNF } from "./actions-ler-nf";

test("validarInputLeituraNF — rejeita mimetype não-PDF", () => {
  const r = validarInputLeituraNF({
    anexo_path: "tenant-1/pps/pp-1/nf.jpg",
    mimetype: "image/jpeg",
    tenantId: "tenant-1",
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /PDF/i);
});

test("validarInputLeituraNF — rejeita path de outro tenant", () => {
  const r = validarInputLeituraNF({
    anexo_path: "outro-tenant/pps/pp-1/nf.pdf",
    mimetype: "application/pdf",
    tenantId: "tenant-1",
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /inválido/i);
});

test("validarInputLeituraNF — aceita path do próprio tenant com PDF", () => {
  const r = validarInputLeituraNF({
    anexo_path: "tenant-1/pps/pp-1/nf.pdf",
    mimetype: "application/pdf",
    tenantId: "tenant-1",
  });
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npx tsx --test app/\(app\)/jobs/\[jobId\]/realizado/actions-ler-nf.test.ts`
Expected: FAIL com "Cannot find module './actions-ler-nf'".

- [ ] **Step 3: Implementar `actions-ler-nf.ts`**

```typescript
"use server";

import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import type { DadosExtraidosNF } from "@/lib/types";
import { MODELO_LEITURA_NF } from "@/lib/ia/openai-client";
import { lerDadosBrutosDaNF, type DadosBrutosNF } from "@/lib/ia/ler-nf";
import {
  validarCnpj,
  validarDataEmissao,
  validarValor,
  validarNumeroNF,
  validarDescricao,
} from "@/lib/ia/validacoes-nf";
import {
  acharEstabelecimentoPorCnpj,
  acharFornecedorPorCnpj,
} from "@/lib/ia/matches-nf";

type Err = { ok: false; message: string };
type Ok = { ok: true; dados: DadosExtraidosNF; cache_hit: boolean };

/** Validação do input, separada da action pra ser testável sem mock de
 *  sessão. Spec: só PDF; path precisa começar com o tenant do usuário. */
export function validarInputLeituraNF(input: {
  anexo_path: string;
  mimetype: string;
  tenantId: string;
}): { ok: true } | Err {
  if (input.mimetype !== "application/pdf") {
    return { ok: false, message: "Só PDF por enquanto. Outros formatos ainda não são suportados." };
  }
  if (!input.anexo_path.startsWith(`${input.tenantId}/`)) {
    return { ok: false, message: "Caminho do anexo inválido." };
  }
  return { ok: true };
}

export async function lerDadosDaNFPorIA(input: {
  anexo_path: string;
  mimetype: string;
  tomadores: Array<{ id: string; cnpj: string }>;
  fornecedores: Array<{ id: string; cpf_cnpj?: string | null }>;
}): Promise<Ok | Err> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;

  const check = validarInputLeituraNF({
    anexo_path: input.anexo_path,
    mimetype: input.mimetype,
    tenantId,
  });
  if (!check.ok) return check;

  const supabase = createClient();

  // Baixa o PDF do bucket.
  const { data: blob, error: errDownload } = await supabase.storage
    .from("pedidos-compra")
    .download(input.anexo_path);
  if (errDownload || !blob) {
    return { ok: false, message: "Não consegui baixar o PDF do anexo." };
  }
  const arrayBuffer = await blob.arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);
  const hash = createHash("sha256").update(pdfBuffer).digest("hex");

  // Consulta cache (filtrando por modelo pra não ler cache stale se trocar).
  const { data: cached } = await supabase
    .from("nf_extracao_cache")
    .select("dados")
    .eq("tenant_id", tenantId)
    .eq("hash_sha256", hash)
    .eq("modelo", MODELO_LEITURA_NF)
    .maybeSingle();

  let dadosBrutos: DadosBrutosNF;
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheHit = false;

  if (cached) {
    // Cache guarda o `DadosBrutosNF` (antes do match contra as listas, que
    // dependem do estado atual do tenant — fornecedor novo cadastrado hoje
    // precisa aparecer no match amanhã).
    dadosBrutos = cached.dados as DadosBrutosNF;
    cacheHit = true;
  } else {
    try {
      const r = await lerDadosBrutosDaNF(pdfBuffer);
      dadosBrutos = r.dados;
      tokensIn = r.tokensIn;
      tokensOut = r.tokensOut;
    } catch (err) {
      await logAuditEvent({
        acao: "pp.anexo.nf_lida_por_ia",
        tenantId,
        entidadeTipo: "pedido_compra_anexo",
        entidadeId: input.anexo_path,
        metadata: {
          arquivo_hash: hash,
          cache_hit: false,
          modelo: MODELO_LEITURA_NF,
          erro: err instanceof Error ? err.message : String(err),
        },
      });
      return {
        ok: false,
        message: "Falha ao ler a NF pela IA. Preencha os campos manualmente.",
      };
    }

    // Grava cache (ignora conflito — se outra request chegou primeiro, tudo bem).
    await supabase.from("nf_extracao_cache").insert({
      tenant_id: tenantId,
      hash_sha256: hash,
      dados: dadosBrutos,
      modelo: MODELO_LEITURA_NF,
    });
  }

  // Valida e matcha com as listas que vieram do form.
  const hojeIso = hojeEmSaoPauloIso();
  const cnpjEmissor = validarCnpj(dadosBrutos.cnpj_emissor);
  const cnpjTomador = validarCnpj(dadosBrutos.cnpj_tomador);

  const dados: DadosExtraidosNF = {
    numero_nf: validarNumeroNF(dadosBrutos.numero_nf),
    data_emissao: validarDataEmissao(dadosBrutos.data_emissao, hojeIso),
    valor_total: validarValor(dadosBrutos.valor_total),
    descricao_servico: validarDescricao(dadosBrutos.descricao_servico),
    tomador: {
      cnpj: cnpjTomador,
      razao_social: dadosBrutos.razao_social_tomador?.trim() || null,
      estabelecimento_id_match: cnpjTomador
        ? acharEstabelecimentoPorCnpj(cnpjTomador, input.tomadores)
        : null,
    },
    emissor: {
      cnpj: cnpjEmissor,
      razao_social: dadosBrutos.razao_social_emissor?.trim() || null,
      fornecedor_id_match: cnpjEmissor
        ? acharFornecedorPorCnpj(cnpjEmissor, input.fornecedores)
        : null,
    },
    confianca_baixa: dadosBrutos.confianca_baixa,
  };

  // Audit log (preço estimado conservador: gpt-5-mini ~ $0.25/1M in, $2/1M out).
  const custoUsd = (tokensIn / 1_000_000) * 0.25 + (tokensOut / 1_000_000) * 2;
  await logAuditEvent({
    acao: "pp.anexo.nf_lida_por_ia",
    tenantId,
    entidadeTipo: "pedido_compra_anexo",
    entidadeId: input.anexo_path,
    metadata: {
      arquivo_hash: hash,
      cache_hit: cacheHit,
      modelo: MODELO_LEITURA_NF,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      custo_usd_estimado: Number(custoUsd.toFixed(6)),
      confianca_baixa: dadosBrutos.confianca_baixa,
    },
  });

  return { ok: true, dados, cache_hit: cacheHit };
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `npx tsx --test app/\(app\)/jobs/\[jobId\]/realizado/actions-ler-nf.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Rodar `tsc` para checar integração**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/realizado/actions-ler-nf.ts \
        app/\(app\)/jobs/\[jobId\]/realizado/actions-ler-nf.test.ts
git commit -m "feat(nf-ia): server action lerDadosDaNFPorIA com cache e audit"
```

---

## Task 7: UI — botão "Ler NF automaticamente" + badge "IA" + avisos de match

**Files:**
- Modify: `app/(app)/jobs/[jobId]/realizado/anexos-da-pp.tsx`

**Interfaces:**
- Consumes: server action `lerDadosDaNFPorIA` (Task 6), tipo `DadosExtraidosNF` (Task 1).
- Produces: botão visual + badge "IA" por campo + bloco de avisos abaixo dos campos. Nenhum export novo.

**Esta task NÃO tem TDD puro** — é mudança de UI dentro de um componente grande. O ciclo é: implementar, rodar dev server, testar manualmente com uma NF real do usuário, confirmar os critérios de aceite do spec (12 critérios).

- [ ] **Step 1: Modificar a assinatura do `NfDoAnexo`**

Adicionar nos props do componente `NfDoAnexo` em `anexos-da-pp.tsx` (depois dos props existentes, antes de `}: {`):

```typescript
  /** O path do arquivo no bucket pedidos-compra. Null = anexo ainda não
   *  subiu ou é um placeholder. Sem path, o botão "Ler NF por IA" não aparece. */
  anexoPath?: string | null;
  /** O mimetype do arquivo. Só PDF habilita o botão de IA (spec). */
  anexoMimetype?: string | null;
  /** Fornecedores do tenant, pra match de CNPJ emissor. Vem do form. */
  fornecedores?: Array<{ id: string; cpf_cnpj?: string | null }>;
  /** O fornecedor atualmente selecionado no PP. Pra comparar com o match. */
  fornecedorAtualId?: string | null;
  /** Nome do fornecedor atual, pra montar o aviso em texto. */
  fornecedorAtualNome?: string | null;
  /** O campo `servico` do PP, pra decidir se mostra o botão "Usar como descrição". */
  servicoAtual?: string;
  /** Callback do botão "Usar como descrição do PP". Só vem se `servicoAtual` existe. */
  onUsarDescricao?: (descricao: string) => void;
```

- [ ] **Step 2: Adicionar estado local no `NfDoAnexo`**

Logo após as linhas de `const t = tomadores.find(...)`:

```typescript
  const [extraindoIA, setExtraindoIA] = React.useState(false);
  const [resultadoIA, setResultadoIA] = React.useState<{
    dados: DadosExtraidosNF;
    cache_hit: boolean;
    aplicado_em: Set<"numero" | "emissao" | "valor" | "tomador">;
  } | null>(null);
  const [erroIA, setErroIA] = React.useState<string | null>(null);
```

- [ ] **Step 3: Importar o tipo e a action no topo do arquivo**

Adicionar nos imports:

```typescript
import type { DadosExtraidosNF } from "@/lib/types";
import { lerDadosDaNFPorIA } from "./actions-ler-nf";
import { Sparkles } from "lucide-react";
import { formatCnpj } from "@/lib/utils"; // se não existir, usar helper inline
```

- [ ] **Step 4: Função que dispara a leitura**

Dentro do `NfDoAnexo`, antes do `return`:

```typescript
  async function dispararLeituraIA() {
    if (!anexoPath || anexoMimetype !== "application/pdf") return;
    setExtraindoIA(true);
    setErroIA(null);
    const r = await lerDadosDaNFPorIA({
      anexo_path: anexoPath,
      mimetype: anexoMimetype,
      tomadores: tomadores.map((t) => ({ id: t.id, cnpj: t.cnpj })),
      fornecedores: fornecedores ?? [],
    });
    setExtraindoIA(false);
    if (!r.ok) {
      setErroIA(r.message);
      return;
    }
    const aplicado = new Set<"numero" | "emissao" | "valor" | "tomador">();
    const parcial: Partial<NfDigitada> = {};
    if (r.dados.numero_nf && !nf.numero.trim()) {
      parcial.numero = r.dados.numero_nf;
      aplicado.add("numero");
    }
    if (r.dados.data_emissao && !nf.emissao) {
      parcial.emissao = r.dados.data_emissao;
      aplicado.add("emissao");
    }
    if (r.dados.valor_total && nf.valor === 0) {
      parcial.valor = r.dados.valor_total;
      aplicado.add("valor");
    }
    if (r.dados.tomador.estabelecimento_id_match && !nf.tomador) {
      parcial.tomador = r.dados.tomador.estabelecimento_id_match;
      aplicado.add("tomador");
    }
    if (Object.keys(parcial).length > 0) onMudar(parcial);
    setResultadoIA({ dados: r.dados, cache_hit: r.cache_hit, aplicado_em: aplicado });
  }

  function removerBadgeDe(campo: "numero" | "emissao" | "valor" | "tomador") {
    if (!resultadoIA) return;
    if (!resultadoIA.aplicado_em.has(campo)) return;
    const novo = new Set(resultadoIA.aplicado_em);
    novo.delete(campo);
    setResultadoIA({ ...resultadoIA, aplicado_em: novo });
  }
```

- [ ] **Step 5: Renderizar o botão no topo do bloco da NF**

Logo depois do `const abriuSozinho = React.useRef(false);`, antes do `return`:

```typescript
  const podeLerIA = !travada && anexoPath && anexoMimetype === "application/pdf" && !resultadoIA;
  const botaoDesabilitadoRazao = !anexoPath
    ? "Aguarde o upload terminar"
    : anexoMimetype !== "application/pdf"
      ? "Só PDF por enquanto"
      : null;
```

E dentro do return, antes dos campos da NF:

```tsx
      {!travada && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {podeLerIA && !extraindoIA && (
            <button
              type="button"
              onClick={dispararLeituraIA}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-california-red/5 px-2.5 py-1 text-xs font-medium text-california-red transition-colors hover:bg-california-red/10 disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ler NF automaticamente
            </button>
          )}
          {extraindoIA && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Lendo a NF…
            </span>
          )}
          {botaoDesabilitadoRazao && anexoPath && (
            <span className="text-[11px] text-muted-foreground" title={botaoDesabilitadoRazao}>
              {botaoDesabilitadoRazao}
            </span>
          )}
          {erroIA && (
            <span className="text-[11px] text-california-red" role="alert">
              {erroIA}
            </span>
          )}
        </div>
      )}
```

- [ ] **Step 6: Badge "IA" nos campos preenchidos**

Dentro de cada um dos 4 campos (número, emissão, valor, tomador), adicionar o badge como filho inline. Exemplo pro campo número:

```tsx
      <label className={rotulo}>
        Número{ast}
        {resultadoIA?.aplicado_em.has("numero") && (
          <span className="ml-1.5 inline-block rounded bg-amber-100 px-1 text-[10px] font-semibold uppercase text-amber-800">
            IA
          </span>
        )}
      </label>
      <Input
        value={nf.numero}
        onChange={(e) => {
          onMudar({ numero: e.target.value });
          removerBadgeDe("numero");
        }}
        ...
      />
```

Repetir pattern para `emissao`, `valor`, `tomador` com os campos correspondentes. **Importante:** cada handler de mudança chama `removerBadgeDe(...)` depois de `onMudar(...)`.

- [ ] **Step 7: Avisos de match e divergência (depois dos campos)**

Logo após o grid dos 4 campos, antes de `</div>` final:

```tsx
      {resultadoIA && (
        <div className="mt-2 space-y-1 text-[11.5px]">
          {resultadoIA.dados.tomador.cnpj &&
            resultadoIA.dados.tomador.estabelecimento_id_match === null && (
              <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                CNPJ tomador da NF ({formatCnpj(resultadoIA.dados.tomador.cnpj)}) não bate
                com nenhuma empresa cadastrada — selecione manualmente.
              </p>
            )}
          {resultadoIA.dados.emissor.fornecedor_id_match &&
            resultadoIA.dados.emissor.fornecedor_id_match !== fornecedorAtualId && (
              <p className="rounded border border-california-red/30 bg-california-red/5 px-2 py-1 text-california-red">
                Atenção: esta NF foi emitida por {resultadoIA.dados.emissor.razao_social ?? "outro fornecedor"},
                mas a PP é do {fornecedorAtualNome ?? "fornecedor selecionado"}.
              </p>
            )}
          {resultadoIA.dados.emissor.cnpj &&
            resultadoIA.dados.emissor.fornecedor_id_match === null && (
              <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                Fornecedor da NF ({formatCnpj(resultadoIA.dados.emissor.cnpj)}) não está cadastrado.
              </p>
            )}
          {valorPP > 0 &&
            resultadoIA.dados.valor_total !== null &&
            Math.abs(resultadoIA.dados.valor_total - valorPP) > 0.01 && (
              <p className="rounded border border-border bg-muted/40 px-2 py-1 text-muted-foreground">
                Valor da NF ({formatCurrency(resultadoIA.dados.valor_total)}) não bate com valor
                da PP ({formatCurrency(valorPP)}) — pode ser NF que cobre múltiplas PPs.
              </p>
            )}
          {resultadoIA.dados.descricao_servico && (
            <p className="flex items-start gap-2 rounded border border-border bg-muted/20 px-2 py-1 text-muted-foreground">
              <span>
                <strong className="text-foreground">A NF menciona:</strong>{" "}
                {resultadoIA.dados.descricao_servico}
              </span>
              {!servicoAtual?.trim() && onUsarDescricao && (
                <button
                  type="button"
                  onClick={() => onUsarDescricao(resultadoIA.dados.descricao_servico!)}
                  className="flex-none text-xs font-medium text-california-red hover:underline"
                >
                  Usar como descrição do PP
                </button>
              )}
            </p>
          )}
          {resultadoIA.dados.confianca_baixa && (
            <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
              A IA sinalizou baixa confiança nesta leitura — confira todos os campos com atenção.
            </p>
          )}
        </div>
      )}
```

- [ ] **Step 8: Propagar os novos props do `NfDoAnexo` nos pontos de uso**

Em `anexos-da-pp.tsx` já existe `NfDoAnexo` sendo renderizado dentro de `renderNf` no formulário. Procurar os dois pontos (drawer "Novo PP" via `gerar-pp-drawer.tsx` e modal "Enviar ao financeiro" — o mesmo componente é consumido pelos dois) e adicionar os novos props. **Rodar `grep -r "<NfDoAnexo"` pra achar os call sites** e passar:

- `anexoPath={anexo.arquivo_path}` (vem do item de anexo)
- `anexoMimetype={anexo.mime}`
- `fornecedores={fornecedores}` (já no escopo)
- `fornecedorAtualId={dados.fornecedor_id}`
- `fornecedorAtualNome={fornecedorEscolhido?.nome ?? null}`
- `servicoAtual={dados.servico}`
- `onUsarDescricao={(d) => onDadosChange({ ...dados, servico: d })}` (nome do handler conforme já existe no form)

- [ ] **Step 9: Rodar `tsc` e `lint`**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 10: Testar manualmente no dev server**

Run: `npm run dev`

Fluxo de teste (todos os 12 critérios de aceite do spec):

1. Abrir um PP a emitir → anexar PDF de uma NF real → marcar tipo "NF" → botão aparece.
2. Clicar → spinner 2–4s → campos preenchidos com badge "IA" amarelo.
3. Conferir que CNPJ tomador da NF bateu com uma empresa cadastrada → dropdown pré-selecionado.
4. Trocar a NF por uma de outro fornecedor → aviso vermelho de divergência aparece.
5. Editar um campo com badge "IA" → badge some.
6. Trocar o PDF → botão reaparece.
7. Anexar o mesmo PDF novamente → extração instantânea (cache hit, sem 2–4s).
8. Anexar JPG marcado como NF → botão não aparece / mostra "Só PDF por enquanto".
9. Desligar internet (ou mockar erro) → toast de erro vermelho; formulário continua editável.
10. Confirmar no banco (via `mcp__supabase__execute_sql`) que `audit_logs` tem evento `pp.anexo.nf_lida_por_ia` com metadata completo.
11. Confirmar que nada foi salvo em `pedidos_compra_anexos` — só o estado local foi preenchido.
12. Salvar o PP normalmente → dados persistidos como se tivessem sido digitados.

- [ ] **Step 11: Commit**

```bash
git add app/\(app\)/jobs/\[jobId\]/realizado/anexos-da-pp.tsx \
        app/\(app\)/jobs/\[jobId\]/realizado/gerar-pp-drawer.tsx
# (o drawer entra se foi tocado no step 8)
git commit -m "feat(nf-ia): botão de leitura automática + badge IA + avisos no anexo"
```
