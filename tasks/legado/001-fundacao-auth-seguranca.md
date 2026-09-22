# Task 001 - Fundação, Auth e Segurança

## Objetivo

Criar a base técnica segura do ERP e a base visual inicial seguindo a identidade do sistema RH da Agência California.

## Referência visual obrigatória

O frontend deve seguir a identidade visual do projeto:

```text
C:\Projects\AgCaliforniaRH
```

Arquivos de referência:

- `C:\Projects\AgCaliforniaRH\app\globals.css`
- `C:\Projects\AgCaliforniaRH\tailwind.config.ts`
- `C:\Projects\AgCaliforniaRH\components\sidebar.tsx`
- `C:\Projects\AgCaliforniaRH\app\(auth)\login\page.tsx`

## Entregas

- Projeto Next.js configurado.
- Supabase conectado.
- Tema Tailwind/shadcn alinhado ao sistema RH da California.
- Tela de login seguindo a identidade visual do RH.
- Layout interno autenticado.
- Sidebar escura no padrão California.
- Logout.
- Middleware protegendo rotas privadas.
- Tabela `profiles`.
- Tabela `tenants`.
- Tabela `tenant_members`.
- Tenant inicial Agência California.
- Vínculo do administrador inicial com o tenant.
- Roles iniciais.
- MFA obrigatório para administrador.
- Auditoria mínima.
- RLS nas tabelas de fundação.
- Helpers/policies para validar vínculo ativo com tenant.
- Documento de governança de dados considerado na implementação.

## UI/UX

Diretrizes:

- manter a identidade California já usada no RH;
- usar vermelho California `#E74B56` como cor primária;
- usar vermelho hover `#d83e49`;
- usar fundo claro `#FAFAFA`;
- usar texto principal `#282828`;
- usar Inter como fonte principal;
- usar sidebar escura com destaque vermelho no item ativo;
- usar shadcn/ui + Tailwind como base dos componentes;
- usar lucide-react para ícones;
- criar uma tela de login semelhante em qualidade e linguagem visual ao RH, adaptada para o ERP;
- criar layout interno simples, profissional e pronto para os próximos módulos;
- evitar cara de landing page; o sistema deve parecer uma ferramenta interna de gestão.

## Critérios de aceite

- App roda localmente.
- Login funciona.
- Login segue a identidade visual do sistema RH da California.
- Logout funciona.
- Área interna bloqueia usuário sem sessão.
- Usuário inativo não acessa.
- Admin passa por MFA ou existe documentação clara da configuração externa necessária no Supabase.
- Usuário sem vínculo com tenant não acessa área interna.
- RLS usa `tenant_id` como fronteira de segurança.
- Auditoria registra login/logout quando possível.
- Usuário vê apenas dados do tenant ao qual pertence.
- Layout interno autenticado está pronto para as próximas tasks.
- Build e lint passam.

## Fora de escopo

- Clientes.
- Fornecedores.
- Orçamentos.
- Versões de orçamento.
- Jobs.
