# Handoff — California ERP

Documento para dar continuidade ao projeto em uma nova sessão de trabalho.

**Última atualização** (2026-07-31): Task 008 Jobs + Realizado + polish. `/jobs` vira lista real com filtros/busca (substitui placeholder); `/jobs/[jobId]` ganha abas **Informações do Job** / **Rentabilidade** com planilha ORCADO/PLANEJADO/REALIZADO editável + card de totais com Variação vs Planejado e Resultado Real. Nova tabela `jobs_itens_realizado` (1:1 job × item da versão aprovada, GENERATED total). Server action `upsertItemRealizado` com gates status/ownership/tenant + audit `job.realizado_atualizado`. Padronização de largura (`max-w-7xl` em todas telas de detalhe/planilha) e header (icon+kicker+title em 8 páginas) documentada em `docs/09-identidade-visual-ui.md`. Fix embed self-FK do PostgREST (pai vinha como array — "Sub-job de: ·" bug). Timings temporários removidos.

## 0. LEIA PRIMEIRO — ação pendente no início da sessão

Antes de qualquer coisa:

1. **`docs/PERFORMANCE.md` é obrigatório**. Toda mudança em `app/(app)/**` ou `lib/supabase/**` passa pelo checklist do guia. Já custamos 2 regressões severas por não respeitar isso — não repita. `CLAUDE.md` também tem as regras não-negociáveis no topo.

2. **`docs/09-identidade-visual-ui.md`**: leia as seções **"Larguras de layout (padrão)"** e **"Header padrão da página"** antes de criar/editar qualquer page. Só 3 larguras permitidas (`max-w-3xl` form / `max-w-7xl` detalhe / `max-w-2xl` texto) e todo header tem icon+kicker/breadcrumb+title. Sair do padrão sem justificativa é dívida técnica.

3. **Fixes de perf ainda válidos (não regride):**
   - `prefetch={false}` nos `<Link>` das listas de versão, orçamento, cliente, fornecedor, job.
   - Página do orçamento não usa embed pesado pra calcular totais de versões — trocado por query agregada.
   - `force-dynamic` permanece nas pages autenticadas (**não remova** — funciona como freio de prefetch descontrolado, ver `docs/PERFORMANCE.md` seção G).
   - Timings `console.log("[*.timing]")` que existiam em 3 arquivos foram removidos em 2026-07-31 (diagnóstico concluído).

## 1. Onde estamos

**Deploy:** projeto no Vercel (`calif-erp`), branch `main`. Domínio de produção: `https://www.sistemacalifa.com.br`.
Backend: Supabase project `avlwxyknvhlzvnysbzrg` (`https://avlwxyknvhlzvnysbzrg.supabase.co`).
Admin cadastrado: `antonio@pevetech.com.br` (role `administrador` no tenant `agencia-california`).

**Local (Git):** working tree limpo, sincronizado com `origin/main`.

**Últimos commits relevantes (2026-07-31, sessão Task 008 + polish):**
- `4acc3d6` — fix(jobs): PostgREST embed self-referencial de pai retorna array — normaliza pra objeto (bug "Sub-job de: ·")
- `8123c1d` — ux: header padrão com icone+kicker+titulo em todas as páginas + doc
- `3b6df06` — ux: padroniza largura max-w-7xl em detalhe/planilha + doc do padrão
- `34e4bb2` — task008 ux: abas Info/Rentabilidade + largura 7xl + colunas do Item/Tipo
- `1c2c2ef` — docs(task008): spec + implementation plan for Jobs + Realizado
- `1787a5c` — task008 fix: reset finalizado ref between edits + audit status denial
- `922c63f` — task008 final review: QA end-to-end + HANDOFF
- `d5042aa` — task008: card de totais do job (Orçado × Planejado × Realizado + resultado real)
- `3fee522` — task008: tabela do realizado com click-to-edit + upsert via server action
- `9096549` — task008: seção Realizado no /jobs/[jobId] com card por grupo (stub de tabela)
- `1378a25` — task008: substitui placeholder de /jobs por lista real com filtro e busca
- `19bf21f` — task008: server action upsertItemRealizado com gates status/ownership
- `471990d` — task008: helpers calcularTotaisRealizado + calcularVariacao
- `71f5aec` — task008: migration jobs_itens_realizado + type + audit action

