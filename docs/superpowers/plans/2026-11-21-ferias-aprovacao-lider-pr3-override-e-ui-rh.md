# Férias — aprovação em duas etapas (PR 3: override do RH + UI dedicada + docs)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o fluxo líder→RH dando ao RH como destravar quando o líder não aprova e UI dedicada em `/rh/ferias` pra ver/separar a fila `aguardando_gestor`, com timeline mostrando quem aprovou cada etapa. Também atualizar a doc operacional e criar um ADR.

**Architecture:** Server action nova `aprovarLancamentoOverrideRh` espelha o guard de `aprovarLancamento` existente mas aceita `aguardando_gestor` como estado de entrada, grava `aprovacao_lider_override = true` + `motivo_override_lider` (opcional), e dispara o mesmo `calcularValoresLancamentoAuto` + `criarFolhasDePagamentoDeFerias` do fluxo normal (via helper interno extraído). Tabela e modal do RH ganham entendimento do novo estado: chip "Aguardando líder" na barra de filtros, badge no card do modal, e botão discreto "Aprovar no lugar do líder" com confirmação. Timeline do `[id]/page.tsx` desenha etapa 1 (líder) + etapa 2 (RH) consumindo os campos `aprovado_pelo_lider_*` e `aprovado_*`.

**Tech Stack:** Next.js App Router (server actions + server components), Supabase Postgres (`UPDATE` com policy existente — sem migration nova), React Hook Form não requerido (dialog simples), `node:test` + `node:assert/strict` pros schemas Zod.

**Spec:** `docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md`

## Global Constraints

- **Nenhuma migration SQL neste PR.** A policy de UPDATE pro líder (PR 2) não cobre o RH fazendo override — mas o RH já tem UPDATE pleno via `ferias_lancamentos_update` existente (admin/rh). Confirmar no self-review.
- **pt-BR** em toda string visível: acentos, cedilha, til.
- **Motivo do override:** **opcional** (decidido 21/11). Schema aceita omitido ou string vazia; grava NULL. Decidido 21/11 que a trilha do audit (quem + quando) basta.
- **Reuso do fluxo de folhas:** o override tem que disparar o mesmo cálculo + criação de folhas que `aprovarLancamento` faz. **Não copiar a lógica** — extrair em helper e chamar dos dois lados. Hoje a lógica mora em `app/(app)/rh/ferias/actions.ts:139-290` (aprox).
- **Audit:** novo evento `ferias.lancamento.override_lider_rh` (padrão `ferias.lancamento.*` confirmado no PR 2) com `metadata.lider_esperado_id` e `metadata.motivo` quando preenchido.
- **UI consistente:** chip novo "Aguardando líder" cor amber, mesmo padrão de `FILTROS` existente. Badge no modal: mesma classe dos outros status.
- **ADR vai pra `docs/decisions/267-ferias-aprovacao-em-duas-etapas.md`** (próximo número após 266).
- **Doc operacional:** `docs/modulos/rh/25-ferias.md` — atualizar a seção de fluxo pra incluir etapa do líder + override, SEM mencionar nomes reais (regra PII).
- **Lançar direto do RH** continua pulando as duas etapas, como hoje. Nenhuma mudança.

## Review Focus

Cinco entradas/falhas que os testes das tasks não cobrem sozinhos:

