# Férias — Documentos por folha na página do colaborador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alinhar a página `/rh/ferias/[id]` e o tooltip de `people-list.tsx` com o modelo por-folha que o backend já implementa, e permitir ao RH anexar o recibo da contabilidade (CLT) e enviar ao financeiro com data de pagamento editável.

**Architecture:** Nenhuma mudança de schema. Uma função pura nova (`lancamentoEnviavel`) que vive em `lib/ferias/` serve de fonte-verdade pra "pronto pra enviar", consumida pelo bloco de documentos e por `enviarProFinanceiro`. A página ganha 3 componentes novos (bloco + 2 dialogs) e a action `enviarProFinanceiro` ganha um parâmetro opcional e um gate baseado em completude de folhas. Finaliza alinhando o tooltip do financeiro.

**Tech Stack:** Next.js App Router, React Server Components, TypeScript, Supabase (postgres + storage), shadcn/ui, Tailwind, Zod, `node --test` + `tsx` pra testes puros.

**Spec:** [docs/superpowers/specs/2026-11-26-ferias-pagina-colaborador-documentos-por-folha-design.md](docs/superpowers/specs/2026-11-26-ferias-pagina-colaborador-documentos-por-folha-design.md)

## Global Constraints

- Banco pelo ciclo do MCP (`docs/FLUXO-BANCO.md`). Esse plan **não tem migration** — toda a infraestrutura de banco já existe.
- `lib/types.ts` é escrito à mão; qualquer tipo compartilhado passa por lá.
- Strings visíveis ao usuário em pt-BR com acento. Identificadores de código podem ficar sem acento.
- Nenhum PII em código, teste, fixture ou mensagem de commit.
- Performance (`docs/PERFORMANCE.md`): todas as queries independentes da nova página usam `Promise.all`; nenhum embed pesado só pra contar.
- shadcn/ui Dialog (padrão), `Input type="date"` e `Input type="file"` nativos.
- Reusa `anexarReciboContabilFolhaFerias` e `gerarUrlUploadReciboContabil` já existentes em `app/(app)/rh/ferias/actions-pagamentos.ts` — **não** modificar essas actions.
- Ícones `lucide-react`. Paleta: `california-red` primária, `sky-*` pra anexos presentes, `amber-*` pra pendentes.

## Review Focus

Entradas que a spec implica mas que nenhum teste de tarefa, isoladamente, exercita:

1. **Lançamento híbrido (`clt_recibo`) com NF anexada mas sem recibo contábil.** Botão Enviar deve ficar desabilitado e tooltip listar "Recibo da contabilidade". Coberto na Task 1 (`lancamento-enviavel.test.ts`), caso (7).
2. **CLT puro (`clt`) que nunca passou por trigger de NF.** Lançamento fica `status = 'aprovado'` indefinidamente; o novo gate em `enviarProFinanceiro` deve aceitar `aprovado` quando folhas completas. Coberto na Task 3 (`enviar-pro-financeiro-gate.test.ts`), caso "aprovado + folhas completas → ok".
3. **Troca de data pra uma data no passado.** Nenhuma regra de negócio proíbe; mas a validação Zod exige `YYYY-MM-DD` válido — campo `<input type="date">` no navegador já restringe formato. Coberto na Task 3, caso "dataPagamento inválida → erro".
4. **PDF que falha no upload (bucket indisponível, 403).** Dialog precisa manter aberto, mostrar erro humano e não limpar campos. Coberto na Task 5, step de verificação manual (upload com URL assinada rejeitada pelo bucket intencionalmente).
5. **Chamada concorrente: RH clica Enviar duas vezes seguidas.** `enviarProFinanceiro` já é idempotente pra `enviado_financeiro` (devolve ok). A UI deve desabilitar o botão durante `pending` do `useTransition`. Coberto na Task 6, verificação manual.

---

## File Structure

