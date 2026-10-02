# Task 009 — Performance do módulo RH (Férias)

## Objetivo

Derrubar o tempo de resposta das telas do módulo de Férias de **15-16s** pra **<2s** no Quadro e **<1s** no modal de detalhe. Hoje a sensação de uso é de travamento — qualquer clique em `/rh/ferias` demora o suficiente pra parecer que o sistema congelou.

Essa task NÃO adiciona feature. É puramente de infraestrutura — banco, policies, queries, payload. UI não muda.

Dependência: **Passos 1-4 do redesign do módulo Férias concluídos** (commits `0a2a419` até `2eeabd7` em main).

## Contexto do ponto de partida

### Baseline medido em prod (2026-10-02)

Capturado via Network tab do DevTools:

| Rota | Tempo | Verdict |
|---|---|---|
| `/rh/ferias` (página base) | 1,6s | Lento |
| `?tab=solicitacoes` | 1,6s | Lento |
| `?tab=quadro` | **15,6s** | 🔥 Crítico |
| `?tab=calendario` | 1,7s | Lento |
| `?tab=rescisoes` | 1,5s | Lento |
| `?tab=notificacoes` | 1,1s | Aceitável |
| Abrir modal de colaborador | **16,0s** | 🔥 Crítico |

Target CLAUDE.md: TTFB warm < 300ms, cold < 1s. **Estamos 50× acima do target** na pior tela.

### Hipóteses testadas via EXPLAIN ANALYZE

Queries isoladas no banco são **rápidas** (todas < 32ms). O problema não é query lenta — é a soma de overheads:

| Query | Tempo DB | Problema |
|---|---|---|
| `SELECT colaboradores` (209 ativos) | 4ms | ok |
| `SELECT periodos IN (210 ids)` | 31ms | seq scan + planning 15ms |
| `SELECT lancamentos IN (210 ids)` | 2ms | ok |
| KPI count | <1ms | ok |
| Notificações do card | 1ms | ok |

### Causas raiz confirmadas (ordem de impacto)

**1. Multiple permissive policies** (advisor Supabase, 12 findings em RH)
Cada SELECT em `profiles`, `tenant_members`, `colaboradores_ferias_*` dispara 2-3 policies RLS sobrepostas rodando subquery de autenticação. Multiplica custo real por 2-3× em cada query. Afeta TODA tela do módulo.

**2. FKs sem índice** (advisor Supabase, 24 findings em RH)
Joins com `profiles` (nome do solicitante/aprovador/líder), `lancamentos`, `notificacoes` fazem seq scan. Modal paga esse custo múltiplas vezes.

**3. `SELECT *` no AbaQuadro**
`.select("*")` em `colaboradores_ferias_periodos` traz 1031 linhas × todos os campos = **133 KB serializados** quando a UI usa só 7 campos. Payload serializado em RSC fica ~300 KB.

**4. Query em série antes de Promise.all**
`AbaQuadro`: 1ª query `colaboradores` ESPERA terminar antes das 2 queries paralelas de `periodos`/`lancamentos`. Fluxo correto é as 3 em paralelo.

**5. `CardNotificacoesFerias` com 2 queries em série**
Lista notificações + conta não-lidas em round-trips separados. Multiplica custo em 7 páginas que usam o card (6 homes + /perfil + /rh/ferias).

**6. Modal re-renderiza o Quadro inteiro**
Abrir modal passa pela mesma `page.tsx`, que renderiza todas as queries do Quadro + modal. Custo cumulativo.

**7. Prefetch zumbi** (hipótese)
Next 14 dispara request RSC em hover mesmo com `prefetch={false}`. Nos tabs de navegação, cada hover faz um request. Como o Quadro é lento, satura o pool de serverless functions do Vercel. Precisa confirmar com logs do Vercel.

**8. Cold start do Vercel**
Primeira request após inatividade paga 1-3s de boot. Combinado com queries lentas, estoura.

## Decisões pendentes (travar no início da task)

- **Materialized view** (Onda 3) é no-go por enquanto? → sim, se Ondas 1+2 não entregarem o alvo.
- **Keep-warm cron** só pro módulo RH ou global? → só RH se virar necessidade.
- **Modal como rota separada** (`/rh/ferias/[colab]`)? → avaliar depois da Onda 2.
- **Confirmar com logs Vercel/Supabase**? → opcional, análise estática + EXPLAIN ANALYZE já identificou os culprits.

## Entregas previstas

### Onda 1 — Banco (ESCOPO MÍNIMO)