1. **Override com motivo só em espaços (`"   "`)** — schema deve normalizar via `trim()` e gravar NULL (motivo opcional, trim pode ficar vazio). Teste adicionado na Task 1.
2. **Override com motivo acima do limite (501 chars)** — schema deve rejeitar com erro claro. Teste adicionado na Task 1.
3. **RH clica override de um lançamento que já virou `pendente_aprovacao` entre render e clique** — action deve detectar status errado e retornar mensagem útil, sem crashar. Teste adicionado na Task 1.
4. **Timeline com `aprovacao_lider_override = true` e `aprovado_pelo_lider_por` diferente de NULL** — cenário impossível em teoria (override marca true e NÃO preenche `aprovado_pelo_lider_por`, ou vice-versa), mas se acontecer, a UI deve mostrar as duas linhas (inconsistência registrada), não crashar. Teste visual na Task 4.
5. **Chip "Aguardando líder" com contagem 0** — o chip aparece ou some? Decisão: aparece sempre, badge "0" vira texto cinza; evita o chip "piscar" na navegação. Teste visual na Task 2.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `lib/ferias/override-lider-rh-schema.ts` | criar | Zod schema do input do override (uuid + motivo opcional). |
| `lib/ferias/override-lider-rh-schema.test.ts` | criar | Testes do schema (5 casos). |
| `lib/ferias/aprovar-ferias-fluxo-financeiro.ts` | criar | Helper interno: dado um lançamento aprovado, roda o cálculo + cria folhas. Extrai a lógica compartilhada entre `aprovarLancamento` e `aprovarLancamentoOverrideRh`. |
| `app/(app)/rh/ferias/actions.ts` | editar | Adicionar `aprovarLancamentoOverrideRh`; refatorar `aprovarLancamento` pra usar o helper novo. |
| `app/(app)/rh/ferias/solicitacoes-tabela-cliente.tsx` | editar | Adicionar chip "Aguardando líder" na barra de filtros; ajustar ordem (vai acima de "Pendentes"). |
| `app/(app)/rh/ferias/aba-fluxo.tsx` | editar | Atualizar o `select()` da query pra trazer `aprovado_pelo_lider_por`, `aprovado_pelo_lider_em`, `aprovacao_lider_override`, `motivo_override_lider`. Passar pra `SolicitacoesTabelaCliente` via `SolicitacaoRow`. |
| `app/(app)/rh/ferias/modal-detalhe-solicitacao.tsx` | editar | Mostrar badge "Aguardando líder" quando status for `aguardando_gestor`; adicionar botão "Aprovar no lugar do líder" com modal de confirmação + textarea opcional pro motivo. |
| `app/(app)/rh/ferias/[id]/page.tsx` | editar | Timeline ganha linha "Aprovado pelo líder [profile.nome] em DD/MM/YYYY" quando `aprovado_pelo_lider_por` existe; linha "RH aprovou no lugar do líder" quando `aprovacao_lider_override`; já existente "Aprovado pelo RH" continua. |
| `lib/auth/audit.ts` | editar | Adicionar `ferias.lancamento.override_lider_rh` ao enum `AuditAction`. |
| `docs/modulos/rh/25-ferias.md` | editar | Atualizar a seção de fluxo com etapa 1 (líder) + override. |
| `docs/decisions/267-ferias-aprovacao-em-duas-etapas.md` | criar | ADR com contexto, decisão, consequências, alternativas consideradas. |

---

### Task 1: Schema do override + server action `aprovarLancamentoOverrideRh` + helper de folhas

**Files:**
- Create: `lib/ferias/override-lider-rh-schema.ts`
- Create: `lib/ferias/override-lider-rh-schema.test.ts`
- Create: `lib/ferias/aprovar-ferias-fluxo-financeiro.ts`
- Modify: `app/(app)/rh/ferias/actions.ts` (refatora `aprovarLancamento`, adiciona `aprovarLancamentoOverrideRh`)
- Modify: `lib/auth/audit.ts` (novo evento)

**Interfaces:**
- Produces:
  - `overrideLiderRhSchema` (Zod): `{ lancamentoId: string.uuid, motivo?: string }`. Motivo passa por `.transform(s => s?.trim() ?? "")` e se vazio vira `null` no retorno parseado. Saída tipada: `{ lancamentoId: string; motivo: string | null }`.
  - `calcularEMontarFolhasAposAprovacao(args: { lancamento, colaboradorId, actorUserId }): Promise<{ aviso?: string }>` em `lib/ferias/aprovar-ferias-fluxo-financeiro.ts`. Faz o `calcularValoresLancamentoAuto` + `criarFolhasDePagamentoDeFerias` que hoje está dentro de `aprovarLancamento`. Retorna aviso quando falhou gerar folhas (mesma mensagem usada hoje).
  - `aprovarLancamentoOverrideRh(input: unknown): Promise<ActionResult>` em `actions.ts`. Guard: `assertRh`; status atual precisa ser `aguardando_gestor`; UPDATE grava `status: 'aprovado'`, `aprovacao_lider_override: true`, `motivo_override_lider: motivo`, `aprovado_por`, `aprovado_em`, campos de valor calculados. Chama `calcularEMontarFolhasAposAprovacao`. `audit` com `ferias.lancamento.override_lider_rh` + `metadata.motivo`.
  - `aprovarLancamento` (refatorado): guard idêntico ao atual, mantém `status === 'pendente_aprovacao'` como entrada. Delega a lógica de cálculo + folhas pro helper novo.

