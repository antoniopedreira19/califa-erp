# Busca e ordenação na lista de usuários (2026-09-30)

> Contexto: a tela `/admin/usuarios` já passa de 80 pessoas e não tinha como
> achar alguém sem rolar a lista inteira. A lista ganhou busca por nome ou
> e-mail e ordenação alfabética, pedidas pelo Tiago. Só interface: nenhuma
> consulta, permissão ou dado mudou. A tela é da frente do Antonio; a
> mudança foi autorizada pelo Tiago.

## O que entrou

- **Busca** acima da tabela ("Buscar por nome ou e-mail..."): filtra no
  navegador, sem distinguir acento nem caixa ("natalia" acha "Natália").
  Sem resultado, a tabela mostra "Nenhum usuário encontrado para “…”".
- **Ordenação** pelos cabeçalhos **Nome** e **E-mail**, no desenho da lista
  de folhas do financeiro (`CabecalhoOrdenavel`). Cada clique avança
  A → Z, Z → A e volta à ordem de cadastro (`tenant_members.created_at`),
  que continua sendo o padrão ao abrir a tela. A comparação é
  `localeCompare("pt-BR", { sensitivity: "base" })`: "Victória" fica entre
  os V, não no fim.
- **Larguras fixas** nas colunas (35 / 30 / 13 / 12 %): sem elas, a largura
  automática fazia as colunas mudarem de lugar a cada letra da busca.

Tudo em `app/(app)/admin/usuarios/usuarios-lista.tsx`.

## Migrations aplicadas

Nenhuma.

## Pontos de atenção pra próxima sessão

- A busca e a ordenação vivem só no estado do componente: recarregar a
  página volta à ordem de cadastro e limpa a busca.
- Conferido em 30/09 no navegador embutido, logado como administrador,
  com os 88 usuários reais: busca sem acento, por trecho de e-mail e sem
  resultado; os três estados da ordenação em Nome e E-mail; busca e
  ordenação juntas com as colunas paradas; clique na linha abrindo
  "Editar"; console sem erro numa aba nova.
