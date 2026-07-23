# Spec — Visão PLANEJADO na versão do orçamento + campo CATEGORIA no item

**Data:** 2026-07-23
**Contexto:** Task 004 (versões de orçamento), extensão pós-MVP.
**Autor:** brainstorming session em `docs/superpowers/specs/`.

## 1. Objetivo

Trazer a visão **PLANEJADO** para a versão do orçamento (hoje só temos ORÇADO)
e adicionar um campo **CATEGORIA** no item como classificação livre por versão.
Espelha a planilha padrão da agência, permitindo importação com as duas
colunas preenchidas e comparação lado-a-lado de orçado × planejado com
rentabilidade calculada.

## 2. Escopo

**Dentro do escopo desta task:**
- Migration com nova tabela `versoes_orcamento_categorias` e novas colunas
  em `versoes_orcamento_itens` (categoria_id + campos planejados).
- Types + Zod schemas atualizados.
- Server actions: CRUD de categoria por versão + item com campos planejados.
- Parser da planilha lê col B (categoria) e cols I-K (planejado).
- UI: botão "Nova categoria" na versão, dropdown de categoria no drawer de item,
  colunas planejadas na tabela do grupo, card de totais com rentabilidade.
- Duplicação de versão passa a duplicar também categorias e valores planejados.

**Fora de escopo:**
- Tela dedicada `/admin/categorias` (categoria vive dentro da versão, sem
  admin global).
- Bloco REALIZADO da planilha (cols N-R).
- Fórmula completa de "Resultado Operacional" da planilha (que envolve
  honorários e impostos no cálculo). Versão inicial usa rentabilidade
  simples: `Orçado − Planejado`.
- Migração de itens antigos que têm texto em `planilha_origem` — coluna
  fica como está; categoria começa vazia nesses itens.

## 3. Decisões-chave (do brainstorming)

| Decisão | Escolha |
|---|---|
| Escopo da categoria | **Por versão** (mesma granularidade que grupo). Nada global. |
| Obrigatoriedade da categoria | **Opcional** no item. |
| Origem da categoria | Criada pelo botão "Nova categoria" na tela da versão OU auto-criada pelo import. |
| Coluna da planilha para categoria | Col B (CATEGORIA). Vazia → item sem categoria. |
| Momento de editar planejado | Junto com orçado, mesma tela, mesma linha do item. |
| Default de planejado | Nasce **zerado** (não copia orçado). Item sem planejado = "não planejado ainda". |
| Import de planejado | Lê cols I=R$, J=QT, K=D/M do bloco PLANEJADO. Se algum > 0, grava. |
| Fórmula de rentabilidade | Por item: `total_orcado − total_planejado`. Global: soma dos totais. |

## 4. Modelagem de banco

### 4.1 Nova tabela `versoes_orcamento_categorias`

Espelha o padrão de `versoes_orcamento_grupos`:

```sql
create table public.versoes_orcamento_categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  versao_orcamento_id uuid not null references public.versoes_orcamento(id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categorias_nome_nao_vazio check (length(trim(nome)) > 0)
);

create unique index uniq_categoria_nome_por_versao
  on public.versoes_orcamento_categorias(tenant_id, versao_orcamento_id, lower(nome));

create index idx_categorias_tenant on public.versoes_orcamento_categorias(tenant_id);
create index idx_categorias_versao on public.versoes_orcamento_categorias(versao_orcamento_id);
```

RLS: mesmo padrão de grupos (`is_tenant_member(tenant_id)` para select/insert/update/delete).
GRANTs: `select, insert, update, delete` para `authenticated`. `service_role`
já é coberto por `ALTER DEFAULT PRIVILEGES` (migration `20260725000001`).

### 4.2 Alterações em `versoes_orcamento_itens`

```sql
alter table public.versoes_orcamento_itens
  add column categoria_id uuid references public.versoes_orcamento_categorias(id) on delete set null,
  add column valor_unitario_planejado numeric(14, 2) not null default 0,
  add column quantidade_planejada     numeric(12, 3) not null default 0,
  add column dias_meses_planejado     numeric(12, 3) not null default 0,
  add column total_planejado numeric(18, 2) generated always as (
    coalesce(valor_unitario_planejado, 0)
    * coalesce(quantidade_planejada, 0)
    * coalesce(dias_meses_planejado, 0)
  ) stored;

create index idx_itens_categoria on public.versoes_orcamento_itens(categoria_id);

alter table public.versoes_orcamento_itens
  add constraint itens_planejado_valor_nao_negativo check (valor_unitario_planejado >= 0),
  add constraint itens_planejado_qtd_nao_negativa   check (quantidade_planejada >= 0),
  add constraint itens_planejado_dm_nao_negativo    check (dias_meses_planejado >= 0);
```

