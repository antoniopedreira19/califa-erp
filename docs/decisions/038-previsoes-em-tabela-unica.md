# 038 — As duas previsões do job viraram um card só, "Previsões"

**Data:** 2026-09-02
**Status:** aceita
**Contexto:** a tela de abertura de job no financeiro e suas outras duas
aparições (aba "Abertura" do job já aberto, em leitura, e a mesma aba
destravada para editar, que é por onde passa a revisão de errata).
Design de referência: `Abertura de Job - Financeiro.dc.html` (projeto
Claude Design `69342d83`), layout **D · Uma tabela, dois blocos**.
Decisões do Tiago em 02/09/2026.

## A mudança em quatro frases

1. **Um card só, chamado "Previsões"**, no lugar dos dois cards
   "Previsão de recebimento" e "Previsão de custos". O título é o único
   ponto em que fugimos do design, que escrevia "Previsão de recebimento
   e de custos".
2. **Três tiles no topo** — Valor total do job, Faturamento previsto,
   Custo previsto total — em vez de dois tiles repetidos em cada card,
   com "Valor total do job" aparecendo duas vezes.
3. **Uma tabela só, partida em dois blocos**: recebimento em cima
   (entrada), custos embaixo (saída). Um cabeçalho de colunas, uma calha
   de números. As linhas ganharam prefixo — `R01`, `C01` — porque agora
   dividem a mesma numeração.
4. **As duas contas bancárias moram no mesmo cabeçalho** do card, e o
   selo de conferência ("fecha com o faturamento" / "fecha com o total")
   subiu para a faixa do próprio bloco, ao lado de "Distribuir".

Nada mudou nos cálculos, nas validações, no congelamento de parcela já
consumida por PP/nota, nem no que a tela grava. É entrega de tratamento
visual.

## 1. Por que uma tabela só

O mesmo motivo da decisão 024. Eram duas grades independentes com as
mesmas quatro colunas (#, data prevista, valor, % do total) e larguras
próprias. Elas nunca alinhavam entre si, e o financeiro lê as duas em
sequência: quanto entra, quanto sai, quanto sobra. Com uma grade só, a
coluna de valor do recebimento e a do custo caem no mesmo eixo, e a
comparação passa a ser visual.

O rodapé da tabela fecha a conta que antes só existia na lateral:
margem prevista, e a contagem das linhas dos dois blocos.

## 2. O que foi decidido contra o design

Três pontos, todos porque o protótipo não conhece regra do sistema:

- **Título "Previsões"**, não "Previsão de recebimento e de custos".
- **Os rótulos dos blocos seguem os termos do sistema** — "Parcelas de
  recebimento" e "Custos · cronograma de desembolsos". O design escrevia
  "Recebimento" e "Custos · curva de desembolso"; "cronograma" foi uma
  renomeação deliberada de "curva" e não volta atrás.
- **O texto de rodapé é nosso, reescrito num parágrafo só.** O do
  protótipo descrevia a curva de custos como sugerida pela faixa de
  valor do job, que não é o nosso comportamento. O texto que ficou
  carrega as duas informações reais que os dois cards antigos tinham
  separadas: as janelas de pagamento (dias 08 e 20) e o abatimento da
  previsão pela nota emitida e por cada PP emitida.

## 3. O que o design não previa e continua de pé

O protótipo desenha o caso feliz. Continuam funcionando, agora como
linha de largura total dentro da tabela, com fundo âmbar:

- **Faturamento previsto zero** — o cliente paga o fornecedor direto, ou
  o job é pago com saldo em save de outro job (decisão 028). O bloco de
  recebimento vira aviso, sem linhas e sem soma.
- **Custo previsto zero** — nenhum item de calha PP. Mesmo tratamento no
  bloco de custos.
- **Data fora da competência** escolhida segue sinalizada na linha.
- **Parcela congelada** por PP ou nota já emitida segue travada, sem
  campo editável e sem botão de remover.

## 4. Onde isso aparece

Num componente só, `AberturaForm`, usado em três lugares:

- `/financeiro/abertura-de-job/[jobId]` — a abertura, modo `abertura`;
- a aba "Abertura" de `/financeiro/jobs/[jobId]`, modo `leitura`;
- a mesma aba destravada, modo `edicao`, que é o caminho da revisão de
  errata.
