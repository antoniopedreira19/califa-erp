/**
 * Testes da baixa em lote — a entrada da Server Action e a montagem da
 * entrada de cada action da baixa individual.
 *
 * Rode com:  node --import tsx --test lib/financeiro/baixa-em-lote.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aliquotasDaParcela,
  aliquotasDaRemessa,
  baixaEmLoteSchema,
  centroDoItem,
  montarChamadas,
  origemDoLote,
  retencoesPelaAprovacao,
  selecaoPorOrigem,
  type AliquotasDaAprovacao,
  type ChamadaDaBaixa,
  type DadosDaBaixaEmLote,
  type EntradaDaBaixaEmLote,
} from "./baixa-em-lote";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A entrada de uma baixa de título (a pagar ou a receber) — não de imposto. */
function deTitulo(c: ChamadaDaBaixa) {
  if (c.acao === "imposto") throw new Error("esperava a baixa de um título, veio a de um imposto");
  return c.entrada;
}

const CONTA = U(1);
const TIPO_02 = U(2);
const SUB_02 = U(3);
const TIPO_01 = U(4);
const SUB_01 = U(5);
const TIPO_07 = U(6);
const SUB_07 = U(7);

/** As alíquotas lidas no servidor: a PP do caso base, aprovada sem retenção. */
const SEM_RETENCAO = new Map<string, AliquotasDaAprovacao | null>([[U(10), null]]);

/** As retenções padrão da aprovação da PP com NF (regime normal). */
const PADRAO: AliquotasDaAprovacao = { PIS: 0.65, COFINS: 3, CSLL: 1, IRRF: 1.5 };

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

/** Só os títulos de índice `n` da entrada base — um lote de uma origem. */
function soOs(...n: number[]): EntradaDaBaixaEmLote["itens"] {
  return entrada().itens.filter((_, i) => n.includes(i));
}

/**
 * `montarChamadas` é pura e roteia qualquer alvo; a regra de uma origem por
 * lote mora no schema. Para testar as quatro origens da entrada base de uma
 * vez, cada título passa pelo schema no SEU lote, e os itens voltam juntos,
 * na ordem.
 */
function validadoPorOrigem(e: EntradaDaBaixaEmLote): DadosDaBaixaEmLote {
  const itens = e.itens.map((i) => baixaEmLoteSchema.parse({ ...e, itens: [i] }).itens[0]);
  return { ...baixaEmLoteSchema.parse({ ...e, itens: [e.itens[0]] }), itens };
}

test("monta uma chamada por título, na ordem, cada uma pela action da origem", () => {
  const d = validadoPorOrigem(entrada());
  const m = montarChamadas(d, SEM_RETENCAO);
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
  const d = validadoPorOrigem(entrada());
  assert.deepEqual(centroDoItem(d.itens[0], d), { tipoId: TIPO_02, subtipoId: SUB_02 });
  assert.deepEqual(centroDoItem(d.itens[1], d), { tipoId: TIPO_07, subtipoId: SUB_07 });
  const m = montarChamadas(d, SEM_RETENCAO);
  assert.ok(m.ok);
  if (!m.ok) return;
  const avulso = m.chamadas[1];
  assert.equal(avulso.acao, "pagar");
  assert.equal(avulso.entrada.plano_conta_tipo_id, TIPO_07);
  assert.equal(avulso.entrada.plano_conta_subtipo_id, SUB_07);
});

test("o valor da baixa é o que falta, em centavos", () => {
  const d = validadoPorOrigem(entrada());
  const m = montarChamadas(d, SEM_RETENCAO);
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.equal(deTitulo(m.chamadas[1]).valor_baixa, 800.56);
});

test("sem cartão, e sem retenção fora da PP com retenção na aprovação", () => {
  const d = validadoPorOrigem(entrada());
  const m = montarChamadas(d, SEM_RETENCAO);
  assert.ok(m.ok);
  if (!m.ok) return;
  for (const c of m.chamadas) {
    assert.deepEqual(deTitulo(c).retencoes, []);
    if (c.acao === "pagar") assert.equal(c.entrada.cartao_credito_id, null);
  }
  // E a forma "cartão" nem passa pelo schema.
  const comCartao = baixaEmLoteSchema.safeParse({
    ...entrada({ itens: soOs(1) }),
    forma_pagamento: "cartao_credito",
  });
  assert.equal(comCartao.success, false);
});

