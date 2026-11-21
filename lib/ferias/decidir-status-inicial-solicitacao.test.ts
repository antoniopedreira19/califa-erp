import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirStatusInicialSolicitacao } from "./decidir-status-inicial-solicitacao";

test("com líder → aguardando_gestor", () => {
  assert.equal(
    decidirStatusInicialSolicitacao({
      liderId: "11111111-1111-1111-1111-111111111111",
    }),
    "aguardando_gestor",
  );
});

test("sem líder (null) → pendente_aprovacao (pula etapa do líder)", () => {
  assert.equal(
    decidirStatusInicialSolicitacao({ liderId: null }),
    "pendente_aprovacao",
  );
});

test("liderId string vazia → pendente_aprovacao", () => {
  assert.equal(
    decidirStatusInicialSolicitacao({ liderId: "" }),
    "pendente_aprovacao",
  );
});

test("liderId só de espaços → pendente_aprovacao", () => {
  assert.equal(
    decidirStatusInicialSolicitacao({ liderId: "   " }),
    "pendente_aprovacao",
  );
});

test("auto-liderança (anti-cadastro) → aguardando_gestor (deixa passar; fase 2 trava)", () => {
  // Caso de borda: o colaborador é seu próprio líder. A função não checa;
  // só olha se tem líder. O guard semântico fica na fase 2.
  assert.equal(
    decidirStatusInicialSolicitacao({
      liderId: "22222222-2222-2222-2222-222222222222",
    }),
    "aguardando_gestor",
  );
});
