# 165 — Filtro e ordem pelo título da coluna, como no Excel, nas listas do ERP

**Data:** 2026-10-09
**Status:** aceita em 09/10/2026 e implementada em 10/10/2026.
**Quem decidiu:** Tiago, em 09/10/2026, sobre o protótipo "Filtro por coluna" (20 telas: 17 pedidas e 3 sugeridas), mais Clientes e Fornecedores pedidos na aprovação.
**Completa:** a [160](160-pp-pronta-para-envio-e-envio-pela-aba.md), que criou o filtro pelo título na aba Pedidos de Produção do job (`components/ui/filtro-de-coluna.tsx`).
**Migration:** nenhuma. É só tela: o filtro roda sobre a lista que a página já carrega.

## O pedido

"Quero que seja possível filtrar as colunas das tabelas iniciais de
Orçamentos, Jobs e de Visualizar Jobs, no financeiro (ambos os tipos de
visualização), como é possível fazer no Excel. Como fizemos com a aba de PPs
dentro do job." Depois do protótipo, o Tiago estendeu para as abas de Contas
a Pagar e a Receber, a Conciliação, o Fiscal, as sugestões e os cadastros de
Clientes e Fornecedores.

## A regra

1. **O título da coluna vira o filtro.** Ele abre o cartão da aba PPs: as
   duas ordens, a busca dentro da coluna, a lista de valores com quantas
   linhas tem cada um e "(Selecionar tudo)". Coluna de dinheiro filtra por
   "de / até". O funil vermelho no título diz que a coluna filtra; a seta,
   que ordena (a seta toma o lugar da setinha de abrir, para o título não
   alargar).
2. **A lista de valores de uma coluna é o que sobra com os filtros das
   outras**, como no Excel.
3. **Os filtros de cima continuam** (chips, Selects, busca, "Meus/Todos") e
   valem antes: o título trabalha sobre o que eles deixaram. Os números dos
   chips contam como antes. Onde um Select repete uma coluna (Status, Marca,
   Regional e Empresa em Jobs; Cliente, Marca e Regional em Orçamentos), os
   dois ficam: o Tiago preferiu manter.
4. **Uma coluna ordena por vez.** Sem ordem pelo título vale a ordem que a
   tela já tinha (urgente primeiro nos Títulos a Pagar, abertura mais recente
   no "Por job" etc.).
5. **A lista guarda a intenção.** Quem desmarca um ou outro valor fica com
   "todos menos estes"; quem desmarca tudo e escolhe alguns fica com "só
   estes". Assim, trocar o chip de cima não esvazia a tabela: desmarcar
   "Parcial" em "A pagar" e ir para "Pagos" mostra os pagos. Guardando só os
   marcados, dava "Mostrando 0 de 13".
6. **Filtros e ordem ficam guardados na aba do navegador**, um conjunto por
   tela: quem abre um título e volta acha a lista como deixou. Fechar a aba
   esquece. **Trocar de conta ou de período na Conciliação, de fatura no
   Cartão ou de job na aba PPs zera** — os valores são outros.
7. **Barra "Mostrando X de Y … · Limpar filtros e ordem"** aparece sempre que
   um título filtra ou ordena. Tabela vazia pelos títulos fica na tela, com
   os títulos para desfazer, e diz "Nenhum … com esse filtro.".
8. **Totais e subtotais que somam a lista** passam a somar o que sobrou
   (faixa do projeto em Jobs e em Visualizar Jobs, totais de Visualizar
   Jobs, subtotal das empresas nas Contas bancárias, rodapé do Calendário e
   das Folhas). **Os resumos de caixa** (Em aberto, Vencendo em 7 dias,
   saldos do banco, A faturar) continuam do conjunto inteiro, como já não
   seguiam a busca. Onde o resumo do banco não pode seguir o filtro (o saldo
   final tem de bater com o extrato), aparece um rodapé "Total do filtro".
9. **Seleção para lote só pega linha visível.** A linha que o filtro esconde
   sai da seleção (o `useSelecao` já fazia isso para a busca). Na Apuração,
   **"Aprovar as N guias pelo valor calculado" aprova só as guias visíveis**
   (decisão do Tiago, 09/10/2026; antes aprovava a competência inteira).
10. **Tabela agrupada** (projeto, empresa, competência, faixas da fila): o
    filtro age nas linhas de baixo; grupo sem linha some; com ordem pelo
    título, as linhas se ordenam dentro do grupo e o grupo entra na posição
    da sua primeira linha. Exceções: Folhas (a competência continua
    mandando; só o título Competência a inverte), Apuração (as PJs ficam na
    ordem do cadastro, porque a faixa diz o regime), PPs do Contas a Pagar
    (as urgentes continuam acima da faixa "Demais PPs", decisão 077) e
    Faturamento (pendentes em cima, faturadas embaixo).