test("título a pagar exige a forma de pagamento", () => {
  const r = baixaEmLoteSchema.safeParse(entrada({ forma_pagamento: null, itens: soOs(0) }));
  assert.equal(r.success, false);
  if (r.success) return;
  assert.equal(r.error.issues[0].message, "Escolha a forma de pagamento.");
});

test("só recebimento: a forma não é pedida", () => {
  for (const n of [2, 3]) {
    const r = baixaEmLoteSchema.safeParse(
      entrada({ forma_pagamento: null, centro_pagar: null, itens: soOs(n) }),
    );
    assert.equal(r.success, true, String(n));
  }
});

test("pagamento sem centro de custo e sem o do lote é barrado", () => {
  const r = baixaEmLoteSchema.safeParse(entrada({ centro_pagar: null, itens: soOs(0) }));
  assert.equal(r.success, false);
  if (r.success) return;
  assert.equal(r.error.issues[0].message, "Escolha o subtipo do centro de custo dos pagamentos.");
});

test("todos com centro próprio: o do lote não é pedido", () => {
  // O avulso e o recebimento avulso da base têm o centro deles.
  for (const n of [1, 3]) {
    const r = baixaEmLoteSchema.safeParse(
      entrada({ centro_pagar: null, centro_receber: null, itens: soOs(n) }),
    );
    assert.equal(r.success, true, String(n));
  }
});

test("recebimento sem centro de custo e sem o do lote é barrado", () => {
  const r = baixaEmLoteSchema.safeParse(entrada({ centro_receber: null, itens: soOs(2) }));
  assert.equal(r.success, false);
  if (r.success) return;
  assert.equal(r.error.issues[0].message, "Escolha o subtipo do centro de custo dos recebimentos.");
});

test("origem com baixa própria não entra no lote", () => {
  for (const origem of ["fatura_cartao", "pp_devolucao_verba", "desembolso"]) {
    const e = entrada({ itens: soOs(1) });
    (e.itens[0].alvo as { origem: string }).origem = origem;
    const r = baixaEmLoteSchema.safeParse(e);
    assert.equal(r.success, false, origem);
  }
  for (const origem of ["rendimento", "transferencia"]) {
    const e = entrada({ itens: soOs(2) });
    (e.itens[0].alvo as { origem: string }).origem = origem;
    const r = baixaEmLoteSchema.safeParse(e);
    assert.equal(r.success, false, origem);
  }
});

test("data, conta e títulos são obrigatórios; título repetido é barrado", () => {
  assert.equal(baixaEmLoteSchema.safeParse(entrada({ pago_em: "", itens: soOs(1) })).success, false);
  assert.equal(
    baixaEmLoteSchema.safeParse(entrada({ conta_bancaria_id: "", itens: soOs(1) })).success,
    false,
  );
  assert.equal(baixaEmLoteSchema.safeParse(entrada({ itens: [] })).success, false);
  const e = entrada();
  e.itens = [e.itens[0], { ...e.itens[0] }];
  const r = baixaEmLoteSchema.safeParse(e);
  assert.equal(r.success, false);
  if (r.success) return;
  assert.equal(r.error.issues[0].message, "O mesmo título aparece duas vezes no lote.");
});

test("título sem valor em aberto é barrado", () => {
  const e = entrada({ itens: soOs(1) });
  e.itens[0].aberto = 0;
  assert.equal(baixaEmLoteSchema.safeParse(e).success, false);
});

// ---------------------------------------------------------------------------
// Retenção na fonte da aprovação da PP (módulo fiscal, 02/10/2026)
// ---------------------------------------------------------------------------

