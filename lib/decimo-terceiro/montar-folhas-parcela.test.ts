import { test } from "node:test";
import * as assert from "node:assert";
import {
  montarFolhasParcela,
  type LinhaParaMontar,
  type ParcelaNumero,
} from "./montar-folhas-parcela";

test("PJ puro gera 1 linha california com valor total", () => {
  const linhas = montarFolhasParcela(
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo_contratacao: "pj",
      primeira_parcela: 1000,
      segunda_parcela: 1000,
      parte_pj_primeira_parcela: null,
      parte_pj_segunda_parcela: null,
      parte_clt_primeira_parcela: null,
      parte_clt_segunda_parcela: null,
    },
    1
  );
  assert.deepEqual(linhas, [
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_1a_parcela",
      origem: "california",
      salario_base: 1000,
    },
  ]);
});

test("MEI puro gera 1 linha california", () => {
  const linhas = montarFolhasParcela(
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo_contratacao: "mei",
      primeira_parcela: 1000,
      segunda_parcela: 1000,
      parte_pj_primeira_parcela: null,
      parte_pj_segunda_parcela: null,
      parte_clt_primeira_parcela: null,
      parte_clt_segunda_parcela: null,
    },
    1
  );
  assert.deepEqual(linhas, [
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_1a_parcela",
      origem: "california",
      salario_base: 1000,
    },
  ]);
});

test("CLT puro gera 1 linha contabilidade", () => {
  const linhas = montarFolhasParcela(
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo_contratacao: "clt",
      primeira_parcela: 1000,
      segunda_parcela: 1000,
      parte_pj_primeira_parcela: null,
      parte_pj_segunda_parcela: null,
      parte_clt_primeira_parcela: null,
      parte_clt_segunda_parcela: null,
    },
    1
  );
  assert.deepEqual(linhas, [
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_1a_parcela",
      origem: "contabilidade",
      salario_base: 1000,
    },
  ]);
});

test("Híbrido com parte_pj=600 e parte_clt=400 gera 2 linhas", () => {
  const linhas = montarFolhasParcela(
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo_contratacao: "clt_recibo",
      primeira_parcela: 1000,
      segunda_parcela: 1000,
      parte_pj_primeira_parcela: 600,
      parte_pj_segunda_parcela: 600,
      parte_clt_primeira_parcela: 400,
      parte_clt_segunda_parcela: 400,
    },
    1
  );
  assert.equal(linhas.length, 2);
  // 1 california com 600, 1 contabilidade com 400
  const california = linhas.find((l) => l.origem === "california");
  const contabilidade = linhas.find((l) => l.origem === "contabilidade");
  assert.ok(california, "deve ter 1 linha california");
  assert.ok(contabilidade, "deve ter 1 linha contabilidade");
  assert.equal(california.salario_base, 600);
  assert.equal(contabilidade.salario_base, 400);
});

test("Híbrido com parte_pj=0 gera só a linha contabilidade", () => {
  const linhas = montarFolhasParcela(
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo_contratacao: "clt_recibo",
      primeira_parcela: 1000,
      segunda_parcela: 1000,
      parte_pj_primeira_parcela: 0,
      parte_pj_segunda_parcela: 0,
      parte_clt_primeira_parcela: 1000,
      parte_clt_segunda_parcela: 1000,
    },
    1
  );
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].origem, "contabilidade");
  assert.equal(linhas[0].salario_base, 1000);
});

test("Híbrido com parte_clt=0 gera só a linha california", () => {
  const linhas = montarFolhasParcela(
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo_contratacao: "clt_recibo",
      primeira_parcela: 1000,
      segunda_parcela: 1000,
      parte_pj_primeira_parcela: 1000,
      parte_pj_segunda_parcela: 1000,
      parte_clt_primeira_parcela: 0,
      parte_clt_segunda_parcela: 0,
    },
    1
  );
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].origem, "california");
  assert.equal(linhas[0].salario_base, 1000);
});

test("Linha com primeira_parcela=0 e parcela=1 retorna lista vazia", () => {
  const linhas = montarFolhasParcela(
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo_contratacao: "pj",
      primeira_parcela: 0,
      segunda_parcela: 1000,
      parte_pj_primeira_parcela: null,
      parte_pj_segunda_parcela: null,
      parte_clt_primeira_parcela: null,
      parte_clt_segunda_parcela: null,
    },
    1
  );
  assert.deepEqual(linhas, []);
});

test("Mesmas regras aplicam pra 2a parcela", () => {
  const linhas = montarFolhasParcela(
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo_contratacao: "pj",
      primeira_parcela: 1000,
      segunda_parcela: 2000,
      parte_pj_primeira_parcela: null,
      parte_pj_segunda_parcela: null,
      parte_clt_primeira_parcela: null,
      parte_clt_segunda_parcela: null,
    },
    2
  );
  assert.deepEqual(linhas, [
    {
      decimo_terceiro_linha_id: "l1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_2a_parcela",
      origem: "california",
      salario_base: 2000,
    },
  ]);
});