**Commits anteriores (2026-07-29, ciclo Task 005):**
- `e5be821` — fix(datepicker): popover fixo (`side=bottom`, `avoidCollisions=false`, `w-[300px]`, `fixedWeeks`)
- `f75d072` — feat(versoes): botão Aprovar direto na lista de versões (ícone `CheckCircle2` verde ao lado de Duplicar)
- `a4ca8f5` — task005 final review: `Orcamento.versao_aprovada_id` no type + audit `acao_negada` em denials financeiros
- `9042f86` — task005: sidebar ganha entradas Jobs e Financeiro (com role gate `roles: AppRole[]`)
- `d5cfc52` — task005: Central Financeira + Jobs Aguardando Abertura
- `96b4bd3..ab6bab0` — task005: `/jobs/[jobId]` (metadata + editor + hierarquia + status + aprovação contextual)
- `41490d9` — feat(categorias): categorias de domínio pra projeto e orçamento
- `c6ccb75` — merge Task 007 (Projetos como guarda-chuva)
- `d199df1` — task007 final review: fix export route + code helpers + drawer refresh + list nav

**Migrations aplicadas no Supabase (via MCP):**

```
20260721000001  task001_fundacao_auth_seguranca
20260721000002  task001_hardening_advisors
20260721000003  task001_grants_authenticated
20260722000001  task002_clientes_fornecedores
20260723000001  task003_orcamentos
20260723000002  rename_gp_responsavel_para_responsavel
20260724000001  task004_versoes_orcamento
20260724000002  task004_grupos_de_itens
20260726000001  task004_orcamento_importacoes
20260728000001  task004_categoria_e_planejado
20260728000002  task007_projetos
20260729000002  task005_jobs
20260730000001  task008_jobs_realizado
20260730000003  cidades (cadastro)
20260730000004  produtos_cliente_e_faturamento_job
```

**Todas as migrations aplicadas.** Última: `20260730000004_produtos_cliente_e_faturamento_job` (fluxo Abertura de Job).

## 2. O que já está pronto (Tasks 001 – 004)

### Task 001 — Fundação
- `tenants`, `profiles`, `tenant_members`, `audit_events` com RLS.
- Helpers `is_tenant_member`, `is_tenant_admin`, `current_tenant_ids`.
- Trigger `handle_new_user` popula `profiles` no signup.
- RPC `log_audit_event` (SECURITY DEFINER).
- Middleware protegendo rotas privadas + `requireSession()`.
- Tela de login com identidade California.
- Layout interno + sidebar com transição contínua.

### Task 002 — Cadastros
- `clientes` (PJ) e `fornecedores` (PF/PJ).
- CPF/CNPJ opcional com validação de dígito no app.
- Hub `/cadastros` com cards (contagem de ativos).
- Listagens com busca, filtros por status, soft-delete (inativar/reativar).
- Auditoria em criar/editar/inativar.

### Task 003 — Orçamentos
- `orcamentos` com FK para cliente e responsável (profile), enum de status.
- Auto-geração de código `ORC-NNNN`.
- Rename cosmético: `gp_responsavel_id` → `responsavel_id`.
- Detalhe do orçamento com metadata compacta + drawer editar + card de versões.

