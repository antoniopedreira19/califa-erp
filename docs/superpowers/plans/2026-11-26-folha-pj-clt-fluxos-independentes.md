# Folha PJ+CLT em fluxos independentes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o bloco único `ChecklistCompetencia` em `/rh/folhas/[competencia]` por dois cards independentes (PJ e CLT), cada um com seu botão "Enviar ao financeiro". Embutir a aplicação de benefícios + geração de avulsas de operadora como passos invisíveis do "Enviar PJ". CLT perde o checkpoint de benefícios (não tem desconto no sistema).

**Architecture:** Zero mudança de schema. As RPCs de benefícios (`aplicar_fechamento_beneficios`, `gerar_avulsas_fechamento_beneficios`) já são idempotentes e cobrem o fluxo novo — mudança é só em quem/quando chama. Uma migration aditiva reforça o RPC `desaplicar_fechamento_beneficios` com trava para não reverter desconto de linha PJ já enviada. UI troca `ChecklistCompetencia` por `CardFolhaPJ` + `CardFolhaCLT` em `grid grid-cols-1 md:grid-cols-2`. As novas server actions `enviarFolhaPJ` e `enviarFolhaCLT` ficam em `app/(app)/rh/folhas/envio-actions.ts`.

**Tech Stack:** Next.js App Router (server components + server actions), React + TypeScript, Supabase (Postgres RPC + RLS), Tailwind, shadcn/ui Dialog, lucide-react.

**Spec:** [docs/superpowers/specs/2026-11-26-folha-pj-clt-fluxos-independentes-design.md](docs/superpowers/specs/2026-11-26-folha-pj-clt-fluxos-independentes-design.md)

## Global Constraints

- Banco pelo ciclo do MCP (ver `docs/FLUXO-BANCO.md`): ler → migration → aplicar → conferir → commit no mesmo passo.
- Única migration da feature é **aditiva** (CREATE OR REPLACE de RPC existente). Zero mudança destrutiva. Nenhuma coluna ou tabela nova.
- `lib/types.ts` escrito à mão — se adicionar tipo novo, mesmo commit da mudança que consome.
- Strings visíveis ao usuário em **pt-BR com acento/cedilha/til** (CLAUDE.md "Ortografia em português"). Identificadores de código podem seguir convenção sem acento.
- Nenhum dado pessoal real em código/fixture/migration (CLAUDE.md "Dados pessoais nunca entram no repo").
- `<Link>` em lista > 5 itens → `prefetch={false}` (CLAUDE.md "Performance é feature").
- shadcn/ui `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` já em uso. Botão primário usa `bg-california-red`, `rounded-lg`, `shadow-sm` (padrão do projeto).
- Audit event agregado **mantém** nome `folha_competencia.enviada` (já existe em `importar-actions.ts`); ganha `origem` no metadata.
- RLS: as RPCs já são SECURITY DEFINER com check interno `is_tenant_admin OR is_tenant_rh`. Server actions revalidam permissão via `requireSession` + `checarPermissao("rh.folhas.editar_rh")`.
- Não criar branch: trabalhar direto em `main`.
- Não pushar após commit: só commits locais (memória `feedback_push`).
- Rodar `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` antes de encerrar qualquer task que toca código TypeScript.

## Review Focus

Entradas e falhas que o design implica mas que nenhum teste automatizado exercita:

1. **Catálogo de benefícios incompleto** (`beneficios.ativo=true` com `fornecedor_id`/`empresa_id`/`dia_vencimento_fatura`/`regional_id` em branco): usuário descobre no card PJ via alerta visível, não só no erro do modal. Coberto na Task 2 (shape devolve `catalogoIncompleto`) e Task 6 (card renderiza alerta + desabilita Enviar).
2. **Tenant sem benefícios cadastrados** (`nenhum_vinculo_ativo`): `enviarFolhaPJ` trata como caso OK, segue sem gerar avulsa. Coberto na Task 3 (server action) + verificação manual na Task 7.
3. **Desaplicar benefícios depois que PJ saiu de rascunho** (linha PJ em `enviada`/`aprovada`/`paga`/`pendente_correcao`): RPC bloqueia com `folha_pj_ja_enviada`. Coberto na Task 1 (migration + verificação SQL) + Task 8 (UI do botão desaplicar traduz a mensagem).
4. **CLT enviada antes de PJ** (sequência invertida, rara): CLT vai sozinha pro financeiro; `enviarFolhaCLT` não dispara snapshot; quando PJ for enviada, snapshot fecha + avulsas aparecem. Coberto na Task 3 (lógica da action) + verificação manual na Task 7.
5. **Linhas `pendente_correcao` no envio agregado:** o botão "Enviar PJ"/"Enviar CLT" promove tanto `rascunho` quanto `pendente_correcao`, limpando `motivo_pendencia`. Coberto na Task 3 (filtro do UPDATE) + verificação manual na Task 7.

---

## File Structure

