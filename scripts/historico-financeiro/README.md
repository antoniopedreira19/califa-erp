# Histórico financeiro — extração e padronização da planilha

Importação do histórico da planilha "Fin. Conta Califórnia" (Google Sheets),
decisão 211. Aqui ficam as etapas que rodam fora do sistema; a carga no banco é
outra entrega.

## Onde ficam os dados

Nada com dado da planilha vai para o git. A pasta de trabalho é
`tmp/historico-planilha/` (ignorada), uma subpasta por versão da planilha:

```
tmp/historico-planilha/
  sistema/                 retrato do sistema para o de-para (só nomes)
  versoes/AAAA-MM-DD/
    origem.xlsx            a planilha baixada do Google Sheets
    bruto/                 E1: um CSV por aba + manifesto.json
    padronizado/           E2: movimentos, previsões, notas, jobs, pendências, propostas/
    revisao-e2.xlsx        pendências e de-para para revisar
```

## Como rodar

```bash
V=tmp/historico-planilha/versoes/2026-10-25
npx tsx scripts/historico-financeiro/extrair.ts "$V/origem.xlsx" "$V"
npx tsx scripts/historico-financeiro/padronizar.ts "$V" tmp/historico-planilha/sistema
npx tsx scripts/historico-financeiro/revisao.ts "$V"
```

Cada etapa leva segundos. Uma versão nova da planilha (o 3T fechado, por
exemplo) é outra pasta em `versoes/`, com os mesmos três comandos.

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
    originais vão junto, com sinal;
  - `previsoes.csv` — linhas com data depois da exportação;
  - `notas.csv`, `jobs.csv`;
  - `pendencias.csv` — o que não fecha na primeira carga;
  - `propostas/` — de-para proposto, com a forma como foi achado (igual,
    parecido, ambíguo, sem par);
  - `resumo.json` — contagens por aba, carga e pendência.
- **Revisão, `revisao.ts`:** junta pendências e propostas num .xlsx com a
  coluna "Sua decisão". Amarelo pede conferência; cinza é cliente ou marca sem
  cadastro, que fica como texto no histórico.

## Testes

```bash
node --import tsx --test lib/historico-financeiro/extracao.test.ts lib/historico-financeiro/regras.test.ts
```
