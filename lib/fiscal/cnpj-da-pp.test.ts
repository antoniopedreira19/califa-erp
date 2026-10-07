import test from "node:test";
import assert from "node:assert/strict";
import { cnpjPadraoDaPP } from "./cnpj-da-pp";

const regras = {
  porRegional: { ss: "gocrazy" } as Record<string, string>,
  porEmpresa: { california: "california", hitlab: "hitlab", cch: "california" } as Record<string, string>,
  geral: "california",
  ativos: new Set(["california", "gocrazy", "hitlab"]),
};

test("CNPJ padrão da PP: a regional manda, depois a gerencial, depois a principal (decisão 156)", () => {
  // SS da Agência California sai pela GoCrazy.
  assert.equal(cnpjPadraoDaPP({ regional_id: "ss", empresa_id: "california" }, regras), "gocrazy");
  // Outras regionais da California: o CNPJ da California.
  assert.equal(cnpjPadraoDaPP({ regional_id: "ne", empresa_id: "california" }, regras), "california");
  // Job da Hitlab: o CNPJ da Hitlab.
  assert.equal(cnpjPadraoDaPP({ regional_id: "hitlab", empresa_id: "hitlab" }, regras), "hitlab");
  // Gerencial sem CNPJ no cadastro (CCH): a principal.
  assert.equal(cnpjPadraoDaPP({ regional_id: "doca", empresa_id: "cch" }, regras), "california");
  assert.equal(cnpjPadraoDaPP({ regional_id: null, empresa_id: null }, regras), "california");
});

test("CNPJ padrão da PP: CNPJ inativo não vale", () => {
  const semGoCrazy = { ...regras, ativos: new Set(["california", "hitlab"]) };
  assert.equal(cnpjPadraoDaPP({ regional_id: "ss", empresa_id: "california" }, semGoCrazy), "california");
  assert.equal(cnpjPadraoDaPP({ regional_id: "ss", empresa_id: "x" }, { ...semGoCrazy, geral: null }), null);
});
