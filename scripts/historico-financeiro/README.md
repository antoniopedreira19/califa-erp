# Histórico financeiro — extração, padronização e validação da planilha

Importação do histórico da planilha "Fin. Conta Califórnia" (Google Sheets),
decisão 211. Aqui ficam as etapas que rodam fora do sistema; a carga no banco é
outra entrega.

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
    validacao/             E3: relatorios.csv, saldos.csv, faturamento.csv, resumo.json
    revisao-e2.xlsx        pendências e de-para para revisar
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
```

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
    `jobs.csv` (com `fora_do_resultado`: a Copa sem lançamento);
  - `pendencias.csv` — o que não fecha na primeira carga;
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

## Testes

```bash
node --import tsx --test lib/historico-financeiro/extracao.test.ts lib/historico-financeiro/regras.test.ts lib/historico-financeiro/formulas.test.ts
```