### Task 004 — Versões, itens, importação, categoria e planejado
- `versoes_orcamento`, `versoes_orcamento_grupos`, `versoes_orcamento_itens`.
- Regras de banco: um grupo por (versão, nome) case-insensitive, uma versão aprovada por orçamento (unique parcial), `total_orcado` GENERATED (valor × qtd × dias/meses).
- ALTER em `orcamentos`: `versao_aprovada_id`, `aprovado_em`, `aprovado_por`.
- UI: criar/duplicar/cancelar versão, CRUD de grupos, CRUD de itens (drawer).
- Página `/orcamentos/[id]/versoes/[versaoId]` com layout de planilha (grupos → itens) + card de totais.
- **Cálculos corretos**: Honorários = (A+B+D) × %, Impostos = (B+C+Honor) × taxa/(1-taxa) (gross-up), Faturamento = total + honor + imposto.
- Helper compartilhado `lib/calculos/versao-totais.ts` — card e export usam o mesmo cálculo.
- Export XLSX via ExcelJS replicando layout da planilha padrão.
- **Fase F — Importação de planilha**: drawer com upload/preview/confirmar, parser da aba "Oficial", bucket privado `orcamento-importacoes`, tabela `orcamento_importacoes` com warnings JSONB.
- **Fase G — Categoria por versão + PLANEJADO**:
  - Tabela `versoes_orcamento_categorias` (escopo por versão, mesmo padrão de grupos). Botão "Nova categoria" no header ao lado de "Novo grupo".
  - Item ganha `categoria_id` (opcional) + 4 campos planejados (`valor_unitario_planejado`, `quantidade_planejada`, `dias_meses_planejado`, `total_planejado` GENERATED).
  - Drawer de item tem dropdown de categoria e bloco Planejado (fundo azul).
  - Tabela de itens tem 13 colunas (orçado + planejado + categoria + bloco Rentabilidade em R$ e %) — detalhes em [`HANDOFF_ORCAMENTO.md`](../HANDOFF_ORCAMENTO.md), Entrega 3.
  - Card de totais reescrito neste ciclo — detalhes em [`HANDOFF_ORCAMENTO.md`](../HANDOFF_ORCAMENTO.md), Entrega 3.
  - Parser lê col B (categoria) e cols I-K (planejado); confirmarImportacao cria categorias em bulk.
  - Duplicar versão copia categorias (com map old→new) e campos planejados.
  - Helper `calcularTotaisPlanejados` em `lib/calculos/versao-totais.ts`.
- **Fase G' — Catálogo global de categorias**: substituiu `versoes_orcamento_categorias` (por versão) por `categorias` (tenant), com CRUD em `/categorias` gerenciado pelo hub `/cadastros`. Todos os membros criam/editam; só admin inativa/reativa. Import não lê mais categoria da planilha; classificação é feita pelo GP no drawer de item. Duplicação de versão preserva categoria_id.

### Task 007 — Projetos como guarda-chuva de orçamentos
- Nova tabela `projetos` (código formato `AAA-NNNN/YY` — prefixo do cliente + sequencial por cliente/ano + ano 2 dig).
- `clientes` ganha `codigo_curto` (2-6 letras uppercase, único por tenant, backfill das primeiras 6 letras do `nome_fantasia`).
- `orcamentos`: adicionou `projeto_id` NOT NULL, removeu `cliente_id`, `responsavel_id`, `campanha` (subiram pro projeto).
- Cliente e responsável agora vivem no projeto; herdados por embed em orçamentos e jobs.
- Código do orçamento passa a ser `[CODIGO_PROJETO]-NN` (ex: `AMB-0003/26-01`). Códigos antigos `ORC-0001/0002` mantidos.
- Rotas reestruturadas: `/orcamentos` = lista de projetos; `/orcamentos/[projetoId]` = detalhe do projeto (com card de orçamentos); `/orcamentos/[projetoId]/[orcId]` = detalhe do orçamento (com versões); `/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]` = detalhe da versão.
- Sidebar continua com uma entrada só "Orçamentos" — a hierarquia interna é o único que muda.
- Server actions com defense-in-depth: UPDATE de orçamento filtra por `projeto_id` também (não só `id + tenant_id`).
- Backfill criou 1 projeto "teste" agrupando os 3 orçamentos existentes (mesmo cliente Pevetech).
- Migration `20260728000002_task007_projetos.sql`.

### Task 007+ — Categorias de Domínio (projeto e orçamento)
- Nova tabela `categorias_dominio` (escopo enum `projeto | orcamento`, tenant-wide).
- Design de tabela única com coluna escopo (não duas tabelas separadas — 1 CRUD, admin unificado, novo escopo = novo enum value).
- `projetos.categoria_id` (FK nullable) + `orcamentos.categoria_id` (FK nullable). Coluna antiga `orcamentos.tipo` (texto livre) removida.
- Admin em `/cadastros/categorias-dominio` (tabs Projeto/Orçamento/Todos) — mesmo padrão do CRUD de `categorias` de itens.
- Seed inicial no tenant Agência California:
  - Projeto: `Fee`, `Projeto proprietário`, `Ativação`, `Evento`, `Campanha`.
  - Orçamento: `Always On`, `Mídia`, `Evento`, `Influencer`, `Extra`.
- Dropdown "Categoria" (com opção "Sem categoria" usando sentinel `__none__` — Radix não aceita `value=""`) em ProjetoForm e OrcamentoForm.
- Coluna Categoria em `<ProjetosList>` e `<OrcamentosList>`; metadata em ambas as pages de detalhe.
- Migration `20260728000003_categorias_dominio.sql`.

