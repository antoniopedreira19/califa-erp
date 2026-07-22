# Visão Geral do ERP California

A Agência California quer construir um ERP próprio, começando por uma parte crítica do fluxo de gestão de projetos: criação de orçamentos comerciais, controle de versões e abertura de jobs a partir da versão aprovada.

O objetivo do MVP não é substituir todos os módulos de uma vez. A ideia é criar uma base segura, validar um fluxo real com os gestores e evoluir módulo por módulo.

## Ideia central

O sistema deve organizar a etapa anterior ao job como **orçamento**.

O orçamento concentra a oportunidade comercial: cliente, campanha, GP responsável, período previsto e versões financeiras. Dentro dele podem existir várias versões, como v1, v2, v3 e v4.

Quando uma versão for aprovada, o sistema deve exigir a criação do job. A partir daí, o job passa a ser o eixo operacional.

```text
Orçamento
-> versões do orçamento
-> versão aprovada
-> job criado
```

## Escopo do MVP

O primeiro módulo deve cobrir:

- login seguro;
- controle de usuários, papéis e tenant;
- cadastro de clientes;
- cadastro de fornecedores;
- criação de orçamentos;
- criação manual de versões de orçamento;
- importação da planilha padrão de orçamento;
- exportação da versão do orçamento em planilha para envio externo ao cliente;
- aprovação de uma versão;
- criação obrigatória do job vinculado ao orçamento aprovado.

## Fora do escopo inicial

Nesta primeira etapa, não implementar:

- DRE completo;
- planejado;
- realizado;
- contas a pagar;
- contas a receber;
- rentabilidade final;
- conciliação bancária;
- pagamentos automáticos;
- emissão automática de nota fiscal;
- envio automático de orçamento por e-mail ou WhatsApp;
- módulo completo de RH;
- módulo completo de mídia.

As visões **Planejado** e **Realizado** ficam para depois da aprovação, quando o job operacional existir.

## Princípio de evolução

Cada módulo futuro deve ser iniciado com reunião com o setor responsável, documentação do fluxo real e validação antes da implementação.

O sistema deve crescer em ciclos:

```text
Reunião com área
-> documentação
-> implementação
-> teste
-> validação
-> próximo módulo
```