**Migration `20261002000010_rh_perf_consolida_policies.sql`**:
- Dropa policies duplicadas em `profiles` (3 → 1), `tenant_members` (3 → 1).
- Dropa policies duplicadas em `colaboradores_ferias_lancamentos` (RH+colab → 1 com OR).
- Mesmo em `colaboradores_ferias_periodos`, `colaboradores_ferias_notificacoes`.
- Usa padrão `(select auth.uid())` em todas (já é padrão, mas confirmar).

**Migration `20261002000011_rh_perf_indices_fks.sql`**:
- `CREATE INDEX` em 24 FKs sem índice do RH:
  - `colaboradores.lider_id`, `colaboradores.created_by`
  - `colaboradores_ferias_lancamentos.aprovado_por`, `.solicitado_por`, `.conta_avulsa_id`
  - `colaboradores_ferias_notificacoes.lancamento_id`, `.periodo_id`
  - `colaboradores_salarios.aprovado_por`, `.created_by`
  - `colaboradores_alocacoes` (2 FKs)
  - `contratacoes` (7 FKs)
  - `folhas_pagamento` (5 FKs)
  - `folhas_pagamento_alocacoes.tenant_id`

**Verificação pós**:
- `get_advisors` deve mostrar 0 WARN em tabelas de RH.
- EXPLAIN ANALYZE das 3 queries do Quadro: planning time < 2ms, execution < 15ms.
- Rodar `select cron.schedule...` manual pra garantir que o cron ainda funciona.

**Meta de performance**: Quadro **15s → 3-5s**.

### Onda 2 — Código (ESCOPO MÉDIO)

**`AbaQuadro`**:
- Trocar `select("*")` por `select("id, colaborador_id, numero, aquisitivo_inicio, aquisitivo_fim, data_limite_gozo, dias_direito, status")`.
- Mover query de colaboradores PRA DENTRO do `Promise.all` com periodos+lancamentos. Todas filtram por `tenant_id` direto, sem precisar do `IN`.

**`CardNotificacoesFerias`**:
- `Promise.all` das 2 queries (listar + contar).
- Ou: RPC `fn_notificacoes_com_contagem(user_id, limite)` que retorna ambos num só round-trip.

**`ModalDetalheColaborador`** (dentro de `AbaQuadro`):
- Query do modal fica dentro do próprio render do modal (não da AbaQuadro). Hoje o `aba-quadro.tsx` tem um `if (colabSelecionado)` que faz `supabase.from(...).select("*")` DEPOIS do Promise.all. Separar.

**Meta de performance**: Quadro **3-5s → 1-2s**. Modal **16s → 500ms-1s**.

### Onda 3 — Arquitetura (OPCIONAL)

Só se Ondas 1+2 não entregarem o alvo.

**Materialized view `vw_quadro_ferias`**:
- Dados pré-calculados: nome, admissão, status principal, dias pendentes, data_limite, próximo vencimento.
- Refresh via trigger ao mudar `_periodos` ou `_lancamentos`.
- Query do Quadro vira SELECT instantâneo.

**Rota separada `/rh/ferias/[colab]`**:
- Modal vira página própria.
- Next prefetch funciona corretamente.
- Quadro não re-renderiza ao abrir modal.

**Keep-warm cron** (`/api/health?from=keepwarm` a cada 5min):
- Evita cold start do Vercel.
- Confirmar primeiro se cold start é mesmo o culprit.

**Meta de performance**: Quadro **<800ms**, modal **<300ms**.

## Done when

- [ ] Advisor Supabase: 0 WARN em tabelas de RH.
- [ ] `/rh/ferias?tab=quadro` abre em **<2s warm** (hoje 15,6s).
- [ ] Abrir modal: **<1s warm** (hoje 16s).
- [ ] `/perfil` abre em **<500ms** (não medido ainda).
- [ ] Confirmação visual: Daniel abre em prod, mede com Network tab, confirma.

## Fora de escopo

- Mudar UI (já decidida nos Passos 1-4 do redesign).
- Mexer em outros módulos (financeiro, jobs, orçamento) — mesmo que tenham o mesmo problema de policies duplicadas, é task separada.
- Keep-warm global.
- Edge runtime nos middlewares (dependeria de reescrita do session).
- Rate limiting ou cache externo (Redis/Upstash).

## Observações

- Task puramente de infra. Zero mudança de comportamento visível ao usuário final.
- Cada onda tem rollback simples: dropar migration (Onda 1) ou revert commit (Onda 2).
- Após cada onda, pausar pra validação com baseline novo antes da próxima.
- Advisor `multiple_permissive_policies` também aparece em outros módulos — consolidar lá vira task separada (ex. 010).
