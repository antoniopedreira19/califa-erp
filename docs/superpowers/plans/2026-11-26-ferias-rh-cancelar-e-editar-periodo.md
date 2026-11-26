# Férias — RH cancela e edita período — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao RH a capacidade de cancelar uma solicitação de férias em qualquer fase antes do envio ao financeiro (devolvendo os dias ao colaborador), e editar o período solicitado quando o lançamento ainda está pré-aprovação.

**Architecture:** Duas ações novas em `actions.ts` (`cancelarLancamento`, `editarPeriodoLancamento`) consomem funções puras testadas em `lib/ferias/`; dois dialogs novos reusam o padrão shadcn existente; botões aparecem nos dois lugares onde RH vê a solicitação (modal da lista e card da página individual). `reprovarLancamento` é deletada — zero uso em produção.

**Tech Stack:** Next.js App Router server actions, Supabase client, Zod, shadcn/ui Dialog, `node --test` + tsx pra puros.

**Spec:** [docs/superpowers/specs/2026-11-26-ferias-rh-cancelar-e-editar-periodo-design.md](docs/superpowers/specs/2026-11-26-ferias-rh-cancelar-e-editar-periodo-design.md)

## Global Constraints

- Banco pelo ciclo do MCP — **nenhuma migration** (status `cancelado` já existe no enum, colunas de período já são editáveis).
- `lib/types.ts` à mão (nada muda).
- Strings pt-BR com acento.
- shadcn/ui `Dialog`, `Input`, `Select`, `Textarea`, `Label`.
- Reusa `assertRh`, `carregarLancamento`, `logAuditEvent`, `revalidatePath` em `actions.ts`.
- Audit: `ferias.lancamento.cancelado` e `ferias.lancamento.periodo_editado`.
- Observação do cancelamento vai na coluna `motivo_reprovacao` existente (comentada no código).
- Botões aparecem em dois lugares: `ModalDetalheSolicitacao` (tabela de Solicitações) e `CardSolicitacaoAtiva` (página `/rh/ferias/[id]`).

## Review Focus

Entradas e falhas que podem morder o usuário e não são exercitadas por um teste isolado por task:

1. **Cancelar lançamento com status `enviado_financeiro`** — deve ser rejeitado com mensagem "Cancele pelo fluxo do financeiro". Coberto na Task 2 (teste puro do gate de cancelamento).
2. **Cancelar lançamento `aprovado`/`nf_anexada` com folhas em rascunho** — folhas precisam ser apagadas junto; se o DELETE falhar, lançamento NÃO deve virar cancelado (atomicidade). Coberto na Task 2 (teste puro do contrato "folhas rascunho a apagar"); verificação manual do DELETE real na Task 6.
3. **Editar período pra uma data fora do aquisitivo escolhido** — rejeitado com mensagem "Data de início fora do aquisitivo". Coberto na Task 3 (`validar-periodo-editado.test.ts`).
4. **Editar período depois da aprovação do RH** — rejeitado. Coberto na Task 4 (teste puro do gate de edição).
5. **Cancelar/Editar duplo clique (concorrência de UI)** — botão desabilitado via `useTransition` previne o segundo clique; a action é idempotente pra `cancelado → cancelado`. Coberto na Task 6 (verificação manual).

---

## File Structure

**Novos:**
- `lib/ferias/decidir-cancelamento.ts` — função pura decide se pode cancelar + o que fazer (status transitiva + folhas a apagar).
- `lib/ferias/decidir-cancelamento.test.ts`.
- `lib/ferias/validar-periodo-editado.ts` — função pura valida mudança de período.
- `lib/ferias/validar-periodo-editado.test.ts`.
- `lib/ferias/editar-periodo-schema.ts` — Zod schema do input.
- `lib/ferias/editar-periodo-schema.test.ts`.
- `app/(app)/rh/ferias/dialog-cancelar-lancamento.tsx` — dialog cliente.
- `app/(app)/rh/ferias/dialog-editar-periodo.tsx` — dialog cliente.

**Modificados:**
- `app/(app)/rh/ferias/actions.ts` — remove `reprovarLancamento`/`reprovarSchema`, adiciona `cancelarLancamento` e `editarPeriodoLancamento`.
- `app/(app)/rh/ferias/modal-detalhe-solicitacao.tsx` — troca fluxo de reprovar pelo dialog de cancelar; adiciona botão "Editar período".
- `app/(app)/rh/ferias/acoes-lancamento.tsx` — trocar "Reprovar" por "Cancelar" com novo dialog.
- `app/(app)/rh/ferias/[id]/page.tsx` — "Cancelada" em vez de "Cancelado"; adiciona botões no `CardSolicitacaoAtiva`.

