# Aplicar benefícios como passo separado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurar "Aplicar benefícios" como passo explícito dentro do card PJ em `/rh/folhas/[competencia]`. A tabela da folha passa a mostrar os valores líquidos pós-desconto após a aplicação, e cada linha PJ afetada ganha um badge "Benefícios −R$ X" ao lado do valor. Avulsas continuam exclusivas do Enviar PJ.

**Architecture:** Zero mudança de schema. As RPCs `aplicar_fechamento_beneficios`, `gerar_avulsas_fechamento_beneficios` e `desaplicar_fechamento_beneficios` já estão prontas. A action `aplicarBeneficios` em `lib/actions/beneficios/fechamento.ts` já existe e continua intacta. Mudança é: (a) remover a chamada inline de `aplicar_fechamento_beneficios` dentro de `enviarFolhaPJ`; (b) card PJ ganha um botão "Aplicar benefícios" entre "Gerar PJ" e "Enviar"; (c) tabela de linhas renderiza badge quando `desconto_beneficios > 0` em origem california; (d) drawer de edição bloqueia alteração quando benefícios aplicados.

**Tech Stack:** Next.js App Router (server actions + server components), React + TypeScript, Supabase (Postgres RPC + RLS), Tailwind, shadcn/ui Dialog, lucide-react.

**Spec:** [docs/superpowers/specs/2026-11-27-aplicar-beneficios-passo-separado-design.md](../specs/2026-11-27-aplicar-beneficios-passo-separado-design.md)

## Global Constraints

- Zero mudança de schema (`folhas_pagamento`, `beneficio_fechamento_mensal`, `contas_avulsas` inalterados).
- `lib/types.ts` escrito à mão — se o shape de `ResumoCardsFolha` mudar, atualizar no mesmo commit.
- Strings pt-BR com acento em TODAS strings visíveis ao usuário (CLAUDE.md "Ortografia em português").
- Avulsas de operadora (SulAmérica + Bradesco Dental) **só são criadas no Enviar PJ**, nunca no Aplicar (ADR 174 § portão único + spec Anti-objetivo).
- Linha CLT **nunca** recebe badge de benefícios no sistema (ADR 174 "CLT já vem líquido da contabilidade").
- `tenant_id` filtra todas as queries de tabela operacional.
- Botão Enviar PJ fica **desabilitado** se benefícios não aplicados OU se catálogo incompleto. Mensagem amigável no tooltip.
- Edição de linha PJ via drawer fica **bloqueada** enquanto `beneficios.aplicado && origem='california'`. Banner no topo do drawer com link/texto pra Desaplicar.
- Reusa `aplicarBeneficios` / `desaplicarBeneficios` de `lib/actions/beneficios/fechamento.ts` (já existem, idempotentes).
- Não criar branch, trabalhar direto em main. Push é manual.
- Rodar `pnpm tsc --noEmit` + `pnpm lint` + `pnpm build` antes de encerrar qualquer task que toque TS.

## Review Focus

Entradas e falhas que o design implica e que nenhum teste automatizado exercita:

1. **Tentar Enviar PJ sem benefícios aplicados** → mensagem amigável ("Aplique os benefícios antes de enviar"), sem UPDATE em `folhas_pagamento`. Coberto na Task 1 (server action).
2. **`nenhum_vinculo_ativo` ao clicar Aplicar** → snapshot é criado vazio, card passa pro estado "aplicado" e Enviar habilita. Coberto na Task 1 (action `aplicarBeneficios` já trata) + verificação manual na Task 5.
3. **Linha CLT com `desconto_beneficios > 0` por bug de dado** → badge NÃO renderiza, console.warn emitido. Coberto na Task 3 (guard no render).
4. **Catálogo incompleto** → card mostra alerta vermelho no topo, botões Aplicar E Enviar desabilitados. Coberto na Task 2 (card refactor).
5. **Desaplicar depois que PJ já saiu de rascunho** → trava `folha_pj_ja_enviada` já existe (Task 1 da feature anterior). UI traduz a mensagem em `fechamento.ts` → `traduzErroRpc` (já existe). Coberto manualmente na Task 5.

---

## File Structure

