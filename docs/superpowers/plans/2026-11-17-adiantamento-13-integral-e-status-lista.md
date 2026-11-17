# Adiantamento 13º Integral + Faxina da Lista de Adiantamentos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir o conceito de "adiantamento integral do 13º" (que quita o 13º inteiro e exclui o colaborador da folha do ano), limpar a lista de adiantamentos (remover coluna "Lançado", renomear "Antigo" → "Pago") e consolidar os 16 adiantamentos legados de 2026 na nova semântica.

**Architecture:**
- Coluna `integral boolean` em `decimo_terceiro_adiantamentos`. Quando `true`, o colaborador não gera linha em `decimo_terceiro_linhas` daquele ano.
- No fluxo novo (UI), checkbox "Pagamento integral" autopreenche o valor com o 13º bruto do colaborador e trava o campo. Server action helper calcula o bruto esperado.
- Lista de adiantamentos ganha coluna Status única (removendo "Lançado"): legados viram "Pago" (parcial) ou "Pago — integral", fluxo novo mantém "Aguardando NF/aprovação/aprovado/pago".
- Backfill: 4 legados integrais (identificados por data + valor + obs no banco) viram `integral = true`; um deles tem valor corrigido de R$ 14 pra R$ 14.000 (erro de digitação); outro ganha +R$ 0,01 pra zerar a 1ª parcela.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + RLS), React Hook Form não aplicável (dialog usa useState), Tailwind + shadcn/ui.

**Spec:** este próprio documento; discussão de 2026-11-17 no chat com Antonio (não há spec separado — decisões consolidadas aqui).

## Global Constraints

- Toda migration segue o ciclo de `docs/FLUXO-BANCO.md`: ler, escrever, aplicar via MCP, conferir, commitar junto do código que depende.
- Mudança destrutiva (correção do valor de um adiantamento de R$ 14 pra R$ 14.000) precisa do WHERE restritivo por data + valor atual, pra não bater em registro errado.
- Todas as strings de UI em pt-BR com acentos (CLAUDE.md "Ortografia em português").
- Dados pessoais **nunca** no repo: usar `colaborador_id` nas migrations, nunca nome/CPF/salário em cleartext.
- `lib/types.ts` escrito à mão — toda migration que mexe em coluna usada pelo frontend atualiza o tipo no mesmo commit.
- GRANT `authenticated` em tabela/coluna nova; nada pra `anon`.
- `tsc`, `lint`, `build` limpos antes de cada commit.

## Review Focus

1. **Colaborador com adiantamento integral + folha de 13º já criada** → `recalcularLinhaDeAdiantamento` precisa **deletar** a linha de 13º existente, não só zerar. Testado na Task 2.
2. **Colaborador com adiantamento integral + depois lança adiantamento parcial no mesmo ano** → validação deve bloquear (regra de negócio: ou é integral ou é parcial, nunca mistura). Testado na Task 4.
3. **Tentativa de marcar "integral" num colaborador sem salário vigente** → a server action helper retorna erro claro, não zero silencioso. Testado na Task 3.
4. **Integral marcado num colaborador cuja admissão é após 15/dez** (sem direito a avos) → o 13º bruto esperado é R$ 0; o checkbox "integral" não faz sentido, UI bloqueia com erro amigável. Testado na Task 3.
5. **Backfill rodando duas vezes** (ex.: re-apply da migration) → WHERE combina id + valor + obs atuais pra ser idempotente (não quebra e não dobra). Testado por inspeção manual pós-apply.

---

## File Structure

### Cria
- `supabase/migrations/20261117500001_adiantamento_13_integral.sql` — adiciona coluna `integral`.
- `supabase/migrations/20261117500002_backfill_adiantamentos_13_integrais_e_correcoes.sql` — marca legados integrais, corrige valor 14→14000, corrige outro valor 2520.83→2520.84, remove linhas de 13º dos 4 integrais, recalcula linha do ajustado.
- `app/(app)/rh/decimo-terceiro/actions.ts:calcularTreizeBrutoEsperado` — nova server action helper (função exportada no mesmo arquivo).