**Novos:**
- `lib/ferias/lancamento-enviavel.ts` — função pura `lancamentoEnviavel(folhas, nfs)`.
- `lib/ferias/lancamento-enviavel.test.ts` — testes puros.
- `lib/ferias/hint-aprovado.ts` — função pura `hintAprovado(folhas, nfs)`.
- `lib/ferias/hint-aprovado.test.ts` — testes puros.
- `app/(app)/rh/ferias/[id]/bloco-documentos-lancamento.tsx` — bloco visual (client component).
- `app/(app)/rh/ferias/[id]/dialog-anexar-recibo-contabil.tsx` — dialog de upload + valor (client component).
- `app/(app)/rh/ferias/[id]/dialog-confirmar-envio-financeiro.tsx` — dialog de envio com data (client component).

**Modificados:**
- `app/(app)/rh/ferias/actions.ts` — assinatura e gate de `enviarProFinanceiro`.
- `app/(app)/rh/ferias/[id]/page.tsx` — carrega folhas, renderiza `BlocoDocumentosLancamento`, hint dinâmica.
- `app/(app)/financeiro/contas-a-pagar/people-list.tsx` — tooltip dinâmica pela `origem` da linha.

---

## Task 1: Função pura `lancamentoEnviavel`

**Files:**
- Create: `lib/ferias/lancamento-enviavel.ts`
- Test: `lib/ferias/lancamento-enviavel.test.ts`

**Interfaces:**
- Consumes: nada (puro).
- Produces:
  ```ts
  export type FolhaMin = {
    id: string;
    origem: "california" | "contabilidade";
    tipo_folha_ferias: "usufruto" | "abono" | null;
    status: string; // "rascunho" | "enviada" | ...
    anexo_url: string | null;
  };
  export type NfMin = {
    escopo_tipo: "ferias_usufruto" | "ferias_abono";
    escopo_id: string;
  };
  export type ResultadoEnviavel =
    | { ok: true }
    | { ok: false; falta: string[] };

  export function lancamentoEnviavel(
    lancamentoId: string,
    folhas: FolhaMin[],
    nfs: NfMin[],
  ): ResultadoEnviavel;
  ```

- [ ] **Step 1: Write failing tests**

Em `lib/ferias/lancamento-enviavel.test.ts`, usando `node:test` + `node:assert/strict` (padrão do projeto):