**Nota sobre constraints existentes:** as constraints do orçado (`quantidade_orcada > 0`, `dias_meses_orcado > 0`) permanecem — orçado continua obrigatório. As de planejado permitem 0 (default = "não preenchido ainda").

### 4.3 Rentabilidade

Não fica salva no banco. É calculada no client a partir de `total_orcado` e `total_planejado`:

- Por item: `rentabilidade = total_orcado - total_planejado`.
- Por versão: soma das rentabilidades de todos os itens.
- **`total_planejado = 0` significa "não planejado"** — a UI mostra travessão em vez de "100% de margem".

## 5. Import da planilha

### 5.1 Col B (CATEGORIA)

- Se **col B tem texto** na linha do item:
  1. `SELECT` na tabela `versoes_orcamento_categorias` da versão em criação
     buscando `lower(nome) = lower(colB)`.
  2. Se existe → usa o id existente.
  3. Se não existe → `INSERT` em `versoes_orcamento_categorias` e usa o id novo.
  4. Item é gravado com `categoria_id` apontando para esse id.
- Se **col B vazia** → item vai com `categoria_id = null`.
- **Sem warning** para categoria — auto-criação é comportamento esperado.

### 5.2 Cols I=R$, J=QT, K=D/M (bloco PLANEJADO)

- Parser lê os três valores usando o mesmo `toNumber` do bloco orçado.
- Cols L (TT planejado) e M (RENTA) são **ignoradas** — o banco recalcula.
- Cols N-R (REALIZADO) continuam **ignoradas** (fora de escopo).
- Se todos vazios/zero → item nasce planejado = 0.

### 5.3 Ordem das operações no confirmar

O `confirmarImportacao` de `app/(app)/orcamentos/[id]/versoes/importar-actions.ts`
passa a executar:

1. Cria versão em rascunho.
2. Cria grupos em bulk (como hoje).
3. **Cria categorias em bulk** a partir das que apareceram no parser.
4. Cria itens em bulk, resolvendo `grupo_id` e `categoria_id` a partir dos
   nomes coletados no parse.

## 6. UI

### 6.1 Tela da versão — `app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx`

**Header dos grupos:**
```
Grupos  · Nova categoria · Novo grupo
```
Adiciona botão "Nova categoria" com o mesmo estilo/UX do "Novo grupo".
Novo drawer `NovaCategoriaDrawer` com um único campo (nome).

**Tabela do grupo (`itens-table.tsx`):**

Colunas atuais: `Item | Tipo | Valor unit. | QTD | D/M | Total | Ações`.

Passa a ser:

```
Item | Tipo | Categoria | R$ Orç | QT | D/M | Total Orç | R$ Plan | QT | D/M | Total Plan | Rentab. | Ações
```

- Colunas planejadas com fundo levemente diferente (`bg-blue-50/40` ou
  equivalente do tema California) para separação visual.
- Coluna Categoria mostra badge com nome (ou "—" se null).
- Coluna Rentab. mostra:
  - `formatCurrency(rentabilidade)` + `%` quando `total_planejado > 0`.
  - Travessão (`—`) quando `total_planejado = 0`.
  - Cor: verde se positiva, vermelho se negativa.

**Densidade:** tabela vai ficar mais larga. Mantém overflow horizontal
existente (`components/ui/table.tsx` já usa `overflow-auto`).

### 6.2 Drawer de item — `item-editor-drawer.tsx`

Dois novos blocos:

- **Categoria** (dropdown com opção "Nenhuma" + lista das categorias da
  versão atual). Botão "+ Nova categoria" no rodapé do dropdown para não
  precisar fechar o drawer.
- **Planejado** (título de seção com fundo azul suave):
  - Valor unitário planejado
  - Quantidade planejada
  - Dias/meses planejado
  - Rentabilidade calculada em tempo real (readonly).

### 6.3 Card de totais — `totais-card.tsx`

Adiciona três linhas ao final do resumo, antes do FATURAMENTO:

```
TOTAL PLANEJADO           R$ X.XXX,XX
RENTABILIDADE             R$ X.XXX,XX  (verde ou vermelho)
% RENTABILIDADE           XX,X%
```

