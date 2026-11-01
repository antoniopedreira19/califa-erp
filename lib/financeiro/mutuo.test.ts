import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cnpjNoHistorico,
  iofDoPar,
  jurosCompostos,
  jurosDaAbertura,
  mutuoDaLinha,
  previstoDe,
  quemDeve,
  saldoDepois,
  saldosDosPares,
  trimestrePadrao,
  type ContextoDoMutuoNaConta,
  type DadosDoMutuo,
  type MutuoDaLista,
} from "./mutuo";

const CAL = "ec:cal";
const GOC = "ec:goc";
const HIT = "ec:hit";
const CMT = "f:cmt";

const base: DadosDoMutuo = {
  hoje: "2026-10-30",
  contas: [
    { id: "c-cal", nome: "California Santander", banco: "Santander", parte: CAL },
    { id: "c-goc", nome: "Santander GoCrazy", banco: "Santander", parte: GOC },
    { id: "c-hit", nome: "Santander Hitlab", banco: "Santander", parte: HIT },
  ],
  partes: [
    { chave: CAL, nome: "California", deFora: false },
    { chave: GOC, nome: "GoCrazy", deFora: false },
    { chave: HIT, nome: "Hitlab", deFora: false },
    { chave: CMT, nome: "Community", deFora: true },
  ],
  aberturas: [
    { id: "a1", credor: GOC, devedor: CAL, valor: 4_000, dataReferencia: "2026-09-30", trimestre: 1, ano: 2026, nota: null, juros: null, saidas: [], iofPago: 0 },
    { id: "a2", credor: GOC, devedor: CMT, valor: 1_500, dataReferencia: "2026-09-30", trimestre: 3, ano: 2025, nota: null, juros: null, saidas: [], iofPago: 0 },
  ],
  mutuos: [],
  iofs: [],
  guiasAbertas: [],
};

const mutuo = (m: Partial<MutuoDaLista>): MutuoDaLista => ({
  id: "m",
  codigo: "MU-00001",
  origemId: "c-goc",
  destinoId: "c-cal",
  fornecedorId: null,
  valor: 800,
  data: "2026-10-20",
  descricao: null,
  status: "transferida",
  juros: null,
  trimestre: 1,
  ano: 2026,
  pernas: [],
  ...m,
});

test("o saldo soma a abertura e os mútuos feitos, nos dois sentidos", () => {
  const d = { ...base, mutuos: [mutuo({}), mutuo({ id: "n", codigo: "MU-00002", origemId: "c-cal", destinoId: "c-goc", valor: 300 })] };
  const par = saldosDosPares(d).find((p) => p.a === CAL);
  assert.equal(par?.saldo, 4_500);
  assert.equal(quemDeve(d, par!, par!.saldo), "California deve à GoCrazy");
});

test("o mútuo a transferir não mexe no saldo", () => {
  const d = { ...base, mutuos: [mutuo({ status: "a_transferir" })] };
  assert.equal(saldosDosPares(d).find((p) => p.a === CAL)?.saldo, 4_000);
});

test("a empresa de fora vem depois dos pares do grupo", () => {
  const pares = saldosDosPares(base);
  assert.deepEqual(pares.map((p) => p.a), [CAL, CMT]);
  assert.equal(pares[1].saldo, 1_500);
});

test("a volta da empresa de fora zera o saldo com uma perna só", () => {
  const d = { ...base, mutuos: [mutuo({ origemId: null, destinoId: "c-goc", fornecedorId: "cmt", valor: 1_500 })] };
  const par = saldosDosPares(d).find((p) => p.a === CMT);
  assert.equal(par?.saldo, 0);
  assert.equal(quemDeve(d, par!, 0), "Sem saldo");
});

test("a prévia do formulário diz quem passa a dever", () => {
  assert.deepEqual(saldoDepois(base, { origem: GOC, destino: CAL, valor: 500 }), { texto: "California deve à GoCrazy", valor: 4_500 });
  assert.deepEqual(saldoDepois(base, { origem: CAL, destino: HIT, valor: 200 }), { texto: "Hitlab deve à California", valor: 200 });
});

test("corrigir ignora o próprio mútuo na prévia", () => {
  const d = { ...base, mutuos: [mutuo({})] };
  assert.equal(saldoDepois(d, { origem: GOC, destino: CAL, valor: 100, ignorar: "m" }).valor, 4_100);
});

test("o trimestre herda o do par, com o ano do Tipo; sem par, o da data", () => {
  assert.deepEqual(trimestrePadrao(base, CMT, GOC, "2026-12-31"), { trimestre: 3, ano: 2025, herdado: true });
  assert.deepEqual(trimestrePadrao(base, CAL, HIT, "2026-10-13"), { trimestre: 4, ano: 2026, herdado: false });
});

