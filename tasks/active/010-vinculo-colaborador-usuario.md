# Task 010 — Vínculo colaborador ↔ usuário (convite + vínculo manual)

## Objetivo

Permitir ao RH, a partir da ficha do colaborador em `/rh/colaboradores/[id]`:

1. **Convidar** o colaborador pro sistema via email (cria login + profile + tenant_member + popula `colaboradores.user_id`).
2. **Vincular** manualmente o colaborador a um profile já existente.
3. **Visualizar o estado do acesso** (sem acesso / convite pendente / vinculado) no próprio card.
4. **Alterar role** e **desvincular** sem precisar mexer no banco.

Hoje `colaboradores.user_id` é setado só manualmente via SQL — nenhum dos 210 ativos tem acesso automático a `/perfil`.

**Fora de escopo** (não implementar):
- Vínculo em massa.
- UI de "autoatendimento" do colaborador pedindo acesso.
- Multi-tenant (California é único tenant).

## Spec de referência

Toda decisão travada está em `docs/modulos/rh/35-vinculo-colaborador-usuario.md`. Qualquer dúvida de regra de negócio, consultar lá antes de inventar.

## Contexto do ponto de partida

### Já pronto no banco (não refazer)

- `colaboradores.user_id` uuid nullable FK → `auth.users.id`, unique (`20261002000002_ferias_fundacao.sql:23`).
- Enum `app_role` já inclui `colaborador`.
- Trigger `handle_new_user` cria profile automaticamente.
- `tenant_members` com (user_id, tenant_id, role, status).

### Já pronto no código (REUSAR, não duplicar)

- `/admin/usuarios/convidar-drawer.tsx` e `/admin/usuarios/actions.ts` têm o fluxo completo de convite via `supabase.auth.admin.inviteUserByEmail`. A lógica útil (checar email duplicado, chamar invite, criar tenant_member) deve ser **extraída** pra `lib/auth/convidar.ts` e consumida pelos dois pontos.

### O que falta

- UI (card novo + 3 modais).
- Server actions no diretório `/rh/colaboradores` que chamam o helper compartilhado.
- Service client pra ler `auth.users` (`invited_at`, `last_sign_in_at`).

## Decisões travadas (resumo da spec)

- Role default no convite = `colaborador`.
- Email editável no form de convite; se o RH mudar, o email do colaborador também é atualizado (sincronização §4.6 da spec).
- Vinculação manual a profile com outro email → `UPDATE colaboradores SET email = <email do profile>`.
- Desvincular não remove profile nem tenant_member, só zera `user_id`.
- Edição de `colaboradores.email` fica readonly quando `user_id IS NOT NULL`.

## Escopo de banco

**Nenhuma migration nova é obrigatória.** Toda a estrutura já existe.

Opcional (pode entrar nesta task se simplificar o código):
- Policy de leitura em `auth.users` via função security definer `fn_colaborador_acesso(colaborador_id)` que retorna `invited_at`, `last_sign_in_at`, `email_confirmed_at` apenas pros admins/RH do tenant. Evita precisar carregar o service client em RSC. Avaliar durante a implementação.

Audit:
- Reusar tabela `audit_events` (já existe).
- Tipos de evento novos: `colaborador.convite_enviado`, `colaborador.vinculado_a_usuario`, `colaborador.desvinculado`, `colaborador.role_alterada`. Enum `audit_event_type` precisa estender se for enum fechado; checar antes de assumir.

## Passos de implementação

### Passo 1 — Extrair helper compartilhado de convite

**Arquivo novo**: `lib/auth/convidar.ts`

Função principal:
```ts
export async function convidarOuVincularPorEmail(opts: {
  email: string;
  tenant_id: string;
  role: AppRole;
  nome?: string;
}): Promise<
  | { ok: true; profile_id: string; ja_existia: boolean }
  | { ok: false; codigo: "email_invalido" | "falha_smtp" | "falha_db"; mensagem: string }
>;
```

Internamente:
1. Checa se existe profile com esse email.
2. Se existe → garante `tenant_members` com a role (upsert com conflito em (user_id, tenant_id) para só criar se faltar), retorna `profile_id` e `ja_existia: true`.
3. Se não existe → chama `admin.inviteUserByEmail`, aguarda trigger, insere `tenant_members`, retorna `profile_id` e `ja_existia: false`.

Refatorar `/admin/usuarios/actions.ts` pra usar essa função. **Testar que /admin/usuarios continua funcionando igual**.

### Passo 2 — Service client pra ler `auth.users`

**Arquivo novo**: `lib/auth/acesso-colaborador.ts`

```ts
export async function carregarAcessoColaborador(user_id: string): Promise<{
  invited_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  auth_email: string;
}>;
```

Usa `createServiceClient()`. Chamada do server component da página do colaborador.

### Passo 3 — Server actions do /rh/colaboradores

**Arquivo**: `app/(app)/rh/colaboradores/[id]/actions.ts` (ou arquivo existente, se já tiver).

Actions:

