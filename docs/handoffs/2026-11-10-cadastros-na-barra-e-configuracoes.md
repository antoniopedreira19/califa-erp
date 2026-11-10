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

- **O financeiro perdeu o atalho para Cidades.** Ele via a lista (sem
  editar) pelo card de Cadastros; Configurações é só de administrador. A
  URL `/admin/cidades` ainda abre para ele, mas nenhum card leva até lá.
- A rota antiga `/cadastros/cidades` deixou de existir (404).
