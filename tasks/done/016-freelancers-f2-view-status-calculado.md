# Task 016 — Freelancers (Fase 2, Task 2): view de status calculado

## Objetivo

Criar a view `freelancers_com_status` que une freelancer + contrato mais relevante + calcula dois enums de status derivados. Essa é a fonte-verdade pra qualquer tela que precisa mostrar status do freela (lista, dashboard, cards de análise).

A view **não é materializada** — é lida em tempo real. SECURITY INVOKER pra respeitar RLS das tabelas subjacentes.

## Fora de escopo

- UI que consome a view (lista com coluna de status, cards de análise) — Task 017.
- Mudanças nas tabelas base — Tasks 011, 015 já cobrem.
- Dashboard do módulo — Fase 4.
- Trigger que recalcula alguma coisa — nada derivado por trigger, tudo em runtime pela view.

## Decisões travadas

### `status_contrato` — enum derivado só do contrato

Olha pros arquivos e datas do contrato mais relevante. Valores:

- **`sem_contrato`** — não tem contrato nenhum
- **`sem_minuta`** — tem contrato mas sem `minuta_url` nem `arquivo_url`
- **`sem_assinado`** — tem `minuta_url` mas sem `arquivo_url` (PDF assinado)
- **`agendado`** — tem `arquivo_url` e `data_inicio > hoje`
- **`vigente`** — tem `arquivo_url`, `data_inicio ≤ hoje` e (`data_termino` null ou > hoje+30)
- **`vencendo`** — tem `arquivo_url`, dentro de 30 dias do término
- **`vencido`** — tem `arquivo_url` e `data_termino < hoje`

### `status_calculado` — combinação com `status_real`

Cruza o status do contrato com a flag "pessoa ainda trabalha":

- **`encerrado`** — `status_real = false` (independente do resto)
- **`pendente`** — não tem contrato, `status_real = true` por default
- **`sem_minuta`** / **`sem_assinado`** — propaga direto do `status_contrato`
- **`agendado`** — contrato agendado pra começar no futuro
- **`regular`** — vigente + ok
- **`vencendo`** — propaga
- **`irregular`** — vencido mas pessoa ainda trabalha (`status_real=true`) — alerta: trabalho sem contrato válido!
- **`limbo`** — sinaliza inconsistências raras (contrato vigente mas status_real=false antes do fim). Fica como "default do else" pra não ter buraco.

### Seleção do contrato mais relevante

Um freelancer pode ter N contratos ao longo do tempo. A view escolhe UM por `LATERAL join` com ordenação por prioridade:

1. **Vigente hoje** com `status_real=true` (mais relevante)
2. **Futuro** com `status_real=true` (agendado)
3. **Mais recente** independente de status
4. **Stub** (sem datas, sem arquivos)

Dentro de cada grupo, desempate: `data_inicio DESC` → `created_at DESC`.

### Colunas que a view retorna

- Todas de `freelancers` (sem `cartao_cnpj_url`, `saude_obs` por serem grandes — mas acho que vou retornar tudo mesmo, simplifica).
- Do contrato ativo:
  - `contrato_id`
  - `contrato_origem_sistema`
  - `nome_job`
  - `cargo`
  - `valor`
  - `tipo`
  - `data_inicio`
  - `data_termino`
  - `cidade_contrato` (renomeado pra não colidir com `cidade` do freela)
  - `status_real`
  - `arquivo_url`
  - `minuta_url`
- Do responsável (join com `profiles`):
  - `responsavel_id`
  - `responsavel_nome`
  - `responsavel_email`
- Do job (join com `jobs`):
  - `job_codigo`
  - `job_nome` (do califa-erp, não o snapshot)
- Derivados:
  - `status_contrato`
  - `status_calculado`

### Decisão: SECURITY INVOKER

Views em Postgres rodam com SECURITY DEFINER por padrão (do owner), o que **bypassa RLS**. Pra view respeitar as policies de `freelancers` e `freelancer_contratos` (um GP só vê os freelas com contrato dele), precisa ser `security_invoker = true`.

Isso é essencial pra: na Fase 2+, quando as policies de contratos virarem mais restritas, a view automaticamente respeita.

## Contexto do ponto de partida

### Já pronto

- `freelancers` (Task 011).
- `freelancer_contratos` (Task 015).
- `jobs`, `profiles` com RLS.
- Padrão de view com SECURITY INVOKER (exemplo: `vw_fluxo_caixa` do módulo financeiro — se tiver).

### Pontos de atenção

- `jobs.codigo` existe mas `jobs.nome` também. Qual trazer? Trago os dois pra UI decidir.
- `profiles` tem `nome` e `email` — ambos úteis.
- A policy SELECT de `freelancer_contratos` hoje é `is_tenant_member`. Quando mudar pra "GP só vê seus" no futuro, a view com INVOKER automaticamente herda.
- View não pode ter `grant select` direto em `authenticated` se as tabelas base já têm — herança funciona.

## Escopo

### 1. Migration nova

`supabase/migrations/20261016000003_freelancers_f2_view_status.sql`

Conteúdo:
1. `create view public.freelancers_com_status with (security_invoker = true) as ...`
2. Grant select pra `authenticated`.
3. Comentário explicando o critério de seleção do contrato.

### 2. Tipos TypeScript

```ts
// lib/types.ts
export type StatusContrato =
  | "sem_contrato"
  | "sem_minuta"
  | "sem_assinado"
  | "agendado"
  | "vigente"
  | "vencendo"
  | "vencido";

export type StatusCalculado =
  | "regular"
  | "vencendo"
  | "irregular"
  | "sem_minuta"
  | "sem_assinado"
  | "pendente"
  | "limbo"
  | "agendado"
  | "encerrado";

export interface FreelancerComStatus extends Freelancer {
  contrato_id: string | null;
  contrato_origem_sistema: OrigemFreelancerContratoSistema | null;
  nome_job: string | null;
  cargo_contrato: string | null;
  valor: number | null;
  tipo: TipoFreelancerContrato | null;
  data_inicio: string | null;
  data_termino: string | null;
  cidade_contrato: string | null;
  status_real: boolean | null;
  arquivo_url: string | null;
  minuta_url: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  responsavel_email: string | null;
  job_codigo: string | null;
  job_nome: string | null;
  status_contrato: StatusContrato;
  status_calculado: StatusCalculado;
}
```

Nota: `cargo` da view vem como `cargo_contrato` pra não colidir com nada que possa aparecer em `freelancers` no futuro.

## Critérios de pronto

- [ ] Migration aplicada via MCP.
- [ ] View `freelancers_com_status` existe e tem `security_invoker = true`.
- [ ] Grant select pra `authenticated` existe.
- [ ] `select count(*) from freelancers_com_status` roda sem erro.
- [ ] Com base vazia, retorna 0 linhas (não derrapa).
- [ ] `get_advisors` sem alerta novo.
- [ ] `lib/types.ts` com `StatusContrato`, `StatusCalculado`, `FreelancerComStatus`.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.

## Próxima task (017)

UI de contratos:
- `/freelancers/contratos/novo` com formulário completo (picker job, cargo, valor, datas, tipo, responsável).
- `/freelancers/contratos/[id]` pra editar.
- Aba "Contratos" do perfil preenchida com a lista real.
- Lista `/freelancers/lista` passa a consumir a view: coluna "Cargo" e "Status" (badges) preenchidas.
- 4 cards de análise rápida (na ativa / em dia / irregular / encerrados) no topo da lista.
- Botão "Novo contrato" no perfil fica ativo.
