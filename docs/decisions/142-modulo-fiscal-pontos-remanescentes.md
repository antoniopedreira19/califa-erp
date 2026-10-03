# 142 — Módulo fiscal: os pontos remanescentes do protótipo

**Data:** 2026-10-03
**Decidido por:** Tiago ("Faça os pontos remanescentes", 03/10/2026)
**Status:** aceita — entregue em 03/10/2026
**Migration:** `20261002100800_fiscal_fornecedor_consulta_e_declaracao.sql`
(aditiva: duas colunas anuláveis em `fornecedores` e o bucket privado
`fornecedores`)

---

## 1. O pedido

Os quatro pontos do protótipo aprovado (rodadas de 30/09 a 02/10/2026) que
ficaram de fora das entregas 1 e 2 (decisões 139 e 141) e da tarde de 02/10
(141 §6):

1. **"&lt;PJ&gt; · a apurar no recebimento"** na Apuração (hoje, a Hitlab, no
   lucro presumido pelo caixa), e a previsão dele no fluxo de caixa.
2. O botão **"Novo CNPJ emissor"** no cadastro de impostos.
3. O **arquivo da declaração de optante do Simples** no fornecedor.
4. O texto de origem do regime do fornecedor com o **"desde"** e o aviso
   **"Alterado manualmente"** que continua ao reabrir o cadastro.

## 2. O que entrou

| Ponto | Como ficou |
|---|---|
| "&lt;PJ&gt; · a apurar no recebimento" (Apuração e fluxo de caixa) | Para cada PJ no lucro presumido pelo caixa (hoje, a Hitlab), um bloco depois do "ISS a recuperar", em qualquer competência: o texto do protótipo e a tabela Nota · Recebimento previsto · A receber · PIS + COFINS · Vencem em · IRPJ e CSLL, uma linha por título em aberto das notas emitidas por ela (valor menos o já recebido, pela previsão de recebimento; vencida, projetada para amanhã, com "vencida · projetada para dd/mm/aaaa"). PIS + COFINS pelas alíquotas do CNAE da nota na emissão; vencimento pelo dia `pis_cofins_dia` vigente, no mês seguinte ao recebimento, antecipando o dia não útil, no município da matriz. No fluxo de caixa, em Saídas › Só previsão: "Hitlab · a apurar no recebimento · PIS e COFINS da NF X/n" por título e "… IRPJ e CSLL do Nº trimestre/AAAA" (a guia do trimestre com o que falta receber menos a guia em curso, em cotas, pelo próprio motor), rateados pelos jobs. Sem nota da PJ com saldo, nada aparece e nada é consultado. |
| "Novo CNPJ emissor" (cadastro de impostos, aba CNPJs) | O botão vermelho do protótipo abre o mesmo diálogo do lápis (cadastro e edição são o mesmo formulário), com os campos que só a criação tem: Empresa contábil (só as ativas), Tipo (Matriz ou Filial), Município, UF e Nome do estabelecimento (sugerido como "Empresa · Município"). CNPJ com máscara e dígitos verificadores, da mesma raiz da empresa; sem CNPJ, nasce inativo, como na edição. Server Action `criarEstabelecimento` (admin ou financeiro, auditoria `fiscal_estabelecimento.criado`), validação repetida no servidor; o novo entra no fim da lista. Depois, os CNAEs se incluem na aba CNAEs e alíquotas. |
| Arquivo da declaração do Simples (fornecedor) | No Simples, ao lado da caixa "Declaração de optante recebida (IN SRF 459, anexo I)", o campo "Arquivo da declaração" (PDF ou imagem, até 10 MB), no bucket privado `fornecedores` (`<tenant>/declaracoes/`). Sobe na hora; abre por link assinado; o que subiu e não foi salvo sai do bucket ao trocar, tirar ou fechar o formulário. O arquivo já gravado que é trocado ou tirado sai do cadastro e fica no bucket (é o comprovante das PPs pagas sem retenção), com o caminho antigo na auditoria. |
| Origem do regime do fornecedor | A consulta do CNPJ grava o regime que indicou (`regime_consulta`), a data de opção (`regime_desde`) e o dia (`regime_consultado_em`). Embaixo do regime: "Preenchido pela consulta do CNPJ em dd/mm/aaaa · optante do Simples desde mm/aaaa" (ou "· MEI desde mm/aaaa", ou "· não optante do Simples"); trocado à mão, em âmbar, "Alterado manualmente — a consulta do CNPJ em dd/mm/aaaa indicou X." — que continua ao reabrir. Na PP, o "· consulta do CNPJ em" segue só quando a consulta indicou aquele regime. |

