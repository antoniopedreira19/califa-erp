# Briefing para segunda opinião — Performance do ERP California (2026-11-25)

> Este documento é um briefing autocontido para revisão independente. Quem lê aqui não tem acesso ao repositório nem ao chat original. Toda referência a arquivo:linha é pra dar contexto; a decisão de aceitar/rejeitar o plano abaixo depende da leitura crítica de quem revisa.

---

## 1. Contexto do produto e stack

**Produto:** ERP gerencial interno da Agência California (empresa de publicidade). Gerencia orçamentos, jobs, fornecedores, financeiro, fiscal, RH. Usuários: ~15-20 pessoas por dia, perfis diversos (produtor, financeiro, administrador, RH).

**Stack:**
- Next.js 14 App Router (RSC + Server Actions).
- `@supabase/ssr` para auth server-side com cookie.
- Supabase (PostgreSQL 15 gerenciado, PostgREST, Storage, Realtime).
- Hospedagem: Vercel Pro (compute Fluid).
- Compute Supabase atual: **Small — 2 GB RAM, 2 vCPU compartilhado, disco gp3 2 GB / 3000 IOPS**, região sa-east-1 (São Paulo).
- Plano Supabase: Pro ($25/mês).
- Plano Vercel: Pro.

**Padrões arquiteturais já consolidados no projeto (documentados em `docs/PERFORMANCE.md`):**
- `requireSession()` consolidado em 1 RPC (`get_session_context`) que retorna profile + memberships + tenants.
- RLS por tabela com padrão `tenant_id in (select current_tenant_ids())` e `(select session_role())` para evitar reavaliação por linha (case studies §4, §7 do PERFORMANCE.md).
- `force-dynamic` usado como freio de prefetch RSC descontrolado.
- `prefetch={false}` em `<Link>` dentro de listas com 5+ itens.
- `todasAsLinhas()` para contornar o corte silencioso de 1000 linhas do PostgREST.

---

## 2. O problema relatado

Uma usuária específica (produtora, uso intenso de pedidos de compra) relatou travamento recorrente ao usar o sistema. Nos logs do Supabase das últimas 24h, nada de erro do lado dela: 3.633 respostas 2xx, zero 4xx/5xx, latência p95 ~200ms. Browser atualizado (Chrome 157/Windows), rede estável. Mas o dashboard do Supabase marca:

- **Memory commitment SEVERE** com picos acima do limite.
- **Disk IO Balance 99%** (crédito de IOPS quase esgotado).
- Memory usage médio 1,64 GB / 2,05 GB (33% — aparenta OK, mas os picos são em sort/hash, não em uso constante).

Outros usuários também sentem lentidão intermitente, apenas em menor intensidade (ela é a mais vocal).

---

## 3. Dados concretos do Vercel (últimos 7 dias em produção)

| Métrica | Valor |
|---|---|
| Invocações de funções | 36.000 |
| Active CPU total | 57 minutos |
| Egress | 2 GB |
| Ingress | 556 MB |
| Memória média | 318 MB / 2,05 GB |
| CPU Throttle P75 | 15,8% |
| TTFB P75 | 460 ms |
| Cold Start | 3,2% |
| Compute Model | Fluid |
| Taxa de erro | < 0,1% |
| Timeout | 0% |

**Rotas prioritárias por impacto:**

| Rota | Invocações | CPU | P75 Duration | Erro |
|---|---|---|---|---|
| `/jobs/[jobId]` | 11.000 | 20 min | 1,3 s | 0% |
| `/financeiro/contas-a-pagar` | 1.700 | 6 min | **7,0 s** 🔴 | 0% |
| `/orcamentos/[projetoId]/[orcId]` | 1.700 | 6 min | 1,43 s | 0% |
| `/perfil` | 4.000 | 5 min | 836 ms | 0% |
| `/jobs` | 2.200 | 2 min | 390 ms | 0% |
| `/freelancers` | 1.800 | 2 min | 343 ms | 0% |
| `/home` | 2.300 | 2 min | 416 ms | 0% |
| `/financeiro/conciliacao` | 655 | 2 min | **4,8 s** 🔴 | 0% |
| `/orcamentos` | 1.800 | 1 min | 345 ms | 0% |

