# 260 — O Faturar "em pé", a lista do Faturamento pela situação e o recebimento antes da NF no Recebimento avulso

**Data:** 2026-11-16
**Status:** aceita e implementada em 16/11/2026. Uma pendência (D16) fica para um segundo momento.
**Quem decidiu:** Tiago, em 16/11/2026, pelo protótipo interativo "Faturar em pé" (versões 1 a 17, com comentários em cada versão) e pelo "tudo feito e aprovado, pode implementar".
**Revê:** a [256](256-novo-faturamento-e-faturar-unificado.md) (o tamanho do Faturar, o lugar das deduções, o quadro de impostos e o lugar do registro do recebimento antes da NF).
**Migration:** nenhuma.

## O problema

- **O Faturar:** em tela cheia, o pop-up da 256 (1.560 px) ficava largo demais. O Tiago preferiu como ele ficava com a janela menor. O campo das deduções, solto na nota fiscal, não dizia o que a dedução faz, e o quadro "Impostos desta nota" tinha texto demais.
- **A lista da aba Faturamento:**
  - as linhas tinham de três a cinco alturas;
  - quem enviou o job ficava dentro da descrição;
  - o filtro era só Tudo / A faturar / Faturados;
  - a coluna Nota mudava de sentido entre a linha a faturar e a nota emitida;
  - o nome do job era o da produção.
- **O recebimento antes da NF:** desde a 256, só a conciliação registrava. O Tiago quer tirar a coluna Ação, e o registro precisava de um lugar em Contas a Receber.

## Decisões

### O Faturar

| # | Tema | Decisão |
|---|---|---|
| D1 | Largura | O pop-up passa de 1.560 para **1.080 px**. Com o PDF da nota aberto, o formulário fica com 860 px (antes 1.180), e a nota fica com o resto. |
| D2 | Campos | **Nota fiscal em duas colunas:** CNPJ emissor na linha inteira; Nº NF e emissão; CNAE; a linha das deduções; descrição. O CNPJ do tomador ganha a linha inteira, e o Nº e o anexo da PO vêm embaixo. Os campos baixam de 44 para **36 px**, o texto de 14 para 13 px e os rótulos para 12,5 px. |
| D3 | Deduções (opção A) | Depois do CNAE, na mesma linha, como no portal emissor: **(−) Deduções (repasse)** (o único que se digita), **= Base do ISS** e **ISS (alíquota)**. Embaixo, só **"Usar o custo AR: R$ X"**. A conta do custo AR (o AR inteiro × a parte desta nota, e o limite ao valor da nota) fica no ⓘ, ao passar o mouse. |
| D4 | Impostos desta nota | O quadro passa de 460 para 360 px e fica só com os números: <br>• a competência no cabeçalho; <br>• o total, as deduções e a base do ISS; <br>• cada imposto numa linha (alíquota · vence dd/mm · valor); <br>• o que falta, o líquido, a CBS e o IBS; <br>• o que vai para a Apuração do mês. <br>As contas, as guias, o regime, o IRPJ/CSLL e os créditos ficam no ⓘ. |

### A lista da aba Faturamento

