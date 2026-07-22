# Feature 005 - Criação do Job

## Objetivo

Permitir criar um job a partir de um orçamento aprovado.

Essa feature começa simples: depois que o gerente de projetos marcar uma versão do orçamento como aprovada, o sistema deve permitir a criação do job vinculado ao orçamento e à versão aprovada.

## Conceito

```text
Orçamento aprovado
-> versão aprovada definida
-> gerente cria job
-> job fica vinculado ao orçamento e à versão aprovada
```

## Escopo

- Exibir ação de criar job quando o orçamento estiver aprovado.
- Bloquear criação de job para orçamento sem versão aprovada.
- Criar registro em `jobs`.
- Vincular `jobs.orcamento_id` ao orçamento aprovado.
- Vincular `jobs.versao_orcamento_aprovada_id` à versão aprovada.
- Copiar informações básicas do orçamento para o job.
- Atualizar status do orçamento para `job_criado`.
- Registrar auditoria da criação do job.

## Campos do job

Os campos completos do cadastro do job serão definidos na própria task, com base nas informações trazidas pelo gerente de projetos.

Para a primeira versão, considerar campos mínimos:

- código;
- nome;
- cliente;
- GP responsável;
- tipo;
- campanha;
- período previsto;
- status;
- orçamento de origem;
- versão aprovada de origem.

## Regras

- Job só pode ser criado se o orçamento estiver aprovado.
- Job só pode ser criado se `orcamentos.versao_aprovada_id` estiver preenchido.
- Um orçamento aprovado deve gerar no máximo um job.
- O banco deve impedir dois jobs para o mesmo orçamento.
- O job deve nascer com `tenant_id`.
- O job deve respeitar RLS por tenant.
- A criação do job deve ser auditada.

## Fora do escopo inicial

- Planejado.
- Realizado.
- Contas a pagar.
- Contas a receber.
- Rentabilidade do job.
- DRE do job.
- Produção detalhada.

## Critérios de aceite

- Orçamento aprovado exibe ação de criar job.
- Orçamento sem versão aprovada não permite criar job.
- Job criado referencia orçamento e versão aprovada.
- Banco impede duplicidade de job para o mesmo orçamento.
- Criação do job atualiza o orçamento para `job_criado`.
- Criação do job gera evento de auditoria.
