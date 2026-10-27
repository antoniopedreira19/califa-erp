# 217 — O código do projeto sai das telas

**Data:** 2026-10-27
**Status:** aceita e implementada em 27/10/2026.
**Quem decidiu:** Tiago. Em 23/10 ele pediu o mapa de onde o código do
projeto aparece; em 26/10 recebeu os prints das 40 telas com cada lugar
destacado e a proposta de como tirar
(https://claude.ai/artifact/V2i6P4pthYtNJahKEAnWJG), e respondeu em 27/10:
"Pode tirar todos os codigos de projeto". As quatro escolhas da página
seguiram a opção recomendada (A).
**Revê:** a [210](210-codigo-do-projeto-sem-sigla.md) só na tela: o código
continua sendo gerado e gravado do mesmo jeito.
**Migrations:** nenhuma.

## O problema

Depois da 210 o código do projeto (`P-0006/26`, `F-0002/26`) e o do
orçamento (`P-0006/26-01`) servem só ao controle do sistema, mas
apareciam em 83 lugares: faixa do projeto, cabeçalhos, listas, funis,
pop-ups, a planilha que vai para o cliente e o Excel do financeiro.

## A regra

1. **O código do projeto, da produção ou do financeiro, e o código do
   orçamento não aparecem para o usuário.** Onde vinham junto do nome, fica
   o nome; onde vinham sozinhos (linha acima do título, coluna "Código" da
   lista de projetos, "Código do projeto:" no Editar projeto, subtítulos de
   Novo projeto e Novo orçamento), a linha ou a coluna sai.
2. **Buscas e funis usam o nome.** A busca da lista de projetos e a da fila
   de abertura deixam de casar o código do projeto (a da fila continua
   casando o código do job). O combo de projeto da abertura busca só pelo
   nome ("Digite o nome do projeto").
3. **Ordem (escolha 1 = A):** onde a lista seguia o código, segue a data de
   criação, que dá a mesma ordem: abas de orçamento da faixa, cartões da
   agregada, seções da planilha exportada, opções do combo de projeto do
   financeiro e grupos do Visualizar Jobs e do Resultado de Job. O "Ordenar
   de A a Z" dos funis passa a ordenar pelo nome.
4. **Excel do Visualizar Jobs e do Resultado de Job (escolha 2 = A):** a
   coluna "Código do projeto" sai; fica a coluna "Projeto".
5. **Planilha exportada do projeto (escolha 3 = A):** a célula A1 traz só o
   nome do projeto, e o arquivo sai como `orcamentos-<nome>.xlsx` ou
   `interna-<nome>.xlsx`, sem acento, como já era o export da versão.
6. **Foto da abertura de projeto apagado (escolha 4 = A):** o rótulo
   gravado ("CÓDIGO · nome") tem o código cortado na hora de mostrar
   (`semCodigoNoRotulo`, em `fotos.ts`). O banco não muda.
7. **Mensagens:** "Já existe um projeto com este nome: F-… · nome, de X"
   vira "Já existe um projeto com este nome no cliente X"; as colisões raras
   do gerador viram "Não foi possível criar o projeto/orçamento agora —
   tente novamente"; a faixa "Job cancelado" e o pop-up de cancelamento da
   fila mostram o nome do projeto do financeiro inativado.
8. **Equipe do projeto:** o motivo "Produtor do orçamento …" usa o nome do
   orçamento.
9. **Fica:** o código do job (`TES-1001/26`) e o da PP, a geração dos
   códigos de projeto e de orçamento, a auditoria (`*.codigo_trocado`,
   metadados da Equipe) e as URLs, que já usavam ids.

## Onde mudou

- Faixa do projeto (`components/faixa-do-projeto.tsx`): a prop `projeto`
  perdeu `codigo`; chip, dicas, menu "Todos" e balão do Voltar usam o nome.
  Vale nas 8 telas que a usam.
- Ficha do job (`app/(app)/jobs/[jobId]/ficha-job.tsx`): o link do projeto
  saiu do cabeçalho da coluna e foi para "Nome do projeto"; o card "Origem"
  e o diálogo "Sair para o módulo de Orçamentos?" ficam só com o nome.
- Cartão "Descritivo" (`components/ui/descritivo-popover.tsx`): `codigo`
  nulo esconde a linha; o projeto passa nulo, o job e a PP seguem com o
  código deles.
- Orçamentos: lista, página do projeto, agregada, Novo/Editar projeto,
  Novo/Editar orçamento, faixa "Job cancelado", planilha exportada.
- Jobs: lista (cabeçalho do grupo), agregada, Equipe.
- Financeiro: fila de abertura (célula, busca, funil, Aprovar save,
  Cancelar job), Visualizar Jobs e Resultado de Job (grupo, coluna, link,
  funil, ordem, Excel), formulário da abertura (campo, combo, lápis, "+",
  dica, resumo, erro de nome repetido), histórico da abertura, projeto do
  financeiro, tela da PP (Origem no job).