---

## Task 1: Decidir cancelamento — função pura

**Files:**
- Create: `lib/ferias/decidir-cancelamento.ts`
- Test: `lib/ferias/decidir-cancelamento.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  ```ts
  export type StatusLancamento =
    | "aguardando_gestor" | "pendente_aprovacao" | "aprovado"
    | "nf_anexada" | "enviado_financeiro" | "aguardando_financeiro"
    | "reprovado" | "cancelado" | "concluido";

  export type ResultadoCancelamento =
    | { ok: true; deve_apagar_folhas_rascunho: boolean; idempotente: boolean }
    | { ok: false; message: string };

  export function decidirCancelamento(status: StatusLancamento): ResultadoCancelamento;
  ```

- [ ] **Step 1: Write failing tests**

Em `lib/ferias/decidir-cancelamento.test.ts`, `node:test` + `node:assert/strict`:

- `test("aguardando_gestor → ok, sem apagar folhas")` — espera `{ ok: true, deve_apagar_folhas_rascunho: false, idempotente: false }`.
- `test("pendente_aprovacao → ok, sem apagar folhas")`.
- `test("aprovado → ok, apaga folhas rascunho")` — espera `{ ok: true, deve_apagar_folhas_rascunho: true, idempotente: false }`.
- `test("nf_anexada → ok, apaga folhas rascunho")`.
- `test("enviado_financeiro → rejeita com mensagem de financeiro")` — mensagem contém "financeiro".
- `test("concluido → rejeita")` — mensagem contém "concluída".
- `test("cancelado → ok idempotente")` — `{ ok: true, deve_apagar_folhas_rascunho: false, idempotente: true }`.
- `test("reprovado → ok idempotente (dado legado)")`.
- `test("aguardando_financeiro → rejeita")`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/ferias/decidir-cancelamento.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implement `decidirCancelamento` em `lib/ferias/decidir-cancelamento.ts`**

Switch sobre o status. Mensagens:
- `enviado_financeiro`: "Essa solicitação já foi enviada ao financeiro — cancele pelo fluxo financeiro."
- `concluido`: "A solicitação já foi concluída e não pode ser cancelada."
- `aguardando_financeiro`: "A solicitação está em processamento pelo financeiro — cancele por lá."

`deve_apagar_folhas_rascunho = status in ('aprovado','nf_anexada')`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/ferias/decidir-cancelamento.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ferias/decidir-cancelamento.ts lib/ferias/decidir-cancelamento.test.ts
git commit -m "feat(ferias): regra pura de decisão de cancelamento"
```

---

## Task 2: `cancelarLancamento` action + delete de folhas

**Files:**
- Modify: `app/(app)/rh/ferias/actions.ts` — remove `reprovarLancamento`/`reprovarSchema`, adiciona `cancelarLancamento`.

**Interfaces:**
- Consumes: `decidirCancelamento` do Task 1.
- Produces:
  ```ts
  export async function cancelarLancamento(
    lancamentoId: string,
    opts?: { observacao?: string },
  ): Promise<ActionResult>;
  ```

- [ ] **Step 1: Deletar `reprovarLancamento` e `reprovarSchema`**

Remover linhas 364-434 de `actions.ts` (bloco `// ---------- Reprovar ----------` até o fim de `reprovarLancamento`). Não restaura em nenhum arquivo cliente — isso quebra a UI e será consertado nas Tasks 7/8.

- [ ] **Step 2: Implementar `cancelarLancamento`**

No lugar removido. Lógica:
1. `assertRh`.
2. `carregarLancamento`. Se não existir, `{ ok: false, message: "Lançamento não encontrado." }`.
3. `const decisao = decidirCancelamento(lanc.status as StatusLancamento)`. Se `!ok`, retorna `{ ok: false, message: decisao.message }`.
4. Se `decisao.idempotente`, retorna `{ ok: true, id: lanc.id }`.
5. Observação: `const observacao = opts?.observacao?.trim() || null`.
6. Se `decisao.deve_apagar_folhas_rascunho`, `DELETE FROM folhas_pagamento WHERE lancamento_ferias_id=? AND status='rascunho' AND tenant_id=?` — conta `folhasApagadas`.
7. `UPDATE colaboradores_ferias_lancamentos SET status='cancelado', motivo_reprovacao=observacao, aprovado_por=NULL, aprovado_em=NULL WHERE id=? AND tenant_id=?`.
   - Comentar: "motivo_reprovacao reusa coluna existente pra observação do cancelamento; nessa versão reprovar e cancelar são operacionalmente a mesma coisa."
