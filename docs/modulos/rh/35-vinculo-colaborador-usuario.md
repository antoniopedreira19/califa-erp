# Vínculo Colaborador ↔ Usuário — Spec

> **Status**: Pronto pra implementação. Decisões travadas em 2026-10-03 com o PO.
>
> Fonte-verdade do subsistema. Toda decisão nova entra aqui, não em commit nem em chat.

## 1. Contexto

Hoje o módulo RH tem **210 colaboradores ativos** cadastrados em `colaboradores`, mas quase ninguém está vinculado a um usuário do sistema (`profiles` / `auth.users`). O campo `colaboradores.user_id` existe, é nullable (FK → `auth.users.id`, unique), mas é populado só manualmente via SQL.

Resultado prático:
- O colaborador não consegue abrir `/perfil` pra ver férias próprias e solicitar.
- Toda ação do colaborador (solicitação, assinatura de contrato futura) depende de ter login.
- O vínculo entre a pessoa real e o login tem que ser feito "na mão" por admin de banco.

Essa feature **dá autonomia ao RH** pra convidar o colaborador pro sistema diretamente da ficha dele, ou vincular a um login que já existe.

## 2. Objetivo

Permitir ao RH, a partir da ficha do colaborador em `/rh/colaboradores/[id]`:

1. **Convidar** o colaborador pro sistema por email, criando o usuário via Supabase Auth.
2. **Vincular** o colaborador a um usuário já existente (quando a pessoa já tem login por outro motivo — ex. era freelancer antes).
3. **Visualizar o estado do acesso** (sem acesso / convite pendente / vinculado) sem sair da ficha.
4. **Alterar role** ou **desvincular** quando necessário, sem precisar de banco direto.

Fora de escopo nesta feature:
- Vínculo em massa (modal de "sugerir vínculos pelos 203 colaboradores importados"). Decisão de 2026-10-03: não faremos agora.
- Multi-tenant. California é o único tenant por enquanto; nenhuma UI expõe seleção de tenant.
- Fluxo de self-signup via /perfil. O convite é sempre iniciado pelo RH.

## 3. Infraestrutura já existente (não refazer)

O trabalho é **majoritariamente UI**. O que já existe no banco e no código:

- **`colaboradores.user_id`** (uuid, nullable, FK → `auth.users.id`, unique). Migration `20261002000002_ferias_fundacao.sql:23`. Comentário embutido: "Populado quando o colaborador recebe acesso ao sistema. Nem todo colaborador precisa de login."
- **`profiles`** — criado automaticamente via trigger `handle_new_user` em `auth.users` (task 001).
- **`tenant_members`** (user_id, tenant_id, role, status) com enum `app_role` incluindo `colaborador`, `administrador`, `rh`, `gerente_producao`, `financeiro`, `produtor`, `freelancer`.
- **`/admin/usuarios/convidar-drawer.tsx` + `actions.ts`** — fluxo completo de convite via email:
  1. Checa se email já tem profile.
  2. Se sim e sem membership → cria só `tenant_members`.
  3. Se não tem profile → `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: "/definir-senha" })`.
  4. Trigger `handle_new_user` cria `profiles` automaticamente.
  5. Insere `tenant_members` com role escolhida.
- **Página `/rh/colaboradores/[id]`** com card `card-dados.tsx` que edita dados mestre.

Essa feature **reusa** o core de `/admin/usuarios/actions.ts` (ou extrai o pedaço útil pra `lib/`) em vez de duplicar.

## 4. Decisões travadas

### 4.1. Onde fica a UI
Único ponto de entrada: card **"Acesso ao sistema"** no detalhe do colaborador (`/rh/colaboradores/[id]`). Não vamos poluir a lista `/rh/colaboradores` com ação por linha nem permitir fluxo em massa.

### 4.2. Role default
**`colaborador`** — já existe no enum. É a role que dá acesso ao `/perfil` e nada mais (sem admin, sem RH, sem financeiro). O RH pode escolher outra no form (ex. produtor, gerente_producao) se o convidado for mais que colaborador comum.

### 4.3. Três estados do card "Acesso ao sistema"

