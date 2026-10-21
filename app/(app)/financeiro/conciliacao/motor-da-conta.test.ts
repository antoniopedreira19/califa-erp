/**
 * Testes da aba Banco da conciliação (decisão 199): o agrupamento dos
 * lançamentos sem linha como o banco os mostra, os dias que o extrato
 * cobre, o texto da linha resolvida, as remessas que ainda casam e as
 * seções.
 *
 * Rode com:  node --import tsx --test "app/(app)/financeiro/conciliacao/motor-da-conta.test.ts"
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { agruparComoNoBanco, diaCoberto, diaCompleto, type LancamentoCru, type LinhaDoBanco } from "./banco-dados";
import { conciliarConta, lotesDoMotor, resolucaoDaLinha, secoesDoBanco, titulosDoMotor } from "./motor-da-conta";
import type { Linha } from "./linhas-da-aba";

const lanc = (id: string, extra: Partial<LancamentoCru> = {}): LancamentoCru => ({
  id,
  data_movimento: "2026-10-19",
  descricao: `Lançamento ${id}`,
  natureza: "saida",
  valor: 100,
  origem: "pp_baixa",
  juros_de_lancamento_id: null,
  imposto_a_pagar_id: null,
  conta_avulsa_id: null,
  pedido_compra_parcela_id: null,
  extrato_linha_id: null,
  fornecedores: { nome: "FORNECEDOR 001 EXEMPLO", razao_social: null },
  ...extra,
});

test("a baixa e os juros dela são um débito só, com os juros à parte", () => {
  const [l] = agruparComoNoBanco(
    [lanc("b", { valor: 500 }), lanc("j", { origem: "juros_baixa", valor: 50, juros_de_lancamento_id: "b" })],
    new Map(),
  );
  assert.equal(l.id, "b");
  assert.deepEqual(l.ids, ["b", "j"]);
  assert.equal(l.valor, -550);
  assert.equal(l.juros, 50);
});

test("as partes de uma guia de imposto são um débito só", () => {
  const g = agruparComoNoBanco(
    [
      lanc("p1", { origem: "imposto_baixa", imposto_a_pagar_id: "imp", valor: 300 }),
      lanc("p2", { origem: "imposto_baixa", imposto_a_pagar_id: "imp", valor: 200 }),
      lanc("outro", { valor: 10 }),
    ],
    new Map(),
  );
  assert.equal(g.length, 2);
  assert.equal(g.find((x) => x.id === "p1")?.valor, -500);
});

test("as baixas dos itens de uma remessa, no mesmo dia, são o débito da remessa", () => {
  const remessa = new Map([
    ["av1", { id: "r1" }],
    ["av2", { id: "r1" }],
  ]);
  const g = agruparComoNoBanco(
    [
      lanc("a", { origem: "avulsa_baixa", conta_avulsa_id: "av1", valor: 1000 }),
      lanc("b", { origem: "avulsa_baixa", conta_avulsa_id: "av2", valor: 2000 }),
      // Outro dia: outra linha do banco.
      lanc("c", { origem: "avulsa_baixa", conta_avulsa_id: "av2", valor: 5, data_movimento: "2026-10-20" }),
    ],
    remessa,
  );
  assert.equal(g.length, 2);
  assert.equal(g[0].valor, -3000);
  assert.equal(g[0].descricao, "2 baixas da remessa, no mesmo dia");
});

test("o dia completo: o arquivo gerado no último dia não o cobre inteiro", () => {
  assert.equal(diaCompleto({ fim: "2026-10-19", geradoDia: "2026-10-20" }), "2026-10-19");
  assert.equal(diaCompleto({ fim: "2026-10-20", geradoDia: "2026-10-20" }), "2026-10-19");
  const periodos = [{ inicio: "2026-10-15", fim: "2026-10-20", geradoDia: "2026-10-20" }];
  assert.equal(diaCoberto("2026-10-15", periodos), true);
  assert.equal(diaCoberto("2026-10-19", periodos), true);
  assert.equal(diaCoberto("2026-10-20", periodos), false);
  assert.equal(diaCoberto("2026-10-14", periodos), false);
});

const linhaDoBanco = (id: string, extra: Partial<LinhaDoBanco> = {}): LinhaDoBanco => ({
  id,
  digital: `c|2026-10-19|${id}`,
  data: "2026-10-19",
  valor: -100,
  historico: "PIX ENVIADO",
  tipo: "DEBIT",
  documento: null,
  ordem: 0,
  conciliada: false,
  ignorada: null,
  resolvidaSozinha: null,
  semAuto: false,
  ligados: [],
  ...extra,
});

test("o texto da linha resolvida", () => {
  assert.equal(resolucaoDaLinha(linhaDoBanco("a")), null);
  const ign = resolucaoDaLinha(linhaDoBanco("a", { ignorada: { em: "2026-10-20T10:00:00Z", motivo: "duplicada no banco" } }));
  assert.equal(ign?.estado, "ignorado");
  assert.equal(ign?.texto, "Ignorada: não entra no extrato do sistema · “duplicada no banco”");
  const manual = resolucaoDaLinha(
    linhaDoBanco("a", {
      conciliada: true,
      resolvidaSozinha: "manual",
      ligados: [{ id: "l", descricao: "PP-00162 · Frete", valor: -100, origem: "pp_baixa" }],
    }),
  );
  assert.equal(manual?.texto, "Baixa feita à mão: “PP-00162 · Frete”");
  assert.equal(manual?.ligados, true);
  const comJuros = resolucaoDaLinha(
    linhaDoBanco("a", {
      conciliada: true,
      ligados: [
        { id: "j", descricao: "Juros e multa", valor: -5, origem: "juros_baixa" },
        { id: "l", descricao: "PP-00163 · Frete", valor: -100, origem: "pp_baixa" },
      ],
    }),
  );
  assert.equal(comJuros?.texto, "Baixa de PP-00163 · Frete");
});

// Uma linha da planilha só com o que o motor lê.
const titulo = (chave: string, valor: number, extra: Record<string, unknown> = {}): Linha =>
  ({
    chave,
    lado: "pagar",
    origem: "avulso",
    dataPrevista: "2026-10-19",
    vencimento: "2026-10-19",
    pagoEm: null,
    entra: false,
    transferencia: null,
    contaFixa: null,
    status: "a_pagar",
    valor: { bruto: valor, estornado: 0, retencoes: [], baixado: 0, conta: valor },
    contraparte: "FORNECEDOR 001 EXEMPLO",
    centro: { tipo: "plano", rotulo: "04 · Custo Fixo", completo: "04 · Custo Fixo · Aluguel" },
    descricao: `Título ${chave}`,
    t: { id: chave.split("|").pop(), origem: "avulso", origem_label: "AVULSO", descricao: `Título ${chave}`, forma_prevista: "pix", forma_pagamento: null, parte_id: null },
    ...extra,
  }) as unknown as Linha;

test("a remessa casa só com todos os títulos em aberto, e o título dela não casa sozinho", () => {
  const linhas = [titulo("pagar|avulso|a", 1000), titulo("pagar|avulso|b", 2000)];
  const ts = titulosDoMotor(linhas, "conta", {}, "2026-10-21");
  const remessas = [{ id: "r1", nome: "remessa nº 12", descricao: "Remessa Santander nº 12", itens: [
    { origemTipo: "avulsa", origemId: "a", valor: 1000 },
    { origemTipo: "avulsa", origemId: "b", valor: 2000 },
  ] }];
  const [lote] = lotesDoMotor(remessas, linhas, ts);
  assert.equal(lote.total, 3000);
  assert.ok(ts.every((t) => t.loteId === "r1"));
  // Com um título já baixado, a remessa não casa mais.
  const ts2 = titulosDoMotor([linhas[0]], "conta", {}, "2026-10-21");
  assert.deepEqual(lotesDoMotor(remessas, [linhas[0]], ts2), []);
});

test("o título sem data conta como de hoje", () => {
  const [t] = titulosDoMotor([titulo("receber|x|1", 50, { dataPrevista: null, vencimento: null })], "conta", {}, "2026-10-21");
  assert.equal(t.vencimento, "2026-10-21");
});

test("as seções: certo em Prontos, sem centro em Conferir, e o que não tem nada em Sem correspondência", () => {
  const linhas = [
    titulo("pagar|avulso|a", 700),
    titulo("pagar|avulso|b", 300, { centro: { tipo: "definir_na_baixa" } }),
  ];
  const banco = {
    linhas: [linhaDoBanco("1", { valor: -700 }), linhaDoBanco("2", { valor: -300, ordem: 1 }), linhaDoBanco("3", { valor: -12.34, ordem: 2 })],
    lancamentos: [],
    remessas: [],
    regras: [],
    periodos: [],
  };
  const { resultados } = conciliarConta(banco, linhas, "conta", {}, "2026-10-21");
  const s = secoesDoBanco(resultados);
  assert.deepEqual(s.alta.map((r) => r.mov.id), ["1"]);
  assert.deepEqual(s.conferir.map((r) => r.mov.id), ["2"]);
  assert.deepEqual(s.sem.map((r) => r.mov.id), ["3"]);
});

test("a baixa feita à mão sem linha, num dia coberto, aparece em 'sem linha no banco'", () => {
  const banco = {
    linhas: [linhaDoBanco("1", { valor: -700 })],
    lancamentos: agruparComoNoBanco([lanc("x", { valor: 450 }), lanc("y", { valor: 700 })], new Map()),
    remessas: [],
    regras: [],
    periodos: [{ inicio: "2026-10-19", fim: "2026-10-19", geradoDia: "2026-10-20" }],
  };
  const { resultados, naoApareceu } = conciliarConta(banco, [], "conta", {}, "2026-10-21");
  assert.equal(resultados[0].estado, "ja_lancado");
  assert.deepEqual(naoApareceu.map((l) => l.id), ["x"]);
});
