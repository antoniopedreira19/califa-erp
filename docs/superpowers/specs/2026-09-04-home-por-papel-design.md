# Home por papel — Design

**Data:** 2026-09-04
**Motivação:** a home atual é estática — três cards de contexto ("Tenant ativo", "Seu papel", "Módulos ativos") e um roadmap de tasks que já foram entregues. Não puxa nada dos módulos, não sinaliza pendências, não serve pra decidir o que fazer no dia. Com as roles funcionando desde 03/09, é a hora de transformar a home em painel operacional que responde a pergunta "o que preciso fazer agora" — diferenciado por papel.

Este spec é a Task 7 do projeto de permissões ([spec anterior](2026-09-03-permissoes-e-papeis-design.md)), que ficou registrada como sessão futura.

---

## 1. Contexto e escopo

**Do que a home é:** primeira tela que carrega ao logar. Precisa ser rápida, útil e cirúrgica.

**Do que NÃO é:**
- Não é atalho pra criar coisa nova. Sem CTAs "Novo orçamento", "Nova conta".
- Não é feed de errata pendente. Errata é fluxo interno do módulo — não polui a home.
- Não é dashboard executivo de KPI vistoso. É painel operacional.

**Escopo desta versão:**
- 5 layouts (um por papel) numa mesma rota `/home`.
- Cards de pendência clicáveis (contagem 0 → some).
- Linha separada de KPIs "número do mês" (só pra ADM, GP, Produtor e Financeiro — Freelancer não).
- Filtros de URL nas telas de destino (`?filtro=vencidas`, `?filtro=aguardando_aprovacao` etc.). Se a tela de destino ainda não entende o filtro, o link aponta pra tela crua e implementar o filtro fica pra depois.

**Fora de escopo:**
- Feed de atividade recente / auditoria — outra sessão.
- Notificações push / realtime — outra sessão.
- Dashboard visual (gráficos, mini-charts) — depois que o layout estabilizar.
- Personalização por usuário (esconder cards, reordenar) — depois.

---

## 2. Regras gerais dos cards

Aplicáveis a TODOS os cards de pendência, em qualquer papel.

1. **Anatomia do card:**
   - Título curto ("Jobs aguardando abertura")
   - Contagem numérica grande no centro
   - Subtítulo com contexto ("Fila do financeiro")
   - Ícone à esquerda (opcional, coerente com o módulo destino)
2. **Card inteiro é clicável** (`<Link>` envolvendo), leva pra tela do módulo com filtro aplicado.
3. **`prefetch={false}`** em todos os cards da home — regra transversal `docs/PERFORMANCE.md`.
4. **Contagem 0 → some** (não renderiza). Evita cemitério visual.
5. **Todas as contagens zeradas** → estado vazio único: "Tudo em dia por aqui." com ícone amistoso.
6. **KPIs em linha separada**, com estilo visual diferente (card menor, número em destaque, subtítulo com "no mês" / "hoje"). Não somem quando são 0 — número zero é informação.
7. **Ordenação dos cards de pendência:** por prioridade percebida (vencidos primeiro, aguardando aprovação depois, contexto por último). Ordem fixa no código; sem reordenação por contagem.

---

## 3. Definição de "Meus" na home (dividida por natureza do card)

Aplicável a GP, Produtor e Freelancer. ADM e Financeiro veem o tenant inteiro em todos os cards.

**Cards de ação** (você precisa executar) — **filtro estrito**:
- Só onde o usuário é responsável direto: `jobs.responsavel_id`, `jobs.produtor_id`, `orcamentos.gp_responsavel_id`, `orcamentos.produtor_id`, `versoes_orcamento.gp_responsavel_id` (via `orcamento_id → orcamentos.gp_responsavel_id`).
- Objetivo: quando o número aparece, TODOS os itens são acionáveis por você. Sem frustração ao clicar.

**Cards de contexto** (informação do time onde você participa) — **filtro expandido**:
- Qualquer entrada em `projeto_responsaveis` (papel `gp` OU `equipe`) OU derivado (criador do projeto, produtor de algum orçamento).
- Objetivo: contextualizar o volume do time, sem prometer que você é o dono de cada item.

**Freelancer:** o RLS já filtra tudo pros projetos onde ele consta em `projeto_responsaveis`. Então "expandido" e "estrito" convergem — ele só vê o próprio universo.

