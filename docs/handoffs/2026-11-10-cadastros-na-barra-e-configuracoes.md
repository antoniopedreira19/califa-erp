# Cadastros na barra lateral e a engrenagem abre Configurações (2026-11-10)

> Antes, a engrenagem do rodapé abria um hub (`/configuracoes`) com dois
> cards, Cadastros e Administração, e era preciso mais um clique para chegar
> a qualquer um deles. Agora Cadastros é módulo da barra lateral, logo abaixo
> de Freelancers, e a engrenagem abre direto a antiga Administração, que
> passou a se chamar Configurações e ganhou Cidades.

## O que muda pro negócio

Clientes, fornecedores e veículos ficam a um clique, na barra. As
configurações de sistema (usuários, empresas, rateios regionais e cidades)
ficam juntas atrás da engrenagem.

## Estado atual

- **Barra lateral**: item **Cadastros** (`/cadastros`) depois de
  Freelancers, com a mesma permissão de antes (`sidebar.cadastros`:
  administrador e financeiro). Fica marcado também em `/clientes/*` e
  `/fornecedores/*`.
- **Engrenagem**: leva a `/admin`, título **Configurações**. Só aparece
  para quem tem `sidebar.administracao` (administrador). Antes aparecia
  também para o financeiro, por causa do card de Cadastros.
- **Cidades**: saiu de Cadastros e mora em `/admin/cidades`, como card de
  Configurações. A página continua com `requireSession` e a edição
  continua só do administrador (`cadastros.cidades.editar`), como antes.
- **`/configuracoes`**: só redireciona para `/admin`, para endereço salvo.
- As subpáginas de `/admin` trocaram o sobretítulo "ADMINISTRAÇÃO" por
  "CONFIGURAÇÕES".

## Decisões que vão importar amanhã

- **O financeiro perdeu o atalho para Cidades** (o Tiago confirmou: "deixa
  assim"). Ele via a lista, sem editar, pelo card de Cadastros.
- A rota antiga `/cadastros/cidades` deixou de existir (404).

## ⚠️ Quem acessa Cadastros e Configurações (2026-11-10, mesma data)

Decisão do Tiago, no mesmo dia, para o módulo ficar coerente com o que cada
papel já faz pela PP e pelo projeto:

| Tela | Ver | Criar e editar | Inativar e reativar |
|---|---|---|---|
| Menu Cadastros | Admin, Financeiro, GP, Produtor | — | — |
| Clientes | Admin, Financeiro, GP | Admin, Financeiro, GP | Admin, Financeiro |
| Fornecedores e Veículos | Admin, Financeiro, GP, Produtor | Admin, Financeiro, GP, Produtor | Admin, Financeiro |
| Configurações (Usuários, Empresas, Rateios, Cidades) | Admin | Admin | Admin |

- **Freelancer e RH ficam fora do módulo.** O freelancer continua com o
  formulário rápido de fornecedor da PP (`cadastros.fornecedores.inline`).
- **A página barra igual ao menu.** Quem não tem acesso e digita o endereço
  vai para `/home?reason=sem_permissao_cadastros`. Antes, qualquer pessoa
  logada abria Clientes, Fornecedores, Veículos e Cidades pelo endereço.
  A leitura no banco segue aberta a qualquer membro do tenant (RLS
  `is_tenant_member`), porque jobs, PPs e orçamentos mostram cliente e
  fornecedor para todos — a trava é de tela, não de dado.
- **GP edita cliente** (`cadastros.clientes.editar` ganhou o GP). Isso vale
  também para o lápis do campo Cliente no orçamento e para marcas e portais
  dentro do cadastro do cliente, que se salvam junto da edição.
- Recursos novos em `lib/permissoes.ts`: `cadastros.clientes.ver`,
  `cadastros.clientes.inativar` e `cadastros.fornecedores.ver`. Inativar
  fornecedor continua em `cadastros.fornecedores.editar`.
- Sem migration: as policies de `clientes` e `fornecedores` não distinguem
  papel; quem decide é o servidor do app.
- O aviso do campo de cidade do orçamento deixou de mandar para
  `/admin/cidades` (que só o Admin abre) e passou a dizer para pedir a um
  administrador.

**Conferido no Sandbox em 2026-11-11**, logado como cada papel
(`admin@`, `gp@` e `produtor@sandbox.local`):

- **GP:** menu com Cadastros e sem engrenagem; cards Clientes, Fornecedores
  e Veículos; listas sem Inativar/Reativar; `/admin`, `/admin/cidades` e
  `/configuracoes` voltam para a Home. Editou o cliente "Teste 22" pela tela
  (razão social e CNPJ de teste `11.222.333/0001-81`); a auditoria registra
  `cliente.editado` por `gp@sandbox.local`.
- **Produtor:** cards Fornecedores e Veículos, sem Clientes; `/clientes` e
  `/clientes/<id>` vão para `/home?reason=sem_permissao_cadastros`;
  `/admin/cidades` volta para a Home. Editou o telefone do "Fornecedor
  Teste" pela tela; `fornecedor.editado` por `produtor@sandbox.local`, e
  nenhuma `acao_negada` dos dois na hora do teste.
- **Admin:** engrenagem leva a `/admin` (Configurações, com Cidades); listas
  com Inativar; Cidades com "Nova cidade".
- **Freelancer** (`freelancer@sandbox.local`, criado em 2026-11-11 só no
  Sandbox, mesmo caminho dos outros três): menu só com Home, Orçamentos e
  Jobs, sem engrenagem. `/cadastros`, `/clientes`, `/fornecedores`,
  `/fornecedores/novo`, `/fornecedores/<id>`, `/cadastros/veiculos` e
  `/cadastros/veiculos/novo` vão para `/home?reason=sem_permissao_cadastros`;
  `/admin` e `/configuracoes` voltam para a Home. O formulário rápido de
  fornecedor da PP não foi exercitado: o código dele não mudou, e o
  freelancer do Sandbox ainda não está em nenhum job.

A regra também está no teste novo de `lib/permissoes.test.ts`. As 5 falhas
que a suíte mostra são anteriores (listas de barra lateral desatualizadas
desde os módulos Freelancers e RH).
