# 189 — Prestação de contas da verba, documento a documento, e a NF da loja no fiscal

**Data:** 2026-10-19
**Status:** aceita e implementada em 19/10/2026.
**Quem decidiu:** Tiago, em 17 a 19/10/2026, sobre o protótipo interativo
"Prestação de Contas da Verba" (oito versões, com os componentes reais), que
ele aprovou na **versão A ("Junta e envia no fim")** com o drawer de
conferência **"1 · Enxuto"**:
https://claude.ai/artifact/MZGQ2V7vkx1xcwzPL2dmib.
**Revê:** a [081](081-a-producao-presta-contas-da-verba-e-o-financeiro-aprova.md)
(onde a produção presta contas, quando os documentos entram, os tipos e os
campos). O resto da 081 continua: envio único, o financeiro aprova ou reprova a
prestação inteira, o saldo vira estorno de verba na aprovação, "não houve
gasto" devolve a verba inteira.
**Relaciona-se com:** [152](152-nf-do-fornecedor-com-cadastro-proprio.md)
(cadastro de notas do fornecedor), [164](164-verbas-de-alimentacao-e-transporte.md)
e [171](171-verba-de-producao-com-titular-e-conta-do-rh.md) (quem presta
contas), [178](178-fatura-revisao-sem-nf-e-previa-da-pp.md) (fatura e a leitura
por IA, que fica para depois) e [187](187-pp-de-reembolso.md) (o reembolso, que
continua sem prestação e sem NF no fiscal).
**Migrations:** `20261019800001_prestacao_verba_status_rascunho.sql` e
`20261019800002_prestacao_verba_documento_a_documento.sql`, aplicadas pelo MCP
em 19/10/2026.

## O que aconteceu

Na PP-00210 a produção não achava onde subir a NF da verba: a prestação só
abria na aba de PPs, e só com a verba paga — e aquela verba ainda não estava
paga (ver o guia de 16/10/2026). O Tiago pediu um redesenho: prestar contas
também pelo "PPs" da Planilha Interna, juntar os documentos um a um e a NF
com os mesmos campos da NF da PP normal.

## A regra

### 1. Onde e quando a produção presta contas

- Pela **trilha da aba de PPs** (como antes) e pelo **cartão da verba no
  "PPs" da Planilha Interna**: o cartão mostra a barra do comprovado, uma linha
  com onde a prestação está e o botão **Prestar contas / Continuar prestação /
  Corrigir prestação** (ou **Ver prestação**, quando ela está com o
  financeiro). Os dois abrem a mesma gaveta.
- Quem pode é o mesmo de hoje: administrador, GP, produtor, o freela do
  projeto (`is_freelancer_do_projeto`) e o responsável da verba de produção
  anterior à 171.
- **Os documentos entram desde que a PP foi enviada ao financeiro** (em
  avaliação, aprovada ou paga), mesmo antes do pagamento.
- **O envio ao financeiro só libera com a verba paga.**

### 2. Documento a documento, envio no fim

- Cada arquivo fica **salvo no banco assim que entra**, e os campos se salvam
  a cada pausa da digitação (ou ao sair do campo). A prestação nasce no
  primeiro documento como **rascunho** — só a produção a vê: o financeiro, a
  fila, os títulos e o encerramento continuam lendo "aguardando prestação".
- Nada vai ao financeiro até o **envio único**. O financeiro aprova ou
  reprova a prestação inteira; reprovada, os documentos voltam para a gaveta e
  se corrigem no lugar, e a produção reenvia.
- "Não houve gasto" continua: a prestação vai sem documento, e os que
  estavam salvos saem (do banco e do Storage).

### 3. Os tipos e os campos

Os 7 tipos do sistema, nesta ordem: **NF, Recibo, Fatura, Boleto, Contrato,
Cupom fiscal, Outro**.

| Tipo | Campos (\* obrigatório) |
|---|---|
| NF e fatura | número\*, emissão\*, valor\*, CNPJ tomador\* (cadastro de impostos; já vem com o CNPJ da PP), CNPJ\* e razão social\* do emitente |
| Cupom fiscal | número\*, emissão\*, valor\*, CNPJ do emitente\*; razão social opcional |
| Recibo | data\*, valor\*, quem recebeu\*; número e CPF/CNPJ opcionais |
| Boleto e contrato | número\* e data\*, **sem valor** |
| Outro | descrição\*, data\* e valor\* |

