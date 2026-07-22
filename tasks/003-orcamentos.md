# Task 003 - Orçamentos

## Objetivo

Implementar a criação e listagem de orçamentos comerciais, que são a etapa anterior ao job.

## Banco

- Tabela `orcamentos`.
- `tenant_id` obrigatório em `orcamentos`.
- `cliente_id` obrigatório.
- `gp_responsavel_id` opcional no começo, mas recomendado.
- `versao_aprovada_id` começa nulo.
- Índices para `tenant_id`, `cliente_id`, `gp_responsavel_id`, `status` e `versao_aprovada_id`.

## Interface

- Tela de listagem de orçamentos.
- Botão de novo orçamento.
- Formulário de criação.
- Formulário de edição enquanto não aprovado.
- Status do orçamento.
- Área para versões do orçamento.

## Fluxo

- Usuário cria orçamento.
- Sistema vincula ao tenant atual.
- Sistema registra cliente, campanha, tipo e período previsto.
- Sistema salva como `rascunho` ou `em_revisao`.
- Job ainda não é criado.

## Critérios de conclusão

- Orçamento aparece na listagem.
- Orçamento respeita RLS por tenant.
- Usuário sem permissão não cria orçamento.
- Orçamento sem versão aprovada não tem job.
- Banco não possui tabela `pre_jobs`.
