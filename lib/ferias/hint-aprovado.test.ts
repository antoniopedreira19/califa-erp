import { test } from "node:test";
import assert from "node:assert/strict";
import { hintAprovado } from "./hint-aprovado";
import type { FolhaMin, NfMin } from "./lancamento-enviavel";

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

test("tudo anexado → 'Pronto pra enviar ao financeiro.'", () => {
  const folhas: FolhaMin[] = [
    folha({ origem: "california", tipo_folha_ferias: "usufruto" }),
    folha({ id: "f2", origem: "contabilidade", tipo_folha_ferias: "usufruto", anexo_url: "x" }),
  ];
  const nfs: NfMin[] = [{ escopo_tipo: "ferias_usufruto", escopo_id: LANC }];
  assert.equal(hintAprovado(LANC, folhas, nfs), "Pronto pra enviar ao financeiro.");
});

test("só CLT pendente → 'Aguardando RH anexar o recibo da contabilidade.'", () => {
  const folhas: FolhaMin[] = [
    folha({ origem: "contabilidade", tipo_folha_ferias: "usufruto", anexo_url: null }),
  ];
  assert.equal(
    hintAprovado(LANC, folhas, []),
    "Aguardando RH anexar o recibo da contabilidade.",
  );
});

test("só PJ pendente → 'Aguardando colaborador anexar a NF.'", () => {
  const folhas: FolhaMin[] = [
    folha({ origem: "california", tipo_folha_ferias: "usufruto" }),
  ];
  assert.equal(
    hintAprovado(LANC, folhas, []),
    "Aguardando colaborador anexar a NF.",
  );
});

test("CLT e PJ pendentes → 'Aguardando RH anexar recibo e colaborador anexar NF.'", () => {
  const folhas: FolhaMin[] = [
    folha({ origem: "california", tipo_folha_ferias: "usufruto" }),
    folha({ id: "f2", origem: "contabilidade", tipo_folha_ferias: "usufruto", anexo_url: null }),
  ];
  assert.equal(
    hintAprovado(LANC, folhas, []),
    "Aguardando RH anexar recibo e colaborador anexar NF.",
  );
});