- [ ] **Step 1: Escrever os testes do schema**

Em `lib/ferias/override-lider-rh-schema.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { overrideLiderRhSchema } from "./override-lider-rh-schema";

test("uuid válido + sem motivo → sucesso, motivo=null", () => {
  const r = overrideLiderRhSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.motivo, null);
});

test("uuid inválido → fail", () => {
  const r = overrideLiderRhSchema.safeParse({ lancamentoId: "nao-uuid" });
  assert.equal(r.success, false);
});

test("motivo só de espaços → sucesso com motivo=null", () => {
  const r = overrideLiderRhSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "   ",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.motivo, null);
});

test("motivo com texto → sucesso com motivo trimado", () => {
  const r = overrideLiderRhSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "  líder viajou ",
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.motivo, "líder viajou");
});

test("motivo com 501 chars → fail", () => {
  const r = overrideLiderRhSchema.safeParse({
    lancamentoId: "11111111-1111-1111-1111-111111111111",
    motivo: "a".repeat(501),
  });
  assert.equal(r.success, false);
});
```

- [ ] **Step 2: Rodar — RED**

Run: `npx tsx --test lib/ferias/override-lider-rh-schema.test.ts`
Expected: FAIL (schema não existe).

- [ ] **Step 3: Implementar `overrideLiderRhSchema` em `lib/ferias/override-lider-rh-schema.ts`**

Usar Zod. O motivo passa por `.optional()` → `.transform(s => (s ?? "").trim())` → se vazio após trim, mapear pra `null`; se > 500 chars, falhar. Dica: usar `z.preprocess` ou combinar `.transform()` + `.refine()`.

- [ ] **Step 4: Rodar — GREEN**

Expected: 5 passes.

- [ ] **Step 5: Extrair helper `calcularEMontarFolhasAposAprovacao`**

Ler `app/(app)/rh/ferias/actions.ts:139-290` e mover a parte que: (a) busca `tipo_contratacao`, (b) chama `calcularValoresLancamentoAuto`, (c) constrói `updatePayload` com valores, (d) chama `criarFolhasDePagamentoDeFerias`. Como o helper roda APÓS o UPDATE do status principal, decompor em: função 1 calcula valores e retorna o payload parcial; função 2 cria folhas pós-UPDATE. Deixa a ordem explícita.

Assinatura proposta (implementador refina):

```ts
export async function calcularValoresParaAprovar(args: {
  colaboradorId: string;
  dataInicio: string;
  tipo: FeriasLancamentoTipo;
  dias: number;
  diasAbono: number;
}): Promise<ValoresCalculados | null>;

export async function dispararFolhasPagamento(args: {
  lancamento: ...; // shape do lanc depois do update
  colaboradorId: string;
  actorUserId: string;
}): Promise<{ aviso?: string }>;
```

- [ ] **Step 6: Refatorar `aprovarLancamento` pra usar o helper**

Deve se comportar igual ao antes (teste manual: aprovar uma solicitação `pendente_aprovacao` como RH).

- [ ] **Step 7: Adicionar `aprovarLancamentoOverrideRh` em `actions.ts`**

Guard: `assertRh`. Carregar lançamento e confirmar status `aguardando_gestor` (não `pendente_aprovacao`). Calcular valores (chama helper). UPDATE grava:
```ts
{
  status: "aprovado",
  aprovacao_lider_override: true,
  motivo_override_lider: parsed.data.motivo, // null se vazio
  aprovado_por: session.profile.id,
  aprovado_em: new Date().toISOString(),
  ...valoresCalculados,
}
```
Chamar `dispararFolhasPagamento`. Audit: `ferias.lancamento.override_lider_rh` com `metadata.motivo` + `metadata.lider_esperado_id` (vem de `colaboradores.lider_id`, buscar antes).

