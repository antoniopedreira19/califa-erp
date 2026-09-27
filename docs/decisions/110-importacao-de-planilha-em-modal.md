# 110 — Importação de planilha: modal no centro, escolha da aba e arquivo de até 10 MB

**Data:** 2026-09-27
**Decidido por:** Tiago
**Migration:** nenhuma.
**Protótipo aprovado:** https://claude.ai/artifact/8VCtqYBcZcHEchfV4PMzMW (versão 4)

---

## 1. O problema

A planilha "[INT] BUDWEISER - FESTIVAIS 2026 - MADA - ZPL.xlsx" não
importava, por dois motivos independentes:

1. **Tamanho.** O arquivo tinha 1,27 MB e subia pelo corpo da Server Action,
   que o Next corta em 1 MB por padrão. O envio era recusado antes do ERP
   ler qualquer coisa. O limite de 5 MB escrito em `arquivo.ts` nunca chegava
   a valer, e a Vercel corta qualquer envio em 4,5 MB.
2. **A aba lida.** O parser lia a primeira aba do arquivo quando não havia
   uma chamada "Padrão" ou "Oficial". Ali ela era oculta e era a legenda
   ("Classificação de Custos"). Das 15 abas, só a Página9 estava visível, e
   10 eram legíveis — versões antigas do mesmo orçamento, com orçados entre
   R$ 132.055,00 e R$ 468.200,80.

## 2. A regra

### Envio do arquivo

- O arquivo vai do navegador **direto para o Storage** (bucket
  `orcamento-importacoes`, pasta `<tenant>/envios/`), e as actions recebem
  só o caminho. **Limite: 10 MB**, conferido na tela e de novo no servidor.
- 10 MB é o maior limite que continua seguro: medido em 27/09/2026, ler um
  arquivo de 10,3 MB levou ~10 s e ~860 MB de memória, contra 2 GB da
  função. 20 MB chegaria perto do teto de memória.
- Ao gravar, o original vai da pasta de envios para a do orçamento
  (`<tenant>/<orcamento>/<importacao>-<nome>`), como sempre. Fechar o modal
  sem gravar apaga o arquivo enviado.

### Escolha da aba (D2, D3, D4)

- A tabela de abas aparece **sempre**, com uma linha quando o arquivo tem
  uma aba só.
- **Ordem:** visíveis legíveis, ocultas legíveis (marcadas "Oculta") e, por
  último, recolhidas, as abas que o ERP não lê, com o motivo.
- **Vem marcada** a aba "Padrão"/"Oficial" legível; senão a primeira visível
  legível; senão a primeira oculta legível.
- A aba é pedida **pelo nome exato**, com os espaços do começo e do fim — na
  Budweiser, duas abas só se diferenciam por um espaço.
- Trocar de aba troca o resumo na hora: o servidor lê todas as abas de uma
  vez e devolve o resumo de cada uma.

### O modal (D0, D1, D7, D9, D11, D12, D10)

- **Modal no centro** (1400 px, ou a janela menos 48 px) no lugar do drawer
  lateral, nas duas portas da versão — "Importar planilha" do orçamento
  (cria versão) e "Importar planilha nesta versão" (substitui).
- **Passo do arquivo (2A):** área de envio (clique ou arrastar), o desenho
  do formato com as letras das colunas do Excel e o botão **"Baixar planilha
  modelo"**.
- **Um desenho por modelo (D8):** nacional, internacional e mensal; no
  serviço Interno a coluna de tipo aparece como ignorada.
- **Conferir (1C):** a tabela de abas à esquerda e o resumo da aba à
  direita, cada lado com a sua rolagem.
- **Totais (D11, versão B):** os cartões de número saíram. A lista de
  grupos tem cabeçalho e termina com a linha de total, embaixo das colunas
  que ela soma.
- **Rentabilidade em R$ e em %**, na conta de `calcularRentabilidade`
  (sobre o orçado; travessão sem planejado), e em **grafite** (D10): orçado
  azul, planejado verde, rentabilidade grafite, como nas planilhas.
- **Confirmação (D12):** só quando a gravação apaga alguma coisa — o
  substituir de versão com grupos ou itens. É um pop-up "Substituir o
  conteúdo da vN?" por cima do modal, com o que sai, o que entra e o BV
  apagado quando houver. Versão vazia grava direto, e o botão vira
  "Importar planilha". Criar versão nova não pede confirmação.

### Onde vale (D5)

- Nas duas portas da versão, inclusive no orçamento mensal.
- No "Importar planilha" do editor do orçamento (rascunho e agregada): o
  mesmo modal, sem honorários e sem a pergunta do planejado; a aba escolhida
  vira grupos e itens do rascunho, e o "Salvar orçamentos" relê essa aba no
  Storage para registrar a importação.
- **Fica de fora:** a importação da planilha do projeto (seleção), que lê a
  exportação do próprio ERP, com uma aba só.

## 3. O que ficou de fora, de propósito

- **Limpeza de envios esquecidos.** Arquivo de importação feita no editor do
  orçamento e nunca salva fica em `<tenant>/envios/`. O modal apaga o envio
  ao fechar sem gravar; o rascunho abandonado, não.
- A planilha do projeto segue com o envio pelo corpo da action e o limite
  antigo.

## 4. Onde está no código

- Envio: `lib/importacao/limites.ts`, `lib/importacao/envio.ts`,
  `app/(app)/orcamentos/_importacao/envio-actions.ts` e `enviar-planilha.ts`.
- Leitura por aba: `parseOficial(…, { aba })` e `carregarPlanilha` em
  `lib/importacao/parser-oficial.ts`; `lib/importacao/abas-do-arquivo.ts`;
  `lib/importacao/preview-da-aba.ts`.
- Modal: `app/(app)/orcamentos/_importacao/importar-planilha-dialog.tsx`,
  `formato-da-planilha.tsx`, `tabela-de-abas.tsx`, `resumo-da-aba.tsx`.
- Versão: `versoes/importar-planilha-versao.tsx` (substitui o
  `importar-drawer.tsx`) e `versoes/importar-actions.ts`.
- Editor do orçamento: `_rascunho/importar-planilha-modal.tsx`,
  `_rascunho/actions.ts`, `_rascunho/salvar-em-lote.ts`.
- Planilha modelo: `lib/exportacao/modelo-de-planilha.ts` e a rota
  `GET /api/orcamentos/modelo-de-planilha?modelo=…[&orcamento=…]`.
- Testes: `lib/importacao/abas-do-arquivo.test.ts` e
  `lib/exportacao/modelo-de-planilha.test.ts`.
