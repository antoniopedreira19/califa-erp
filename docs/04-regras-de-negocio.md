# Regras de Negócio

## Orçamento antes do job

- Todo orçamento pertence a um tenant.
- O orçamento é a etapa anterior à criação do job.
- O gestor cria primeiro um orçamento.
- Um orçamento pertence a um cliente.
- Um orçamento pode ter várias versões.
- Um orçamento só pode gerar job quando uma versão estiver aprovada.
- Após aprovar uma versão, a criação do job se torna obrigatória para seguir o fluxo operacional.
- Um orçamento aprovado deve gerar no máximo um job.
- O termo "pré-job" não deve ser tratado como tabela nem como status de job. A fase anterior ao job é o próprio orçamento.

## Versões do orçamento

- Toda versão de orçamento pertence a um orçamento.
- Cada versão tem número sequencial: v1, v2, v3, v4 etc.
- Cada versão tem status próprio.
- Uma versão pode ser criada manualmente ou por importação de planilha.
- Uma versão pode ser duplicada a partir de outra.
- Uma versão deve poder ser exportada em planilha para conversa externa com o cliente.
- Apenas uma versão por orçamento pode ser aprovada.
- Ao aprovar uma versão, ela vira a referência oficial do orçamento.
- A aprovação deve atualizar `orcamentos.versao_aprovada_id`.
- A aprovação deve atualizar `orcamentos.status` para `aprovado`.
- O banco deve impedir duas versões aprovadas para o mesmo orçamento.
- A aprovação deve gerar evento de auditoria.

## Criação do job

- Job só deve ser criado depois da aprovação de uma versão do orçamento.
- Todo job pertence a um tenant.
- Todo job deve estar vinculado a um orçamento aprovado.
- Todo job deve guardar referência à versão aprovada que originou sua abertura.
- A criação do job deve gravar `jobs.orcamento_id`.
- A criação do job deve atualizar `orcamentos.status` para `job_criado`.
- O banco deve impedir dois jobs para o mesmo orçamento.
- O job passa a ser o eixo operacional após a aprovação: produção, financeiro, contas a pagar, contas a receber, rentabilidade e DRE futuro devem se conectar a ele.

## Escopo do orçamento no MVP

- Antes da aprovação, orçamento tem apenas visão **Orçado**.
- Planejado e realizado são fora de escopo do MVP inicial.
- Planejado e realizado entram depois, quando o job operacional existir.
- O orçamento aprovado serve como base comercial e financeira inicial do job.
- A conversa com o cliente acontece fora do sistema no MVP.
- O sistema deve apoiar essa conversa permitindo exportar a versão do orçamento em planilha.
- Envio automático por e-mail ou WhatsApp fica para fase futura.

## Importação de planilha

- A planilha padrão possui aba `Oficial`.
- O importador deve ler colunas de Orçamento:
  - `PLANILHA`
  - `ITEM`
  - `R$`
  - `QT`
  - `D/M`
  - `TT`
  - tipo de custo na coluna auxiliar.
- Linhas de subtotal, imposto, honorários e faturamento não devem virar itens.
- O arquivo original deve ser preservado como anexo da versão.
- O sistema deve recalcular totais.

## Exportação de planilha

- O gerente de projetos deve conseguir exportar uma versão do orçamento em planilha.
- A planilha exportada deve representar a visão **Orçado** da versão escolhida.
- A exportação deve ser adequada para envio externo ao cliente.
- A exportação não deve expor dados internos fora do escopo comercial da versão.
- Futuramente, essa exportação poderá alimentar envio por e-mail ou WhatsApp, mas isso não faz parte do MVP.

## Tipos de custo

### Custo A

Faturamento direto para cliente. Cliente paga o fornecedor diretamente. Impostos incidem sobre honorários. Usado em jobs com influenciadores e normalmente considera 13% de honorários.

### Custo B

Bi tributação. Faturamento via California. Imposto cobrado sobre todo custo da operação mais honorários.

### Custo C

Sem cobrança de honorários da agência. Impostos são cobrados sobre o valor do custo. Só pode ser usado com permissão do Bruno.

### Custo D

Faturamento direto para cliente, usado internamente. Agência enxerga o valor que irá faturar, desconsiderando o valor pago diretamente pelo cliente. Usado para conhecimento do GP.

## Clientes e fornecedores

- Todo cliente e fornecedor pertence a um tenant.
- Cliente deve existir antes da criação do orçamento.
- Fornecedor pode ser cadastrado antes ou durante o orçamento.
- CPF/CNPJ deve ser usado para reduzir duplicidade.
- Exclusão física deve ser evitada; preferir inativação.

## Segurança

- Usuário não autenticado não acessa área interna.
- Usuário inativo não acessa área interna.
- Usuário só acessa dados do tenant ao qual está vinculado.
- Todas as tabelas operacionais devem ter `tenant_id`.
- Aprovação de orçamento deve ser auditada.
- Criação de job a partir de orçamento aprovado deve ser auditada.
- Uso de custo C deve ser sinalizado e auditado.