Target interno do PERFORMANCE.md: **TTFB warm < 300ms**, > 1s é fatal. P75 de 7s em `/financeiro/contas-a-pagar` e 4,8s em `/conciliacao` são **23× e 16× acima do target**.

---

## 4. Dados concretos do Postgres (`pg_stat_statements` + `pg_stat_database`)

### Memory pressure acumulada

- **1,28 TB em temp files acumulados** desde 2026-07 (vazamento de work_mem pra disco).
- **295.919 arquivos temporários criados** ao longo do período.
- `work_mem` original: **5 MB** (muito baixo para views pesadas tipo `vw_saves_por_job`).
- Cache hit ratio: 100% (índices OK, não falta índice — é memória de trabalho).

### Top consumidoras do servidor

| Rank | Função / query | Chamadas | Tempo total | Média | Máximo | Blocos lidos |
|---|---|---|---|---|---|---|
| 1 | `wal->>...` (Realtime lendo WAL) | 3.547.641 | 27.388 s (7h37min) | 7,7 ms | 11,4 s | 5,5 bilhões |
| 2 | `pg_timezone_names` (introspecção PostgREST) | 3.077 | 1.909 s | 621 ms | 2,8 s | 0 |
| 3 | `storage.search` (Storage listando arquivos) | 3.186 | 1.408 s | **442 ms** | **20,2 s** | 87 M |
| 4 | `get_session_context()` RPC | 208.405 | 1.311 s | 6,3 ms | **6,28 s** | 67 M |
| 5 | `orcamento_esta_vazio(uuid)` | 11.378 | 694 s | 61 ms | **5,17 s** | 6 M |
| 6 | `saldos_dos_dias_em_aberto(uuid)` | 1.549 | 538 s | 347 ms | 2,52 s | **53 M** |
| 7 | `set_config('search_path', ...)` (PostgREST por request) | 3.444.251 | 519 s | 0,15 ms | 2,97 s | 2 M |
| 8 | `trava_do_cancelamento_do_job(uuid)` | 6.823 | 225 s | 33 ms | **4,96 s** | 5 M |
| 9 | `registrar_alteracao_do_financeiro(uuid, jsonb)` | 76 | 14 s | 187 ms | **6,72 s** | 225 K |
| 10 | DO block anônimo (auditoria RLS impersonando 14 users) | 2 | 99 s | 49,5 s | **87,4 s** | 7 M |

### Pool de conexões e config

- `max_connections`: 90
- Uso atual típico: 6/90 (folgado)
- `shared_buffers`: 512 MB
- `effective_cache_size`: 1,5 GB
- `max_parallel_workers_per_gather`: 1
- `statement_timeout`: 120 s

### Publicação Realtime
Apenas 3 tabelas (minúsculas: 200kB, 152kB, 64kB): `notificacoes_dismissed`, `jobs_mensagens`, `freelancer_solicitacao_mensagens`. Mas o Realtime lê **todo** o WAL do banco (todas as escritas de todas as frentes) e filtra pelas publicações. É isso que gera os 3,5 milhões de execuções do rank 1.

---

## 5. Evidências no código (as 5 rotas prioritárias)

### 5.1. `/financeiro/contas-a-pagar` — P75 7s (CRÍTICO)

Arquivo: `app/(app)/financeiro/contas-a-pagar/page.tsx` (1098 linhas).

**Confirmado:**
- Promise.all principal com **44 queries em paralelo** (linhas 164-461).
- **6 chamadas de `todasAsLinhas()`** (linhas 168, 238, 251, 271, 372, 427): pedidos_compra, lançamentos (baixas), lançamentos (estornos), fornecedores, outras empresas, CNAB.
- `todasAsLinhas()` em `lib/supabase/todas-as-linhas.ts:39-45` itera páginas em um `for` com `await` sequencial — cada 1000 linhas extras = 1 round-trip serial (~50 ms).
- Segunda onda de queries DEPOIS do Promise.all principal (linhas 749-903), condicional.
- Terceira onda (fatura do cartão selecionado, linhas 896-900) também fora do Promise.all.
- `export const dynamic = "force-dynamic"` (linha 67) — remove cache Next.
- **23 arquivos filhos chamam `router.refresh()`** (pp-tela.tsx 5×, titulos-pagar-list.tsx 5×, revisar-folha-drawer.tsx 4×, chat-pps-conversa.tsx 1×, estornar/devolver/reabrir 1× cada, etc.). Cada ação = nova invocação Vercel re-executando as 44 queries + 6 `todasAsLinhas`.

