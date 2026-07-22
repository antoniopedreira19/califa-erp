# Fluxos do MVP

## Fluxo principal do gerente de projetos

```text
Gerente cria orçamento
-> cria ou importa versão do orçamento
-> exporta versão em planilha
-> conversa com cliente fora do sistema
-> se cliente pedir ajuste, cria nova versão
-> quando cliente aprovar, gerente marca a versão aprovada
-> sistema exige criação do job
-> gerente cria job vinculado ao orçamento e à versão aprovada
```

No MVP, a conversa com o cliente acontece fora do sistema. A exportação em planilha é essencial para permitir que o gerente envie o orçamento ao cliente pelos canais atuais.

Envio automático por e-mail ou WhatsApp fica para fase futura.

## Fluxo 1 - Login seguro

```text
Usuário acessa /login
-> informa e-mail e senha
-> Supabase Auth valida
-> middleware cria/renova sessão
-> sistema carrega profile
-> usuário entra na área interna
```

Se for administrador, MFA deve ser obrigatório.

## Fluxo 2 - Cadastro de cliente

```text
Usuário acessa Clientes
-> cria cliente
-> informa dados básicos
-> sistema valida duplicidade por CNPJ quando houver
-> cliente fica ativo
```

## Fluxo 3 - Cadastro de fornecedor

```text
Usuário acessa Fornecedores
-> cria fornecedor
-> informa CPF/CNPJ e dados básicos
-> sistema valida duplicidade
-> fornecedor fica ativo
```

## Fluxo 4 - Criação de orçamento

```text
Usuário acessa Orçamentos
-> cria novo orçamento
-> seleciona cliente
-> informa nome/campanha
-> define GP responsável
-> define período previsto
-> salva como rascunho ou em revisão
```

Neste momento ainda não existe job.

## Fluxo 5 - Criação de versão manual

```text
Usuário abre orçamento
-> cria nova versão
-> adiciona itens
-> informa tipo de custo, valor, quantidade e dias/mês
-> sistema calcula total
-> sistema calcula resumo da versão
```

## Fluxo 6 - Importação da planilha padrão

```text
Usuário abre orçamento
-> cria versão de orçamento
-> importa planilha padrão
-> sistema lê aba Oficial
-> sistema extrai itens orçados
-> sistema ignora linhas de resumo
-> sistema mostra prévia
-> usuário confirma importação
-> itens são gravados na versão
```

## Fluxo 7 - Exportação para cliente

```text
Usuário abre orçamento
-> escolhe a versão
-> clica em exportar planilha
-> sistema gera arquivo da versão
-> gerente envia o arquivo ao cliente fora do sistema
-> conversa e negociação seguem externamente
```

## Fluxo 8 - Nova versão após retorno do cliente

```text
Cliente não aprova a versão enviada
-> gerente abre orçamento
-> duplica versão anterior ou cria nova versão
-> ajusta itens e valores
-> exporta nova planilha
-> envia novamente ao cliente fora do sistema
```

## Fluxo 9 - Aprovação de versão

```text
Cliente aprova uma versão fora do sistema
-> usuário abre orçamento
-> seleciona a versão aprovada
-> clica em aprovar versão
-> sistema marca versão como aprovada
-> sistema atualiza orçamento com a versão aprovada
-> demais versões ficam como histórico/substituídas
-> evento de auditoria é registrado
```

## Fluxo 10 - Criação obrigatória do job

```text
Orçamento está aprovado
-> sistema solicita criação do job
-> usuário confirma dados principais
-> sistema cria job vinculado ao orçamento
-> sistema vincula job à versão aprovada
-> sistema atualiza orçamento para job_criado
-> evento de auditoria é registrado
```
