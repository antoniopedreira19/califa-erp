import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lancamentosDaLinha,
  motivoDaTrocaRecusada,
  travaDoTipo,
  trocaDeTipoPermitida,
} from "./alteracao-financeiro";

const nada = { pp: false, ppAEmitir: false, bv: false };

test("linha sem nada lançado troca para qualquer tipo", () => {
  const trava = travaDoTipo("FI", nada);
  assert.deepEqual(trava, { tipo: "livre" });
  for (const t of ["A", "AR", "B", "C", "D", "F", "FI"] as const) {
    assert.equal(trocaDeTipoPermitida(trava, t), true);
  }
});

test("linha com PP troca só entre os tipos com PP (revisão de 28/10/2026)", () => {
  const trava = travaDoTipo("FI", { ...nada, pp: true });
  assert.deepEqual(trava, { tipo: "so_com_pp", lancamento: "pp" });
  for (const t of ["AR", "B", "C", "F", "FI"] as const) {
    assert.equal(trocaDeTipoPermitida(trava, t), true, t);
  }
  assert.equal(trocaDeTipoPermitida(trava, "A"), false);
  assert.equal(trocaDeTipoPermitida(trava, "D"), false);
  assert.match(motivoDaTrocaRecusada(trava, "A", "Filmmaker") ?? "", /"Filmmaker" já tem Pedido de Produção: o tipo de custo só muda entre os tipos que geram PP/);
  assert.equal(motivoDaTrocaRecusada(trava, "AR", "Filmmaker"), null);
});

test("PP a emitir abre do mesmo jeito que a PP", () => {
  const trava = travaDoTipo("B", { ...nada, ppAEmitir: true });
  assert.deepEqual(trava, { tipo: "so_com_pp", lancamento: "pp_a_emitir" });
  assert.equal(trocaDeTipoPermitida(trava, "C"), true);
  assert.equal(trocaDeTipoPermitida(trava, "D"), false);
});

test("BV trava a troca, mesmo com PP na linha", () => {
  const trava = travaDoTipo("AR", { pp: true, ppAEmitir: false, bv: true });
  assert.deepEqual(trava, { tipo: "travado", lancamento: "bv" });
  assert.equal(trocaDeTipoPermitida(trava, "B"), false);
  assert.match(motivoDaTrocaRecusada(trava, "B", "Verba") ?? "", /"Verba" já tem BV: o tipo de custo só muda enquanto nada foi lançado/);
});

test("PP em linha que não é tipo com PP (dado antigo) continua travada", () => {
  const trava = travaDoTipo("A", { ...nada, pp: true });
  assert.deepEqual(trava, { tipo: "travado", lancamento: "pp" });
  assert.equal(trocaDeTipoPermitida(trava, "AR"), false);
});

test("cancelados não contam como lançamento", () => {
  const l = lancamentosDaLinha({
    pps: [{ status: "cancelada" }],
    aEmitir: 0,
    bvs: [{ situacao: "cancelado" }],
  });
  assert.deepEqual(l, nada);
  assert.deepEqual(
    lancamentosDaLinha({ pps: [{ status: "gerada" }], aEmitir: 1, bvs: [{ situacao: "a_negociar" }] }),
    { pp: true, ppAEmitir: true, bv: true },
  );
});
