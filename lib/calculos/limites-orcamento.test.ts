import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REGRAS_PADRAO_DO_COMITE,
  acimaDoOrcado,
  aprovaDiretoSemComite,
  bloqueioGeracaoPPPeloComite,
  motivosDaVersaoNoComite,
  ppPassaDoOrcadoNoComite,
  rentabilidadeAbaixoDoMinimo,
  versaoCobertaPeloComite,
  type RegrasDoComite,
} from "./limites-orcamento";
import { somaDasPPsNaoCanceladas } from "./pps-item";
import type { AppRole } from "@/lib/types";

const papeis: AppRole[] = ["administrador", "gerente_producao", "produtor", "freelancer", "financeiro", "rh", "colaborador"];
const R = REGRAS_PADRAO_DO_COMITE;
const com = (r: Partial<RegrasDoComite>): RegrasDoComite => ({ ...R, ...r });

test("planejado maior que o orçado leva ao Comitê mesmo com margem alta", () => {
  const itens = [{ orcado: 100, planejado: 101 }, { orcado: 900, planejado: 100 }];
  const itensAcima = itens.filter((i) => acimaDoOrcado(i.planejado, i.orcado)).length;
  assert.deepEqual(motivosDaVersaoNoComite(R, { itensAcima, resultadoGeral: 70, excecaoNoFechamento: false }, false), [
    "há 1 item com planejado acima do orçado",
  ]);
  assert.deepEqual(motivosDaVersaoNoComite(com({ planejadoLigado: false }), { itensAcima, resultadoGeral: 70, excecaoNoFechamento: false }, false), []);
});

test("resultado abaixo do mínimo leva ao Comitê; o mínimo exato libera", () => {
  for (const margem of [19.99, 0, -10]) {
    assert.equal(motivosDaVersaoNoComite(R, { itensAcima: 0, resultadoGeral: margem, excecaoNoFechamento: false }, false).length, 1);
  }
  assert.deepEqual(motivosDaVersaoNoComite(R, { itensAcima: 0, resultadoGeral: 20, excecaoNoFechamento: false }, false), []);
  assert.deepEqual(motivosDaVersaoNoComite(R, { itensAcima: 0, resultadoGeral: null, excecaoNoFechamento: false }, false), []);
  assert.deepEqual(motivosDaVersaoNoComite(com({ resultadoMinimo: 15 }), { itensAcima: 0, resultadoGeral: 18, excecaoNoFechamento: false }, false), []);
  assert.deepEqual(motivosDaVersaoNoComite(com({ resultadoLigado: false }), { itensAcima: 0, resultadoGeral: 5, excecaoNoFechamento: false }, false), []);
  assert.equal(rentabilidadeAbaixoDoMinimo(19.999), true);
  assert.equal(rentabilidadeAbaixoDoMinimo(20 - Number.EPSILON), false);
});

test("os dois motivos da aprovação aparecem juntos", () => {
  const m = motivosDaVersaoNoComite(R, { itensAcima: 2, resultadoGeral: 8.6214, excecaoNoFechamento: false }, false);
  assert.equal(m[0], "há 2 itens com planejado acima do orçado");
  assert.equal(m[1], "o resultado geral está em 8,6%, abaixo do mínimo de 20%");
});

test("serviço Interno não passa pelo Comitê, nem com resultado zero", () => {
  assert.deepEqual(motivosDaVersaoNoComite(R, { itensAcima: 0, resultadoGeral: 0, excecaoNoFechamento: false }, true), []);
  assert.deepEqual(motivosDaVersaoNoComite(R, { itensAcima: 3, resultadoGeral: -5, excecaoNoFechamento: false }, true), []);
});

test("só o administrador aprova direto, e só com a regra dele ligada", () => {
  for (const papel of papeis) assert.equal(aprovaDiretoSemComite(papel, R), papel === "administrador");
  assert.equal(aprovaDiretoSemComite("administrador", com({ adminDireto: false })), false);
});

test("volta ao Comitê só se piorar: mais itens acima ou resultado menor", () => {
  const aprovado = { itensAcima: 2, resultadoGeral: 15 };
  assert.equal(versaoCobertaPeloComite(aprovado, { itensAcima: 2, resultadoGeral: 15 }), true);
  assert.equal(versaoCobertaPeloComite(aprovado, { itensAcima: 1, resultadoGeral: 17 }), true);
  assert.equal(versaoCobertaPeloComite(aprovado, { itensAcima: 3, resultadoGeral: 17 }), false);
  assert.equal(versaoCobertaPeloComite(aprovado, { itensAcima: 2, resultadoGeral: 14.9 }), false);
  assert.equal(versaoCobertaPeloComite(null, { itensAcima: 0, resultadoGeral: 30 }), false);
});