test("PP de R$ 18.000 com as 4 retenções: retidos 1.107,00, líquido 16.893,00", () => {
  const r = retencoesPelaAprovacao(18000, PADRAO);
  assert.deepEqual(r.retencoes, [
    { imposto: "PIS", aliquota: 0.65, valor: 117 },
    { imposto: "COFINS", aliquota: 3, valor: 540 },
    { imposto: "CSLL", aliquota: 1, valor: 180 },
    { imposto: "IRRF", aliquota: 1.5, valor: 270 },
  ]);
  assert.equal(r.retido, 1107);
  assert.equal(r.liquido, 16893);

  // No lote: o bruto vai como valor da baixa, e as retenções junto.
  const e = entrada();
  e.itens = [{ ...e.itens[0], aberto: 18000 }];
  const d = baixaEmLoteSchema.parse(e);
  const m = montarChamadas(d, new Map([[U(10), PADRAO]]));
  assert.ok(m.ok);
  if (!m.ok) return;
  const pp = m.chamadas[0];
  assert.equal(pp.acao, "pagar");
  if (pp.acao !== "pagar") return;
  assert.equal(pp.entrada.valor_baixa, 18000);
  assert.deepEqual(pp.entrada.retencoes, r.retencoes);
});

test("cada imposto arredondado em centavos sobre o que falta, como a baixa de um título", () => {
  // 1.234,56: PIS 8,02464 → 8,02; COFINS 37,0368 → 37,04; CSLL 12,3456 →
  // 12,35; IRRF 18,5184 → 18,52.
  const r = retencoesPelaAprovacao(1234.56, PADRAO);
  assert.deepEqual(
    r.retencoes.map((x) => [x.imposto, x.valor]),
    [
      ["PIS", 8.02],
      ["COFINS", 37.04],
      ["CSLL", 12.35],
      ["IRRF", 18.52],
    ],
  );
  assert.equal(r.retido, 75.93);
  assert.equal(r.liquido, 1158.63);
  // ISS entra antes dos federais, na ordem da baixa.
  const comIss = retencoesPelaAprovacao(1000, { IRRF: 1.5, ISS: 5 });
  assert.deepEqual(
    comIss.retencoes.map((x) => x.imposto),
    ["ISS", "IRRF"],
  );
  // Imposto que arredonda para zero não vai.
  assert.deepEqual(retencoesPelaAprovacao(0.4, { PIS: 0.65 }).retencoes, []);
});

test("a parcela de PP retém o que a aprovação gravou; na remessa, o que a remessa descontou (decisão 145)", () => {
  assert.deepEqual(aliquotasDaParcela({ verba: false, remessa: null, aliquotas: PADRAO }), PADRAO);
  assert.equal(aliquotasDaParcela({ verba: true, remessa: null, aliquotas: PADRAO }), null);
  assert.equal(aliquotasDaParcela({ verba: false, remessa: null, aliquotas: null }), null);
  assert.equal(aliquotasDaParcela({ verba: false, remessa: null, aliquotas: { PIS: 0 } }), null);
  // Remessa que pagou o valor cheio: sem retenção, mesmo com a da aprovação.
  assert.equal(aliquotasDaParcela({ verba: false, remessa: { aliquotas: null }, aliquotas: PADRAO }), null);
  // Remessa que pagou o líquido: valem as alíquotas dela, não as da aprovação de hoje.
  const daRemessa = { PIS: 0.65, COFINS: 3 };
  assert.deepEqual(aliquotasDaParcela({ verba: false, remessa: { aliquotas: daRemessa }, aliquotas: PADRAO }), daRemessa);
  assert.equal(aliquotasDaParcela({ verba: true, remessa: { aliquotas: daRemessa }, aliquotas: PADRAO }), null);
});

test("as alíquotas que a remessa descontou saem do que o item guardou", () => {
  assert.deepEqual(
    aliquotasDaRemessa([
      { imposto: "PIS", aliquota: 0.65, valor: 52 },
      { imposto: "IRRF", aliquota: "1.5", valor: 120 },
      { imposto: "INSS", aliquota: 11, valor: 1 },
      { imposto: "COFINS", aliquota: 0, valor: 0 },
    ]),
    { PIS: 0.65, IRRF: 1.5 },
  );
  assert.equal(aliquotasDaRemessa([]), null);
  assert.equal(aliquotasDaRemessa(null), null);
  // A mesma conta da remessa e da baixa: o líquido bate.
  const remessa = retencoesPelaAprovacao(8000, PADRAO);
  const baixa = retencoesPelaAprovacao(8000, aliquotasDaRemessa(remessa.retencoes));
  assert.equal(baixa.liquido, remessa.liquido);
});