- [ ] **Step 8: Adicionar evento de audit em `lib/auth/audit.ts`**

Inserir `| "ferias.lancamento.override_lider_rh"` ao enum `AuditAction`, junto dos outros `ferias.lancamento.*`.

- [ ] **Step 9: `tsc --noEmit` + suite**

Expected: 0 erros; 5 testes do schema + 48 testes existentes = 53 total.

- [ ] **Step 10: Commit**

```bash
git add lib/ferias/override-lider-rh-schema.ts lib/ferias/override-lider-rh-schema.test.ts lib/ferias/aprovar-ferias-fluxo-financeiro.ts "app/(app)/rh/ferias/actions.ts" lib/auth/audit.ts
git commit -m "feat(rh/ferias): action aprovarLancamentoOverrideRh + extracao do fluxo de folhas"
```

---

### Task 2: Chip "Aguardando líder" na tabela de solicitações

**Files:**
- Modify: `app/(app)/rh/ferias/solicitacoes-tabela-cliente.tsx` (adicionar filtro novo)
- Modify: `app/(app)/rh/ferias/aba-fluxo.tsx` (query + `SolicitacaoRow` ganha `aprovado_pelo_lider_por`, `aprovado_pelo_lider_em`, `aprovacao_lider_override`, `motivo_override_lider`)

**Interfaces:**
- Produces: tabela tem um chip adicional `aguardando_gestor` (label "Aguardando líder") no array `FILTROS`, posicionado **antes** de "Pendentes". Chip sempre visível, mesmo com contagem 0. Contagem calculada no `useMemo` igual aos outros.
- `SolicitacaoRow` agora carrega os 4 campos de rastro do líder.

- [ ] **Step 1: Atualizar `SolicitacaoRow` em `aba-fluxo.tsx` (type + query)**

Adicionar aos campos do tipo e ao `select()`:
```
aprovado_pelo_lider_por, aprovado_pelo_lider_em, aprovacao_lider_override, motivo_override_lider
```

- [ ] **Step 2: Adicionar filtro `aguardando_gestor` em `solicitacoes-tabela-cliente.tsx`**

No array `FILTROS`, inserir **antes** do `pendente_aprovacao`:
```ts
{
  key: "aguardando_gestor",
  label: "Aguardando líder",
  cor: "bg-amber-100 text-amber-900",
},
```

Adicionar `aguardando_gestor: 0` ao `m` do `useMemo` de contagens; adicionar o `case` no sort `ORDEM_STATUS` (valor 0, acima de `pendente_aprovacao: 1`).

- [ ] **Step 3: Rodar `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 4: Teste visual manual**

Logar como RH, abrir `/rh/ferias/solicitacoes`: chip "Aguardando líder" aparece. Com 1+ lançamento em `aguardando_gestor` (vindo do fluxo do PR 2), o badge mostra contagem. Clicar filtra só esses.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/rh/ferias/solicitacoes-tabela-cliente.tsx" "app/(app)/rh/ferias/aba-fluxo.tsx"
git commit -m "feat(rh/ferias): chip 'Aguardando lider' na tabela de solicitacoes"
```

---

### Task 3: Modal de detalhe — botão "Aprovar no lugar do líder"

**Files:**
- Modify: `app/(app)/rh/ferias/modal-detalhe-solicitacao.tsx`

**Interfaces:**
- Consumes: `aprovarLancamentoOverrideRh` (Task 1), `SolicitacaoRow` com campos novos (Task 2).
- Produces: quando `row.status === 'aguardando_gestor'`:
  - Badge grande no header do modal com "Aguardando líder" (cor amber).
  - Hint curto: "Essa solicitação aguarda a aprovação do líder direto."
  - Botões visíveis: "Aprovar no lugar do líder" (`variant="outline"`, tom neutro, abre dialog com textarea opcional) + "Reprovar" (reusa o fluxo atual de `reprovarLancamento`). **Sem** botão "Aprovar" direto — porque esse estado nunca foi pela aprovação do líder; se o RH quiser aprovar, é override.

- [ ] **Step 1: Ler o render atual pra achar o ponto do CTA**