**Boleto e contrato não somam no comprovado**: são anexos de apoio, para a NF
e o boleto da mesma compra não contarem duas vezes. O envio exige ao menos um
documento que comprove gasto. A soma nunca passa da verba, como antes.

A regra mora em `lib/calculos/prestacao-da-verba.ts` (a tela marca o que
falta) e em `_faltas_do_documento_da_prestacao` (o banco recusa o envio e a
aprovação, dizendo qual documento e o que falta).

### 4. A conferência no financeiro (drawer "1 · Enxuto")

Só na PP de verba; a PP normal não muda.

- A coluna Dados mostra os **documentos da prestação**; o selecionado abre
  sozinho os dados para conferir ao lado da imagem. Uma **seta no fim da
  linha** fecha e reabre, e cada documento lembra o estado.
- O financeiro **corrige** os dados (número, data, valor, CNPJ tomador,
  emitente, descrição) com a prestação em avaliação; cada correção grava ao
  sair do campo, e a soma se refaz. O **tipo** é da produção: quem discordar
  reprova.
- Na coluna de 310 px, os **CNPJs vão em linha inteira**, sem cortar.
- Saem o bloco "Documentos na aprovação" (a verba é aprovada sem documento,
  sempre) e o resumo do topo da prestação (título, situação, barra e lista de
  envios). Os **totais** (gasto comprovado, verba, saldo → estorno) ficam no
  pé da lista, e o **Histórico** vem depois da prestação.
- O filtro "Prestações" da fila passou a se chamar **"Prestação de Contas"**.

### 5. A NF da verba no cadastro de notas do fiscal

Na aprovação, cada **NF** da prestação entra em `notas_fiscais_fornecedor`
(decisão 152), para a Apuração contá-la como qualquer outra:

- o emitente é procurado pelo **CNPJ** em `fornecedores` (único por tenant,
  `uniq_fornecedores_documento_por_tenant`); sem cadastro, ele **nasce** com
  nome e razão social = a razão social da NF, o CNPJ, pessoa jurídica e
  `sem_dados_pagamento`;
- a nota guarda `registrada_na_pp_id` = a PP da verba;
- o **crédito de PIS/COFINS** segue a regra da PP normal — automático, e o
  financeiro só o tira, com motivo, no pop-up de aprovar;
- **sem ISS retido e sem retenção**;
- a nota que já estava no cadastro (o mesmo número do mesmo emitente) conta
  uma vez só, pelo que lá está;
- **fatura e cupom fiscal não entram** no cadastro de notas.

A Apuração (`lib/fiscal/apuracao-fatos.ts`) lia a nota só pelos anexos de PP;
a NF da verba não é anexo de PP, e entra pela verba que a registrou — sem os
pagamentos dela (o pagamento da verba é o adiantamento, sem retenção). A
estrutura das tabelas do fiscal não mudou: elas só ganham linhas.

### 6. O estorno

Como na 081: na aprovação, o saldo vira **Estorno de verba** em Títulos a
Pagar, na data prevista escolhida no pop-up.

### 7. A aba de PPs do job

- Coluna Status: o selo **alinhado à esquerda**; o selo longo da verba em
  **duas linhas equilibradas**, com a borda abraçando o texto (`duasLinhas`
  em `SituacaoVerbaChip`).
- As colunas curtas com **largura fixa** (`table-fixed`): Código 92,
  Vencimento 108, Dt. Pagamento 134, Valor 144, Status 136 e o olho 46; Origem,
  Serviço e Fornecedor dividem o resto.
- Na trilha, a verba paga mostra o botão com texto; a verba ainda em avaliação
  (que ainda se cancela) mostra o mesmo botão como ícone, ao lado do cancelar —
  "Continuar prestação" mede 149 px e não caberia junto (a trilha tem até três
  ícones, decisão 160).

## Conferido