**Novos:**
- `app/(app)/rh/folhas/_components/botao-aplicar-beneficios-pj.tsx` — botão slim que abre modal de confirmação + chama `aplicarBeneficios`. Reintroduzido com escopo focado no card PJ (o antigo `botao-aplicar-beneficios.tsx` deletado na Task 8 da feature anterior era maior e mostrava preview; aqui o preview fica no próprio card).

**Modificados:**
- `app/(app)/rh/folhas/envio-actions.ts` — remove chamada inline a `aplicar_fechamento_beneficios`; retorna erro amigável se snapshot não existe.
- `lib/queries/folhas-resumo.ts` — adiciona `colaboradoresComDesconto` (count distinct `colaborador_id` com `desconto_beneficios > 0`) no `pj`.
- `lib/types.ts` — adiciona `colaboradoresComDesconto` em `ResumoFolhaOrigem` ou subtipo PJ.
- `app/(app)/rh/folhas/_components/card-folha-pj.tsx` — refatora estados: inclui botão Aplicar quando `!beneficiosAplicado`; Enviar bloqueado até aplicar; resumo mostra líquido+bruto quando aplicado.
- `app/(app)/rh/folhas/_components/modal-enviar-folha-pj.tsx` — remove branch `!beneficiosAplicado` (sempre aplicado quando modal abre); limpa código morto.
- `app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx` — renderiza badge "⚡ −R$ X" ao lado do valor em linhas PJ com `desconto_beneficios > 0`.
- `app/(app)/rh/folhas/[competencia]/editar-linha-folha-drawer.tsx` — bloqueia edição quando `beneficios.aplicado && origem='california'`: banner no topo + campos read-only + sem botão Salvar.
- `app/(app)/rh/folhas/[competencia]/page.tsx` — passa `beneficiosAplicado` pra `<FolhaCompetenciaView>` (que passa pro drawer).

**Removidos:** nenhum.

---

## Task 1: Backend — `enviarFolhaPJ` exige snapshot + helper ganha `colaboradoresComDesconto`

**Files:**
- Modify: `app/(app)/rh/folhas/envio-actions.ts` (função `enviarFolhaPJ`)
- Modify: `lib/queries/folhas-resumo.ts`
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: `obterFechamentoVigenteDaCompetencia` (já existente); RPC `gerar_avulsas_fechamento_beneficios` (não muda).
- Produces:
  ```ts
  // lib/types.ts — campo novo no shape do pj em ResumoCardsFolha
  export interface ResumoFolhaOrigemPJ extends ResumoFolhaOrigem {
    previewDescontoBeneficios: number | null;
    previewQtdVinculos: number | null;
    colaboradoresComDesconto: number;  // NOVO: count distinct com desconto > 0
  }
  ```
  (Se já existia `pj` inline no `ResumoCardsFolha`, apenas adicionar `colaboradoresComDesconto: number` ao mesmo shape.)

- [ ] **Step 1: Ler o arquivo atual de envio-actions**

Abrir `app/(app)/rh/folhas/envio-actions.ts` e localizar `enviarFolhaPJ`. Confirmar que ela hoje:
- Busca `beneficio_fechamento_mensal` vigente.
- Se não existe, chama `supabase.rpc("aplicar_fechamento_beneficios", ...)`.
- Depois chama `gerar_avulsas_fechamento_beneficios`.
- Depois UPDATE em `folhas_pagamento`.

- [ ] **Step 2: Modificar `enviarFolhaPJ` — remover aplicação inline**

Depois de buscar `beneficio_fechamento_mensal`:
- Se `fechamento` é `null`: `return { ok: false, message: "Aplique os benefícios antes de enviar." }`.
- Se `fechamento` existe: seguir pro `gerar_avulsas_fechamento_beneficios` e UPDATE normalmente.

Remover todo o bloco que chamava `aplicar_fechamento_beneficios` com seus tratamentos de erro (`nenhum_vinculo_ativo`, `catalogo_incompleto`). Esses erros agora são responsabilidade do `aplicarBeneficios` que será chamado separadamente.

Limpar o campo `sem_beneficios` do retorno se existia. Shape final:
```ts
{ ok: true, linhas_enviadas, fechamento_id, avulsas: [...] }
```