Ler [modal-detalhe-solicitacao.tsx](app/(app)/rh/ferias/modal-detalhe-solicitacao.tsx) na região dos botões (procurar por "Aprovar"); identificar o bloco que condiciona por `row.status === 'pendente_aprovacao'`.

- [ ] **Step 2: Adicionar branch pra `aguardando_gestor`**

Condicional:
- `row.status === 'pendente_aprovacao'` → fluxo atual intacto.
- `row.status === 'aguardando_gestor'` → novo branch com os botões descritos em Interfaces. O dialog de override reusa o padrão do `/equipe/card-pendente-aprovacao.tsx` (já aprovado no PR 2) — textarea sem `required`, com `maxLength={500}`.

- [ ] **Step 3: Handler `handleOverride`**

Dentro do componente:
```ts
async function handleOverride() {
  setErro(null);
  const res = await aprovarLancamentoOverrideRh({
    lancamentoId: row.id,
    motivo: motivoOverride, // string, pode ser vazia
  });
  if (!res.ok) { setErro(res.message); return; }
  onSucesso();
}
```

- [ ] **Step 4: Import da action**

Adicionar `aprovarLancamentoOverrideRh` ao import de `./actions`.

- [ ] **Step 5: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 6: Teste manual**

RH abre modal de uma solicitação `aguardando_gestor`:
- Vê badge "Aguardando líder".
- Clicar "Aprovar no lugar do líder" sem motivo → funciona, lançamento vai pra `aprovado` com `aprovacao_lider_override=true`, folhas criadas.
- Clicar com motivo → mesmo, motivo gravado.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/rh/ferias/modal-detalhe-solicitacao.tsx"
git commit -m "feat(rh/ferias): botao 'Aprovar no lugar do lider' no modal de detalhe"
```

---

### Task 4: Timeline do `[id]/page.tsx` com rastros de aprovação em duas etapas

**Files:**
- Modify: `app/(app)/rh/ferias/[id]/page.tsx`

**Interfaces:**
- Consumes: campos `aprovado_pelo_lider_por`, `aprovado_pelo_lider_em`, `aprovacao_lider_override`, `motivo_override_lider`, `aprovado_por`, `aprovado_em` do lançamento + join em `profiles` pros nomes.

- [ ] **Step 1: Carregar nomes dos aprovadores**

Na query do lançamento, adicionar:
```ts
.select("..., aprovado_pelo_lider_por, aprovado_pelo_lider_em, aprovacao_lider_override, motivo_override_lider, ...")
```
Depois, um segundo query (ou join):
```ts
const ids = [l.aprovado_por, l.aprovado_pelo_lider_por].filter(Boolean);
const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", ids);
```

- [ ] **Step 2: Renderizar as linhas na timeline**

Depois da linha "Solicitado em" (existente), inserir estas linhas quando aplicável:

1. **Etapa 1 — Aprovação do líder:**
   - Se `aprovado_pelo_lider_por` e NÃO `aprovacao_lider_override`: "Aprovado pelo líder **[nome]** em DD/MM/YYYY HH:mm".
   - Se `aprovacao_lider_override`: "RH aprovou no lugar do líder em DD/MM/YYYY HH:mm" + se `motivo_override_lider` não null, " — motivo: _[texto]_" numa linha abaixo.
   - Se nenhum dos dois: nada (o lançamento ainda não passou pela etapa 1 ou foi aprovado por RH-direto / pré-fluxo).

2. **Etapa 2 — Aprovação do RH:** linha atual já existe se `aprovado_por` tem valor. Mantido.

- [ ] **Step 3: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 4: Teste visual**

Abrir `/rh/ferias/[id]` pra 3 casos:
- Lançamento aprovado via fluxo normal (líder → RH): 2 linhas de aprovação.
- Lançamento aprovado via override: 1 linha "RH no lugar do líder" + 1 linha "Aprovado pelo RH" (que é o mesmo UPDATE, o audit separa).
- Lançamento `aguardando_gestor` ainda sem aprovação: nenhuma linha.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/rh/ferias/[id]/page.tsx"
git commit -m "feat(rh/ferias): timeline com rastros de aprovacao lider e override"
```

---

