import { test } from "node:test";
import assert from "node:assert/strict";
import {
  competenciaCurta,
  competenciaLonga,
  competenciasParaLiberar,
  estadoDaLiberacao,
  frase,
  jobFechado,
  liberacaoDaLinha,
  rotuloDoTipoDaPP,
  trimestreDeHoje,
} from "./pagamentos-atrasados";

// Pagamentos atrasados em job fechado (decisão 259): os textos e as contas
// que as telas repetem. As regras moram no banco.

test("competências: do trimestre do job até o seguinte ao de hoje", () => {
  assert.deepEqual(competenciasParaLiberar({ trimestre: 3, ano: 2026 }, "2026-11-16"), [
    { trimestre: 3, ano: 2026 },
    { trimestre: 4, ano: 2026 },
    { trimestre: 1, ano: 2027 },
  ]);
});

test("competências: atravessa o ano a partir de um job antigo", () => {
  const lista = competenciasParaLiberar({ trimestre: 4, ano: 2025 }, "2026-02-10");
  assert.deepEqual(lista[0], { trimestre: 4, ano: 2025 });
  assert.deepEqual(lista.at(-1), { trimestre: 2, ano: 2026 });
  assert.equal(lista.length, 3);
});

test("competências: sem trimestre no job, de hoje ao seguinte", () => {
  assert.deepEqual(competenciasParaLiberar({ trimestre: null, ano: null }, "2026-05-31"), [
    { trimestre: 2, ano: 2026 },
    { trimestre: 3, ano: 2026 },
  ]);
});

test("trimestre de hoje", () => {
  assert.deepEqual(trimestreDeHoje("2026-01-01"), { trimestre: 1, ano: 2026 });
  assert.deepEqual(trimestreDeHoje("2026-03-31"), { trimestre: 1, ano: 2026 });
  assert.deepEqual(trimestreDeHoje("2026-04-01"), { trimestre: 2, ano: 2026 });
  assert.deepEqual(trimestreDeHoje("2026-12-31"), { trimestre: 4, ano: 2026 });
});

test("competência curta nos selos, longa nos textos", () => {
  assert.equal(competenciaCurta(4, 2026), "4T/26");
  assert.equal(competenciaLonga(4, 2026), "4T/2026");
});

test("estado da liberação", () => {
  const base = liberacaoDaLinha({
    id: "l1",
    trimestre: 4,
    ano: 2026,
    motivo: "Fornecedor mandou a nota depois",
    liberado_em: "2026-11-16T12:00:00Z",
    conclusao_pedida_em: null,
    encerrado_em: null,
    liberado_por_profile: [{ nome: "COLABORADOR 001 EXEMPLO" }],
    conclusao_pedida_por_profile: null,
  });
  assert.equal(base.liberadoPorNome, "COLABORADOR 001 EXEMPLO");
  assert.equal(estadoDaLiberacao(null), null);
  assert.equal(estadoDaLiberacao(base), "aberta");
  assert.equal(estadoDaLiberacao({ ...base, conclusaoPedidaEm: "2026-11-17T12:00:00Z" }), "conclusao_pedida");
  assert.equal(
    estadoDaLiberacao({ ...base, conclusaoPedidaEm: "2026-11-17T12:00:00Z", encerradoEm: "2026-11-18T12:00:00Z" }),
    "encerrada",
  );
});

test("o nome de quem pediu a conclusão só vem com a conclusão pedida", () => {
  const l = liberacaoDaLinha({
    id: "l1",
    trimestre: 4,
    ano: 2026,
    motivo: null,
    liberado_em: "2026-11-16T12:00:00Z",
    conclusao_pedida_em: null,
    encerrado_em: null,
    liberado_por_profile: { nome: "COLABORADOR 001 EXEMPLO" },
    conclusao_pedida_por_profile: { nome: "COLABORADOR 002 EXEMPLO" },
  });
  assert.equal(l.conclusaoPedidaPorNome, null);
  assert.equal(l.motivo, "");
});

test("tipo da PP: verba, reembolso e cartão; a normal fica sem campo", () => {
  assert.equal(rotuloDoTipoDaPP({ verba_producao: true, tipo_verba: "verba" }), "Verba");
  assert.equal(rotuloDoTipoDaPP({ verba_producao: true, tipo_verba: "reembolso" }), "Reembolso");
  assert.equal(rotuloDoTipoDaPP({ verba_producao: false, cartao_corporativo: true }), "Cartão corporativo");
  assert.equal(rotuloDoTipoDaPP({ verba_producao: false, cartao_corporativo: false }), null);
});

test("job fechado: encerrado ou finalizado", () => {
  assert.equal(jobFechado("encerrado"), true);
  assert.equal(jobFechado("finalizado"), true);
  assert.equal(jobFechado("aberto"), false);
  assert.equal(jobFechado(null), false);
});

test("frase termina com um ponto só", () => {
  assert.equal(frase("Nota chegou depois"), "Nota chegou depois.");
  assert.equal(frase("Nota chegou depois. "), "Nota chegou depois.");
});
