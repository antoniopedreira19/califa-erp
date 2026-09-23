# Task 005 - Criação do Job a partir do Orçamento Aprovado

## Objetivo

Permitir criar um job vinculado a um orçamento aprovado.

Esta task deve ser básica. O foco é fechar o fluxo inicial do gerente de projetos: depois que uma versão do orçamento for aprovada, o sistema deve permitir criar o job correspondente e preservar a referência ao orçamento e à versão aprovada.

## Pré-requisitos

- Task 003 concluída: tabela `orcamentos` criada.
- Task 004 concluída: tabela `versoes_orcamento` criada.
- Orçamento possui `versao_aprovada_id` preenchido.
- Orçamento está com status `aprovado`.

## Banco

- Criar tabela `jobs`.
- `tenant_id` obrigatório.
- `orcamento_id` obrigatório, referenciando `orcamentos.id`.
- `versao_orcamento_aprovada_id` obrigatório, referenciando `versoes_orcamento.id`.
- `cliente_id` obrigatório, referenciando `clientes.id`.
- `responsavel_id` referenciando `profiles.id`, quando definido.
- Índice único em `(tenant_id, orcamento_id)` para impedir dois jobs para o mesmo orçamento.
- Índices para `tenant_id`, `orcamento_id`, `versao_orcamento_aprovada_id`, `cliente_id`, `responsavel_id` e `status`.
- RLS por tenant.
- Policies de select/insert/update conforme papel do usuário.

## Campos iniciais sugeridos

Os campos finais do cadastro do job serão definidos durante esta task, quando forem apresentadas as informações completas necessárias ao job.

Campos mínimos para começar:

- `id`
- `tenant_id`
- `codigo`
- `nome`
- `orcamento_id`
- `versao_orcamento_aprovada_id`
- `cliente_id`
- `responsavel_id`
- `status`
- `tipo`
- `campanha`
- `data_inicio_prevista`
- `data_fim_prevista`
- `data_abertura`
- `created_by`
- `created_at`
- `updated_at`

## Interface

- Botão/ação de criar job dentro do orçamento aprovado.
- Tela ou modal simples para confirmar os dados principais do job.
- Bloqueio visual quando o orçamento ainda não estiver aprovado.
- Link para abrir o job criado.
- Indicação no orçamento de que o job já foi criado.

## Regras

- Job só pode ser criado a partir de orçamento aprovado.
- Job só pode ser criado se existir versão aprovada.
- Job deve copiar informações básicas do orçamento aprovado.
- Job deve manter referência ao orçamento e à versão aprovada.
- Job deve nascer com status inicial `aberto`.
- Após criar o job, atualizar `orcamentos.status` para `job_criado`.
- O banco deve impedir duplicidade de job para o mesmo orçamento.
- Criação do job deve gerar evento em `audit_events`.

## Fora do escopo

- Planejado.
- Realizado.
- Contas a pagar.
- Contas a receber.
- Rentabilidade.
- DRE.
- Produção detalhada.

## Critérios de conclusão

- Orçamento aprovado permite criar job.
- Orçamento sem versão aprovada não permite criar job.
- Job criado referencia `orcamento_id`.
- Job criado referencia `versao_orcamento_aprovada_id`.
- Job criado possui `tenant_id`.
- RLS impede acesso fora do tenant.
- Banco impede dois jobs para o mesmo orçamento.
- Orçamento passa para status `job_criado`.
- Evento de auditoria é registrado.