- [ ] **Step 3: Adicionar `colaboradoresComDesconto` em `lib/types.ts`**

Localizar `ResumoFolhaOrigem` (shape do pj/clt em `ResumoCardsFolha`). Como CLT nunca tem desconto, o campo faz sentido só no PJ. Opções:
- (a) Adicionar `colaboradoresComDesconto: number` no `ResumoFolhaOrigem` (sempre 0 no CLT).
- (b) Criar um shape `ResumoFolhaOrigemPJ extends ResumoFolhaOrigem` com o campo novo e usar só no `pj`.

Escolha: **(a)** — menos tipos novos, zero impacto em call sites existentes, CLT fica sempre em 0 (consistente com a realidade).

Resultado: `ResumoFolhaOrigem` ganha mais um campo no final: `colaboradoresComDesconto: number`.

- [ ] **Step 4: Atualizar `obterResumoCardsFolha` em `lib/queries/folhas-resumo.ts`**

Dentro da função, depois da redução das linhas em `pjAcc`/`cltAcc`:

```ts
const colaboradoresPjComDesconto = new Set<string>();
for (const linha of (linhasResult.data ?? []) as Array<{ colaborador_id: string; desconto_beneficios: number; origem: string }>) {
  if (linha.origem === "california" && Number(linha.desconto_beneficios) > 0) {
    colaboradoresPjComDesconto.add(linha.colaborador_id);
  }
}
pjAcc.colaboradoresComDesconto = colaboradoresPjComDesconto.size;
cltAcc.colaboradoresComDesconto = 0;
```

Adicionar `colaborador_id` ao `.select()` da query principal. Inicializar `colaboradoresComDesconto: 0` em `origemVazia()`.

- [ ] **Step 5: tsc + lint**