**Novos:**
- `supabase/migrations/20261126HHMMSS_desaplicar_beneficios_trava_folha_enviada.sql` — CREATE OR REPLACE do RPC `desaplicar_fechamento_beneficios` com nova precondição.
- `lib/queries/folhas-resumo.ts` — `obterResumoCardsFolha(tenantId, ano, mes)` devolvendo shape dos dois cards + pré-validação de catálogo.
- `app/(app)/rh/folhas/envio-actions.ts` — server actions `enviarFolhaPJ` e `enviarFolhaCLT`.
- `app/(app)/rh/folhas/_components/modal-enviar-folha-pj.tsx` — confirmação com preview de benefícios.
- `app/(app)/rh/folhas/_components/modal-enviar-folha-clt.tsx` — confirmação simples.
- `app/(app)/rh/folhas/_components/card-folha-clt.tsx` — card CLT (importar/reimportar + enviar).
- `app/(app)/rh/folhas/_components/card-folha-pj.tsx` — card PJ (gerar/atualizar + enviar + link desaplicar + alerta catálogo).

**Modificados:**
- `app/(app)/rh/folhas/[competencia]/page.tsx` — substitui `<ChecklistCompetencia>` por grid com `<CardFolhaPJ>` + `<CardFolhaCLT>`; chama `obterResumoCardsFolha`; adiciona rodapé consolidado condicionado.
- `app/(app)/rh/folhas/importar-actions.ts` — remove `enviarCompetencia` e `resumoEnvioCompetencia` (função + export de tipo `ResumoEnvioCompetencia`).
- `app/(app)/rh/folhas/_components/botao-desaplicar-beneficios.tsx` — trata erro novo `folha_pj_ja_enviada` com mensagem amigável.
- `lib/types.ts` — adiciona tipos do shape de `obterResumoCardsFolha` e dos retornos das novas actions.

**Removidos (após substituição funcionando):**
- `app/(app)/rh/folhas/_components/checklist-competencia.tsx`
- `app/(app)/rh/folhas/_components/botao-aplicar-beneficios.tsx`
- `app/(app)/rh/folhas/_components/modal-enviar-financeiro.tsx`

---

## Task 1: Migration — trava desaplicar após PJ enviada

**Files:**
- Create: `supabase/migrations/20261126HHMMSS_desaplicar_beneficios_trava_folha_enviada.sql`

**Interfaces:**
- Consumes: função atual `desaplicar_fechamento_beneficios(uuid)` em `supabase/migrations/20261014000004_beneficios_fase3_fluxo_portao_unico.sql`.
- Produces: função atualizada com nova precondição que levanta `folha_pj_ja_enviada` se existe linha PJ em estado diferente de `rascunho`.

- [ ] **Step 1: Ler o RPC atual via MCP**

Rodar `mcp__supabase__execute_sql` com:
```sql
select pg_get_functiondef('public.desaplicar_fechamento_beneficios(uuid)'::regprocedure);
```
Confirmar o corpo é o da migration `20261014000004`, para o CREATE OR REPLACE ser cirúrgico.

- [ ] **Step 2: Escrever a migration**

Prefixo numérico baseado em timestamp (usar o padrão `YYYYMMDDHHMMSS`). Cabeçalho comentado com racional:

```sql
-- Migration: Trava desaplicar_fechamento_beneficios quando PJ já saiu de rascunho.
-- Spec: docs/superpowers/specs/2026-11-26-folha-pj-clt-fluxos-independentes-design.md
-- Racional: no fluxo novo (PJ e CLT envio independentes), o salario_base de linha PJ
-- é descontado automaticamente no "Enviar PJ". Permitir desaplicar depois que a linha
-- saiu de rascunho reverteria o salario_base de linhas já analisadas pelo financeiro,
-- quebrando a aprovação. Bloqueia todos os estados != rascunho (incluindo pendente_correcao).
-- 100% aditiva. CREATE OR REPLACE só da função.

begin;
create or replace function public.desaplicar_fechamento_beneficios(p_fechamento_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f public.beneficio_fechamento_mensal%rowtype;
  v_avulsa_paga record;
begin
  select * into v_f from public.beneficio_fechamento_mensal where id = p_fechamento_id;
  if not found then raise exception 'fechamento_nao_encontrado'; end if;
  if not (public.is_tenant_admin(v_f.tenant_id) or public.is_tenant_rh(v_f.tenant_id)) then
    raise exception 'permissao_negada';
  end if;
  if v_f.reaberto_em is not null then raise exception 'ja_reaberto'; end if;

  -- NOVA trava: linha PJ já saiu de rascunho (enviada/aprovada/paga/pendente_correcao)
  if exists (
    select 1 from public.folhas_pagamento
     where competencia_ano = v_f.ano
       and competencia_mes = v_f.mes
       and origem = 'california'
       and status <> 'rascunho'
  ) then
    raise exception 'folha_pj_ja_enviada';
  end if;

  -- Trava existente: avulsa deste fechamento já foi paga
  select coalesce(codigo, id::text) as ref
    into v_avulsa_paga
    from public.contas_avulsas
    where beneficio_fechamento_id = p_fechamento_id
      and pago_em is not null
    limit 1;
  if found then raise exception 'avulsa_ja_paga: %', v_avulsa_paga.ref; end if;

  -- Reverte salario_base PJ
  update public.folhas_pagamento
     set salario_base = salario_base + desconto_beneficios,
         desconto_beneficios = 0
   where competencia_ano = v_f.ano and competencia_mes = v_f.mes
     and origem = 'california' and desconto_beneficios > 0;

  -- Apaga avulsas geradas (se houver)
  delete from public.contas_avulsas where beneficio_fechamento_id = p_fechamento_id;
  -- Apaga linhas do snapshot
  delete from public.beneficio_fechamento_linha where fechamento_id = p_fechamento_id;
  -- Marca reaberto
  update public.beneficio_fechamento_mensal
     set reaberto_em = now(), reaberto_por = auth.uid()
   where id = p_fechamento_id;
end;
$$;

grant execute on function public.desaplicar_fechamento_beneficios(uuid) to authenticated;
commit;
```

