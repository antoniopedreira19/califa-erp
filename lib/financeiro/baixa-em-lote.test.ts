/**
 * Testes da baixa em lote — a entrada da Server Action e a montagem da
 * entrada de cada action da baixa individual.
 *
 * Rode com:  node --import tsx --test lib/financeiro/baixa-em-lote.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  baixaEmLoteSchema,
  centroDoItem,
  montarChamadas,
  type EntradaDaBaixaEmLote,
} from "./baixa-em-lote";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const CONTA = U(1);
const TIPO_02 = U(2);
const SUB_02 = U(3);
const TIPO_01 = U(4);
const SUB_01 = U(5);
const TIPO_07 = U(6);
const SUB_07 = U(7);

function entrada(over: Partial<EntradaDaBaixaEmLote> = {}): EntradaDaBaixaEmLote {
  return {
    pago_em: "2026-10-02",
    conta_bancaria_id: CONTA,
    forma_pagamento: "pix",
    centro_pagar: { tipoId: TIPO_02, subtipoId: SUB_02 },
    centro_receber: { tipoId: TIPO_01, subtipoId: SUB_01 },
    itens: [
      // PP: tem o tipo (02) mas não o subtipo — usa o do lote.
      {
        chave: `pagar|pp|${U(10)}`,
        rotulo: "Captação",
        alvo: { modulo: "pagar", origem: "pp", id: U(10) },
        aberto: 1500,
        centro: null,
      },
      // Avulso: já tem o centro de custo — usa o seu.
      {
        chave: `pagar|avulso|${U(11)}`,
        rotulo: "Aluguel",
        alvo: { modulo: "pagar", origem: "avulso", id: U(11) },
        aberto: 800.555,
        centro: { tipoId: TIPO_07, subtipoId: SUB_07 },
      },
      // Nota fiscal: sem centro — usa o dos recebimentos.
      {
        chave: `receber|nf|${U(12)}`,
        rotulo: "NF 2054",
        alvo: { modulo: "receber", origem: "nf", id: U(12) },
        aberto: 10000,
        centro: null,
      },
      // Recebimento avulso: com centro próprio.
      {
        chave: `receber|recebimento_avulso|${U(13)}`,
        rotulo: "Reembolso",
        alvo: { modulo: "receber", origem: "recebimento_avulso", id: U(13) },
        aberto: 250,
        centro: { tipoId: TIPO_01, subtipoId: SUB_01 },
      },
    ],
    ...over,
  };
}

test("monta uma chamada por título, na ordem, cada uma pela action da origem", () => {
  const d = baixaEmLoteSchema.parse(entrada());
  const m = montarChamadas(d);
  assert.equal(m.ok, true);
  if (!m.ok) return;
  assert.deepEqual(
    m.chamadas.map((c) => c.acao),
    ["pagar", "pagar", "receber_nf", "receber_avulso"],
  );
  assert.deepEqual(m.chamadas[0].entrada, {
    origem: "pp",
    id: U(10),
    pago_em: "2026-10-02",
    conta_bancaria_id: CONTA,
    plano_conta_tipo_id: TIPO_02,
    plano_conta_subtipo_id: SUB_02,
    forma_pagamento: "pix",
    cartao_credito_id: null,
    valor_baixa: 1500,
    retencoes: [],
  });
  assert.deepEqual(m.chamadas[2].entrada, {
    titulo_id: U(12),
    pago_em: "2026-10-02",
    conta_bancaria_id: CONTA,
    plano_conta_tipo_id: TIPO_01,
    plano_conta_subtipo_id: SUB_01,
    valor_baixa: 10000,
    retencoes: [],
  });
  assert.deepEqual(m.chamadas[3].entrada, {
    conta_avulsa_id: U(13),
    pago_em: "2026-10-02",
    conta_bancaria_id: CONTA,
    plano_conta_tipo_id: TIPO_01,
    plano_conta_subtipo_id: SUB_01,
    valor_baixa: 250,
    retencoes: [],
  });
});

test("quem já tem centro de custo usa o seu; o do lote só preenche quem não tem", () => {
  const d = baixaEmLoteSchema.parse(entrada());
  assert.deepEqual(centroDoItem(d.itens[0], d), { tipoId: TIPO_02, subtipoId: SUB_02 });
  assert.deepEqual(centroDoItem(d.itens[1], d), { tipoId: TIPO_07, subtipoId: SUB_07 });
  const m = montarChamadas(d);
  assert.ok(m.ok);
  if (!m.ok) return;
  const avulso = m.chamadas[1];
  assert.equal(avulso.acao, "pagar");
  assert.equal(avulso.entrada.plano_conta_tipo_id, TIPO_07);
  assert.equal(avulso.entrada.plano_conta_subtipo_id, SUB_07);
});

test("o valor da baixa é o que falta, em centavos", () => {
  const d = baixaEmLoteSchema.parse(entrada());
  const m = montarChamadas(d);
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.equal(m.chamadas[1].entrada.valor_baixa, 800.56);
});

test("sem cartão, sem retenção: o lote nunca leva os dois", () => {
  const d = baixaEmLoteSchema.parse(entrada());
  const m = montarChamadas(d);
  assert.ok(m.ok);
  if (!m.ok) return;
  for (const c of m.chamadas) {
    assert.deepEqual(c.entrada.retencoes, []);
    if (c.acao === "pagar") assert.equal(c.entrada.cartao_credito_id, null);
  }
  // E a forma "cartão" nem passa pelo schema.
  const comCartao = baixaEmLoteSchema.safeParse({
    ...entrada(),
    forma_pagamento: "cartao_credito",
  });
  assert.equal(comCartao.success, false);
});

test("título a pagar exige a forma de pagamento", () => {
  const r = baixaEmLoteSchema.safeParse(entrada({ forma_pagamento: null }));
  assert.equal(r.success, false);
  if (r.success) return;
  assert.equal(r.error.issues[0].message, "Escolha a forma de pagamento.");
});

test("só recebimento: a forma não é pedida", () => {
  const e = entrada({ forma_pagamento: null, centro_pagar: null });
  e.itens = e.itens.filter((i) => i.alvo.modulo === "receber");
  const r = baixaEmLoteSchema.safeParse(e);
  assert.equal(r.success, true);
});

test("pagamento sem centro de custo e sem o do lote é barrado", () => {
  const r = baixaEmLoteSchema.safeParse(entrada({ centro_pagar: null }));
  assert.equal(r.success, false);
  if (r.success) return;
  assert.equal(r.error.issues[0].message, "Escolha o subtipo do centro de custo dos pagamentos.");
});

test("todos com centro próprio: o do lote não é pedido", () => {
  const e = entrada({ centro_pagar: null, centro_receber: null });
  e.itens = e.itens.filter((i) => i.centro !== null);
  const r = baixaEmLoteSchema.safeParse(e);
  assert.equal(r.success, true);
});

test("recebimento sem centro de custo e sem o do lote é barrado", () => {
  const r = baixaEmLoteSchema.safeParse(entrada({ centro_receber: null }));
  assert.equal(r.success, false);
  if (r.success) return;
  assert.equal(r.error.issues[0].message, "Escolha o subtipo do centro de custo dos recebimentos.");
});

test("origem com baixa própria não entra no lote", () => {
  for (const origem of ["folha", "fatura_cartao", "pp_devolucao_verba"]) {
    const e = entrada();
    (e.itens[0].alvo as { origem: string }).origem = origem;
    const r = baixaEmLoteSchema.safeParse(e);
    assert.equal(r.success, false, origem);
  }
  for (const origem of ["rendimento", "transferencia"]) {
    const e = entrada();
    (e.itens[2].alvo as { origem: string }).origem = origem;
    const r = baixaEmLoteSchema.safeParse(e);
    assert.equal(r.success, false, origem);
  }
});

test("data, conta e títulos são obrigatórios; título repetido é barrado", () => {
  assert.equal(baixaEmLoteSchema.safeParse(entrada({ pago_em: "" })).success, false);
  assert.equal(baixaEmLoteSchema.safeParse(entrada({ conta_bancaria_id: "" })).success, false);
  assert.equal(baixaEmLoteSchema.safeParse(entrada({ itens: [] })).success, false);
  const e = entrada();
  e.itens = [e.itens[0], { ...e.itens[0] }];
  const r = baixaEmLoteSchema.safeParse(e);
  assert.equal(r.success, false);
  if (r.success) return;
  assert.equal(r.error.issues[0].message, "O mesmo título aparece duas vezes no lote.");
});

test("título sem valor em aberto é barrado", () => {
  const e = entrada();
  e.itens[0].aberto = 0;
  assert.equal(baixaEmLoteSchema.safeParse(e).success, false);
});