**Case study relacionado (já corrigido parcialmente):** PERFORMANCE.md §7 — lista de PPs saiu de 1,07s → 150ms em 23/11 com migration de RLS (`20261120100001`). P75 atual de 7s sugere regressão ou crescimento de volume.

### 5.2. `/financeiro/conciliacao` — P75 4,8s (CRÍTICO)

Arquivo: `app/(app)/financeiro/conciliacao/page.tsx` (453 linhas).

**Confirmado:**
- Promise.all principal com 7 queries (linhas 117-173).
- `calcularSaldoAnterior()` roda **fora** do Promise.all quando a aba é Extrato (linhas 196-201). Serializa desnecessariamente.
- Loop `faturaIds.map(carregarExtratoDaFatura)` (linhas 286-302) — cada fatura paga vira 1 query separada, dentro de `Promise.all` secundário.
- `export const dynamic = "force-dynamic"` (linha 47).
- **22 `router.refresh()`** em client components de ações: aba-banco.tsx (15×), aba-titulos.tsx (7×), fechamento.tsx (2×), menu-novo-lancamento.tsx (3×).

**Case studies relacionados:** PERFORMANCE.md §5 (`vw_extrato_linhas` 210ms→36ms) e §6 (`saldos_dos_dias_em_aberto` 27ms/dia→10ms) — aplicados em 16-20/11. Regressão provável veio das entregas de 23/11 (decisão 276 — NFs da planilha, e decisão 211 — fechamento 3T).

### 5.3. `/jobs/[jobId]` — 11k inv / 20 min CPU / P75 1,3s (ALTO VOLUME)

Arquivos:
- `app/(app)/jobs/[jobId]/page.tsx` (863 linhas)
- `app/(app)/jobs/[jobId]/carregar-detalhe.ts` (2.245 linhas, **38 `.from()` + 1 `.rpc()` = 39 queries**)

**Confirmado:**
- 6 queries no Promise.all da page.tsx.
- `carregarDetalheDoJob()` tem 5 Promise.all aninhados (linhas 169, 252, 833, 1593, 1926 do carregar-detalhe.ts).
- Se `modelo_planilha === "midia_off"` adiciona 11 queries extras.
- `next/dynamic` usado em apenas 3 lugares: ver-pp-drawer, job-pps-section, painel-pps-item. **Abas não são lazy-loaded.**
- 3 subscriptions Realtime em client components: job-chat-section, job-pps-chat-section, job-pps-chat-fab.
- `force-dynamic` ativo.

11k invocações / 7 dias = ~80-100 aberturas de job por usuário/dia. Volume legítimo, não é abuso de prefetch.

### 5.4. `/orcamentos/[projetoId]/[orcId]` — 1,7k inv / P75 1,43s

Não aprofundado nesta auditoria. Case study §2 do PERFORMANCE.md já corrigiu lista de versões em jul/2026 (`<Link prefetch={false}>` + query agregada). Hipótese pendente: verificar se regrediu.

### 5.5. `/perfil` — 4k inv / P75 836ms

Arquivo: `app/(app)/perfil/page.tsx` (296 linhas).

**Confirmado:**
- Promise.all com 7 queries independentes (linhas 128-190) — correto.
- 4k invocações em 7 dias = ~3 acessos por usuário/dia (acima do esperado para uma página de perfil).
- Sub-rota `/perfil/equipe` criada em 2026-11-24 (commit `2346cbd5`).
- Hipótese: `<Link href="/perfil">` da sidebar sem `prefetch={false}` + viewport grande = prefetch toda vez que a sidebar renderiza.

---

## 6. Diagnóstico transversal