O código concreto: helper `escopoMeus(session, tipo: "estrito" | "expandido")` que devolve uma cláusula SQL (via subquery ou array de IDs) pronta pra encaixar em `.in(...)` da query Supabase.

---

## 4. Cards por papel

Legenda: (E) = filtro estrito · (X) = filtro expandido · (T) = tenant inteiro (sem filtro Meus)

### 4.1 Administrador

**Pendências (grid principal):**

| # | Card | Consulta | Destino ao clicar |
|---|---|---|---|
| 1 | Contas a pagar vencidas | (T) `count(contas_pagar where vencimento < hoje and status != 'paga')` | `/financeiro/contas-a-pagar?filtro=vencidas` |
| 2 | Contas a receber vencidas | (T) `count(contas_receber where vencimento < hoje and status != 'recebida')` | `/financeiro/contas-a-receber?filtro=vencidas` |
| 3 | Jobs aguardando abertura financeira | (T) `count(jobs where status = 'aguardando_abertura')` | `/financeiro/abertura-de-job` |
| 4 | PPs em avaliação | (T) `count(pedidos_compra where status = 'em_avaliacao')` | `/financeiro/contas-a-pagar?filtro=pps_em_avaliacao` |
| 5 | Desembolsos em avaliação | (T) `count(desembolsos where status = 'em_avaliacao')` | `/financeiro/desembolsos?filtro=avaliacao` |
| 6 | Transações não conciliadas | (T) `count(conciliacao_transacoes where conciliada = false)` | `/financeiro/conciliacao` |
| 7 | Jobs com faturamento previsto ≤7d | (T) `count(jobs where data_prevista_faturamento between hoje and hoje+7 and status = 'aberto')` | `/jobs?filtro=faturamento_proximo` |
| 8 | Orçamentos parados >15d | (T) `count(orcamentos where status in ('em_revisao','enviado_cliente') and updated_at < hoje-15d)` | `/orcamentos?filtro=parados` |

**KPIs (linha inferior, 4 cards menores):**

| # | KPI | Consulta | Destino ao clicar |
|---|---|---|---|
| 1 | Saldo em bancos hoje | `sum(conta_bancaria.saldo where ativo)` | `/financeiro/fluxo-caixa` |
| 2 | Previsto a pagar do mês | `sum(contas_pagar.valor where vencimento in mes_corrente and status != 'paga')` | `/financeiro/contas-a-pagar` |
| 3 | Previsto a receber do mês | `sum(contas_receber.valor where vencimento in mes_corrente and status != 'recebida')` | `/financeiro/contas-a-receber` |
| 4 | Jobs em andamento | `count(jobs where status in ('aberto','em_producao'))` | `/jobs` |

### 4.2 Gerente de Produção

**Pendências:**

| # | Card | Escopo | Consulta base | Destino |
|---|---|---|---|---|
| 1 | Versões aguardando MINHA aprovação | E | `count(versoes_orcamento where status in ('em_revisao','enviada_cliente') and orcamento.gp_responsavel_id = eu)` | `/orcamentos?filtro=aguardando_aprovacao&meus=1` |
| 2 | Meus jobs prontos pra enviar pra faturamento | E | `count(jobs where responsavel_id = eu and status = 'aberto' and faturamento_previsto > 0 and abertura_em_revisao != true and not exists envio ativo)` | `/jobs?filtro=faturamento_pronto&meus=1` |
| 3 | Meus jobs prontos pra encerrar | E | `count(jobs where responsavel_id = eu and status = 'aberto' and existe envio de faturamento emitido e sem impedimentos)` | `/jobs?filtro=encerrar_pronto&meus=1` |
| 4 | Jobs com faturamento previsto ≤7d | X | `count(jobs where projeto in meus_projetos and data_prevista_faturamento between hoje and hoje+7 and status = 'aberto')` | `/jobs?filtro=faturamento_proximo&meus=1` |
| 5 | Chat: mensagens não lidas | X | `sum(jobs_mensagens não lidas where job in jobs_visiveis_por_projeto_participa)` | `/jobs?filtro=chat_pendente&meus=1` |

**KPIs:**

| # | KPI | Escopo | Consulta |
|---|---|---|---|
| 1 | Meus jobs em andamento | X | `count(jobs where projeto in meus_projetos and status in ('aberto','em_producao'))` |
| 2 | Meus orçamentos abertos | X | `count(orcamentos where projeto in meus_projetos and status in ('rascunho','em_revisao','enviado_cliente'))` |