### Modifica
- `lib/types.ts` — `DecimoTerceiroAdiantamento.integral: boolean`.
- `app/(app)/rh/decimo-terceiro/actions.ts` — `criarFolhaDecimoTerceiro` exclui integrais; `recalcularLinhaDeAdiantamento` deleta linha quando integral; `lancarAdiantamentoDecimoTerceiro` aceita `integral`; nova server action `calcularTreizeBrutoEsperado`.
- `app/(app)/rh/decimo-terceiro/[ano]/adiantamentos/lista-adiantamentos.tsx` — remove coluna "Lançado", muda variante `legado` → `pago`, adiciona variante `pago_integral`, checkbox "Pagamento integral" no dialog, autofill readonly.
- `app/(app)/rh/decimo-terceiro/[ano]/adiantamentos/page.tsx` — passa flag `integral` nos adiantamentos devolvidos (join simples).
- `lib/decimo-terceiro/calc.ts` — **sem mudanças** (regra de "integral abate ambas parcelas" vira "colaborador não entra na folha", lógica em actions, não em calc puro).

### Testes
- `lib/decimo-terceiro/calc.test.ts` — **sem mudanças** (calc puro não muda).
- Novo teste: `app/(app)/rh/decimo-terceiro/actions.test.ts` **não** existe hoje; vamos adicionar testes manuais via roteiro no commit da Task 2 (projeto não tem harness de testes de actions).

---

### Task 1: Schema — coluna `integral` em `decimo_terceiro_adiantamentos`

**Files:**
- Create: `supabase/migrations/20261117500001_adiantamento_13_integral.sql`
- Modify: `lib/types.ts:5897-5908` (interface `DecimoTerceiroAdiantamento`)

**Interfaces:**
- Produces: `decimo_terceiro_adiantamentos.integral` coluna `boolean not null default false` — todas as tasks seguintes dependem.
- Produces: tipo TS `DecimoTerceiroAdiantamento.integral: boolean`.

- [ ] **Step 1: Escrever a migration**

Conteúdo (racional no topo + ALTER TABLE):

```sql
-- Motivo: suporte a "adiantamento integral do 13º" — quando marcado, o
-- colaborador não gera linha na folha de 13º do ano. Aditiva. Default
-- false mantém o comportamento atual pra todos os registros existentes.

alter table public.decimo_terceiro_adiantamentos
  add column integral boolean not null default false;

comment on column public.decimo_terceiro_adiantamentos.integral is
  'Quando true, este adiantamento quita o 13º inteiro: o colaborador não gera linha em decimo_terceiro_linhas do mesmo ano.';
```

Nada de índice: a coluna é booleana, a seletividade pra "integral = true" é baixa dentro do subset (ano, colaborador) e já existe índice em `(colaborador_id, ano)`.

- [ ] **Step 2: Aplicar via MCP**

Use `mcp__supabase-write__apply_migration` com o nome `adiantamento_13_integral`.

- [ ] **Step 3: Conferir pelo MCP**

Via `mcp__supabase__execute_sql`: `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = 'decimo_terceiro_adiantamentos' and column_name = 'integral';`

Esperado: `integral | boolean | NO | false`.

- [ ] **Step 4: Atualizar `lib/types.ts`**

Em `DecimoTerceiroAdiantamento` (linha ~5897), adicionar após `obs`:

```ts
/** Quando true, quita o 13º inteiro: o colaborador não gera linha na folha do ano. */
integral: boolean;
```

- [ ] **Step 5: Rodar `pnpm tsc --noEmit` e `pnpm lint`**

Esperado: ambos limpos.

- [ ] **Step 6: Commitar**

```bash
git add supabase/migrations/20261117500001_adiantamento_13_integral.sql lib/types.ts
git commit -m "feat(13o): coluna integral em adiantamentos sinaliza pagamento do 13º inteiro"
```

---

### Task 2: Cálculo — colaborador com adiantamento integral sai da folha

**Files:**
- Modify: `app/(app)/rh/decimo-terceiro/actions.ts:51-327` (função `criarFolhaDecimoTerceiro`)
- Modify: `app/(app)/rh/decimo-terceiro/actions.ts:1238-1313` (função `recalcularLinhaDeAdiantamento`)

**Interfaces:**
- Consumes: coluna `integral` da Task 1.
- Produces: contrato "colaborador com qualquer adiantamento `integral=true` no ano **não** tem linha em `decimo_terceiro_linhas`"; Tasks 4 e 6 dependem.