test("PP sem retenção na aprovação: valor cheio, retenções vazias", () => {
  const d = validadoPorOrigem(entrada());
  const m = montarChamadas(d, new Map([[U(10), null]]));
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.deepEqual(deTitulo(m.chamadas[0]).retencoes, []);
  assert.equal(deTitulo(m.chamadas[0]).valor_baixa, 1500);
});

test("parcela de PP sem a leitura das retenções barra o lote inteiro", () => {
  const d = validadoPorOrigem(entrada());
  const m = montarChamadas(d, new Map());
  assert.equal(m.ok, false);
  if (m.ok) return;
  assert.match(m.mensagem, /Não foi possível conferir as retenções da aprovação de “Captação”/);
  assert.match(m.mensagem, /Nenhuma baixa foi feita/);
});

test("avulso, recorrência e recebimento não retêm no lote, mesmo com alíquota no mapa", () => {
  const d = validadoPorOrigem(entrada());
  const m = montarChamadas(
    d,
    new Map<string, AliquotasDaAprovacao | null>([
      [U(10), null],
      [U(11), PADRAO],
      [U(12), PADRAO],
    ]),
  );
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.deepEqual(deTitulo(m.chamadas[1]).retencoes, []);
  assert.deepEqual(deTitulo(m.chamadas[2]).retencoes, []);
  assert.deepEqual(deTitulo(m.chamadas[3]).retencoes, []);
});

// ---------------------------------------------------------------------------
// Impostos a Pagar (módulo fiscal, entrega 2)
// ---------------------------------------------------------------------------

const IMPOSTO = U(20);
const IMPOSTO_SEM_GUIA = U(21);

function itemImposto(over: Partial<EntradaDaBaixaEmLote["itens"][number]> = {}): EntradaDaBaixaEmLote["itens"][number] {
  return {
    chave: `imposto|${IMPOSTO}`,
    rotulo: "PIS",
    alvo: { modulo: "imposto", id: IMPOSTO },
    aberto: 1234.565,
    centro: null,
    imposto: { multa_juros: 12.345, guia_path: null, comprovante_path: `${U(99)}/comprovantes/x.pdf` },
    ...over,
  };
}

test("imposto: vira a baixa de imposto, sem centro de custo do lote nem forma de pagamento", () => {
  const d = baixaEmLoteSchema.parse(
    entrada({ forma_pagamento: null, centro_pagar: null, centro_receber: null, itens: [itemImposto()] }),
  );
  assert.equal(centroDoItem(d.itens[0], d), null);
  const m = montarChamadas(d, new Map());
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.equal(m.chamadas.length, 1);
  assert.deepEqual(m.chamadas[0], {
    acao: "imposto",
    chave: `imposto|${IMPOSTO}`,
    rotulo: "PIS",
    entrada: {
      imposto_id: IMPOSTO,
      pago_em: "2026-10-02",
      conta_bancaria_id: CONTA,
      multa_juros: 12.35,
      guia_path: null,
      comprovante_path: `${U(99)}/comprovantes/x.pdf`,
      valor_confirmado: 1234.57,
    },
  });
});

test("imposto sem guia leva a guia anexada no lote", () => {
  const d = baixaEmLoteSchema.parse(
    entrada({
      itens: [
        itemImposto({
          chave: `imposto|${IMPOSTO_SEM_GUIA}`,
          alvo: { modulo: "imposto", id: IMPOSTO_SEM_GUIA },
          imposto: { multa_juros: 0, guia_path: `${U(99)}/guias/g.pdf`, comprovante_path: `${U(99)}/comprovantes/c.pdf` },
        }),
      ],
    }),
  );
  const m = montarChamadas(d, new Map());
  assert.ok(m.ok);
  if (!m.ok) return;
  const c = m.chamadas[0];
  assert.equal(c.acao, "imposto");
  if (c.acao !== "imposto") return;
  assert.equal(c.entrada.guia_path, `${U(99)}/guias/g.pdf`);
  assert.equal(c.entrada.multa_juros, 0);
});