### 4.3 Produtor

**Pendências:**

| # | Card | Escopo | Consulta base | Destino |
|---|---|---|---|---|
| 1 | Minhas PPs rejeitadas (reenviar) | E | `count(pedidos_compra where emitido_por = eu and status = 'rejeitada')` | `/jobs?filtro=pps_rejeitadas&meus=1` |
| 2 | Meus jobs com realizado pendente | E | `count(jobs where responsavel_id = eu or produtor_id = eu, status in ('aberto','em_producao') and existe item sem realizado)` | `/jobs?filtro=realizado_pendente&meus=1` |
| 3 | Chat: mensagens não lidas | X | (mesma consulta do GP) | `/jobs?filtro=chat_pendente&meus=1` |

**KPIs:**

| # | KPI | Escopo | Consulta |
|---|---|---|---|
| 1 | Meus jobs em andamento | X | `count(jobs where projeto in meus_projetos and status in ('aberto','em_producao'))` |
| 2 | PPs que emiti este mês | E | `count(pedidos_compra where emitido_por = eu and emitida_em in mes_corrente)` |

### 4.4 Freelancer

O escopo "expandido" pra ele = tudo que ele vê (RLS já filtra).

**Pendências:**

| # | Card | Consulta | Destino |
|---|---|---|---|
| 1 | Realizado a preencher | `count(jobs_itens_realizado where job.projeto_id in meus_projetos_participa and total_realizado is null)` | `/jobs?filtro=realizado_pendente` |
| 2 | Chat: mensagens não lidas | `sum(jobs_mensagens não lidas where job in jobs_visiveis)` | `/jobs?filtro=chat_pendente` |

**KPIs:**

| # | KPI | Consulta |
|---|---|---|
| 1 | Meus jobs ativos | `count(jobs where projeto in meus_projetos_participa and status in ('aberto','em_producao'))` |

Sem outros KPIs. Se `Meus jobs ativos = 0`, aparece estado vazio explícito: **"Nenhum job atribuído a você ainda. Fale com o gestor do projeto."**

### 4.5 Financeiro

**Pendências:**

| # | Card | Consulta | Destino |
|---|---|---|---|
| 1 | Contas a pagar vencidas | (T) mesma da ADM | `/financeiro/contas-a-pagar?filtro=vencidas` |
| 2 | Contas a receber vencidas | (T) mesma da ADM | `/financeiro/contas-a-receber?filtro=vencidas` |
| 3 | Jobs aguardando abertura | (T) mesma da ADM | `/financeiro/abertura-de-job` |
| 4 | PPs em avaliação | (T) mesma da ADM | `/financeiro/contas-a-pagar?filtro=pps_em_avaliacao` |
| 5 | Desembolsos em avaliação | (T) mesma da ADM | `/financeiro/desembolsos?filtro=avaliacao` |
| 6 | Transações não conciliadas | (T) mesma da ADM | `/financeiro/conciliacao` |
| 7 | Faturas de cartão aguardando pagamento | (T) `count(faturas_cartao where status = 'fechada' and data_pagamento is null)` | `/financeiro/contas-a-pagar?filtro=faturas_cartao` |

**KPIs (3 cards menores):**

| # | KPI | Consulta | Destino |
|---|---|---|---|
| 1 | Saldo em bancos hoje | mesma da ADM | `/financeiro/fluxo-caixa` |
| 2 | Previsto a pagar do mês | mesma da ADM | `/financeiro/contas-a-pagar` |
| 3 | Previsto a receber do mês | mesma da ADM | `/financeiro/contas-a-receber` |

---

## 5. Arquitetura

### 5.1 Estrutura de arquivos

```
app/(app)/home/
  page.tsx                    ← server component; requireSession; roteia por role
  home-admin.tsx              ← server component; renderiza cards do ADM
  home-gerente-producao.tsx   ← server component; renderiza cards do GP
  home-produtor.tsx           ← server component; produtor
  home-freelancer.tsx         ← server component; freelancer
  home-financeiro.tsx         ← server component; financeiro
  _componentes/
    card-pendencia.tsx        ← client (só `<Link>` clicável)
    card-kpi.tsx              ← server; sem interação
    estado-vazio.tsx          ← "Tudo em dia por aqui."
lib/home/
  carregar.ts                 ← funções que retornam { contagem, destino } por card
                                agrupadas por papel; cada uma faz `Promise.all` interno
  escopo-meus.ts              ← helper que devolve set de projetoIds "meus_projetos"
                                pra encaixar em `.in(...)`; expandido ou estrito
```