- [ ] **Step 3: Aplicar a migration via MCP**

Rodar `mcp__supabase-write__apply_migration` com `name` igual ao arquivo (sem extensão nem prefixo numérico) e `query` igual ao conteúdo.

- [ ] **Step 4: Verificar via MCP que aplicou**

Rodar `mcp__supabase__execute_sql`:
```sql
select pg_get_functiondef('public.desaplicar_fechamento_beneficios(uuid)'::regprocedure);
```
Esperado: corpo contém `folha_pj_ja_enviada` e `status <> 'rascunho'`.

- [ ] **Step 5: Smoke test da trava**

Verificar comportamento em uma competência de teste no banco (se houver fechamento aplicado). Rodar:
```sql
select id, competencia_ano, competencia_mes, status, origem
  from folhas_pagamento
 where origem = 'california' and status <> 'rascunho'
 order by competencia_ano desc, competencia_mes desc
 limit 5;
```
Se houver linha e existir fechamento vigente da competência:
```sql
select public.desaplicar_fechamento_beneficios('<fechamento_id>');
```
Esperado: `ERROR: folha_pj_ja_enviada`.

Se não houver dado para o teste, documentar o smoke test como "pendente até primeiro ciclo real" e seguir.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261126HHMMSS_desaplicar_beneficios_trava_folha_enviada.sql
git commit -m "feat(rh/folhas): desaplicar beneficios trava se linha PJ ja saiu de rascunho"
```

---

## Task 2: Query helper — `obterResumoCardsFolha`

**Files:**
- Create: `lib/queries/folhas-resumo.ts`
- Modify: `lib/types.ts` (adicionar tipos)

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server`; tabelas `folhas_pagamento`, `beneficio_fechamento_mensal`, `contas_avulsas`, `beneficios`.
- Produces:
  ```ts
  // lib/types.ts
  export interface ResumoFolhaOrigem {
    linhasRascunho: number;
    linhasPendenteCorrecao: number;
    linhasEnviadas: number;
    linhasAprovadas: number;
    linhasPagas: number;
    totalLiquido: number;              // soma de salario_base
    totalDescontoBeneficios: number;   // soma de desconto_beneficios (CLT fica 0)
  }
  export interface ResumoCardsFolha {
    pj: ResumoFolhaOrigem & {
      previewDescontoBeneficios: number | null;  // só se snapshot não aplicado; vem de fn_beneficios_calcular_fechamento
      previewQtdVinculos: number | null;
    };
    clt: ResumoFolhaOrigem;
    beneficios: {
      aplicado: boolean;
      fechamentoId: string | null;
      avulsasGeradas: boolean;
      avulsaPaga: boolean;
      qtdVinculos: number;
      totalEmpresa: number;
      totalColaborador: number;
      totalIntegral: number;
    };
    catalogoIncompleto: string | null;  // nome do primeiro benefício ativo com campo faltando
  }

  // lib/queries/folhas-resumo.ts
  export async function obterResumoCardsFolha(args: {
    tenantId: string; ano: number; mes: number;
  }): Promise<ResumoCardsFolha>;
  ```

- [ ] **Step 1: Adicionar tipos em `lib/types.ts`**

Colar as interfaces `ResumoFolhaOrigem`, `ResumoCardsFolha` ao fim do arquivo, em bloco próprio com comentário `// Folha mensal: resumo dos dois cards (PJ/CLT) — ver docs/superpowers/specs/2026-11-26-folha-pj-clt-fluxos-independentes-design.md`.

- [ ] **Step 2: Implementar `obterResumoCardsFolha`**

Criar `lib/queries/folhas-resumo.ts`. Fluxo:

1. `const supabase = createClient();`
2. Em paralelo (`Promise.all`):
   - Agregação de `folhas_pagamento` por `origem` e `status` filtrando `tenant_id=args.tenantId`, `competencia_ano=args.ano`, `competencia_mes=args.mes`, `tipo='salario'`. Buscar `id`, `salario_base`, `desconto_beneficios`, `status`, `origem`. Reduzir em memória para o shape `ResumoFolhaOrigem` por origem.
   - `beneficio_fechamento_mensal` vigente (`reaberto_em is null`) + join leve com `contas_avulsas` para saber `avulsasGeradas` (any row com `beneficio_fechamento_id = X`) e `avulsaPaga` (any com `pago_em is not null`). Reutilizar `obterFechamentoVigenteDaCompetencia` e `temAvulsaPaga` de `lib/queries/beneficios.ts` se simplificar.
   - Preview (`fn_beneficios_calcular_fechamento`) **só se snapshot não aplicado**. Retorna a soma de `valor_colaborador` (`previewDescontoBeneficios`) e `count(*)` (`previewQtdVinculos`). Se o snapshot já foi aplicado, pular (devolver `null`).
   - Check de catálogo incompleto: `select nome from beneficios where tenant_id=X and ativo=true and (fornecedor_id is null or empresa_id is null or dia_vencimento_fatura is null or regional_id is null) limit 1`. Devolver `nome` ou `null`.
3. Montar `ResumoCardsFolha` e retornar.

Cuidar: o `select` agregado grande deve usar `select("id, salario_base, desconto_beneficios, status, origem")` sem embed (performance — CLAUDE.md "Performance é feature").