test("igualdade monetária libera; um centavo acima acende", () => {
  assert.equal(acimaDoOrcado(100, 100), false);
  assert.equal(acimaDoOrcado(0.1 + 0.2, 0.3), false);
  assert.equal(acimaDoOrcado(100.01, 100), true);
  assert.equal(acimaDoOrcado(0.01, 0), true);
});

const pp = (over: Partial<Parameters<typeof bloqueioGeracaoPPPeloComite>[0]>) =>
  bloqueioGeracaoPPPeloComite({
    papel: "produtor",
    regras: R,
    realizadoComAPP: 101,
    orcado: 100,
    linhaVermelha: false,
    valor: 41,
    valorAprovado: null,
    ...over,
  });

test("PP que leva o acumulado acima do orçado vai ao Comitê, sem duplicar a gerada", () => {
  const realizado = somaDasPPsNaoCanceladas([
    { valor: 60, status: "pago" },
    { valor: 41, status: "gerada" },
    { valor: 1000, status: "cancelada" },
  ]);
  assert.equal(realizado, 101);
  for (const papel of papeis) {
    assert.equal(pp({ papel, realizadoComAPP: realizado }) === null, papel === "administrador");
  }
  assert.equal(pp({ realizadoComAPP: 100 }), null);
  assert.match(pp({})!, /Comitê de Aprovações/);
  assert.ok(pp({ papel: "administrador", regras: com({ adminDireto: false }) }));
  assert.equal(pp({ regras: com({ ppLigado: false }) }), null);
});

test("devolução aprovada reduz o realizado; rejeitada conta até cancelar", () => {
  const soma = somaDasPPsNaoCanceladas([{ valor: 80, status: "rejeitada" }, { valor: 40, status: "gerada" }]);
  assert.ok(pp({ realizadoComAPP: soma }));
  assert.equal(pp({ realizadoComAPP: soma - 20 }), null);
});

test("linha vermelha só vai ao Comitê com a regra dela ligada", () => {
  assert.equal(pp({ realizadoComAPP: 5000, orcado: 0, linhaVermelha: true }), null);
  assert.ok(pp({ realizadoComAPP: 5000, orcado: 0, linhaVermelha: true, regras: com({ linhasVermelhas: true }) }));
  assert.ok(pp({ realizadoComAPP: 5000, orcado: 0, linhaVermelha: false }));
});

test("tolerância: abaixo dos dois limites a PP segue sem o Comitê", () => {
  const regras = com({ toleranciaLigada: true, toleranciaValor: 500, toleranciaPct: 5 });
  // Orçado 10.000: 5% = 500. Excesso 400 passa; 600 não; 10.000 + 400 em
  // orçado de 1.000 (5% = 50) também não.
  assert.equal(ppPassaDoOrcadoNoComite(regras, 10_400, 10_000, false), false);
  assert.equal(ppPassaDoOrcadoNoComite(regras, 10_600, 10_000, false), true);
  assert.equal(ppPassaDoOrcadoNoComite(regras, 1_400, 1_000, false), true);
});

test("PP aprovada volta ao Comitê só se ficar mais cara", () => {
  assert.equal(pp({ valor: 1000, valorAprovado: 1000 }), null);
  assert.equal(pp({ valor: 900, valorAprovado: 1000 }), null);
  assert.ok(pp({ valor: 1000.01, valorAprovado: 1000 }));
});

test("decisão 225: a exceção no fechamento leva a versão ao Comitê enquanto existir", () => {
  const base = { itensAcima: 0, resultadoGeral: 40 };
  assert.deepEqual(motivosDaVersaoNoComite(R, { ...base, excecaoNoFechamento: true }, false), [
    "há exceção no fechamento do internacional",
  ]);
  // Taxas de volta ao padrão: a exceção sai, e a versão aprova direto.
  assert.deepEqual(motivosDaVersaoNoComite(R, { ...base, excecaoNoFechamento: false }, false), []);
  // Regra desligada nas Configurações.
  assert.deepEqual(motivosDaVersaoNoComite(com({ excecaoLigada: false }), { ...base, excecaoNoFechamento: true }, false), []);
});
