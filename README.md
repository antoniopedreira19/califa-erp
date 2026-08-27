# Califa ERP

ERP gerencial da Agência California, construído de forma incremental com foco inicial em orçamentos comerciais versionados e criação de jobs a partir da versão aprovada.

## Objetivo do MVP

Criar a base segura do sistema e entregar o primeiro fluxo operacional:

```text
Login seguro
-> Cadastro de clientes e fornecedores
-> Criação de orçamento
-> Criação/importação de versões do orçamento
-> Exportação da versão em planilha para envio externo ao cliente
-> Aprovação de uma versão
-> Criação obrigatória do job vinculado ao orçamento aprovado
```

## Stack

- Next.js 14 App Router
- React 18 + TypeScript
- Supabase (Auth · Postgres · RLS · Storage)
- Tailwind CSS + shadcn/ui + Radix
- lucide-react
- React Hook Form + Zod
- Vercel

## Status por task

| Task | Escopo | Status |
| --- | --- | --- |
| 001 | Fundação, auth, tenant, RLS, auditoria | ✅ implementado |
| 002 | Clientes e fornecedores | ⏳ próximo |
| 003 | Orçamentos | ⏳ |
| 004 | Versões, itens e importação de planilha | ⏳ |
| 005 | Criação de job a partir de orçamento aprovado | ⏳ |

## Documentação principal

- `docs/00-visao-geral.md`
- `docs/01-stack-e-arquitetura.md`
- `docs/02-seguranca-auth-rls.md`
- `docs/03-modelo-de-dados-mvp.md`
- `docs/04-regras-de-negocio.md`
- `docs/05-fluxos-mvp.md`
- `docs/06-criterios-de-aceite.md`
- `docs/07-governanca-de-dados.md`
- `docs/08-github-vercel-deploy.md`
- `docs/09-identidade-visual-ui.md`
- `docs/10-permissoes-por-perfil.md`

## Setup local

### 1. Instalar dependências

```powershell
npm install
```

### 2. Configurar variáveis de ambiente

```powershell
Copy-Item .env.example .env.local
```

Preencha `.env.local` com os valores reais do seu projeto Supabase:

- `NEXT_PUBLIC_SUPABASE_URL` — URL do projeto Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — chave pública anônima
- `SUPABASE_SERVICE_ROLE_KEY` — chave service role (**nunca commit, nunca client**)
- `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` — slug do tenant padrão (`agencia-california`)

### 3. Aplicar migrations no Supabase

Aplique a migration da Task 001 no seu projeto Supabase (via Studio ou CLI):

- Arquivo: `supabase/migrations/20260721000001_task001_fundacao_auth_seguranca.sql`

A migration cria:

- `tenants`, `profiles`, `tenant_members`, `audit_events`
- RLS em todas as tabelas com fronteira em `tenant_id`
- Helpers `is_tenant_member`, `is_tenant_admin`, `current_tenant_ids`, `current_profile_ativo`
- Trigger `handle_new_user` que popula `profiles` no signup
- RPC `log_audit_event(acao, tenant_id, entidade_tipo, entidade_id, metadata)`
- Seed do tenant `Agência California` (slug `agencia-california`)

### 4. Setup manual pós-migration (uma vez)

O admin inicial precisa ser criado manualmente no Supabase. É intencional — evita hard-code de credenciais no repositório.

**No Supabase Studio → Authentication → Users → Add user:**

1. Crie o usuário administrador com e-mail e senha temporária.
2. Marque "Auto Confirm User".
3. O trigger `handle_new_user` criará automaticamente o registro em `public.profiles` com role default `gestao_projetos`.

**No SQL Editor:**

```sql
-- Promova o usuário criado a administrador e vincule ao tenant.
-- Substitua <EMAIL> pelo e-mail que você acabou de criar.

with u as (
  select id from auth.users where email = '<EMAIL>' limit 1
),
tnt as (
  select id from public.tenants where slug = 'agencia-california' limit 1
)
update public.profiles
   set role = 'administrador', ativo = true
 where id = (select id from u);

with u as (
  select id from auth.users where email = '<EMAIL>' limit 1
),
tnt as (
  select id from public.tenants where slug = 'agencia-california' limit 1
)
insert into public.tenant_members (tenant_id, user_id, role, status)
select (select id from tnt), (select id from u), 'administrador', 'ativo'
on conflict (tenant_id, user_id)
do update set role = excluded.role, status = 'ativo';
```

### 5. Ativar MFA obrigatório para administradores

No MVP a política MFA depende de configuração no Supabase Dashboard. **Não é possível forçar MFA apenas pela migration.** Passos manuais:

1. Supabase Dashboard → **Authentication → Providers**: garanta que o provedor `Email` esteja ativo.
2. Supabase Dashboard → **Authentication → Multi-Factor Authentication**: habilite MFA (TOTP).
3. Peça ao administrador para cadastrar um app authenticator (Google Authenticator, 1Password etc.) no primeiro login.
4. Enquanto o fluxo administrativo dedicado não existir (task futura), a agência deve tratar administradores com MFA ativo como pré-requisito operacional.