### 6.1. `router.refresh()` em excesso
**113 ocorrências** só em `app/(app)/financeiro/`. Cada chamada dispara re-render SSR completo da rota atual = nova invocação Vercel + re-execução de todas as queries. Pior ofensor: aba-banco.tsx (15×), aba-titulos.tsx (7×), titulos-pagar-list.tsx (5×), pp-tela.tsx (5×).

### 6.2. Realtime em 7 client components
- `rh/ferias/pill-novidades-ferias.tsx`
- `freelancers/_components/novidades-pill.tsx`
- `freelancers/solicitacoes/_components/chat-solicitacao.tsx`
- `financeiro/contas-a-pagar/chat/chat-pps-provider.tsx`
- `jobs/[jobId]/comunicacao/job-chat-section.tsx`
- `jobs/[jobId]/pps/job-pps-chat-section.tsx`
- `jobs/[jobId]/pps/job-pps-chat-fab.tsx`

Explica os 27.388 s de CPU acumulada no Postgres em `wal->>...`.

### 6.3. Zero `unstable_cache` no projeto
`grep -r "unstable_cache\|revalidateTag" app/` retorna 0 ocorrências. Em um sistema multi-tenant com cadastros estáveis (plano de contas, fornecedores, categorias, config), isso é oportunidade.

### 6.4. Middleware e Layout — OK
- `middleware.ts`: só `supabase.auth.getUser()` (~30 ms). Correto.
- `app/(app)/layout.tsx`: `requireSession()` (1 RPC) + `souMembroDoComite()` (1 query curta). ~40-60 ms. Correto.

### 6.5. Alterações recentes
Última semana (18-24/11) teve ~60 commits em frentes paralelas (RH, Fiscal, Férias, 13º, Freelancers, Rescisões). Commits que tocaram rotas críticas:
- `764b491f` — regras das NFs da planilha (decisão 276)
- `0f8b6d5f` — NF mensal fatura mês de emissão
- `2346cbd5` — `/perfil` virou layout com sub-rota `/perfil/equipe`

Nenhum commit em otimização de prefetch/revalidate. Hipótese: regressão provável por crescimento de volume e novas joins, não por mudança explícita de arquitetura.

---

## 7. O que já foi feito (2026-11-25, antes deste briefing)

**Aplicado:**
```sql
alter database postgres set work_mem = '8MB';  -- era 5MB
```
Via `ALTER DATABASE` (o Supabase gerenciado bloqueia `ALTER SYSTEM`). Persistido em `pg_db_role_setting`. Zero downtime. Pior caso teórico de RAM: 90 × 8 × 2 = 1,44 GB, ainda dentro dos 2 GB.

**Documentado em:** `docs/decisions/278-work-mem-e-plano-de-mitigacao-memory-pressure.md` + case study §8 em `docs/PERFORMANCE.md`.

**Esperado em 24-48h:** queda de ≥60% na taxa de criação de temp files por transação. Baseline gravado: 295.919 temp files / 1.287 GB / 15,28 M transações no momento da mudança.

---

## 8. Plano proposto (o que queremos revisar)

### Prioridade 1 — 2 dias de dev, ganho imediato nas duas telas críticas

**P1.1 — Paralelizar `todasAsLinhas()`** em `lib/supabase/todas-as-linhas.ts`
- Mudar o `for await` sequencial por lotes em `Promise.all` até encontrar página incompleta.
- Impacto esperado: elimina 500-900 ms de overhead em `/financeiro/contas-a-pagar`.
- Risco: baixo (contrato da função não muda).

**P1.2 — Mover `calcularSaldoAnterior` para o Promise.all principal** em `conciliacao/page.tsx`
- Discriminar `aba === "extrato"` dentro do Promise.all em vez de `await` depois.
- Impacto esperado: -100 a -300 ms.
- Risco: baixo.

**P1.3 — Otimizar `public.saldos_dos_dias_em_aberto(uuid)`**
- Função Postgres que lê 53 M blocos em 1.549 chamadas (média 347 ms, máx 2,5 s). `EXPLAIN (ANALYZE, BUFFERS)` + índice composto ou reescrita.
- Impacto esperado: reduz pressão de IO no banco.
- Risco: baixo (comparar resultado antes/depois).

