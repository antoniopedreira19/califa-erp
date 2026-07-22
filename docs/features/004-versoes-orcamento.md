# Feature 004 - Versões do Orçamento

## Objetivo

Permitir que um orçamento tenha várias versões até uma ser aprovada.

Cada versão pode ser criada manualmente, duplicada a partir de uma versão anterior ou importada da planilha padrão.

## Conceito

```text
Orçamento
-> Versão 1
-> Versão 2
-> Versão 3 aprovada
-> Job criado a partir da versão 3
```

## Escopo

- Criar versão manual.
- Importar versão via planilha.
- Duplicar versão existente.
- Calcular totais da versão.
- Exportar versão em planilha para envio externo ao cliente.
- Registrar status da versão.
- Aprovar uma versão.
- Impedir mais de uma versão aprovada no mesmo orçamento.
- Preservar arquivo original importado.

## Conversa com o cliente

No MVP, o sistema não envia orçamento por e-mail ou WhatsApp.

O gerente de projetos exporta a versão em planilha e conduz a conversa com o cliente fora do sistema. Se o cliente não aprovar, o gerente cria uma nova versão. Quando o cliente aprovar, o gerente marca manualmente a versão aprovada no sistema.

## Relação com banco

```text
orcamentos 1:N versoes_orcamento
versoes_orcamento 1:N versoes_orcamento_itens
orcamentos 0:1 jobs
jobs N:1 orcamentos
jobs N:1 versoes_orcamento
```

## Aprovação

Ao aprovar uma versão:

- `versoes_orcamento.status` vira `aprovada`;
- `orcamentos.versao_aprovada_id` recebe o id da versão;
- `orcamentos.status` vira `aprovado`;
- as demais versões ficam como histórico, podendo ser `substituida` ou `reprovada`;
- o sistema deve exigir a criação do job.

## Critérios de aceite

- Orçamento aceita múltiplas versões.
- Cada versão tem número sequencial.
- Apenas uma versão pode ser aprovada.
- Versão aprovada não pode ser alterada sem fluxo explícito de revisão.
- Versão pode ser exportada em planilha.
- Aprovação gera auditoria.
- Após aprovação, sistema permite criar job vinculado ao orçamento e à versão aprovada.
