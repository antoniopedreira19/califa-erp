# 139 — Módulo fiscal, entrega 1: o cadastro de impostos e os dados que alimentam a apuração

**Data:** 2026-10-02
**Decidido por:** Tiago
**Status:** aceita — entregue em 02/10/2026 (a Apuração e os Impostos a Pagar vêm nas próximas entregas)
**Migrations:** `20261002100001_fiscal_cadastro_e_dados_da_nf.sql` e
`20261002100300_fiscal_parametros_selic_e_darf_minimo.sql` (as duas aditivas)

---

## 1. O pedido e o desenho

O Tiago pediu, em 30/09/2026, uma seção **Fiscal** na Central Financeira,
alimentada pelo contas a receber (notas) e pelo contas a pagar (custos dos
jobs e retenções), com a baixa das guias indo para a conciliação. O desenho
fechou em cinco rodadas de protótipo clicável sobre as telas reais
(30/09 a 02/10/2026), com o seletor "Como vai ficar" × "Destacar o que é
novo". A pesquisa tributária está em
`docs/superpowers/specs/2026-10-01-modulo-fiscal-pesquisa-tributaria.md`.

Esta entrega põe no ar **tudo o que alimenta o fiscal**, para que, a partir
de hoje, cada nota e cada PP já entrem com o dado que a Apuração vai usar.

## 2. O que entrou

| Tela | O que muda |
|---|---|
| Cadastros do Financeiro | Card novo **Impostos** (`/financeiro/cadastros/impostos`): CNPJs emissores, CNAEs com subitem da LC 116 e alíquotas com vigência, vencimentos, feriados e parâmetros — carregados com a planilha "IMPOSTOS Ecossistema California". Edita: CNPJ da filial (com dígito e raiz da empresa), dias e regra de vencimento, alíquotas novas a partir de uma data, CNAE novo, feriados e parâmetros. |
| Faturar | "Empresa emissora" passa a se chamar **Empresa (gerencial)**; campo novo **CNPJ emissor** (só os ativos; a Hitlab vem com a Hitlab, os demais com o último usado para o cliente); **Nº NF sugerido pela numeração de cada CNPJ** (maior emitido + 1; as canceladas não contam); **CNAE em lista** só com os vigentes do CNPJ, com o subitem; bloco **Impostos desta nota** (ISS, PIS e COFINS com o vencimento). O servidor confere CNPJ e CNAE antes de emitir e grava os dois na nota (`registrar_fiscal_da_nota`). |
| Envio para faturamento | **CNAE sugerido em lista**, na mesma linha do CNPJ, do valor e do vencimento: o campo mostra o código com o subitem ("82.30-0-01 · 12.08") e a lista abre larga, com a atividade. |
| Aprovação da PP | Na coluna "Dados da PP": o **regime do fornecedor** e o grupo **Nota fiscal do fornecedor** (número do anexo de tipo NF; data de emissão, valor e CNPJ tomador **registrados pelo financeiro**). No pop-up: **Retenções na fonte** (com DARF 5952/1708 e vencimento) e **Crédito de PIS/COFINS**. A Server Action grava a NF (`registrar_nf_da_pp`) e só então aprova; o servidor recusa aprovar PP com anexo de NF sem a NF registrada. |
| Baixa da PP | As retenções decididas na aprovação já chegam preenchidas (editáveis), com "Retenções informadas na aprovação da PP (dd/mm/aaaa)". A baixa em lote aplica as mesmas (decisão 140). |
| Fornecedor | **Regime tributário** (Normal / Simples / MEI) pela consulta do CNPJ, com a declaração do Simples (só a caixa; o arquivo fica para depois). |

## 3. Regras (todas aprovadas pelo Tiago)

- **Os dados da NF do fornecedor são do financeiro**, na aprovação da PP
  (02/10/2026): a produção só informa o número no anexo, como antes. Sem
  data e valor, a aprovação de PP com NF não segue.
- **Crédito de PIS/COFINS:** todo custo de job com NF de fornecedor PJ gera
  crédito no mês da **emissão** da NF (inclusive Simples e MEI); não gera
  quando o CNPJ tomador está no lucro presumido, quando o job é faturado no
  82.30-0-01 · 12.08 (estorno no mês da nota de saída — ⚠️ o Tiago pediu
  para revisar esta regra ao fim da implementação) ou quando o financeiro
  tira, com motivo. Sem nota de saída, "a confirmar".
