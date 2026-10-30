# Histórico financeiro — extração, padronização e validação da planilha

Importação do histórico da planilha "Fin. Conta Califórnia" (Google Sheets),
decisão 211. Aqui ficam as etapas que rodam fora do sistema, até o pacote de
carga; a carga no banco é pela tela Financeiro › Cadastros › Histórico da
planilha.

## Onde ficam os dados

Nada com dado da planilha vai para o git. A pasta de trabalho é
`tmp/historico-planilha/` (ignorada), uma subpasta por versão da planilha:

```
tmp/historico-planilha/
  sistema/                 retrato do sistema para o de-para (só nomes)
  depara/                  de-para aprovado: vale para todas as versões
  versoes/AAAA-MM-DD/
    origem.xlsx            a planilha baixada do Google Sheets
    bruto/                 E1: um CSV por aba + manifesto.json
    padronizado/           E2: movimentos, previsões, notas, jobs, pendências, propostas/
    validacao/             E3: relatorios.csv, saldos.csv, faturamento.csv, resumo.json;
                           A4: dre.csv, regional.csv, regional-fechamento.csv,
                           rentabilidade.csv e faturamento-dos-jobs.csv
                           (e as variantes do padronizado)
    revisao-e2.xlsx        pendências e de-para para revisar
    cargas/                A1: os pacotes de carga (.json) para a tela
```

## Como rodar

```bash
T=tmp/historico-planilha
V=$T/versoes/2026-10-25
npx tsx scripts/historico-financeiro/extrair.ts "$V/origem.xlsx" "$V"
npx tsx scripts/historico-financeiro/padronizar.ts "$V" "$T/sistema"
npx tsx scripts/historico-financeiro/aprovar-depara.ts "$V" "$T/depara"
npx tsx scripts/historico-financeiro/padronizar.ts "$V" "$T/sistema" "$T/depara"
npx tsx scripts/historico-financeiro/validar.ts "$V"
npx tsx scripts/historico-financeiro/revisao.ts "$V"
npx tsx scripts/historico-financeiro/empacotar.ts "$V" --carga "1ª carga"
npx tsx scripts/historico-financeiro/empacotar.ts "$V" --cauda
npx tsx scripts/historico-financeiro/conferir-dre.ts "$V"
npx tsx scripts/historico-financeiro/conferir-rentabilidade.ts "$V" --padronizado --com-previsoes
npx tsx scripts/historico-financeiro/conferir-faturamento.ts "$V"
npx tsx scripts/historico-financeiro/conferir-regional.ts "$V" --padronizado --com-previsoes \
  --fechamento "$T/fechamento-2026-10-26/origem.xlsx"
```

Uma carga pequena, para testar a tela, sai com `--nome`, o período e as
contas: `--nome "Teste" --de 2023-01-01 --ate 2023-01-31 --conta "BB California"`.

Cada etapa leva segundos. Uma versão nova da planilha (o 3T fechado, por
exemplo) é outra pasta em `versoes/`, com os mesmos comandos. A aprovação do
de-para só acrescenta os textos novos daquela versão; o que já está na pasta
`depara/` continua valendo.

O retrato do sistema (`sistema/*.txt`) sai do banco pelo MCP: clientes com as
marcas, plano de contas, serviços, regionais, contas e os jobs abertos. O
`LEIA-ME.md` da pasta diz o formato de cada arquivo.

## O que cada etapa faz

- **E1, `extrair.ts`:** lê o .xlsx em fluxo (zip e XML, sem carregar tudo) e
  escreve cada aba como a planilha mostrava: o resultado das fórmulas, datas em
  `AAAA-MM-DD`, erros como texto (`#REF!`). A primeira coluna é a linha da
  planilha.
- **E2, `padronizar.ts`:** aplica as regras de `lib/historico-financeiro/`
  (Tipo, valor, data, empresa, regional, job) e escreve:
  - `movimentos.csv` — linhas realizadas das contas, com a carga (`1ª carga`,
    `3T 2026`, `anterior a 2023`, `depois do corte`); o crédito e o débito
    originais vão junto, com sinal, e as colunas "DRE EXTRA" e "Ano Comp.";
  - `previsoes.csv` — linhas com data depois da exportação;
  - `notas.csv` (com a classe: job, distribuição de lucro ou sem job) e
    `jobs.csv` (com `fora_do_resultado`: a Copa sem lançamento; e, desde a
    A4, a divisão do job entre as regionais, `rateio_regional`, do grupo
    "RATEIO %", a alíquota teórica, `imposto_teorico_percentual`, da coluna
    "Imp Real %", e o percentual de fee, `fee_percentual`, da coluna logo
    depois de "FEE LÍQUIDO");
  - `pendencias.csv` — o que não fecha nas cargas que vão ao banco (a
    primeira e o 3T), com a carga de cada pendência; as dos jobs e as de data
    inválida ficam sem carga;
  - `propostas/` — de-para proposto, com a forma como foi achado (igual,
    parecido, ambíguo, sem par);
  - `resumo.json` — contagens por aba, carga e pendência.
- **De-para, `aprovar-depara.ts`:** leva as propostas para `depara/` pela regra
  aprovada (vale o igual, o parecido, o achado pela sigla ou pela marca e o
  geral; o ambíguo e o sem par ficam como texto). Para mudar uma decisão,
  edite o CSV da pasta.