8. Audit `ferias.lancamento.cancelado` com `{ status_anterior, colaborador_id, folhas_apagadas, observacao }`.
9. `revalidatePath('/rh/ferias')`, `('/perfil')`, `('/financeiro/contas-a-pagar')`.
10. `return { ok: true, id: lanc.id }`.

- [ ] **Step 3: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero erros **novos** (callsites em `acoes-lancamento.tsx`, `modal-detalhe-solicitacao.tsx` vão quebrar — consertados nas Tasks 7/8). Erros de typecheck em `reprovarLancamento` sendo chamado são esperados.

- [ ] **Step 4: Commit (parcial — build quebrado é esperado até Task 8)**

```bash
git add app/\(app\)/rh/ferias/actions.ts
git commit -m "feat(ferias): cancelarLancamento substitui reprovarLancamento no backend"
```

---

## Task 3: Validar período editado — função pura

**Files:**
- Create: `lib/ferias/validar-periodo-editado.ts`
- Test: `lib/ferias/validar-periodo-editado.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AquisitivoParaValidar = {
    id: string;
    aquisitivo_inicio: string; // YYYY-MM-DD
    data_limite_gozo: string;
    dias_direito: number;
    dias_ocupados_outros: number; // dias de outros lançamentos do mesmo aquisitivo
  };

  export type ResultadoValidacaoPeriodo =
    | { ok: true; dias: number }
    | { ok: false; message: string };

  export function validarPeriodoEditado(input: {
    data_inicio: string;
    data_fim: string;
    aquisitivo: AquisitivoParaValidar | null;
  }): ResultadoValidacaoPeriodo;
  ```

- [ ] **Step 1: Write failing tests**