- `test("PJ com NF usufruto anexada → ok")` — 1 folha california/usufruto, 1 nf ferias_usufruto com escopo_id = lanc. Espera `{ ok: true }`.
- `test("PJ sem NF → falta 'NF de férias'")` — 1 folha california/usufruto, 0 nfs. Espera `{ ok: false, falta: ["NF de férias"] }`.
- `test("CLT com anexo_url → ok")` — 1 folha contabilidade/usufruto com `anexo_url = 'x'`. Espera `{ ok: true }`.
- `test("CLT sem anexo_url → falta 'Recibo da contabilidade'")` — 1 folha contabilidade/usufruto, `anexo_url = null`. Espera `{ ok: false, falta: ["Recibo da contabilidade"] }`.
- `test("CLT abono sem anexo → falta 'Recibo de abono California'")`.
- `test("Híbrido completo (NF + recibo) → ok")` — 1 folha california/usufruto com NF + 1 folha contabilidade/usufruto com anexo_url.
- `test("Híbrido só NF → falta recibo")`.
- `test("Híbrido só recibo → falta NF")`.
- `test("Folhas já enviadas não entram na conta")` — 1 folha california/usufruto, status='enviada', sem NF. Espera `{ ok: true }` (só rascunhos são checados).
- `test("Lançamento sem folhas → falta por não ter folha")` — espera `{ ok: false, falta: ["Nenhuma folha gerada"] }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/ferias/lancamento-enviavel.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implement `lancamentoEnviavel` em `lib/ferias/lancamento-enviavel.ts`**

Itera `folhas.filter(f => f.status === 'rascunho')`. Pra cada folha:
- Se `origem === 'california'`: procura em `nfs` uma entrada com `escopo_tipo === 'ferias_' + tipo_folha_ferias` e `escopo_id === lancamentoId`.
- Se `origem === 'contabilidade'`: checa `anexo_url != null`.
- Monta label human-readable pro `falta`:
  - `california` + `usufruto` → "NF de férias"
  - `california` + `abono` → "NF de abono"
  - `contabilidade` + `usufruto` → "Recibo da contabilidade"
  - `contabilidade` + `abono` → "Recibo de abono California"

Vazio (`folhas.length === 0` ou nenhuma em rascunho) → distinguir: se array vazio total, `falta = ["Nenhuma folha gerada"]`; se há folhas mas todas enviadas, retorna `{ ok: true }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/ferias/lancamento-enviavel.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ferias/lancamento-enviavel.ts lib/ferias/lancamento-enviavel.test.ts
git commit -m "feat(ferias): regra pura de enviabilidade por folha"
```

---

## Task 2: Função pura `hintAprovado`

**Files:**
- Create: `lib/ferias/hint-aprovado.ts`
- Test: `lib/ferias/hint-aprovado.test.ts`

**Interfaces:**
- Consumes: `FolhaMin`, `NfMin` do Task 1.
- Produces:
  ```ts
  export function hintAprovado(
    lancamentoId: string,
    folhas: FolhaMin[],
    nfs: NfMin[],
  ): string;
  ```

- [ ] **Step 1: Write failing tests**

Em `lib/ferias/hint-aprovado.test.ts`:
- `test("tudo anexado → 'Pronto pra enviar ao financeiro.'")`.
- `test("só CLT pendente → 'Aguardando RH anexar o recibo da contabilidade.'")`.
- `test("só PJ pendente → 'Aguardando colaborador anexar a NF.'")`.
- `test("CLT e PJ pendentes → 'Aguardando RH anexar recibo e colaborador anexar NF.'")`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/ferias/hint-aprovado.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `hintAprovado` em `lib/ferias/hint-aprovado.ts`**

Reusa `lancamentoEnviavel` pra pegar `falta`. Classifica cada item de `falta` como NF (começa com "NF") ou recibo (começa com "Recibo"). Retorna uma das 4 strings fixas acima. Strings exatas em pt-BR com acento.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/ferias/hint-aprovado.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ferias/hint-aprovado.ts lib/ferias/hint-aprovado.test.ts
git commit -m "feat(ferias): hint dinâmica do status aprovado"
```

---

## Task 3: `enviarProFinanceiro` com gate novo e `dataPagamento?`

**Files:**
- Modify: `app/(app)/rh/ferias/actions.ts:847-918`
- Create: `app/(app)/rh/ferias/enviar-pro-financeiro-gate.test.ts`

**Interfaces:**
- Consumes: `lancamentoEnviavel` do Task 1.
- Produces:
  ```ts
  export async function enviarProFinanceiro(
    lancamentoId: string,
    opts?: { dataPagamento?: string },
  ): Promise<ActionResult>;
  ```

- [ ] **Step 1: Write failing tests pra validação de `dataPagamento`**

Em `enviar-pro-financeiro-gate.test.ts`, testes puros do schema Zod (a action em si precisa Supabase — testes de gate real ficam na verificação manual):