- [ ] **Step 1: Modificar `criarFolhaDecimoTerceiro` — filtrar elegíveis**

Em `app/(app)/rh/decimo-terceiro/actions.ts`, dentro do bloco que monta `adiantamentos` (linhas ~121-136), também carregar `integral` no select:

```ts
.select("colaborador_id, valor, integral")
```

Logo abaixo do loop de `adiantadoPorColab`, construir `Set<string>` de colaboradores com integral:

```ts
const colabsComIntegral = new Set(
  (adiantamentos ?? []).filter((a) => a.integral).map((a) => a.colaborador_id),
);
```

Modificar o filtro de `elegiveis` (linha ~213-225) pra descartar quem está em `colabsComIntegral`:

```ts
.filter((c) => elegiveisIds.includes(c.id) && salarioPorColab.has(c.id) && !colabsComIntegral.has(c.id))
```

- [ ] **Step 2: Modificar `recalcularLinhaDeAdiantamento` — deletar linha quando integral**

Em `app/(app)/rh/decimo-terceiro/actions.ts:1238-1313`, antes do bloco que busca `linha`, verificar se o colaborador tem adiantamento integral no ano:

```ts
const { data: integralCheck } = await supabase
  .from("decimo_terceiro_adiantamentos")
  .select("id")
  .eq("tenant_id", tenantId)
  .eq("ano", ano)
  .eq("colaborador_id", colaboradorId)
  .eq("integral", true)
  .limit(1);

if ((integralCheck ?? []).length > 0) {
  // Deleta a linha da folha se existir — colaborador saiu do 13º do ano.
  await supabase
    .from("decimo_terceiro_linhas")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("folha_id", folha.id)
    .eq("colaborador_id", colaboradorId);
  return;
}
```

A query de `folha` original continua antes desse bloco (precisa do `folha.id`). Se não existir folha pro ano, o `return;` precoce da função atual já cobre.

- [ ] **Step 3: Rodar `pnpm tsc --noEmit` e `pnpm lint`**

Esperado: ambos limpos.

- [ ] **Step 4: Verificação funcional manual**

Via `mcp__supabase__execute_sql` na sandbox: marcar um adiantamento existente de teste como `integral=true`, chamar o fluxo de recalc (via UI ou script), confirmar que a linha correspondente em `decimo_terceiro_linhas` foi deletada. Depois desmarcar — a linha NÃO é restaurada automaticamente (regra: a reinclusão requer recriar a folha ou excluir o adiantamento integral).

- [ ] **Step 5: Commitar**

```bash
git add app/(app)/rh/decimo-terceiro/actions.ts
git commit -m "feat(13o): colaborador com adiantamento integral sai da folha do ano"
```

---

### Task 3: Server action helper — calcular 13º bruto esperado

**Files:**
- Modify: `app/(app)/rh/decimo-terceiro/actions.ts` — adicionar export `calcularTreizeBrutoEsperado`.

**Interfaces:**
- Produces: `async function calcularTreizeBrutoEsperado(input: { colaborador_id: string; ano: number }): Promise<ActionResult<{ bruto: number }>>`. Task 4 consome.

- [ ] **Step 1: Escrever a função**

Em `app/(app)/rh/decimo-terceiro/actions.ts`, ao final do arquivo (antes do último export):

```ts
const CalcularBrutoInput = z.object({
  colaborador_id: z.string().uuid(),
  ano: z.number().int().min(2020).max(2100),
});

export async function calcularTreizeBrutoEsperado(input: {
  colaborador_id: string;
  ano: number;
}): Promise<ActionResult<{ bruto: number }>> {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.editar")) {
    return { ok: false, message: "Sem permissão para esta ação." };
  }
  const parsed = CalcularBrutoInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  const { colaborador_id, ano } = parsed.data;
  const tenantId = session.activeTenant.id;
  const supabase = createClient();

  // Busca colaborador + salário vigente + valor_recibo
  // Retorna erro amigável se:
  //   - colaborador não existe no tenant
  //   - não tem salário vigente
  //   - avos = 0 (admissão após 15/12 do ano)
  // Retorna { bruto: totalBruto da calcularLinhaDecimoTerceiro com totalAdiantado=0 }
}
```