| # | Tema | Decisão |
|---|---|---|
| D5 | Grade fixa | A grade da lista de PPs (decisão 257): **cada linha tem no máximo duas alturas**. O texto que não cabe é cortado com "…" e abre inteiro ao passar o mouse. |
| D6 | Colunas | Job · Cliente · Empresa · Valor · Já faturado · A faturar · Parcela · Vencimento · Enviado por · Situação · Planilha Interna. Saem **Descrição** e **Ação**. Clicar na linha faz o que o botão fazia: abre o Faturar ou, na nota emitida, a nota. |
| D7 | Job | Em cima: o código, a origem (Job, Lote, BV ou o **número da NF**, que saiu da coluna Ação) e o mês do mensal. Embaixo: **o nome do job dado pelo financeiro** (D11). |
| D8 | Parcela | Era "Nota", que misturava a posição da nota no envio (1/2) e as parcelas (3x, ou 1/1). Passa a mostrar só as parcelas da nota (1x, 2x, 3x), em todas as linhas. A posição no envio (ou no lote) desce para a linha de baixo ("nota 1/2"), só quando há mais de uma nota. |
| D9 | Enviado por | Coluna própria, como na lista de PPs: o nome e, embaixo, a data e a hora. No Novo faturamento, "Financeiro". A coluna tem filtro no título. |
| D10 | Situação | Na linha a faturar: Recebido antes da NF, Parcial (faturada em parte) e Saldo do Novo. Na nota emitida: o selo da situação de recebimento (D12) e o detalhe. |
| D11 | Nome do job | **No módulo financeiro e nos relatórios, o nome do job é sempre o que o financeiro deu na abertura (decisão 243), nunca o da produção** (regra do Tiago). A lista, as notas emitidas, o Faturar (a lista de jobs e a linha do saldo do Novo) e a lista de jobs do recebimento antes da NF passam a usar `nomeDoJobNoFinanceiro`. |
| D12 | Filtros | Chips com a contagem, como na lista de PPs: **A faturar** (a lista abre nele), **Faturados**, **A receber**, **Recebidos**, **Inadimplentes** e **Todos**. Detalhes nas tabelas abaixo. |
| D13 | CNPJ emissor | O filtro de Cliente sai: o cliente continua pela busca e pelo título da coluna. Entra o filtro dos **CNPJs emissores** do cadastro, no desenho do filtro de regionais da lista de PPs, com quantas linhas cada um tem. Detalhes abaixo. |

**D12 — o que entra em cada chip:**

| Chip | O que entra |
|---|---|
| Faturados | Cada nota emitida, inteira, com a situação dela. |
| A receber | O pedaço da nota ainda por vencer. |
| Recebidos | O pedaço da nota já recebido, e o recebimento antes da NF. |
| Inadimplentes | O pedaço da nota vencido sem nada recebido. |
| Todos | Todas as linhas. Os pedaços da mesma nota vêm juntos, ligados por um tracejado. |

**D12 — as regras dos pedaços** (as da aba Títulos a Receber):

| Regra | Como fica |
|---|---|
| Recebimento parcial | Vira mais de uma linha: a parte recebida em Recebidos e o resto em A receber (ou em Inadimplentes, se venceu). |
| Recebido antes da NF | Vira uma linha em Recebidos, logo abaixo da linha a faturar do mesmo job. |
| Parcela vencida que já começou a ser paga | Fica em A receber, não em Inadimplentes (decisão 125). |
| Valor do recebido | O bruto: o líquido mais os retidos. |
| Faturamento Agrupado | Ao ligar, a lista volta para A faturar. |
| Contagem dos chips | O CNPJ escolhido muda a contagem; a busca, não. |

**D13 — as regras do filtro de CNPJ emissor:**

| Linha | CNPJ que conta |
|---|---|
| Nota emitida | O CNPJ que a emitiu. |
| Linha a faturar | O que o Faturar já traz escolhido: Hitlab com a Hitlab; senão, o último CNPJ usado para o CNPJ do cliente. |
| Linha sem CNPJ | Não há opção "Sem CNPJ": nenhuma nota sai sem CNPJ emissor (Tiago). A linha só aparece em "Todos os CNPJs". |

### O recebimento antes da NF

