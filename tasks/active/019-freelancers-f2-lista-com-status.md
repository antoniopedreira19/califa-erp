# Task 019 — Freelancers (Fase 2, Task 5): lista com status + cards de análise

## Objetivo

Fechar a Fase 2. A aba Freelancers (`/freelancers/lista`) passa a mostrar informações do contrato ativo via `freelancers_com_status`:

1. **Colunas novas** na tabela: Cargo (do contrato) + Status (badge colorido).
2. **4 cards de análise rápida** no topo (Na ativa · Em dia · Irregular · Encerrados) — clicáveis pra aplicar filtro.
3. **Chips de filtro por status_calculado** (além dos chips de ação prevista que já existem).
4. Status badge compartilhado em outros lugares do módulo.

## Fora de escopo

- Dashboard do módulo (`/freelancers`) com hero + ações + performance — Fase 4 Task 022.
- Modal com lista filtrada ao clicar no card (vai no Dashboard — aqui o card só aplica filtro inline na tabela).
- Hero rico no perfil com valor/mês e tempo de vínculo — Fase 4.
- Export XLSX — Fase 4 Task 025.

## Decisões travadas

- **Lista consome `freelancers_com_status`** (view) em vez de `freelancers`. Mesma permissão (SELECT amplo pra tenant_members).
- **4 cards de análise** com cores tonais no padrão do AgCaliforniaRH:
  - **Na ativa** (emerald) — `status_real = true`
  - **Em dia** (emerald) — `status_calculado in ('regular','vencendo')` E `status_real = true`
  - **Irregular** (red/california-red) — `status_calculado in ('irregular','sem_minuta','sem_assinado','pendente')` E `status_real = true`
  - **Encerrados** (zinc) — `status_real = false` OU `status_calculado = 'encerrado'`
- **Clicar no card** aplica filtro `?card=<categoria>` que combina com chips via **AND**. Clicar de novo desativa.
- **Chips de status** vão acima dos chips de ação prevista, no mesmo bloco de filtros. 7 chips: Regular · Vencendo · Irregular · Sem minuta · Sem assinado · Agendado · Encerrado · Pendente. Vou simplificar pra 5-6 pra não poluir visualmente.
- **StatusBadge compartilhado** em `_components/` do módulo. Mesmo tom e visual do `AcaoPrevistaBadge` da Task 013.
- **Query no banco**: filtros compostos via query string, igual na Task 013. Dentro da page.tsx, mapear `card` + `status` em WHERE conditions.

## Contexto do ponto de partida

### Já pronto

- View `freelancers_com_status` com `status_contrato` e `status_calculado` (Task 016).
- Lista atual em `/freelancers/lista` consumindo `freelancers` (Task 013).
- Chips de ação prevista funcionando via query string (Task 013).
- Tipo `FreelancerComStatus` em `lib/types.ts` (Task 016).

### Pontos de atenção

- `FreelancerComStatus` tem **todos** os campos de `Freelancer` + os do contrato ativo. O `ListaClient` existente aceita `Freelancer[]` — vou alargar pra aceitar `FreelancerComStatus[]`.
- Status é computado no banco (CASE WHEN), não no cliente — filtrar por status é literalmente `.in('status_calculado', [...])`.
- Cards exigem contagem — faço com 4 queries agregadas em `Promise.all` com `head: true, count: 'exact'`.

## Escopo

### 1. Arquivos novos

```
app/(app)/freelancers/_components/
└── status-badge.tsx                     # Badge visual compartilhado

app/(app)/freelancers/lista/_components/
├── cards-analise.tsx                    # 4 cards no topo (client, lê searchParams)
└── chips-status.tsx                     # Chips de status (client, lê searchParams)
```

### 2. Arquivos modificados

- `app/(app)/freelancers/lista/page.tsx` — passa a consumir a view + aceita `?card=` e `?status=` + renderiza cards + atualiza coluna da tabela.
- `app/(app)/freelancers/lista/_components/lista-client.tsx` — aceita `FreelancerComStatus[]`, adiciona colunas Cargo e Status, mantém o resto.

### 3. Lógica de filtro

```ts
const CATEGORIAS_CARD = {
  "na-ativa": { status_real: true },
  "em-dia": { status_real: true, status_calculado: ["regular", "vencendo"] },
  "irregular": {
    status_real: true,
    status_calculado: ["irregular", "sem_minuta", "sem_assinado", "pendente"],
  },
  "encerrados": { status_real: false },
};

// query String AND lógica: card + chips de status + chips de ação + busca
```

### 4. UI do bloco de análise

```
┌─ Na ativa ─┐ ┌─ Em dia ─┐ ┌─ Irregular ─┐ ┌─ Encerrados ─┐
│    12      │ │    10    │ │     2       │ │      3       │
│ Com vínculo│ │ Reg.+venc│ │ Precisa aten│ │  Inativos    │
└────────────┘ └──────────┘ └─────────────┘ └──────────────┘
```

Clique = aplica filtro. Card ativo ganha borda california-red.

### 5. StatusBadge

Mapa de 9 valores → classes Tailwind:

| Status | Wrap | Dot |
|---|---|---|
| regular | emerald | emerald-500 |
| vencendo | amber | amber-500 |
| agendado | violet | violet-500 |
| irregular | california-red/10 | california-red |
| sem_minuta | california-red/10 | california-red |
| sem_assinado | california-red/10 | california-red |
| pendente | sky | sky-500 |
| encerrado | zinc | zinc-400 |
| limbo | zinc | zinc-400 |

## Critérios de pronto

- [ ] Lista `/freelancers/lista` consome `freelancers_com_status`.
- [ ] Colunas "Cargo" e "Status" aparecem na tabela entre existentes.
- [ ] 4 cards de análise aparecem no topo entre PageHeader e BuscaInput.
- [ ] Clicar card aplica filtro; clique repetido limpa.
- [ ] Chips de status funcionam combinados com chips de ação prevista.
- [ ] `StatusBadge` component usado na tabela.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.

## Próxima task (020)

Fase 3 começa — migration das tabelas de solicitação (`freelancer_solicitacoes`, `_mensagens`, `_leituras`) + realtime habilitado em mensagens.