Esperado: zero erro.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/rh/folhas/envio-actions.ts lib/queries/folhas-resumo.ts lib/types.ts
git commit -m "feat(rh/folhas): enviarFolhaPJ exige snapshot pronto + helper conta colaboradores com desconto"
```

---

## Task 2: `botao-aplicar-beneficios-pj.tsx` + refatorar `CardFolhaPJ`

**Files:**
- Create: `app/(app)/rh/folhas/_components/botao-aplicar-beneficios-pj.tsx`
- Modify: `app/(app)/rh/folhas/_components/card-folha-pj.tsx`

**Interfaces:**
- Consumes: `aplicarBeneficios` de `@/lib/actions/beneficios/fechamento` (já existe); `ResumoCardsFolha["pj"]` + `beneficios` de Task 1 (já com `colaboradoresComDesconto`).
- Produces:
  ```ts
  // botao-aplicar-beneficios-pj.tsx
  export interface BotaoAplicarBeneficiosPJProps {
    ano: number;
    mes: number;
    previewDescontoBeneficios: number | null;
    previewQtdVinculos: number | null;
    disabled?: boolean;
  }
  export function BotaoAplicarBeneficiosPJ(props: BotaoAplicarBeneficiosPJProps): JSX.Element;
  ```

- [ ] **Step 1: Criar `botao-aplicar-beneficios-pj.tsx`**

`"use client";`. Botão primário (`bg-california-red rounded-lg ...`) com rótulo "Aplicar benefícios". Ao clicar:

- Abre `confirm()` nativo (padrão do projeto pra ações destrutivas rápidas; o Aplicar é reversível via Desaplicar, então `confirm()` basta — modal rico fica no futuro se virar demanda):
  > "Aplicar benefícios de {mes}/{ano}?\n\nIsso vai descontar R$ {brl(previewDescontoBeneficios)} do salário de {previewQtdVinculos} colaboradores PJ. A tabela abaixo mostrará os valores pós-desconto.\n\nSe precisar corrigir, você pode Desaplicar enquanto a folha ainda não foi enviada."
- Se `preview` é `null` ou `previewQtdVinculos === 0`, usa texto alternativo:
  > "Aplicar benefícios de {mes}/{ano}?\n\nNenhum vínculo ativo nesta competência — o snapshot será criado vazio e você poderá enviar normalmente."
- Se usuário confirma: `startTransition(async () => { const r = await aplicarBeneficios({ ano, mes }); if (!r.ok) { setErro(r.message); return; } router.refresh(); });`
- `Loader2` durante pending, erro em bloco vermelho abaixo do botão (ou simplesmente alert()? Prefira state local pra manter padrão).

Estado de erro: `useState<string | null>(null)`. Renderizar bloco de erro ao lado do botão quando setado.

- [ ] **Step 2: Refatorar `card-folha-pj.tsx` — 4 estados explícitos**

Os 4 estados, baseados em `temLinhasPJ`, `beneficiosAplicado`, `tudoEnviado`:

**Estado 1 — Não gerado** (`!temLinhasPJ`): CTA grande `<BotaoGerarFolhaPj>`. Igual hoje.

**Estado 2 — Gerado, benefícios não aplicados** (`temLinhasPJ && !beneficiosAplicado && !tudoEnviado`):
- Resumo:
  ```
  {totalLinhas} linhas · {brl(totalBruto)} bruto
  Benefícios previstos: −{brl(preview)} ({previewQtd} vínculos)
  ```
  Se `previewDescontoBeneficios === null` (erro no preview): omitir a segunda linha.
  Se `previewQtdVinculos === 0`: segunda linha vira "Nenhum vínculo ativo — benefícios aplicados sem efeito."
- Status pills.
- Rodapé: `[Atualizar PJ]` `[Aplicar benefícios]` (primário).
- `[Enviar PJ ao financeiro →]` **desabilitado** com tooltip "Aplique os benefícios antes de enviar."

**Estado 3 — Gerado, benefícios aplicados** (`temLinhasPJ && beneficiosAplicado && !tudoEnviado`):
- Resumo:
  ```
  {totalLinhas} linhas · {brl(totalBruto)} bruto
  − {brl(totalDescontoBeneficios)} benefícios = {brl(totalLiquido)} líquido
  ```
  Linha extra em verde: `"✓ Benefícios aplicados · {colaboradoresComDesconto} colaboradores com desconto"`.
- Status pills.
- Rodapé: `[Atualizar PJ]` `[Desaplicar benefícios]` (secundário/link discreto, reusa `<BotaoDesaplicarBeneficios>`) `[Enviar PJ ao financeiro →]` (primário, **habilitado**).

**Estado 4 — Pós-envio** (`tudoEnviado`): igual hoje (badge verde "✓ Enviada").

- [ ] **Step 3: Alerta de catálogo incompleto**

Mantém como está hoje — banner vermelho no topo quando `catalogoIncompleto != null`, desabilita Aplicar E Enviar (atualmente desabilita só Enviar; agora cobre Aplicar também). Checar `disabled` no `BotaoAplicarBeneficiosPJ`.

- [ ] **Step 4: Props do `CardFolhaPJ` — nenhuma mudança externa**

A shape dos props de `CardFolhaPJ` continua idêntica (consome `pj`, `beneficios`, `catalogoIncompleto`, `ano`, `mes`, `podeEditar`). O card consome o novo campo `pj.colaboradoresComDesconto` (adicionado na Task 1).

- [ ] **Step 5: `BotaoAplicarBeneficiosPJ` recebe `previewDescontoBeneficios` + `previewQtdVinculos`**

Esses valores já vêm no `pj` (`previewDescontoBeneficios`, `previewQtdVinculos`), passar pro componente novo no estado 2.

- [ ] **Step 6: tsc + lint**

- [ ] **Step 7: Commit**

```bash
git add app/(app)/rh/folhas/_components/botao-aplicar-beneficios-pj.tsx \
        app/(app)/rh/folhas/_components/card-folha-pj.tsx
