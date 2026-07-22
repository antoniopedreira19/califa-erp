# Feature 001 - Login Seguro

## Objetivo

Criar uma porta de entrada segura para o ERP.

## Usuários envolvidos

- Administrador.
- Gestão de Projetos.
- Financeiro.

## Escopo

- Login com Supabase Auth.
- Logout.
- Middleware de sessão.
- Profile do usuário.
- Tenant inicial Agência California.
- Vínculo do usuário com tenant.
- Bloqueio de usuário inativo.
- MFA obrigatório para administrador.
- Auditoria de login/logout.

## Permissões

Usuário sem sessão não acessa área interna.

Usuário autenticado sem profile ativo não acessa área interna.

Usuário autenticado sem vínculo ativo com tenant não acessa área interna.

Administrador deve configurar/validar MFA.

## Critérios de aceite

- Login funciona.
- Logout funciona.
- Rota privada redireciona para login sem sessão.
- MFA de administrador funciona.
- Usuário carrega contexto do tenant atual.
- Auditoria registra login/logout.
- Chave service role não aparece no client.

## Fora de escopo

- Convite de usuários.
- Gestão completa de permissões.
- SSO.
