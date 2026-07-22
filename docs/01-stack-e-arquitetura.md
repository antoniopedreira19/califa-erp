# Stack e Arquitetura

## Stack aprovada

- Next.js App Router.
- React.
- TypeScript.
- Supabase Auth.
- Supabase Postgres.
- Supabase Row Level Security.
- Supabase Storage.
- Tailwind CSS.
- shadcn/ui + Radix.
- lucide-react.
- React Hook Form + Zod.
- ExcelJS ou XLSX para importação e exportação de planilhas.
- Vercel para deploy da aplicação web.
- GitHub para versionamento, branches, commits e integração com Vercel.

## Papel de cada camada

```text
Next.js
= aplicação web, telas, Server Components, Server Actions e APIs internas

Supabase Auth
= autenticação e sessão

Supabase Postgres
= banco oficial do ERP

RLS
= barreira real de autorização no banco

Storage
= anexos, planilhas importadas e documentos futuros

Vercel
= hospedagem do app

GitHub
= fonte oficial do código e histórico de mudanças
```

## Direção arquitetural

O sistema deve evitar um backend separado no MVP. O Next.js deve concentrar a aplicação e usar Server Actions/Route Handlers para operações sensíveis.

O frontend nunca deve ser a única barreira de permissão. Sempre que uma regra afetar dados reais, ela precisa existir no banco, no servidor ou em ambos.

O banco deve nascer multi-tenant. Mesmo que por um longo período exista apenas uma empresa, a Agência California, todas as tabelas operacionais devem carregar `tenant_id`.

Na interface, o tenant pode ser chamado de **empresa** ou **organização**. No banco, usar `tenants` como fronteira de segurança.

## Direção de UI/UX

O ERP deve reaproveitar a identidade visual do projeto `C:\Projects\AgCaliforniaRH`.

A base visual não deve ser reinventada. O novo sistema deve parecer parte da mesma família de produtos internos da Agência California.

Referências principais:

- `C:\Projects\AgCaliforniaRH\app\globals.css`
- `C:\Projects\AgCaliforniaRH\tailwind.config.ts`
- `C:\Projects\AgCaliforniaRH\components\sidebar.tsx`
- `C:\Projects\AgCaliforniaRH\app\(auth)\login\page.tsx`

A aplicação deve manter:

- vermelho California `#E74B56` como cor primária;
- preto/cinza escuro `#282828` para superfícies escuras;
- fundo claro `#FAFAFA`;
- fonte Inter;
- sidebar escura;
- item ativo com destaque vermelho;
- botões, inputs e cards no padrão shadcn customizado;
- tabelas e formulários densos, claros e próprios para uso operacional.

## Organização sugerida

```text
app/
  (auth)/
  (app)/
components/
lib/
  auth/
  supabase/
  validations/
docs/
supabase/
  migrations/
  seeds/
tasks/
```

## Boas práticas

- Migrations pequenas e revisáveis.
- RLS desde a criação das tabelas.
- `tenant_id` obrigatório nas tabelas operacionais.
- Índices em `tenant_id` nas tabelas operacionais.
- Zod para validar entradas.
- Server Actions para mutações internas.
- Route Handlers para importação, exportação, arquivos e integrações.
- Componentes reutilizáveis para formulários, tabelas e estados.
- Tarefas curtas com critérios de aceite objetivos.