| Estado | Como detectar | O que mostra | Ações disponíveis |
|---|---|---|---|
| **Sem acesso** | `colaboradores.user_id IS NULL` | "Não tem login no sistema." + email cadastrado em destaque. | **Convidar** · "ou vincular a usuário existente" |
| **Convite pendente** | `user_id` setado, mas `auth.users.last_sign_in_at IS NULL` e `auth.users.invited_at IS NOT NULL` | "Convite enviado em dd/mm. Aguardando o colaborador definir senha." | Reenviar convite · Cancelar (desvincula + remove tenant_member se foi só pra esse colaborador) |
| **Vinculado** | `user_id` setado + `last_sign_in_at IS NOT NULL` | "Vinculado a {nome do profile} · role {X} · ativo desde dd/mm". | Alterar role · Desvincular |

Fonte dos campos de detecção: `auth.users` é lido via service client no server (RLS protege contra RSC comum).

### 4.4. Fluxo "Convidar"

1. RH clica **Convidar** no card.
2. Drawer/modal abre com:
   - Email **pré-preenchido** com `colaboradores.email` (editável, mas se mexer avisa que a sincronização descrita em §4.6 vai usar o novo valor).
   - Select de role (default `colaborador`).
   - Preview: *"Vai ser enviado um convite pra {email}. Ele vai receber um link pra definir senha."*
3. Server action `convidarColaborador({ colaborador_id, email, role })`:
   1. Valida sessão RH.
   2. Carrega colaborador e confere `user_id IS NULL` (idempotência).
   3. Procura profile com esse email.
   4. **Se achar profile existente** → NÃO envia convite. Retorna `{ ok: false, codigo: "email_ja_cadastrado", profile_id, profile_nome }`. O cliente mostra: *"Esse email já tem um usuário cadastrado como `{nome}`. Deseja vincular esse colaborador a essa conta?"* com botão único **Vincular**.
   5. Se não achar → chama `inviteUserByEmail`, trigger cria profile, insere `tenant_members` com role escolhida, atualiza `colaboradores.user_id` com o novo profile.id.
   6. Registra audit event `colaborador.convite_enviado`.

### 4.5. Fluxo "Vincular a usuário existente" (manual)

1. RH clica **"ou vincular a usuário existente"** no card.
2. Modal com search box: digita nome ou email → lista até 20 profiles do tenant California que **ainda não estão vinculados a outro colaborador** (filtro: `profiles.id NOT IN (SELECT user_id FROM colaboradores WHERE user_id IS NOT NULL)`).
3. Seleciona um profile.
4. Confirma: `UPDATE colaboradores SET user_id = ?, email = <email do profile>` + garante `tenant_members` existe pra esse user (cria com role `colaborador` se não existe).
5. Registra audit event `colaborador.vinculado_a_usuario`.

### 4.6. Sincronização de email

Três cenários:

- **A — Convite com email de `colaboradores.email`**: convite vai pro email do colaborador. Emails iguais por construção, nada a sincronizar.
- **B — Email de `colaboradores.email` já tem profile (bloqueio no convite, usuário aceita vincular)**: emails iguais. Nada a sincronizar.
- **C — Vinculação manual a profile com email diferente**: ao vincular, `UPDATE colaboradores SET email = <email do profile>`. O email canônico passa a ser o do login. O email anterior fica no audit event, consultável se precisar.

Motivo: evita que a mesma pessoa tenha dois emails canônicos no sistema (`colaboradores.email` + `profiles.email`) que podem divergir no tempo.

### 4.7. Fluxo "Alterar role"

Troca role em `tenant_members`. Não mexe no vínculo.

### 4.8. Fluxo "Desvincular"

1. Confirmação explícita no modal: *"Isso vai remover o acesso de `{nome}` ao sistema. O usuário continua existindo, mas o colaborador deixa de estar vinculado. Deseja continuar?"*
2. `UPDATE colaboradores SET user_id = NULL`.
3. **Não** remove `profiles` nem `tenant_members` — o usuário pode ter outros vínculos (ex. foi convidado como produtor, não só colaborador).
4. Audit event `colaborador.desvinculado`.

### 4.9. Permissões

Só `administrador` e `rh` podem convidar / vincular / desvincular. Policy no banco já cobre via `is_tenant_rh()` + `is_tenant_admin()`.

### 4.10. Edição de email do colaborador quando já vinculado