git commit -m "feat(rh/folhas): botao Aplicar beneficios no card PJ e 4 estados explicitos"
```

---

## Task 3: Badge "Benefícios −R$ X" na tabela de linhas

**Files:**
- Modify: `app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx`

**Interfaces:**
- Consumes: `FolhaLinha` (já tem `desconto_beneficios: string` e `origem: FolhaOrigem`).
- Produces: nenhum novo tipo externo.

- [ ] **Step 1: Localizar a renderização da coluna "Valor" em `folha-competencia-view.tsx`**

Procurar o `<td>` ou célula que renderiza `salario_base`. Tipicamente envolve `brl.format(Number(l.salario_base))` dentro de um `<td className="text-right">` ou similar.

- [ ] **Step 2: Adicionar badge ao lado do valor**

Depois do número do valor, renderizar condicionalmente:

```tsx
{l.origem === "california" && Number(l.desconto_beneficios) > 0 && (
  <span
    title="Benefícios aplicados nesta competência"
    className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800"
  >
    <Shield className="h-3 w-3" aria-hidden />
    −{brl.format(Number(l.desconto_beneficios))}
  </span>
)}
```

Importar `Shield` de `lucide-react` se ainda não estiver.

- [ ] **Step 3: Guard contra linha CLT com desconto por bug de dado**

Se `origem === "contabilidade" && Number(l.desconto_beneficios) > 0`: `console.warn("[folha-view] linha CLT com desconto_beneficios > 0 — não esperado", { id: l.id, desconto: l.desconto_beneficios })`. NÃO renderizar badge. (CLT não deve ter desconto no sistema.)

Pode adicionar o warn num `useEffect` ou dentro do próprio map; o importante é que o render ignora.

- [ ] **Step 4: tsc + lint**

- [ ] **Step 5: Commit**

```bash
git add app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx
git commit -m "feat(rh/folhas): badge de beneficios ao lado do valor em linhas PJ descontadas"
```

---

## Task 4: Drawer de edição bloqueia quando benefícios aplicados

**Files:**
- Modify: `app/(app)/rh/folhas/[competencia]/editar-linha-folha-drawer.tsx`
- Modify: `app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx` (passa a prop pro drawer)
- Modify: `app/(app)/rh/folhas/[competencia]/page.tsx` (passa `beneficiosAplicado` pra view)

**Interfaces:**
- Consumes: `beneficios.aplicado` de `ResumoCardsFolha` (já existente).
- Produces: nenhum tipo novo. Os components ganham props `beneficiosAplicado: boolean`.

- [ ] **Step 1: Prop na `FolhaCompetenciaView` + `EditarLinhaFolhaDrawer`**

Adicionar `beneficiosAplicado: boolean` ao tipo de props de `FolhaCompetenciaView` e passar adiante ao `EditarLinhaFolhaDrawer`.

- [ ] **Step 2: Em `editar-linha-folha-drawer.tsx`, computar `edicaoBloqueada`**

```ts
const edicaoBloqueada =
  props.beneficiosAplicado && props.linha.origem === "california";
```

- [ ] **Step 3: Renderizar banner quando bloqueada**

No topo do corpo do drawer, antes dos campos:

```tsx
{edicaoBloqueada && (
  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
    <span>
      Benefícios aplicados nesta competência. Para editar valores PJ,
      desaplique benefícios no card da folha PJ primeiro.
    </span>
  </div>
)}
```

- [ ] **Step 4: Tornar campos read-only + ocultar Salvar**

Quando `edicaoBloqueada`:
- Campo `salario_base` renderizado com `readOnly` (ou `disabled`) e sem handler de onChange.
- Mesma lógica pra `MoedaInput` se for custom — passa `readOnly` ou troca por display-only.
- Alocações continuam visíveis mas também read-only (mesmo princípio).
- Botão "Salvar" NÃO renderizado (ou renderizado com `disabled`); botão "Cancelar" vira "Fechar".

- [ ] **Step 5: `page.tsx` passa `beneficiosAplicado` pra view**

```tsx
<FolhaCompetenciaView
  linhas={linhas}
  ...
  beneficiosAplicado={resumo.beneficios.aplicado}
/>
```

- [ ] **Step 6: tsc + lint + build**

- [ ] **Step 7: Commit**

```bash
git add app/(app)/rh/folhas/[competencia]/editar-linha-folha-drawer.tsx \
        app/(app)/rh/folhas/[competencia]/folha-competencia-view.tsx \
        app/(app)/rh/folhas/[competencia]/page.tsx
