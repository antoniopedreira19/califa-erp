/**
 * A guia de imposto no extrato da conciliação (módulo fiscal, entrega 2):
 * os N lançamentos de uma baixa viram UMA linha com a soma, que se abre em
 * sublinhas — e o saldo acumulado e os totais do período não mudam.
 *
 * Rode com:  node --import tsx --test lib/data/imposto-extrato.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { LinhaSemSaldo } from "./lancamento-linha";
import { derivarSaldo } from "../calculos/saldo-conta";
import {
  agruparGuiasDeImposto,
  nomeDoArquivo,
  type LancamentoDaGuia,
  type TituloDaGuia,
} from "./imposto-extrato";

/** Uma linha do extrato como `montarLinhasDeLancamentos` devolve. */
function linha(p: Partial<LinhaSemSaldo> & Pick<LinhaSemSaldo, "id" | "valor">): LinhaSemSaldo {
  return {
    data_movimento: "2026-11-25",
    descricao: "Lançamento",
    natureza: "saida",
    fornecedor_nome: null,
    job_id: null,
    job_codigo: null,
    tipo_codigo: "02",
    tipo_nome: "Custo Operacional",
    subtipo_codigo: "999",
    subtipo_nome: "Geral (provisório)",
    empresa_nome: "California",
    regional_nome: null,
    origem_codigo: null,
    origem_recorrente: false,
    cartao_label: null,
    documento_label: null,
    documento_path: null,
    origem: "manual",
    estornada: false,
    rateio: [],
    origens: [],
    papel_na_fatura: null,
    fatura_cartao_id: null,
    conta_avulsa_id: null,
    pedido_compra_parcela_id: null,
    desembolso_parcela_id: null,
    ...p,
  };
}

const PIS: TituloDaGuia = {
  tributo: "PIS",
  origem: "apuracao",
  titulo: "PIS",
  codigo_receita: "8109",
  rotulo_competencia: "outubro/2026",
  cota_numero: null,
  cota_total: null,
  vencimento: "2026-11-25",
  multa_juros: 25,
  guia_path: "tenant-1/0b6f1c2e-8f3a-4c55-9d1e-2a7b9c0d4e5f-darf-pis-outubro.pdf",
  estabelecimento: null,
  empresa_contabil: { razao_social: "CALIFÓRNIA FILMES E PUBLICIDADE LTDA", nome_fantasia: "California" },
};

/** A baixa do PIS: duas partes do rateio (03 · Custo Tributário · PIS) e a
 *  multa e os juros (11 · Despesa com Juros). A multa vem PRIMEIRO de
 *  propósito: os lançamentos de uma baixa nascem no mesmo instante, e a
 *  ordem entre eles no extrato não é garantida. */
function baixaDoPis(): LinhaSemSaldo[] {
  const comum = {
    origem: "imposto_baixa",
    descricao: "DARF 8109 · PIS · outubro/2026",
    tipo_codigo: "03",
    tipo_nome: "Custo Tributário",
    subtipo_codigo: "002",
    subtipo_nome: "PIS",
  };
  return [
    linha({
      ...comum,
      id: "lanc-multa",
      valor: 25,
      descricao: "Multa e juros · DARF 8109 · PIS · outubro/2026",
      tipo_codigo: "11",
      tipo_nome: "Despesa com Juros",
      subtipo_codigo: "999",
      subtipo_nome: "Geral (provisório)",
    }),
    linha({ ...comum, id: "lanc-ne", valor: 700, empresa_nome: "California" }),
    linha({ ...comum, id: "lanc-sp", valor: 300, empresa_nome: "GoCrazy" }),
  ];
}

function daGuiaDoPis(): Map<string, LancamentoDaGuia> {
  return new Map<string, LancamentoDaGuia>([
    ["lanc-multa", { imposto_a_pagar_id: "imp-pis", regional_nome: "Nordeste", titulo: PIS }],
    ["lanc-ne", { imposto_a_pagar_id: "imp-pis", regional_nome: "Nordeste", titulo: PIS }],
    ["lanc-sp", { imposto_a_pagar_id: "imp-pis", regional_nome: "São Paulo", titulo: PIS }],
  ]);
}

/** Um recebimento antes e um pagamento de PP depois da guia, no mesmo dia. */
function extratoComPis(): LinhaSemSaldo[] {
  return [
    linha({
      id: "lanc-receb",
      valor: 1000,
      natureza: "entrada",
      descricao: "Recebimento NF 602/1",
      origem: "titulo_baixa",
      tipo_codigo: "01",
      tipo_nome: "Receita",
    }),
    ...baixaDoPis(),
    linha({ id: "lanc-pp", valor: 200, descricao: "PP PP-00110 1/1 — Serviço", origem: "pp_baixa" }),
  ];
}