Só mostra `RENTABILIDADE` e `% RENTABILIDADE` se `total_planejado > 0`.

### 6.4 Export XLSX

Não muda nesta task. Continua exportando só orçado. **Nota**: em task futura,
adicionar bloco PLANEJADO ao export para fechar o ciclo (o formato da planilha
já espera esse bloco).

## 7. Duplicação de versão

`duplicarVersao` em `actions.ts` já duplica grupos e itens. Precisa
estender:

1. Query as categorias da versão original.
2. `INSERT` bulk das categorias na versão nova.
3. Constrói `categoriaMap: Map<oldId, newId>` (por nome, análogo ao `grupoMap`).
4. Ao copiar itens, resolve `categoria_id` via `categoriaMap` e também
   copia os campos planejados (`valor_unitario_planejado`, `quantidade_planejada`,
   `dias_meses_planejado`).

## 8. Types e schemas

### `lib/types.ts`
```ts
export interface VersaoOrcamentoCategoria {
  id: string;
  tenant_id: string;
  versao_orcamento_id: string;
  nome: string;
  created_at: string;
  updated_at: string;
}

export interface VersaoOrcamentoItem {
  // ...campos atuais...
  categoria_id: string | null;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  total_planejado: number;
}
```

### `lib/validations/itens.ts`

Estende o schema para receber `categoria_id` (uuid opcional) + campos
planejados (default 0, `>= 0`). Sem tornar `categoria_id` obrigatório.

### `lib/validations/categorias.ts` (novo)

Espelha `grupos.ts`:
```ts
export const categoriaSchema = z.object({
  nome: z.string().trim().min(1).max(120),
});
```

## 9. Server actions

Em `app/(app)/orcamentos/[id]/versoes/actions.ts`:

- `criarCategoria(versaoId, formData)` — mesmo padrão do `criarGrupo`.
- `renomearCategoria(categoriaId, formData)` — mesmo padrão do `renomearGrupo`.
- `removerCategoria(categoriaId)` — mesmo padrão do `removerGrupo`; se
  categoria tem itens, faz UPDATE nos itens setando `categoria_id = null`
  e depois DELETE (evita quebrar constraint).
- `adicionarItem` / `atualizarItem` — estendidos para aceitar
  `categoria_id` e os campos planejados.

## 10. Critérios de sucesso (aceitação)

- [ ] Ao criar item novo pela UI, dropdown de categoria lista as
      categorias existentes da versão + "Nenhuma".
- [ ] Botão "Nova categoria" abre drawer e adiciona categoria à versão.
- [ ] Item editado permite alterar categoria e valores planejados.
- [ ] Import de planilha com col B preenchida cria categorias na versão
      automaticamente e vincula os itens corretamente.
- [ ] Import de planilha com cols I-K preenchidas grava planejado.
- [ ] Rentabilidade aparece por item (travessão se planejado = 0).
- [ ] Card de totais mostra total planejado + rentabilidade + % rentabilidade.
- [ ] Duplicar versão traz categorias e planejado junto.
- [ ] `tsc --noEmit` e `next lint` passam limpos.
- [ ] Migração aplicada em produção com sucesso e sem quebrar itens já
      existentes (planejado nasce zerado).

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Tabela de itens fica larga demais no mobile | Overflow horizontal já existe; investigar densidade posterior. |
| Item importado com categoria existente com case diferente ("Logistica" vs "logística") | Unique index é `lower(nome)` — trata bem. Comparação de igualdade também usa `lower()`. |
| Card de totais fica pesado com 3 novas linhas | Aceitar — espelha a planilha. |
| Fórmula simples de rentabilidade pode não bater com a planilha completa (que considera honor+imposto) | Documentado como "fase inicial". Refinar quando comercial validar. |
| Categoria criada por engano dentro da versão fica "lixo" | Botão "Remover categoria" já contempla — só remove a categoria, itens ficam com `categoria_id = null`. |

## 12. Migration (arquivo)

- Nome: `20260728000001_task004_categoria_e_planejado.sql`
- Aplicar via MCP antes do merge.

## 13. Fora de escopo desta task (backlog)

- `/admin/categorias` — se um dia categorias virarem globais.
- Adicionar bloco PLANEJADO ao export XLSX.
- Bloco REALIZADO e cálculo de "Resultado Operacional" da planilha.
