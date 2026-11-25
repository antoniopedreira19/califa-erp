/**
 * O rateio da guia por empresa gerencial (decisão 277).
 *
 * Rodar: node --import tsx --test lib/fiscal/rateio-gerencial.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RateioDaGuia } from "./apuracao";
import { dividirGerencial, pelaBase, pelaReceita, rateioAutomatico, rateioPorGerencial, type RegrasDoRateio } from "./rateio-gerencial";

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
  pelaReceita: true,
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

test("decisão 277 §10: TDs (REC) — a guia inteira divide pela receita de cada regional, sem valor por gerencial", () => {
  assert.equal(pelaReceita("ISS"), true);
  assert.equal(pelaReceita("IRPJ"), true);
  assert.equal(pelaReceita("ISS_RET"), false);
  assert.equal(pelaReceita("IOF"), false);
  // Receita com regional: NE 600, SP 150, Doca 250 (os 100 sem regional ficam fora) — levados a 2.200.
  assert.deepEqual(
    pelaBase(BASE, 2200).map((p) => [p.empresa_id, p.regional_id, p.valor]),
    [
      [CAL, "ne", 1320],
      [CAL, "sp", 330],
      [CCH, "doca", 550],
    ],
  );
  // A parte que arredondaria a zero sai, e o resto fecha no centavo.
  assert.deepEqual(
    pelaBase([b(CAL, "ne", 999_999), b(CAL, "sp", 1)], 0.5).map((p) => [p.regional_id, p.valor]),
    [["ne", 0.5]],
  );
  const iss = rateioAutomatico({ tributo: "ISS", base: BASE, regras: REGRAS, gerencialDoCnpj: CAL, total: 1000 });
  assert.ok(iss.ok);
  if (iss.ok) assert.equal(Math.round(iss.rateio.reduce((s, p) => s + p.valor, 0) * 100) / 100, 1000);
  // A regional padrão do CNPJ não vale mais no imposto sobre a receita: só a receita.
  const go = rateioAutomatico({
    tributo: "PIS",
    base: BASE,
    regras: { ...REGRAS, regionalDoCnpj: { empresa_id: CAL, regional_id: "ss" } },
    gerencialDoCnpj: CAL,
    total: 1100,
  });
  assert.ok(go.ok);
  if (go.ok) assert.deepEqual(go.rateio.map((p) => [p.regional_id, p.valor]), [["ne", 660], ["sp", 165], ["doca", 275]]);
  const sem = rateioAutomatico({ tributo: "COFINS", base: [], regras: REGRAS, gerencialDoCnpj: CAL, total: 10 });
  assert.equal(sem.ok, false);
  // IOF do mútuo: a empresa gerencial do CNPJ, sem regional.
  const iof = rateioAutomatico({ tributo: "IOF", base: BASE, regras: { ...REGRAS, pelaReceita: false }, gerencialDoCnpj: CAL, total: 50 });
  assert.ok(iof.ok);
  if (iof.ok) assert.deepEqual(iof.rateio.map((p) => [p.empresa_id, p.regional_id, p.valor]), [[CAL, null, 50]]);
});

test("IOF do mútuo: sem regional (como o cálculo do sistema), fora a regional do CNPJ que emprestou", () => {
  const base = [b(CAL, "sp", 600), b(CAL, "ne", 400)];
  const iof = { ...REGRAS, pelaReceita: false };
  const cal = rateioPorGerencial([{ empresa_id: CAL, valor: 2549.69, regional_id: null }], base, iof, 2549.69);
  assert.ok(cal.ok);
  if (cal.ok) assert.deepEqual(cal.rateio.map((r) => [r.empresa_id, r.regional_id, r.valor]), [[CAL, null, 2549.69]]);
  const go = rateioPorGerencial(
    [{ empresa_id: CAL, valor: 4426.17, regional_id: null }],
    base,
    { ...iof, regionalDoCnpj: { empresa_id: CAL, regional_id: "ss" } },
    4426.17,
  );
  assert.ok(go.ok);
  if (go.ok) assert.deepEqual(go.rateio.map((r) => [r.empresa_id, r.regional_id, r.valor]), [[CAL, "ss", 4426.17]]);
});