| # | Tema | Decisão |
|---|---|---|
| D14 | No Recebimento avulso | O recebimento antes da NF passa a ser um **cartão do formulário de Recebimento avulso**, o **primeiro**: Recebimento antes da NF · Recebimento avulso · Transferência · Mútuo · Rendimento. <br>Escolhe-se o job ou o BV e, logo abaixo, aparecem os campos de sempre (decisões 130 e 229): data, conta, valor recebido e centro de custo. No internacional, aparecem o valor na moeda, a cotação, o bruto, o IOF e a tarifa. <br>"Registrar recebimento" grava direto, sem segunda janela. |
| D15 | Conciliação | O item "Recebimento antes da NF" do Novo lançamento abre o mesmo formulário, já no cartão. |
| D16 | **Pendência: na conciliação bancária, a partir da linha do extrato** | O Tiago quer registrar o recebimento antes da NF **direto no momento da conciliação bancária**, como já se faz com o lançamento avulso a partir da linha do banco ("Lançar avulso", decisão 200). <br>Fica para um segundo momento, a implementar em breve. **Não implementado nesta entrega.** |

### Para registro

- **Por que um cartão, e não um campo "Job" dentro do Recebimento avulso** (a primeira ideia do Tiago): os dois lançamentos são de natureza diferente.
  - O recebimento avulso é receita sem nota: entra no DRE pelo centro de custo e pelo rateio e nasce como título, com "Criar" ou "Criar e dar baixa".
  - O antes da NF é dinheiro que já entrou e vira a parcela 1 da nota.
  - Com um campo Job, escolher o job teria que esconder metade do formulário.
- **Retenções:** o recebimento antes da NF nacional continua sem campo para os impostos que o cliente retém (IRRF, PIS/COFINS/CSLL). A retenção é informada no Faturar e conferida na baixa. Ficou perguntado ao Tiago se o recebimento antes da NF também deve aceitar a retenção.
- **Dado real conferido em 16/11/2026, na produção (só leitura):**
  - a única nota emitida tem o CNPJ emissor; há 5 CNPJs ativos;
  - das 18 linhas a faturar, cerca de 6 já têm CNPJ sugerido;
  - o maior previsto de job é R$ 4.691.189,26: a coluna Valor passou de 112 para 124 px para caber.
- **Antes, a lista mostrava o nome da produção:** `vw_faturamento_pendente` devolve `j.nome AS descricao`, e as notas emitidas montavam o item com `job?.nome`. A view não muda (sem migration): a página troca o nome ao montar a linha.
- **O atalho "vencidas" da Home** saiu da consulta dos títulos e foi para a montagem (`apenasVencidas`, em `dados-dos-titulos.ts`). Ele cortava os títulos que a situação das notas usa.

## No código

- **`app/(app)/financeiro/contas-a-receber/situacao-da-nota.ts`** (novo): `recebimentoDaNota(titulos, hoje, total)` devolve a situação, o detalhe e os pedaços. Funções puras, com testes em `situacao-da-nota.test.ts`.
- **`page.tsx`:**
  - monta os títulos antes das notas emitidas, e cada `FaturadoRow` ganha `recebimento` (obrigatório);
  - lê `nome_financeiro` dos jobs e usa o nome do financeiro na fila, nas notas, no saldo do Novo e nos jobs do Faturar;
  - a consulta dos títulos não corta mais por "vencidas".
- **`faturamento-list.tsx`:** a lista nova (grade fixa, chips, filtro de CNPJ, Job com o nome do financeiro, sem Descrição e sem Ação).
- **`faturar-drawer.tsx`:** 1.080 px, as duas colunas, os tamanhos e a linha das deduções (D3). O campo antigo das deduções saiu.
- **`impostos-desta-nota.tsx`:** o quadro enxuto, com o ⓘ (`Dica`).
- **`recebimento-avulso-dialog.tsx`:** o cartão "Recebimento antes da NF", com os campos de `CamposDoRecebimentoAntesNf`, exportado por **`recebimento-antes-nf-dialog.tsx`**.
- **`conciliacao/menu-novo-lancamento.tsx`:** o item abre o cartão. Saiu `recebimento-antes-nf-na-conciliacao.tsx`.
- **`actions-recebimento-antes-nf.ts`:** a lista de jobs com o nome do financeiro.
- **`dados-dos-titulos.ts`:** o corte "vencidas" das notas.