- [ ] **Step 3: tsc + lint**

```bash
pnpm tsc --noEmit
pnpm lint
```
Esperado: zero erro em `lib/queries/folhas-resumo.ts` e `lib/types.ts`.

- [ ] **Step 4: Smoke test manual com dado real**

Em modo dev, logar o retorno para uma competência com dado existente (ex: `2026-10`):
```ts
// scratch; não comitar
const r = await obterResumoCardsFolha({ tenantId, ano: 2026, mes: 10 });
console.log(JSON.stringify(r, null, 2));
```
Esperado: `pj.linhasEnviadas + pj.linhasRascunho + pj.linhasAprovadas + pj.linhasPagas + pj.linhasPendenteCorrecao` = total de linhas PJ da competência; mesmo para CLT; `beneficios.aplicado` coerente com `beneficio_fechamento_mensal`.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/folhas-resumo.ts lib/types.ts
git commit -m "feat(rh/folhas): helper obterResumoCardsFolha para os dois cards"
```

---

## Task 3: Server actions — `enviarFolhaPJ` e `enviarFolhaCLT`

**Files:**
- Create: `app/(app)/rh/folhas/envio-actions.ts`
- Modify: `lib/types.ts` (tipos de retorno)

**Interfaces:**
- Consumes: `requireSession`, `checarPermissao`, `createClient` (de `@/lib/supabase/server`), `logAuditEvent`, `revalidatePath`, RPCs `aplicar_fechamento_beneficios` e `gerar_avulsas_fechamento_beneficios`.
- Produces:
  ```ts
  export type ActionResult<T> = { ok: true } & T | { ok: false; message: string };

  export interface AvulsaGerada { id: string; operadora: string; valor: number; }

  export async function enviarFolhaPJ(args: { ano: number; mes: number }):
    Promise<ActionResult<{
      linhas_enviadas: number;
      fechamento_id: string | null;   // null se tenant sem benefícios
      avulsas: AvulsaGerada[];
      sem_beneficios: boolean;         // true se nenhum_vinculo_ativo
    }>>;

  export async function enviarFolhaCLT(args: { ano: number; mes: number }):
    Promise<ActionResult<{ linhas_enviadas: number }>>;
  ```

- [ ] **Step 1: Adicionar tipos em `lib/types.ts`**

Colar `AvulsaGerada` e os retornos das actions (ou declarar nos próprios arquivos de action se preferido pelo projeto — checar padrão ao redor: `ActionResult<T>` tipo genérico, se já existir reusar). Se o projeto já tem `ActionResult` definido em outro lugar (verificar `app/(app)/rh/folhas/importar-actions.ts` — o `enviarCompetencia` usa um shape literal), espelhar o mesmo padrão.

- [ ] **Step 2: Implementar `enviarFolhaPJ`**

Criar `app/(app)/rh/folhas/envio-actions.ts` com `"use server";` no topo. Imports: `requireSession`, `checarPermissao`, `createClient`, `logAuditEvent`, `revalidatePath`.

Fluxo da função:
1. `const session = await requireSession(); const gate = await checarPermissao(session, "rh.folhas.editar_rh"); if (!gate.ok) return gate;`
2. `const supabase = createClient(); const tenantId = session.activeTenant.id;`
3. Buscar `beneficio_fechamento_mensal` vigente da competência (`reaberto_em is null`).
4. Se **não existir**: chamar `supabase.rpc("aplicar_fechamento_beneficios", { p_tenant_id, p_ano, p_mes })`. Tratar erros:
   - `nenhum_vinculo_ativo` → setar flag `semBeneficios=true`, `fechamentoId=null`, seguir para o passo 6 (pular passo 5).
   - `catalogo_incompleto: <nome>` → retornar `{ ok: false, message: "Catálogo de benefícios está incompleto: <nome>. Edite em /rh/beneficios → Catálogo antes de enviar." }`.
   - Outros → `return { ok: false, message: "Falha ao aplicar benefícios: ..." }`.
   Se sucesso, pegar `fechamento_id` do retorno.
5. **Se há `fechamentoId`:** chamar `supabase.rpc("gerar_avulsas_fechamento_beneficios", { p_fechamento_id: fechamentoId })`. Retorna `jsonb` com `[{id, operadora, valor}]`. Guardar para `avulsas`.
6. UPDATE em `folhas_pagamento`:
   ```ts
   .update({ status: "enviada", enviada_em: nowIso, enviada_por: session.profile.id, motivo_pendencia: null })
   .eq("tenant_id", tenantId).eq("competencia_ano", ano).eq("competencia_mes", mes)
   .eq("tipo", "salario").eq("origem", "california")
   .in("status", ["rascunho", "pendente_correcao"])
   .select("id");
   ```
   Se `error` → retornar message amigável. Se `count=0` → retornar `{ ok: false, message: "Não há linha PJ para enviar (rascunho ou pendente de correção)." }`.
7. `await logAuditEvent({ acao: "folha_competencia.enviada", tenantId, entidadeTipo: "folha_competencia", entidadeId: ..., metadata: { ano, mes, origem: "california", linhas_enviadas, fechamento_id, avulsas, sem_beneficios } })`.
8. `revalidatePath("/rh/folhas")`, `revalidatePath("/rh/folhas/${yyyy-mm}")`, `revalidatePath("/rh/beneficios")`, `revalidatePath("/financeiro/contas-a-pagar")`.
9. Retornar `{ ok: true, linhas_enviadas, fechamento_id, avulsas, sem_beneficios }`.

- [ ] **Step 3: Implementar `enviarFolhaCLT`**

Mesmo arquivo. Fluxo:
1. `requireSession` + `checarPermissao`.
2. UPDATE em `folhas_pagamento` com `origem='contabilidade'`, `.in("status", ["rascunho", "pendente_correcao"])`, mesmos campos de envio e `motivo_pendencia: null`.
3. Se `count=0` → `{ ok: false, message: "Não há linha CLT para enviar (rascunho ou pendente de correção)." }`.
4. `logAuditEvent("folha_competencia.enviada", ..., metadata: { ano, mes, origem: "contabilidade", linhas_enviadas })`.
5. Revalidate paths (sem `/rh/beneficios`, sem `/financeiro/contas-a-pagar` — CLT não cria avulsa de operadora).
6. Retornar `{ ok: true, linhas_enviadas }`.

- [ ] **Step 4: tsc + lint**

```bash
pnpm tsc --noEmit
pnpm lint
```
Esperado: zero erro.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/rh/folhas/envio-actions.ts lib/types.ts
git commit -m "feat(rh/folhas): actions enviarFolhaPJ e enviarFolhaCLT (envio independente por origem)"
```

