# 104 — O item da planilha muda de lugar pela alça, e pode trocar de agrupamento

**Data:** 2026-09-24
**Decidido por:** Tiago
**Migration:** `20260924200001_ordem_dos_itens_da_versao.sql` (só uma função nova).

---

## 1. O problema

A ordem dos itens da planilha interna do orçamento era a ordem em que eles
foram lançados. Não havia como subir um item, descer, nem levá-lo para outro
agrupamento: para "mudar de lugar" era preciso apagar e digitar de novo. E a
ordem importa fora da tela — a planilha exportada para o cliente sai nela.

## 2. O que foi escolhido

Três desenhos foram prototipados (artifact "Reordenar itens da planilha",
24/09/2026): **A** alça de arrastar na própria planilha, **B** painel lateral
de reordenação com "Salvar ordem", **C** número da posição com um quadro
"Mover". O Tiago escolheu a **A**.

1. **Alça no recuo do item.** Ao passar o mouse na linha aparece a alça
   (⋮⋮) no recuo de 30px à esquerda do nome — nenhuma coluna nova, a grade
   não muda. O arrasto começa só por ela: clicar na célula, andar pelas
   setas e abrir o Tipo continuam iguais.
2. **Durante o arrasto:** a linha de origem fica apagada, um fantasma com
   nome, tipo e total orçado segue o cursor, e uma linha vermelha mostra
   onde o item vai cair. Saindo do grupo, o fantasma diz "Vai para
   Agrupamento X · 2º". Sobre um agrupamento **recolhido**, a linha dele
   acende e o item vai para o **fim** dele. Perto da borda da janela a
   página rola sozinha. **Esc** desiste.
3. **Teclado:** com uma célula do item selecionada, **⌥ Alt + ↑ ↓** sobe e
   desce a linha. Na ponta do grupo ela passa para o vizinho (fim do de cima,
   começo do de baixo), que abre se estava recolhido. O atalho entrou na
   linha de dicas da planilha.
4. **Grava ao soltar** na tela da versão, como as células. O aviso no canto
   ("“Item 3” agora é o 1º de Agrupamento 1", e "Saiu de Agrupamento 2."
   quando trocou) tem **Desfazer** e fica 8 segundos. A linha movida pisca
   uma vez.

## 3. As regras (respostas do Tiago, 24/09/2026)

| Pergunta | Resposta |
|---|---|
| O item pode trocar de agrupamento? | **Sim.** Os subtotais dos dois grupos são recalculados. No orçamento mensal a tela mostra um mês por vez, então a troca fica dentro do mês. |
| Os agrupamentos também mudam de ordem? | **Não nesta entrega** — só os itens. |
| Quando pode reordenar? | **Igual à edição de célula:** versão que não está aprovada nem cancelada, e papel com `orcamentos.editar`. Conferido também no servidor. |
| Onde? | **Na versão do orçamento**, incluindo a versão vista na **visão agregada** do projeto. A planilha do job não muda. |

## 4. Como a ordem é gravada

- **Nada de coluna nova.** A ordem já era `versoes_orcamento_itens.ordem`,
  **global na versão**: a tela ordena os grupos pela ordem deles e, dentro de
  cada grupo, os itens pela `ordem` do item. O banco não exige número único.
- **A regra do movimento mora num lugar só:** `lib/calculos/ordem-itens.ts`
  (`moverNaLista`, `destinoPorTecla`, `numerarItens`, com testes em
  `ordem-itens.test.ts`). A tela a usa para mostrar o resultado na hora, a
  server action para calcular o que gravar, o rascunho da agregada no estado
  do React.
- **Tela da versão:** `moverItem` (server action) lê a ordem **atual do
  banco**, aplica o movimento, renumera 1..N na sequência da tela e grava só
  as linhas que mudaram, pela RPC `aplicar_ordem_itens_versao` — um UPDATE
  numa transação. A RPC confere que todo item e todo grupo do pedido são da
  mesma versão; status e permissão ficam na action, como nas RPCs dos meses.
- **Visão agregada:** o movimento fica no rascunho e vai no "Salvar
  alterações". Até aqui esse salvamento **nem lia** a ordem atual dos itens —
  mudar só a ordem não chegava ao banco. Agora ele lê, e quando a
  **sequência** dos itens de um orçamento mudou grava as linhas em que só a
  ordem mudou, pela mesma RPC, numa chamada só. Quando a sequência não mudou
  (o caso de todo orçamento que ninguém tocou), não grava nada: o salvamento
  manda todos os orçamentos da tela, e sem essa conferência renumeraria os
  que têm numeração fora da sequência dos grupos.
- A renumeração 1..N reescreve números de itens que não mudaram de lugar na
  tela (em 5 das 33 versões com itens, em 24/09/2026, a numeração não seguia
  a sequência dos grupos). A ordem que se vê não muda com isso.
- A **exportação** da versão já lê os itens por `ordem`: a planilha que vai
  para o cliente sai na ordem nova sem mexer no exportador.

## 5. O que ficou de fora

- Mudar a ordem dos **agrupamentos**.
- A planilha interna do **job** (errata e travas próprias).
- Levar um item para **outro orçamento** na visão agregada: cada card tem a
  sua planilha, e o adaptador recusa.
