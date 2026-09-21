# Task 005 — Aprovação de versão + Jobs + Central Financeira + Abertura de Job (2026-07-29 a 2026-07-31)

Task 005 fecha o miolo do fluxo: aprovação de versão de orçamento cria o job; abertura do job (form + confirmação + envio) é orquestrada por `<FluxoAbertura>`; central financeira aprova/rejeita abertura.

## Aprovação e desaprovação de versão

- **`aprovarVersao(versaoId)`**:
  - Valida versão em `rascunho|em_revisao|enviada_cliente`, orçamento não em `job_criado|aprovado|cancelado`, ≥1 item.
  - ⚠️ **13/08/2026 — gate apertou.** Agora exige **alíquota de imposto entre as fixas** (19,53 / 24,269914) e **≥1 item com `total_orcado > 0`**. As três checagens moram em `bloqueioAprovacaoVersao` (`lib/validations/versoes.ts`), usada pela server action E pelo botão — mensagem única, botão desabilita com motivo à vista. Criar/editar versão continuam aceitando imposto em branco; exigência é só na aprovação. Ver `docs/decisions/006-aliquota-fixa-e-gate-de-aprovacao.md`.
  - ⚠️ **13/08/2026 — imposto virou seletor.** Campo livre saiu das três telas (parâmetros do rascunho, nova versão, editar versão). Opções em `lib/impostos.ts` (`ALIQUOTAS_IMPOSTO`) — não escrever percentual solto no JSX. `versoes_orcamento.percentual_imposto` foi para `numeric(10,6)` (migration `20260813000002`) porque `numeric(6,3)` arredondava 24,269914 para 24,270.
  - Update versão pra `aprovada` (trigger `cascata_versao_aprovada` cascatas as outras versões pra `substituida`).
  - Update orçamento pra `aprovado` com `versao_aprovada_id`, `aprovado_em`, `aprovado_por`.
  - Audit `versao_orcamento.aprovada`.
- **`cancelarAprovacaoVersao(versaoId)`**:
  - Só permitido se orçamento `aprovado` E sem job ativo (status != `cancelado`).
  - Reverte versão pra `em_revisao`, limpa `aprovado_em`/`aprovado_por`; reverte `substituida` pra `em_revisao`; reverte orçamento pra `em_revisao`.

## Jobs (tabela `jobs`)

- FKs obrigatórias: `projeto_id`, `orcamento_id`, `versao_orcamento_aprovada_id`, `responsavel_id`.
- Campos: `nome`, `produto` (texto livre), `regional_id` (FK `regionais`), `cidade`, `data_inicio_prevista`, `data_fim_prevista`, `valor_total` (pré-preenchido do faturamento da versão aprovada com gross-up).
- Self-reference `job_pai_id` pra hierarquia principal ↔ sub-job. Constraints: `jobs_nao_pai_de_si_mesmo`, unique parcial `uniq_jobs_principal_por_projeto` (1 principal por projeto entre não-cancelados), unique parcial `uniq_jobs_por_orcamento_ativo` (1 job ativo por orçamento).
- Status enum `job_status`: **`aguardando_abertura` → `aberto` → `em_producao` → `finalizado`** (linear) + `rejeitado_financeiro` (não terminal, com `motivo_rejeicao`) + `cancelado` (terminal). Default do banco: `aguardando_abertura`.
- Código: `JOB-NNNN` sequencial por tenant (`lib/codigos/jobs.ts`).
- Server actions em `app/(app)/jobs/actions.ts`: `criarJob`, `atualizarJob`, `atualizarHierarquiaJob` (swap atômico com ordering seguro pro unique index), `atualizarStatusJob` (bloqueia cancelar principal com sub-jobs ativos).

## Central Financeira