---

## Task 4: Modais de confirmação — Enviar PJ e Enviar CLT

**Files:**
- Create: `app/(app)/rh/folhas/_components/modal-enviar-folha-pj.tsx`
- Create: `app/(app)/rh/folhas/_components/modal-enviar-folha-clt.tsx`

**Interfaces:**
- Consumes: `enviarFolhaPJ`/`enviarFolhaCLT` de Task 3; `previsualizarAplicacao` de `@/lib/actions/beneficios/fechamento` (já existente); shadcn `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`; `Loader2`, `Send`, `AlertCircle` do lucide.
- Produces:
  ```ts
  export interface ModalEnviarFolhaProps {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    ano: number;
    mes: number;
    linhasRascunho: number;
    linhasPendenteCorrecao: number;
    beneficiosAplicado: boolean;   // só no modal PJ
    onEnviado?: (linhasEnviadas: number) => void;
  }
  export function ModalEnviarFolhaPJ(props: ModalEnviarFolhaProps): JSX.Element;

  export interface ModalEnviarFolhaCLTProps {
    open; onOpenChange; ano; mes; linhasRascunho; linhasPendenteCorrecao;
    onEnviado?: (linhasEnviadas: number) => void;
  }
  export function ModalEnviarFolhaCLT(props: ModalEnviarFolhaCLTProps): JSX.Element;
  ```

- [ ] **Step 1: Criar `modal-enviar-folha-clt.tsx` (mais simples)**

`"use client";`. UI: `<Dialog>` com `<DialogContent className="max-w-md">`. Título "Enviar folha CLT · {competenciaLabel}". Corpo: "Vai enviar {linhas} linhas CLT para aprovação do financeiro." (soma rascunho + pendente_correcao; se tiver pendente_correcao >0, mostrar linha extra "Inclui N linhas corrigidas que estavam pendentes."). Botões: Cancelar + "Enviar" (primário `bg-california-red`). No clique, `enviarFolhaCLT({ ano, mes })` via `useTransition`. Se `!ok`, mostrar `erro` com `AlertCircle` vermelho. Se `ok`, `onEnviado?.(r.linhas_enviadas)` + `onOpenChange(false)` + `router.refresh()`.

- [ ] **Step 2: Criar `modal-enviar-folha-pj.tsx`**

Mesma base, com duas variações pelo `beneficiosAplicado`:

**Se `!beneficiosAplicado`:** chama `previsualizarAplicacao({ ano, mes })` ao abrir (`useEffect` em `props.open`), armazena preview. Enquanto carrega, `Loader2 + "Calculando descontos..."`. Com preview:
- Bloco 1: "Vai acontecer, numa única transação:" lista:
  - `Descontar {brl(preview.totalColaborador)} das linhas PJ (benefícios)`
  - Para cada `preview.porOperadora`: `Gerar avulsa {op.operadora} {brl(op.valorIntegral)} (vence {formatarData(op.dataVencimento)})`
  - `Enviar {linhas} linhas PJ para aprovação do financeiro`
- Avisos:
  - Se `preview.qtdVinculos === 0` → mostrar "Nenhum vínculo ativo — PJ vai sem desconto de benefícios." (não bloqueia)
  - Se `linhasPendenteCorrecao > 0` → "Inclui N linhas corrigidas que estavam pendentes."

**Se `beneficiosAplicado`:** sem preview, mensagem curta: "Benefícios já aplicados. Vai enviar {linhas} linhas PJ para aprovação do financeiro."

Se `previsualizarAplicacao` retornar `catalogo_incompleto` → mensagem "Catálogo de benefícios incompleto: X. Edite em /rh/beneficios → Catálogo." e **desabilita o botão Enviar** (o card já deveria ter bloqueado, mas blindagem extra).

No clique Enviar: `enviarFolhaPJ({ ano, mes })` via `useTransition`. Tratar `ok=false` mostrando `message`. Tratar `ok=true` igual CLT.

- [ ] **Step 3: tsc + lint + build**