### Task 008 — Jobs + Realizado
- **Lista `/jobs`**: substitui placeholder. Colunas Codigo/Nome/Projeto/Cliente/Responsavel/Inicio/Valor/Status. Chips de filtro por status + busca por nome/codigo (client-side). Linha inteira clicavel (regra da memory). Sub-jobs aparecem como linhas separadas com badge `Sub-job → JOB-XXXX`.
- **Extensao `/jobs/[jobId]`**: depois do card Status, nova secao "Planilha do job · v{N}" com link pra versao aprovada. Se status `aguardando_abertura` ou `rejeitado_financeiro`, card cinza informativo no lugar da planilha.
- **Tabela do realizado**: cards de grupo (herda da versao aprovada). Grade com 4 blocos:
  - ORCADO (RO): R$ Unit / QT / D-M / Total (cinza-escuro)
  - PLANEJADO (RO): R$ Unit / QT / D-M / Total (azul)
  - REALIZADO (edit): R$ Unit / QT / D-M / Total (ambar novo — `#fef3c7`/`#d97706`)
  - VARIACAO: R$ / % (verde se economia, vermelho se estouro)
  Click-to-edit apenas no bloco REALIZADO. `Enter` confirma, `Esc` cancela, `Blur` autosalva. Subtotal por grupo no tfoot.
- **Regras de edicao**:
  - Editar: `job.status ∈ {aberto, em_producao}`. Bloqueado em finalizado/cancelado/aguardando/rejeitado.
  - Ownership: `session.activeRole === 'administrador'` OU `job.responsavel_id === session.profile.id`. Financeiro nao edita realizado (so consulta).
  - Falha por ownership registra `audit.acao_negada` com metadata da acao tentada.
- **Card de totais do job**: 3 camadas (por grupo, por Tipo A/B/C/D, resumo Honorarios/Impostos/Faturamento) + camada 4 nova com Total Realizado / Variacao vs Planejado / Resultado Real (Faturamento − Impostos − Realizado). Verde se ≥ 0, vermelho se < 0.
- **Modelagem**: tabela `jobs_itens_realizado` (1:1 job x item da versao aprovada). Unique parcial `(job_id, item_id)`. `total_realizado` GENERATED. FKs `on delete cascade` (job cancelado nao deleta linha; realizado historico preservado enquanto job existir). Preparada pra virar origem de `pedidos_compra` e `titulos_financeiros` em tasks futuras.
- **Audit**: `job.realizado_atualizado` com metadata `{ item_id, campo, valor_novo, valor_anterior }`.
- Migration `20260730000001_task008_jobs_realizado.sql`.

### Task 005 — Aprovação de versão (Fase E) + Jobs + Central Financeira
- **Aprovação de versão** (`aprovarVersao(versaoId)`):
  - Valida versão em `rascunho|em_revisao|enviada_cliente`, orçamento não em `job_criado|aprovado|cancelado`, ≥1 item.
  - Update versão pra `aprovada` (trigger `cascata_versao_aprovada` no banco cascata as outras versões pra `substituida`).
  - Update orçamento pra `aprovado` com `versao_aprovada_id`, `aprovado_em`, `aprovado_por`.
  - Audit `versao_orcamento.aprovada`.
- **Desaprovação** (`cancelarAprovacaoVersao(versaoId)`):
  - Só permitido se orçamento `aprovado` E sem job ativo (status != cancelado).
  - Reverte versão pra `em_revisao`, limpa aprovado_em/por; reverte outras versões `substituida` pra `em_revisao`; reverte orçamento pra `em_revisao`.
  - Audit `versao_orcamento.aprovacao_cancelada`.
- **UI de aprovação**:
  - Botões "Aprovar versão" (verde `emerald`) e "Cancelar aprovação" (borda `california-red`) na tela `/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]` (componente `<AprovacaoActions>`).
  - **Botão "Aprovar" ícone direto na lista de versões** (`<VersoesList>`) — ao lado de Duplicar, condicional a status aprovável + `podeAprovarVersao` (calculado no server component).
