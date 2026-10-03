# RH: vínculo colaborador ↔ usuário (task 010) (2026-10-02)

> O RH ganhou autonomia pra convidar colaboradores pro sistema a partir da ficha deles, ou vincular manualmente a um usuário que já existe. Antes, `colaboradores.user_id` era setado só por SQL manual — 210 colaboradores ativos sem nenhum login. Depois dessa entrega, o campo é operável no card "Acesso ao sistema" em `/rh/colaboradores/[id]`.

## O que muda pro negócio

- **RH convida o colaborador sem passar pelo admin de banco.** Email vai, trigger cria `profiles`, `tenant_members` entra ativo com role escolhida, `colaboradores.user_id` é preenchido na mesma ação.
- **Email que já tem conta no sistema** (ex: colaborador era freelancer antes e já tinha login) é detectado — em vez de bloquear o convite friamente, o fluxo oferece "Vincular a essa conta existente" com 1 clique.
- **Vinculação manual** por busca (nome ou email) resolve o caso do RH que quer plugar um colaborador novo num profile já existente com email diferente — a sincronização atualiza `colaboradores.email` com o email do login.
- **Reutilização de infra**: a lógica central (`verificarEstadoEmailNoTenant`, `enviarConviteNovoUsuario`, `garantirMembershipTenant`) ficou em `lib/auth/convidar.ts` pra o `/admin/usuarios` reusar numa refatoração futura (feita a partir dessa task). Hoje só o `/rh/colaboradores` consome, mas a assinatura já está pronta.

## Estado atual (o que existe agora)

- **Card "Acesso ao sistema"** em `/rh/colaboradores/[id]` com 3 estados visuais:
  - **Sem acesso** (`user_id IS NULL`) — mostra email + botões "Convidar" e "ou vincular a usuário existente".
  - **Convite pendente** (`user_id` setado + `last_sign_in_at IS NULL`) — mostra data do envio + "Reenviar convite" / "Cancelar convite".
  - **Vinculado** (`user_id` setado + usuário já acessou) — mostra nome + role + primeiro acesso + último acesso (formato relativo "há 3h", "ontem", "há 5 dias") + "Alterar role" / "Desvincular".
- **7 server actions** em `app/(app)/rh/colaboradores/actions-acesso.ts`: `convidarColaborador`, `vincularColaboradorAProfileExistente`, `reenviarConviteColaborador`, `desvincularColaborador`, `alterarRoleColaborador`, `buscarProfilesParaVincular`, `vincularColaboradorPorBusca`.
- **4 modais** no detalhe do colaborador: `modal-convidar-acesso`, `modal-vincular-existente` (com search box debounced 300ms), `modal-alterar-role`, mais `ConfirmDialog` nativo pra desvincular/cancelar convite.
- **Email readonly** no `editar-dados-drawer` quando `colaborador.user_id` está setado — com tooltip explicando que o email vem do login e precisa desvincular antes de alterar.
- **Role default do convite: `colaborador`** (role já existente no enum `app_role`, nunca tinha sido usada em produção).
- **4 novos tipos de audit action** adicionados ao enum em `lib/auth/audit.ts`: `colaborador.convite_enviado`, `colaborador.vinculado_a_usuario`, `colaborador.desvinculado`, `colaborador.role_alterada`.

## Decisões que vão importar amanhã