```ts
convidarColaborador({ colaborador_id, email, role }): Promise<Result>
  // 1. Valida sessão RH.
  // 2. Carrega colaborador, confere user_id IS NULL.
  // 3. Se email !== colaborador.email: UPDATE colaboradores.email também.
  // 4. Chama convidarOuVincularPorEmail.
  // 5. UPDATE colaboradores SET user_id = <profile>.
  // 6. Audit event colaborador.convite_enviado (com ja_existia na metadata).

vincularColaboradorAUsuario({ colaborador_id, profile_id }): Promise<Result>
  // 1. Valida sessão RH.
  // 2. Carrega colaborador, confere user_id IS NULL.
  // 3. Carrega profile.email.
  // 4. UPDATE colaboradores SET user_id = ?, email = <email do profile>.
  // 5. Garante tenant_members existe (upsert com role 'colaborador' se faltar).
  // 6. Audit event colaborador.vinculado_a_usuario.

reenviarConvite({ colaborador_id }): Promise<Result>
  // Chama admin.inviteUserByEmail de novo pro email atual.

cancelarConvite({ colaborador_id }): Promise<Result>
  // UPDATE colaboradores SET user_id = NULL.
  // DELETE tenant_members se foi criado só pra esse colaborador (verificar com a flag ja_existia salva no audit, ou com uma coluna específica? decidir na impl).
  // NÃO deleta auth.users (perigoso).
  // Audit event colaborador.desvinculado com reason='convite_cancelado'.

desvincularColaborador({ colaborador_id }): Promise<Result>
  // UPDATE colaboradores SET user_id = NULL.
  // NÃO deleta profile nem tenant_members.
  // Audit event colaborador.desvinculado.

alterarRoleColaborador({ colaborador_id, nova_role }): Promise<Result>
  // UPDATE tenant_members SET role = ? WHERE user_id = <colaborador.user_id>.
  // Audit event colaborador.role_alterada.

buscarProfilesParaVincular({ tenant_id, termo }): Promise<ProfileResumo[]>
  // Busca profiles por nome ou email que NÃO estão vinculados a nenhum colaborador.
  // Limite 20. Server action porque usa service client (ou RPC).
```

### Passo 4 — UI do card "Acesso ao sistema"

**Arquivo novo**: `app/(app)/rh/colaboradores/[id]/card-acesso.tsx`

Server component que recebe o colaborador + dados de acesso carregados e renderiza um dos 3 estados (ver §5 da spec). Botões abrem modais client.

**Arquivos de modais** (clients):
- `modal-convidar.tsx` — form com email + role.
- `modal-vincular-existente.tsx` — search box + lista + confirm.
- `modal-alterar-role.tsx` — select de role.
- `modal-desvincular.tsx` — confirm.

Posicionamento: dentro de `/rh/colaboradores/[id]/page.tsx`, abaixo (ou ao lado) do `card-dados.tsx`.

### Passo 5 — Readonly do email quando vinculado

Editar `card-dados.tsx` pra marcar o campo email como readonly quando `colaborador.user_id IS NOT NULL`, com tooltip explicativo (spec §4.10).

### Passo 6 — Testes manuais

Checklist no browser:

- [ ] Colaborador sem user_id: card mostra "Sem acesso" com botão Convidar.
- [ ] Convidar com email novo: convite é enviado, user_id popula, card vira "Convite pendente".
- [ ] Convidar com email que já tem profile: card mostra modal "Email já tem conta, vincular?". Confirmar vincula.
- [ ] Vincular manualmente a profile com email diferente: `colaboradores.email` atualiza pro email do profile.
- [ ] Reenviar convite: email volta a chegar.
- [ ] Cancelar convite: card volta pra "Sem acesso".
- [ ] Desvincular: card volta pra "Sem acesso", profile continua existindo.
- [ ] Alterar role: role muda em `tenant_members`, histórico aparece em audit.
- [ ] Campo email de `card-dados.tsx` fica readonly quando colaborador vinculado.
- [ ] Usuário com role != admin/rh não vê o card (ou vê sem botões).

## Validação de performance

Carregar `/rh/colaboradores/[id]` deve continuar < 1s. O JOIN com `auth.users` + `profiles` + `tenant_members` deve ser **1 query** no server component, não 3 round-trips. Se virar bottleneck, consolidar via RPC.

## Riscos conhecidos (do spec, resumidos)

- SMTP do Supabase pode engasgar em projeto free — garantir que a feature mostra erro, não "sucesso em branco".
- Race condition em convite duplicado protegida pelo unique em `colaboradores.user_id`.
- Edição do email no form de convite muda `colaboradores.email` também — avisar na UI.
- Nenhuma proteção contra "desvincular o último admin do tenant". Fica pra iteração futura.

## Pontos de confirmação com o PO antes de PR

- Comportamento do botão "Alterar role" quando a role atual já é a mesma selecionada (desabilitar? ou aceitar e virar no-op?).
- Permitir desvincular um colaborador que também é administrador (ex. o próprio Antonio)? Hoje nada impede, mas deveria?
- Audit events — qual campo da metadata guardar: só o novo valor, ou (velho, novo)?

## Dependências

- Task 008 (integração ZapSign) e Task 009 (performance RH) são independentes — essa task pode entrar em paralelo.
- Nenhum bloqueio no banco. Nenhum bloqueio no frontend.

## Estimativa

- Passo 1 (helper): 2h
- Passo 2 (service client): 1h
- Passo 3 (actions): 3h
- Passo 4 (UI + 4 modais): 5h
- Passo 5 (readonly email): 30min
- Passo 6 (testes manuais): 1h
- **Total**: ~12h de implementação focada. 1,5 dias úteis.