- **Jobs** (tabela `jobs`):
  - FK obrigatórias: `projeto_id`, `orcamento_id`, `versao_orcamento_aprovada_id`, `responsavel_id`.
  - Campos: `nome`, `produto` (texto livre), `regional_id` (FK `regionais`), `cidade`, `data_inicio_prevista`, `data_fim_prevista`, `valor_total` (pre-preenchido do faturamento da versão aprovada com gross-up).
  - Self-reference `job_pai_id` pra hierarquia principal ↔ sub-job. Constraints: `jobs_nao_pai_de_si_mesmo`, unique parcial `uniq_jobs_principal_por_projeto` (1 principal por projeto entre não-cancelados), unique parcial `uniq_jobs_por_orcamento_ativo` (1 job ativo por orçamento).
  - Status enum `job_status`: **`aguardando_abertura` → `aberto` → `em_producao` → `finalizado`** (linear) + `rejeitado_financeiro` (não terminal, com `motivo_rejeicao`) + `cancelado` (terminal). Default do banco: `aguardando_abertura` (não `aberto`).
  - Código: `JOB-NNNN` sequencial por tenant (`lib/codigos/jobs.ts`).
  - Server actions em `app/(app)/jobs/actions.ts`: `criarJob`, `atualizarJob`, `atualizarHierarquiaJob` (swap atômico com ordering seguro pro unique index), `atualizarStatusJob` (bloqueia cancelar principal com sub-jobs ativos).
- **Central Financeira** (aprovação da abertura pelo financeiro):
  - Rota `/financeiro` (hub) + `/financeiro/jobs-aguardando-abertura` (tabela + drawers).
  - Server actions com role gate `admin | financeiro`: `aprovarAberturaJob(jobId)` (aguardando_abertura → aberto), `rejeitarAberturaJob(jobId, motivo)` (aguardando_abertura → rejeitado_financeiro, motivo mín 10 max 500).
  - `reenviarJobParaAprovacao(jobId)` — sem role gate (GP faz) — rejeitado_financeiro → aguardando_abertura, limpa motivo.
  - Guard server-side `redirect("/home?reason=sem_permissao_financeira")` nas 2 pages.
  - `/jobs/[jobId]` mostra motivo em card destaque + botão `<ReenviarAprovacaoButton>` quando `rejeitado_financeiro`. Botões contextuais aprovar/rejeitar visíveis pra admin/financeiro quando `aguardando_abertura`.
  - Audit `job.abertura_aprovada` / `job.abertura_rejeitada` / `job.reenviado_para_aprovacao`. Denials registram `acao_negada` com metadata da action tentada.
- **Regionais** (`regionais` cadastro tenant-wide) — CRUD em `/cadastros/regionais`, mesmo padrão de `/categorias`.
- **Sidebar** generalizada: `adminOnly: boolean` → `roles?: AppRole[]`; entrada "Jobs" (`Briefcase`, sem gate) + "Financeiro" (`Landmark`, gate `admin|financeiro`).
- **`/jobs/[jobId]`**: detalhe read-only + drawer `<JobEditorDrawer>` (edição inline) + drawer `<EditarHierarquiaDrawer>` (troca principal↔sub-job) + `<StatusActions>` (transições livres).
- **Dívidas técnicas registradas** (Task 005 deferred minors, ver `.superpowers/sdd/2026-07-29-.../progress.md`):
  - Swap principal↔sub-job em `criarJob` e `atualizarHierarquiaJob` não é DB-transacional (3 statements sequenciais). Se falhar entre steps, DB fica em estado parcial (dois sub-jobs sem principal, ou ciclo). Fix futuro: mover pra função Postgres.
  - `atualizarStatusJob` deixa qualquer role cancelar qualquer status não-terminal (spec-compliant, mas pode virar policy).
- Migration `20260729000002_task005_jobs.sql`.

