# Handoff — California ERP

Documento para dar continuidade ao projeto em uma nova sessão de trabalho. Última atualização depois do commit `5a56db3` (sidebar com transição contínua).

## 1. Onde estamos

**Deploy:** projeto configurado no Vercel (`calif-erp`), branch `main`.
Backend: Supabase project `avlwxyknvhlzvnysbzrg` (`https://avlwxyknvhlzvnysbzrg.supabase.co`).
Admin cadastrado: `antonio@pevetech.com.br` (role `administrador` no tenant `agencia-california`).

**Local (Git):**
- Working tree limpo.
- Branch `main` está algumas commits à frente do `origin/main` — publicar com `git push origin main` quando quiser.

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
```

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

### Task 004 — Versões e itens (sem importação)
- `versoes_orcamento`, `versoes_orcamento_grupos`, `versoes_orcamento_itens`.
- Regras de banco: um grupo por (versão, nome) case-insensitive, uma versão aprovada por orçamento (unique parcial), `total_orcado` GENERATED (valor × qtd × dias/meses).
- ALTER em `orcamentos`: `versao_aprovada_id`, `aprovado_em`, `aprovado_por`.
- UI: criar/duplicar/cancelar versão, CRUD de grupos, CRUD de itens (drawer).
- Página `/orcamentos/[id]/versoes/[versaoId]` com layout de planilha (grupos → itens) + card de totais.
- **Cálculos corretos**: Honorários = (A+B+D) × %, Impostos = (B+C+Honor) × taxa/(1-taxa) (gross-up), Faturamento = total + honor + imposto.
- Helper compartilhado `lib/calculos/versao-totais.ts` — card e export usam o mesmo cálculo.
- Export XLSX via ExcelJS replicando layout da planilha padrão.

### UI polish
- Componentes reusáveis: `Dialog` + `DrawerContent`, `ConfirmDialog`, `Select` (Radix), `Popover`, `Calendar`, `DatePicker`, `MaskedInput` (telefone/CPF/CNPJ), `no-spinner` utility.
- Fonte display **Fraunces** para títulos (cara de agência).
- Sidebar com transição contínua (largura px animável, slot fixo de ícone, opacidade do label).
- Logo do urso California (`public/brand/logo-icon.png`) + favicons.

## 3. Próximos passos (em ordem de prioridade)

### 🔴 Prioridade 1 — Fluxo de convite de usuário (bloqueado hoje)

**Sintoma:** admin envia convite pelo Supabase Dashboard → usuário clica no link do e-mail → cai em `/login` → não consegue criar senha.

**Causa:** o template HTML do e-mail (`docs/email-templates/magic-link-invite.html`) usa `{{ .ConfirmationURL }}`, que é gerado pelo Supabase. Esse URL faz a verificação do token e redireciona para o `Site URL` configurado no Dashboard. Nosso app não tem rota para o usuário definir a senha após aceitar o convite.

**O que falta implementar:**

1. **Criar página `/definir-senha`** (client component):
   - Form com campo "senha" + "confirmar senha" + validação (mín 8 chars, ambos iguais).
   - Ao submeter, chama `supabase.auth.updateUser({ password })`.
   - Se sucesso, redireciona para `/home`.
   - Se falha (ex: sessão expirou), volta pro `/login` com mensagem.

2. **Configurar Supabase Dashboard → Authentication → URL Configuration:**
   - `Site URL`: `https://calif-erp.vercel.app` (ou domínio final)
   - `Redirect URLs` (adicionar todas):
     ```
     https://calif-erp.vercel.app/definir-senha
     https://calif-erp.vercel.app/api/auth/callback
     http://localhost:3000/definir-senha
     http://localhost:3000/api/auth/callback
     ```

3. **Ajustar template do e-mail** (`docs/email-templates/magic-link-invite.html`):
   - Trocar `{{ .ConfirmationURL }}` por `{{ .SiteURL }}/api/auth/callback?code={{ .Token }}&next=/definir-senha`
   - Ou manter `{{ .ConfirmationURL }}` e garantir que o Site URL no dashboard seja `/definir-senha`.
   - Colar o HTML no Supabase Dashboard → Authentication → Email Templates → **Invite User**.

4. **Ajustar `/api/auth/callback/route.ts`:** já suporta `?next=...`, então funciona com a opção do template acima.

