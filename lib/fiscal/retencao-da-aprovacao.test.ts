/**
 * As retenções da aprovação da PP na baixa (módulo fiscal, entrega 1).
 * Rodar: node --import tsx --test lib/fiscal/retencao-da-aprovacao.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diaEmSaoPaulo,
  montarRetencaoDaAprovacao,
  parcelaDePPDaChave,
  textoDaRetencaoDaAprovacao,
} from "./retencao-da-aprovacao";

const PARCELA = "3f2a9c1e-7b4d-4e8a-9f10-1a2b3c4d5e6f";

test("a parcela de PP sai da chave que a lista monta (origem-id-baixas)", () => {
  assert.equal(parcelaDePPDaChave(`pp-${PARCELA}-0`), PARCELA);
  assert.equal(parcelaDePPDaChave(`pp-${PARCELA}-12`), PARCELA);
  assert.equal(parcelaDePPDaChave(`pp-${PARCELA.toUpperCase()}-1`), PARCELA);
});

test("outras origens não têm retenção da aprovação", () => {
  assert.equal(parcelaDePPDaChave(`pp_devolucao_verba-${PARCELA}-0`), null);
  assert.equal(parcelaDePPDaChave(`avulso-${PARCELA}-0`), null);
  assert.equal(parcelaDePPDaChave(`recorrencia-${PARCELA}-0`), null);
  assert.equal(parcelaDePPDaChave(`pp-${PARCELA}`), null);
  assert.equal(parcelaDePPDaChave("pp-nao-e-uuid-0"), null);
  assert.equal(parcelaDePPDaChave(""), null);
});

test("o dia da aprovação é o de Brasília, não o de UTC", () => {
  // 22h30 de 20/10 em Brasília = 01h30 de 21/10 em UTC.
  assert.equal(diaEmSaoPaulo("2026-10-21T01:30:00+00:00"), "2026-10-20");
  assert.equal(diaEmSaoPaulo("2026-10-20T12:00:00-03:00"), "2026-10-20");
  assert.equal(diaEmSaoPaulo(null), null);
  assert.equal(diaEmSaoPaulo("não é data"), null);
});

test("as linhas viram as alíquotas da baixa; numeric em texto também", () => {
  const r = montarRetencaoDaAprovacao(
    [
      { imposto: "PIS", aliquota: "0.6500" },
      { imposto: "COFINS", aliquota: 3 },
      { imposto: "CSLL", aliquota: "1" },
      { imposto: "IRRF", aliquota: 1.5 },
    ],
    "2026-10-20",
  );
  assert.deepEqual(r, {
    data: "2026-10-20",
    aliquotas: { PIS: 0.65, COFINS: 3, CSLL: 1, IRRF: 1.5 },
    remessa: null,
  });
});

test("sem alíquota gravada, a baixa abre como antes (null)", () => {
  assert.equal(montarRetencaoDaAprovacao([], "2026-10-20"), null);
  assert.equal(
    montarRetencaoDaAprovacao(
      [
        { imposto: "ISS", aliquota: 0 },
        { imposto: "INSS", aliquota: 11 },
        { imposto: "IRRF", aliquota: null },
      ],
      "2026-10-20",
    ),
    null,
  );
});

test("só o ISS retido também vale", () => {
  assert.deepEqual(montarRetencaoDaAprovacao([{ imposto: "ISS", aliquota: "5.0000" }], null), {
    data: null,
    aliquotas: { ISS: 5 },
    remessa: null,
  });
});

test("o texto da ajuda leva a data da aprovação", () => {
  assert.equal(
    textoDaRetencaoDaAprovacao({ data: "2026-10-20", aliquotas: { IRRF: 1.5 }, remessa: null }),
    "Retenções informadas na aprovação da PP (20/10/2026) · editáveis",
  );
  assert.equal(
    textoDaRetencaoDaAprovacao({ data: null, aliquotas: { IRRF: 1.5 }, remessa: null }),
    "Retenções informadas na aprovação da PP · editáveis",
  );
  // Decisão 145: na remessa que pagou o líquido, a ajuda diz quanto o banco pagou.
  assert.equal(
    textoDaRetencaoDaAprovacao({ data: "2026-10-20", aliquotas: { IRRF: 1.5 }, remessa: { liquido: 7508 } }).replace(/\u00a0/g, " "),
    "Retenção da aprovação, descontada na remessa: o banco pagou R$ 7.508,00 · a baixa repete esse líquido",
  );
});
