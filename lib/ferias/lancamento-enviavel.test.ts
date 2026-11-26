import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lancamentoEnviavel,
  type FolhaMin,
  type NfMin,
} from "./lancamento-enviavel";

const LANC = "lanc-1";

function folha(partial: Partial<FolhaMin>): FolhaMin {
  return {
    id: "f1",
    origem: "california",
    tipo_folha_ferias: "usufruto",
    status: "rascunho",
    anexo_url: null,
    ...partial,
  };
}

function nf(
  tipo: "ferias_usufruto" | "ferias_abono",
  escopoId: string = LANC,
): NfMin {
  return { escopo_tipo: tipo, escopo_id: escopoId };
}

test("PJ com NF usufruto anexada → ok", () => {
  const folhas: FolhaMin[] = [folha({ origem: "california", tipo_folha_ferias: "usufruto" })];
  const nfs: NfMin[] = [nf("ferias_usufruto")];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, nfs), { ok: true });
});

test("PJ sem NF → falta 'NF de férias'", () => {
  const folhas: FolhaMin[] = [folha({ origem: "california", tipo_folha_ferias: "usufruto" })];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, []), {
    ok: false,
    falta: ["NF de férias"],
  });
});

test("CLT com anexo_url → ok", () => {
  const folhas: FolhaMin[] = [
    folha({ origem: "contabilidade", tipo_folha_ferias: "usufruto", anexo_url: "path/x.pdf" }),
  ];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, []), { ok: true });
});

test("CLT sem anexo_url → falta 'Recibo da contabilidade'", () => {
  const folhas: FolhaMin[] = [
    folha({ origem: "contabilidade", tipo_folha_ferias: "usufruto", anexo_url: null }),
  ];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, []), {
    ok: false,
    falta: ["Recibo da contabilidade"],
  });
});

test("CLT abono sem anexo → falta 'Recibo de abono California'", () => {
  const folhas: FolhaMin[] = [
    folha({ origem: "contabilidade", tipo_folha_ferias: "abono", anexo_url: null }),
  ];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, []), {
    ok: false,
    falta: ["Recibo de abono California"],
  });
});

test("Híbrido completo (NF + recibo) → ok", () => {
  const folhas: FolhaMin[] = [
    folha({ id: "f-ca", origem: "california", tipo_folha_ferias: "usufruto" }),
    folha({ id: "f-ct", origem: "contabilidade", tipo_folha_ferias: "usufruto", anexo_url: "x" }),
  ];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, [nf("ferias_usufruto")]), { ok: true });
});

test("Híbrido só NF → falta recibo", () => {
  const folhas: FolhaMin[] = [
    folha({ id: "f-ca", origem: "california", tipo_folha_ferias: "usufruto" }),
    folha({ id: "f-ct", origem: "contabilidade", tipo_folha_ferias: "usufruto", anexo_url: null }),
  ];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, [nf("ferias_usufruto")]), {
    ok: false,
    falta: ["Recibo da contabilidade"],
  });
});

test("Híbrido só recibo → falta NF", () => {
  const folhas: FolhaMin[] = [
    folha({ id: "f-ca", origem: "california", tipo_folha_ferias: "usufruto" }),
    folha({ id: "f-ct", origem: "contabilidade", tipo_folha_ferias: "usufruto", anexo_url: "x" }),
  ];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, []), {
    ok: false,
    falta: ["NF de férias"],
  });
});

test("Folhas já enviadas não entram na conta", () => {
  const folhas: FolhaMin[] = [
    folha({ origem: "california", tipo_folha_ferias: "usufruto", status: "enviada" }),
  ];
  assert.deepEqual(lancamentoEnviavel(LANC, folhas, []), { ok: true });
});

test("Lançamento sem folhas → falta por não ter folha", () => {
  assert.deepEqual(lancamentoEnviavel(LANC, [], []), {
    ok: false,
    falta: ["Nenhuma folha gerada"],
  });
});