test("dois rateios + multa viram UMA linha com a soma e três sublinhas", () => {
  const { linhas, detalhes, linhaDoLancamento } = agruparGuiasDeImposto(extratoComPis(), daGuiaDoPis());

  assert.deepEqual(
    linhas.map((l) => l.id),
    ["lanc-receb", "lanc-multa", "lanc-pp"],
    "a guia fica na posição (e com o id) do primeiro lançamento dela",
  );

  const guia = linhas[1];
  assert.equal(guia.valor, 1025);
  assert.equal(guia.natureza, "saida");
  assert.equal(guia.descricao, "DARF 8109 · PIS · outubro/2026 · California");
  assert.equal(guia.fornecedor_nome, "Receita Federal");
  assert.equal(guia.origem_codigo, "DARF 8109");
  assert.equal(guia.tipo_codigo, "03", "o centro da linha é o do imposto, não o da multa");
  assert.equal(guia.subtipo_nome, "PIS");
  assert.equal(guia.empresa_nome, null, "duas empresas: a coluna diz Múltiplas");
  assert.equal(guia.regional_nome, null);
  assert.deepEqual(guia.rateio, [
    { regional_nome: "Nordeste", percentual: 70 },
    { regional_nome: "São Paulo", percentual: 30 },
  ]);
  assert.equal(guia.documento_label, "darf-pis-outubro.pdf");
  assert.equal(guia.documento_path, PIS.guia_path);

  const d = detalhes["lanc-multa"];
  assert.ok(d, "o detalhe fica no id da linha");
  assert.equal(d.total, 1025);
  assert.equal(d.multaJuros, 25);
  assert.equal(d.regionais, 2);
  assert.equal(d.empresas, 2);
  assert.equal(d.guia, "guia DARF 8109");
  assert.equal(d.competencia, "PIS · outubro/2026");
  assert.equal(d.vencimento, "2026-11-25");
  assert.deepEqual(
    d.partes.map((p) => [p.rotulo, p.percentual, p.valor, p.tipo_nome, p.subtipo_nome]),
    [
      ["California · Nordeste", 70, 700, "Custo Tributário", "PIS"],
      ["GoCrazy · São Paulo", 30, 300, "Custo Tributário", "PIS"],
      ["Multa e juros", null, 25, "Despesa com Juros", "Geral (provisório)"],
    ],
  );
  assert.equal(
    d.partes.reduce((s, p) => s + p.valor, 0),
    guia.valor,
    "as sublinhas fecham com o débito da linha",
  );

  // O highlight que a baixa devolve é o id de UM lançamento qualquer dela.
  assert.deepEqual(linhaDoLancamento, {
    "lanc-multa": "lanc-multa",
    "lanc-ne": "lanc-multa",
    "lanc-sp": "lanc-multa",
  });
});

test("o saldo acumulado, os totais e o saldo final não mudam", () => {
  const saldoAnterior = 5000;
  const antes = derivarSaldo(extratoComPis(), saldoAnterior);
  const depois = derivarSaldo(agruparGuiasDeImposto(extratoComPis(), daGuiaDoPis()).linhas, saldoAnterior);

  const total = (xs: typeof antes, k: "credito" | "debito") => xs.reduce((s, l) => s + l[k], 0);
  assert.equal(total(depois, "credito"), total(antes, "credito"));
  assert.equal(total(depois, "debito"), total(antes, "debito"));
  assert.equal(depois[depois.length - 1].saldo, antes[antes.length - 1].saldo);
  assert.equal(depois[depois.length - 1].saldo, 5000 + 1000 - 1025 - 200);

  // Toda linha fora da guia tem o mesmo saldo de antes; a da guia, o saldo
  // depois do último lançamento dela.
  const saldoAntes = new Map(antes.map((l) => [l.id, l.saldo]));
  assert.equal(depois[0].saldo, saldoAntes.get("lanc-receb"));
  assert.equal(depois[1].saldo, saldoAntes.get("lanc-sp"));
  assert.equal(depois[2].saldo, saldoAntes.get("lanc-pp"));
});

test("guia municipal de uma empresa só: prefeitura, empresa e regional na linha", () => {
  const iss: TituloDaGuia = {
    ...PIS,
    tributo: "ISS",
    origem: "diferenca",
    titulo: "ISS próprio",
    codigo_receita: null,
    multa_juros: 0,
    guia_path: "tenant-1/imp-iss/guia.pdf",
    estabelecimento: { nome: "California · Salvador", municipio: "Salvador" },
  };
  const lancamentos = [
    linha({
      id: "lanc-iss",
      valor: 480.5,
      origem: "imposto_baixa",
      tipo_codigo: "03",
      tipo_nome: "Custo Tributário",
      subtipo_codigo: "001",
      subtipo_nome: "ISS",
    }),
  ];
  const daGuia = new Map<string, LancamentoDaGuia>([
    ["lanc-iss", { imposto_a_pagar_id: "imp-iss", regional_nome: "Nordeste", titulo: iss }],
  ]);

  const { linhas, detalhes } = agruparGuiasDeImposto(lancamentos, daGuia);
  assert.equal(linhas.length, 1);
  const l = linhas[0];
  assert.equal(l.descricao, "Guia municipal · ISS próprio · outubro/2026 · complementar · California · Salvador");
  assert.equal(l.fornecedor_nome, "Prefeitura de Salvador");
  assert.equal(l.origem_codigo, "Guia municipal");
  assert.equal(l.empresa_nome, "California");
  assert.equal(l.regional_nome, "Nordeste");
  assert.deepEqual(l.rateio, []);
  assert.equal(l.documento_label, "guia.pdf");

  const d = detalhes["lanc-iss"];
  assert.equal(d.guia, "guia municipal");
  assert.equal(d.regionais, 1);
  assert.equal(d.empresas, 1);
  assert.equal(d.multaJuros, 0);
  assert.deepEqual(
    d.partes.map((p) => [p.rotulo, p.percentual, p.valor]),
    [["California · Nordeste", 100, 480.5]],
  );
});