### 5.2 Fluxo

1. `page.tsx` chama `requireSession()`.
2. Baseado em `session.activeRole`, importa lazy o componente específico (`import { HomeAdmin } from "./home-admin"`).
3. O componente do papel chama `carregarHome<Papel>(session)` de `lib/home/carregar.ts`.
4. `carregarHome<Papel>` faz **um único `Promise.all`** com todas as queries agregadas do papel.
5. Devolve `{ pendencias: CardPendencia[], kpis: CardKpi[] }`. Cada `CardPendencia` tem `{ titulo, contagem, subtitulo, href, icone }`.
6. Componente renderiza filtrando pendências com `contagem > 0`. Se `pendencias.length === 0`, mostra `<EstadoVazio />`.
7. Renderiza KPIs em linha separada (sempre — mesmo com 0).

### 5.3 Escopo "Meus" via subquery

Uma função em `lib/home/escopo-meus.ts`:

```ts
async function projetoIdsDoUsuario(
  session: SessionContext,
  supabase: SupabaseClient,
): Promise<string[]> {
  // Union das 3 fontes:
  // 1. projeto_responsaveis (qualquer papel: gp ou equipe)
  // 2. projetos.created_by = eu
  // 3. produtor de algum orcamento OU gp_responsavel de algum orcamento no projeto
  // Devolve array de UUIDs distintos.
}
```

Cada query de card que precisa de escopo expandido chama essa função uma vez (memoizada dentro do `Promise.all` via variável local), e o array vai pro `.in("projeto_id", ids)` das queries subsequentes.

Escopo estrito: as queries filtram diretamente por `responsavel_id = session.profile.id` etc., sem passar por `projetoIds`.

### 5.4 URLs de destino

Vários cards apontam pra telas com `?filtro=<slug>` que **ainda não existe**. Estratégia:
- Link segue como projetado.
- Task de implementação inclui **fase de aterrissagem**: pra cada `?filtro=` novo, ler o slug no server component da tela destino e aplicar. Se a tela destino ainda não sabe o filtro, ignora e mostra a lista completa (link ainda funciona, só não filtra).
- Filtros novos que precisam nascer nas telas destino:
  - `/financeiro/contas-a-pagar?filtro=vencidas`
  - `/financeiro/contas-a-pagar?filtro=pps_em_avaliacao`
  - `/financeiro/contas-a-pagar?filtro=faturas_cartao`
  - `/financeiro/contas-a-receber?filtro=vencidas`
  - `/financeiro/desembolsos?filtro=avaliacao`
  - `/jobs?filtro=faturamento_proximo`
  - `/jobs?filtro=faturamento_pronto`
  - `/jobs?filtro=encerrar_pronto`
  - `/jobs?filtro=chat_pendente`
  - `/jobs?filtro=realizado_pendente`
  - `/jobs?filtro=pps_rejeitadas`
  - `/orcamentos?filtro=parados`
  - `/orcamentos?filtro=aguardando_aprovacao`

Task 3 do plano cobre esses filtros — mas é fase secundária, não bloqueia a home ir pro ar.

---

## 6. Performance

Análise contra [docs/PERFORMANCE.md](../../PERFORMANCE.md).

| Item | Impacto | Mitigação |
|---|---|---|
| N queries agregadas | ADM tem 12 queries (8 pendências + 4 KPIs) | Todas em `Promise.all`. Cada é `count`/`sum` agregado — sem embed pesado. Ver regra C. |
| Query de projetoIds (escopo expandido) | 3-4 subqueries em union | Rodada uma vez por request, memoizada. Array cabe em memória (dezenas de projetos). |
| `<Link>` em vários cards | Prefetch em viewport | `prefetch={false}` em TODOS os cards. Regra A. |
| `force-dynamic` da rota | Já existe implicitamente por `cookies()` | Manter. Regra G. |
| Cache Next entre navegações | RSC cacheia se rota estável | Aceita — dados de home ok cachear alguns segundos. Regra F: `loading.tsx` já herdado do `(app)/loading.tsx`. |

