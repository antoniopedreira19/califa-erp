# Segurança, Auth e RLS

## Princípio

A base de dados é um ativo estratégico da Agência California. Segurança, isolamento por tenant e rastreabilidade devem existir desde a fundação do sistema.

## Supabase Auth

Supabase Auth será responsável por:

- login;
- sessão;
- recuperação de senha;
- MFA para administradores;
- identidade principal do usuário.

O frontend nunca deve usar `SUPABASE_SERVICE_ROLE_KEY`.

## Profiles

A tabela `profiles` complementa o usuário do Auth com dados de aplicação:

- `id`
- `nome`
- `email`
- `role`
- `ativo`
- `created_at`
- `updated_at`

### ⚠️ Quem lê o perfil de quem (17/09/2026)

Até esta data o SELECT em `profiles` tinha duas portas: o próprio perfil
(`profiles_select_self`) e — **só para `administrador`** — os perfis do
mesmo tenant. Enquanto todo mundo era administrador ninguém notou. Com GP,
produtor, financeiro e freelancer de verdade, **todo embed
`profiles!...(nome)` passou a voltar nulo para eles** (são 42 consultas no
app: GP e produtor do orçamento e do job, "criado por", "aprovada por",
"pago por", responsável da verba…). O sintoma que estourou: um GP não
conseguia enviar job para abertura, porque o formulário lia "GP
Responsável — não informado" e concluía que o cadastro estava incompleto.

Agora vale `profiles_select_membros_do_tenant`: **membro ativo enxerga o
perfil dos demais membros ativos do mesmo tenant**, via a função
`public.e_colega_de_tenant(uuid)`.

Duas armadilhas que valem para qualquer policy nova:

- **Policy não enxerga o que a RLS da tabela vizinha esconde.** A
  expressão de uma policy roda com os privilégios de quem consulta. Um
  `exists` sobre `tenant_members` dentro da policy de `profiles` só via a
  linha de quem estava lendo — a RLS de `tenant_members` é self + admin.
  Por isso a checagem mora num `SECURITY DEFINER`, como `is_tenant_member`
  e `is_tenant_admin`.
- **Trava de tela não se apoia em nome.** Nome depende de leitura; id não.
  O formulário de abertura passou a olhar `produto_id`,
  `gp_responsavel_id` e `produtor_id` — exatamente o que o servidor
  confere em `enviarJobParaAbertura`.

## Tenants

Mesmo que por bastante tempo exista apenas a Agência California, o banco deve nascer preparado para múltiplas empresas.

Toda tabela operacional deve ter `tenant_id`.

## Papéis iniciais

- `administrador`: gerencia usuários, permissões e dados principais.
- `gestao_projetos`: cria e acompanha orçamentos, versões de orçamento e jobs abertos a partir de orçamentos aprovados.
- `financeiro`: terá acesso aos dados financeiros conforme os módulos futuros forem liberados.

## RLS

Todas as tabelas operacionais devem ter RLS habilitado.

Regra base:

```text
usuário autenticado
-> profile ativo
-> vínculo ativo em tenant_members
-> acesso limitado ao tenant_id permitido
```

RLS deve proteger:

- clientes;
- fornecedores;
- orçamentos;
- versões de orçamento;
- itens de versão;
- importações;
- jobs;
- auditoria.

## Operações sensíveis

Operações sensíveis devem passar por Server Actions ou Route Handlers:

- aprovação de versão de orçamento;
- criação de job a partir de orçamento aprovado;
- criação/alteração de usuário;
- alteração de permissões;
- uso de `service_role`, quando inevitável;
- importação de planilhas;
- alterações administrativas.

## Auditoria

Registrar em `audit_events`:

- login;
- logout;
- criação/edição/inativação de cliente;
- criação/edição/inativação de fornecedor;
- criação de orçamento;
- criação/importação de versão de orçamento;
- aprovação de versão de orçamento;
- criação de job a partir de orçamento aprovado;
- uso de custo C;
- tentativa negada de ação sensível, quando tecnicamente viável.