A implementação segue o padrão de `criarFolhaDecimoTerceiro`: busca `colaboradores`, `colaboradores_salarios` (`data_fim is null`), chama `calcularLinhaDecimoTerceiro({ ..., totalAdiantado: 0 })`, devolve `totalBruto`.

- [ ] **Step 2: Rodar `pnpm tsc --noEmit` e `pnpm lint`**

Esperado: limpos.

- [ ] **Step 3: Teste funcional manual**

Via UI (próxima task) ou snippet temporário: chamar com um colaborador PJ ativo — esperar valor > 0; chamar com colaborador admitido 20/12 do ano — esperar erro "sem direito a avos no ano"; chamar com ID inexistente — esperar "colaborador não encontrado".

- [ ] **Step 4: Commitar**

```bash
git add app/(app)/rh/decimo-terceiro/actions.ts
git commit -m "feat(13o): action calcula 13º bruto esperado por colaborador/ano"
```

---

### Task 4: UI do novo adiantamento — checkbox "Pagamento integral"

**Files:**
- Modify: `app/(app)/rh/decimo-terceiro/[ano]/adiantamentos/lista-adiantamentos.tsx:254-394` (função `NovoAdiantamentoDialogContent`)
- Modify: `app/(app)/rh/decimo-terceiro/actions.ts:lancarAdiantamentoDecimoTerceiro` (aceitar e persistir `integral`)

**Interfaces:**
- Consumes: `calcularTreizeBrutoEsperado` da Task 3, coluna `integral` da Task 1.
- Produces: `lancarAdiantamentoDecimoTerceiro` agora aceita `integral: boolean`.

- [ ] **Step 1: Estender `lancarAdiantamentoDecimoTerceiro`**

Em `actions.ts:1315`, adicionar `integral: boolean` ao input do Zod + à assinatura. No insert em `decimo_terceiro_adiantamentos` (linhas 1350-1362), passar `integral: input.integral ?? false`.

Validação cruzada ANTES do insert:

```ts
// Já existe adiantamento no ano pro colaborador? Regra: ou integral,
// ou vários parciais — nunca mistura.
const { data: existentes } = await supabase
  .from("decimo_terceiro_adiantamentos")
  .select("id, integral")
  .eq("tenant_id", tenantId)
  .eq("ano", ano)
  .eq("colaborador_id", colaborador_id);

const temIntegral = (existentes ?? []).some((e) => e.integral);
if (temIntegral) {
  return { ok: false, message: "Este colaborador já tem um adiantamento integral registrado no ano." };
}
if (input.integral && (existentes ?? []).length > 0) {
  return { ok: false, message: "Não é possível lançar adiantamento integral: o colaborador já tem adiantamentos parciais no ano." };
}
```

- [ ] **Step 2: UI do dialog — checkbox + autofill**

Em `lista-adiantamentos.tsx`, no componente `NovoAdiantamentoDialogContent`:

- Importar `Checkbox` de `@/components/ui/checkbox` (se não existir, usar `<input type="checkbox">` com classes tailwind seguindo padrão do projeto).
- Adicionar state `const [integral, setIntegral] = React.useState(false)`.
- Adicionar state `const [carregandoBruto, setCarregandoBruto] = React.useState(false)`.
- Adicionar `useEffect` que, ao mudar `colabId` OU `integral`, se `integral === true` E `colabId !== ""`, chama `calcularTreizeBrutoEsperado({ colaborador_id: colabId, ano })` e seta `valor` com o valor retornado formatado. Se erro, exibe em `erro` e desmarca o checkbox.
- No `<Input type="number" valor>`, adicionar `readOnly={integral}` e `className={integral ? "bg-muted cursor-not-allowed" : ""}`.
- No `handleSalvar`, passar `integral` no payload da action.
- Checkbox com label `"Pagamento integral do 13º"` + helper `"Quita o 13º inteiro. O colaborador não participa da folha deste ano."`.

Layout: checkbox logo abaixo do Select de colaborador, antes da linha de Data/Valor.

- [ ] **Step 3: Testar manualmente — happy path**

Marcar integral com um colaborador PJ — valor preenche com salário × avos / 6 × 2, campo trava. Lançar — adiantamento é criado com `integral=true`, a linha de 13º dele desaparece da folha.

- [ ] **Step 4: Testar — validações**

