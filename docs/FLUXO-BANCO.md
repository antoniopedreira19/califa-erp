# Fluxo de banco — Supabase via MCP

> **Leia este arquivo antes de começar qualquer trabalho neste projeto.**
> Ele descreve como o banco é alterado, o que exige confirmação, e como
> conferir que banco e repositório continuam contando a mesma história.

---

## O contexto que muda tudo

**Há um único banco, e mais de uma frente de desenvolvimento mexendo
nele.** Isso tem duas consequências práticas:

1. **Não existe painel.** Nada é criado "na mão" pela interface do
   Supabase. Toda estrutura nasce de uma migration versionada no
   repositório e aplicada pelo MCP. É o que mantém o repositório sendo a
   história completa do banco.
2. **Não é ambiente descartável.** O banco tem dado de outras frentes e
   de gente que vai usar o sistema. Erro aqui não se resolve apagando e
   recriando.

---

## O ciclo obrigatório, em cinco passos

Toda alteração de banco segue esta ordem. Sem pular etapa.

### 1. Ler o banco antes de codar

Antes de escrever qualquer coisa, consultar pelo MCP o que já existe:
colunas, enums, constraints, e o dado real. Serve para não inventar
estrutura que já existe com outro nome, e para descobrir cedo que a regra
que você ia implementar não cabe no modelo atual.

```
mcp__supabase__list_tables · execute_sql (information_schema, pg_*)
```

### 2. Escrever o arquivo de migration

Em `supabase/migrations/`, com **o racional comentado no topo**: por que
esta mudança existe, que decisão de negócio ela materializa, e o que
deliberadamente ficou de fora. O arquivo é a explicação; o banco é só o
resultado.

Convenções:

- Nome: `AAAAMMDD00000N_descricao_curta.sql`, **prefixo único** — dois
  arquivos com o mesmo número ficam ambíguos num replay pelo CLI.
- Idempotente sempre que possível (`if not exists`, `coalesce`,
  `where not exists`), para poder rodar duas vezes sem estragar nada.
- Toda tabela operacional nasce com `tenant_id`, RLS, policies, `GRANT`
  explícito para `authenticated` e índice nas FKs que serão filtradas.
- Enum: `alter type ... add value` fica **sozinho** na migration — um
  valor novo não pode ser usado na mesma transação em que é criado.

### 3. Aplicar pelo MCP

```
mcp__supabase-write__apply_migration
```

O MCP grava a migration no banco com **carimbo de tempo próprio**
(`20260812160437`), diferente do número do arquivo (`20260812000006`).
Os dois não batem e não precisam bater: o banco usa o carimbo dele para
ordenar, o arquivo usa o número para leitura humana. É assim desde a
Task 001.

### 4. Conferir pelo MCP que aplicou

Não confiar no `success: true`. Conferir o que interessa:

- colunas e constraints criadas;
- RLS ligado e policies no lugar;
- `GRANT` para `authenticated`, e **nada** para `anon`;
- índices;
- o dado, quando a migration fez backfill.

Vale rodar `get_advisors` (segurança e performance) e checar se algum
alerta novo aponta para o que você acabou de criar.

### 5. Commitar o arquivo junto do código

A migration e o código que depende dela vão **no mesmo commit**. É isso
que mantém o repositório como história completa: se o banco precisar ser
recriado, ou o dono dele quiser entender o que mudou e por quê, está tudo
em texto versionado.

---

## Aditivo x destrutivo: onde está a linha

O que é aditivo segue o fluxo normal dos cinco passos. O que é destrutivo
**exige confirmação explícita antes de ser aplicado** — sem exceção, e
independente de quem esteja conduzindo a sessão.

### Aditivo — não destrói nada

Mudança que só acrescenta:

- coluna nova (nulável ou com default);
- tabela nova;
- índice, constraint, policy, trigger, comentário;
- backfill que **preenche** o que estava vazio;
- valor novo em enum.

### Destrutivo — exige confirmação explícita, sempre

Mudança que remove ou reescreve o que já existe:

- remover coluna, tabela, índice ou policy;
- apagar linhas;
- alterar tipo de campo já populado;
- renomear coluna que o código já usa;
- backfill que **sobrescreve** valor existente;
- qualquer coisa em tabela que não seja do módulo em que se está mexendo.

Na dúvida sobre em qual lado a mudança cai, **pergunte**. O custo de
perguntar é um minuto; o de errar é o dado de outra frente.

---

## Conferir se banco e repositório continuam sincronizados

Auditoria que vale rodar quando várias frentes mexeram no banco, ou antes
de uma entrega grande. O método:

1. Extrair de **todas** as migrations do repositório os objetos que elas
   dizem criar (`create table`, `create view`, `create type ... as enum`,
   `alter table ... add column`).
2. Comparar contra o banco vivo (`pg_tables`, `pg_views`, `pg_type`,
   `information_schema.columns`).
3. Olhar os **dois sentidos**:
   - **no repo e não no banco** → migration não aplicada, ou aplicada
     pela metade;
   - **no banco e não no repo** → alguém criou fora do fluxo. É o caso
     grave: o repositório deixou de ser a história completa.

Falsos positivos esperados, que devem ser checados um a um antes de
virarem alarme: objeto **criado e depois removido** por uma migration
posterior, e coluna **renomeada** — os dois aparecem como "no repo, não no
banco" e estão corretos.

Última auditoria completa: **12/08/2026** — 79 migrations, 42 tabelas
(1 removida por migration posterior), 2 views, 22 enums e 81 colunas
adicionadas. **Zero divergência real**, nos dois sentidos.

---

## A ponte com o TypeScript

O TypeScript **não lê o Supabase**. Este projeto não tem arquivo de tipos
gerado do banco, e o cliente Supabase não é tipado — quem descreve as
tabelas para o código é `lib/types.ts`, escrito à mão.

Ou seja: **banco e código só ficam iguais porque alguém os mantém iguais.**

Coluna que existe no banco e não está declarada lá fica invisível para o
verificador: ele não avisa se o nome for digitado errado, e o campo não
aparece no autocompletar de quem for escrever a próxima tela. O caso
inverso — declarado no código, inexistente no banco — compila e vem vazio
sempre.

**Por isso: toda migration que mexe em coluna de tabela usada pelo
frontend termina com a atualização do tipo correspondente em
`lib/types.ts`, no mesmo commit.**