### Task 5: Atualizar `docs/modulos/rh/25-ferias.md`

**Files:**
- Modify: `docs/modulos/rh/25-ferias.md`

**Interfaces:**
- Documenta o fluxo em duas etapas: quem aprova, em que ordem, o que é o override, o fallback sem líder.

- [ ] **Step 1: Ler a seção atual de fluxo**

Buscar a seção que descreve "fluxo de solicitação" ou "aprovação" (provavelmente perto do início). Entender o shape do documento e onde inserir.

- [ ] **Step 2: Reescrever ou inserir subseção "Aprovação em duas etapas"**

Conteúdo (seguir estilo do resto do arquivo — sem nomes reais; só regras):

- Fluxo normal: Colaborador solicita → `aguardando_gestor` → líder direto aprova via `/equipe` → `pendente_aprovacao` → RH aprova via `/rh/ferias` → `aprovado` → folhas criadas.
- Sem líder: Cai direto em `pendente_aprovacao` (pula etapa 1). Base dos sem-líder é preenchida pelo RH gradualmente.
- Override: Se o líder não aprovar em tempo útil, o RH assume via botão "Aprovar no lugar do líder" no modal de detalhe. Grava `aprovacao_lider_override = true` + motivo opcional + audit `ferias.lancamento.override_lider_rh`.
- Timeline do colaborador: 2 linhas visíveis (etapa 1 + etapa 2) ou 1 linha de override.
- Reprovação pelo líder: termina o fluxo com status `reprovado` + motivo. Colaborador abre nova solicitação; não há "reenviar".
- "Lançar direto" do RH: segue pulando as duas etapas — `lancado_direto_por_rh = true` entra como `aprovado`.

- [ ] **Step 3: Commit**

```bash
git add docs/modulos/rh/25-ferias.md
git commit -m "docs(rh/ferias): aprovacao em duas etapas (lider -> RH) + override do RH"
```

---

### Task 6: Criar ADR `docs/decisions/267-ferias-aprovacao-em-duas-etapas.md`

**Files:**
- Create: `docs/decisions/267-ferias-aprovacao-em-duas-etapas.md`

**Interfaces:**
- ADR com: contexto, decisão, alternativas consideradas, consequências. Sem nomes reais.

- [ ] **Step 1: Ler um ADR recente pra conferir o estilo**

`docs/decisions/265-mais-faturamento-um-formulario-so.md` ou `266-job-de-pagamentos.md`.

- [ ] **Step 2: Escrever o ADR**

Estrutura sugerida (seguir o estilo encontrado):

