/**
 * Testes das regras da padronização (E2) do histórico financeiro — decisão
 * 211. Os textos imitam o formato da planilha; nomes e valores são fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/regras.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cargaDaData } from "./abas";
import {
  chaveDeNome,
  colunaDoJob,
  ehCodigoAntigo,
  ehDistribuicaoDeLucro,
  empresaDaSigla,
  lerCompetencia,
  lerData,
  lerTipo,
  lerValor,
  notaCancelada,
  pareceJob,
  proporCliente,
  proporMarca,
  proporServico,
  regionalDaLinha,
  regionalMaisFrequente,
  type ClienteDoSistema,
} from "./regras";

test("Tipo: empresa, grupo e competência", () => {
  assert.deepEqual(lerTipo("CO 3T 2026"), { classe: "dre", sigla: null, grupo: "CO", trimestre: 3, ano: 2026 });
  assert.deepEqual(lerTipo("CMH CO 3T 2026"), { classe: "dre", sigla: "CMH", grupo: "CO", trimestre: 3, ano: 2026 });
  assert.deepEqual(lerTipo(" hit  emp 2T 2024 "), { classe: "dre", sigla: "HIT", grupo: "EMP", trimestre: 2, ano: 2024 });
  assert.deepEqual(lerTipo("MÚTUO INT 1T 2026"), { classe: "dre", sigla: null, grupo: "MÚTUO INT", trimestre: 1, ano: 2026 });
  assert.deepEqual(lerTipo("FIT CF 2014"), { classe: "dre", sigla: "FIT", grupo: "CF", trimestre: null, ano: 2014 });
  assert.deepEqual(lerTipo("CO 4T2026"), { classe: "dre", sigla: null, grupo: "CO", trimestre: 4, ano: 2026 });
});

test("Tipo: transferência, estorno, aporte e o que não tem padrão", () => {
  assert.deepEqual(lerTipo("SANTANDER"), { classe: "transferencia", contrapartida: "SANTANDER" });
  assert.deepEqual(lerTipo("XP CALIFÓRNIA"), { classe: "transferencia", contrapartida: "XP CALIFÓRNIA" });
  assert.deepEqual(lerTipo("Estorno"), { classe: "estorno" });
  assert.deepEqual(lerTipo("APORTE"), { classe: "aporte" });
  assert.equal(lerTipo("").classe, "invalido");
  assert.deepEqual(lerTipo("CMH 1T 2026"), { classe: "invalido", motivo: "Tipo sem grupo da DRE" });
  assert.deepEqual(lerTipo("CMH CO 4T 2T 2026"), { classe: "invalido", motivo: "Trimestre fora do lugar no Tipo" });
  assert.deepEqual(lerTipo("Despesa Pessoal"), { classe: "invalido", motivo: "Tipo sem ano de competência" });
});

test("empresa e coluna do job pela sigla (D1)", () => {
  assert.equal(empresaDaSigla(null), "Agência California");
  assert.equal(empresaDaSigla("CMH"), "CCH");
  assert.equal(empresaDaSigla("FIT"), "FitDance");
  assert.equal(colunaDoJob(null), "job");
  assert.equal(colunaDoJob("CMH"), "evento");
  assert.equal(colunaDoJob("HIT"), "evento");
  assert.equal(colunaDoJob("FIT"), "job");
});

test("o que não é job na coluna do job", () => {
  assert.equal(pareceJob("n/a"), false);
  assert.equal(pareceJob("Impostos"), false);
  assert.equal(pareceJob(" "), false);
  assert.equal(pareceJob("Marca X - Evento Y 1T 2026"), true);
});

test("valor: débito, crédito, débito negativo e os casos sem valor", () => {
  assert.deepEqual(lerValor("", "572.16"), { ok: true, natureza: "saida", valor: 572.16, credito: 0, debito: 572.16 });
  assert.deepEqual(lerValor("1500", ""), { ok: true, natureza: "entrada", valor: 1500, credito: 1500, debito: 0 });
  assert.deepEqual(lerValor("", "-333.28"), { ok: true, natureza: "entrada", valor: 333.28, credito: 0, debito: -333.28 });
  assert.deepEqual(lerValor("-1485.82", ""), { ok: true, natureza: "saida", valor: 1485.82, credito: -1485.82, debito: 0 });
  const fracao = lerValor("3333.3333333333", "");
  assert.equal(fracao.ok && fracao.valor, 3333.33);
  assert.deepEqual(lerValor("", ""), { ok: false, motivo: "sem valor" });
  assert.deepEqual(lerValor("0", "0.001"), { ok: false, motivo: "sem valor" });
  assert.deepEqual(lerValor("10", "5"), { ok: false, motivo: "crédito e débito na mesma linha" });
  assert.deepEqual(lerValor("#VALUE!", ""), { ok: false, motivo: "valor não numérico" });
});

test("data: ISO, com hora, dd/mm/aaaa e as inválidas", () => {
  assert.equal(lerData("2026-03-05"), "2026-03-05");
  assert.equal(lerData("2026-03-05 10:00:00"), "2026-03-05");
  assert.equal(lerData("05/03/2026"), "2026-03-05");
  assert.equal(lerData("11/11/0204"), null);
  assert.equal(lerData("2026-02-30"), null);
  assert.equal(lerData("1899-12-31"), null);
  assert.equal(lerData("-619"), null);
});

test("competência da nota", () => {
  assert.deepEqual(lerCompetencia("1T 2018"), { trimestre: 1, ano: 2018 });
  assert.deepEqual(lerCompetencia("4T2026"), { trimestre: 4, ano: 2026 });
  assert.equal(lerCompetencia("Q1"), null);
});

test("regional: Reg da California, CMH Reg da CCH, regional única de Hitlab e Ventura", () => {
  assert.deepEqual(regionalDaLinha("Agência California", "NE", ""), { regional: "NE", todas: false });
  assert.deepEqual(regionalDaLinha("Agência California", "ok", ""), { regional: null, todas: false });
  assert.deepEqual(regionalDaLinha("Agência California", "TD", ""), { regional: null, todas: true });
  assert.deepEqual(regionalDaLinha("CCH", "", "AGE"), { regional: "Agency", todas: false });
  assert.deepEqual(regionalDaLinha("CCH", "DOC", ""), { regional: "Doca", todas: false });
  assert.deepEqual(regionalDaLinha("Hitlab", "NE", ""), { regional: "Hitlab", todas: false });
  assert.deepEqual(regionalDaLinha("FitDance", "NE", ""), { regional: null, todas: false });
});

test("nota de distribuição de lucro, nota cancelada e regional pelos lançamentos", () => {
  assert.equal(ehDistribuicaoDeLucro("DL", "Cliente X", "SOCIO 002 EXEMPLO", false), true);
  assert.equal(ehDistribuicaoDeLucro("", "", "SOCIO 001 EXEMPLO", true), true);
  assert.equal(ehDistribuicaoDeLucro("", "", "SOCIO 001 EXEMPLO", false), false);
  assert.equal(ehDistribuicaoDeLucro("", "Cliente X", "Job sem par", true), false);
  assert.equal(notaCancelada(" Cancelada "), true);
  assert.equal(notaCancelada("Marca X - Evento 1T 2026"), false);
  assert.equal(regionalMaisFrequente(["SP", "NE", "SP", ""]), "SP");
  assert.equal(regionalMaisFrequente(["", ""]), "");
});

test("código do sistema antigo", () => {
  assert.equal(ehCodigoAntigo("AAA-0306/25"), true);
  assert.equal(ehCodigoAntigo("Normal"), false);
  assert.equal(ehCodigoAntigo("ORÇ 688/1"), false);
});

const ALFA: ClienteDoSistema = { sigla: "AAA", fantasia: "ALFA", razao: "ALFA S.A.", marcas: ["ALFA", "MARCA BETA"] };
const GAMA: ClienteDoSistema = { sigla: "GGG", fantasia: "GAMA BRASIL INTERNET LTDA.", razao: "GAMA BRASIL INTERNET LTDA.", marcas: ["TUBO"] };

test("cliente: igual, pela marca, parecido e sem par", () => {
  assert.equal(chaveDeNome("Alfa S.A."), "ALFA");
  assert.deepEqual(proporCliente("Alfa", [ALFA, GAMA]), { valor: "AAA", como: "igual" });
  assert.deepEqual(proporCliente("Tubo", [ALFA, GAMA]), { valor: "GGG", como: "pela marca" });
  assert.deepEqual(proporCliente("Gama", [ALFA, GAMA]), { valor: "GGG", como: "parecido" });
  assert.deepEqual(proporCliente("Delta", [ALFA, GAMA]), { valor: "", como: "sem par" });
  const EPSILON: ClienteDoSistema = { sigla: "2EP", fantasia: "E-PSILON", razao: "EPSILONWAGEN DO BRASIL LTDA", marcas: [] };
  assert.deepEqual(proporCliente("Epsilon", [ALFA, EPSILON]), { valor: "2EP", como: "igual" });
  assert.deepEqual(proporCliente("2ep", [ALFA, EPSILON]), { valor: "2EP", como: "pela sigla" });
  assert.deepEqual(proporCliente("Epsilonw", [ALFA, EPSILON]), { valor: "2EP", como: "parecido" });
});

test("marca e serviço", () => {
  assert.deepEqual(proporMarca("MARCA BETA", ALFA), { valor: "MARCA BETA", como: "igual" });
  assert.deepEqual(proporMarca("Beta", ALFA), { valor: "MARCA BETA", como: "parecido" });
  assert.deepEqual(proporMarca("Zeta", ALFA), { valor: "", como: "sem par" });
  assert.deepEqual(proporServico("Atv/Cont"), { valor: "Ativação", como: "parecido" });
  assert.deepEqual(proporServico("FEE"), { valor: "Fee", como: "igual" });
  assert.deepEqual(proporServico("AON"), { valor: "Always On", como: "igual" });
  assert.deepEqual(proporServico("MÍDIA"), { valor: "Mídia", como: "igual" });
  assert.deepEqual(proporServico("CONT"), { valor: "Ativação", como: "parecido" });
  assert.deepEqual(proporServico("NETWORK"), { valor: "", como: "sem par" });
});

test("carga pela data (D3)", () => {
  assert.equal(cargaDaData("2022-12-31"), "anterior a 2023");
  assert.equal(cargaDaData("2023-01-01"), "1ª carga");
  assert.equal(cargaDaData("2026-06-30"), "1ª carga");
  assert.equal(cargaDaData("2026-07-01"), "3T 2026");
  assert.equal(cargaDaData("2026-10-01"), "depois do corte");
});
