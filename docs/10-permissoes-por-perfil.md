# Permissões por Perfil

Este documento formaliza a matriz de permissões inicial do ERP California, criada na Task 001. Ele deve ser atualizado a cada task que adicionar módulo novo.

## Papéis

Os papéis são armazenados em dois lugares:

- `profiles.role` — papel padrão do usuário na aplicação (default para novos vínculos).
- `tenant_members.role` — papel do usuário **dentro daquele tenant específico**. É este que a RLS considera.

Papéis iniciais:

| Papel | Uso |
| --- | --- |
| `administrador` | Gerencia usuários, permissões, tenants e dados administrativos. Único que pode gravar em `tenants` e `tenant_members`. |
| `gestao_projetos` | Cria e gerencia orçamentos, versões e jobs. Papel default para novos usuários. |
| `financeiro` | Reservado para módulos financeiros futuros (contas a pagar/receber, DRE). Sem uso operacional no MVP. |

## Matriz Task 001

| Recurso | Ler | Criar | Atualizar | Deletar |
| --- | --- | --- | --- | --- |
| `tenants` | membros ativos do tenant | apenas service role | apenas administrador do tenant | apenas service role (evitar) |
| `profiles` (próprio) | sempre | trigger `handle_new_user` | próprio nome (role/ativo bloqueados) | não |
| `profiles` (outros do tenant) | apenas administrador | apenas service role | apenas service role | não |
| `tenant_members` (próprio) | sempre | apenas administrador | apenas administrador | apenas administrador |
| `tenant_members` (outros) | apenas administrador | apenas administrador | apenas administrador | apenas administrador |
| `audit_events` (próprio) | sempre | próprio usuário via RPC | ❌ append-only | ❌ append-only |
| `audit_events` (outros) | apenas administrador | próprio usuário via RPC | ❌ | ❌ |

## Fronteira de segurança

- Toda tabela operacional carrega `tenant_id`.
- RLS usa a função `is_tenant_member(tenant_id)` para autorizar leitura.
- Escrita administrativa usa `is_tenant_admin(tenant_id)`.
- Profile inativo (`profiles.ativo = false`) é bloqueado no `requireSession()` e desloga o usuário.

## MFA

- MFA (TOTP) é obrigatório para o papel `administrador`.
- A obrigatoriedade não é imposta no banco. Configuração é feita no Supabase Dashboard (`Authentication → Multi-Factor Authentication`) e reforçada por processo operacional interno.
- Task futura deve criar tela administrativa que exige `aal2` para o papel `administrador` antes de liberar operações sensíveis.

## Auditoria

Eventos registrados na Task 001:

- `auth.login` — gravado pelo cliente após signIn bem-sucedido.
- `auth.logout` — gravado por `/api/auth/logout` antes do signOut.

Eventos reservados (implementação nas próximas tasks): ver `lib/auth/audit.ts::AuditAction`.

## Evolução

Cada nova task deve:

1. Adicionar a coluna do recurso na matriz acima.
2. Criar policies RLS que reflitam a matriz.
3. Registrar em `audit_events` as ações críticas.
4. Nunca depender apenas do frontend para autorização.