```bash
pnpm tsc --noEmit
pnpm lint
pnpm build
```
Esperado: zero erro.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/rh/folhas/_components/modal-enviar-folha-pj.tsx app/(app)/rh/folhas/_components/modal-enviar-folha-clt.tsx
git commit -m "feat(rh/folhas): modais de confirmacao para envio independente PJ e CLT"
```

---

## Task 5: Componente `CardFolhaCLT`

**Files:**
- Create: `app/(app)/rh/folhas/_components/card-folha-clt.tsx`

**Interfaces:**
- Consumes: `ResumoFolhaOrigem` de Task 2; `ImportarFolhaModal` existente; `ModalEnviarFolhaCLT` de Task 4.
- Produces:
  ```ts
  export interface CardFolhaCLTProps {
    ano: number;
    mes: number;
    clt: ResumoFolhaOrigem;
    podeEditar: boolean;
  }
  export function CardFolhaCLT(props: CardFolhaCLTProps): JSX.Element;
  ```

- [ ] **Step 1: Criar o card**

`"use client";` (para `useState` do modal de envio). Classe do wrapper: `rounded-2xl border border-border bg-card p-5 shadow-soft`.

Três estados visuais:

**Vazio** (`clt.linhasRascunho + enviadas + aprovadas + pagas + pendente = 0`): CTA grande centralizado. Botão "Importar folha CLT" abrindo `ImportarFolhaModal`.

**Com rascunho** (`linhasRascunho + linhasPendenteCorrecao > 0`): topo com título "Folha CLT · {mes/ano}" (eyebrow uppercase), subtítulo "{total linhas} linhas · {brl(totalLiquido)} líquido (já vem descontado da contabilidade)". Breakdown de status (pills coloridos: rascunho cinza, pendente laranja, enviada azul). Rodapé com `[Reimportar arquivo] [Enviar CLT ao financeiro →]` (primário). Habilitar Enviar quando `linhasRascunho + linhasPendenteCorrecao > 0`.

**Totalmente enviada** (`linhasRascunho + linhasPendenteCorrecao = 0` e há outras): topo igual. Status mostra "✓ Enviada ao financeiro" quando aplicável, com badges por estado.

O modal de envio abre via `useState` local.

Strings pt-BR corretas: "Benefícios", "Benefícios já aplicados", "Reimportar", "Enviar CLT ao financeiro".

- [ ] **Step 2: tsc + lint**

```bash
pnpm tsc --noEmit
pnpm lint
```
Esperado: zero erro.

- [ ] **Step 3: Commit**

```bash
git add app/(app)/rh/folhas/_components/card-folha-clt.tsx
git commit -m "feat(rh/folhas): card-folha-clt (importar + enviar independente)"
```

---

## Task 6: Componente `CardFolhaPJ`

**Files:**
- Create: `app/(app)/rh/folhas/_components/card-folha-pj.tsx`

**Interfaces:**
- Consumes: `ResumoCardsFolha["pj"]` + `ResumoCardsFolha["beneficios"]` + `catalogoIncompleto` de Task 2; `BotaoGerarFolhaPj`, `BotaoAtualizarFolhaPj`, `BotaoDesaplicarBeneficios` existentes; `ModalEnviarFolhaPJ` de Task 4.
- Produces:
  ```ts
  export interface CardFolhaPJProps {
    ano: number;
    mes: number;
    pj: ResumoCardsFolha["pj"];
    beneficios: ResumoCardsFolha["beneficios"];
    catalogoIncompleto: string | null;
    podeEditar: boolean;
  }
  export function CardFolhaPJ(props: CardFolhaPJProps): JSX.Element;
  ```

- [ ] **Step 1: Criar o card**

`"use client";`. Wrapper: `rounded-2xl border border-border bg-card p-5 shadow-soft`.

Três estados visuais:

**Vazio**: CTA "Gerar folha PJ" (reusa `BotaoGerarFolhaPj`).

**Com rascunho, snapshot não aplicado**: topo com título "Folha PJ · {mes/ano}". Resumo em duas linhas:
- "{total linhas} linhas · {brl(totalBruto)} bruto" (bruto = totalLiquido + totalDescontoBeneficios, mas como snapshot não aplicado, `totalDescontoBeneficios=0` e `totalLiquido` já é o bruto)
- "Benefícios previstos: −{brl(previewDescontoBeneficios)} (aplicados no Enviar)" — só se `previewDescontoBeneficios > 0`.

Se `previewQtdVinculos === 0` → não mostrar linha de benefícios (tenant sem vínculos). Se `previewDescontoBeneficios === null` (algo deu errado no preview), não mostrar linha, deixa o modal lidar.

**Com rascunho, snapshot aplicado**: resumo em três linhas:
- "{total linhas} linhas · {brl(totalBruto)} bruto − {brl(totalDescontoBeneficios)} benefícios = {brl(totalLiquido)} líquido"
- "✓ Benefícios aplicados · {beneficios.qtdVinculos} vínculos · {brl(beneficios.totalIntegral)}"
- Se `avulsasGeradas` → "{brl(beneficios.totalIntegral)} em 2 avulsas (SulAmérica + Bradesco)"

**Totalmente enviada**: topo igual, breakdown de status + "✓ Enviada ao financeiro" quando `linhasRascunho + linhasPendenteCorrecao = 0`.

**Alerta de catálogo incompleto** (se `catalogoIncompleto` é string): banner laranja/vermelho no topo do card, acima de tudo: "⚠ Catálogo de benefícios incompleto: {catalogoIncompleto}. [Edite em /rh/beneficios → Catálogo](/rh/beneficios?tab=catalogo) antes de enviar." Botão Enviar **desabilitado** nesse caso.

Rodapé de ações: `[Atualizar folha PJ]` (reusa `BotaoAtualizarFolhaPj` quando há linhas) ou `[Gerar folha PJ]` quando vazio; `[Enviar PJ ao financeiro →]` (abre `ModalEnviarFolhaPJ`).

**Link discreto "Desaplicar benefícios"**: no rodapé do card, abaixo dos botões, só quando `beneficios.aplicado && !beneficios.avulsaPaga && pj.linhasEnviadas === 0 && pj.linhasAprovadas === 0 && pj.linhasPagas === 0 && pj.linhasPendenteCorrecao === 0 && podeEditar`. Reusa `BotaoDesaplicarBeneficios` existente (estilizar como link).

- [ ] **Step 2: tsc + lint**

```bash
pnpm tsc --noEmit
pnpm lint
```
Esperado: zero erro.

- [ ] **Step 3: Commit**

```bash
git add app/(app)/rh/folhas/_components/card-folha-pj.tsx
git commit -m "feat(rh/folhas): card-folha-pj (gerar/atualizar + enviar com beneficios embutidos)"
```

---

## Task 7: Integração na página `/rh/folhas/[competencia]` + rodapé consolidado

**Files:**
- Modify: `app/(app)/rh/folhas/[competencia]/page.tsx`

**Interfaces:**
- Consumes: `obterResumoCardsFolha` (Task 2); `CardFolhaPJ` (Task 6); `CardFolhaCLT` (Task 5).
- Produces: página renderiza os dois cards em grid + rodapé condicionado; remove import de `ChecklistCompetencia`.

- [ ] **Step 1: Chamar `obterResumoCardsFolha` em paralelo com a query existente**

Em `page.tsx`, dentro do server component, adicionar `obterResumoCardsFolha({ tenantId, ano, mes })` ao `Promise.all` existente (ou novo). **Não mexer na query inline** que hidrata linhas/alocações/férias/NFs/rateio — ela continua rodando igual.

- [ ] **Step 2: Substituir `<ChecklistCompetencia>` por grid de dois cards**

Trocar o bloco que renderiza `<ChecklistCompetencia ...>` por:
```tsx
<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
  <CardFolhaPJ
    ano={ano} mes={mes}
    pj={resumo.pj}
    beneficios={resumo.beneficios}
    catalogoIncompleto={resumo.catalogoIncompleto}
    podeEditar={podeEditar}
  />
  <CardFolhaCLT
    ano={ano} mes={mes}
    clt={resumo.clt}
    podeEditar={podeEditar}
  />