test("imposto sem comprovante não entra: o schema barra antes de qualquer baixa", () => {
  const semComprovante = baixaEmLoteSchema.safeParse(
    entrada({ itens: [itemImposto({ imposto: { multa_juros: 0, guia_path: null, comprovante_path: "" } })] }),
  );
  assert.equal(semComprovante.success, false);
  if (semComprovante.success) return;
  assert.match(semComprovante.error.issues[0].message, /Anexe o comprovante de pagamento de “PIS”/);

  const semNada = baixaEmLoteSchema.safeParse(entrada({ itens: [itemImposto({ imposto: null })] }));
  assert.equal(semNada.success, false);
});

test("só o imposto leva multa e anexos: título a pagar com `imposto` é recusado", () => {
  const base = entrada();
  const r = baixaEmLoteSchema.safeParse({
    ...base,
    itens: [{ ...base.itens[0], imposto: { multa_juros: 0, guia_path: null, comprovante_path: "x" } }],
  });
  assert.equal(r.success, false);
});

test("a pagar, a receber e imposto: cada um pela sua action, na ordem", () => {
  const base = entrada();
  const d = validadoPorOrigem({ ...base, itens: [base.itens[0], itemImposto(), base.itens[2]] });
  const m = montarChamadas(d, SEM_RETENCAO);
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.deepEqual(
    m.chamadas.map((c) => c.acao),
    ["pagar", "imposto", "receber_nf"],
  );
});

// ---------------------------------------------------------------------------
// Folha no lote e uma origem por lote (revisão da decisão 140, 05/10/2026)
// ---------------------------------------------------------------------------

const TIPO_PESSOAL = U(30);
const SUB_SALARIO = U(31);

function itemFolha(n: number): EntradaDaBaixaEmLote["itens"][number] {
  return {
    chave: `pagar|folha|${U(40 + n)}`,
    rotulo: `Folha 09/2026 · Pessoa ${n} · Salário`,
    alvo: { modulo: "pagar", origem: "folha", id: U(40 + n) },
    aberto: 4696.9,
    // A folha nasce com o centro de custo dela (Despesa com Pessoal).
    centro: { tipoId: TIPO_PESSOAL, subtipoId: SUB_SALARIO },
  };
}

test("folha entra no lote: baixa como avulso, pelo valor inteiro e com o centro de custo dela", () => {
  const d = baixaEmLoteSchema.parse(entrada({ itens: [itemFolha(1), itemFolha(2)] }));
  const m = montarChamadas(d, new Map());
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.equal(m.chamadas.length, 2);
  assert.deepEqual(m.chamadas[0], {
    acao: "pagar",
    chave: `pagar|folha|${U(41)}`,
    rotulo: "Folha 09/2026 · Pessoa 1 · Salário",
    entrada: {
      origem: "folha",
      id: U(41),
      pago_em: "2026-10-02",
      conta_bancaria_id: CONTA,
      // O do lote (02 · Custo Operacional) não entra no lugar do dela.
      plano_conta_tipo_id: TIPO_PESSOAL,
      plano_conta_subtipo_id: SUB_SALARIO,
      forma_pagamento: "pix",
      cartao_credito_id: null,
      valor_baixa: 4696.9,
      retencoes: [],
    },
  });
});

