# Feature 002 - Clientes e Fornecedores

## Objetivo

Permitir cadastrar as entidades necessárias antes da criação do orçamento.

## Escopo

- Criar cliente.
- Editar cliente.
- Inativar cliente.
- Criar fornecedor.
- Editar fornecedor.
- Inativar fornecedor.
- Buscar por nome, razão social, CNPJ ou CPF/CNPJ.

## Regras

- Cliente deve existir antes do orçamento.
- Fornecedor pode ser cadastrado antes ou durante a construção da versão do orçamento.
- Todos os registros pertencem a um tenant.
- Exclusão física deve ser evitada.
- CPF/CNPJ deve ajudar a evitar duplicidade.

## Critérios de aceite

- Cliente ativo aparece na seleção de orçamento.
- Fornecedor ativo aparece nos itens da versão do orçamento.
- Usuário sem permissão não cria, edita ou inativa.
- RLS impede acesso fora do tenant.
