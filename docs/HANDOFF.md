# Handoff — California ERP

Documento para dar continuidade ao projeto em uma nova sessão de trabalho.

**Este arquivo é um índice.** Cada sessão que gera entrega vira um arquivo próprio em `docs/handoffs/YYYY-MM-DD-slug.md`. Aqui você acha:

1. A regra de "leia primeiro" (seção 0) — perene, não é log.
2. Estado do deploy e das migrations aplicadas (seção 1).
3. Índice cronológico das sessões recentes com link pro handoff datado (seção 2).
4. Handoffs temáticos (Financeiro, Jobs, Orçamento) — referência de módulo (seção 3).
5. Próximos passos / backlog vivo (seção 4).
6. Arquitetura, convenções, comandos, contexto operacional (seções 5-7).

**Regra para novas sessões:** ao encerrar uma entrega relevante, crie `docs/handoffs/YYYY-MM-DD-slug.md` a partir de [`_TEMPLATE.md`](handoffs/_TEMPLATE.md) e adicione uma linha na seção 2 deste índice. Não empilhe blocos novos no topo deste arquivo.

## 0. LEIA PRIMEIRO — ação pendente no início da sessão

Antes de qualquer coisa:

1. **`docs/PERFORMANCE.md` é obrigatório**. Toda mudança em `app/(app)/**` ou `lib/supabase/**` passa pelo checklist do guia. Já custamos 2 regressões severas por não respeitar isso — não repita. `CLAUDE.md` também tem as regras não-negociáveis no topo.

2. **`docs/09-identidade-visual-ui.md`**: leia as seções **"Larguras de layout (padrão)"** e **"Header padrão da página"** antes de criar/editar qualquer page. Tela principal não tem largura própria — usa a do layout (decisão 085, 16/09/2026); formulário `max-w-3xl`, texto `max-w-2xl` e todo header tem icon+kicker/breadcrumb+title. Sair do padrão sem justificativa é dívida técnica.

3. **Fixes de performance ainda válidos (não regride):**
   - `prefetch={false}` nos `<Link>` das listas de versão, orçamento, cliente, fornecedor, job.
   - Página do orçamento não usa embed pesado pra calcular totais de versões — trocado por query agregada.
   - `force-dynamic` permanece nas pages autenticadas (**não remova** — funciona como freio de prefetch descontrolado, ver `docs/PERFORMANCE.md` seção G).
   - Timings `console.log("[*.timing]")` que existiam em 3 arquivos foram removidos em 2026-07-31 (diagnóstico concluído).

4. **Ao adicionar lib Node-only server-side** (PDF, imagem, XLSX, etc): typecheck + lint NÃO é suficiente. RODAR `rm -rf .next && npm run build` LOCAL antes de pushar. Windows é case-insensitive; Linux (Vercel) é case-sensitive. Um import como `pdfmake/src/printer` (minúsculo) funciona local mas quebra no Vercel se o arquivo real é `Printer.js`. Case study 2026-07-31: Task 010 quebrou build 2× até descobrir que era case. Fix: import `pdfmake/src/Printer` + `serverComponentsExternalPackages: ["pdfmake", "pdfkit"]` no `next.config.js`.

## 1. Onde estamos

**Deploy:** projeto no Vercel (`calif-erp`), branch `main`. Domínio de produção: `https://www.sistemacalifa.com.br`.
Backend: Supabase project `avlwxyknvhlzvnysbzrg` (`https://avlwxyknvhlzvnysbzrg.supabase.co`).
Admin cadastrado: `antonio@pevetech.com.br` (role `administrador` no tenant `agencia-california`).