- `test("data_fim < data_inicio → rejeita")` — mensagem "Data de fim antes da data de início."
- `test("happy path sem aquisitivo (abono avulso) → ok com dias correto")` — início `2026-12-01`, fim `2026-12-05` → `{ ok: true, dias: 5 }` (inclusivo).
- `test("1 dia → dias=1")` — início = fim = `2026-12-01` → `{ ok: true, dias: 1 }`.
- `test("data_inicio antes do aquisitivo_inicio → rejeita")` — mensagem contém "fora do aquisitivo".
- `test("data_inicio depois do data_limite_gozo → rejeita")`.
- `test("dias excede saldo do aquisitivo → rejeita")` — mensagem contém "saldo".
- `test("dias == saldo exato → ok")`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/ferias/validar-periodo-editado.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Calcular dias: `const dias = Math.round((Date.parse(data_fim+'T00:00:00Z') - Date.parse(data_inicio+'T00:00:00Z')) / 86400000) + 1`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/ferias/validar-periodo-editado.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ferias/validar-periodo-editado.ts lib/ferias/validar-periodo-editado.test.ts
git commit -m "feat(ferias): regra pura de validação de período editado"
```

---

## Task 4: Schema + action `editarPeriodoLancamento`

**Files:**
- Create: `lib/ferias/editar-periodo-schema.ts`
- Create: `lib/ferias/editar-periodo-schema.test.ts`
- Modify: `app/(app)/rh/ferias/actions.ts` — adiciona `editarPeriodoLancamento`.

**Interfaces:**
- Consumes: `validarPeriodoEditado` do Task 3.
- Produces:
  ```ts
  // schema.ts
  export const editarPeriodoSchema = z.object({
    lancamento_id: z.string().uuid(),
    data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodo_id: z.string().uuid().nullable(),
  });

  // actions.ts
  export async function editarPeriodoLancamento(input: unknown): Promise<ActionResult>;
  ```

- [ ] **Step 1: Write failing schema tests**

Em `lib/ferias/editar-periodo-schema.test.ts`:
- `test("happy path parse")`.
- `test("data_inicio formato errado falha")` — `"01/12/2026"` falha.
- `test("lancamento_id não-uuid falha")`.
- `test("periodo_id null passa")`.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test lib/ferias/editar-periodo-schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement schema**

Conforme Interfaces. Export `type EditarPeriodoInput = z.infer<typeof editarPeriodoSchema>`.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx --test lib/ferias/editar-periodo-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `editarPeriodoLancamento` em `actions.ts`**

Logo após `cancelarLancamento`. Lógica:
1. `assertRh`.
2. `editarPeriodoSchema.safeParse(input)`. Falha → `{ ok: false, message: "Dados inválidos." }`.
3. `carregarLancamento`. Rejeita se `status not in ('aguardando_gestor','pendente_aprovacao')` com mensagem "Só é possível editar o período antes da aprovação do RH."
4. Se `periodo_id != null`: lê `colaboradores_ferias_periodos` + soma `dias` de outros lançamentos ativos (`status in ('aguardando_gestor','pendente_aprovacao','aprovado','nf_anexada','concluido')` e `id != lancamento_id`) no mesmo `periodo_id` pra ter `dias_ocupados_outros`.
5. `validarPeriodoEditado({ data_inicio, data_fim, aquisitivo })`. Se `!ok`, devolve `{ ok: false, message: resultado.message }`.
6. `UPDATE colaboradores_ferias_lancamentos SET data_inicio, data_fim, dias=resultado.dias, periodo_id WHERE id=? AND tenant_id=?`.
7. Audit `ferias.lancamento.periodo_editado` com `{ colaborador_id, de: {...dados_atuais}, para: {...dados_novos} }`.
8. `revalidatePath('/rh/ferias', '/perfil')`.

- [ ] **Step 6: tsc**

Run: `npx tsc --noEmit 2>&1 | grep -v reprovarLancamento`
Expected: zero erros novos (erros antigos de `reprovarLancamento` ainda presentes nas UIs).

- [ ] **Step 7: Commit**

```bash
git add lib/ferias/editar-periodo-schema.ts lib/ferias/editar-periodo-schema.test.ts app/\(app\)/rh/ferias/actions.ts
git commit -m "feat(ferias): editarPeriodoLancamento action + schema"
```

---

## Task 5: `DialogCancelarLancamento`

**Files:**
- Create: `app/(app)/rh/ferias/dialog-cancelar-lancamento.tsx`

**Interfaces:**
- Consumes: `cancelarLancamento` do Task 2.
- Produces:
  ```tsx
  export function DialogCancelarLancamento(props: {
    aberto: boolean;
    lancamentoId: string;
    statusLancamento: FeriasLancamentoStatus;
    onFechar: () => void;
    onCancelado?: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Implementar**

`"use client"`. Dialog shadcn `max-w-md`.

Estado: `observacao: string`, `pending` via `useTransition`, `erro: string | null`.

Render:
- Título "Cancelar solicitação".
- Texto: "Essa ação volta os dias do aquisitivo pro colaborador. Ele poderá solicitar de novo."
- Se `statusLancamento === 'aprovado' || 'nf_anexada'`: bloco amber "Essa solicitação já tinha folhas de pagamento em rascunho — elas serão removidas junto."
- `<Label htmlFor="obs">Observação (opcional)</Label>` + `<Textarea id="obs" value={observacao} onChange=... rows={3} maxLength={500} />`.
- Botões: "Voltar" + "Confirmar cancelamento" (primário california-red).

Submit:
```ts
startTransition(async () => {
  const res = await cancelarLancamento(lancamentoId, {
    observacao: observacao.trim() || undefined,
  });
  if (!res.ok) { setErro(res.message); return; }
  onFechar();
  onCancelado?.();
  router.refresh();
});
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit app/\(app\)/rh/ferias/dialog-cancelar-lancamento.tsx 2>&1 | head`
Expected: zero erros desse arquivo.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/rh/ferias/dialog-cancelar-lancamento.tsx
git commit -m "feat(ferias): dialog pro RH cancelar lançamento"
```

---

## Task 6: `DialogEditarPeriodo`

**Files:**
- Create: `app/(app)/rh/ferias/dialog-editar-periodo.tsx`

**Interfaces:**
- Consumes: `editarPeriodoLancamento` do Task 4.
- Produces:
  ```tsx
  export function DialogEditarPeriodo(props: {
    aberto: boolean;
    lancamentoId: string;
    dataInicioAtual: string;
    dataFimAtual: string;
    periodoIdAtual: string | null;
    tipoLancamento: FeriasLancamentoTipo;
    aquisitivosDisponiveis: Array<{ id: string; rotulo: string; saldo: number }>;
    onFechar: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Implementar**

`"use client"`. Dialog `max-w-md`.

Estado: `dataInicio, dataFim: string`, `periodoId: string | null` (começa com os valores atuais), `pending`, `erro`.

Reset dos estados em `useEffect` quando `aberto` muda.

Render:
- Título "Editar período".
- Read-only: "Tipo: {label do tipo}".
- `<Select>` "Período aquisitivo" — opções de `aquisitivosDisponiveis` + opção manual "Sem aquisitivo (abono avulso)" com sentinel `__nenhum__` (per feedback_radix_gotchas: SelectItem value="" crasha). Ao salvar, `__nenhum__` → `null`.
- `<Input type="date">` "Início" e "Fim".
- Legenda computada: "Dias: N" calculada client-side com mesmo método da função pura.
- Botões: "Cancelar" + "Salvar".

Submit:
```ts
startTransition(async () => {
  const res = await editarPeriodoLancamento({
    lancamento_id: lancamentoId,
    data_inicio: dataInicio,
    data_fim: dataFim,
    periodo_id: periodoId === "__nenhum__" ? null : periodoId,
  });
  if (!res.ok) { setErro(res.message); return; }
  onFechar();
  router.refresh();
});
```

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npm run lint 2>&1 | grep dialog-editar-periodo`
Expected: zero erros desse arquivo.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/rh/ferias/dialog-editar-periodo.tsx
git commit -m "feat(ferias): dialog pro RH editar período solicitado"
```

---

## Task 7: Wire no `ModalDetalheSolicitacao` e `AcoesLancamento`

**Files:**
- Modify: `app/(app)/rh/ferias/modal-detalhe-solicitacao.tsx`
- Modify: `app/(app)/rh/ferias/acoes-lancamento.tsx`

**Interfaces:**
- Consumes: `DialogCancelarLancamento` do Task 5 e `DialogEditarPeriodo` do Task 6.

- [ ] **Step 1: `modal-detalhe-solicitacao.tsx` — trocar reprovar por cancelar**

- Remove import `reprovarLancamento`, estado `modoReprovar`, `motivo`, `handleReprovar`, bloco de textarea de motivo embutido, botão "Reprovar".
- Importa `DialogCancelarLancamento`, estado `const [cancelandoAberto, setCancelandoAberto] = useState(false)`.
- Importa `DialogEditarPeriodo`, estado `const [editandoAberto, setEditandoAberto] = useState(false)`.
- Rodapé: botões "Cancelar solicitação" (sempre visível pré-financeiro) e "Editar período" (só `aguardando_gestor`/`pendente_aprovacao`).
- Renderiza `<DialogCancelarLancamento ... onCancelado={onSucesso} />` e `<DialogEditarPeriodo ... />`.
- `aquisitivosDisponiveis` passado como prop vinda do pai (ou derivar do `row.periodo_id` — se o componente não tiver acesso, deixar `[]` e o Select mostra só o atual; builder resolve).

- [ ] **Step 2: `acoes-lancamento.tsx` — trocar "Reprovar" por "Cancelar"**

- Remove `reprovarLancamento` do import.
- Remove estado `reprovandoAberto`, `motivo`, bloco de dialog de reprovar (linhas 232-280 aprox).
- Importa `DialogCancelarLancamento`.
- Botão "Reprovar" vira "Cancelar", abre `DialogCancelarLancamento`.
- `podeReprovar` → `podeCancelar = status !== 'enviado_financeiro' && status !== 'concluido' && status !== 'cancelado'`.

- [ ] **Step 3: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero erros.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/rh/ferias/modal-detalhe-solicitacao.tsx app/\(app\)/rh/ferias/acoes-lancamento.tsx
git commit -m "feat(ferias): modal e ações da lista usam dialog de cancelar + editar"
```

---

## Task 8: Botões no `CardSolicitacaoAtiva` + label "Cancelada"

**Files:**
- Modify: `app/(app)/rh/ferias/[id]/page.tsx`

**Interfaces:**
- Consumes: `DialogCancelarLancamento`, `DialogEditarPeriodo`.

- [ ] **Step 1: Troca label "Cancelado" → "Cancelada"**

Em `statusInfo` da função `CardSolicitacaoAtiva`, status `cancelado` passa a `label: "Cancelada"`. Status `reprovado` também vira `"Cancelada"` (pra consistência — dado legado).

- [ ] **Step 2: Montar lista de aquisitivos pros filhos**

Dentro de `CardSolicitacaoAtiva` ou via prop, passar `aquisitivosDisponiveis` com shape `{ id, rotulo, saldo }`. Deriva de `periodosDisponiveis` já calculado no servidor (linha ~238) — aceita como nova prop do card.

Atualizar chamada do `CardSolicitacaoAtiva` passando `aquisitivos={periodosDisponiveis.map(p => ({id, rotulo: ..., saldo: p.saldo}))}`.

- [ ] **Step 3: Adicionar botões no rodapé do card**

Depois do `TimelineAprovacoes` do `CardSolicitacaoAtiva`, adicionar seção de ações (só pro RH, mesmo gate que o resto):
- Botão "Cancelar solicitação" visível quando `status in ('aguardando_gestor','pendente_aprovacao','aprovado','nf_anexada')`.
- Botão "Editar período" visível quando `status in ('aguardando_gestor','pendente_aprovacao')`.
- Botões renderizados num row flex pequeno com gap.

Dialogs renderizados condicionalmente com useState local.

**Nota:** `CardSolicitacaoAtiva` é server component atualmente (função pura). Pra ter estado + dialogs, preciso convertê-lo em client component (`"use client"` no topo do arquivo) **ou** extrair um `BotoesRhLancamento` cliente que recebe props e cuida dos dialogs. **Vou com extração**, pra manter page.tsx server. Criar `app/(app)/rh/ferias/[id]/botoes-rh-lancamento.tsx` client com os dois botões + os dialogs.

- [ ] **Step 4: Criar `botoes-rh-lancamento.tsx`**

`"use client"`. Props: `{ lancamentoId, status, dataInicio, dataFim, periodoId, tipoLancamento, aquisitivos }`. Renderiza os 2 botões condicionais + os 2 dialogs com `useState` de abertura.

- [ ] **Step 5: Chamar o novo componente no card**

Em `CardSolicitacaoAtiva`, importar e renderizar `<BotoesRhLancamento ... />` passando props a partir do `l` e dos aquisitivos.

- [ ] **Step 6: tsc + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: build limpo.

- [ ] **Step 7: Verificação manual**

Roteiro em `/rh/ferias/<id>`:
1. Status `aguardando_gestor` da Fabiane → ver botões "Cancelar solicitação" e "Editar período" no card.
2. Clicar "Editar período" → trocar data_inicio → "Dias" atualiza → Salvar → período muda.
3. Clicar "Cancelar solicitação" → textarea opcional → confirmar → status vira "Cancelada", card sai do bloco "Em andamento".
4. Abrir lançamento `aprovado` → cancelar → verificar no financeiro que folhas em rascunho sumiram.
5. Lançamento `enviado_financeiro` → botão "Cancelar" não aparece.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/rh/ferias/\[id\]/page.tsx app/\(app\)/rh/ferias/\[id\]/botoes-rh-lancamento.tsx
git commit -m "feat(ferias): botões Cancelar e Editar período no card do colaborador"
```

---

## Self-review

**Spec coverage:**

| Meta da spec | Task |
|---|---|
| 1. `cancelarLancamento` nova | Task 2 (consome Task 1) |
| 2. Remover `reprovarLancamento` + botão vira "Cancelar" | Task 2 (backend), Task 7 (UI) |
| 3. Delete de folhas em rascunho ao cancelar | Task 2 |
| 4. `editarPeriodoLancamento` nova | Task 4 (consome Task 3) |
| 5. `DialogCancelarLancamento` + `DialogEditarPeriodo` | Task 5, Task 6 |
| 6. Botões nos dois lugares (modal + card) | Task 7, Task 8 |
| 7. Label "Cancelada" | Task 8 |
| 8. Audit `cancelado` e `periodo_editado` | Task 2, Task 4 |

**Review Focus:**
1. Cancelar `enviado_financeiro` rejeitado → Task 1 teste.
2. Delete de folhas atomicidade → Task 1 contrato + Task 6 verificação manual.
3. Data fora do aquisitivo → Task 3 teste.
4. Editar após aprovação → Task 4 gate verificado manualmente (Task 6).
5. Duplo clique → Task 8 verificação manual (botão desabilitado via `useTransition`).

**Step scan:** cada step tem resultado checável (teste, comando, verificação). Nenhum body de função — só assinaturas e contratos.

**Type consistency:** `StatusLancamento`, `ResultadoCancelamento`, `AquisitivoParaValidar`, `editarPeriodoSchema` definidos no primeiro uso e reusados consistentemente.

**Proporção:** spec ~250 linhas, plan ~400 linhas. Plan carrega nomes de arquivo, assinaturas, testes nomeados. Sem transcrição de código.