- Importa um novo schema `dataPagamentoSchema` que será exportado de `actions.ts`.
- `test("YYYY-MM-DD válida passa")` → `dataPagamentoSchema.safeParse("2026-12-20").success === true`.
- `test("formato errado falha")` → `"20/12/2026"` falha.
- `test("undefined passa (opcional)")` → undefined passa.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test app/(app)/rh/ferias/enviar-pro-financeiro-gate.test.ts`
Expected: FAIL — schema não exportado.

- [ ] **Step 3: Implement mudanças em `enviarProFinanceiro`**

Em `app/(app)/rh/ferias/actions.ts`:

1. Exportar `dataPagamentoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()`.
2. Mudar assinatura pra `enviarProFinanceiro(lancamentoId: string, opts?: { dataPagamento?: string })`.
3. Trocar o gate `if (lanc.status !== "nf_anexada")`:
   - Aceita `status in ('aprovado','nf_anexada')`.
   - Lê folhas (`folhas_pagamento`) + NFs (`colaboradores_nf_anexos` escopo ferias) do lançamento.
   - Chama `lancamentoEnviavel(lancamentoId, folhas, nfs)`. Se `!ok`, devolve `{ ok: false, message: "Faltam documentos: " + falta.join(", ") + "." }`.
4. Se `opts?.dataPagamento`: valida com `dataPagamentoSchema`. Se inválida, `{ ok: false, message: "Data de pagamento inválida." }`. Antes do UPDATE de status, roda `UPDATE folhas_pagamento SET data_pagamento_prevista = X WHERE lancamento_ferias_id = ... AND status = 'rascunho'`.
5. Audit `ferias.lancamento.enviado_financeiro` ganha `data_pagamento?: string` no metadata.

- [ ] **Step 4: Run tests to verify Zod schema**

Run: `npx tsx --test app/(app)/rh/ferias/enviar-pro-financeiro-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/rh/ferias/actions.ts app/\(app\)/rh/ferias/enviar-pro-financeiro-gate.test.ts
git commit -m "feat(ferias): gate de envio por completude de folhas + data editável"
```

---

## Task 4: `BlocoDocumentosLancamento` — bloco visual na página

**Files:**
- Create: `app/(app)/rh/ferias/[id]/bloco-documentos-lancamento.tsx`
- Modify: `app/(app)/rh/ferias/[id]/page.tsx` (substitui bloco antigo em ~L570-589 e atualiza `hint` em `statusInfo.aprovado`)

**Interfaces:**
- Consumes: `lancamentoEnviavel`, `hintAprovado`, dialogs do Task 5 e Task 6.
- Produces: componente React server-component que recebe folhas + nfs do lançamento e renderiza a lista com botões.

- [ ] **Step 1: Carregar folhas por lançamento em `page.tsx`**

Em `app/(app)/rh/ferias/[id]/page.tsx`, dentro do `Promise.all` existente (linha 47), adicionar query:
```ts
supabase
  .from("folhas_pagamento")
  .select("id, lancamento_ferias_id, origem, tipo_folha_ferias, status, anexo_url, salario_base, data_pagamento_prevista")
  .eq("tenant_id", tenantId)
  .eq("colaborador_id", params.id)
  .eq("tipo", "ferias")
  .not("lancamento_ferias_id", "is", null),