- Tentar lançar integral quando já existe parcial → erro "já tem adiantamentos parciais".
- Tentar lançar parcial quando já existe integral → erro "já tem adiantamento integral".
- Tentar lançar integral num colaborador sem salário vigente → erro propagado do helper.

- [ ] **Step 5: `pnpm tsc --noEmit && pnpm lint && pnpm build`**

Esperado: limpos.

- [ ] **Step 6: Commitar**

```bash
git add app/(app)/rh/decimo-terceiro/actions.ts app/(app)/rh/decimo-terceiro/[ano]/adiantamentos/lista-adiantamentos.tsx
git commit -m "feat(13o): checkbox 'Pagamento integral' autopreenche valor do 13º e exclui colaborador da folha"
```

---

### Task 5: UI da lista — remover "Lançado", "Antigo" → "Pago", novo "Pago — integral"

**Files:**
- Modify: `app/(app)/rh/decimo-terceiro/[ano]/adiantamentos/lista-adiantamentos.tsx:34-72, 150-249` (interface `AdiantamentoRow`, `derivarStatusAdiantamento`, tabela)
- Modify: `app/(app)/rh/decimo-terceiro/[ano]/adiantamentos/page.tsx` — passar `integral` no `AdiantamentoRow[]`.

**Interfaces:**
- Consumes: coluna `integral` via `AdiantamentoRow`.

- [ ] **Step 1: Estender `AdiantamentoRow` com `integral: boolean`**

Em `lista-adiantamentos.tsx:34-46`, adicionar `integral: boolean;`.

- [ ] **Step 2: Atualizar `page.tsx` pra passar `integral`**

No select que carrega os adiantamentos, incluir `integral`; no map que monta `AdiantamentoRow[]`, propagar.

- [ ] **Step 3: Reescrever `derivarStatusAdiantamento`**

Variantes passam a ser: `pago`, `pago_integral`, `aguardando_nf`, `aguardando_aprovacao`, `aprovado`, `pago_fluxo` (substitui o antigo `pago` do fluxo novo pra não colidir — ou mantém `pago` e distingue por outro campo; preferir `pago` único, já que o output visual é o mesmo).

Regra:

```ts
function derivarStatusAdiantamento(
  folha_status: string | null,
  tem_nf: boolean,
  tipo_contratacao: string,
  integral: boolean,
): { label: string; variant: "pago" | "pago_integral" | "aguardando_nf" | "aguardando_aprovacao" | "aprovado" } {
  if (!folha_status) {
    return integral
      ? { label: "Pago — integral", variant: "pago_integral" }
      : { label: "Pago", variant: "pago" };
  }
  if (folha_status === "paga") return { label: "Pago", variant: "pago" };
  if (folha_status === "aprovada") return { label: "Aprovado — a pagar", variant: "aprovado" };
  if (!tem_nf && ["pj", "mei", "clt_recibo"].includes(tipo_contratacao)) {
    return { label: "Aguardando NF", variant: "aguardando_nf" };
  }
  return { label: "Aguardando aprovação", variant: "aguardando_aprovacao" };
}
```

`variantClasses` atualiza: `pago` cinza claro (`bg-zinc-100 text-zinc-500`), `pago_integral` cinza+borda (`bg-zinc-100 text-zinc-600 ring-1 ring-zinc-300`) pra distinguir sem poluir.

- [ ] **Step 4: Remover coluna "Lançado"**

Remover o `<th>` de "Lançado" (linha ~159) e o `<td>` correspondente (linhas 193-203). Removedor do `colSpan` ou `w-*` não precisa — tabela é `w-full border-collapse` sem colgroup aqui.

- [ ] **Step 5: Atualizar chamada de `derivarStatusAdiantamento`**

Na linha ~166: `derivarStatusAdiantamento(a.folha_status, a.tem_nf, a.colaborador_tipo, a.integral)`.

- [ ] **Step 6: `pnpm tsc --noEmit && pnpm lint && pnpm build`**

Esperado: limpos.

- [ ] **Step 7: Verificação visual**

Abrir `/rh/decimo-terceiro/2026/adiantamentos` em dev — a coluna "Lançado" sumiu, 12 linhas aparecem como "Pago" (cinza), 4 (após Task 6) aparecerão como "Pago — integral". Antes da Task 6, as 16 ficam como "Pago" só.

- [ ] **Step 8: Commitar**

