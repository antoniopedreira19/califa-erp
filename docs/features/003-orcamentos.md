# Feature 003 - Orçamentos

## Objetivo

Permitir criar o orçamento comercial antes da existência do job.

O orçamento representa a oportunidade em fase de proposta. Ele concentra cliente, campanha, GP responsável, período previsto e o conjunto de versões que serão discutidas até uma delas ser aprovada.

## Escopo

- Criar orçamento.
- Editar orçamento enquanto não estiver aprovado.
- Listar orçamentos por status.
- Vincular orçamento a cliente.
- Definir GP responsável.
- Registrar campanha, tipo e período previsto.
- Exibir versões do orçamento.
- Exibir versão aprovada, quando existir.
- Exibir job vinculado, quando ele for criado.

## Fora do escopo inicial

- Planejado.
- Realizado.
- Contas a pagar.
- Contas a receber.
- Rentabilidade realizada.
- DRE.

## Regras

- Orçamento pertence a um tenant.
- Orçamento deve ter cliente.
- Orçamento pode existir sem job.
- Orçamento aprovado deve exigir criação de job.
- Orçamento deve ter no máximo um job vinculado, garantido por `jobs.orcamento_id` único.
- Não criar tabela ou status de `pre_jobs`.

## Critérios de aceite

- Usuário cria orçamento.
- Orçamento aparece na listagem.
- Orçamento pode receber várias versões.
- Orçamento sem versão aprovada não gera job.
- Orçamento aprovado indica claramente que falta criar o job quando ainda não existir registro em `jobs` para aquele `orcamento_id`.
