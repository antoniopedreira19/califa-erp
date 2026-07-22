# GitHub, Vercel e Deploy

## Princípio

O GitHub será a fonte oficial do código do ERP. A Vercel será responsável pelo deploy da aplicação web. O Supabase será responsável por banco, autenticação, storage e RLS.

Fluxo geral:

```text
Claude Code
-> altera código localmente
-> commit no Git
-> push para GitHub
-> Vercel executa build/deploy
-> Supabase mantém banco, auth, storage e policies
```

## Repositório

O projeto deve ser versionado no GitHub desde o início.

Regras:

- todo código relevante deve estar no Git;
- toda migration deve estar versionada;
- documentação deve acompanhar mudanças importantes;
- `.env.local` nunca deve ser commitado;
- secrets nunca devem aparecer no repositório;
- `package-lock.json` deve ser commitado para manter builds reproduzíveis.

## Branches

Modelo recomendado:

```text
main
= branch estável, usada para produção

feature/login-seguro
feature/clientes-fornecedores
feature/jobs-orcamentos
= branches de desenvolvimento por módulo/tarefa
```

Regras:

- não desenvolver features grandes direto na `main`;
- cada task deve preferencialmente ter uma branch própria;
- merges para `main` devem acontecer apenas depois de validação mínima;
- evitar múltiplas mudanças sem relação no mesmo commit.

## Commits

Commits devem ser pequenos e descritivos.

Exemplos:

```text
docs: add data governance rules
feat: add secure login foundation
feat: add clients and suppliers tables
fix: prevent multiple approved budgets per job
```

Antes de commit:

- revisar diff;
- verificar arquivos acidentalmente alterados;
- rodar lint/build quando o projeto já existir;
- confirmar que nenhum secret foi incluído.

## Pull requests

Quando houver mais de um desenvolvedor ou agente de IA trabalhando, preferir Pull Request antes de merge.

O PR deve responder:

- qual task foi implementada;
- quais tabelas/migrations foram alteradas;
- quais permissões/RLS foram criadas;
- quais fluxos foram testados;
- quais riscos ainda existem.

## Vercel

A Vercel fará o deploy da aplicação Next.js.

Configuração esperada:

- projeto conectado ao repositório GitHub;
- branch `main` ligada ao deploy de produção;
- Preview Deployments para branches e PRs;
- variáveis de ambiente configuradas no painel da Vercel;
- build command padrão do Next.js;
- output padrão da Vercel para Next.js.

## Variáveis de ambiente

Variáveis públicas:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=
```

Variáveis privadas:

```env
SUPABASE_SERVICE_ROLE_KEY=
```

Regras:

- `NEXT_PUBLIC_*` pode ir para o browser;
- `SUPABASE_SERVICE_ROLE_KEY` nunca pode ir para o browser;
- secrets devem ficar somente em `.env.local` local e no painel da Vercel;
- não commitar `.env.local`;
- manter `.env.example` sem valores reais.

## Supabase e migrations

O Supabase será o banco oficial do ERP.

Regras:

- mudanças de estrutura devem ser feitas por migrations;
- migrations devem ser versionadas no GitHub;
- antes de produção, revisar migrations destrutivas com muito cuidado;
- não rodar scripts destrutivos em banco com dados reais;
- toda tabela operacional deve nascer com `tenant_id`, RLS, índices e FKs;
- policies devem ser testadas em cenários positivos e negativos.

## Deploy e banco

Deploy da aplicação e migration do banco são coisas diferentes.

A Vercel publica o app.

O Supabase aplica alterações de banco.

Antes de uma feature depender de tabela nova em produção:

1. Criar migration.
2. Revisar migration.
3. Aplicar no Supabase correto.
4. Fazer deploy do app.
5. Validar fluxo online.

## Ambientes

Modelo inicial possível:

```text
Local
= desenvolvimento com .env.local

Vercel Preview
= validação de branch/PR

Vercel Production
= branch main

Supabase
= banco/auth/storage/RLS
```

Se houver apenas um projeto Supabase no início, dados de teste devem ser identificáveis e removíveis antes do go-live.

Quando houver dados reais, criar política mais rígida para desenvolvimento, homologação e produção.

## Checklist antes de produção

- Build passa.
- Lint passa.
- Variáveis de ambiente estão configuradas na Vercel.
- `.env.local` não foi commitado.
- RLS habilitado nas tabelas operacionais.
- Policies testadas.
- `service_role` não aparece no client.
- Tenant inicial Agência California existe.
- Admin inicial está vinculado ao tenant.
- Fluxo de login validado.
- Backup/plano de recuperação definido antes de dados reais.

## Regra para Claude Code

Ao implementar qualquer task, o agente deve:

- trabalhar em branch apropriada quando Git estiver configurado;
- manter commits pequenos;
- nunca commitar secrets;
- atualizar migrations e docs quando mudar banco ou regra de negócio;
- rodar validações antes de sugerir deploy;
- informar claramente o que foi testado e o que não foi.
