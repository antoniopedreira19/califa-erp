/**
 * Testes da validação do pagamento avulso: a data prevista de pagamento é
 * obrigatória ao criar e ao editar, menos no cartão, em que ela vem da
 * fatura (revisão da 082, 26/10/2026).
 *
 * Rode com:  node --import tsx --test lib/validations/conta-avulsa.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { criarContaAvulsaSchema, editarContaAvulsaSchema } from "./conta-avulsa";

const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

const base = {
  empresa_id: ID(1),
  descricao: "Despesa de teste",
  valor: "150.00",
  natureza: "saida" as const,
  data_prevista_pagamento: "2026-10-30",
  fornecedor_id: null,
  cliente_id: null,
  plano_conta_tipo_id: ID(2),
  plano_conta_subtipo_id: ID(3),
  forma_pagamento: "pix" as const,
  cartao_credito_id: null,
  rateio: [{ regional_id: ID(4), percentual: 100 }],
};

function erroDaData(r: { success: boolean; error?: { flatten(): { fieldErrors: Record<string, string[] | undefined> } } }) {
  return r.success ? undefined : r.error?.flatten().fieldErrors.data_prevista_pagamento;
}

test("criar sem data prevista é recusado no PIX, na transferência e no boleto", () => {
  for (const forma of ["pix", "transferencia", "boleto"] as const) {
    for (const vazio of [null, ""]) {
      const r = criarContaAvulsaSchema.safeParse({ ...base, forma_pagamento: forma, data_prevista_pagamento: vazio });
      assert.deepEqual(erroDaData(r), ["Informe a data prevista de pagamento."], `${forma} com ${JSON.stringify(vazio)}`);
    }
  }
});

test("criar com data prevista passa", () => {
  const r = criarContaAvulsaSchema.safeParse(base);
  assert.equal(r.success, true);
});

test("no cartão a data pode vir vazia: ela sai da fatura", () => {
  const r = criarContaAvulsaSchema.safeParse({
    ...base,
    forma_pagamento: "cartao_credito",
    cartao_credito_id: ID(5),
    data_prevista_pagamento: null,
    data_compra: "2026-10-26",
  });
  assert.equal(r.success, true);
});

test("editar também exige a data, e não deixa apagá-la", () => {
  assert.deepEqual(
    erroDaData(editarContaAvulsaSchema.safeParse({ ...base, forma_pagamento: "transferencia", data_prevista_pagamento: "" })),
    ["Informe a data prevista de pagamento."],
  );
  assert.equal(editarContaAvulsaSchema.safeParse(base).success, true);
});