### Abertura de Job (handoff "Abertura de Job.dc.html", 30/07/2026)
- Fluxo de 3 pop-ups na tela da **versão**, orquestrado por `<FluxoAbertura>`: confirmar aprovação → formulário do job → confirmar envio.
- Barra de ação `sticky bottom-0` com 3 estados (rascunho / versão aprovada / job enviado). "Aprovar versão" saiu do cabeçalho e vive nela; `<AprovacaoActions>` ficou só com "Cancelar aprovação".
- `<CriarJobDrawer>` da tela do orçamento foi **removido** — caminho único agora é pela versão. A tela do orçamento perdeu 2 queries (`regionais`, `listActiveMembers`) que só ele usava.
- Nova tabela `cliente_produtos`: escopo **cliente**, não tenant. Gerenciada em `/clientes/[id]` (card "Produtos"), código `PRD-NN` sequencial por cliente gerado na action.
- Nova coluna `jobs.data_prevista_faturamento` (nullable — já havia jobs gravados).
- `enviarJobParaAbertura` recalcula `valor_total` a partir dos itens da versão (nunca confia no form), grava nome/datas de volta no orçamento, e decide a hierarquia sozinha: primeiro job do projeto vira principal, os seguintes viram sub-job dele. Sem seletor na tela.
- Cidade usa busca **server-side** (`buscarCidades`, `ilike` + limit 30): o cadastro foi desenhado pra receber a lista completa do IBGE no formato `Salvador-BA`, sem coluna `uf`. A carga é só um INSERT futuro.
- Migration `20260730000004_produtos_cliente_e_faturamento_job.sql`.

### UI polish
- Componentes reusáveis: `Dialog` + `DrawerContent`, `ConfirmDialog`, `Select` (Radix), `Popover`, `Calendar`, `DatePicker`, `MaskedInput` (telefone/CPF/CNPJ), `no-spinner` utility.
- Fonte display **Fraunces** para títulos (cara de agência).
- Sidebar com transição contínua (largura px animável, slot fixo de ícone, opacidade do label).
- Logo do urso California (`public/brand/logo-icon.png`) + favicons.

## 3. Próximos passos (em ordem de prioridade)

### ✅ QA Task 008 + polish (FEITO em 2026-07-31)

Fluxo end-to-end validado em prod: aprovar versão → criar job → aprovar/rejeitar no financeiro → lançar realizado → mudar status → planilha vira read-only em finalizado/cancelado. Bug do "Sub-job de: ·" corrigido no mesmo ciclo. Timings de diagnóstico removidos.

**Bugs esperados / edge cases ainda mapeados:**
- Se `criarJob` falhar entre steps do swap principal↔sub-job, DB fica em estado parcial (não é transacional). Recovery é manual via SQL — se acontecer, avisa antes de continuar. Fix pendente em backlog P5.

### 🔴 Prioridade 1 — Task 006 (Administração) — completar

Convite está feito. Backlog:
- Inativar/reativar membership (soft-delete de vínculo).
- Trocar papel de membro existente (drawer com Select).
- Reenviar convite pra user que não ativou.
- **Feed de auditoria** (`audit_events` do tenant) — dados já são gravados, falta UI de leitura.
- **MFA obrigatório pra admin** — configuração no Supabase Dashboard.

### 🟡 Prioridade 2 — Pedidos de compra + títulos financeiros

Extensão natural do Realizado. O plano da Task 008 documentou:
```
realizado → pedidos_compra → titulos_financeiros → conciliação bancária
```
A próxima peça lógica é a tabela `pedidos_compra` (que "consome" um realizado dividindo em N lançamentos com fornecedor, data, NF). Sem isso, o realizado hoje é só um número num item.

### 🟢 Prioridade 3 — Dashboards e relatórios

- KPIs por projeto (rentabilidade real vs orçada).
- Rentabilidade por fase de job (planejado × realizado ao longo do tempo).
- Cash flow projetado.
- Contas a pagar / DRE (dependem de pedidos_compra + títulos).

### 🟢 Prioridade 4 — Dívidas técnicas registradas

- **Swap principal↔sub-job atômico**: hoje são 3 statements sequenciais em `criarJob`/`atualizarHierarquiaJob`. Mover pra função Postgres com transação real. Recovery hoje é SQL manual.
- **`finalizado` ref stale** também na `versoes/.../itens-table.tsx` — mesmo bug do CelulaRealNum que consertei no realizado (commit `1787a5c`). Aplicar `useEffect(() => { if (editando) finalizado.current = false }, [editando])`.
- **Regras finais de tributação A/B/C/D** — cálculo simplificado hoje em `lib/calculos/versao-totais.ts`, precisa validação com comercial/financeiro.
- Minors deferidos da Task 008 (ver `.superpowers/sdd/2026-07-30-jobs-realizado/progress.md`): `select("*")` em pre-fetch, null guard `versao_orcamento_aprovada_id`, `void pending` → destructure, eslint-disable no useMemo de subtotais, GRADE_VARIACAO inconsistente no tfoot.

### ✅ Fluxo de convite de usuário (FEITO)