**Target de TTFB warm:** < 300ms. Se algum papel passar disso na home, revisar a query mais pesada (provavelmente contas a pagar/receber com filtro de datas).

---

## 7. Fatiamento em tasks

### Task 1 — Helper de escopo "Meus" e componentes visuais base

**Escopo:**
- Criar `lib/home/escopo-meus.ts` com `projetoIdsDoUsuario(session, supabase)` — union de `projeto_responsaveis` + `projetos.created_by` + orçamentos derivados.
- Criar `app/(app)/home/_componentes/card-pendencia.tsx`, `card-kpi.tsx`, `estado-vazio.tsx`.
- Estilo alinhado com o resto do ERP (Tailwind + shadcn/ui + californa-red).

**Verificação:** componentes renderizam standalone com props mockadas. Helper testado com Antonio (admin) e freelancer_teste (deve devolver 1 projeto pro segundo).

### Task 2 — Home por papel: ADM, Financeiro, Freelancer

**Escopo:**
- `lib/home/carregar.ts` — funções `carregarHomeAdmin`, `carregarHomeFinanceiro`, `carregarHomeFreelancer`. Cada uma faz um `Promise.all` interno.
- `home-admin.tsx`, `home-financeiro.tsx`, `home-freelancer.tsx` — server components que consumem essas funções.
- `page.tsx` roteando por role. Fallback pra "home genérica em construção" se role não conhecida.

**Verificação:** logar como Antonio (admin) e como freelancer_teste — cards apropriados aparecem, contagens batem com queries diretas via MCP.

### Task 3 — Home por papel: GP e Produtor

**Escopo:**
- Adicionar `carregarHomeGerenteProducao`, `carregarHomeProdutor` em `lib/home/carregar.ts`.
- `home-gerente-producao.tsx`, `home-produtor.tsx`.
- Adicionar rotas ao `page.tsx`.

**Verificação:** logar como `gp_teste` e `produtor_teste`.

### Task 4 — Filtros de aterrissagem nas telas destino

**Escopo:**
- Pra cada `?filtro=X` documentado na seção 5.4, adicionar o parse no `page.tsx` da tela destino e aplicar filtro na query.
- Se o filtro não estiver documentado ou não fizer sentido pra aquela tela, ignora com `console.warn` (dev only).

**Verificação:** clicar em cada card da home e conferir que a tela destino chega já filtrada.

### Task 5 — Testes com 4 usuários

**Escopo:**
- Logar como cada um dos 4 usuários teste (`gp_teste`, `produtor_teste`, `freelancer_teste`, `financeiro_teste`) e conferir contagens.
- Documentar edge cases descobertos em `docs/HANDOFF.md`.

---

## 8. Fora de escopo desta versão

- Feed de auditoria / atividade recente
- Notificações push / realtime (badge que atualiza sozinho)
- Personalização (esconder/reordenar cards)
- Gráficos e mini-charts
- Comparativo com mês anterior nos KPIs
- Home diferente pra admin de outro tenant (multi-tenant real)
- Errata como card de pendência (fluxo interno de módulo)
- Atalhos "criar novo"

---

## 9. Riscos e como mitigar

| Risco | Prob. | Impacto | Mitigação |
|---|:---:|:---:|---|
| Query de contas a pagar/receber ficar lenta se volumes grandes | Média | Médio | Cada query é `count`/`sum` com WHERE indexado; se lento, adicionar índice funcional em `vencimento`. |
| Freelancer sem projeto vinculado ver home vazia genérica | Baixa | Baixo (UX) | Estado vazio específico: "Nenhum job atribuído a você ainda. Fale com o gestor". |
| Cards `?filtro=X` com filtro não implementado ainda no destino | Alta | Baixo | Link ainda funciona; tela mostra lista sem filtro. Task 4 fecha isso separadamente. |
| Escopo "Meus expandido" trazer projetos que o usuário esqueceu que participava | Baixa | Baixo | Ajuste vindo de uso real; pode reverter pra estrito se der falso positivo demais. |
| Contagem de "chat: mensagens não lidas" ficar cara | Média | Médio | Fazer via `count` com `join` em `jobs_chat_leituras`; se lento, cachear por 1 min ou virar realtime. Fase seguinte. |