- **Retenções:** regime normal (ou não informado) → PIS 0,65%, COFINS 3%,
  CSLL 1% (DARF 5952) e IRRF 1,5% (DARF 1708), no mês do pagamento, com
  vencimento no dia 20 do mês seguinte (antecipa); Simples/MEI → sem
  retenção (IN SRF 459); cartão → sem retenção.
- **Vencimentos:** ISS no dia do município do CNPJ (prorroga); PIS/COFINS
  dia 25 (antecipa); retenções federais dia 20 (antecipa).
- **Filiais de São Paulo e Fortaleza** entram inativas e sem CNPJ: o número
  não está no banco nem na planilha. O financeiro informa no cadastro e
  ativa.

## 4. Verificação (02/10/2026, no TES-P001/26)

- **Faturar** (TES-1013/26): CNPJ California · Salvador → 21 CNAEs com os
  subitens 12.08 e 17.10, o sugerido pelo GP marcado; no 12.08, ISS 2%
  R$ 20,00 (05/11), PIS 0,65% e COFINS 3% (25/11) e o aviso de estorno do
  crédito. Nota de teste **TESTE-139** emitida (gravou `estabelecimento_id`,
  `fiscal_cnae_id` e o texto do CNAE) e cancelada pela própria action
  (`cancelarFaturamento`), para não entrar na numeração do CNPJ.
- **Envio** (TES-1008/26, sem enviar): lista com "Nenhum", os 30 códigos e
  os subitens; o campo mostra "82.30-0-01 · 12.08" inteiro.
- **Aprovação**: PP-00110 (TES-1001/26, Fornecedor Teste, R$ 8.000,00, NF
  602 de 01/10/2026) — retenção R$ 492,00 (DARF 5952 R$ 372,00, DARF 1708
  R$ 120,00, vencimento 19/11/2026, porque 20/11 é feriado), líquido
  R$ 7.508,00, crédito R$ 740,00 em outubro/2026. No banco: `nf_*`
  preenchidos e as 4 alíquotas em `pedidos_compra_retencoes`.
- **Baixa da PP-00110**: abre com as quatro alíquotas da aprovação e o
  líquido de R$ 7.508,00.
- **Cadastro de impostos**: as cinco abas; CNPJ da GoCrazy na filial de São
  Paulo recusado ("os CNPJs dela começam com 19.437.976").
- **Fornecedor**: campo "Regime tributário" no formulário.

## 5. Perguntas que ficaram para o Tiago e a contabilidade

1. **Fornecedores sem regime:** os 38 estão sem regime, então toda PP com NF
   abre com retenção ligada — inclusive de Simples e MEI, que o financeiro
   desliga à mão. Preencher todos de uma vez (consulta do CNPJ) ou um botão
   "Consultar" na edição?
2. **Remessa CNAB paga o bruto:** a PP paga pela remessa perde a retenção
   decidida na aprovação (interino da D15, que já valia para a baixa).
   A remessa deveria pagar o líquido?
3. **Nº NF por CNPJ:** nenhuma nota tem CNPJ emissor ainda, então cada CNPJ
   começa sem sugestão. Semear o número inicial de cada um?
4. **Lista do CNAE sugerido** inclui CNAEs que só existem nos CNPJs inativos
   (ex.: 93.19-1-01, de Fortaleza). Mostrar só os dos ativos?
5. **Hitlab:** o cadastro lista a Hitlab no ISS retido e nas DARF de
   retenção. A Hitlab retém?
6. **Cadastro:** vigência no passado é aceita com aviso — bloquear? O feriado
   de Santo André "a confirmar" não está no banco.
7. **Anexos marcados como NF:** dos 23 anexos de PPs em avaliação, só 2
   têm o tipo NF; sem o tipo, o grupo da NF não aparece na aprovação.

## 6. Fica para as próximas entregas

Apuração e Impostos a Pagar (com baixa, multa e juros, guia e comprovante,
rateio por empresa e regional e as sublinhas na conciliação); IRPJ/CSLL
trimestral; Hitlab pelo recebimento; o bloco "No fiscal" nas baixas; o
fluxo de caixa e o card da Central; o que o fiscal muda no formulário de
abertura do job (pendência pedida pelo Tiago); o botão "Novo CNPJ
emissor"; o arquivo da declaração do Simples. As 14 perguntas para a
contabilidade seguem como pendência.