11. **Data vira árvore mês ▸ dia** na lista do funil. Coluna de vários
    valores (as marcas, as regionais e os GPs de um projeto; os jobs
    cobertos de um título; os meios de um veículo) passa a linha se ALGUM
    valor estiver marcado. Status e situações aparecem na ordem do processo,
    não na alfabética.

## Onde

| Tela | Arquivo | Observação |
|---|---|---|
| Orçamentos (projetos) | `orcamentos/projetos-list.tsx` | colunas do funil alargadas (128/116/104/96 px) para o título com o funil caber |
| Jobs | `jobs/jobs-list.tsx` | Valor total 136 → 152 px |
| Abertura › Jobs aguardando abertura | `abertura-de-job/fila-list.tsx` | saves, erratas e aberturas filtram juntos; a coluna Abertura filtra pelo botão da linha; Enviado por filtra por quem e ordena por quando |
| Abertura › Visualizar Jobs | `abertura-de-job/jobs-abertos-list.tsx` | o mesmo filtro nas duas arrumações; no "Por job" o título Job é o filtro do Nome; Faturamento filtra pelo selo e ordena pelo valor |
| Abertura › Calendário › Jobs ativos numa data | `abertura-de-job/calendario-jobs.tsx` | o Select "Ordenação" saiu (a proximidade do evento é a ordem sem título); Custo previsto 118 px, Valor do job 114 px |
| Contas a Pagar › Títulos a Pagar | `contas-a-pagar/titulos-pagar-list.tsx` | Origem em árvore tipo ▸ código; Parcela 5% → 6%, Título 16% → 15% |
| Contas a Pagar › PPs | `contas-a-pagar/pedidos-compra-list.tsx` | no chip Prestações, Enviada em, Gasto e Saldo têm filtro próprio |
| Contas a Pagar › Desembolsos, Recorrências, Folhas | `desembolsos-list.tsx`, `recorrentes-list.tsx`, `folhas-pagar-list.tsx` | Folhas: o `CabecalhoOrdenavel` local saiu; Alocação em árvore empresa ▸ regional |
| Contas a Pagar › Cartão (capa e fatura) | `cartao-capa.tsx`, `fatura-extrato.tsx` | a fatura usa as colunas da planilha da conciliação (`colunasDoExtrato`) |
| Contas a Receber › Faturamento e Títulos | `faturamento-list.tsx`, `titulos-list.tsx` | Nota fiscal em árvore tipo ▸ número |
| Conciliação › contas, planilha do banco, títulos | `hub-tabela.tsx`, `conciliacao-list.tsx`, `aba-titulos.tsx` | Saldo sem filtro e sem ordem (cada linha segue mostrando o saldo dela no extrato); o filtro olha a linha do banco e as sublinhas acompanham |
| Fiscal › Apuração e Impostos a Pagar | `apuracao/aba-apuracao.tsx`, `impostos/aba-impostos.tsx` | a tabela "a apurar no recebimento" ficou sem filtro (projeção, sem ação) |
| Cadastros › Clientes, Fornecedores, Veículos | `clientes-list.tsx`, `fornecedores-list.tsx`, `veiculos-list.tsx` | a busca do Nome de Fornecedores acha os selos "Dados incompletos" e "Veículo" |
| Job › Pedidos de Produção | `jobs/[jobId]/pps/job-pps-section.tsx` | passou a usar o gancho comum (ganhou a intenção, a data em árvore e o armazenamento por job) |

Sem filtro, de propósito: caixas de seleção, colunas de ação ou de ícones, a
calha e o Saldo da planilha do banco.

## Como funciona

`components/ui/filtro-de-coluna.tsx` ganhou `useFiltrosDeColuna(linhas,
colunas, { guardarEm, contexto })`. A tela declara as colunas (o que cada
célula mostra para o filtro e para a ordem, com `celulaTexto`, `celulaData`
e `celulaValor`) e recebe as linhas filtradas e ordenadas, o título de cada
coluna (`titulo(chave)`), a barra (`BarraDosFiltrosDeColuna`) e `limpar()`.
As células são calculadas uma vez por lista; as colunas precisam ser
estáveis (constante do módulo ou `useMemo`). O guardado mora em
`sessionStorage`, chave `filtro-de-coluna:<tela>`, e é lido depois da
hidratação (o servidor desenha sem filtro).

## O que fica de fora / riscos

- **O filtro age só no que a página carregou.** Na Conciliação o período
  (de/até) continua no servidor; no `?filtro=vencidas` da home, idem.
- **Desmarcar "(Selecionar tudo)" para depois escolher um valor esvazia a
  lista por um instante e limpa a seleção do lote.** Filtre primeiro,
  selecione depois.
- **Fatura de cartão e guia de imposto rateada na planilha do banco:** o
  filtro de Fornecedor, Job ou Centro de custo olha a linha do pagamento, não
  os itens de dentro dela.
- Desembolsos, Recorrências, Folhas, Clientes e Fornecedores têm a maioria
  dos commits na frente do Antonio; a mudança foi autorizada pelo Tiago.