Código pronto + template do email colado no Dashboard + URL Configuration validada. Convites funcionam. UI de admin em `/admin/usuarios` cria membership automaticamente.

Detalhes técnicos (referência caso quebre):
- Página `app/(auth)/definir-senha/page.tsx` valida sessão no mount, form com senha + confirmar (min 8 chars).
- Callback `app/api/auth/callback/route.ts` suporta 2 fluxos: `?code=...` (PKCE) e `?token_hash=...&type=invite&next=...`.
- Template `docs/email-templates/magic-link-invite.html` usa `{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/definir-senha`.
- Server action `convidarUsuario` faz distinção entre profile já existente (só cria membership) vs novo (envia convite via `admin.inviteUserByEmail`).
- Origin resolvido via headers dinamicamente (funciona em dev e prod sem mudar código).
- Audit: `usuario.convidado`, `usuario.membership_criada`, `usuario.membership_atualizada`, `usuario.reenvio_convite`.

Backlog restante da Task 006 está consolidado na **Prioridade 1** no topo desta seção.

### ✅ Fase F da Task 004 — Importação de planilha (implementada)

- Migration `20260726000001_task004_orcamento_importacoes.sql`: tabela
  `orcamento_importacoes` (com warnings JSONB) + bucket privado
  `orcamento-importacoes` + policies em `storage.objects` isolando por tenant
  (path prefix = `tenant_id/orcamento_id/importacao_id-nome.xlsx`).
- Parser [`lib/importacao/parser-oficial.ts`](../lib/importacao/parser-oficial.ts):
  ExcelJS, detecta aba "Oficial" (fallback: primeira aba), acha o header
  procurando keywords (PLANILHA/ITEM/R$/QT/D-M/TT), interpreta grupos
  (A preenchida, B vazia) e itens (B preenchida). Ignora linhas de resumo
  (SUB-TOTAL/TOTAL/IMPOSTO/HONORÁRIOS/FATURAMENTO) e extrai o `%
  honorários` do resumo, aplicando na versão criada. Warnings com
  severidade `ignorada`/`ajuste` acumulam por linha/coluna.
- Server actions [`importar-actions.ts`](../app/(app)/orcamentos/[id]/versoes/importar-actions.ts):
  `previewImportacao` (parse sem persistir) e `confirmarImportacao`
  (reparse + criação da versão em rascunho + grupos + itens em bulk +
  upload no bucket + registro em `orcamento_importacoes` + auditoria).
- UI [`importar-drawer.tsx`](../app/(app)/orcamentos/[id]/versoes/importar-drawer.tsx):
  drawer com upload → tela de preview (grupos, contagens, total bruto,
  warnings destacados) → botão "Criar versão importada" que persiste e
  redireciona pra nova versão. Botão fica ao lado de "Nova versão" no
  card de versões do orçamento.

## 4. Arquitetura & convenções (leia antes de codar)

### Regras invioláveis
1. **Performance é feature** — leia [`docs/PERFORMANCE.md`](PERFORMANCE.md) ANTES de tocar `app/(app)/**` ou `lib/supabase/**`. Já pagamos duas regressões severas: `<Link>` sem `prefetch={false}` em listas navegáveis e embed pesado só pra somar totais. Não repita — o guia tem case studies + checklist + anti-padrões proibidos.
2. **RLS ≠ GRANT** — Postgres exige AMBOS. Toda migration nova que cria tabela precisa terminar com `grant select, insert, update on ... to authenticated`. `service_role` já é coberto por `ALTER DEFAULT PRIVILEGES` da migration `20260725000001`. Perdemos horas com isso na Task 001.
3. **Toda tabela operacional tem `tenant_id`** com FK para `tenants` e RLS via `is_tenant_member(tenant_id)`. Policies usam `(select auth.uid())`, não `auth.uid()` direto (evita re-avaliar por linha).
4. **Sem `DELETE` policy** exceto para tabelas efêmeras (itens). Use `status = 'cancelado' / 'inativo'`.
5. **`SUPABASE_SERVICE_ROLE_KEY` só em server actions/route handlers.** Nunca no cliente.
6. **Toda ação sensível vira `audit_events` via RPC `log_audit_event`**.
7. **Antes de mudar código, ler `lib/types.ts`** — os types espelham as tabelas.

