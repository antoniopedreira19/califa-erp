import { test } from "node:test";
import * as assert from "node:assert";
import {
  montarFolhasAdiantamento,
  type AdiantamentoParaMontar,
} from "./montar-folha-adiantamento";

test("PJ gera 1 folha california com valor cheio", () => {
  const folhas = montarFolhasAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "pj",
    valor: 1000,
  });
  assert.deepEqual(folhas, [
    {
      decimo_terceiro_adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_adiantamento",
      origem: "california",
      salario_base: 1000,
    },
  ]);
});

test("MEI gera 1 folha california", () => {
  const folhas = montarFolhasAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "mei",
    valor: 1500,
  });
  assert.deepEqual(folhas, [
    {
      decimo_terceiro_adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_adiantamento",
      origem: "california",
      salario_base: 1500,
    },
  ]);
});

test("CLT puro gera 1 folha contabilidade", () => {
  const folhas = montarFolhasAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "clt",
    valor: 2000,
  });
  assert.deepEqual(folhas, [
    {
      decimo_terceiro_adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_adiantamento",
      origem: "contabilidade",
      salario_base: 2000,
    },
  ]);
});

test("Híbrido gera 2 folhas proporcionais ao salário (CLT + PJ)", () => {
  // Salário total 10.000, recibo (parte PJ) 4.000 → ratio PJ = 40%.
  // Adiantamento 1.000:
  //   parte CLT = round2(1000 × 6000/10000) = 600 → contabilidade
  //   parte PJ  = 1000 − 600 = 400              → california
  const folhas = montarFolhasAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "clt_recibo",
    valor: 1000,
    salario: 10000,
    valor_recibo: 4000,
  });
  assert.deepEqual(folhas, [
    {
      decimo_terceiro_adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_adiantamento",
      origem: "contabilidade",
      salario_base: 600,
    },
    {
      decimo_terceiro_adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_adiantamento",
      origem: "california",
      salario_base: 400,
    },
  ]);
});

test("Híbrido com arredondamento: PJ absorve o resíduo de centavo", () => {
  // Salário 3333, recibo 1000 → ratio PJ = 1000/3333 ≈ 0.300030003
  // Adiantamento 100:
  //   parte CLT = round2(100 × 2333/3333) = round2(69.9969...) = 70.00
  //   parte PJ  = 100 − 70 = 30.00
  const folhas = montarFolhasAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "clt_recibo",
    valor: 100,
    salario: 3333,
    valor_recibo: 1000,
  });
  assert.equal(folhas.length, 2);
  assert.equal(folhas[0].origem, "contabilidade");
  assert.equal(folhas[0].salario_base, 70);
  assert.equal(folhas[1].origem, "california");
  assert.equal(folhas[1].salario_base, 30);
});

test("Híbrido sem valor_recibo informado lança erro (contrato)", () => {
  assert.throws(
    () => {
      montarFolhasAdiantamento({
        adiantamento_id: "a1",
        colaborador_id: "c1",
        tipo_contratacao: "clt_recibo",
        valor: 800,
      } as AdiantamentoParaMontar);
    },
    {
      message: /salario.*valor_recibo|híbrido.*split/i,
    },
  );
});

test("Híbrido com valor_recibo = 0 cai pra 1 folha CLT (sem parte PJ)", () => {
  const folhas = montarFolhasAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "clt_recibo",
    valor: 800,
    salario: 5000,
    valor_recibo: 0,
  });
  assert.deepEqual(folhas, [
    {
      decimo_terceiro_adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_adiantamento",
      origem: "contabilidade",
      salario_base: 800,
    },
  ]);
});

test("Híbrido com destino='clt' gera 1 folha contabilidade com valor cheio", () => {
  // Mesmo com salario e valor_recibo definidos, destino='clt' ignora o
  // split e manda o valor inteiro pra folha CLT (contabilidade).
  const folhas = montarFolhasAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "clt_recibo",
    valor: 1500,
    salario: 10000,
    valor_recibo: 4000,
    destino: "clt",
  });
  assert.deepEqual(folhas, [
    {
      decimo_terceiro_adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_adiantamento",
      origem: "contabilidade",
      salario_base: 1500,
    },
  ]);
});

test("Híbrido com destino='pj' gera 1 folha california com valor cheio", () => {
  const folhas = montarFolhasAdiantamento({
    adiantamento_id: "a1",
    colaborador_id: "c1",
    tipo_contratacao: "clt_recibo",
    valor: 2500,
    salario: 10000,
    valor_recibo: 4000,
    destino: "pj",
  });
  assert.deepEqual(folhas, [
    {
      decimo_terceiro_adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo: "decimo_terceiro_adiantamento",
      origem: "california",
      salario_base: 2500,
    },
  ]);
});

test("Híbrido destino='clt' não exige salario/valor_recibo (sem split)", () => {
  // Como destino força a parte, não precisa das infos do split.
  assert.doesNotThrow(() => {
    montarFolhasAdiantamento({
      adiantamento_id: "a1",
      colaborador_id: "c1",
      tipo_contratacao: "clt_recibo",
      valor: 500,
      destino: "clt",
    });
  });
});

test("Híbrido destino='ambos' (default) continua exigindo salario+valor_recibo", () => {
  // Preserva o contrato antigo pra callers que não passam destino.
  assert.throws(
    () => {
      montarFolhasAdiantamento({
        adiantamento_id: "a1",
        colaborador_id: "c1",
        tipo_contratacao: "clt_recibo",
        valor: 800,
      } as AdiantamentoParaMontar);
    },
    {
      message: /salario.*valor_recibo|híbrido.*split/i,
    },
  );
});

test("valor <= 0 lança erro", () => {
  assert.throws(
    () => {
      montarFolhasAdiantamento({
        adiantamento_id: "a1",
        colaborador_id: "c1",
        tipo_contratacao: "pj",
        valor: 0,
      });
    },
    {
      message: /valor deve ser maior que 0/i,
    },
  );

  assert.throws(
    () => {
      montarFolhasAdiantamento({
        adiantamento_id: "a1",
        colaborador_id: "c1",
        tipo_contratacao: "pj",
        valor: -100,
      });
    },
    {
      message: /valor deve ser maior que 0/i,
    },
  );
});
