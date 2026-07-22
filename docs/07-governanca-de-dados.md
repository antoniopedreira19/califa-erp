# Governança de Dados

## Princípio central

A base de dados é um ativo estratégico da Agência California. O ERP deve tratar os dados como patrimônio da empresa, não apenas como suporte da aplicação.

Toda implementação deve priorizar:

- segurança;
- rastreabilidade;
- consistência;
- permissões corretas;
- isolamento por tenant;
- histórico;
- possibilidade de auditoria;
- recuperação em caso de erro.

## Regras obrigatórias

### 1. Tenant como fronteira de segurança

Toda tabela operacional deve ter `tenant_id`.

O usuário só pode acessar dados de tenants aos quais possui vínculo ativo em `tenant_members`.

Consultas, inserts e updates devem ser protegidos por RLS, mesmo que a interface já filtre os dados.

### 2. Permissão por papel

Cada usuário deve possuir um papel claro no tenant.

Papéis iniciais:

- `administrador`
- `gestao_projetos`
- `financeiro`

O papel define o que o usuário pode ver, criar, editar, aprovar ou inativar.

### 3. Menor privilégio

Usuários devem ter apenas o acesso necessário para executar seu trabalho.

Exemplos:

- Gestão de Projetos pode criar orçamentos, versões e jobs a partir de orçamento aprovado.
- Financeiro pode futuramente ver dados financeiros.
- Administrador pode configurar usuários e permissões.

Permissões não devem ser amplas por conveniência.

### 4. RLS em todas as tabelas operacionais

Nenhuma tabela operacional deve ficar sem RLS.

Policies devem cobrir:

- select;
- insert;
- update;
- delete apenas quando for realmente permitido.

Delete físico deve ser evitado. Preferir:

- `status`;
- `ativo`;
- `archived_at`;
- eventos de estorno/correção;
- histórico.

### 5. Referências e integridade

Dados importantes devem ser referenciados por chaves estrangeiras.

Exemplos:

- `orcamentos.cliente_id` referencia `clientes.id`;
- `orcamentos.gp_responsavel_id` referencia `profiles.id`;
- `versoes_orcamento.orcamento_id` referencia `orcamentos.id`;
- `versoes_orcamento_itens.versao_orcamento_id` referencia `versoes_orcamento.id`;
- `versoes_orcamento_itens.fornecedor_id` referencia `fornecedores.id`, quando houver fornecedor definido;
- `jobs.orcamento_id` referencia `orcamentos.id`;
- `jobs.versao_orcamento_aprovada_id` referencia `versoes_orcamento.id`;
- `jobs.cliente_id` referencia `clientes.id`;
- tabelas operacionais referenciam `tenants.id`.

Não duplicar dados estruturais quando uma referência resolve.

### 6. Auditoria

Ações relevantes devem ser registradas em `audit_events`.

Eventos obrigatórios no MVP:

- login;
- logout;
- criação/edição/inativação de cliente;
- criação/edição/inativação de fornecedor;
- criação/edição de orçamento;
- criação de versão de orçamento;
- importação de planilha;
- aprovação de versão de orçamento;
- criação de job a partir de orçamento aprovado;
- uso de custo C;
- tentativa negada de ação sensível, quando tecnicamente viável.

### 7. Histórico de status

Mudanças de status não devem ser silenciosas.

No MVP, eventos relevantes devem ser registrados em `audit_events`, especialmente aprovação de versão de orçamento e criação de job a partir de orçamento aprovado.

Se o fluxo ficar mais complexo, criar tabelas específicas de histórico, como:

- `orcamento_status_historico`
- `job_status_historico`

### 8. Dados sensíveis

Dados sensíveis não devem aparecer para quem não precisa deles.

Exemplos:

- dados financeiros futuros;
- margens futuras;
- custos internos;
- anexos;
- aprovações especiais;
- informações fiscais.

No MVP, antes da aprovação do orçamento, a interface deve trabalhar apenas com a visão **Orçado**.

### 9. Service role

`SUPABASE_SERVICE_ROLE_KEY` nunca pode ser usada no client.

Uso permitido apenas em ambiente servidor, com justificativa técnica e escopo limitado.

### 10. Backups e recuperação

Antes de produção, deve existir plano de backup e recuperação.

Quando houver dados reais:

- evitar scripts destrutivos;
- evitar deletes diretos;
- revisar migrations com cuidado;
- separar dados de teste de dados reais;
- registrar importações.

## Critério de implementação

Uma feature que cria tabela nova só é aceita se responder:

- Qual é o `tenant_id`?
- Quais usuários podem ler?
- Quais usuários podem criar?
- Quais usuários podem editar?
- Existe delete? Se sim, por quê?
- Quais campos têm FK?
- Quais ações geram auditoria?
- Quais índices são necessários?
- Como evitar duplicidade?
- Como recuperar ou rastrear mudanças?
