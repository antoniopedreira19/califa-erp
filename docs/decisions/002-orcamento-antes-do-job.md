# Decisão 002 - Orçamento Antes do Job

## Status

Aceita.

## Contexto

O fluxo foi redefinido: antes de existir um job, o gestor cria um orçamento. Dentro desse orçamento podem existir várias versões. Uma dessas versões será aprovada. Depois da aprovação, a criação do job se torna obrigatória, e o job deve ficar vinculado ao orçamento e à versão aprovada.

## Decisão

O sistema deve tratar **orçamento** como a entidade anterior ao job.

Fluxo:

```text
Orçamento -> Versões do orçamento -> Versão aprovada -> Job criado
```

No banco, as tabelas centrais serão:

- `orcamentos`
- `versoes_orcamento`
- `jobs`

Não haverá tabela `pre_jobs`, e o job não será criado antes da aprovação do orçamento.

## Consequências

- A tela inicial do módulo será a criação de orçamento, não criação de job.
- O orçamento pode existir sem job.
- O job não pode existir sem orçamento aprovado.
- O job deve referenciar `orcamento_id` e `versao_orcamento_aprovada_id`.
- O vínculo oficial fica em `jobs.orcamento_id`, com índice único para impedir mais de um job por orçamento.
- A rastreabilidade comercial fica preservada: é possível saber qual versão aprovada originou cada job.
