import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataDeRecebimentoDoMes,
  faturamentoPorMes,
  montarFaturamentoMensal,
} from "./faturamento-por-mes";
import { calcularTotaisVersao } from "./versao-totais";

const meses = [
  { id: "m-dez", mes: "2026-12-01" },
  { id: "m-out", mes: "2026-10-01" },
  { id: "m-nov", mes: "2026-11-01" },
];
const grupos = [
  { id: "g-out", mes_id: "m-out" },
  { id: "g-nov", mes_id: "m-nov" },
  { id: "g-dez", mes_id: "m-dez" },
];

test("cada mês fecha pela conta da planilha, na ordem dos meses", () => {
  const itens = [
    { grupo_id: "g-out", tipo_custo: "B" as const, total_orcado: 12000 },
    { grupo_id: "g-nov", tipo_custo: "B" as const, total_orcado: 12000 },
    { grupo_id: "g-dez", tipo_custo: "B" as const, total_orcado: 12000 },
  ];
  const r = faturamentoPorMes(meses, grupos, itens, 12, 19.53);
  assert.deepEqual(r.map((m) => m.mes), ["2026-10-01", "2026-11-01", "2026-12-01"]);
  // O mesmo número da régua do Teste Fee 4T/2026: R$ 16.701,88 por mês.
  assert.deepEqual(r.map((m) => m.faturamento), [16701.88, 16701.88, 16701.88]);
  assert.deepEqual(r.map((m) => m.qtdItens), [1, 1, 1]);
});

test("a soma dos meses bate com o job inteiro (até o centavo)", () => {
  const itens = [
    { grupo_id: "g-out", tipo_custo: "B" as const, total_orcado: 10000 },
    { grupo_id: "g-out", tipo_custo: "A" as const, total_orcado: 3333.33 },
    { grupo_id: "g-nov", tipo_custo: "C" as const, total_orcado: 7777.77 },
    { grupo_id: "g-dez", tipo_custo: "B" as const, total_orcado: 5000, em_save: true },
  ];
  const r = faturamentoPorMes(meses, grupos, itens, 12, 19.53);
  const soma = r.reduce((s, m) => s + m.faturamento, 0);
  const job = calcularTotaisVersao(itens, 12, 19.53).faturamentoPrevisto;
  assert.ok(Math.abs(soma - job) <= 0.03, `${soma} × ${job}`);
});

test("o save do mês fica no mês da linha em save", () => {
  const itens = [
    { grupo_id: "g-out", tipo_custo: "B" as const, total_orcado: 10000 },
    { grupo_id: "g-dez", tipo_custo: "B" as const, total_orcado: 5000, em_save: true },
  ];
  const r = faturamentoPorMes(meses, grupos, itens, 12, 19.53);
  assert.equal(r[0].save, 0);
  assert.equal(r[1].save, 0);
  assert.ok(r[2].save > 0);
  assert.ok(r[2].save <= r[2].faturamento);
});

test("mês vazio fatura zero; item de grupo sem mês não entra", () => {
  const itens = [{ grupo_id: "g-sem-mes", tipo_custo: "B" as const, total_orcado: 999 }];
  const r = faturamentoPorMes(meses, [...grupos, { id: "g-sem-mes", mes_id: null }], itens, 12, 19.53);
  assert.deepEqual(r.map((m) => m.faturamento), [0, 0, 0]);
});

test("recebimento cai no dia informado do mês seguinte", () => {
  assert.equal(dataDeRecebimentoDoMes("2026-07-01", 20), "2026-08-20");
  assert.equal(dataDeRecebimentoDoMes("2026-12-01", 5), "2027-01-05");
});

test("dia que o mês seguinte não tem vira o último dia", () => {
  assert.equal(dataDeRecebimentoDoMes("2026-08-01", 31), "2026-09-30");
  assert.equal(dataDeRecebimentoDoMes("2027-01-01", 30), "2027-02-28");
  assert.equal(dataDeRecebimentoDoMes("2028-01-01", 31), "2028-02-29");
});

test("situação de cada mês: a enviar, na fila, parcial, faturado e sem faturamento", () => {
  const itens = [
    { grupo_id: "g-out", tipo_custo: "B" as const, total_orcado: 12000 },
    { grupo_id: "g-nov", tipo_custo: "B" as const, total_orcado: 12000 },
    // Dezembro sem item: nada a faturar. A aprovação recusa mês vazio, mas
    // uma errata pode tirar as linhas depois. (Item A ainda fatura: os
    // honorários incidem sobre ele.)
  ];
  const envio = (id: string, mes: string, valor: number) => ({
    id,
    mes,
    valor_faturado: valor,
    valor_save: 0,
    data_faturamento: mes,
    numero_po: null,
    descricao_nf: null,
    portal_url: null,
    enviado_em: `${mes}T12:00:00Z`,
    parcelas: [
      { id: `${id}-p1`, ordem: 1, valor: valor / 2, data_vencimento: mes },
      { id: `${id}-p2`, ordem: 2, valor: valor / 2, data_vencimento: mes },
    ],
  });
  const nota = (parcela: string, valor: number) => ({
    envio_parcela_id: parcela,
    valor,
    faturamento: { numero_nf: `NF-${parcela}`, data_emissao: "2026-11-05" },
  });
  const base = {
    meses,
    grupos,
    itens,
    percentualHonorarios: 12,
    percentualImposto: 19.53,
  };

  const nada = montarFaturamentoMensal({ ...base, envios: [], itensDeNota: [] });
  assert.deepEqual(nada.map((m) => m.situacao), ["a_enviar", "a_enviar", "sem_faturamento"]);

  const out = 16701.88;
  const naFila = montarFaturamentoMensal({
    ...base,
    envios: [envio("e-out", "2026-10-01", out)],
    itensDeNota: [],
  });
  assert.equal(naFila[0].situacao, "na_fila");

  const parcial = montarFaturamentoMensal({
    ...base,
    envios: [envio("e-out", "2026-10-01", out)],
    itensDeNota: [nota("e-out-p1", out / 2)],
  });
  assert.equal(parcial[0].situacao, "faturado_parcial");
  assert.equal(parcial[0].notas.length, 1);

  const faturado = montarFaturamentoMensal({
    ...base,
    envios: [envio("e-out", "2026-10-01", out)],
    itensDeNota: [nota("e-out-p1", out / 2), nota("e-out-p2", out / 2)],
  });
  assert.equal(faturado[0].situacao, "faturado");
  assert.equal(faturado[0].faturado, out);
  assert.equal(faturado[1].situacao, "a_enviar");
});
