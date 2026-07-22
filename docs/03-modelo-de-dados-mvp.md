# Modelo de Dados do MVP

Este modelo cobre a primeira versão do ERP: login seguro, clientes, fornecedores, orçamentos comerciais versionados e criação de jobs a partir de uma versão aprovada.

## Decisão central

O trabalho não nasce mais como pré-job.

O fluxo correto é:

```text
Orçamento
-> versões do orçamento
-> uma versão aprovada
-> criação obrigatória do job
-> job vinculado ao orçamento aprovado
```

Portanto, as tabelas centrais do fluxo são:

- `orcamentos`
- `versoes_orcamento`
- `jobs`

O termo "pré-job" não deve ser usado como entidade de banco. Quando a equipe estiver falando da fase anterior ao job, o conceito correto no sistema é **orçamento em andamento**.

## Criação das tabelas por task

As tabelas devem ser criadas de forma incremental, acompanhando a task responsável pelo domínio.

- Task 001: fundação de auth, tenant, perfis, vínculos, permissões e auditoria.
- Task 002: `clientes` e `fornecedores`.
- Task 003: `orcamentos`.
- Task 004: `versoes_orcamento`, `versoes_orcamento_itens` e `orcamento_importacoes`.
- Task 005: `jobs`, com vínculo obrigatório ao orçamento aprovado e à versão aprovada.

Cada task deve entregar suas migrations com FKs, índices, RLS, policies e auditoria compatíveis com o escopo.

## Regra global de tenant

Mesmo que o MVP tenha apenas a Agência California, o banco deve nascer multi-tenant.

Toda tabela operacional deve ter:

- `tenant_id`
- índice em `tenant_id`
- RLS validando vínculo ativo do usuário com o tenant

Tenant inicial:

- Nome: Agência California.
- Slug: `agencia-california`.

## Regra global de referência e integridade

Toda relação de negócio clara deve ser representada por chave estrangeira.

Campos críticos devem ter constraints e índices compatíveis com o uso esperado. No Postgres, chaves estrangeiras devem ter índices próprios para evitar lentidão em consultas, joins e operações de cascata.

Exemplos:

- `orcamentos.tenant_id` referencia `tenants.id`;
- `orcamentos.cliente_id` referencia `clientes.id`;
- `orcamentos.responsavel_id` referencia `profiles.id`;
- `versoes_orcamento.orcamento_id` referencia `orcamentos.id`;
- `versoes_orcamento_itens.versao_orcamento_id` referencia `versoes_orcamento.id`;
- `versoes_orcamento_itens.fornecedor_id` referencia `fornecedores.id`, quando definido;
- `jobs.tenant_id` referencia `tenants.id`;
- `jobs.orcamento_id` referencia `orcamentos.id`;
- `jobs.versao_orcamento_aprovada_id` referencia `versoes_orcamento.id`;
- `jobs.cliente_id` referencia `clientes.id`.

## Tabelas de segurança e tenant

### tenants

Representa a empresa/organização dona dos dados.

Campos sugeridos:

- `id`
- `nome`
- `slug`
- `status`
- `created_at`
- `updated_at`

### profiles

Perfil do usuário autenticado.

Campos sugeridos:

- `id`
- `nome`
- `email`
- `role`
- `ativo`
- `created_at`
- `updated_at`

### tenant_members

Vínculo entre usuário e tenant.

- `id`
- `tenant_id`
- `user_id`
- `role`
- `status`
- `created_at`
- `updated_at`

Roles iniciais:

- `administrador`
- `gestao_projetos`
- `financeiro`

### audit_events

Registro de ações relevantes.

Campos sugeridos:

- `id`
- `tenant_id`
- `actor_user_id`
- `acao`
- `entidade_tipo`
- `entidade_id`
- `metadata`
- `created_at`

Esta tabela deve ser append-only na prática: usuários comuns não devem editar ou apagar eventos.

## Cadastros

### clientes

- `id`
- `tenant_id`
- `nome`
- `razao_social`
- `cnpj`
- `email`
- `telefone`
- `status`
- `observacoes`
- `created_at`
- `updated_at`

### fornecedores

- `id`
- `tenant_id`
- `nome`
- `razao_social`
- `cpf_cnpj`
- `email`
- `telefone`
- `status`
- `observacoes`
- `created_at`
- `updated_at`

## Gestão de projetos e orçamento

### orcamentos

Representa a oportunidade comercial antes da criação do job.