### Prioridade 2 — 1-2 semanas, reduz carga sistêmica

**P2.1 — Substituir `router.refresh()` por `revalidatePath/Tag`** em 23 arquivos do financeiro
- Cada ação deixa de re-executar o SSR inteiro; só re-busca o que tem tag igual.
- Impacto esperado: **−50% a −70% das invocações Vercel** nas rotas financeiras.
- Risco: médio (muda padrão em 23 arquivos; precisa review por função).

**P2.2 — Lazy-load de abas** em `/jobs/[jobId]` com `next/dynamic`
- Abas raramente visitadas (`comunicacao`, `erratas`, `mídia-off`) viram lazy.
- Impacto esperado: -200 a -500 ms no P75.
- Risco: baixo (testar hidratação).

**P2.3 — `unstable_cache` em cadastros estáveis**
- `fornecedores`, `categorias`, `plano_de_contas`, `empresas`, `cliente_portais`, `fiscal_cnpj_da_pp_por_regional`, `comite_config`.
- Chave: `{tenant_id}:{nome_cadastro}`. Invalidar via `revalidateTag` quando muda.
- Impacto esperado: cadastros buscados a cada render viram cache (1-5 min).
- Risco: médio (cuidado com invalidação por RLS/permissão).

### Prioridade 3 — 1 mês+, saneamento estrutural

**P3.1 — Reduzir Realtime**
- Avaliar se `notificacoes_dismissed`, `jobs_mensagens`, `freelancer_solicitacao_mensagens` podem virar polling leve (30s).
- Impacto esperado: elimina maior consumidor isolado de CPU do Postgres (27.388 s).
- Risco: UX (chat ao vivo vira delay até 30s).

**P3.2 — Materializar `vw_saves_por_job`** + outras views pesadas
- `MATERIALIZED VIEW` com refresh periódico via cron.
- Risco: dados até 5 min desatualizados (combinar com stakeholders).

**P3.3 — Agregar RPCs do `carregar-detalhe.ts`**
- Juntar 39 queries em 3-5 RPCs que retornam JSON agregado.
- Risco: alto (RPCs grandes são difíceis de manter).

### Opção B — Upgrade de compute (+~$60/mês ≈ R$300/mês)

- Small (2 GB RAM) → Medium (4 GB RAM) no mesmo plano Pro.
- Permite `work_mem` 16-32 MB com folga, elimina Memory commitment SEVERE.
- Pré-requisito sugerido: fazer P1 primeiro; se P1 resolver, pode postergar B.

---

## 9. Matriz de decisão

| Se o problema é… | Faz… | Resolve em | Custa |
|---|---|---|---|
| "Usuária trava em contas-a-pagar" | P1 | 2 dias | 0 |
| "Preocupa inflar conta Vercel se crescer" | P1 + P2.1 | 2 semanas | 0 |
| "Quero parar de apagar incêndio" | P1 + Opção B | 2 dias + decisão | R$300/mês |
| "Quero estrutural" | P1 + P2 + P3 + Opção B | 1-2 meses | R$300/mês |
| "Não dá pra fazer nada agora" | só work_mem (já feito) | — | 0 |

---

## 10. Projeções de ganho (honestas)

| Rota | Hoje | Após work_mem | Após P1 | Após P1+P2 | Após Opção B solo |
|---|---|---|---|---|---|
| `/financeiro/contas-a-pagar` | 7,0 s | 6,0 s (-14%) | 2-3 s | 1,5-2 s | 3-4 s |
| `/financeiro/conciliacao` | 4,8 s | 4,2 s (-12%) | 1,5-2 s | 1-1,5 s | 2-2,5 s |
| `/jobs/[jobId]` | 1,3 s | 1,2 s (-8%) | 1,1 s | 0,7-0,9 s | 0,8-1 s |
| `/perfil` | 836 ms | 820 ms | 820 ms | 400-500 ms | 600-700 ms |
| Invocações Vercel/semana | 36k | 36k | 36k | 15-20k (-50%) | 36k |
| Memory commitment | SEVERE | SEVERE em picos | WARNING | NORMAL | NORMAL |