**Local (Git):** working tree limpo, sincronizado com `origin/main`.

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
20260728000003  categorias_dominio
20260729000002  task005_jobs
20260730000001  task008_jobs_realizado
20260730000003  cidades
20260730000004  produtos_cliente_e_faturamento_job
20260731000001  job_observacoes
20260731000003  task010_pedidos_compra
20260813000002  imposto_precisao_numeric_10_6
20260916000001..000008  rh_fundacao
20260918000001  rh_folha_mensal
20260918000002  contas_avulsas_folha_id
20260921100001  colaborador_sem_vinculo_fornecedor
20260921120001  contas_avulsas_colaborador_id
20260921140001  colaboradores_dados_bancarios
20260921160001  empresas_contabeis_config_cnab             (revertida pelo ADR 004 do pgto-remessa)
20260921180001  cnab_estruturas_do_arquivo
20260921200001  config_cnab_migra_para_conta_bancaria
20260921200002  cnab_remessas_conta_bancaria_id
20260921220001  rpc_alocar_sequencial_cnab
20260921230001  origem_folha_em_vw_a_pagar
20260923100001  rh_alocacao_com_rateio_regional
20260923120001  rateio_regional_write_admin_only
20260923140001  rh_socio_e_campos_pessoais
20260923150001  rh_cpf_cnpj_flexivel
```

Última: `20260923150001`.

Migration removida do repo em 2026-09-23 (regionais GERAL aposentadas): `20260916000004_rh_regional_geral.sql`.

## 2. Sessões recentes (índice cronológico)

Ordem: mais recente primeiro. Cada linha aponta para um arquivo em `docs/handoffs/`.

| Data | Entrega | Handoff |
|---|---|---|
| 2026-09-24 | RH · Import dos 193 colaboradores do quadro real da Kika (socio no enum, CPF em PJ) | [2026-09-24-rh-import-colaboradores.md](handoffs/2026-09-24-rh-import-colaboradores.md) |
| 2026-09-23 | RH · Alocação por empresa + toggle "todas as regionais" + rateio anual (task 006) | [2026-09-23-rh-alocacao-com-rateio-regional.md](handoffs/2026-09-23-rh-alocacao-com-rateio-regional.md) |
| 2026-09-23 | pgto-remessa aberto (CNAB Santander) + impactos no RH documentados | [2026-09-23-pgto-remessa-e-impactos-no-rh.md](handoffs/2026-09-23-pgto-remessa-e-impactos-no-rh.md) |
| 2026-09-22 | RH · Design & UX da folha e da lista de colaboradores (D1/D2/D3) + Rodada 2 (visual polish) | [2026-09-22-rh-design-ux-folha-e-colaboradores.md](handoffs/2026-09-22-rh-design-ux-folha-e-colaboradores.md) |
| 2026-09-21 | RH · fechamento de ciclo + backlog vivo consolidado | [2026-09-21-rh-fechamento-de-ciclo.md](handoffs/2026-09-21-rh-fechamento-de-ciclo.md) |
| 2026-09-18 | Folha Mensal · Rodada 3 (envio, aprovação, geração de títulos) | [2026-09-18-folha-mensal-rodada-3.md](handoffs/2026-09-18-folha-mensal-rodada-3.md) |
| 2026-09-18 | Folha Mensal · Rodadas 1 e 2 (modelo + edição) | [2026-09-18-folha-mensal-rodadas-1-e-2.md](handoffs/2026-09-18-folha-mensal-rodadas-1-e-2.md) |
| 2026-09-17 | RH · Fundação + UI (Rodadas A e B) | [2026-09-17-rh-fundacao-e-ui.md](handoffs/2026-09-17-rh-fundacao-e-ui.md) |
| 2026-09-11 | Empresas Contábeis · dimensão contábil separada da gerencial | [2026-09-11-empresas-contabeis.md](handoffs/2026-09-11-empresas-contabeis.md) |
| 2026-08-31 | Teste ponta a ponta · save, errata, cartão, esteiras | [2026-08-31-teste-ponta-a-ponta-save-errata-cartao.md](handoffs/2026-08-31-teste-ponta-a-ponta-save-errata-cartao.md) |
| 2026-07-31 | Task 010 · Pedidos de Compra fase 1 | [2026-07-31-task-010-pedidos-compra.md](handoffs/2026-07-31-task-010-pedidos-compra.md) |
| 2026-07-31 | Task 008 · Jobs + Realizado | [2026-07-31-task-008-jobs-realizado.md](handoffs/2026-07-31-task-008-jobs-realizado.md) |
| 2026-07-30 | Task 005 · Aprovação de versão + Jobs + Central Financeira + Abertura | [2026-07-30-task-005-jobs-e-abertura.md](handoffs/2026-07-30-task-005-jobs-e-abertura.md) |
| 2026-07-29 | Tasks 001–007 · Fundação, Cadastros, Orçamentos, Versões, Projetos | [2026-07-29-tasks-001-a-007-fundacao-a-projetos.md](handoffs/2026-07-29-tasks-001-a-007-fundacao-a-projetos.md) |

## 3. Handoffs temáticos (referência de módulo)

Documentos gigantes por domínio, evoluem continuamente. Não são log cronológico — são a fonte-verdade de "como este módulo funciona hoje".

- [`handoffs/HANDOFF_FINANCEIRO.md`](handoffs/HANDOFF_FINANCEIRO.md) — Contas a pagar, títulos, recorrências, folha, cartão.
- [`handoffs/HANDOFF_JOBS.md`](handoffs/HANDOFF_JOBS.md) — Jobs, realizado, planejado, pedidos de compra.
- [`handoffs/HANDOFF_ORCAMENTO.md`](handoffs/HANDOFF_ORCAMENTO.md) — Projetos, orçamentos, versões, importação, categorias.

## 4. Próximos passos (backlog vivo)

### 🔴 Prioridade 1 — RH · Design & UX (decisões já travadas, implementar direto)

Detalhado em [`docs/modulos/rh/30-proximos-passos.md`](modulos/rh/30-proximos-passos.md) §P0. Resumo:

- **Listagem `/rh/folhas`** enxuta: uma linha por competência com **Colaboradores · Total (R$) · Status agregado** (só 3: rascunho / enviada / concluída, derivados das linhas — sem coluna nova no banco).
- **Detalhe `/rh/folhas/[competencia]`** ganha cards de resumo no topo (total, contagem, enviadas, pendências, aprovadas, pagas). Tabela por linha mantém badge granular.
- **Cards de estado atual** na `/rh/colaboradores`: colaboradores ativos, valor da folha atual, admissões no mês, demissões no mês.

Ordem seguinte no módulo (P1): ~~import da planilha atual~~ (feito em 2026-09-24, 193 colaboradores no ar), UI de pendências (20 sem CPF), estorno de folha aprovada, benefícios. Depois P2 (férias, turnover, holerite PDF, autoserviço).

### 🔴 Prioridade 2 — Task 006 (Administração) — completar

Convite está feito. Backlog:
- Inativar/reativar membership (soft-delete de vínculo).
- Trocar papel de membro existente (drawer com Select).
- Reenviar convite pra user que não ativou.
- **Feed de auditoria** (`audit_events` do tenant) — dados já são gravados, falta UI de leitura.
- **MFA obrigatório pra admin** — configuração no Supabase Dashboard.

### 🟡 Prioridade 3 — Pedidos de Compra fase 2 (fluxo financeiro)

Extensão natural da fase 1. Adicionar:
- Coluna `status pp_status` em `pedidos_compra` (enum: `emitida`, `aprovada`, `baixada`, `reprovada`).
- Rota `/financeiro/pedidos-compra` com caixa de entrada + tabela de PPs `emitida`.
- Server actions `aprovarPP`, `reprovarPP` (com motivo), `baixarPP`, `estornarBaixaPP`.
- Regra: PP `emitida` pode ser cancelada por GP/admin; PP `aprovada` só admin/financeiro cancela (e antes precisa estornar baixa se aplicável).
- Audit: `pedido_compra.aprovada`, `pedido_compra.reprovada`, `pedido_compra.baixada`, `pedido_compra.estornada`.

### 🟢 Prioridade 4 — Títulos financeiros + conciliação

Próxima peça lógica após fase 2:

```
realizado → pedidos_compra → titulos_financeiros → conciliação bancária
```

`pedidos_compra` (emitida/aprovada/baixada) gera `titulos_financeiros` com datas de vencimento e valores. Sem isso, o realizado hoje é só um número num item.

### 🟢 Prioridade 5 — Dashboards e relatórios

- KPIs por projeto (rentabilidade real vs orçada).
- Rentabilidade por fase de job (planejado × realizado ao longo do tempo).
- Cash flow projetado.
- Contas a pagar / DRE (dependem de pedidos_compra + títulos).

### 🟢 Prioridade 6 — Dívidas técnicas registradas

- **Swap principal↔sub-job atômico**: hoje são 3 statements sequenciais em `criarJob`/`atualizarHierarquiaJob`. Mover pra função Postgres com transação real. Recovery hoje é SQL manual.
- **`finalizado` ref stale** também em `versoes/.../itens-table.tsx` — mesmo bug do `CelulaRealNum` que consertei no realizado (commit `1787a5c`). Aplicar `useEffect(() => { if (editando) finalizado.current = false }, [editando])`.
- **Regras finais de tributação A/B/C/D** — cálculo simplificado hoje em `lib/calculos/versao-totais.ts`, precisa validação com comercial/financeiro.
- Minors deferidos da Task 008: `select("*")` em pre-fetch, null guard `versao_orcamento_aprovada_id`, `void pending` → destructure, eslint-disable no useMemo de subtotais, GRADE_VARIACAO inconsistente no tfoot.

## 5. Arquitetura & convenções (leia antes de codar)

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

## 6. Comandos úteis

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

## 7. Contexto operacional

- Usuário do sistema hoje: só **antonio@pevetech.com.br** (admin). Bruno e demais GPs ainda não convidados.
- Tenant único: `Agência California` (slug `agencia-california`, id `d2a02c10-9c7e-4157-8dd5-84bbf5a7044c`).
- SMTP do Resend já configurado no Supabase — envio de e-mail funciona.
- Template do convite: `docs/email-templates/magic-link-invite.html` já customizado com identidade California.
- Regras de negócio finais de tributação por tipo A/B/C/D pendentes de validação com o comercial.