test("uma origem por lote: o schema recusa o lote misto e diz quais origens", () => {
  const base = entrada();
  const casos: Array<[EntradaDaBaixaEmLote["itens"], string]> = [
    [[base.itens[0], itemFolha(1)], "PP e Folha"],
    // Avulso e Recorrência são origens diferentes, como os chips.
    [[base.itens[1], { ...base.itens[1], chave: `pagar|recorrencia|${U(50)}`, alvo: { modulo: "pagar", origem: "recorrencia", id: U(50) } }], "Avulso e Recorrência"],
    [[base.itens[2], base.itens[3]], "Nota fiscal e Recebimento avulso"],
    [[base.itens[0], base.itens[2]], "PP e Nota fiscal"],
    [[base.itens[1], itemImposto(), itemFolha(1)], "Avulso, Imposto e Folha"],
  ];
  for (const [itens, nomes] of casos) {
    const r = baixaEmLoteSchema.safeParse({ ...base, itens });
    assert.equal(r.success, false, nomes);
    if (r.success) continue;
    assert.ok(
      r.error.issues.some(
        (i) => i.message === `Só uma origem por lote: este mistura ${nomes}. Faça um lote para cada origem.`,
      ),
      nomes,
    );
  }
  // Vários títulos da mesma origem passam.
  assert.equal(baixaEmLoteSchema.safeParse({ ...base, itens: [itemFolha(1), itemFolha(2), itemFolha(3)] }).success, true);
});

test("a origem de cada alvo é o chip da tela", () => {
  assert.equal(origemDoLote({ modulo: "pagar", origem: "pp", id: U(1) }), "pagar|pp");
  assert.equal(origemDoLote({ modulo: "pagar", origem: "folha", id: U(1) }), "pagar|folha");
  assert.equal(origemDoLote({ modulo: "receber", origem: "nf", id: U(1) }), "receber|nf");
  assert.equal(origemDoLote({ modulo: "imposto", id: U(1) }), "imposto");
});

test("seleção: a origem do primeiro marcado desliga as outras", () => {
  const lista = [
    { chave: "f1", origem: "pagar|folha" as const },
    { chave: "p1", origem: "pagar|pp" as const },
    { chave: "f2", origem: "pagar|folha" as const },
    { chave: "a1", origem: "pagar|avulso" as const },
  ];
  // Nada marcado: tudo entra; o cabeçalho, com várias origens, pede a escolha.
  const vazia = selecaoPorOrigem(lista, new Set());
  assert.equal(vazia.origem, null);
  assert.equal(vazia.foraDaOrigem("p1"), null);
  assert.equal(vazia.cabecalho.disponivel, false);
  assert.equal(vazia.cabecalho.motivo, "Marque um título, ou filtre uma origem, para selecionar todos.");

  // Uma folha marcada: PP e avulso ficam de fora; o cabeçalho marca as folhas.
  const comFolha = selecaoPorOrigem(lista, new Set(["f1"]));
  assert.equal(comFolha.origem, "pagar|folha");
  assert.equal(comFolha.foraDaOrigem("f2"), null);
  assert.equal(comFolha.foraDaOrigem("p1"), "Só uma origem por lote: os títulos marcados são de Folha.");
  assert.equal(comFolha.foraDaOrigem("a1"), "Só uma origem por lote: os títulos marcados são de Folha.");
  assert.deepEqual(comFolha.cabecalho.chaves, ["f1", "f2"]);
  assert.equal(comFolha.cabecalho.disponivel, true);
  assert.equal(comFolha.cabecalho.alguns, true);
  assert.equal(comFolha.cabecalho.todos, false);
  assert.equal(comFolha.cabecalho.origem, "Folha");

  // As duas folhas marcadas: o cabeçalho fica cheio (todas da origem).
  const todas = selecaoPorOrigem(lista, new Set(["f1", "f2"]));
  assert.equal(todas.cabecalho.todos, true);
  assert.equal(todas.cabecalho.alguns, false);

  // A lista filtrada numa origem só: o cabeçalho marca todos, sem nome de origem.
  const soPP = selecaoPorOrigem([lista[1], { chave: "p2", origem: "pagar|pp" as const }], new Set());
  assert.equal(soPP.cabecalho.disponivel, true);
  assert.equal(soPP.cabecalho.motivo, null);
  assert.equal(soPP.cabecalho.origem, null);
  assert.deepEqual(soPP.cabecalho.chaves, ["p1", "p2"]);

  // Lista sem nenhum elegível: desligada, sem pedir escolha.
  const nada = selecaoPorOrigem([], new Set());
  assert.equal(nada.cabecalho.disponivel, false);
  assert.equal(nada.cabecalho.motivo, null);
});