Ver `docs/10-permissoes-por-perfil.md` para o resumo completo.

### 6. (Opcional) Supabase MCP para ferramentas de IA

O projeto inclui `.mcp.json` na raiz declarando dois servidores Supabase MCP:

- `supabase` — read-only. Ideal para inspeção de schema, `execute_sql` de leitura, listagem de migrations. Default seguro.
- `supabase-write` — sem `--read-only`. Necessário para `apply_migration`, criação de branches, deploy de edge functions. Ative apenas quando for aplicar mudanças.

Setup:

1. Gere um Personal Access Token em <https://supabase.com/dashboard/account/tokens>.
2. Exporte o token no shell **antes** de abrir o Claude Code:

   ```powershell
   $env:SUPABASE_ACCESS_TOKEN = "<seu-token>"
   claude
   ```

3. Na primeira execução, o Claude Code pede sua aprovação para cada servidor MCP declarado no `.mcp.json`.

O `project-ref` do projeto está fixado no `.mcp.json` (não é secret — aparece na URL pública do dashboard). O arquivo `.mcp.json` **é commitado** (config compartilhada com o time), mas o token nunca. Se você preferir carregar o token automaticamente, adicione-o ao seu perfil PowerShell (`$PROFILE`) — nunca ao `.env.local` versionado nem ao `.mcp.json`.

### 7. Rodar em desenvolvimento

```powershell
npm run dev
```

Aplicação em `http://localhost:3000`.

**Duas armadilhas do servidor de desenvolvimento** — as duas já custaram
tempo de investigação neste projeto:

- **A tela não muda depois de editar o código?** Confira de qual
  diretório o servidor está rodando antes de suspeitar de cache. Se
  houver git worktree em `.claude/worktrees/`, um `npm run dev` iniciado
  lá continua ocupando a 3000 e servindo o **outro checkout** — sem erro
  nenhum que denuncie. No macOS:

  ```bash
  lsof -a -p $(lsof -ti tcp:3000) -d cwd -Fn
  ```

- **Não rode `npm run build` com o `npm run dev` de pé.** Os dois
  escrevem no mesmo `.next`; o build corrompe o que o dev está servindo e
  a aplicação perde o CSS. Pare o dev antes, ou rode o build numa cópia
  do repositório.

### 8. Lint e typecheck

```powershell
npm run lint
npm run typecheck
```

Os dois passam **e a tela ainda pode estar quebrada**: comentário JSX
aberto e não fechado (`{/*` sem `*/}`) engole os componentes seguintes
sem virar erro de sintaxe, e nem `tsc`, nem `next lint`, nem
`npm run build` reclamam. Depois de mexer em bloco de JSX por
recorte/colagem, **abra a tela**.

## Estrutura do projeto

```text
app/
  (auth)/login/            # tela de login (public)
  (app)/                   # rotas protegidas por AppLayout
    home/
    layout.tsx
  api/auth/
    callback/route.ts      # OAuth/magic link callback
    logout/route.ts        # logout server-side com auditoria
  globals.css
  layout.tsx
  page.tsx                 # redirect → /login
  not-found.tsx
components/
  sidebar.tsx              # sidebar escura no padrão California
  ui/                      # shadcn base (Button, Input, Label, Card, Badge)
lib/
  auth/
    session.ts             # requireSession, requireAdmin, getSessionContext
    audit.ts               # logAuditEvent (RPC wrapper)
  supabase/
    client.ts              # browser client
    server.ts              # server client (RLS) + service client (bypass)
    middleware.ts          # cookie session refresh
  types.ts                 # AppRole, Profile, Tenant, SessionContext
  utils.ts                 # cn(), initials()
middleware.ts              # protege rotas privadas
supabase/
  migrations/              # migrations versionadas
```

## Segurança

- `SUPABASE_SERVICE_ROLE_KEY` é usada apenas em `lib/supabase/server.ts::createServiceClient()` e nunca importada por código client-side.
- Todas as tabelas operacionais têm RLS habilitada.
- Rotas privadas (tudo fora de `/login` e `/api/auth/*`) são bloqueadas no `middleware.ts` para usuários sem sessão.
- `requireSession()` (server-side) valida: sessão ativa, `profile.ativo = true`, vínculo ativo em `tenant_members`. Falha em qualquer condição → logout + redirect.
- Eventos `auth.login` e `auth.logout` são gravados em `audit_events` via RPC `log_audit_event`.

## GitHub e Vercel

- Nunca commitar `.env.local` ou qualquer arquivo com secrets.
- Migrations são versionadas e devem ser aplicadas na sequência.
- Deploy Vercel: configurar as variáveis de ambiente do `.env.example` no dashboard.