```bash
git add app/(app)/rh/decimo-terceiro/[ano]/adiantamentos/lista-adiantamentos.tsx app/(app)/rh/decimo-terceiro/[ano]/adiantamentos/page.tsx
git commit -m "feat(13o): lista de adiantamentos ganha status unificado, remove coluna 'Lançado'"
```

---

### Task 6: Backfill dos legados de 2026

**Files:**
- Create: `supabase/migrations/20261117500002_backfill_adiantamentos_13_integrais_e_correcoes.sql`

**Interfaces:**
- Consumes: coluna `integral` (Task 1), lógica de recalc (Task 2).

**IMPORTANTE:** esta migration tem 3 blocos destrutivos (correção de valor do adiantamento de R$ 14 + correção +R$ 0,01 em outro adiantamento + delete de linhas de 13º). Confirmar com o Antonio antes de aplicar. WHERE restritivo em todos.

- [ ] **Step 1: Escrever a migration**

Conteúdo (racional no topo descrevendo as 5 ações: 4 colaboradores vão pra integral, um adiantamento tem valor corrigido de 14 pra 14000, outro ganha +0,01, linhas de 13º dos 4 integrais são deletadas, linha de 13º do ajustado +0,01 é recalculada):

```sql
-- Motivo: consolidar os 16 adiantamentos legados de 2026 na nova semântica
-- de "integral vs parcial" + 2 correções pontuais de valor.
--
-- Decisões (sessão 2026-11-17):
-- - 4 adiantamentos são "integrais" (identificados por data + valor + obs):
--   o colaborador recebeu o 13º inteiro de uma vez e NÃO participa da
--   folha de 13º/2026. Marcar integral=true e deletar as respectivas
--   linhas em decimo_terceiro_linhas.
-- - Um adiantamento de 24/07 tinha valor R$ 14,00 (erro de digitação) —
--   corrige pra R$ 14.000,00 (salário integral, PJ, 12 avos).
-- - Outro adiantamento (08/09, R$ 2.520,83) deixava a 1ª parcela do 13º
--   com R$ 0,01 por arredondamento. Soma +R$ 0,01 (2520.83 → 2520.84)
--   pra zerar a 1ª parcela.
-- - Os outros 12 adiantamentos ficam como estão (parciais, integral=false
--   default).
--
-- WHERE combina id + valor atual + ano + obs atual pra ser idempotente:
-- se rodar duas vezes, os UPDATEs encontram 0 linhas no 2º run.

-- 1) Correção do valor do adiantamento (14 → 14000).
update public.decimo_terceiro_adiantamentos
set valor = 14000.00
where tenant_id = '<TENANT_CALIFORNIA_UUID>'
  and ano = 2026
  and valor = 14.00
  and obs ilike '%Não recebe 13 salario%'
  and data = '2026-07-24';

-- 2) Correção do valor do adiantamento (2520.83 → 2520.84).
update public.decimo_terceiro_adiantamentos
set valor = 2520.84
where tenant_id = '<TENANT_CALIFORNIA_UUID>'
  and ano = 2026
  and valor = 2520.83
  and data = '2026-09-08';

-- 3) Marca os 4 integrais (por data + valor + obs, não por nome/CPF).
update public.decimo_terceiro_adiantamentos
set integral = true
where tenant_id = '<TENANT_CALIFORNIA_UUID>'
  and ano = 2026
  and integral = false
  and (
    (data = '2026-09-30' and valor = 7000.00 and obs ilike '%Valor integral%')
    or (data = '2026-08-10' and valor = 7000.00 and obs ilike '%Valor integral%')
    or (data = '2026-07-24' and valor = 14000.00 and obs ilike '%Não recebe 13 salario%')
    or (data = '2026-02-05' and valor = 15000.00 and obs ilike '%Valor integral%')
  );

-- 4) Deleta linhas de 13º/2026 dos 4 integrais (se existirem).
delete from public.decimo_terceiro_linhas l
using public.decimo_terceiro_folhas f,
     public.decimo_terceiro_adiantamentos a
where l.folha_id = f.id
  and f.ano = 2026
  and f.tenant_id = '<TENANT_CALIFORNIA_UUID>'
  and a.tenant_id = f.tenant_id
  and a.ano = f.ano
  and a.colaborador_id = l.colaborador_id
  and a.integral = true;

-- 5) Recalcula a linha de 13º do adiantamento ajustado em +0.01
--    (1ª parcela deveria virar 0). Faz via UPDATE direto porque o recalc
--    completo mora na action TS; o impacto aqui é só na 1ª parcela e
--    total_adiantado (a função pura cuida do resto na próxima vez
--    que tocar a linha).
update public.decimo_terceiro_linhas l
set total_adiantado = 2520.84,
    primeira_parcela = 0.00
where l.tenant_id = '<TENANT_CALIFORNIA_UUID>'
  and exists (
    select 1 from public.decimo_terceiro_folhas f
    where f.id = l.folha_id and f.ano = 2026
  )
  and l.colaborador_id = (
    select colaborador_id from public.decimo_terceiro_adiantamentos
    where tenant_id = '<TENANT_CALIFORNIA_UUID>'
      and ano = 2026
      and valor = 2520.84
      and data = '2026-09-08'
    limit 1
  );
```

