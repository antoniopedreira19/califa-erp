/**
 * O rateio da guia por empresa gerencial (decisão 277).
 *
 * Rodar: node --import tsx --test lib/fiscal/rateio-gerencial.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RateioDaGuia } from "./apuracao";
import { dividirGerencial, gerenciaisDaBase, rateioPorGerencial, type RegrasDoRateio } from "./rateio-gerencial";

const CAL = "cal";
const CCH = "cch";
const HIT = "hit";
const REGRAS: RegrasDoRateio = {
  empresas: [
    { id: CAL, nome: "Agência California", regionais: [{ id: "ne", nome: "NE" }, { id: "sp", nome: "SP" }, { id: "ss", nome: "SS" }] },
    { id: CCH, nome: "CCH", regionais: [{ id: "doca", nome: "Doca" }, { id: "agency", nome: "Agency" }] },
    { id: HIT, nome: "Hitlab", regionais: [{ id: "hitlab", nome: "Hitlab" }] },
  ],
  regionalDoCnpj: null,
};
const b = (empresa_id: string, regional_id: string | null, valor: number): RateioDaGuia => ({
  empresa_id,
  empresa_nome: empresa_id,
  regional_id,
  regional_nome: regional_id ? regional_id.toUpperCase() : null,
  valor,
  pct: 0,
});
// O rateio do sistema (pela receita): California 75% (NE 600, SP 150), CCH 25% (Doca 250), um resto sem regional.
const BASE = [b(CAL, "ne", 600), b(CAL, "sp", 150), b(CCH, "doca", 250), b(CAL, null, 100)];

test("dentro da gerencial, as regionais dividem pela receita; a parte sem regional fica fora", () => {
  const d = dividirGerencial({ empresa_id: CAL, valor: 1000, regional_id: null }, BASE, REGRAS);
  assert.equal(d.como, "receita");
  assert.deepEqual(
    d.partes.map((p) => [p.regional_id, p.valor, p.pct]),
    [
      ["ne", 800, 80],
      ["sp", 200, 20],
    ],
  );
});

test("a gerencial de uma regional só vai inteira para ela (Hitlab)", () => {
  const d = dividirGerencial({ empresa_id: HIT, valor: 300, regional_id: null }, BASE, REGRAS);
  assert.equal(d.como, "regional_unica");
  assert.deepEqual(d.partes.map((p) => [p.regional_id, p.valor]), [["hitlab", 300]]);
});

test("o CNPJ com regional padrão leva a parte da gerencial dele para ela (GoCrazy → SS)", () => {
  const regras = { ...REGRAS, regionalDoCnpj: { empresa_id: CAL, regional_id: "ss" } };
  const d = dividirGerencial({ empresa_id: CAL, valor: 500, regional_id: null }, BASE, regras);
  assert.equal(d.como, "regional_do_cnpj");
  assert.deepEqual(d.partes.map((p) => [p.regional_id, p.valor]), [["ss", 500]]);
  // A outra gerencial da mesma guia segue pela receita.
  assert.equal(dividirGerencial({ empresa_id: CCH, valor: 100, regional_id: null }, BASE, regras).como, "receita");
});

test("sem receita da gerencial no período, a regional é escolhida (e sem escolha, não fecha)", () => {
  const sem = dividirGerencial({ empresa_id: CCH, valor: 100, regional_id: null }, [b(CAL, "ne", 10)], REGRAS);
  assert.equal(sem.como, "sem_regional");
  const escolhida = dividirGerencial({ empresa_id: CCH, valor: 100, regional_id: "agency" }, [b(CAL, "ne", 10)], REGRAS);
  assert.deepEqual(escolhida.partes.map((p) => [p.regional_id, p.valor]), [["agency", 100]]);
});

test("o rateio final fecha com a guia e confere as gerenciais", () => {
  const r = rateioPorGerencial(
    [
      { empresa_id: CAL, valor: 700, regional_id: null },
      { empresa_id: CCH, valor: 300, regional_id: null },
    ],
    BASE,
    REGRAS,
    1000,
  );
  assert.ok(r.ok);
  if (r.ok)
    assert.deepEqual(
      r.rateio.map((x) => [x.empresa_id, x.regional_id, x.valor, x.pct]),
      [
        [CAL, "ne", 560, 56],
        [CAL, "sp", 140, 14],
        [CCH, "doca", 300, 30],
      ],
    );
  const naoFecha = rateioPorGerencial([{ empresa_id: CAL, valor: 900, regional_id: null }], BASE, REGRAS, 1000);
  assert.equal(naoFecha.ok, false);
  const repetida = rateioPorGerencial(
    [
      { empresa_id: CAL, valor: 500, regional_id: null },
      { empresa_id: CAL, valor: 500, regional_id: null },
    ],
    BASE,
    REGRAS,
    1000,
  );
  assert.equal(repetida.ok, false);
});

test("a sugestão por gerencial vem do rateio do sistema (com a parte sem regional), levada ao valor da guia", () => {
  // California 850 (600 + 150 + 100 sem regional) e CCH 250, de 1.100.
  assert.deepEqual(
    gerenciaisDaBase(BASE, 2000, null).map((p) => [p.empresa_id, p.valor]),
    [
      [CAL, 1545.45],
      [CCH, 454.55],
    ],
  );
  assert.deepEqual(gerenciaisDaBase([], 2000, CAL), [{ empresa_id: CAL, valor: 2000, regional_id: null }]);
});