</div>
```

Remover variáveis locais que só alimentavam `ChecklistCompetencia` (`linhasPj`, `linhasClt`, `rascunhosAEnviar`, `fechamentoVigente`, `avulsaPaga`, `beneficiosProp` — pelo menos as que não sejam usadas pelos outros componentes da página). Checar que `CardsResumoFolha` (card de totais, não é o mesmo) continua intacto.

- [ ] **Step 3: Rodapé consolidado condicionado**

Logo depois do grid, antes de `<CardsResumoFolha>` ou `<FolhaCompetenciaView>`, adicionar:

```tsx
{resumo.pj.linhasRascunho === 0 && resumo.pj.linhasPendenteCorrecao === 0 &&
 resumo.clt.linhasRascunho === 0 && resumo.clt.linhasPendenteCorrecao === 0 &&
 (resumo.pj.linhasEnviadas + resumo.pj.linhasAprovadas + resumo.pj.linhasPagas +
  resumo.clt.linhasEnviadas + resumo.clt.linhasAprovadas + resumo.clt.linhasPagas) > 0 && (
  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm text-emerald-900 flex items-center justify-between">
    <span>✓ Competência enviada · {totalLinhasEnviadas} linhas · {brl(totalEnviado)}</span>
    <Link href="/financeiro/contas-a-pagar" prefetch={false} className="font-medium underline">
      Ver no financeiro →
    </Link>
  </div>
)}
```
(Calcular `totalLinhasEnviadas` e `totalEnviado` a partir do `resumo`.)

- [ ] **Step 4: Remover import de `ChecklistCompetencia`**

Deletar linha `import { ChecklistCompetencia } from "../_components/checklist-competencia";`. Deletar imports agora não usados (`obterFechamentoVigenteDaCompetencia`, `temAvulsaPaga` — se o novo helper substituiu completamente; checar).

- [ ] **Step 5: tsc + lint + build**

```bash
pnpm tsc --noEmit
pnpm lint
pnpm build
```
Esperado: zero erro.

- [ ] **Step 6: Smoke test no browser (seguir regra do CLAUDE.md "testar em UI")**

```bash
pnpm dev
```
Em `http://localhost:3000/rh/folhas/2026-10` (ou competência com dado):
1. Com snapshot não aplicado: card PJ mostra "Benefícios previstos: −R$ X"; CLT mostra apenas líquido.
2. Clicar "Enviar PJ" → modal com preview detalhado → confirmar → ver em `/financeiro/contas-a-pagar` que 2 avulsas apareceram.
3. Voltar e clicar "Enviar CLT" → modal simples → confirmar → só linhas CLT viram enviada.
4. Caso extremo: numa competência limpa, importar CLT primeiro, enviar CLT → nenhuma avulsa aparece em `/financeiro/contas-a-pagar` (OK); depois gerar PJ, enviar PJ → avulsas aparecem.
5. Caso linhas pendente_correcao: reprovar 1 linha pelo financeiro, voltar pra `/rh/folhas/[competencia]`, corrigir no drawer, clicar "Enviar PJ" (ou CLT) agregado → linha corrigida volta pra `enviada`.
6. Rodapé consolidado só aparece quando zero rascunho e zero pendente nos dois lados.

