import { test } from "node:test";
import assert from "node:assert/strict";
import { acimaDoOrcado, bloqueioAprovacaoPorLimites, bloqueioGeracaoPPPorLimite, rentabilidadeAbaixoDoMinimo } from "./limites-orcamento";
import { somaDasPPsNaoCanceladas } from "./pps-item";
import type { AppRole } from "@/lib/types";

const papeis: AppRole[] = ["administrador", "gerente_producao", "produtor", "freelancer", "financeiro", "rh", "colaborador"];

test("planejado maior que o orçado exige administrador mesmo com margem alta", () => {
  const itens = [{ orcado: 100, planejado: 101 }, { orcado: 900, planejado: 100 }];
  const excedeu = itens.some((i) => acimaDoOrcado(i.planejado, i.orcado));
  for (const papel of papeis) {
    assert.equal(bloqueioAprovacaoPorLimites(papel, excedeu, 70) === null, papel === "administrador");
  }
});

test("resultado positivo abaixo de 20% exige administrador; 20% exatos liberam", () => {
  for (const margem of [19.99, 0, -10]) {
    for (const papel of papeis) {
      assert.equal(bloqueioAprovacaoPorLimites(papel, false, margem) === null, papel === "administrador");
    }
  }
  assert.equal(bloqueioAprovacaoPorLimites("gerente_producao", false, 20), null);
  assert.equal(bloqueioAprovacaoPorLimites("gerente_producao", false, null), null);
  assert.equal(rentabilidadeAbaixoDoMinimo(19.999), true);
  assert.equal(rentabilidadeAbaixoDoMinimo(20 - Number.EPSILON), false);
});

test("igualdade monetária libera; um centavo acima acende e barra", () => {
  assert.equal(acimaDoOrcado(100, 100), false);
  assert.equal(acimaDoOrcado(0.1 + 0.2, 0.3), false);
  assert.equal(acimaDoOrcado(100.01, 100), true);
  assert.equal(acimaDoOrcado(0.01, 0), true);
});

test("PP menor que o orçado barra quando o acumulado ultrapassa, sem duplicar a gerada", () => {
  const realizado = somaDasPPsNaoCanceladas([
    { valor: 60, status: "pago" },
    { valor: 41, status: "gerada" },
    { valor: 1000, status: "cancelada" },
  ]);
  assert.equal(realizado, 101);
  for (const papel of papeis) {
    assert.equal(bloqueioGeracaoPPPorLimite(papel, realizado, 100) === null, papel === "administrador");
  }
  assert.equal(bloqueioGeracaoPPPorLimite("gerente_producao", 100, 100), null);
  assert.equal(bloqueioGeracaoPPPorLimite("produtor", 101, 100)?.includes("administrador"), true);
});

test("devolução aprovada reduz o realizado; rejeitada conta até cancelar", () => {
  const soma = somaDasPPsNaoCanceladas([{ valor: 80, status: "rejeitada" }, { valor: 40, status: "gerada" }]);
  assert.ok(bloqueioGeracaoPPPorLimite("gerente_producao", soma, 100));
  assert.equal(bloqueioGeracaoPPPorLimite("gerente_producao", soma - 20, 100), null);
});

test("os dois motivos da aprovação aparecem juntos", () => {
  const motivo = bloqueioAprovacaoPorLimites("gerente_producao", true, 19);
  assert.match(motivo!, /planejado acima do orçado/);
  assert.match(motivo!, /resultado geral está abaixo de 20%/);
});


test("edição substitui o valor anterior e só bloqueia o novo acumulado excedente", () => {
  const realizado = 100, valorAnterior = 40;
  assert.equal(bloqueioGeracaoPPPorLimite("produtor", realizado - valorAnterior + 40, 100), null);
  assert.ok(bloqueioGeracaoPPPorLimite("produtor", realizado - valorAnterior + 40.01, 100));
  assert.equal(bloqueioGeracaoPPPorLimite("administrador", realizado - valorAnterior + 200, 100), null);
});
