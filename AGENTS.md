# AGENTS.md

Este arquivo orienta agentes de IA que trabalharem no ERP da Agência California.

## Forma de trabalho

- Trabalhe por task pequena.
- Não misture decisões técnicas, refatorações e novas features na mesma alteração.
- Preserve o padrão existente do projeto.
- Antes de criar uma abstração, verifique se ela reduz complexidade real.
- Documente decisões importantes em `docs/decisions/`.
- Atualize a documentação da feature quando a implementação mudar regra de negócio.

## Segurança

- Supabase Auth identifica o usuário.
- RLS no Postgres limita quais dados o usuário pode acessar.
- `tenant_id` isola os dados por empresa.
- Server Actions/Route Handlers validam operações sensíveis.
- Auditoria registra quem fez o quê.
- `service_role` só pode ser usado no servidor e somente quando necessário.
- Toda ação administrativa crítica deve ser protegida.
- A base de dados é um ativo crítico: use chaves estrangeiras, constraints, índices, RLS e auditoria.
- Usuários devem ver apenas o que seu papel e tenant permitem.

## Produto

O ERP deve ser simples para o time usar. Se uma tela for mais difícil que a planilha atual, a adoção tende a falhar.

Para o MVP, mantenha o fluxo simples:

```text
Cliente/Fornecedor
-> Orçamento
-> Versões v1, v2, v3...
-> Versão aprovada
-> Job criado e vinculado ao orçamento aprovado
```

O job só existe depois da aprovação de uma versão do orçamento.

## Validação

Uma task só deve ser considerada concluída quando:

- escopo foi implementado;
- critérios de aceite foram verificados;
- erros e estados vazios foram tratados;
- permissões foram respeitadas;
- lint/build passaram quando disponíveis;
- documentação relevante foi atualizada.

## GitHub e deploy

- GitHub é a fonte oficial do código.
- Vercel publica a aplicação.
- Supabase mantém banco/auth/storage/RLS.
- Não commitar secrets.
- Versionar migrations.
- Usar branches por task quando o Git estiver configurado.
- Produção deve vir de branch controlada, preferencialmente `main`.
