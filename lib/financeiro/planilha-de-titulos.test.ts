/**
 * Testes da planilha de títulos (decisão 195): a coluna do valor pela regra
 * do banco, as siglas e o "TD" da regional, o saldo previsto, os totais e a
 * data da linha.
 *
 * Rode com:  node --import tsx --test lib/financeiro/planilha-de-titulos.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  agruparPorDia,
  casaVencimento,
  centrosDosItens,
  colunaDoValor,
  comSaldoPrevisto,
  dataEfetiva,
  efeitoNaConta,
  fimDoMes,
  rateioPonderado,
  situacaoDaData,
  siglaDaRegional,
  textoDaRegional,
  totalDaPlanilha,
  trimestreDe,
  type ItemDaFatura,
  type LinhaDaPlanilha,
} from "./planilha-de-titulos";

const HOJE = "2026-10-20";
const CONTA = "conta-santander";
const OUTRA = "conta-investimento";

function linha(p: Partial<LinhaDaPlanilha> & { chave: string }): LinhaDaPlanilha {
  return {
    lado: "pagar",
    origem: "pp",
    dataPrevista: HOJE,
    vencimento: HOJE,
    pagoEm: null,
    entra: false,
    transferencia: null,
    contaFixa: null,
    valor: { bruto: 100, estornado: 0, retencoes: [], baixado: 0, conta: 100 },
    descricao: p.chave,
    etiqueta: { texto: "PP", tom: "neutro" },
    complementos: [],
    bv: false,
    contraparte: "Fornecedor",
    job: null,
    jobsDaFatura: [],
    itensDaFatura: [],
    centro: { tipo: "definir_na_baixa" },
    empresa: "Agência California",
    rateio: [],
    status: "a_pagar",
    cartaoPrevisto: null,
    editaData: true,
    urgente: null,
    avisoDaContraparte: null,
    situacaoDaVerba: null,
    busca: "",
    ...p,
  };
}

const transferencia = linha({
  chave: "transf",
  lado: "transferencia",
  origem: "transferencia",
  transferencia: { origemContaId: CONTA, destinoContaId: OUTRA, origemNome: "Santander", destinoNome: "Investimento" },
  valor: { bruto: 150_000, estornado: 0, retencoes: [], baixado: 0, conta: 150_000 },
});

// ---------------------------------------------------------------------------
// A coluna do valor (o equivalente a `celulaDoModulo` com a regra "banco")
// ---------------------------------------------------------------------------

test("a pagar vai no Débito e a receber no Crédito", () => {
  assert.equal(colunaDoValor(linha({ chave: "a" }), null).coluna, "debito");
  assert.equal(colunaDoValor(linha({ chave: "b", lado: "receber", origem: "nf", entra: true }), null).coluna, "credito");
  assert.equal(colunaDoValor(linha({ chave: "c", lado: "imposto", origem: "imposto" }), CONTA).coluna, "debito");
});

test("o estorno de verba mora em Contas a Pagar e entra como crédito", () => {
  const verba = linha({ chave: "v", origem: "verba", entra: true });
  assert.deepEqual(colunaDoValor(verba, null), { coluna: "credito", foraDoTotal: false });
});

test("a transferência: nas duas colunas e fora do total no módulo; na conta, a perna dela", () => {
  assert.deepEqual(colunaDoValor(transferencia, null), { coluna: "ambas", foraDoTotal: true });
  assert.equal(colunaDoValor(transferencia, CONTA).coluna, "debito");
  assert.equal(colunaDoValor(transferencia, OUTRA).coluna, "credito");
});

test("os totais do módulo deixam a transferência e o pago de fora", () => {
  const linhas = [
    linha({ chave: "p1", valor: { bruto: 300, estornado: 0, retencoes: [], baixado: 0, conta: 300 } }),
    linha({ chave: "v", origem: "verba", entra: true, valor: { bruto: 40, estornado: 0, retencoes: [], baixado: 0, conta: 40 } }),
    linha({ chave: "pago", pagoEm: "2026-10-10", valor: { bruto: 999, estornado: 0, retencoes: [], baixado: 999, conta: 999 } }),
    transferencia,
  ];
  assert.deepEqual(totalDaPlanilha(linhas, null), { credito: 40, debito: 300, transferencias: 150_000 });
});

test("os totais da conta seguem o efeito no saldo (a transferência conta na perna da conta)", () => {
  const linhas = [linha({ chave: "p1" }), transferencia];
  assert.deepEqual(totalDaPlanilha(linhas, CONTA), { credito: 0, debito: 150_100, transferencias: 0 });
  assert.deepEqual(totalDaPlanilha(linhas, OUTRA), { credito: 150_000, debito: 100, transferencias: 0 });
});

test("o rendimento de outra conta não mexe no saldo desta", () => {
  const rendimento = linha({ chave: "r", lado: "receber", origem: "rendimento", entra: true, contaFixa: OUTRA });
  assert.equal(efeitoNaConta(rendimento, CONTA), 0);
  assert.equal(efeitoNaConta(rendimento, OUTRA), 100);
});

// ---------------------------------------------------------------------------
// A regional
// ---------------------------------------------------------------------------

test("as siglas do cadastro: as de 2 letras ficam, as outras viram 3", () => {
  assert.equal(siglaDaRegional("NE"), "NE");
  assert.equal(siglaDaRegional("SS"), "SS");
  assert.equal(siglaDaRegional("Doca"), "DOC");
  assert.equal(siglaDaRegional("Agency"), "AGE");
  assert.equal(siglaDaRegional("Hitlab"), "HIT");
  assert.equal(siglaDaRegional("Teste"), "TES");
  assert.equal(siglaDaRegional("Teste 2"), "TE2");
  assert.equal(siglaDaRegional("Teste 3"), "TE3");
  assert.equal(siglaDaRegional("AMBEV"), "AMB");
  assert.equal(siglaDaRegional("Ventura"), "VEN");
});

test("uma regional mostra a sigla; o rateio mostra TD e a regra na dica", () => {
  assert.deepEqual(textoDaRegional([{ regional: "Hitlab", percentual: 100 }]), {
    texto: "HIT",
    dica: "Hitlab · 100%",
    rateado: false,
  });
  assert.deepEqual(
    textoDaRegional([
      { regional: "SP", percentual: 40 },
      { regional: "NE", percentual: 60 },
    ]),
    { texto: "TD", dica: "Rateio: NE 60% · SP 40%", rateado: true },
  );
  assert.deepEqual(textoDaRegional([]), { texto: "—", dica: null, rateado: false });
});

test("a mesma regional em duas empresas (guia de imposto) soma numa parte só", () => {
  const r = textoDaRegional([
    { regional: "NE", percentual: 35 },
    { regional: "NE", percentual: 35 },
    { regional: "SP", percentual: 30 },
  ]);
  assert.equal(r.dica, "Rateio: NE 70% · SP 30%");
  assert.deepEqual(textoDaRegional([{ regional: "NE", percentual: 50 }, { regional: "NE", percentual: 50 }]).texto, "NE");
});

test("o rateio dos itens da fatura é ponderado pelo valor", () => {
  const r = rateioPonderado([
    { valor: 300, rateio: [{ regional: "NE", percentual: 100 }] },
    { valor: 100, rateio: [{ regional: "SP", percentual: 100 }] },
    { valor: -50, rateio: [] },
  ]);
  assert.deepEqual(r, [
    { regional: "NE", percentual: 75 },
    { regional: "SP", percentual: 25 },
  ]);
});

test("os centros da fatura somam por centro, do maior para o menor", () => {
  const item = (id: string, valor: number, completo: string | null): ItemDaFatura => ({
    id,
    data: HOJE,
    valor,
    descricao: id,
    tipo: "avulso",
    codigo: null,
    fornecedor: null,
    job: null,
    centro: completo ? { rotulo: completo.slice(0, 2), completo } : null,
    empresa: null,
    rateio: [],
  });
  assert.deepEqual(
    centrosDosItens([
      item("a", 100, "04 · Custo Fixo · Internet"),
      item("b", 300, "02 · Custo Operacional"),
      item("c", -20, "04 · Custo Fixo · Internet"),
    ]),
    [
      { rotulo: "02 · Custo Operacional", valor: 300 },
      { rotulo: "04 · Custo Fixo · Internet", valor: 80 },
    ],
  );
});

// ---------------------------------------------------------------------------
// Datas e saldo previsto
// ---------------------------------------------------------------------------

test("o trimestre", () => {
  assert.equal(trimestreDe("2026-01-31"), "T1");
  assert.equal(trimestreDe("2026-06-30"), "T2");
  assert.equal(trimestreDe("2026-07-01"), "T3");
  assert.equal(trimestreDe("2026-10-20"), "T4");
});

test("o vencido entra como hoje; o pago, na data da baixa", () => {
  assert.equal(dataEfetiva(linha({ chave: "a", dataPrevista: "2026-09-24" }), HOJE), HOJE);
  assert.equal(dataEfetiva(linha({ chave: "b", dataPrevista: "2026-10-27" }), HOJE), "2026-10-27");
  assert.equal(dataEfetiva(linha({ chave: "c", pagoEm: "2026-10-01", dataPrevista: "2026-10-27" }), HOJE), "2026-10-01");
});

test("a data conta o atraso pelo vencimento do documento", () => {
  assert.deepEqual(situacaoDaData(linha({ chave: "a", vencimento: "2026-09-24", dataPrevista: "2026-09-24" }), HOJE), {
    tipo: "vencido",
    dias: 26,
  });
  assert.deepEqual(situacaoDaData(linha({ chave: "b", vencimento: "2026-10-22", dataPrevista: "2026-10-25" }), HOJE), {
    tipo: "depois_do_vencimento",
    vencimento: "2026-10-22",
  });
  assert.deepEqual(situacaoDaData(linha({ chave: "c", vencimento: "2026-10-30", dataPrevista: "2026-10-25" }), HOJE), {
    tipo: "antes_do_vencimento",
    vencimento: "2026-10-30",
  });
  assert.deepEqual(situacaoDaData(linha({ chave: "d", vencimento: "2026-10-30", dataPrevista: "2026-10-30" }), HOJE), {
    tipo: "em_dia",
  });
});

test("o saldo previsto corre na ordem da data, com o que entra antes do que sai no mesmo dia", () => {
  const linhas = [
    linha({ chave: "sai", dataPrevista: "2026-10-22", valor: { bruto: 500, estornado: 0, retencoes: [], baixado: 0, conta: 500 } }),
    linha({
      chave: "entra",
      lado: "receber",
      origem: "nf",
      entra: true,
      dataPrevista: "2026-10-22",
      valor: { bruto: 200, estornado: 0, retencoes: [], baixado: 0, conta: 200 },
    }),
    linha({ chave: "vencido", dataPrevista: "2026-09-30", valor: { bruto: 50, estornado: 0, retencoes: [], baixado: 0, conta: 50 } }),
  ];
  const r = comSaldoPrevisto(linhas, 1_000, CONTA);
  assert.deepEqual(
    r.map((l) => [l.chave, l.saldo]),
    [
      ["vencido", 950],
      ["entra", 1_150],
      ["sai", 650],
    ],
  );
});

test("agrupar por dia junta o vencido no dia de hoje", () => {
  const linhas = [
    linha({ chave: "v1", dataPrevista: "2026-09-30" }),
    linha({ chave: "v2", dataPrevista: "2026-10-19" }),
    linha({ chave: "h", dataPrevista: HOJE }),
    linha({ chave: "f", dataPrevista: "2026-10-27" }),
  ];
  assert.deepEqual(
    agruparPorDia(linhas, HOJE).map((g) => [g.data, g.linhas.length]),
    [
      [HOJE, 3],
      ["2026-10-27", 1],
    ],
  );
});

test("o filtro de vencimento e o fim do mês", () => {
  assert.equal(casaVencimento("2026-10-19", "vencidos", HOJE), true);
  assert.equal(casaVencimento(HOJE, "vencidos", HOJE), false);
  assert.equal(casaVencimento(HOJE, "ate_hoje", HOJE), true);
  assert.equal(casaVencimento("2026-10-27", "proximos_7", HOJE), true);
  assert.equal(casaVencimento("2026-10-28", "proximos_7", HOJE), false);
  assert.equal(casaVencimento(null, "todos", HOJE), true);
  assert.equal(fimDoMes(HOJE), "2026-10-31");
  assert.equal(fimDoMes("2026-02-10"), "2026-02-28");
});
