# Task 002 - Cadastros de Clientes e Fornecedores

## Objetivo

Permitir criar as entidades necessárias para o orçamento.

## Banco

- Tabela `clientes`.
- Tabela `fornecedores`.
- `tenant_id` obrigatório nas duas tabelas.
- FK para `tenants.id`.
- Índices para `tenant_id`, `cnpj`, `cpf_cnpj` e `status`.
- RLS por tenant.

## Interface

- Listagem de clientes.
- Formulário de cliente.
- Listagem de fornecedores.
- Formulário de fornecedor.
- Busca simples.
- Ação de inativar.

## Regras

- Cliente ativo aparece na seleção de orçamento.
- Fornecedor ativo aparece nos itens da versão do orçamento.
- CPF/CNPJ ajuda a evitar duplicidade.
- Exclusão física deve ser evitada.

## Critérios de conclusão

- Cliente pode ser criado, editado e inativado.
- Fornecedor pode ser criado, editado e inativado.
- RLS impede acesso fora do tenant.
- Usuário sem permissão não altera cadastros.