```

Passar `folhasFerias` adiante (já é passado em alguns componentes — ver `folhasFeriasRes` existente).

- [ ] **Step 2: Implementar `BlocoDocumentosLancamento`**

`client component` (`"use client"`). Props: `lancamentoId: string`, `tipoLancamento: FeriasLancamentoTipo`, `folhas: FolhaMin[]` (filtradas pelo lançamento), `nfs: NfMin[]` (filtradas pelo lançamento), `role: string`.

Render:
- Cabeçalho: ícone `FileText` + "Documentos" + badge "{anexados}/{total}".
- Lista de slots (uma linha por folha):
  - Ícone + rótulo (`origem` + `tipo_folha_ferias` → mapa fixo: `california/usufruto="NF de férias"`, `california/abono="NF de abono"`, `contabilidade/usufruto="Recibo da contabilidade"`, `contabilidade/abono="Recibo de abono California"`).
  - Se anexado: cor sky, nome arquivo (NF: `nfs[].arquivo_nome`; recibo: derivar do `anexo_url.split('/').pop()`), link "Ver" que chama a action apropriada pra signed URL (NF: `obterUrlNfAnexo`; recibo: criar helper ou reusar `supabase.storage.from('recibos-ferias').createSignedUrl`).
  - Se pendente:
    - `origem === 'california'`: texto "Aguardando colaborador anexar no perfil" (sem botão).
    - `origem === 'contabilidade'` + `role in ('rh','administrador')`: botão "Anexar" (abre `DialogAnexarReciboContabil`).
    - `origem === 'contabilidade'` + outro role: texto "Aguardando RH anexar".
- Rodapé: botão `Button` primário vermelho "Enviar ao financeiro".
  - Desabilitado quando `!lancamentoEnviavel(...).ok` OU `status in ('enviado_financeiro','concluido','reprovado','cancelado')`.
  - Tooltip (via `title=`) quando desabilitado: `"Faltam documentos: " + falta.join(", ")`.
  - Ao clicar: abre `DialogConfirmarEnvioFinanceiro`.

- [ ] **Step 3: Substituir bloco antigo em `page.tsx` e atualizar hint**

Em `page.tsx:570-589` (o `nf ? (...) : l.status === "aprovado" ? (...) : null`), substituir pelo `<BlocoDocumentosLancamento ... />` passando folhas filtradas pelo `lancamento_ferias_id`.

Na `statusInfo` (linha 456), trocar `hint` fixo do `aprovado`:
```ts
aprovado: {
  ...,
  hint: hintAprovado(l.id, folhasDoLanc, nfsDoLanc),
},
```

(Mudar o tipo de `statusInfo` pra permitir `hint` calculada por instância — deixar de ser `Record<..., {hint: string}>` com valor estático. Substituir por uma função helper `montarStatusInfo(lanc, folhas, nfs)` que retorna o objeto.)

- [ ] **Step 4: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/rh/ferias/\[id\]/bloco-documentos-lancamento.tsx app/\(app\)/rh/ferias/\[id\]/page.tsx
git commit -m "feat(ferias): bloco de documentos por folha na página do colaborador"
```

---

## Task 5: `DialogAnexarReciboContabil`

**Files:**
- Create: `app/(app)/rh/ferias/[id]/dialog-anexar-recibo-contabil.tsx`

**Interfaces:**
- Consumes: `gerarUrlUploadReciboContabil`, `anexarReciboContabilFolhaFerias` de `actions-pagamentos.ts`.
- Produces:
  ```tsx
  export function DialogAnexarReciboContabil(props: {
    aberto: boolean;
    folhaId: string;
    valorBasePreview: number | null; // salario_base atual
    rotulo: string; // "Recibo da contabilidade" ou "Recibo de abono California"
    onFechar: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Implementar o componente**

`"use client"`. Usa `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` do shadcn. `max-w-md`.

Estado:
- `arquivo: File | null`
- `valor: string` (começa com `valorBasePreview?.toFixed(2) ?? ""`)
- `pending: boolean` (via `useTransition`)
- `erro: string | null`

Campos:
- `<Label htmlFor="pdf-recibo">PDF do recibo</Label>` + `<input id="pdf-recibo" type="file" accept="application/pdf" onChange={...} />`.
- `<Label htmlFor="valor-liquido">Valor líquido (R$)</Label>` + `<Input id="valor-liquido" type="number" step="0.01" min="0.01" value={valor} onChange={...} />`.

Submit (botão primário "Anexar"):
1. Valida: arquivo + valor > 0; senão `setErro("Selecione o PDF e informe o valor líquido.")`.
2. `startTransition(async () => { ... })`.
3. `const res1 = await gerarUrlUploadReciboContabil({ folha_id: folhaId })`. Se `!ok`: `setErro(res1.message)`; return.
4. `const put = await fetch(res1.signed_url, { method: 'PUT', body: arquivo, headers: { 'Content-Type': 'application/pdf' } })`. Se `!put.ok`: `setErro("Falha ao enviar PDF ao bucket.")`; return.
5. `const res2 = await anexarReciboContabilFolhaFerias({ folha_id: folhaId, valor_liquido: Number(valor), anexo_url: res1.path })`. Se `!ok`: `setErro(res2.message)`; return.
6. `onFechar()` + `router.refresh()`.

Botão secundário "Cancelar" só fecha.

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero erros.

- [ ] **Step 3: Importar e wirear no `BlocoDocumentosLancamento`**

Editar `bloco-documentos-lancamento.tsx`: `const [folhaAnexando, setFolhaAnexando] = React.useState<FolhaMin | null>(null);`. Botão "Anexar" chama `setFolhaAnexando(folha)`. Renderiza `<DialogAnexarReciboContabil aberto={!!folhaAnexando} folhaId={folhaAnexando?.id ?? ''} ... onFechar={() => setFolhaAnexando(null)} />`.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/rh/ferias/\[id\]/dialog-anexar-recibo-contabil.tsx app/\(app\)/rh/ferias/\[id\]/bloco-documentos-lancamento.tsx
git commit -m "feat(ferias): dialog pra RH anexar recibo da contabilidade + valor líquido"
```

