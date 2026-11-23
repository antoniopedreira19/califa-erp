/**
 * Testes da linha da planilha que é de um título do sistema (decisão 262, D2;
 * revisão de 17/11/2026).
 *
 * Rode com:  node --import tsx --test lib/conciliacao/planilha-de-titulo.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { codigoDePp, codigosDePp, donosDaPlanilha, eDePpPaga, nomesBatem, type LinhaDaPlanilha, type TituloEmAberto } from "./planilha-de-titulo";

const linha = (x: Partial<LinhaDaPlanilha> & { id: string }): LinhaDaPlanilha => ({
  data: "2026-11-12",
  valor: -4500,
  descricao: "Controller",
  quem: "Colaboradora Exemplo Silva",
  ...x,
});
const pp = (x: Partial<TituloEmAberto> & { id: string }): TituloEmAberto => ({
  data: "2026-11-10",
  valor: -4500,
  descricao: "Controller",
  quem: "Colaboradora Exemplo Silva dos Santos",
  origem: "pp",
  ref: "PP-00634 1/1",
  ...x,
});

test("o código da PP nas formas que a planilha escreve", () => {
  assert.equal(codigoDePp("PP-00634 Controller"), "PP-00634");
  assert.equal(codigoDePp("PP00634 - Controller"), "PP-00634");
  assert.equal(codigoDePp("PP 634 controller"), "PP-00634");
  assert.equal(codigoDePp("pp-634"), "PP-00634");
  assert.equal(codigoDePp("PP01166 - PP00246 - Insumos"), "PP-01166");
  assert.equal(codigoDePp("APP 123"), null);
  assert.equal(codigoDePp("Controller"), null);
  assert.equal(codigoDePp(null), null);
});

test("o titular pelo começo do nome e por cada parte do texto da planilha", () => {
  assert.ok(nomesBatem("Colaboradora Exemplo Silva dos Santos", "Colaboradora Exemplo"));
  assert.ok(nomesBatem("Flash App | Colaborador 001 Exemplo", "COLABORADOR 001 EXEMPLO SOUZA"));
  assert.ok(nomesBatem("Fornecedor Ótimo Ltda", "FORNECEDOR OTIMO"));
  assert.ok(!nomesBatem("Colaborador 001 Exemplo", "Colaborador 002 Exemplo"));
  assert.ok(!nomesBatem("Colaboradora Exemplo Souza", "Colaboradora Exemplo Lima"), "mesmo primeiro nome, outra pessoa");
  assert.ok(!nomesBatem("Ana", "Ana"), "nome curto demais não conta");
  assert.ok(!nomesBatem(null, "Colaborador 001 Exemplo"));
});

test("pelo código: a PP do código, em qualquer forma", () => {
  const d = donosDaPlanilha([linha({ id: "h1", descricao: "PP00634 - Controller", quem: "Outro Nome Qualquer" })], [pp({ id: "t1" })]);
  assert.equal(d.get("h1"), "t1");
});

test("pela chave do custo fixo: fornecedor e descrição iguais", () => {
  const d = donosDaPlanilha(
    [linha({ id: "h1", descricao: "Energia elétrica", quem: "Fornecedor 001 Exemplo", valor: -1000 })],
    [pp({ id: "t1", descricao: "Energia eletrica", quem: "FORNECEDOR 001 EXEMPLO", origem: "recorrencia", ref: "AV-00096", valor: -999 })],
  );
  assert.equal(d.get("h1"), "t1");
});

test("sem código: a PP aberta pelo valor e pelo titular (o caso da PP-00634)", () => {
  const d = donosDaPlanilha([linha({ id: "h1", descricao: "Controller NÃO TA NO SISTEMA DO RH" })], [pp({ id: "t1" })]);
  assert.equal(d.get("h1"), "t1");
});

test("sem código: valor diferente, data longe, outro titular ou título que não é PP não casam", () => {
  assert.equal(donosDaPlanilha([linha({ id: "h1" })], [pp({ id: "t1", valor: -4499.99 })]).size, 0);
  assert.equal(donosDaPlanilha([linha({ id: "h1" })], [pp({ id: "t1", data: "2026-10-20" })]).size, 0);
  assert.equal(donosDaPlanilha([linha({ id: "h1" })], [pp({ id: "t1", quem: "Colaborador 002 Exemplo" })]).size, 0);
  assert.equal(donosDaPlanilha([linha({ id: "h1" })], [pp({ id: "t1", origem: "avulso", ref: "AV-00001" })]).size, 0);
});

test("a linha que cita outra PP (já paga) não vai para a PP aberta do mesmo titular", () => {
  // "PAGAMENTO DUPLICADO - PP00288": a PP citada está paga; a aberta é outra.
  const d = donosDaPlanilha([linha({ id: "h1", descricao: "PAGAMENTO DUPLICADO - PP00288" })], [pp({ id: "t1" })]);
  assert.equal(d.size, 0);
});

test("na dúvida nada se esconde: duas PPs ou duas linhas no mesmo par", () => {
  assert.equal(donosDaPlanilha([linha({ id: "h1" })], [pp({ id: "t1" }), pp({ id: "t2", ref: "PP-00700 1/1" })]).size, 0);
  assert.equal(donosDaPlanilha([linha({ id: "h1" }), linha({ id: "h2" })], [pp({ id: "t1" })]).size, 0);
});

test("todos os códigos de PP do texto, sem repetir", () => {
  assert.deepEqual(codigosDePp("PP01028 PP01027 PP01021 - Reembolso"), ["PP-01028", "PP-01027", "PP-01021"]);
  assert.deepEqual(codigosDePp("PP00460 e PP-460 - Diretora de arte"), ["PP-00460"]);
  assert.deepEqual(codigosDePp("Controller"), []);
  assert.deepEqual(codigosDePp(null), []);
});

test("a linha da planilha de PP já paga sai da lista (o caso da PP-00360, 23/11)", () => {
  const pagas = new Set(["PP-00360", "PP-01028", "PP-00288"]);
  assert.ok(eDePpPaga({ valor: -6000, descricao: "PP-00360 - Videomaker" }, pagas));
  assert.ok(eDePpPaga({ valor: -6000, descricao: "PP00360 - Videomaker" }, pagas), "código sem hífen");
  assert.ok(!eDePpPaga({ valor: -6000, descricao: "PP-00365 - Diretora de arte" }, pagas), "PP não paga");
  assert.ok(!eDePpPaga({ valor: -6000, descricao: "PP 25684 - Despachante" }, pagas), "numeração antiga da planilha");
  assert.ok(!eDePpPaga({ valor: -6000, descricao: "Locação de apartamento" }, pagas), "sem código");
});

test("fica a linha que cita PP paga mas é outro movimento", () => {
  const pagas = new Set(["PP-00288", "PP-00446", "PP-01028"]);
  assert.ok(!eDePpPaga({ valor: 5000, descricao: "Devolução de pagamento duplicado - PP00288" }, pagas), "entrada");
  assert.ok(!eDePpPaga({ valor: -5000, descricao: "PAGAMENTO DUPLICADO - PP00288" }, pagas));
  assert.ok(!eDePpPaga({ valor: -4800, descricao: "PAGO EM DUPLICIDADE?? CONFERIR - PP-00446" }, pagas));
  assert.ok(!eDePpPaga({ valor: -5000, descricao: "PIX NÃO EFETUADO - PP00288" }, pagas));
  assert.ok(!eDePpPaga({ valor: -2189.09, descricao: "PP01028 PP01020 - Reembolso" }, pagas), "uma das PPs citadas ainda está aberta");
});