- **`garantirMembershipTenant` NUNCA sobrescreve role existente**. Esse foi o bug mais caro da sessão — ao vincular um colaborador a um profile que já era `administrador`, a role caía pra `colaborador` (default do modal). Caiu com o próprio Antonio Pedreira em prod. Fix: função preserva role existente, só reativa status se estava inativo. Pra alterar role, usar `alterarRoleColaborador` dedicada (que tem last-admin lockout). **Nunca mais chamar garantir pra "trocar" role.**
- **Vinculação manual sincroniza email**: ao vincular colaborador a profile com email diferente, `colaboradores.email` é sobrescrito com o email do profile. Motivo: evitar que a mesma pessoa tenha 2 emails canônicos que podem divergir no tempo. Documentado no audit event (`email_colaborador_anterior` + `email_sincronizado`).
- **Busca de profiles filtra os já vinculados**: `buscarProfilesParaVincular` exclui profiles que já têm um colaborador vinculado (`colaboradores.user_id IN (...)`), evitando duplo vínculo. Unique constraint em `colaboradores.user_id` é a defesa de fundo.
- **Email editável no form de convite muda `colaboradores.email` também**. Alerta visual no modal quando o email digitado difere do cadastrado. UX: "ao enviar o convite, o email do colaborador também será atualizado".
- **"Cancelar convite" ≠ "Desvincular"**: cancelar zera `user_id` do colaborador E remove `tenant_members` (porque foi criado só pra ele). Desvincular zera `user_id` mas **mantém `profiles` e `tenant_members`** (o usuário pode ter outros vínculos; ex: ex-produtor virando ex-colaborador mas continua freelancer).
- **Admin/RH são os únicos autorizados** por `checarPermissao("rh.colaboradores.editar")`. Nenhuma outra role vê o card de ações.
- **Hoje nada protege contra desvincular o último admin do tenant** — está em "pontos de confirmação" da task. Se o RH desvincular por engano o único admin ativo, resta SQL direto. Vale validar antes de rodar em escala.

## O que fica pra próxima sessão

- **Vínculo em massa**: considerado e descartado nessa sessão. Pros 210 ativos, o RH vai convidar sob demanda. Se a demanda aumentar, voltar aqui.
- **Refatoração do `/admin/usuarios/actions.ts`** pra consumir `lib/auth/convidar.ts` em vez de duplicar a lógica. Opcional, não bloqueia nada.
- **Catálogo de audit events dos convites**: hoje o `logAuditEvent` grava `email_colaborador_anterior`, `email_sincronizado`, `role_preservada`, `role_final`, `ja_tinha_conta` como metadata. Quando o feed de auditoria tiver UI (prioridade 2 do backlog geral), expor essas chaves com rótulos amigáveis.

## Rastros técnicos

Nenhuma migration nova. Toda a infra já existia:

- `colaboradores.user_id` (uuid nullable, FK → `auth.users.id`, unique) desde `20261002000002`.
- Enum `app_role` já inclui `colaborador` desde `20261002000001`.
- Trigger `handle_new_user` cria `profiles` automaticamente (task 001).
- Fluxo canônico de convite em `/admin/usuarios/actions.ts` serviu de modelo.

Arquivos novos:

```
lib/auth/convidar.ts                                          (helper compartilhado)
lib/auth/acesso-colaborador.ts                                (service client lê auth.users)
app/(app)/rh/colaboradores/actions-acesso.ts                  (7 server actions)
app/(app)/rh/colaboradores/[id]/card-acesso.tsx               (card principal, 3 estados)
app/(app)/rh/colaboradores/[id]/modal-convidar-acesso.tsx     (fluxo convite)
app/(app)/rh/colaboradores/[id]/modal-vincular-existente.tsx  (busca + seleção)
app/(app)/rh/colaboradores/[id]/modal-alterar-role.tsx        (select de role)
```

Arquivos tocados:

```
lib/auth/audit.ts                                             (4 novos tipos de ação)
lib/types.ts                                                  (role 'colaborador' já estava)
app/(app)/rh/colaboradores/[id]/page.tsx                      (carrega acesso + renderiza card)
app/(app)/rh/colaboradores/[id]/editar-dados-drawer.tsx       (email readonly quando vinculado)
```

Commits:

```
5c9e73a  docs(rh): spec + task plan do vínculo colaborador ↔ usuário
4bd311c  feat(rh): vínculo colaborador ↔ usuário (task 010)
251c108  fix(rh): vincular colaborador não rebaixa role de profile existente
```

Documentação complementar:
- Spec viva: `docs/modulos/rh/35-vinculo-colaborador-usuario.md`.
- Task plan: `tasks/active/010-vinculo-colaborador-usuario.md`.