---

## Task 6: `DialogConfirmarEnvioFinanceiro`

**Files:**
- Create: `app/(app)/rh/ferias/[id]/dialog-confirmar-envio-financeiro.tsx`

**Interfaces:**
- Consumes: `enviarProFinanceiro` do Task 3.
- Produces:
  ```tsx
  export function DialogConfirmarEnvioFinanceiro(props: {
    aberto: boolean;
    lancamentoId: string;
    totalFolhasRascunho: number;
    valorTotal: number;
    dataPagamentoDefault: string; // "YYYY-MM-DD"
    onFechar: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Implementar o componente**

`"use client"`. `Dialog` com `max-w-md`.

Estado:
- `data: string` (começa com `dataPagamentoDefault`).
- `pending: boolean`.
- `erro: string | null`.

Render:
- Título "Enviar ao financeiro".
- Texto: `"Serão enviadas ${totalFolhasRascunho} folha(s) com valor total de R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}."`.
- `<Label htmlFor="data-pag">Data de pagamento</Label>` + `<Input id="data-pag" type="date" value={data} onChange={e => setData(e.target.value)} />`.
- Legenda `<p className="text-xs text-muted-foreground">Padrão: 2 dias antes do início das férias.</p>`.
- Rodapé: "Cancelar" + "Confirmar envio" (primário vermelho).

Submit:
1. `startTransition(async () => { const res = await enviarProFinanceiro(lancamentoId, { dataPagamento: data }); if (!res.ok) { setErro(res.message); return; } onFechar(); router.refresh(); })`.

- [ ] **Step 2: Importar e wirear no `BlocoDocumentosLancamento`**

Estado `const [confirmandoEnvio, setConfirmandoEnvio] = React.useState(false);`. Botão "Enviar ao financeiro" chama `setConfirmandoEnvio(true)` (só habilitado). Renderiza o dialog com `dataPagamentoDefault = min(folhas.map(f => f.data_pagamento_prevista).filter(Boolean))`, `valorTotal = sum(folhas.filter(status=rascunho).map(f => Number(f.salario_base)))`, `totalFolhasRascunho = folhas.filter(f => f.status === 'rascunho').length`.

- [ ] **Step 3: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero erros.

- [ ] **Step 4: Verificação manual**

Teste roteiro no `/rh/ferias/<id_da_Thais>`:
1. Ver bloco Documentos com 1 slot "Recibo da contabilidade" pendente.
2. Clicar "Anexar" → dialog → selecionar PDF + valor 7000 → confirmar. Slot passa pra ✓.
3. Botão "Enviar ao financeiro" habilita.
4. Clicar → dialog abre com data 2 dias antes.
5. Trocar pra data +5 dias → confirmar.
6. Página revalida; status do lançamento vira `enviado_financeiro`; folha(s) viram `enviada`.
7. Abrir `/financeiro/contas-a-pagar` aba People; o item aparece com a data trocada.
8. Clicar Enviar duas vezes rápido → segundo clique devolve `ok` idempotente sem erro visual (botão desabilitado durante `pending`).

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/rh/ferias/\[id\]/dialog-confirmar-envio-financeiro.tsx app/\(app\)/rh/ferias/\[id\]/bloco-documentos-lancamento.tsx
git commit -m "feat(ferias): dialog de envio ao financeiro com data editável"
```

