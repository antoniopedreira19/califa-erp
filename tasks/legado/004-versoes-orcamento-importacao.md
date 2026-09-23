# Task 004 - Versões do Orçamento e Importação

## Objetivo

Permitir criar, importar, exportar e aprovar versões dentro de um orçamento.

## Banco

- Tabela `versoes_orcamento`.
- Tabela `versoes_orcamento_itens`.
- Tabela `orcamento_importacoes`.
- `tenant_id` obrigatório em todas.
- `versoes_orcamento.orcamento_id` referenciando `orcamentos.id`.
- `versoes_orcamento_itens.versao_orcamento_id` referenciando `versoes_orcamento.id`.
- `orcamento_importacoes.versao_orcamento_id` referenciando `versoes_orcamento.id`.
- Índice único parcial para impedir duas versões aprovadas no mesmo orçamento.
- Índice único para impedir número de versão duplicado no mesmo orçamento.

## Interface

- Criar versão manual.
- Duplicar versão.
- Importar planilha.
- Pré-visualizar linhas importadas.
- Confirmar importação.
- Ver total por versão.
- Exportar versão em planilha.
- Aprovar versão.

## Importação

- Ler aba `Oficial`.
- Usar apenas colunas da visão **Orçado**.
- Identificar tipo de custo A, B, C ou D.
- Ignorar linhas de subtotal, imposto, honorários e faturamento.
- Salvar arquivo original no Storage.
- Registrar importação em `orcamento_importacoes`.

## Exportação

- Gerar planilha da versão selecionada.
- Exportar apenas a visão **Orçado**.
- Manter estrutura compreensível para envio externo ao cliente.
- Não expor informações internas fora do escopo comercial do orçamento.
- O envio da planilha ao cliente acontece fora do sistema no MVP.

## Aprovação

- Aprovação atualiza `versoes_orcamento.status` para `aprovada`.
- Aprovação atualiza `orcamentos.versao_aprovada_id`.
- Aprovação atualiza `orcamentos.status` para `aprovado`.
- Aprovação registra evento de auditoria.
- Depois da aprovação, o sistema deve conduzir o usuário para criação obrigatória do job.

## Critérios de conclusão

- Versão manual pode ser criada.
- Planilha padrão pode ser importada.
- Versão pode ser exportada em planilha.
- Itens importados ficam vinculados à versão.
- Apenas uma versão por orçamento pode ser aprovada.
- Orçamento aprovado exibe claramente a ação de criar job.
