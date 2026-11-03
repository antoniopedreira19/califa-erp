import { test } from "node:test";
import assert from "node:assert/strict";
import { guiasDoIofDoMutuo, saldoDoMutuoNoDia, vencimentoDoIof, type MutuoDoIof } from "./iof-mutuo";

const FERIADOS = [{ data: "2026-10-12", nome: "Nossa Senhora Aparecida", abrangencia: "nacional", municipio: null }] as never[];

const base: Omit<MutuoDoIof, "credor_id" | "credor_nome" | "saidas" | "devolucoes"> = {
  empresa_id: "e",
  empresa_nome: "Agência California",
  regional_id: null,
  regional_nome: null,
  com: "Community",
};

const goc: MutuoDoIof = { ...base, credor_id: "goc", credor_nome: "GoCrazy", saidas: [{ data: "2025-07-09", valor: 1_500_000, juros: null }], devolucoes: [] };
const cal: MutuoDoIof = {
  ...base,
  credor_id: "cal",
  credor_nome: "California",
  saidas: [
    { data: "2026-06-10", valor: 500_000, juros: null },
    { data: "2026-07-02", valor: 500_000, juros: null },
  ],
  devolucoes: [],
};

test("sem juros, outubro dá os valores combinados, sem adicional", () => {
  const [a, b] = guiasDoIofDoMutuo([goc, cal], "2026-10", FERIADOS);
  assert.equal(a.apurado, 3_813);
  assert.equal(b.apurado, 2_542);
  assert.equal(a.chave, "iof|goc|2026-10");
  assert.equal(a.base, 46_500_000);
  assert.equal(a.tributo, "IOF");
  assert.equal(a.rateio[0].pct, 100);
  assert.ok(!a.memoria.some((m) => m.rotulo.startsWith("Adicional")));
});

test("o que sai no mês paga o adicional de 0,38%, e o saldo conta desde o dia", () => {
  const m: MutuoDoIof = { ...cal, saidas: [{ data: "2026-10-31", valor: 100_000, juros: null }] };
  const [g] = guiasDoIofDoMutuo([m], "2026-10", FERIADOS);
  assert.equal(g.base, 100_000);
  assert.equal(g.apurado, 388.2);
  assert.ok(g.memoria.some((x) => x.rotulo.startsWith("Adicional") && x.valor === 380));
});

test("os juros entram na base e no que aumentou o saldo", () => {
  const m: MutuoDoIof = { ...cal, saidas: [{ data: "2026-09-30", valor: 1_000_000, juros: 1 }] };
  assert.ok(Math.abs(saldoDoMutuoNoDia(m, "2026-10-30") - 1_010_000) < 0.01);
  const [g] = guiasDoIofDoMutuo([m], "2026-10", FERIADOS);
  assert.ok(g.base > 31_000_000);
  assert.ok(g.memoria.some((x) => x.rotulo.startsWith("Adicional")));
  assert.ok(g.memoria[0].detalhe?.includes("juros de 1% ao mês"));
});

test("a devolução reduz o saldo desde o dia, e sem saldo não há guia", () => {
  const voltou: MutuoDoIof = { ...goc, devolucoes: [{ data: "2026-09-30", valor: 1_500_000 }] };
  assert.equal(saldoDoMutuoNoDia(voltou, "2026-10-01"), 0);
  assert.deepEqual(guiasDoIofDoMutuo([voltou], "2026-10", FERIADOS), []);
});

test("duas outras partes do mesmo CNPJ cabem numa guia só", () => {
  const outra: MutuoDoIof = { ...goc, com: "Outra", saidas: [{ data: "2026-01-01", valor: 500_000, juros: null }] };
  const guias = guiasDoIofDoMutuo([goc, outra], "2026-10", FERIADOS);
  assert.equal(guias.length, 1);
  assert.equal(guias[0].apurado, 5_084);
});

test("vence no 3º dia útil depois do dia 10", () => {
  assert.equal(vencimentoDoIof("2026-10", FERIADOS), "2026-11-13");
  assert.equal(vencimentoDoIof("2026-09", FERIADOS), "2026-10-15");
});