Substituir `<TENANT_CALIFORNIA_UUID>` pelo UUID real do tenant da Agência California (consultar via MCP: `select id from tenants where slug = 'ag-california'` ou similar).

- [ ] **Step 2: Apresentar pro Antonio pra confirmação (mudança destrutiva)**

Mostrar diff + linhas que serão atualizadas via `select` prévio por `mcp__supabase__execute_sql` — ver quais rows batem os WHEREs antes de aplicar.

- [ ] **Step 3: Aplicar via MCP**

`mcp__supabase-write__apply_migration` com nome `backfill_adiantamentos_13_integrais_e_correcoes`.

- [ ] **Step 4: Conferir o resultado**

Via `mcp__supabase__execute_sql`:
- `select colaborador_id, valor, obs, integral from decimo_terceiro_adiantamentos where ano = 2026 and integral = true;` → 4 linhas.
- `select valor from decimo_terceiro_adiantamentos where ano = 2026 and data = '2026-07-24';` → 14000.00.
- `select valor from decimo_terceiro_adiantamentos where ano = 2026 and data = '2026-09-08' and valor > 2520;` → 2520.84.
- `select count(*) from decimo_terceiro_linhas l join decimo_terceiro_folhas f on l.folha_id = f.id join decimo_terceiro_adiantamentos a on a.colaborador_id = l.colaborador_id and a.ano = f.ano where a.integral = true and f.ano = 2026;` → 0 (linhas dos integrais foram deletadas).
- `select primeira_parcela, total_adiantado from decimo_terceiro_linhas l join decimo_terceiro_folhas f on l.folha_id = f.id where f.ano = 2026 and l.colaborador_id = (select colaborador_id from decimo_terceiro_adiantamentos where ano=2026 and data='2026-09-08' and valor=2520.84);` → `0.00 | 2520.84`.

- [ ] **Step 5: Verificação visual na UI**

- `/rh/decimo-terceiro/2026/adiantamentos` → 4 linhas com badge "Pago — integral", adiantamento corrigido mostrando R$ 14.000,00, ajustado em +0,01 mostrando R$ 2.520,84.
- `/rh/decimo-terceiro/2026` → folha não lista mais os 4 integrais; colaborador do ajuste +0,01 tem 1ª parcela R$ 0,00.

- [ ] **Step 6: Commitar**

```bash
git add supabase/migrations/20261117500002_backfill_adiantamentos_13_integrais_e_correcoes.sql
git commit -m "fix(13o): consolida 16 adiantamentos legados 2026 — 4 integrais + 2 correcoes de valor"
```

---

## Ordem de execução

Rigorosamente sequencial. Cada task depende da anterior:

1. Task 1 (schema) — base pro resto.
2. Task 2 (cálculo) — regra de exclusão da folha.
3. Task 3 (helper) — usado pela UI.
4. Task 4 (UI novo adiantamento) — depende do helper.
5. Task 5 (UI lista) — independente de 3-4, mas depende da coluna integral (Task 1) e benefício visual plena após Task 6.
6. Task 6 (backfill) — por último, pra que os efeitos (exclusão de linhas) sejam aplicados pelo código já pronto.

Após Task 6, rodar manualmente: `/rh/decimo-terceiro/2026` e `/rh/decimo-terceiro/2026/adiantamentos` pra confirmar visualmente o estado final.
