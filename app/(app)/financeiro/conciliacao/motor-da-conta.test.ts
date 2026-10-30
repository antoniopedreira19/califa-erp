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

import {
  agruparComoNoBanco,
  diaCoberto,
  diaCompleto,
  remessasJaBaixadas,
  type LancamentoCru,
  type LinhaDoBanco,
} from "./banco-dados";
import {
  automacaoDaLeitura,
  conciliarConta,
  lotesDoMotor,
  resolucaoDaLinha,
  secoesDoBanco,
  textoDosSozinhos,
  titulosDoMotor,
} from "./motor-da-conta";
import type { Linha } from "./linhas-da-aba";

const lanc = (id: string, extra: Partial<LancamentoCru> = {}): LancamentoCru => ({
  id,
  data_movimento: "2026-10-19",
  descricao: `Lançamento ${id}`,
  natureza: "saida",
  valor: 100,
  origem: "pp_baixa",
  forma_pagamento: "pix",
  juros_de_lancamento_id: null,
  imposto_a_pagar_id: null,
  conta_avulsa_id: null,
  pedido_compra_parcela_id: null,
  titulo_receber_id: null,
  desembolso_parcela_id: null,
  pp_verba_devolucao_id: null,
  fatura_cartao_id: null,
  transferencia_id: null,
  extrato_linha_id: null,
  fornecedores: { nome: "FORNECEDOR 001 EXEMPLO", razao_social: null },
  ...extra,
});

test("a baixa e os juros dela são um débito só, com os juros à parte", () => {
  const [l] = agruparComoNoBanco(
    [lanc("b", { valor: 500 }), lanc("j", { origem: "juros_baixa", valor: 50, juros_de_lancamento_id: "b" })],
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
  );
  assert.equal(g.length, 2);
  assert.equal(g.find((x) => x.id === "p1")?.valor, -500);
});

test("as baixas da remessa são um débito cada; o grupo do dia vem à parte (decisão 202)", () => {
  const remessa = new Map([
    ["av1", { id: "r1" }],
    ["av2", { id: "r1" }],
  ]);
  const crus = [
    lanc("a", { origem: "avulsa_baixa", conta_avulsa_id: "av1", valor: 1000 }),
    lanc("b", { origem: "avulsa_baixa", conta_avulsa_id: "av2", valor: 2000 }),
    // Outro dia (o pagamento que falhou e saiu depois): fora do grupo.
    lanc("c", { origem: "avulsa_baixa", conta_avulsa_id: "av2", valor: 5, data_movimento: "2026-10-20" }),
  ];
  const g = agruparComoNoBanco(crus);
  assert.deepEqual(g.map((l) => l.valor), [-1000, -2000, -5]);
  const grupos = remessasJaBaixadas(g, crus, remessa);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].valor, -3000);
  assert.deepEqual(grupos[0].membros, ["a", "b"]);
  assert.equal(grupos[0].descricao, "2 baixas da remessa, no mesmo dia");
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
  avaliada: false,
  ligados: [],
  conciliadaComo: null,
  grupo: null,
  datasTrocadas: [],
  correcao: null,
  regraId: null,
  transferenciaId: null,
  historicos: [],
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
      conciliadaComo: "ligacao",
      datasTrocadas: [{ id: "l", de: "2026-10-17" }],
      ligados: [{ id: "l", descricao: "PP-00162 · Frete", valor: -100, origem: "pp_baixa" }],
    }),
  );
  assert.equal(manual?.texto, "Baixa feita à mão: “PP-00162 · Frete” · data de 17/10 para 19/10, a do banco");
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
  const corrigida = resolucaoDaLinha(
    linhaDoBanco("a", { conciliada: true, conciliadaComo: "correcao", correcao: { de: 4005, para: 4000, motivo: "O banco não cobrou os juros" } }),
  );
  assert.equal(corrigida?.texto.replace(/\u00a0/g, " "), "Baixa corrigida de R$ 4.005,00 para R$ 4.000,00, o valor do banco · “O banco não cobrou os juros”");
  assert.equal(corrigida?.ligados, false);
  const regra = resolucaoDaLinha(linhaDoBanco("a", { conciliada: true, conciliadaComo: "regra", regraId: "r1" }), new Map([["r1", { centro: "04 · Custo Fixo · Tarifa bancária" }]]));
  assert.equal(regra?.texto, "Avulso lançado pela regra: 04 · Custo Fixo · Tarifa bancária");
  const conjunto = resolucaoDaLinha(
    linhaDoBanco("a", {
      conciliada: true,
      conciliadaComo: "conjunto",
      grupo: "g1",
      ligados: [
        { id: "l1", descricao: "PP-00116 · Custo do job", valor: -96888.6, origem: "pp_baixa" },
        { id: "l2", descricao: "PP-00113 · Custo do job", valor: -1133.2, origem: "pp_baixa" },
      ],
    }),
  );
  assert.equal(conjunto?.texto, "Em conjunto com outras linhas do banco: “PP-00116 · Custo do job” e mais 1");
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