git commit -m "feat(rh/folhas): drawer bloqueia edicao de linha PJ quando beneficios aplicados"
```

---

## Task 5: Modal Enviar simplificado + smoke test

**Files:**
- Modify: `app/(app)/rh/folhas/_components/modal-enviar-folha-pj.tsx`

**Interfaces:**
- Consumes: nada novo.
- Produces: shape de props do modal simplificado (remove `beneficiosAplicado`, sempre assume aplicado quando o botão de abrir fica habilitado).

- [ ] **Step 1: Remover o prop `beneficiosAplicado` e os branches associados**

Hoje o modal tem lógica condicional:
- `beneficiosAplicado === true`: corpo simples.
- `beneficiosAplicado === false`: fetch de `previsualizarAplicacao`, estados de preview, erro, etc.

Como o botão Enviar PJ no card só fica habilitado quando `beneficiosAplicado`, o modal pode assumir `true` sempre. Remover o branch `!beneficiosAplicado`:
- Remove `useEffect` que chama `previsualizarAplicacao`.
- Remove states `erroPreview`, `preview`, `carregandoPreview`, `erroBloqueia`.
- Mantém só o fluxo simples: mensagem clara ("Vai enviar N linhas PJ + gerar avulsa SulAmérica + Bradesco") e botão Enviar.

Opcionalmente, mostrar avulsas que vão ser criadas (informativo) — se for simples, mantém; se der trabalho, corte pra MVP.

- [ ] **Step 2: Simplificar o shape da prop**

```ts
export interface ModalEnviarFolhaPJProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ano: number;
  mes: number;
  linhasRascunho: number;
  linhasPendenteCorrecao: number;
  onEnviado?: (linhasEnviadas: number) => void;
}
```

(Remove `beneficiosAplicado` da prop; ninguém mais precisa dela.)

Atualizar call site em `card-folha-pj.tsx` pra não passar mais essa prop.

- [ ] **Step 3: tsc + lint + build**

- [ ] **Step 4: Smoke test no browser**

```bash
pnpm dev
```

Em `http://localhost:3000/rh/folhas/2026-11`:

1. Com snapshot não aplicado: card PJ mostra estado 2. Botão Aplicar visível, Enviar desabilitado com tooltip. Badge na tabela: ausente.
2. Clicar Aplicar → `confirm()` nativo mostra os valores do preview → confirmar → refresh → card vira estado 3 ("✓ Benefícios aplicados · K colaboradores"). Enviar habilitado.
3. Tabela: valores da coluna "Valor" mudaram pro líquido. Linhas PJ com desconto > 0 mostram badge "⚡ −R$ 220" ao lado do valor. Linhas CLT: sem badge.
4. Clicar numa linha PJ → drawer abre com banner âmbar, campos read-only, sem Salvar. Botão "Fechar" presente.
5. Clicar numa linha CLT (se houver): drawer edita normal (CLT não é afetado).
6. Clicar Desaplicar → RPC roda → tabela volta pros valores brutos → badges somem → card volta pro estado 2.
7. Tentar Enviar sem Aplicar → ação server devolve mensagem "Aplique os benefícios antes de enviar." (não deve ser possível pela UI porque o botão fica disabled, mas vale validar via DevTools se possível — não é obrigatório).
8. Aplicar → Enviar → modal confirma → `/financeiro/contas-a-pagar` tem 2 avulsas novas; linhas PJ viram `enviada`.
9. Depois do envio: Desaplicar → mensagem "Não dá pra desaplicar: folha PJ já foi enviada..." (tradução do `folha_pj_ja_enviada`).

- [ ] **Step 5: Commit**

```bash
git add app/(app)/rh/folhas/_components/modal-enviar-folha-pj.tsx \
        app/(app)/rh/folhas/_components/card-folha-pj.tsx
git commit -m "chore(rh/folhas): modal Enviar PJ sem branch de beneficios nao aplicado"
```

---

## Verificação final (após Task 5)

- [ ] `pnpm tsc --noEmit` limpo.
- [ ] `pnpm lint` limpo.
- [ ] `pnpm build` limpo.
- [ ] Smoke test completo rodado (Task 5 Step 4).
- [ ] `/financeiro/contas-a-pagar` mostra avulsas da operadora **só depois** de Enviar PJ (nunca depois de só Aplicar).
- [ ] Nenhum call site faltando atualizar: grep final por `beneficiosAplicado` em `_components/` deve achar só o CardFolhaPJ (passando pro BotaoAplicar/Desaplicar indiretamente).