```markdown
# 267 — Férias: aprovação em duas etapas (líder, depois RH)

Data: 2026-11-21.

## Contexto

Até aqui, a aprovação de férias era só do RH: colaborador solicitava em
`/perfil`, caía em `pendente_aprovacao`, qualquer admin/rh aprovava. O
líder direto ficava sabendo das férias do time pelo WhatsApp ou pelo
próprio colaborador. Risco concreto: aprovações batendo com evento de
cliente, sem a chance do líder segurar.

A tabela `colaboradores.lider_id` já existia (FK pra `profiles`, migration
20260929120922), mas a cobertura era baixa — ~34% dos colaboradores com
líder definido.

## Decisão

Férias ganha **duas etapas de aprovação em série**:

1. Colaborador solicita → status `aguardando_gestor`.
2. Líder direto aprova via nova página `/equipe` → status `pendente_aprovacao`.
3. RH aprova via `/rh/ferias` → status `aprovado`, folhas criadas.

**Fallback sem líder:** colaboradores sem `lider_id` pulam direto pra
`pendente_aprovacao` (fluxo atual preservado). Base vai se preenchendo
pelo uso — o RH define o líder quando precisar.

**Override:** RH tem botão "Aprovar no lugar do líder" no modal de
detalhe quando o estado for `aguardando_gestor`. Grava
`aprovacao_lider_override = true` + motivo (opcional) + audit
`ferias.lancamento.override_lider_rh`.

**Nova UI:** página `/equipe` na sidebar (gated por EXISTS de liderados),
com tab "Equipe" (lista do time via `vw_equipe_do_lider` — sem PII) e
tab "Férias" (pendentes de aprovação + histórico do time).

## Alternativas consideradas

- **Fallback silencioso — todos sem líder caem direto no RH e nada
  mais acontece.** Descartada: cria dívida de cadastro invisível;
  durante meses, metade do time nunca passa pelo líder.
- **Backfill obrigatório antes de ligar o fluxo.** Descartada:
  travaria a entrega por trabalho de cadastro. A planilha oficial de
  21/11 trouxe o backfill a 93% sem precisar pausar.
- **Role nova `lider` em `tenant_members`.** Descartada: o dado
  (`colaboradores.lider_id`) já carrega a semântica; role nova é um
  eixo a mais pra manter.
- **Column-level RLS pra esconder salário do líder.** Descartada:
  Postgres não suporta nativo; criaríamos SECURITY DEFINER. Decidido
  que o líder não vê salário na página `/equipe` (nem CPF, nem
  benefício) — essas são admin/rh/financeiro.

## Consequências

- Infra no banco: enum `aguardando_gestor`, 4 colunas novas em
  `colaboradores_ferias_lancamentos`, policies RLS de SELECT/UPDATE
  pro líder, view `vw_equipe_do_lider`. Migrations 20261121200001-5
  + 20261121300001.
- Audit: eventos `ferias.lancamento.aprovado_lider`,
  `ferias.lancamento.reprovado_lider`,
  `ferias.lancamento.override_lider_rh`.
- Produção: o líder assume a leitura das férias do time; se não
  aprovar em tempo útil, o RH destrava — sem ficar refém do delay do
  líder.
- Documentação: `docs/modulos/rh/25-ferias.md` atualizado.
```

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/267-ferias-aprovacao-em-duas-etapas.md
git commit -m "docs(decisions): ADR 267 - ferias com aprovacao em duas etapas"
```

---

### Task 7: Verificação final

**Files:**
- Modify: nenhum.

**Interfaces:**
- Consumes: tudo das 6 tasks anteriores.
- Produces: confirmação do fechamento do PR 3.

- [ ] **Step 1: `tsc --noEmit`**

Expected: 0 erros.

- [ ] **Step 2: Testes unitários**

```bash
npx tsx --test lib/ferias/*.test.ts lib/equipe/*.test.ts
```
Expected: 53 testes passando (48 do PR 1+2 + 5 do schema novo).

- [ ] **Step 3: Teste manual end-to-end**

1. Logar como colaborador com líder → solicitar férias → status `aguardando_gestor`.
2. Logar como líder → `/equipe` aba Férias → reprovar com motivo → status `reprovado` + motivo gravado + audit linha.
3. Colaborador solicita de novo → status `aguardando_gestor`.
4. **Pular líder:** logar como RH → `/rh/ferias/solicitacoes` → chip "Aguardando líder" com 1 → clicar → abrir modal → "Aprovar no lugar do líder" com motivo "líder viajou" → status `aprovado`, folhas criadas, audit `override_lider_rh` gravado.
5. Abrir `/rh/ferias/[id]` do lançamento → timeline mostra "RH aprovou no lugar do líder" + "Aprovado pelo RH" + motivo.

- [ ] **Step 4: Confirmar audit trail no MCP**

```sql
SELECT acao, metadata->>'motivo' AS motivo, created_at
FROM public.audit_events
WHERE acao LIKE 'ferias.lancamento.%_lider%'
ORDER BY created_at DESC
LIMIT 10;
```
Expected: 3 ações distintas aparecendo (`aprovado_lider`, `reprovado_lider`, `override_lider_rh`).

---

## Self-review (feito; achados corrigidos inline)

- **Spec coverage:** override (Tasks 1+3), UI dedicada no RH (Task 2), timeline (Task 4), docs (Tasks 5+6). Todos cobertos.
- **Granularidade:** 7 tasks com commit próprio; passos checáveis.
- **Type consistency:** `overrideLiderRhSchema`, `aprovarLancamentoOverrideRh`, `SolicitacaoRow` consistentes entre tasks 1→2→3.
- **Review Focus:** 5 inputs mapeados nas Tasks 1, 2 e 4.
- **Proporção:** ~400 linhas pra ~500-700 linhas de código estimado. OK.