test("a remessa casa só com todos os títulos em aberto, e os títulos ficam marcados com ela", () => {
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
    remessasBaixadas: [],
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
    lancamentos: agruparComoNoBanco([lanc("x", { valor: 450 }), lanc("y", { valor: 700 })]),
    remessasBaixadas: [],
    remessas: [],
    regras: [],
    periodos: [{ inicio: "2026-10-19", fim: "2026-10-19", geradoDia: "2026-10-20" }],
  };
  const { resultados, naoApareceu } = conciliarConta(banco, [], "conta", {}, "2026-10-21");
  assert.equal(resultados[0].estado, "ja_lancado");
  assert.deepEqual(naoApareceu.map((l) => l.id), ["x"]);
});

test("a automação: o certo se resolve sozinho uma vez; a soma, o sem centro e o desfeito ficam", () => {
  const linhas = [
    titulo("pagar|avulso|a", 700),
    titulo("pagar|avulso|b", 300, { centro: { tipo: "definir_na_baixa" } }),
    titulo("pagar|avulso|c", 1000),
    titulo("pagar|avulso|d", 2000),
    titulo("pagar|avulso|e", 800),
  ];
  const banco = {
    linhas: [
      linhaDoBanco("1", { valor: -700 }),
      linhaDoBanco("2", { valor: -300, ordem: 1 }),
      linhaDoBanco("3", { valor: -3000, ordem: 2 }),
      linhaDoBanco("4", { valor: -450, ordem: 3, avaliada: true }),
      linhaDoBanco("5", { valor: -800, ordem: 4, semAuto: true }),
      linhaDoBanco("6", { valor: -700, ordem: 5, avaliada: true, conciliada: true, conciliadaComo: "baixa", resolvidaSozinha: "titulo" }),
    ],
    lancamentos: agruparComoNoBanco([lanc("y", { valor: 450 })]),
    remessasBaixadas: [],
    remessas: [{ id: "r1", nome: "remessa nº 12", descricao: "Remessa Santander nº 12", itens: [
      { origemTipo: "avulsa", origemId: "c", valor: 1000 },
      { origemTipo: "avulsa", origemId: "d", valor: 2000 },
    ] }],
    regras: [],
    periodos: [],
  };
  const { resultados } = conciliarConta(banco, linhas, "conta", {}, "2026-10-21");
  const a = automacaoDaLeitura(resultados);
  // A baixa feita à mão liga mesmo na linha já avaliada.
  assert.deepEqual(a.manuais.map((r) => r.mov.id), ["4"]);
  // Todas as pendentes ainda não avaliadas, a desfeita também (ela não se
  // resolve, mas a avaliação fica gravada).
  assert.deepEqual(a.aAvaliar, ["1", "2", "3", "5"]);
  assert.deepEqual(a.titulos.map((r) => r.mov.id), ["1"]);
  assert.deepEqual(a.remessas.map((r) => r.mov.id), ["3"]);
  assert.deepEqual(a.regras, []);

  const faixa = textoDosSozinhos(resultados);
  assert.equal(faixa?.quantas, 1);
  assert.match(faixa?.partes[0] ?? "", /^1 título baixado e conciliado \(valor exato/);
});

test("a remessa linha a linha: cada pagamento casa o seu título, e o total só com a linha do total (decisão 202)", () => {
  const linhas = [titulo("pagar|avulso|c", 1000), titulo("pagar|avulso|d", 2000)];
  const remessas = [{ id: "r1", nome: "remessa nº 12", descricao: "Remessa Santander nº 12", itens: [
    { origemTipo: "avulsa", origemId: "c", valor: 1000 },
    { origemTipo: "avulsa", origemId: "d", valor: 2000 },
  ] }];
  const base = { lancamentos: [], remessasBaixadas: [], remessas, regras: [], periodos: [] };
  // O Santander: um débito por pagamento.
  const separado = conciliarConta(
    { ...base, linhas: [linhaDoBanco("1", { valor: -1000 }), linhaDoBanco("2", { valor: -2000, ordem: 1 })] },
    linhas,
    "conta",
    {},
    "2026-10-21",
  );
  assert.deepEqual(
    separado.resultados.map((r) => [r.mov.id, r.estado, r.titulo?.id]),
    [
      ["1", "sugestao", "pagar|avulso|c"],
      ["2", "sugestao", "pagar|avulso|d"],
    ],
  );
  // O banco que debita a remessa inteira.
  const total = conciliarConta({ ...base, linhas: [linhaDoBanco("1", { valor: -3000 })] }, linhas, "conta", {}, "2026-10-21");
  assert.equal(total.resultados[0].estado, "soma");
});

test("as baixas da remessa: uma a uma, e o grupo só com a linha da soma (passo 1c)", () => {
  const remessa = new Map([
    ["av1", { id: "r1" }],
    ["av2", { id: "r1" }],
  ]);
  const crus = [
    lanc("a", { origem: "avulsa_baixa", conta_avulsa_id: "av1", valor: 1000 }),
    lanc("b", { origem: "avulsa_baixa", conta_avulsa_id: "av2", valor: 2000 }),
  ];
  const lancamentos = agruparComoNoBanco(crus);
  const base = {
    lancamentos,
    remessasBaixadas: remessasJaBaixadas(lancamentos, crus, remessa),
    remessas: [],
    regras: [],
    periodos: [{ inicio: "2026-10-19", fim: "2026-10-19", geradoDia: "2026-10-20" }],
  };
  const separado = conciliarConta(
    { ...base, linhas: [linhaDoBanco("1", { valor: -1000 }), linhaDoBanco("2", { valor: -2000, ordem: 1 })] },
    [],
    "conta",
    {},
    "2026-10-21",
  );
  assert.deepEqual(separado.resultados.map((r) => [r.estado, r.lancamento?.id]), [
    ["ja_lancado", "a"],
    ["ja_lancado", "b"],
  ]);
  assert.deepEqual(separado.naoApareceu, []);
  const total = conciliarConta({ ...base, linhas: [linhaDoBanco("1", { valor: -3000 })] }, [], "conta", {}, "2026-10-21");
  assert.equal(total.resultados[0].estado, "ja_lancado");
  assert.deepEqual(total.lancamentos.get(total.resultados[0].lancamento?.id ?? "")?.ids, ["a", "b"]);
  assert.deepEqual(total.naoApareceu, []);
});

test("a cauda do histórico (A6): do mesmo dia antes do título, até 5 dias e pela soma depois", () => {
  const base = { lancamentos: [], remessasBaixadas: [], remessas: [], regras: [], periodos: [] };
  const cauda = [
    { id: "h1", data: "2026-10-19", valor: -600, job: "Job Exemplo 3T", descricao: null, fornecedor: "Fornecedor 001 Exemplo" },
    { id: "h2", data: "2026-10-17", valor: -250, job: "Job Exemplo 3T", descricao: null, fornecedor: "Fornecedor 002 Exemplo" },
    { id: "h3", data: "2026-10-19", valor: 1000, job: "Job A 3T", descricao: null, fornecedor: "Cliente Exemplo" },
    { id: "h4", data: "2026-10-19", valor: 2500.5, job: "Job B 3T", descricao: null, fornecedor: "CLIENTE EXEMPLO" },
  ];
  const { resultados } = conciliarConta(
    {
      ...base,
      historico: cauda,
      linhas: [
        linhaDoBanco("1", { valor: -600 }),
        linhaDoBanco("2", { valor: -250, ordem: 1 }),
        linhaDoBanco("3", { valor: 3500.5, ordem: 2 }),
        linhaDoBanco("4", { valor: -999, ordem: 3 }),
      ],
    },
    [],
    "conta",
    {},
    "2026-10-21",
  );
  assert.deepEqual(
    resultados.map((r) => [r.mov.id, r.estado, (r.historicos ?? []).map((h) => h.id).join("+")]),
    [
      ["1", "historico", "h1"],
      ["2", "historico", "h2"],
      ["3", "historico", "h3+h4"],
      ["4", "sem_par", ""],
    ],
  );
  const secoes = secoesDoBanco(resultados);
  assert.equal(secoes.historico.length, 3);
  assert.equal(automacaoDaLeitura(resultados).historicos.length, 3);
});

test("a soma do histórico só junta linhas do mesmo favorecido", () => {
  const base = { lancamentos: [], remessasBaixadas: [], remessas: [], regras: [], periodos: [] };
  const historico = [
    { id: "h1", data: "2026-10-20", valor: -300, job: "Job A 3T", descricao: null, fornecedor: "Fornecedor 001 Exemplo" },
    { id: "h2", data: "2026-10-20", valor: -120, job: "Job A 3T", descricao: null, fornecedor: "Fornecedor 002 Exemplo" },
    { id: "h3", data: "2026-10-20", valor: -500, job: "Job B 3T", descricao: null, fornecedor: null },
    { id: "h4", data: "2026-10-20", valor: -200, job: "Job B 3T", descricao: null, fornecedor: null },
  ];
  const { resultados } = conciliarConta(
    { ...base, historico, linhas: [linhaDoBanco("1", { valor: -420 }), linhaDoBanco("2", { valor: -700, ordem: 1 })] },
    [],
    "conta",
    {},
    "2026-10-21",
  );
  assert.deepEqual(resultados.map((r) => r.estado), ["sem_par", "sem_par"]);
});

test("a retenção na fonte não paga saída; entra no recebimento do cliente, com a nota", () => {
  const base = { lancamentos: [], remessasBaixadas: [], remessas: [], regras: [], periodos: [] };
  const ret = (id: string, valor: number, imposto: string) => ({
    id, data: "2026-10-01", valor, job: null, descricao: `Imposto retido na fonte ${imposto}`, fornecedor: "Cliente Exemplo",
  });
  const historico = [
    { id: "n1", data: "2026-10-01", valor: 20000, job: "Job A 3T", descricao: "Nota 1", fornecedor: "Cliente Exemplo" },
    ret("r1", -300, "IRPJ"), ret("r2", -200, "CSLL"), ret("r3", -130, "PIS"), ret("r4", -600, "COFINS"), ret("r5", -1000, "ISS"),
    { id: "n2", data: "2026-10-01", valor: 10000, job: "Job B 3T", descricao: "Nota 2", fornecedor: "Cliente Exemplo" },
    ret("r6", -150, "IRPJ"), ret("r7", -100, "CSLL"), ret("r8", -65, "PIS"), ret("r9", -300, "COFINS"), ret("r10", -500, "ISS"),
    // O "ISS retido" da folha de PJ é pagamento e casa pelo valor.
    { id: "f1", data: "2026-10-01", valor: -2744, job: null, descricao: "ISS retido - salário diretor", fornecedor: "Colaborador 001 Exemplo" },
  ];
  const { resultados } = conciliarConta(
    {
      ...base,
      historico,
      linhas: [
        linhaDoBanco("1", { data: "2026-10-01", valor: -1000, historico: "PAGFOR PIX OUTRA INST" }),
        linhaDoBanco("2", { data: "2026-10-01", valor: 17770, historico: "TED RECEBIDA", ordem: 1 }),
        linhaDoBanco("3", { data: "2026-10-01", valor: 8885, historico: "TED RECEBIDA", ordem: 2 }),
        linhaDoBanco("4", { data: "2026-10-01", valor: -2744, historico: "PAGFOR PIX OUTRA INST", ordem: 3 }),
      ],
    },
    [],
    "conta",
    {},
    "2026-10-21",
  );
  assert.deepEqual(
    resultados.map((r) => [r.mov.id, r.estado, (r.historicos ?? []).map((h) => h.id).join("+")]),
    [
      ["1", "sem_par", ""],
      ["2", "historico", "n1+r1+r2+r3+r4+r5"],
      ["3", "historico", "n2+r6+r7+r8+r9+r10"],
      ["4", "historico", "f1"],
    ],
  );
});

test("a linha conciliada pelo histórico diz o job", () => {
  const l = linhaDoBanco("a", {
    conciliada: true,
    conciliadaComo: "historico",
    resolvidaSozinha: "historico",
    historicos: [
      { id: "h1", valor: -600, job: "Job Exemplo 3T", descricao: null },
      { id: "h2", valor: -400, job: "Job Outro 3T", descricao: null },
    ],
  });
  const r = resolucaoDaLinha(l);
  assert.equal(r?.sozinho, "historico");
  assert.equal(r?.texto, "Do histórico da planilha: “Job Exemplo 3T” e mais 1");
});

test("a linha da regra do extrato não vai para a cauda do histórico", () => {
  const regra = { id: "g1", padrao: "APLICACAO CONTAMAX", centro: "Transferência para a aplicação", criadaEm: "28/10/2026", usos: 0 };
  const { resultados } = conciliarConta(
    {
      lancamentos: [],
      remessasBaixadas: [],
      remessas: [],
      regras: [regra] as never,
      periodos: [],
      historico: [
        { id: "h1", data: "2026-10-19", valor: -4000, job: "Job Exemplo 3T", descricao: null, fornecedor: null },
        { id: "h2", data: "2026-10-19", valor: -7000, job: "Job Exemplo 3T", descricao: null, fornecedor: null },
        { id: "h3", data: "2026-10-19", valor: -11000, job: "Job Exemplo 3T", descricao: null, fornecedor: null },
      ],
      linhas: [linhaDoBanco("1", { valor: -11000, historico: "APLICACAO CONTAMAX" })],
    },
    [],
    "conta",
    {},
    "2026-10-21",
  );
  assert.equal(resultados[0].estado, "regra");
});