O orçamento é criado pelo gestor, pode ter várias versões e só gera um job quando uma versão for aprovada.

Campos sugeridos:

- `id`
- `tenant_id`
- `codigo`
- `nome`
- `cliente_id`
- `responsavel_id`
- `status`
- `tipo`
- `campanha`
- `data_inicio_prevista`
- `data_fim_prevista`
- `versao_aprovada_id`
- `aprovado_em`
- `aprovado_por`
- `created_by`
- `created_at`
- `updated_at`

Status sugeridos:

- `rascunho`
- `em_revisao`
- `enviado_cliente`
- `aprovado`
- `job_criado`
- `recusado`
- `cancelado`

Regras importantes:

- `versao_aprovada_id` começa nulo.
- Quando uma versão for aprovada, `versao_aprovada_id` aponta para `versoes_orcamento.id`.
- Após a aprovação, o sistema deve exigir a criação do job.
- Quando o job for criado, o vínculo fica em `jobs.orcamento_id`.
- Um orçamento aprovado deve gerar no máximo um job, regra garantida por índice único em `jobs.orcamento_id`.

### versoes_orcamento

Representa cada versão do orçamento: v1, v2, v3, v4 etc.

Campos sugeridos:

- `id`
- `tenant_id`
- `orcamento_id`
- `numero_versao`
- `nome`
- `status`
- `moeda`
- `taxa_cambio`
- `percentual_honorarios`
- `percentual_imposto`
- `arquivo_original_url`
- `aprovado_em`
- `aprovado_por`
- `created_by`
- `created_at`
- `updated_at`

Status sugeridos:

- `rascunho`
- `em_revisao`
- `enviada_cliente`
- `aprovada`
- `reprovada`
- `substituida`
- `cancelada`

Regra: apenas uma versão por orçamento pode estar aprovada.

Essa regra deve ser garantida no banco, não apenas na aplicação:

```sql
create unique index unique_versao_aprovada_por_orcamento
on versoes_orcamento (tenant_id, orcamento_id)
where status = 'aprovada';
```

Também deve existir constraint única para evitar dois números iguais no mesmo orçamento:

```sql
create unique index unique_numero_versao_por_orcamento
on versoes_orcamento (tenant_id, orcamento_id, numero_versao);
```

### versoes_orcamento_itens

Tabela necessária para guardar as linhas do orçamento. As três tabelas centrais são `orcamentos`, `versoes_orcamento` e `jobs`, mas os itens precisam existir como tabela filha para que o sistema consiga calcular totais, honorários e impostos de forma auditável.

No MVP, representa apenas a visão **Orçado**.

- `id`
- `tenant_id`
- `versao_orcamento_id`
- `ordem`
- `grupo`
- `planilha_origem`
- `item`
- `tipo_custo`
- `valor_unitario_orcado`
- `quantidade_orcada`
- `dias_meses_orcado`
- `total_orcado`
- `fornecedor_id`
- `observacoes`
- `created_at`
- `updated_at`

Tipos de custo:

- `A`
- `B`
- `C`
- `D`

### orcamento_importacoes

Registra importações de planilha por versão do orçamento.

- `id`
- `tenant_id`
- `versao_orcamento_id`
- `arquivo_url`
- `nome_arquivo`
- `linhas_lidas`
- `linhas_importadas`
- `erros`
- `created_by`
- `created_at`

### jobs

Representa o trabalho operacional criado depois da aprovação de uma versão de orçamento.

O job não deve existir antes da aprovação. Quando criado, ele deve guardar referência ao orçamento e à versão aprovada que deram origem a ele.

Campos sugeridos:

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

Status sugeridos:

- `aberto`
- `em_andamento`
- `pausado`
- `concluido`
- `cancelado`

Regras importantes:

- `jobs.orcamento_id` deve ser obrigatório.
- `jobs.versao_orcamento_aprovada_id` deve ser obrigatório.
- `jobs.orcamento_id` deve ser único, para impedir dois jobs para o mesmo orçamento aprovado.
- O job deve copiar campos essenciais do orçamento aprovado para facilitar operação e relatórios, mas a referência original deve permanecer preservada.

Sugestão de índice:

```sql
create unique index unique_job_por_orcamento
on jobs (tenant_id, orcamento_id);
```

## Cálculos derivados

Subtotais, honorários, impostos, faturamento previsto e totais não devem ser digitados manualmente. Eles devem ser calculados a partir dos itens da versão do orçamento.