Em 19/10/2026, pelas telas, no TES-1001/26 (projeto TES-P001/26), com a
**PP-00261** (verba de produção de R$ 3.000,00, titular terceiro "Fornecedor
Teste"), pagamentos e baixas na **Conta Teste**:

- **Antes de pagar:** com a PP em avaliação, o cartão da verba no "PPs" da
  planilha mostrou "Prestar contas"; NF 4521, cupom 9812, recibo 014 e
  boleto 4521 entraram um a um e ficaram salvos (rascunho, sem evento no
  histórico). O financeiro não viu nada (filtro "Prestação de Contas" em 0,
  "Documentos da prestação (0)"), e o envio ficou travado.
- **Depois de pagar:** o envio recusou o boleto sem data, nomeando o
  documento e marcando o campo; completo, foi com R$ 1.716,40 comprovados (o
  boleto fora) e saldo de R$ 1.283,60 — "Prestação enviada" no histórico.
- **Conferência:** os dados abriram sozinhos no documento selecionado; a seta
  fechou a NF, o cupom abriu sozinho e a NF continuou fechada ao voltar. A
  NF corrigida para R$ 1.200,00 refez a soma no banco (R$ 1.736,40 / saldo
  R$ 1.263,60) e gravou a auditoria.
- **Reprovação e reenvio:** com motivo; a correção (CPF do recibo) foi pelo
  cartão da Planilha Interna, e o reenvio gravou "Prestação reenviada".
- **Aprovação:** "Não gera crédito" sem motivo foi recusado; com motivo,
  aprovou com estorno de −R$ 1.263,60 para 26/10. O fornecedor "ZZ FERRAGENS
  TESTE 189 LTDA" (CNPJ fictício de teste) nasceu sem dados de
  pagamento; a NF 4521 entrou no cadastro de notas registrada pela PP-00261
  (R$ 1.200,00, tomador Empresa Teste, sem ISS, sem crédito com o motivo) e
  aparece na memória da COFINS de out/2026 da Empresa Teste. O cupom não
  criou fornecedor.
- **Estorno:** baixado na Conta Teste; a verba ficou "Concluída" na aba de
  PPs, e o dossiê mostra "No fiscal: NF 4521" e "Devolvido em 19/10/2026".
- **Travas do servidor**, numa transação desfeita: o GP não corrige
  documento, o freela de fora do projeto não alcança a PP, e `anon` não
  executa as funções novas.

## Fora daqui

- **Leitura por IA** do documento: vem depois, com a leitura ao anexar da 178,
  estendida para fotos. O botão não aparece.
- O **reembolso** (187) continua sem prestação e sem NF no fiscal.
- **Prazo** para fechar a prestação.
- A assinatura antiga `enviar_prestacao_verba(uuid, jsonb, boolean)` ficou no
  banco para o app que estava no ar até o deploy; tirá-la é mudança
  destrutiva, a pedir.

## No banco

| Objeto | O quê |
|---|---|
| `pp_verba_prestacao_status` | valor novo `rascunho` (migration própria) |
| `pp_verba_prestacoes_anexos` | `documento_data`, `tomador_estabelecimento_id` (FK cadastro de impostos), `emitente_documento` (só dígitos, 11 ou 14), `emitente_nome`, `descricao`, `nota_fiscal_id` (FK notas do fornecedor), `updated_at`; `documento_tipo` e `valor` aceitam nulo (o rascunho); a CHECK de "só NF e recibo" deu lugar à de "boleto e contrato sem valor" |
| `salvar_documento_prestacao_verba` | a produção salva um documento (o arquivo novo cria o rascunho) |
| `remover_documento_prestacao_verba` | tira um documento; o rascunho sem documento some |
| `enviar_prestacao_verba_salva` | o envio único, com a verba paga |
| `corrigir_documento_prestacao_verba` | o financeiro corrige, com a prestação em avaliação |
| `aprovar_prestacao_verba` | ganhou `p_notas` (o crédito de cada NF, com padrão): confere de novo, refaz a soma, registra as NFs e cria o fornecedor que faltar |
| `prestacao_verba_registra_evento` | o rascunho não vira evento; do rascunho para em avaliação é "Prestação enviada" |

As 2 prestações que já existiam (aprovadas) e os 3 documentos delas não
mudaram: os campos novos ficam nulos.
