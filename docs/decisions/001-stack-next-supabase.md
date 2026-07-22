# Decisão 001 - Stack Next.js + Supabase

## Status

Aprovada para o MVP.

## Contexto

O projeto será desenvolvido por IA com Claude Code e GitHub. O usuário já tem familiaridade com React, Next.js, shadcn/ui e Supabase, e possui projetos de referência nessa stack.

## Decisão

Usar:

- Next.js App Router;
- React;
- TypeScript;
- Supabase Auth;
- Supabase Postgres;
- Supabase RLS;
- Supabase Storage;
- Tailwind CSS;
- shadcn/ui;
- Vercel.

O banco deve nascer multi-tenant:

- tabela `tenants`;
- tabela `tenant_members`;
- `tenant_id` obrigatório nas tabelas operacionais;
- RLS baseado no vínculo do usuário com o tenant.

## Consequências

- O Next.js será frontend e backend do MVP.
- Supabase será fonte de autenticação, banco, storage e segurança em nível de linha.
- Regras sensíveis devem ficar em Server Actions, Route Handlers, SQL, RLS ou constraints.
- O projeto não usará Django no MVP.
- Mesmo com apenas a Agência California no início, o sistema estará preparado para outras empresas no futuro.