---

## Task 7: Tooltip dinâmica em `people-list.tsx` do financeiro

**Files:**
- Modify: `app/(app)/financeiro/contas-a-pagar/people-list.tsx:517-519`

**Interfaces:**
- Consumes: nenhum novo.
- Produces: tooltip condicional.

- [ ] **Step 1: Trocar o tooltip fixo**

Em `people-list.tsx`, linha ~517. Trocar:

```ts
const tooltipBloqueado = bloqueado
  ? "Aguardando o colaborador anexar a NF."
  : null;
```

por:

```ts
const tooltipBloqueado = bloqueado
  ? item.origem === "contabilidade"
    ? "Aguardando o RH anexar o recibo da contabilidade."
    : "Aguardando o colaborador anexar a NF."
  : null;
```

(Verificar que `item.origem` existe no tipo da linha; se não, adicionar na query que alimenta `item` e ajustar o tipo em `lib/types.ts`.)

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: zero erros.

- [ ] **Step 3: Verificação manual**

Em `/financeiro/contas-a-pagar?aba=people`:
- Passar mouse num item PJ bloqueado → "Aguardando o colaborador anexar a NF."
- Passar mouse num item CLT bloqueado → "Aguardando o RH anexar o recibo da contabilidade."

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/financeiro/contas-a-pagar/people-list.tsx
git commit -m "feat(financeiro): tooltip dinâmica no bloqueio por anexo (NF vs recibo)"
```

---

## Task 8: Build final + verificação ponta-a-ponta

**Files:** nenhum.

- [ ] **Step 1: Rodar build**

Run: `npm run build`
Expected: build limpo, sem erro de type-check nem lint.

- [ ] **Step 2: Roteiro integrado**

1. Login como RH.
2. Abrir `/rh/ferias/<id_da_Thais>` → bloco Documentos aparece, botão Enviar desabilitado, hint "Aguardando RH anexar o recibo da contabilidade."
3. Anexar recibo (PDF + valor) → slot ✓, hint "Pronto pra enviar ao financeiro.", botão habilita.
4. Enviar com data custom → status muda, folha enviada.
5. Logar como financeiro → `/financeiro/contas-a-pagar?aba=people` mostra o item com data trocada, sem tooltip bloqueado.
6. Abrir um PJ bloqueado → tooltip "Aguardando o colaborador anexar a NF."

- [ ] **Step 3: Commit final só se algo foi ajustado**

(Se tudo passou sem ajuste, pular esse step.)

---

## Self-review

**Spec coverage:**

| Meta da spec | Task |
|---|---|
| 1. Bloco Documentos por lançamento | Task 4 |
| 2. DialogAnexarReciboContabil | Task 5 |
| 3. Botão "Enviar ao financeiro" | Task 4 + Task 6 |
| 4. Dialog de envio com data | Task 6 |
| 5. `enviarProFinanceiro` com gate novo + data | Task 3 |
| 6. Tooltip dinâmica em `people-list.tsx` | Task 7 |
| 7. Hint dinâmica do status aprovado | Task 2 + Task 4 |

Enviabilidade (§), cobertura:
- Função pura: Task 1.
- Backend: Task 3.
- Frontend: Task 4.

**Step scan:** cada step tem um resultado checável (teste rodado, arquivo criado, comando passa).

**Type consistency:** `FolhaMin`/`NfMin` definidos no Task 1, reusados Task 2/3/4. `dataPagamentoSchema` exportado no Task 3, consumido no Task 6 via tipo da assinatura. `DialogAnexarReciboContabil` com props completas no Task 5.

**Review Focus:** 5 focos listados no cabeçalho, cada um amarrado a um teste de task ou step de verificação manual.

**Proporção:** 8 tasks, ~400 linhas pro plan contra ~250 linhas de spec. Plan carrega os nomes exatos, arquivos a tocar, e assinaturas; o resto é código idiomático do projeto.