5. **(Opcional) UI de admin para convidar** (fica pra Task 006 de Administração):
   - Server action que usa `createServiceClient()` + `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: 'https://.../definir-senha' })`.
   - Enquanto isso, admin usa o Dashboard do Supabase pra criar/invitar.

**Como testar:**
1. No Supabase Dashboard → Authentication → Users → convide um email de teste.
2. Recebe e-mail (SMTP do Resend já configurado ✅).
3. Clica no link → deve cair em `/definir-senha` já com sessão ativa.
4. Cria a senha → cai no `/home`.

### 🟡 Prioridade 2 — Fase E da Task 004: Aprovação de versão

Falta fechar o fluxo comercial. Quando o usuário aprova uma versão:
- Server action `aprovarVersao(versaoId)`:
  - Set `versoes_orcamento.status = 'aprovada'`, `aprovado_em = now()`, `aprovado_por = user`.
  - Update `orcamentos.status = 'aprovado'`, `versao_aprovada_id = versaoId`, `aprovado_em`, `aprovado_por`.
  - As outras versões do mesmo orçamento viram `substituida` automaticamente.
  - Registra `versao_orcamento.aprovada` em `audit_events`.
- Trigger opcional no banco pra reforçar a regra (só uma aprovada — já garantido pelo unique parcial, mas trigger cascata para as outras é melhor).
- Botão "Aprovar" no header da versão em `/orcamentos/[id]/versoes/[versaoId]` com `ConfirmDialog`.
- Aviso na página do orçamento quando aprovado ("Crie o job para seguir com a operação").

### 🟡 Prioridade 3 — Task 005: Criação do Job

Docs de referência: [`tasks/005-criacao-job-orcamento-aprovado.md`](../tasks/005-criacao-job-orcamento-aprovado.md).
- Migration `jobs`: FK obrigatórias para `orcamento_id` e `versao_orcamento_aprovada_id`, unique `(tenant_id, orcamento_id)` (um job por orçamento).
- Server action `criarJob(orcamentoId)`: só permite se `orcamento.status = 'aprovado'`; copia dados essenciais; atualiza `orcamentos.status = 'job_criado'`.
- UI: card "Job criado" no orçamento aprovado + página `/jobs/[id]` (placeholder por enquanto).

### 🟢 Prioridade 4 — Backlog

- **Fase F Task 004** — Importação de planilha (`orcamento_importacoes` + parser da aba "Oficial" da planilha padrão). Fica pra depois pela decisão do usuário.
- **Task 006 — Administração**: membros do tenant, convite, promoção/rebaixamento, log de auditoria (feed).
- **MFA obrigatório** pra admin — configurar no Supabase Dashboard.
- **Regras finais de tributação A/B/C/D**: cálculo simplificado hoje. Refinar depois de reunião com o comercial/financeiro. Ver `lib/calculos/versao-totais.ts`.
- **Botão de aprovar/reprovar orçamento** (transições de status manuais além do que já existe no drawer).

## 4. Arquitetura & convenções (leia antes de codar)

### Regras invioláveis
1. **RLS ≠ GRANT** — Postgres exige AMBOS. Toda migration nova que cria tabela precisa terminar com `grant select, insert, update on ... to authenticated`. Perdemos horas com isso na Task 001.
2. **Toda tabela operacional tem `tenant_id`** com FK para `tenants` e RLS via `is_tenant_member(tenant_id)`.
3. **Sem `DELETE` policy** exceto para tabelas efêmeras (itens). Use `status = 'cancelado' / 'inativo'`.
4. **`SUPABASE_SERVICE_ROLE_KEY` só em server actions/route handlers.** Nunca no cliente.
5. **Toda ação sensível vira `audit_events` via RPC `log_audit_event`**.
6. **Antes de mudar código, ler `lib/types.ts`** — os types espelham as tabelas.

### Padrões UI (não reinvente)
- `<ConfirmDialog>` para toda confirmação (não use `window.confirm`).
- `<Dialog>` para modais centrados, `<DrawerContent>` para painéis laterais.
- `<Select>` (Radix) para dropdowns; `<DatePicker>` para datas; `<MaskedInput>` para telefone/CPF/CNPJ.
- Formulários: input numérico usa `className="no-spinner"` e vem sem default.
- Toast/alerta de erro do server action: mostrar como bloco vermelho no topo do form.
- Toda página de detalhe segue: breadcrumb `← Voltar` → header com título+badges+ações → conteúdo em cards.

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