- [ ] **Step 7: Commit**

```bash
git add app/(app)/rh/folhas/[competencia]/page.tsx
git commit -m "feat(rh/folhas): dois cards PJ e CLT na pagina da competencia + rodape consolidado"
```

---

## Task 8: Cleanup — remover action e componentes antigos

**Files:**
- Modify: `app/(app)/rh/folhas/importar-actions.ts` — remove `enviarCompetencia`, `resumoEnvioCompetencia`, tipo `ResumoEnvioCompetencia`.
- Modify: `app/(app)/rh/folhas/_components/botao-desaplicar-beneficios.tsx` — trata erro `folha_pj_ja_enviada`.
- Delete: `app/(app)/rh/folhas/_components/checklist-competencia.tsx`
- Delete: `app/(app)/rh/folhas/_components/botao-aplicar-beneficios.tsx`
- Delete: `app/(app)/rh/folhas/_components/modal-enviar-financeiro.tsx`

**Interfaces:**
- Consumes: nada novo.
- Produces: superfície antiga de API eliminada; mensagem clara ao usuário quando a trava `folha_pj_ja_enviada` dispara.

- [ ] **Step 1: Buscar referências aos arquivos/exports a remover**

Grep por: `ChecklistCompetencia`, `BotaoAplicarBeneficios`, `ModalEnviarFinanceiro`, `enviarCompetencia`, `resumoEnvioCompetencia`, `ResumoEnvioCompetencia`. Esperado após Task 7: nenhuma referência fora do próprio arquivo.

Se houver referência remanescente (ex: na `folha-competencia-view.tsx` ou outro), corrigir ou mover pra Task 7 — não deletar ainda.

- [ ] **Step 2: Deletar os 3 componentes antigos**

```bash
git rm app/(app)/rh/folhas/_components/checklist-competencia.tsx
git rm app/(app)/rh/folhas/_components/botao-aplicar-beneficios.tsx
git rm app/(app)/rh/folhas/_components/modal-enviar-financeiro.tsx
```

- [ ] **Step 3: Remover `enviarCompetencia` + `resumoEnvioCompetencia` de `importar-actions.ts`**

Apagar as funções e o `export type ResumoEnvioCompetencia`. Manter tudo o mais (geração PJ, importação CLT, etc).

- [ ] **Step 4: Atualizar `botao-desaplicar-beneficios.tsx` com novo erro**

No switch de mensagens de erro, adicionar:
```ts
if (msg.includes("folha_pj_ja_enviada")) {
  return { ok: false, message: "Não dá pra desaplicar: a folha PJ dessa competência já foi enviada ao financeiro. Para corrigir, use o drawer linha a linha ou peça pro financeiro reprovar as linhas afetadas." };
}
```
(ou onde quer que o componente faça o `.rpc` + trate erro — ver arquivo atual para saber onde encaixar a mensagem).

- [ ] **Step 5: tsc + lint + build**

```bash
pnpm tsc --noEmit
pnpm lint
pnpm build
```
Esperado: zero erro. Se der erro de import não encontrado, voltar ao Step 1.

- [ ] **Step 6: Smoke test da trava nova**

Em `http://localhost:3000/rh/folhas/[competencia]` depois de ter enviado o PJ: tentar clicar "Desaplicar benefícios" (botão deve sumir pela regra do card; mas se forçar pela rota ou mantiver o link visível por algum caminho, o erro `folha_pj_ja_enviada` deve mostrar a mensagem amigável). Se o botão só aparece sob a precondição correta, marcar o smoke test como "coberto por desenho do card + mensagem pronta pra qualquer caminho futuro".

- [ ] **Step 7: Commit**

```bash
git add app/(app)/rh/folhas/importar-actions.ts \
        app/(app)/rh/folhas/_components/botao-desaplicar-beneficios.tsx \
        app/(app)/rh/folhas/_components/checklist-competencia.tsx \
        app/(app)/rh/folhas/_components/botao-aplicar-beneficios.tsx \
        app/(app)/rh/folhas/_components/modal-enviar-financeiro.tsx
git commit -m "chore(rh/folhas): remove checklist/aplicarbeneficios/modal antigos e enviarCompetencia"
```

---

## Verificação final (após Task 8)

- [ ] `pnpm tsc --noEmit` limpo
- [ ] `pnpm lint` limpo
- [ ] `pnpm build` limpo
- [ ] Smoke test completo em `/rh/folhas/[competencia]` (Task 7 Step 6)
- [ ] `/financeiro/contas-a-pagar` → 2 avulsas aparecem após "Enviar PJ"
- [ ] `/rh/beneficios` → tab Fechamentos lista o snapshot da competência
- [ ] Rodapé consolidado só aparece com zero rascunho + zero pendente nas duas origens
- [ ] Trava `folha_pj_ja_enviada` funcional (SQL direto confirma)
- [ ] Nenhum arquivo removido ainda referenciado em outro lugar (grep final)
