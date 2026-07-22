# Segurança, Auth e RLS

## Princípio

A base de dados é um ativo estratégico da Agência California. Segurança, isolamento por tenant e rastreabilidade devem existir desde a fundação do sistema.

## Supabase Auth

Supabase Auth será responsável por:

- login;
- sessão;
- recuperação de senha;
- MFA para administradores;
- identidade principal do usuário.

O frontend nunca deve usar `SUPABASE_SERVICE_ROLE_KEY`.

## Profiles

A tabela `profiles` complementa o usuário do Auth com dados de aplicação:

- `id`
- `nome`
- `email`
- `role`
- `ativo`
- `created_at`
- `updated_at`

## Tenants

Mesmo que por bastante tempo exista apenas a Agência California, o banco deve nascer preparado para múltiplas empresas.

Toda tabela operacional deve ter `tenant_id`.

## Papéis iniciais

- `administrador`: gerencia usuários, permissões e dados principais.
- `gestao_projetos`: cria e acompanha orçamentos, versões de orçamento e jobs abertos a partir de orçamentos aprovados.
- `financeiro`: terá acesso aos dados financeiros conforme os módulos futuros forem liberados.

## RLS

Todas as tabelas operacionais devem ter RLS habilitado.

Regra base:

```text
usuário autenticado
-> profile ativo
-> vínculo ativo em tenant_members
-> acesso limitado ao tenant_id permitido
```

RLS deve proteger:

- clientes;
- fornecedores;
- orçamentos;
- versões de orçamento;
- itens de versão;
- importações;
- jobs;
- auditoria.

## Operações sensíveis

Operações sensíveis devem passar por Server Actions ou Route Handlers:

- aprovação de versão de orçamento;
- criação de job a partir de orçamento aprovado;
- criação/alteração de usuário;
- alteração de permissões;
- uso de `service_role`, quando inevitável;
- importação de planilhas;
- alterações administrativas.

## Auditoria

Registrar em `audit_events`:

- login;
- logout;
- criação/edição/inativação de cliente;
- criação/edição/inativação de fornecedor;
- criação de orçamento;
- criação/importação de versão de orçamento;
- aprovação de versão de orçamento;
- criação de job a partir de orçamento aprovado;
- uso de custo C;
- tentativa negada de ação sensível, quando tecnicamente viável.