test("vazio é sem juros, e os juros são compostos", () => {
  assert.equal(jurosCompostos(1_000, null, "2026-01-01", "2026-10-30"), 0);
  assert.equal(jurosCompostos(1_000, 1, "2026-01-01", "2026-01-31"), 10);
});

test("os juros da abertura contam desde cada saída", () => {
  const saidas = [
    { data: "2026-09-30", valor: 1_000 },
    { data: "2026-10-30", valor: 1_000 },
  ];
  assert.equal(jurosDaAbertura({ juros: 1, saidas }, "2026-10-30"), 10);
  assert.equal(jurosDaAbertura({ juros: null, saidas }, "2026-10-30"), 0);
});

test("o IOF só soma no par informado", () => {
  const d = {
    aberturas: [{ ...base.aberturas[1], iofPago: 100 }],
    iofs: [
      { pagador: GOC, com: CMT, valor: 10 },
      { pagador: CAL, com: CMT, valor: 5 },
      { pagador: GOC, com: null, valor: 99 },
    ],
  };
  assert.equal(iofDoPar(d, CMT, GOC), 110);
  assert.equal(iofDoPar(d, CMT, CAL), 5);
  assert.equal(iofDoPar(d, CAL, GOC), 0);
});

test("a previsão casa pelas mesmas partes e pelo valor", () => {
  const d = { mutuos: [mutuo({ status: "a_transferir", origemId: null, destinoId: "c-goc", fornecedorId: "cmt", valor: 1_500 })] };
  assert.ok(previstoDe(d, { origemId: null, destinoId: "c-goc", fornecedorId: "cmt", valor: 1_500 }));
  assert.equal(previstoDe(d, { origemId: null, destinoId: "c-goc", fornecedorId: "cmt", valor: 1_000 }), undefined);
});

test("o CNPJ do PIX aparece com ou sem pontuação, e número longo não conta", () => {
  assert.equal(cnpjNoHistorico("PIX RECEBIDO 11222333000181"), "11222333000181");
  assert.equal(cnpjNoHistorico("PIX RECEBIDO 11.222.333/0001-81"), "11222333000181");
  assert.equal(cnpjNoHistorico("PAGFOR 1234567890123456"), null);
});

const ctx: ContextoDoMutuoNaConta = {
  parte: CAL,
  pendentes: [{ id: "l2", contaId: "c-goc", contaNome: "Santander GoCrazy", data: "2026-10-21", valor: -600, parte: GOC }],
  cnpjs: { "11222333000181": { chave: CMT, nome: "Community", deFora: true } },
  devedores: { [GOC]: CAL, [CMT]: CMT },
};

test("acha o par em conta de outro CNPJ, até 1 dia", () => {
  const r = mutuoDaLinha(ctx, base.partes, { data: "2026-10-20", valor: 600, historico: "PIX RECEBIDO" }, []);
  assert.equal(r?.par?.id, "l2");
  assert.equal(r?.parte.nome, "GoCrazy");
  assert.equal(mutuoDaLinha(ctx, base.partes, { data: "2026-10-23", valor: 600, historico: "PIX RECEBIDO" }, []), null);
});

test("quem paga e deve está devolvendo", () => {
  const debito = { ...ctx, pendentes: [{ ...ctx.pendentes[0], valor: 600 }] };
  assert.equal(mutuoDaLinha(debito, base.partes, { data: "2026-10-21", valor: -600, historico: "PAGFOR" }, [])?.devolucao, true);
  assert.equal(mutuoDaLinha(ctx, base.partes, { data: "2026-10-21", valor: 600, historico: "PIX" }, [])?.devolucao, false);
  assert.equal(mutuoDaLinha(ctx, base.partes, { data: "2026-10-26", valor: 1_500, historico: "PIX 11222333000181" }, [])?.devolucao, true);
});

test("o par do mesmo CNPJ não é mútuo", () => {
  const mesmo = { ...ctx, pendentes: [{ ...ctx.pendentes[0], parte: CAL }] };
  assert.equal(mutuoDaLinha(mesmo, base.partes, { data: "2026-10-21", valor: 600, historico: "PIX" }, []), null);
});

test("o crédito se reconhece pelo CNPJ do PIX; o débito, não", () => {
  const historico = "PIX RECEBIDO 11222333000181";
  assert.equal(mutuoDaLinha(ctx, base.partes, { data: "2026-10-26", valor: 1_500, historico }, [])?.parte.nome, "Community");
  assert.equal(mutuoDaLinha(ctx, base.partes, { data: "2026-10-26", valor: -1_500, historico }, []), null);
});

test("com mútuo sem linha por perto, não oferece outro", () => {
  const semLinha = [{ data: "2026-10-19", valor: 700, origem: "mutuo_entrada" }];
  assert.equal(mutuoDaLinha(ctx, base.partes, { data: "2026-10-20", valor: 600, historico: "PIX" }, semLinha), null);
});