## 3. Verificação

Em 03/10/2026, em modo produção local (`next build` + `next start`), no TES:

- **Hitlab:** NF de teste TESTE-142H no TES-1013/26 (R$ 1.000,00, Hitlab ·
  Salvador, CNAE 90.01-9-99). O Faturar mostrou "Lucro Presumido · regime de
  caixa", ISS 5% (R$ 50,00, vence 05/11/2026) e "PIS, COFINS, IRPJ e CSLL
  nascem quando o cliente pagar"; o aviso depois de emitir trouxe "O ISS dela
  já está na Apuração de outubro/2026 (em curso). PIS, COFINS, IRPJ e CSLL
  entram quando o cliente pagar.". Na Apuração, o ISS próprio da Hitlab (R$
  50,00) e o bloco "Hitlab · a apurar no recebimento" com a linha "NF
  TESTE-142H · parcela 1/1 · TES-1013/26 Teste códigos 114 · 30/10/2026 · R$
  1.000,00 · R$ 36,50 · 25/11/2026 · entra na base do 4º trimestre/2026". No
  fluxo de caixa, "… PIS e COFINS da NF TESTE-142H/1" (R$ 37, 25/11/2026) e
  "… IRPJ e CSLL do 4º trimestre/2026" (R$ 77, 29/01/2027); o cronograma de
  impostos do TES-1013/26 caiu de R$ 272 para R$ 77 com a nota e voltou com o
  cancelamento (nada conta duas vezes). A NF foi cancelada pela action; os
  itens sumiram.
- **Novo CNPJ emissor:** o diálogo, a empresa California levando a Filial
  (Matriz desligada) com a dica da matriz e a raiz do CNPJ no exemplo; o
  município "sao paulo" virando "São Paulo" e o nome "California · São
  Paulo"; as mensagens de nome repetido, CNPJ de outra raiz, CNPJ já
  cadastrado, dígitos errados e CNPJ incompleto. Cancelado: nada gravado (5
  estabelecimentos, nenhum evento de criação).
- **Fornecedor (FORNECEDOR TESTE LTDA):** no Simples, a caixa e o "Arquivo
  da declaração"; o PDF subido e abandonado pelo "Voltar" saiu do bucket;
  salvo com o arquivo, gravou o caminho e a auditoria ("anexado"), reabriu
  com o arquivo e o link assinado; desfeito (arquivo tirado, regime Normal),
  com "retirado" e o caminho anterior na auditoria — o PDF de teste ficou no
  bucket, como o desenho manda. No "Novo fornecedor", o CNPJ da própria
  California consultado: "Preenchido pela consulta do CNPJ em 03/10/2026 ·
  não optante do Simples"; trocado para Simples, em âmbar, "Alterado
  manualmente — a consulta do CNPJ em 03/10/2026 indicou regime normal."
  (saída sem salvar).

## 4. Perguntas que ficaram para o Tiago

1. **Novo CNPJ emissor — duas travas do servidor que não vêm do protótipo:**
   uma matriz por empresa contábil, e filial só depois da matriz (os
   impostos federais se apuram pela matriz, e a Apuração e o Faturar usam a
   matriz da PJ). Hoje as três empresas já têm matriz, então o novo CNPJ
   entra sempre como filial. O banco não garante a matriz única (não há
   índice único no papel); se quiser essa garantia, é um índice único
   parcial (aditivo).
2. **Regime de uma empresa contábil nova:** não há tela para informar; o
   diálogo avisa que ela é tratada como Lucro Real.
3. **Declaração do Simples trocada ou tirada:** o arquivo antigo fica no
   bucket (comprovante). Apagar de vez é uma linha na action, se preferir.
4. **Previsão de recebimento vencida no bloco da Hitlab:** a linha usa a
   mesma data do fluxo (amanhã), com "vencida · projetada para dd/mm/aaaa";
   o protótipo nunca teve título vencido. A rotina diária já empurra as
   previsões vencidas, então é raro.