test("cota do IRPJ: a cota vem depois da competência", () => {
  const irpj: TituloDaGuia = {
    ...PIS,
    tributo: "IRPJ",
    titulo: "IRPJ (com adicional)",
    codigo_receita: "2089",
    rotulo_competencia: "4º trimestre/2026",
    cota_numero: 1,
    cota_total: 3,
    multa_juros: 0,
  };
  const { linhas, detalhes } = agruparGuiasDeImposto(
    [linha({ id: "lanc-irpj", valor: 1200, origem: "imposto_baixa", tipo_codigo: "03" })],
    new Map([["lanc-irpj", { imposto_a_pagar_id: "imp-irpj", regional_nome: null, titulo: irpj }]]),
  );
  assert.equal(linhas[0].descricao, "DARF 2089 · IRPJ (com adicional) · 4º trimestre/2026 · cota 1/3 · California");
  assert.equal(detalhes["lanc-irpj"].competencia, "IRPJ (com adicional) · 4º trimestre/2026 · cota 1/3");
  // Sem regional no rateio: a parte leva só a empresa.
  assert.equal(detalhes["lanc-irpj"].partes[0].rotulo, "California");
  assert.equal(linhas[0].regional_nome, null);
});

test("sem a leitura das guias, o extrato fica como estava", () => {
  const original = extratoComPis();
  const { linhas, detalhes, linhaDoLancamento } = agruparGuiasDeImposto(original, new Map());
  assert.deepEqual(linhas, original);
  assert.deepEqual(detalhes, {});
  assert.deepEqual(linhaDoLancamento, {});
});

test("duas guias pagas no mesmo instante, intercaladas: uma linha cada, somas certas", () => {
  const cofins: TituloDaGuia = { ...PIS, tributo: "COFINS", titulo: "COFINS", codigo_receita: "2172", multa_juros: 0 };
  const base = { origem: "imposto_baixa", tipo_codigo: "03", tipo_nome: "Custo Tributário" };
  const lancamentos = [
    linha({ ...base, id: "pis-1", valor: 650 }),
    linha({ ...base, id: "cof-1", valor: 3000 }),
    linha({ ...base, id: "pis-2", valor: 350 }),
    linha({ ...base, id: "cof-2", valor: 1615.37 }),
  ];
  const daGuia = new Map<string, LancamentoDaGuia>([
    ["pis-1", { imposto_a_pagar_id: "imp-pis", regional_nome: "Nordeste", titulo: { ...PIS, multa_juros: 0 } }],
    ["pis-2", { imposto_a_pagar_id: "imp-pis", regional_nome: "São Paulo", titulo: { ...PIS, multa_juros: 0 } }],
    ["cof-1", { imposto_a_pagar_id: "imp-cofins", regional_nome: "Nordeste", titulo: cofins }],
    ["cof-2", { imposto_a_pagar_id: "imp-cofins", regional_nome: "São Paulo", titulo: cofins }],
  ]);

  const { linhas, detalhes } = agruparGuiasDeImposto(lancamentos, daGuia);
  assert.deepEqual(
    linhas.map((l) => [l.id, l.valor]),
    [
      ["pis-1", 1000],
      ["cof-1", 4615.37],
    ],
  );
  assert.equal(detalhes["cof-1"].partes[1].percentual, 35);
  const antes = derivarSaldo(lancamentos, 10000);
  const depois = derivarSaldo(linhas, 10000);
  assert.equal(depois[depois.length - 1].saldo, antes[antes.length - 1].saldo);
});

test("nome do arquivo da guia: sem a pasta e sem o identificador do envio", () => {
  assert.equal(nomeDoArquivo("t/0b6f1c2e-8f3a-4c55-9d1e-2a7b9c0d4e5f-DARF PIS.pdf"), "DARF PIS.pdf");
  assert.equal(nomeDoArquivo("t/abc/guia.pdf"), "guia.pdf");
  assert.equal(nomeDoArquivo("guia.pdf"), "guia.pdf");
});