Essas projeções são baseadas em:
- Ganhos medidos de case studies anteriores (PERFORMANCE.md §4-§7).
- Observação de que `work_mem` sozinho alivia pressão mas não altera duração de telas que têm 44 queries por render.
- Estimativa de que P2.1 (revalidatePath) elimina ~60% dos `router.refresh()` no financeiro.

---

## 11. Perguntas específicas para quem for revisar

1. **A priorização está certa?** Faria sentido atacar P2.1 (`router.refresh → revalidate`) antes de P1 (`todasAsLinhas` paralelizado)? O argumento a favor é que P2.1 reduz invocações da Vercel de forma estrutural, o que se paga no médio prazo. O contra-argumento é que P1 tem efeito visível imediato para a usuária que está reclamando.

2. **Falta alguma causa raiz?** As causas identificadas são: (a) `work_mem` baixo, (b) `todasAsLinhas` sequencial, (c) `router.refresh()` abusivo, (d) Realtime lendo todo o WAL, (e) ausência de cache Next. O que mais pode estar escondido?

3. **O upgrade de compute (Opção B) deveria vir antes de P1?** Argumento: alivia tudo de uma vez enquanto o dev de P1 é feito. Contra-argumento: gasta R$300/mês para resolver sintoma sem atacar a causa de telas com 44 queries.

4. **P2.3 (`unstable_cache` em cadastros) tem risco de vazamento entre tenants?** A chave proposta é `{tenant_id}:{nome_cadastro}`. O padrão do projeto usa RLS no Postgres — o cache invalida esse contrato se a chave for errada. É aceitável ou melhor evitar cache totalmente?

5. **Materializar views (P3.2) com refresh de 5 min é aceitável para dados financeiros?** O time de produção aceita ver dados até 5 min desatualizados em vista agregada? Ou é mais seguro manter view normal e otimizar o SQL dela?

6. **A hipótese de que `pg_timezone_names` (3.077 chamadas, 1.909 s) é introspecção do PostgREST faz sentido?** Como confirmar? Vale desativar a introspecção?

7. **O DO block anônimo de auditoria RLS (87 s, 14 usuários impersonados) deveria ser bloqueado em horário comercial via algum mecanismo técnico (role separado, GRANT restrito)?** Ou confiar em acordo com a equipe?

8. **Falta algum padrão de design do Next 14 App Router que não está sendo usado?** `Suspense` com streaming? `parallel routes`? `intercepting routes`? Algum deles ataca especificamente o problema de "44 queries em paralelo, mas tudo espera a última"?

9. **A projeção de ganho está otimista?** Queríamos um segundo olhar nos números da tabela da seção 10 — especialmente se 7s → 2s é factível apenas com P1, ou se é otimismo exagerado.

10. **Alguma opção que não foi considerada?** Edge runtime em alguma rota específica? Fallback a leitura via `supabase-js` cliente em alguns casos? Separar o frontend em app estático + API só para dados mutáveis?

---

## 12. Restrições inegociáveis que o plano deve respeitar

Estas vieram do time e não podem ser quebradas pela segunda opinião:

- Nenhuma mudança pode comprometer RLS, autenticação ou autorização.
- Nenhuma mudança pode introduzir inconsistência financeira (DRE, contas a pagar/receber, fiscal).
- Nenhuma mudança pode restabelecer limites de registros que ocultem dados (ex.: cortar PPs na lista sem paginação explícita).
- Decisões arquiteturais já documentadas em `docs/decisions/` devem ser respeitadas (há 278 ADRs).
- Tabela operacional nova precisa de `tenant_id` + RLS + GRANT para `authenticated` + índice em FK.
- `service_role` só pode ser usado no servidor, nunca exposto ao navegador.

---

## 13. Conclusão que quero validar

Minha leitura hoje é: **P1 esta semana + Opção B em dezembro (se o orçamento couber)** resolve 90% do problema. P2 e P3 ficam como melhoria contínua para o próximo trimestre.

Discordam? Em que ponto específico?

Procurando contraponto técnico, não aprovação.
