import { test } from "node:test";
import * as assert from "node:assert";
import {
  montarFolhaAdiantamento,
  type AdiantamentoParaMontar,
} from "./montar-folha-adiantamento";

test("PJ gera 1 linha california com valor cheio", () => {
  const folha = montarFolhaAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "pj",
    valor: 1000,
  });
  assert.deepEqual(folha, {
    decimo_terceiro_adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo: "decimo_terceiro_adiantamento",
    origem: "california",
    salario_base: 1000,
  });
});

test("MEI gera 1 linha california", () => {
  const folha = montarFolhaAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "mei",
    valor: 1500,
  });
  assert.deepEqual(folha, {
    decimo_terceiro_adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo: "decimo_terceiro_adiantamento",
    origem: "california",
    salario_base: 1500,
  });
});

test("CLT puro gera 1 linha contabilidade", () => {
  const folha = montarFolhaAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "clt",
    valor: 2000,
  });
  assert.deepEqual(folha, {
    decimo_terceiro_adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo: "decimo_terceiro_adiantamento",
    origem: "contabilidade",
    salario_base: 2000,
  });
});

test("Híbrido (clt_recibo) gera 1 linha california com valor cheio", () => {
  const folha = montarFolhaAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "clt_recibo",
    valor: 800,
  });
  assert.deepEqual(folha, {
    decimo_terceiro_adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo: "decimo_terceiro_adiantamento",
    origem: "california",
    salario_base: 800,
  });
});

test("valor <= 0 lança erro", () => {
  assert.throws(
    () => {
      montarFolhaAdiantamento({
        adiantamento_id: "a1",
        colaborador_id: "c1",
        tipo_contratacao: "pj",
        valor: 0,
      });
    },
    {
      message: /valor deve ser maior que 0/i,
    }
  );

  assert.throws(
    () => {
      montarFolhaAdiantamento({
        adiantamento_id: "a1",
        colaborador_id: "c1",
        tipo_contratacao: "pj",
        valor: -100,
      });
    },
    {
      message: /valor deve ser maior que 0/i,
    }
  );
});
