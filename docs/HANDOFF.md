# Handoff — California ERP

Documento para dar continuidade ao projeto em uma nova sessão de trabalho. Última atualização: fluxo completo de convite implementado — UI de admin em `/admin/usuarios`, page `/definir-senha`, callback `token_hash`. Falta apenas configuração no Supabase Dashboard (template + URL config) e vincular manualmente o admin antonio se ainda não estiver.

## 1. Onde estamos

**Deploy:** projeto no Vercel (`calif-erp`), branch `main`. Domínio de produção: `https://www.sistemacalifa.com.br`.
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

**Migrations pendentes de aplicar:**

```
20260725000001  grants_service_role       ← já aplicada? (usar se convite falhar)
20260726000001  task004_orcamento_importacoes ← APLICAR ANTES DE TESTAR IMPORT
```

- `grants_service_role`: sem esta migration, qualquer server action que usa
  `createServiceClient()` recebe `permission denied for table X` (42501).
  `service_role` bypassa RLS mas não bypassa GRANT. Se o convite já
  funcionou, esta migration já está aplicada.
- `task004_orcamento_importacoes`: cria `orcamento_importacoes` + bucket
  `orcamento-importacoes` + policies em `storage.objects`. Sem ela o
  drawer "Importar planilha" falha ao gravar o registro/arquivo.

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

### 🟢 Prioridade 1 — Fluxo de convite de usuário (código feito, faltam ajustes no Dashboard)

**Estado:** código implementado. Falta apenas: (a) colar o template atualizado no Supabase Dashboard e (b) validar URL Configuration.

**O que já foi feito no código:**

1. ✅ Página [`app/(auth)/definir-senha/page.tsx`](../app/(auth)/definir-senha/page.tsx):
   - Valida sessão no mount (`supabase.auth.getUser()`); se não houver, redireciona para `/login?reason=convite_expirado`.
   - Form com senha + confirmar senha (mín 8 chars, iguais).
   - Submete via `supabase.auth.updateUser({ password })`.
   - Sucesso → `/home`. Erro de sessão → mensagem clara.
   - Mesma identidade visual do login (brand-side + form-side, cores California).

2. ✅ Callback [`app/api/auth/callback/route.ts`](../app/api/auth/callback/route.ts):
   - Passou a suportar dois fluxos: `?code=...` (PKCE tradicional) **e** `?token_hash=...&type=invite&next=...` (links de e-mail customizados).
   - Em qualquer erro de troca de token → redireciona para `/login?reason=convite_expirado`.

3. ✅ Template [`docs/email-templates/magic-link-invite.html`](email-templates/magic-link-invite.html):
   - `{{ .ConfirmationURL }}` substituído por `{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/definir-senha`.
   - Assim o link do e-mail cai direto no nosso domínio, verifica o token, e vai para `/definir-senha`.

4. ✅ Login: reconhece `?reason=convite_expirado` e mostra mensagem.

**O que ainda precisa ser feito manualmente no Supabase Dashboard:**

1. **Authentication → Email Templates → "Invite user"**:
   - Colar o HTML atualizado de `docs/email-templates/magic-link-invite.html`.

2. **Authentication → URL Configuration**:
   - `Site URL`: `https://www.sistemacalifa.com.br` (usada por `{{ .SiteURL }}` no template — precisa apontar para prod).
   - `Redirect URLs` (adicionar todas):
     ```
     https://www.sistemacalifa.com.br/api/auth/callback
     https://www.sistemacalifa.com.br/definir-senha
     http://localhost:3000/api/auth/callback
     http://localhost:3000/definir-senha
     ```

3. **Para testar em dev local**, o template usa `{{ .SiteURL }}` (que é o Site URL de produção). Duas opções:
   - Testar apenas no Vercel após deploy.
   - Ou, durante teste local, trocar `{{ .SiteURL }}` por `http://localhost:3000` no Dashboard temporariamente.

**Como testar (fluxo completo):**
1. Deploy dos commits novos para Vercel (ou testar em local com Site URL ajustada).
2. Colar template no Dashboard e salvar URL Configuration.
3. Supabase Dashboard → Authentication → Users → **Invite user** com um e-mail de teste.
4. Verificar entrega via Resend.
5. Clicar no link → deve cair em `/definir-senha` já com sessão ativa (email visível no topo do form).
6. Definir senha → cai em `/home`.
   - ⚠️ **Atenção:** hoje o convite pelo Dashboard **não cria vínculo em `tenant_members`**. O usuário vai definir a senha, mas ao chegar em `/home` o `requireSession()` vai barrar por `sem_tenant` e mandar de volta pro login. Vincular manualmente via SQL até termos a Task 006 (Admin console) com UI de convite.

**UI de admin para convidar** — ✅ IMPLEMENTADA (antecipada da Task 006):
- Menu **Administração** liberado na sidebar (adminOnly).
- Hub [`app/(app)/admin/page.tsx`](../app/(app)/admin/page.tsx) com card **Usuários** mostrando contagem de vínculos ativos.
- Página [`app/(app)/admin/usuarios/page.tsx`](../app/(app)/admin/usuarios/page.tsx) lista todos os vínculos do tenant (usa `createServiceClient` — autorização feita por `requireAdmin`). Mostra nome, e-mail, papel e status (perfil ativo × vínculo ativo).
- Drawer [`convidar-drawer.tsx`](../app/(app)/admin/usuarios/convidar-drawer.tsx) com form (e-mail, nome opcional, papel).
- Server action [`convidarUsuario`](../app/(app)/admin/usuarios/actions.ts):
  - Valida sessão + admin.
  - Se profile com esse e-mail já existe **sem** vínculo → só cria membership (sem novo e-mail).
  - Se profile já existe **com** vínculo → erro amigável.
  - Se não existe → `admin.inviteUserByEmail(email, { redirectTo: <origin>/api/auth/callback?next=/definir-senha })` + insert em `tenant_members` com role escolhida.
  - Origin é resolvido dinamicamente via headers (`x-forwarded-host`/`host`) — funciona em dev e em prod sem mudar código.
  - Registra `usuario.convidado` ou `usuario.membership_criada` em `audit_events`.
- Schema Zod: [`lib/validations/convite.ts`](../lib/validations/convite.ts).
- Auditoria: [`lib/auth/audit.ts`](../lib/auth/audit.ts) ganhou 4 novas ações (`usuario.convidado`, `usuario.membership_criada`, `usuario.membership_atualizada`, `usuario.reenvio_convite`).

**Ainda no backlog da Task 006 (próximos incrementos):**
- Inativar / reativar membership (soft-delete de vínculo).
- Trocar papel de um membro existente (drawer/dialog).
- Reenviar convite (para user que não ativou).
- Feed de auditoria (audit_events do tenant).
- MFA obrigatório para admin.

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

- **Task 006 — Administração** (continuar): inativar/reativar membership, trocar papel, reenviar convite, feed de auditoria.
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
