# 258 — Quantas PPs em cada regional e empresa, nos seletores da lista de PPs

**Data:** 2026-11-16
**Status:** aceita e implementada em 16/11/2026.
**Quem decidiu:** Tiago, num comentário no protótipo da lista de PPs ("Verba paga no status", versão 15), aprovado com "Sim, implementar".
**Migration:** nenhuma.

## O problema

Na aba PPs do Contas a Pagar, os seletores de regional e de empresa só listavam nomes. Para saber quantas PPs em avaliação cada regional ou empresa tinha, o financeiro precisava marcar uma por uma e olhar o número do chip.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Seletor de regionais | Ao lado de cada regional aparece quantas PPs ela tem no chip escolhido (Em avaliação, Aprovadas, Todas…). Em cima da lista, o que o número conta: "PPs em avaliação", "PPs aprovadas", "Todas as PPs", "Prestações em avaliação"… |
| D2 | Seletor de empresas do cabeçalho | O mesmo, por empresa, **só na aba PPs**. Nas outras abas do Contas a Pagar e nas outras telas, o seletor fica como antes, sem número. |
| D3 | A mesma base dos chips | O número segue a regra do número do chip: o status escolhido e as regionais/empresas marcadas. **A busca não entra**, como também não entra no número do chip. |
| D4 | Cada seletor ignora a própria seleção | O número da regional não muda com as regionais já marcadas: ele diz quantas PPs aparecem ao marcar aquela. O da empresa respeita as regionais marcadas. Sem regional marcada, a soma das regionais é o número do chip. |
| D5 | Empresas não marcadas | A página carrega só as PPs das empresas marcadas. Das outras, uma leitura à parte traz só o que a contagem precisa (empresa, status, regional do job e se a prestação está em avaliação), com os mesmos filtros da lista. Com todas marcadas, essa leitura não roda. |

### Para registro

- Em 16/11/2026, nenhuma PP enviada da produção estava sem regional no job. A soma das regionais fecha com o chip.
- Número zero aparece em cinza claro, e número maior que zero, em negrito.

## No código

- **`components/ui/multi-select-regionais.tsx` e `components/ui/multi-select-empresas.tsx`:**
  - ganharam as props opcionais `contagens` e `legenda`;
  - sem elas, ficam como antes, nas outras telas que os usam.
- **`components/ui/contagem-nos-seletores.tsx` (novo):** o provider que leva as contagens da lista de PPs ao seletor do cabeçalho.
  - As abas do Contas a Pagar ficam montadas, só escondidas, então a lista não sai da tela ao trocar de aba.
  - A barra de abas (`contas-pagar-tabs.tsx`) informa se a aba PPs está à vista.
- **`components/ui/page-header-empresa-filter.tsx`:** lê a contagem do provider. Fora dele, recebe `null` e não mostra número.
- **`app/(app)/financeiro/contas-a-pagar/pedidos-compra-list.tsx`:** calcula as contagens (`entraNoChip`, `LEGENDA_DAS_CONTAGENS`). A prop nova `ppsDeOutrasEmpresas` é obrigatória e recebe lista vazia quando todas as empresas estão marcadas.
- **`app/(app)/financeiro/contas-a-pagar/page.tsx`:**
  - a leitura das empresas não marcadas, no mesmo `Promise.all`, página a página;
  - o provider em volta do cabeçalho e das abas.