- Rota `/financeiro` (hub) + `/financeiro/jobs-aguardando-abertura`.
- Server actions com role gate `admin | financeiro`: `aprovarAberturaJob(jobId)` (aguardando_abertura → aberto), `rejeitarAberturaJob(jobId, motivo)` (aguardando_abertura → rejeitado_financeiro, motivo mín 10 máx 500).
- `reenviarJobParaAprovacao(jobId)` — sem role gate (GP faz) — rejeitado_financeiro → aguardando_abertura, limpa motivo.
- Guard server-side `redirect("/home?reason=sem_permissao_financeira")` nas 2 pages.
- `/jobs/[jobId]` mostra motivo em card destaque + `<ReenviarAprovacaoButton>` quando `rejeitado_financeiro`. Botões contextuais aprovar/rejeitar visíveis pra admin/financeiro quando `aguardando_abertura`.
- Audit: `job.abertura_aprovada` / `job.abertura_rejeitada` / `job.reenviado_para_aprovacao`. Denials registram `acao_negada`.
- **Regionais** (`regionais` cadastro tenant-wide) — CRUD em `/cadastros/regionais`, mesmo padrão de `/categorias`.
- **Sidebar** generalizada: `adminOnly: boolean` → `roles?: AppRole[]`; entradas "Jobs" (`Briefcase`) e "Financeiro" (`Landmark`, gate `admin|financeiro`).

## Abertura de Job (fluxo)

- Fluxo de 3 pop-ups na tela da **versão**, orquestrado por `<FluxoAbertura>`: confirmar aprovação → formulário do job → confirmar envio.
- Barra de ação `sticky bottom-0` com 3 estados (rascunho / versão aprovada / job enviado). "Aprovar versão" saiu do cabeçalho e vive nela; `<AprovacaoActions>` ficou só com "Cancelar aprovação".
- `<CriarJobDrawer>` da tela do orçamento foi **removido** — caminho único é pela versão. Tela do orçamento perdeu 2 queries (`regionais`, `listActiveMembers`) que só ele usava.
- Nova tabela `cliente_produtos`: escopo **cliente**, não tenant. Gerenciada em `/clientes/[id]` (card "Produtos"), código `PRD-NN` sequencial por cliente.
- Nova coluna `jobs.data_prevista_faturamento` (nullable).
- `enviarJobParaAbertura` recalcula `valor_total` a partir dos itens da versão (nunca confia no form), grava nome/datas de volta no orçamento, decide hierarquia sozinha: primeiro job do projeto vira principal, os seguintes viram sub-job dele.
- Cidade usa busca **server-side** (`buscarCidades`, `ilike` + limit 30). Cadastro pronto pra receber lista completa do IBGE no formato `Salvador-BA`, sem coluna `uf`.

## Revisão de layout da Abertura (31/07/2026)

- Formulário em **3 colunas**: identificação travada (Projeto / Código do projeto / Código do job), Nome em 2 colunas ao lado de Cliente, depois Produto/Cidade/Regional, as 3 datas, e Responsável ao lado de Valor total.
- Diálogo `sm:max-w-5xl`. Proibição de `max-w-5xl` em `docs/09-identidade-visual-ui.md` vale pra container de **página**, não pra modal.
- Campo **Observações** novo (`jobs.observacoes`, CHECK 500). ⚠️ Grava mas nenhuma tela lê ainda — leitura entra com o refino da tela de abertura do financeiro. Não é bug.
- Confirmação virou `<ConfirmarEnvioModal>` próprio. Observações aparecem só pra conferência.
- "Voltar e revisar" preserva o formulário: estado subiu pra `<FluxoAbertura>`. O `useEffect` do modal resetava a cada `open`, e voltar da confirmação disparava `open` de novo. Cancelar/X continua limpando.

## Migrations aplicadas

```
20260729000002_task005_jobs.sql
20260730000004_produtos_cliente_e_faturamento_job.sql
20260731000001_job_observacoes.sql
```

## Commits relevantes

- `e5be821` — fix(datepicker): popover fixo (`side=bottom`, `avoidCollisions=false`, `w-[300px]`, `fixedWeeks`)
- `f75d072` — feat(versoes): botão Aprovar direto na lista de versões
- `a4ca8f5` — task005 final review: `Orcamento.versao_aprovada_id` no type + audit `acao_negada` em denials financeiros
- `9042f86` — task005: sidebar ganha entradas Jobs e Financeiro (com role gate)
- `d5cfc52` — task005: Central Financeira + Jobs Aguardando Abertura
- `41490d9` — feat(categorias): categorias de domínio pra projeto e orçamento

## Dívidas técnicas registradas

- Swap principal↔sub-job em `criarJob` e `atualizarHierarquiaJob` **não é DB-transacional** (3 statements sequenciais). Se falhar entre steps, DB fica em estado parcial (dois sub-jobs sem principal, ou ciclo). Fix futuro: mover pra função Postgres.
- `atualizarStatusJob` deixa qualquer role cancelar qualquer status não-terminal (spec-compliant, mas pode virar policy).
