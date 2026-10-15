import test from "node:test";
import assert from "node:assert/strict";
import { cnpjPadraoDaPP, documentoTemCnpj, emissoraDosDocumentos } from "./cnpj-da-pp";

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

test("A empresa emissora segue o documento: NF, fatura e recibo (revisão da 156)", () => {
  const nf = (t: string | null) => ({ documento_tipo: "nota_fiscal" as const, nf_tomador_estabelecimento_id: t });
  // Sem documento com CNPJ, vale a escolha do formulário.
  assert.deepEqual(emissoraDosDocumentos([]), { tipo: "nenhum" });
  assert.deepEqual(
    emissoraDosDocumentos([
      { documento_tipo: "boleto", nf_tomador_estabelecimento_id: "gocrazy" },
      { documento_tipo: "outro", nf_tomador_estabelecimento_id: null },
      nf(null),
    ]),
    { tipo: "nenhum" },
  );
  // Nota, fatura e recibo no mesmo CNPJ: ele é a empresa emissora.
  assert.deepEqual(
    emissoraDosDocumentos([
      nf("california"),
      { documento_tipo: "fatura", nf_tomador_estabelecimento_id: "california" },
      { documento_tipo: "recibo", nf_tomador_estabelecimento_id: "california" },
    ]),
    { tipo: "documento", estabelecimentoId: "california" },
  );
  // Documentos em CNPJs diferentes não definem a emissora.
  assert.deepEqual(
    emissoraDosDocumentos([nf("california"), { documento_tipo: "fatura", nf_tomador_estabelecimento_id: "gocrazy" }]),
    { tipo: "divergente", estabelecimentos: ["california", "gocrazy"] },
  );
  // Boleto e contrato não dizem o CNPJ, mesmo com o campo preenchido.
  assert.equal(documentoTemCnpj("boleto"), false);
  assert.equal(documentoTemCnpj("contrato"), false);
  assert.equal(documentoTemCnpj(null), false);
  assert.equal(documentoTemCnpj("fatura"), true);
});