Se o colaborador já tem `user_id`, o campo email na ficha fica **readonly** e com tooltip: *"Esse email vem do login. Pra mudar, altere no perfil do usuário em `/admin/usuarios`."*

Motivo: evitar que o RH mude email aqui achando que vai propagar pro login — não vai, e aí ficam dessincronizados.

## 5. UX detalhada do card

```
┌─ Acesso ao sistema ────────────────────────────────────┐
│                                                        │
│  Estado: Sem acesso                                    │
│  Email cadastrado: fulano@california.com               │
│                                                        │
│  Esse colaborador ainda não tem login. Pra que ele     │
│  acesse seu perfil e solicite férias, envie um         │
│  convite pelo email.                                   │
│                                                        │
│  [Convidar fulano@california.com]  ou vincular a um    │
│                                     usuário existente  │
└────────────────────────────────────────────────────────┘
```

```
┌─ Acesso ao sistema ────────────────────────────────────┐
│  Estado: ⏱ Convite pendente                            │
│                                                        │
│  Convite enviado em 03/10/2026 pra                     │
│  fulano@california.com. Aguardando ele definir senha.  │
│                                                        │
│  [Reenviar]  [Cancelar convite]                        │
└────────────────────────────────────────────────────────┘
```

```
┌─ Acesso ao sistema ────────────────────────────────────┐
│  Estado: ✓ Vinculado                                   │
│                                                        │
│  Fulano da Silva · colaborador                         │
│  fulano@california.com                                 │
│  Primeiro acesso em 05/10/2026                         │
│  Último acesso: hoje às 14:22                          │
│                                                        │
│  [Alterar role]  [Desvincular]                         │
└────────────────────────────────────────────────────────┘
```

## 6. Dados que a tela precisa

Query no server component da página `/rh/colaboradores/[id]`:

```sql
-- Além do que já carrega:
select
  u.email as auth_email,
  u.invited_at,
  u.last_sign_in_at,
  u.email_confirmed_at,
  tm.role as tenant_role,
  p.nome as profile_nome
from colaboradores c
left join auth.users u on u.id = c.user_id
left join profiles p on p.id = c.user_id
left join tenant_members tm on tm.user_id = c.user_id and tm.tenant_id = c.tenant_id
where c.id = $1;
```

Precisa de service client pra ler `auth.users` (RLS bloqueia leitura comum).

## 7. Riscos conhecidos

- **Convite silencioso**: `inviteUserByEmail` pode falhar sem erro visível se o SMTP do Supabase estiver limitado em projeto free. Checar que a feature retorna erro claro, não "sucesso em branco".
- **Race condition**: dois admins convidando a mesma pessoa ao mesmo tempo. Unique constraint em `colaboradores.user_id` protege; action trata erro de constraint e devolve mensagem clara.
- **Email trocado pelo RH no form**: se o RH edita o email do campo pré-preenchido antes de convidar, estamos efetivamente mudando `colaboradores.email` também (pra manter consistência §4.6). Avisar isso no form.
- **Desvincular um sócio ou admin principal**: nada protege contra desvincular por engano o único admin. Fora do escopo dessa feature — fica em uma validação futura de "não permitir desvincular o último administrador do tenant".

## 8. Métricas de sucesso

- 100% dos 210 colaboradores ativos passam de `user_id IS NULL` pra vinculado em até 2 meses pós-release (RH convida sob demanda, não é obrigatório vincular todo mundo).
- Zero tickets abertos por "esqueci de criar login pro fulano" ou "fulano não consegue acessar /perfil".
- Taxa de aceite do convite > 70% em 7 dias (indicador de que o email está chegando e o fluxo faz sentido).

## 9. Fora de escopo (pra referência)

- **Vínculo em massa** com sugestão automática por match de email. Pensado inicialmente pros 203 colaboradores do import histórico, mas descartado em 2026-10-03 — RH vai convidando sob demanda conforme a necessidade.
- **Fluxo de autoatendimento** (colaborador vê que não tem login, pede acesso ao RH). Pode entrar em release futuro.
- **Múltiplos emails por colaborador** (ex. pessoal + corporativo). Hoje `colaboradores.email` é único; se precisar de dois, modelar depois.
- **Expiração de convite**. Supabase controla isso internamente, mas não refletimos no card. Pode entrar no próximo iteração se tiver demanda.
