# Performance — guia canônico do California ERP

**Performance é feature.** Regressões custam confiança do usuário mais do que qualquer nova funcionalidade agrega. Este documento é a fonte-verdade sobre o que degrada o sistema, como detectar e como corrigir. Toda mudança de UI ou backend deve considerar esses pontos antes de merge.

> **Se você é uma AI trabalhando neste repo**: leia esse documento antes de tocar em qualquer arquivo em `app/(app)/` ou `lib/supabase/`. Use o [checklist](#checklist-antes-de-merge) como filtro final.

---

## Targets aceitáveis

| Métrica | Bom | Ruim | Fatal |
|---|---|---|---|
| TTFB de navegação warm | < 300ms | 500-900ms | > 1s |
| TTFB de navegação cold (Vercel) | < 1s | 1-2s | > 2.5s |
| Content Download de RSC | < 300ms | 500-1500ms | > 2s |
| Query única no Postgres | < 50ms | 100-300ms | > 500ms |
| Cliente vê feedback (skeleton) | < 100ms | 300ms | não vê |

**Regra prática**: se qualquer request de RSC passa de 3s de forma consistente, PARE tudo — é bug estrutural, não "otimização depois".

---

## Catálogo de causas conhecidas

### A) Prefetch descontrolado (Next 14 App Router) ⚠️ ALTO RISCO

**Sintoma:** você abre uma página com várias listas ou `<Link>` visíveis e o Network mostra dezenas de requests RSC em background. Uma delas fica pendurada 10-30s.

**Causa:** o `<Link>` do Next faz prefetch automático **quando entra em viewport**. Em pages `force-dynamic`, o prefetch é "parcial" mas ainda dispara request no server; em pages sem `force-dynamic`, prefetch tenta materializar o RSC completo (queries incluídas). Uma lista com 5-10 links pode disparar 5-10 requests concorrentes que saturam o pool de serverless functions do Vercel.

**Detecção:** Chrome DevTools → Network → filtra por `_rsc` no nome. Se há requests que você não iniciou clicando, é prefetch.

**Fix padrão:**
- **`prefetch={false}`** no `<Link>` de listas grandes (5+ itens navegáveis).
- Cursor + `onClick` + `router.push` continuam funcionando para linha inteira clicável (regra UX universal).

**Casos históricos deste projeto:**
- Passo 4 do plano de perf (`6ba417e`) removeu `force-dynamic` — prefetch RSC full começou a saturar. Revertido em `f3ac25c`.
- Lista de versões (jul/2026) tinha `<Link>` em cada versão sem `prefetch={false}` — 33s de content download. Corrigido em `7b994f1`.

### B) Server round-trips em série ⚠️ ALTO IMPACTO

**Sintoma:** TTFB alto (500-1500ms) mesmo em query simples.

**Causa:** `requireSession()` → `loadSession()` fazia 3 queries encadeadas (`getUser` + `select profiles` + `select tenant_members`). Middleware chamava `getUser()` de novo. Total: 4 round-trips ao Supabase por navegação.

**Fix:**
- **RPC consolidada** — `public.get_session_context()` retorna profile + memberships + tenants em 1 shot. Já implementada em `20260727000001_perf_session_context_rpc.sql`.
- **Cache de sessão via `React.cache()`** — `loadSession` já é `cache()`d dentro de um request.

**Nunca:**
- Fazer `await getUser(); await from("profiles").select(); await from("tenant_members").select()` em série. Se precisar dos 3, faça `Promise.all` ou (preferido) crie uma RPC.

### C) N+1 queries / embed pesado

**Sintoma:** payload de resposta grande, Content Download alto, mesmo com poucas rows visíveis.

**Causa:** `.select("...embed:tabela(*)")` puxa arrays aninhados enormes. Ex.: lista de 4 versões com embed de itens gera JSON com 4 arrays de 40 itens = 160 objetos aninhados, mesmo que a UI só use `.length` e `.sum`.

**Detecção:** Response tab do Network → tamanho > 20KB pra listagem simples.

**Fix:**
- **Query separada agregada no client** — puxe só `versao_orcamento_id, total_orcado` num `.in([...])` e agregue com `Map`. Payload mínimo, mesma info.
- **RPC com sum agregado** — se for muito grande, use SQL: `SELECT versao_id, count(*), sum(total_orcado) FROM ... GROUP BY versao_id`.

**Nunca:**
- Usar embed só pra `.length` ou `.sum`. Puxe agregado.

### D) Cold start Vercel

**Sintoma:** TTFB varia — algumas requests 300ms, outras 1500ms sem padrão. Primeira request após inatividade sempre lenta.

**Causa:** Vercel Free/Hobby congela functions após uso. Cold start reativa a instância + carrega deps pesadas (ex.: ExcelJS ~500KB).

**Fixes possíveis:**
- Manter o código enxuto (menos deps = cold start mais rápido).
- **Edge runtime** onde possível (middleware, rotas leves). Cold start ~5x mais rápido.
- **Keep-warm cron** (`/api/health` acionado a cada 5min) — só se cold start virar problema recorrente.

**Detecção:** timing granular no server (console.log) — se `session` varia entre 100-1500ms sem lógica, é cold start.

### E) Payload de RSC gigante

**Sintoma:** Content Download > 1s pra menos de 10KB.

**Causa:** streaming do RSC serializa componentes lentamente OU o server está enrolando entre chunks (queries em série no meio do render).

**Fix:**
- Fazer todas as queries em paralelo (`Promise.all`) ANTES de qualquer renderização.
- Evitar `await` em series dentro de server components.
- Se tem componente pesado (drawer complexo), lazy-load com `dynamic()`.

### F) Sem `loading.tsx`

**Sintoma:** clique → nada acontece por 1-2s → página aparece.

**Causa:** Next segura URL antiga renderizada até nova terminar de gerar.

**Fix:** `app/(group)/loading.tsx` com skeleton (já temos em `app/(app)/loading.tsx`). Não resolve latência real, mas faz percepção parecer instantânea (~100ms).

### G) `force-dynamic` desnecessário

**Sintoma:** perde-se otimizações do Next (Partial Prerendering em Next 14+, cache RSC).

**Causa:** `export const dynamic = "force-dynamic"` explicitamente desabilita cache. Já ocorre implicitamente quando você usa `cookies()`/`headers()`.

**Fix:**
- Manter só quando necessário. Se removê-lo desatende alguma feature, é a página que precisa refatorar (usar `cookies()` sinaliza dynamic implicitamente e é mais correto).
- **Exceção**: se o Next tá fazendo prefetch RSC completo indesejado, `force-dynamic` funciona como "freio" — nesse caso, prefira `prefetch={false}` nos Links específicos e mantenha `force-dynamic` só onde de fato preciso.

**Caso histórico:** Passo 4 do plano de perf removeu `force-dynamic` de todas as pages — Next começou prefetch RSC full, sistema travou. Aprendemos: `force-dynamic` é uma defesa útil mesmo quando "redundante".

### H) RLS mal indexado / policy re-avaliando `auth.uid()` por linha

**Sintoma:** Supabase advisor acusa `auth_rls_initplan`. Query com muitos rows fica mais lenta que o esperado.

**Causa:** policies como `using (user_id = auth.uid())` re-executam `auth.uid()` por linha. Correto: `using (user_id = (select auth.uid()))`.

**Fix:** trocar `auth.uid()` por `(select auth.uid())` nas policies. Migration corretiva quando surgir.

**Detecção:** `mcp__supabase-write__get_advisors` type=performance.

### I) Server actions com N inserts em série

**Sintoma:** action lenta ao gravar múltiplos registros.

**Causa:** loop com `await supabase.from(...).insert(...)` em cada iteração = N round-trips.

**Fix:** `supabase.from(...).insert([...])` em bulk. Já usamos no `confirmarImportacao` (grupos, categorias, itens).

### J) Middleware fazendo trabalho pesado em toda request

**Sintoma:** TTFB base alto mesmo em rotas triviais.

**Causa:** middleware roda em cada request (matcher default). Se chamar Supabase/db, cada request paga.

**Fix atual:** middleware só chama `supabase.auth.getUser()` para renovar cookie — obrigatório pro Supabase SSR funcionar. Não adicionar mais nada aqui.

### K) `useEffect` client component lento na hydration

**Sintoma:** LCP alto no browser, drawer/modal demora pra abrir.

**Causa:** componente client pesado ou depende de fetch client-side sequential.

**Fix:** mais lógica em server component, `dynamic()` para componentes pesados, evitar cascatas de useEffect.

---

## Checklist antes de merge

Copie e cole isso em cada PR que toca em UI ou backend:

**UI:**
- [ ] Adicionei `<Link>` em lista? Se sim, considerei `prefetch={false}`? Se a lista tem 5+ itens navegáveis, é default.
- [ ] Row/card inteiro é clicável (regra UX) e ações inline usam `stopPropagation`?
- [ ] Tem `loading.tsx` cobrindo a rota (herda do `app/(app)/loading.tsx` a menos que precise específico)?
- [ ] Componentes pesados (Excel, calendários, editores) usam `dynamic()`?

**Backend / Server components:**
- [ ] Todas as queries independentes estão em `Promise.all`, não em série?
- [ ] Se puxa dados só pra contar/somar, uso query agregada (não embed)?
- [ ] Server action começa com `requireSession()` (para audit + cache dedupe) e faz `revalidatePath` no fim?
- [ ] Se cria RPC nova, foi checada com `get_advisors`?

**Migrations:**
- [ ] Toda tabela nova tem `GRANT select, insert, update, delete ... TO authenticated` (RLS ≠ GRANT).
- [ ] FKs importantes têm índice (`create index on tabela(fk_col)`).
- [ ] Policies RLS usam `(select auth.uid())`, não `auth.uid()` direto.

**Antes de commitar mudança de rota:**
- [ ] Rodei o smoke test manual: `/orcamentos` → `/orcamentos/[id]` → versão → voltar. Tempo aceitável em cada passo?

---

## Ferramentas de diagnóstico

1. **Chrome DevTools → Network** — filtre por `_rsc` (RSC prefetches) e `.js` (chunks). TTFB e Content Download são as duas métricas principais.
2. **Vercel → Functions → Runtime Logs** — `console.log("[timing]", ...)` no server aparece aqui. Padrão: `[<domínio>.<contexto>.timing] {json}`.
3. **`mcp__supabase-write__get_advisors`** — checa security + performance no schema. Rodar após qualquer migration.
4. **`mcp__supabase-write__execute_sql`** — simular sessão de usuário (`set local role authenticated; set local "request.jwt.claim.sub" = '<uuid>'`) para reproduzir queries com RLS.

---

## Histórico de regressões (case studies)

Case studies documentam decisões erradas. Sempre atualizar aqui quando algo travar.

### 1. Passo 4 de perf (jul/2026) — removi `force-dynamic` sem entender o efeito no prefetch

**Sintoma:** navegação levou 4-8s após deploy.

**Diagnóstico:** sem `force-dynamic`, Next fazia prefetch RSC completo (com queries) de todas as rotas visíveis. Vercel Free pool saturou.

**Fix:** revert `6ba417e` → `f3ac25c`.

**Aprendizado:** `force-dynamic` não é só sobre cache — funciona como freio de prefetch descontrolado. Só remover com `prefetch={false}` nos Links pra compensar.

### 2. Lista de versões (jul/2026) — Links de versão + embed pesado

**Sintoma:** RSC de 33.62s pra 2.9KB. Content Download absurdo.

**Diagnóstico:**
- Cada `<Link>` do card de versão fazia prefetch em viewport.
- Página do orçamento fazia embed puxando todos os itens de todas as versões pra somar total.
- Combinação: N prefetches concurrent × query pesada por prefetch.

**Fix (`7b994f1`):**
- `prefetch={false}` nos 2 `<Link>` do card de versão.
- Query separada agregada no client (só `versao_orcamento_id, total_orcado`).
- Timing granular pra medir.

**Aprendizado:** listas navegáveis com queries pesadas por trás precisam **sempre** de `prefetch={false}`.

### 3. Convite quebrado com service_role sem GRANT (jul/2026)

**Sintoma:** `permission denied for table profiles`.

**Diagnóstico:** service_role bypassa RLS mas **não** GRANT.

**Fix:** migration `20260725000001_grants_service_role.sql` com `ALTER DEFAULT PRIVILEGES`.

**Aprendizado:** RLS ≠ GRANT. Regra já registrada.

---

## Anti-padrões proibidos

- ❌ `await getUser(); await from("...").select();` sequencial. Use RPC ou `Promise.all`.
- ❌ `.select("...embed:tabela(*)")` só pra contar/somar. Faça query agregada.
- ❌ `<Link>` em lista de 5+ itens sem `prefetch={false}`.
- ❌ `useEffect` que dispara fetch no mount de client component sem loading state.
- ❌ `for (const x of items) { await supabase.from(...).insert(x); }`. Bulk sempre.
- ❌ `console.log` de debug esquecido em produção.
- ❌ `export const dynamic = "force-dynamic"` removido sem plano de compensação de prefetch.
- ❌ `if (!process.env.X)` checando env var crítica *no meio do código* sem guard-rail explícito.

---

## Padrões aprovados (recipes)

### Query agregada leve
```typescript
// Ao invés de embed pesado:
// .select("versoes.*, itens:versoes_itens(*)")

// Faça:
const { data: versoes } = await supabase.from("versoes").select("id, ...");
const { data: itens } = await supabase
  .from("versoes_itens")
  .select("versao_id, total")  // só o mínimo
  .in("versao_id", versoes.map(v => v.id));

const agg = new Map<string, number>();
for (const it of itens ?? []) {
  agg.set(it.versao_id, (agg.get(it.versao_id) ?? 0) + Number(it.total));
}
```

### Timing granular (temporário)
```typescript
const t0 = Date.now();
const session = await requireSession();
const tSess = Date.now();
// ... queries ...
console.log("[page.timing]", JSON.stringify({
  session: tSess - t0,
  total: Date.now() - t0,
}));
```

### Link em lista clicável
```tsx
<TableRow
  onClick={() => router.push(href)}
  role="link"
  tabIndex={0}
  className="cursor-pointer hover:bg-muted/50"
>
  <TableCell>
    <Link
      href={href}
      prefetch={false}                       // ← default em listas
      onClick={(e) => e.stopPropagation()}   // ← Ctrl+click funciona
    >
      {nome}
    </Link>
  </TableCell>
  {/* ... */}
</TableRow>
```