### Padrões UI (não reinvente)
- `<ConfirmDialog>` para toda confirmação (não use `window.confirm`).
- `<Dialog>` para modais centrados, `<DrawerContent>` para painéis laterais.
- `<DrawerContent>` **NÃO** aceita prop `title` — use composition: `<DrawerContent><DialogHeader><DialogTitle>...</DialogTitle></DialogHeader>...</DrawerContent>`. Ver `orcamento-editor-drawer.tsx`, `projeto-editor-drawer.tsx` como referência.
- `<Select>` (Radix) para dropdowns; `<DatePicker>` para datas; `<MaskedInput>` para telefone/CPF/CNPJ.
- **Radix `<SelectItem>` NUNCA aceita `value=""`** — crasha em runtime. Use sentinel `"__none__"` e traduza pra `null` no submit. Ver `projeto-form.tsx`, `orcamento-form.tsx`, `criar-job-drawer.tsx` como referência.
- **Radix `<PopoverContent>` de DatePicker/qualquer popover em form:** aplicar `side="bottom"` + `sideOffset={6}` + `collisionPadding={16}` + largura fixa (ex `w-[300px]`) + `<Calendar fixedWeeks>` (altura constante). **NÃO desligar `avoidCollisions`** — em drawers baixos, popover é cortado sem opção de flippar pra cima. Dimensões fixas + padding de colisão eliminam o jitter sem impedir o flip necessário. Ver `components/ui/date-picker.tsx` (commit `95cf49b` explica o ciclo).
- Formulários: input numérico usa `className="no-spinner"` e vem sem default.
- Toast/alerta de erro do server action: mostrar como bloco vermelho no topo do form.
- Toda página de detalhe segue: breadcrumb `← Voltar` → header com título+badges+ações → conteúdo em cards.
- Linha inteira de lista/card clicável = navega; ações secundárias na mesma linha usam `stopPropagation`. `role="button"` + `tabIndex={0}` + `onKeyDown` (Enter/Space) pra acessibilidade. `<Link>` interno da célula "Código" com `prefetch={false}` + `stopPropagation`.

### Padrões de código
- Server actions em `app/(app)/*/actions.ts`. Cada uma:
  - Chama `requireSession()` primeiro
  - Parseia com Zod
  - Verifica pertencimento ao tenant explicitamente (`.eq('tenant_id', session.activeTenant.id)`)
  - Loga auditoria
  - Chama `revalidatePath` no fim
- Colunas numéricas do Postgres voltam como string do Supabase-js. Sempre converte com `Number(...)`.
- Embeds do PostgREST só funcionam quando a FK vai **direto** para a tabela alvo. Ver `lib/data/members.ts` — `tenant_members.user_id → auth.users` não embuta em `profiles` (faz 2 queries).

### MCP Supabase
- `.mcp.json` na raiz com dois servers: `supabase` (read-only) e `supabase-write` (para migrations).
- Precisa de `SUPABASE_ACCESS_TOKEN` como variável de sistema Windows (`setx`).
- Ao aplicar migration nova, **sempre verifique com uma query simulando `antonio` (`set local role authenticated` + JWT claim override)** para pegar problemas de RLS/GRANT antes do frontend.

### Deploy Vercel
Env vars necessárias (documentadas em `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (formato novo `sb_publishable_...`)
- `SUPABASE_SERVICE_ROLE_KEY` (formato novo `sb_secret_...`, marcar como Sensitive)
- **NÃO** colocar `SUPABASE_ACCESS_TOKEN` — é só pra MCP local.

## 5. Comandos úteis

```powershell
# Rodar em dev
npm run dev

# Verificações
npx tsc --noEmit
npx next lint
npm run build  # local pode dar erro de _document (bug Next 14 no Win) — Vercel builda ok

# Git
git status
git push origin main  # publica commits pendentes
```

## 6. Contexto operacional

- Usuário do sistema hoje: só **antonio@pevetech.com.br** (admin). Bruno e demais GPs ainda não convidados.
- Tenant único: `Agência California` (slug `agencia-california`, id `d2a02c10-9c7e-4157-8dd5-84bbf5a7044c`).
- SMTP do Resend já configurado no Supabase — envio de e-mail funciona.
- Template do convite: `docs/email-templates/magic-link-invite.html` já customizado com identidade California (mas precisa do ajuste do link — ver Prioridade 1).
- Regras de negócio finais de tributação por tipo A/B/C/D pendentes de validação com o comercial.