- **E3, `validar.ts`:** refaz cada SUMIFS das abas DRE e Gerencial (com o
  rateio: a soma do TD vezes o percentual da célula) sobre o bruto e sobre o
  padronizado e compara com a planilha; confere movimento e saldo das contas
  mês a mês e o faturamento por mês. No `relatorios.csv`, a coluna `detalhe`
  diz qual coluna faltou quando a célula não se refaz no padronizado. O
  `resumo.json` da validação traz as contagens por situação (DRE e Gerencial
  separadas) e o saldo da planilha no fim de 12/2025, 06/2026 e 09/2026 por
  conta.
- **Revisão, `revisao.ts`:** junta pendências e propostas num .xlsx com a
  coluna "Sua decisão". Amarelo pede conferência; cinza é cliente ou marca sem
  cadastro, que fica como texto no histórico.
- **Pacote, `empacotar.ts`:** junta num .json o que uma carga leva — os
  movimentos e as notas do período, os jobs das abas de resultado, o rateio
  lido das células das abas Gerencial e os saldos do fim de cada mês — com as
  linhas e as somas declaradas. O contrato das colunas está em
  `lib/historico-financeiro/pacote.ts`, o mesmo da tela e do servidor, e o
  script confere o pacote como eles vão conferir.
- **Cauda, `empacotar.ts --cauda` (A6):** depois do corte, do dia 01/10 até
  o dia em que a planilha foi baixada, só os movimentos e as notas dos jobs
  até o 3T de 2026 (ou de ano anterior) que não existem no sistema (sem
  `job_sistema` no de-para). O resto de outubro entra pelo sistema. A cauda
  nova substitui a ativa, qualquer que seja o período.
- **Só DRE, `empacotar.ts --so-dre`:** as linhas de outubro já pagas pelo
  sistema (PP baixada, tarifa lançada pela regra), listadas em
  `<versão>/so-dre/linhas.json`. Contam no resultado e não no saldo: o DRE lê
  todas as cargas ativas, e o saldo, o extrato e a conciliação só as de tipo
  `cauda`. A mesma linha não pode estar na cauda e no só DRE: o empacotador e
  o banco recusam.
- **Carga, na tela:** Financeiro › Cadastros › Histórico da planilha (admin e
  financeiro). Ela lê o pacote no navegador, avisa as contas que faltam
  cadastrar e envia em partes; o banco liga os textos aos cadastros, confere
  período, linhas e somas, e substitui a carga ativa do mesmo período.
- **DRE, `conferir-dre.ts`:** monta a DRE do histórico como a tela de
  Relatórios monta (`lib/historico-financeiro/dre.ts`) e compara, linha a
  linha e trimestre a trimestre, com o total das abas DRE da planilha. Por
  padrão lê o pacote da 1ª carga, com cada linha em centavos como o banco
  guarda; com `--padronizado` lê o padronizado inteiro (ou um período, com
  `--de` e `--ate`), e com `--com-previsoes` soma também as previsões, como a
  planilha. Quando uma linha difere, o terminal mostra de quais contas veio o
  valor.
- **Resultado por regional, `conferir-regional.ts`:** monta o resultado por
  regional como a tela monta (`lib/historico-financeiro/regional.ts`) e
  compara, trimestre a trimestre e regional a regional, com as células das
  abas Gerencial em que a planilha segue a mesma fonte (o custo fixo e o
  pessoal da regional e do TD, o imobilizado e o PL); marca à parte os
  trimestres em que a planilha divide o TD por 4. Com `--fechamento`, compara
  também o faturamento, o imposto teórico, o custo operacional e o benefício
  de cada regional com a DRE regional do Fechamento (as abas "DRE Califa
  Regional" e "DRE CMH Regional"), e as linhas do bloco dos projetos
  proprietários; a soma divide o REC e o CO pelos jobs e marca os projetos
  como a função do banco.
- **Rentabilidade dos jobs, `conferir-rentabilidade.ts`:** refaz, job a job,
  as colunas TOTAL RECEITA, IMPOSTO, TOTAL CO, RESULTADO, FEE LÍQUIDO e
  RENTABILIDADE das abas Res. Jobs (`lib/historico-financeiro/rentabilidade.ts`)
  e compara com a linha do job na aba mais nova dele. Com `--com-previsoes`,
  o imposto conta também as notas a emitir, como a planilha.
- **Faturamento dos jobs, `conferir-faturamento.ts`:** a planilha não tem
  coluna de faturado; o script refaz, em cada linha de job, o SUMIFS da coluna
  IMPOSTO (as mesmas abas de Faturamento e o mesmo critério) com o Valor das
  notas emitidas no período da carga e com o das que têm data de recebimento,
  e compara com as notas do pacote ligadas ao job
  (`lib/historico-financeiro/faturamento.ts`).
- As opções de fonte das conferências estão em `movimentos-para-conferir.ts`,
  que traz também os jobs e os impostos das notas da mesma fonte.

## Testes

```bash
node --import tsx --test lib/historico-financeiro/extracao.test.ts lib/historico-financeiro/regras.test.ts lib/historico-financeiro/formulas.test.ts lib/historico-financeiro/pacote.test.ts lib/historico-financeiro/dre.test.ts lib/historico-financeiro/regional.test.ts lib/historico-financeiro/rentabilidade.test.ts lib/historico-financeiro/faturamento.test.ts
```
