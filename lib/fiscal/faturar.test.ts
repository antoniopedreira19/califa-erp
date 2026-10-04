/**
 * Testes das sugestões do Faturar (módulo fiscal, entrega 1 — 02/10/2026) e
 * do aviso depois de emitir (em que Apuração os impostos da nota entraram).
 * Rodar: node --import tsx --test lib/fiscal/faturar.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FiscalCnae, FiscalEstabelecimento } from "@/lib/types";
import type { CadastroFiscal } from "./cadastro";
import {
  avisoDaApuracao,
  cnaesQueBatemComASugestao,
  diaDoPisCofins,
  guiasDaEmissaoParaConferir,
  mesesDasCotas,
  montarFiscalDoFaturar,
  rotuloDoEstabelecimento,
  sugestaoDoCnpj,
  textoDoRegime,
  textoDoTrimestre,
  type ApuracaoDaEmissao,
} from "./faturar";

const estab = (
  id: string,
  pj: string,
  nome: string,
  cnpj: string | null,
  ativo = true,
): FiscalEstabelecimento => ({
  id,
  tenant_id: "t",
  empresa_contabil_id: pj,
  nome,
  cnpj,
  papel: "matriz",
  municipio: "Salvador",
  uf: "BA",
  iss_dia: 5,
  iss_retido_dia: 5,
  iss_regra: "prorroga",
  ativo,
  ordem: 0,
  observacao: null,
  created_at: "",
  updated_at: "",
});

const ESTABS = [
  estab("ca-ssa", "pj-ca", "California · Salvador", "19437976000154"),
  estab("ca-sp", "pj-ca", "California · São Paulo", null, false),
  estab("gc", "pj-gc", "GoCrazy · Santo André", "29943648000183"),
  estab("hit", "pj-hit", "Hitlab · Salvador", "04409741000181"),
];

const CAD: CadastroFiscal = {
  regimes: [],
  estabelecimentos: ESTABS,
  cnaes: [],
  feriados: [],
  parametros: [],
};

const PJS = [
  { id: "pj-ca", nome_fantasia: "California", razao_social: "CALIFÓRNIA FILMES E PUBLICIDADE LTDA" },
  { id: "pj-gc", nome_fantasia: "GoCrazy", razao_social: "GO CRAZY CONSULTORIA E MARKETING LTDA" },
  { id: "pj-hit", nome_fantasia: "Hitlab", razao_social: "HITLAB PRODUÇÃO MUSICAL LTDA" },
];

const EMPRESAS = [
  { id: "emp-ca", cnpj: "19437976000154", nome_fantasia: "Agência California", razao_social: "CALIFÓRNIA FILMES" },
  { id: "emp-hit", cnpj: "04409741000181", nome_fantasia: "Hitlab", razao_social: "HITLAB PRODUCAO MUSICAL LTDA" },
  { id: "emp-cch", cnpj: "00000000000000", nome_fantasia: "CCH", razao_social: "CCH LTDA" },
];

const CLIENTE_A = "11222333000181";
const CLIENTE_B = "44555666000172";
const CLIENTE_C = "77666555000140";

const NOTAS = [
  // Antes do módulo fiscal: sem CNPJ emissor — não contam.
  { numero_nf: "9999", data_emissao: "2026-09-10", cnpj_tomador: CLIENTE_A, estabelecimento_id: null },
  { numero_nf: "2058", data_emissao: "2026-10-02", cnpj_tomador: CLIENTE_A, estabelecimento_id: "ca-ssa" },
  { numero_nf: "2061", data_emissao: "2026-10-05", cnpj_tomador: CLIENTE_B, estabelecimento_id: "ca-ssa" },
  { numero_nf: "877", data_emissao: "2026-10-06", cnpj_tomador: CLIENTE_A, estabelecimento_id: "gc" },
  { numero_nf: "1205", data_emissao: "2026-10-03", cnpj_tomador: CLIENTE_C, estabelecimento_id: "hit" },
];

const FISCAL = montarFiscalDoFaturar({ cadastro: CAD, pjs: PJS, empresas: EMPRESAS, notas: NOTAS });

test("Nº NF sugerido: o maior de cada CNPJ + 1; CNPJ sem nota fica sem sugestão", () => {
  assert.deepEqual(FISCAL.proximaNfPorEstab, { "ca-ssa": "2062", gc: "878", hit: "1206" });
});

test("última nota de cada CNPJ de cliente, só entre as que registram o CNPJ emissor", () => {
  assert.equal(FISCAL.ultimaPorCnpjTomador[CLIENTE_A].estabelecimento_id, "gc");
  assert.equal(FISCAL.ultimaPorCnpjTomador[CLIENTE_A].numero_nf, "877");
  assert.equal(FISCAL.ultimaPorCnpjTomador[CLIENTE_B].estabelecimento_id, "ca-ssa");
});

test("só a empresa gerencial que é a PJ de um CNPJ só ganha CNPJ padrão (Hitlab)", () => {
  assert.deepEqual(Object.keys(FISCAL.cnpjPorEmpresaGerencial), ["emp-hit"]);
  assert.equal(FISCAL.cnpjPorEmpresaGerencial["emp-hit"].estabelecimento_id, "hit");
  assert.equal(FISCAL.nomeDaPJ["pj-hit"], "Hitlab");
});

test("sugestão: último usado para o cliente, com a frase", () => {
  const s = sugestaoDoCnpj(FISCAL, { cnpj_tomador: "11.222.333/0001-81", empresa_id: "emp-ca", contraparte_nome: "Cliente A" });
  assert.equal(s.estabelecimentoId, "gc");
  assert.equal(s.ajuda, "Último usado para Cliente A: GoCrazy · Santo André, NF 877 de 06/10/2026. Pode trocar.");
});

test("sugestão: job da Hitlab vem com a Hitlab, mesmo com outro CNPJ usado para o cliente", () => {
  const s = sugestaoDoCnpj(FISCAL, { cnpj_tomador: CLIENTE_A, empresa_id: "emp-hit", contraparte_nome: "Cliente A" });
  assert.equal(s.estabelecimentoId, "hit");
  assert.equal(s.ajuda, "Job da empresa gerencial Hitlab: vem o CNPJ da Hitlab. Pode trocar.");
  // Último usado para o cliente já foi a Hitlab: a frase é a do último usado.
  const c = sugestaoDoCnpj(FISCAL, { cnpj_tomador: CLIENTE_C, empresa_id: "emp-hit", contraparte_nome: "Cliente C" });
  assert.equal(c.estabelecimentoId, "hit");
  assert.equal(c.ajuda, "Último usado para Cliente C: Hitlab · Salvador, NF 1205 de 03/10/2026. Pode trocar.");
});

test("sugestão: cliente sem nota, BV sem CNPJ, e CNPJ que ficou inativo não sugerem", () => {
  assert.deepEqual(
    sugestaoDoCnpj(FISCAL, { cnpj_tomador: "99888777000166", empresa_id: "emp-ca", contraparte_nome: "Novo" }),
    { estabelecimentoId: null, ajuda: null },
  );
  assert.equal(sugestaoDoCnpj(FISCAL, { cnpj_tomador: null, empresa_id: "emp-cch", contraparte_nome: "Forn." }).estabelecimentoId, null);
  assert.equal(sugestaoDoCnpj(FISCAL, null).estabelecimentoId, null);
  const semGc: CadastroFiscal = { ...CAD, estabelecimentos: ESTABS.map((e) => (e.id === "gc" ? { ...e, ativo: false } : e)) };
  const f2 = montarFiscalDoFaturar({ cadastro: semGc, pjs: PJS, empresas: EMPRESAS, notas: NOTAS });
  assert.equal(sugestaoDoCnpj(f2, { cnpj_tomador: CLIENTE_A, empresa_id: "emp-ca", contraparte_nome: "A" }).estabelecimentoId, null);
});

const cnae = (id: string, codigo: string, subitem: string | null): Pick<FiscalCnae, "id" | "codigo" | "subitem"> => ({
  id,
  codigo,
  subitem,
});
const LISTA = [
  cnae("a", "73.19-0-99", null),
  cnae("b", "74.90-1-04", null),
  cnae("c", "82.30-0-01", "12.08"),
  cnae("d", "82.30-0-01", "17.10"),
];

test("CNAE sugerido: pelo código com subitem, pelo texto antigo e pelo código sem subitem", () => {
  assert.deepEqual([...cnaesQueBatemComASugestao(LISTA, "82.30-0-01 · 12.08")], ["c"]);
  assert.deepEqual([...cnaesQueBatemComASugestao(LISTA, "7490-1/04")], ["b"]);
  assert.deepEqual([...cnaesQueBatemComASugestao(LISTA, "82.30-0-01")].sort(), ["c", "d"]);
  assert.equal(cnaesQueBatemComASugestao(LISTA, "7311-4/00").size, 0);
  assert.equal(cnaesQueBatemComASugestao(LISTA, null).size, 0);
  assert.equal(cnaesQueBatemComASugestao(LISTA, "sem número").size, 0);
});

test("textos: CNPJ, regime, trimestre e cotas de IRPJ/CSLL", () => {
  assert.equal(rotuloDoEstabelecimento(ESTABS[0]), "California · Salvador · 19.437.976/0001-54");
  assert.equal(textoDoRegime("lucro_real", false), "Lucro Real trimestral");
  assert.equal(textoDoRegime("lucro_presumido", true), "Lucro Presumido · regime de caixa");
  assert.equal(textoDoTrimestre("2026-11-11"), "4º trimestre/2026");
  assert.equal(mesesDasCotas("2026-11-11"), "janeiro, fevereiro e março de 2027");
  assert.equal(mesesDasCotas("2026-02-03"), "abril, maio e junho de 2026");
  assert.equal(diaDoPisCofins(CAD, "2026-11-11"), 25);
  const dia = (valor: number, vigencia_inicio: string) => ({ id: `p${valor}`, tenant_id: "t", chave: "pis_cofins_dia", valor, descricao: "", vigencia_inicio, created_at: "", updated_at: "" });
  assert.equal(diaDoPisCofins({ ...CAD, parametros: [dia(20, "2026-01-01")] }, "2026-11-11"), 20);
  // Dia trocado a partir de 01/12: a nota de novembro fica com o de antes; a de
  // dezembro, com o novo — o dia vigente no último dia da competência, como no motor.
  const trocado = { ...CAD, parametros: [dia(25, "2026-01-01"), dia(20, "2026-12-01")] };
  assert.equal(diaDoPisCofins(trocado, "2026-11-30"), 25);
  assert.equal(diaDoPisCofins(trocado, "2026-12-01"), 20);
  // Vigência no meio do mês vale para o mês inteiro (o vencimento é da competência).
  assert.equal(diaDoPisCofins({ ...CAD, parametros: [dia(25, "2026-01-01"), dia(18, "2026-11-15")] }, "2026-11-02"), 18);
});

// ---------------------------------------------------------------------------
// O aviso depois de emitir
// ---------------------------------------------------------------------------

const PRIMEIRA = "2026-10";
const NENHUMA = { iss: false, pis_cofins: false };
const apuracao = (hoje: string, aprovadas: ApuracaoDaEmissao["aprovadas"] = NENHUMA): ApuracaoDaEmissao => ({
  hoje,
  primeira_competencia: PRIMEIRA,
  aprovadas,
});

test("aviso: a competência é o mês da emissão; no mês corrente, a Apuração em curso", () => {
  assert.equal(
    avisoDaApuracao({ emissao: "2026-10-02", presumido: false, apuracao: apuracao("2026-10-02") }),
    "Os impostos dela já estão na Apuração de outubro/2026 (em curso).",
  );
  // Data futura no mesmo mês: o motor conhece a nota desde o registro.
  assert.equal(
    avisoDaApuracao({ emissao: "2026-10-28", presumido: false, apuracao: apuracao("2026-10-02") }),
    "Os impostos dela já estão na Apuração de outubro/2026 (em curso).",
  );
  // Lucro presumido: só o ISS nasce na emissão.
  assert.equal(
    avisoDaApuracao({ emissao: "2026-10-02", presumido: true, apuracao: apuracao("2026-10-02") }),
    "O ISS dela já está na Apuração de outubro/2026 (em curso). PIS, COFINS, IRPJ e CSLL entram quando o cliente pagar.",
  );
});

test("aviso: mês encerrado sem guia aprovada — a aprovar", () => {
  assert.equal(
    avisoDaApuracao({ emissao: "2026-10-30", presumido: false, apuracao: apuracao("2026-11-10") }),
    "Os impostos dela já estão na Apuração de outubro/2026 (a aprovar).",
  );
  // Virada de ano.
  assert.equal(
    avisoDaApuracao({ emissao: "2026-12-30", presumido: false, apuracao: apuracao("2027-01-05") }),
    "Os impostos dela já estão na Apuração de dezembro/2026 (a aprovar).",
  );
  // No presumido, a guia de PIS/COFINS aprovada não é da nota (vem dos recebimentos).
  assert.equal(
    avisoDaApuracao({
      emissao: "2026-10-30",
      presumido: true,
      apuracao: apuracao("2026-11-10", { iss: false, pis_cofins: true }),
    }),
    "O ISS dela já está na Apuração de outubro/2026 (a aprovar). PIS, COFINS, IRPJ e CSLL entram quando o cliente pagar.",
  );
});

test("aviso: mês encerrado com guia aprovada — a guia passa a mostrar a diferença", () => {
  const diferenca = "Os impostos dela já estão na Apuração de outubro/2026: a guia já aprovada passa a mostrar a diferença.";
  for (const aprovadas of [
    { iss: true, pis_cofins: false },
    { iss: false, pis_cofins: true },
    { iss: true, pis_cofins: true },
  ]) {
    assert.equal(
      avisoDaApuracao({ emissao: "2026-10-30", presumido: false, apuracao: apuracao("2026-11-10", aprovadas) }),
      diferenca,
    );
  }
  assert.equal(
    avisoDaApuracao({
      emissao: "2026-10-30",
      presumido: true,
      apuracao: apuracao("2026-11-10", { iss: true, pis_cofins: false }),
    }),
    "O ISS dela já está na Apuração de outubro/2026: a guia já aprovada passa a mostrar a diferença. PIS, COFINS, IRPJ e CSLL entram quando o cliente pagar.",
  );
  // A leitura das aprovações falhou: o aviso não diz se a guia está aprovada.
  assert.equal(
    avisoDaApuracao({ emissao: "2026-10-30", presumido: false, apuracao: apuracao("2026-11-10", null) }),
    "Os impostos dela já estão na Apuração de outubro/2026.",
  );
});

test("aviso: mês futuro e nota anterior ao início da Apuração", () => {
  assert.equal(
    avisoDaApuracao({ emissao: "2026-11-05", presumido: false, apuracao: apuracao("2026-10-02") }),
    "Os impostos dela entram na Apuração de novembro/2026, o mês da emissão.",
  );
  assert.equal(
    avisoDaApuracao({ emissao: "2026-11-05", presumido: true, apuracao: apuracao("2026-10-02") }),
    "O ISS dela entra na Apuração de novembro/2026, o mês da emissão. PIS, COFINS, IRPJ e CSLL entram quando o cliente pagar.",
  );
  assert.equal(
    avisoDaApuracao({ emissao: "2026-09-28", presumido: false, apuracao: apuracao("2026-10-02") }),
    "A nota é de setembro/2026, antes do início da Apuração (outubro/2026): os impostos dela ficam de fora.",
  );
  assert.equal(
    avisoDaApuracao({ emissao: "2026-09-28", presumido: true, apuracao: apuracao("2026-10-02") }),
    "A nota é de setembro/2026, antes do início da Apuração (outubro/2026): o ISS dela fica de fora. PIS, COFINS, IRPJ e CSLL entram quando o cliente pagar.",
  );
});

test("guias a conferir na emissão: só mês encerrado dentro da Apuração, com as chaves do motor", () => {
  const base = { estabelecimentoId: "ca-ssa", empresaContabilId: "pj-ca", primeiraCompetencia: PRIMEIRA, cnaeCumulativo: false };
  assert.deepEqual(guiasDaEmissaoParaConferir({ ...base, emissao: "2026-10-30", hoje: "2026-11-10" }), {
    iss: "iss|ca-ssa|2026-10",
    pisCofins: ["pis|pj-ca|2026-10", "cofins|pj-ca|2026-10"],
  });
  // Nota do 12.08: a guia cumulativa dela (decisão 144) e a não cumulativa, onde o 12.08 estorna crédito.
  assert.deepEqual(guiasDaEmissaoParaConferir({ ...base, cnaeCumulativo: true, emissao: "2026-10-30", hoje: "2026-11-10" }), {
    iss: "iss|ca-ssa|2026-10",
    pisCofins: ["pis_cum|pj-ca|2026-10", "cofins_cum|pj-ca|2026-10", "pis|pj-ca|2026-10", "cofins|pj-ca|2026-10"],
  });
  // Mês corrente, futuro e anterior à Apuração: nenhuma guia pode estar aprovada.
  assert.equal(guiasDaEmissaoParaConferir({ ...base, emissao: "2026-11-02", hoje: "2026-11-10" }), null);
  assert.equal(guiasDaEmissaoParaConferir({ ...base, emissao: "2026-12-01", hoje: "2026-11-10" }), null);
  assert.equal(guiasDaEmissaoParaConferir({ ...base, emissao: "2026-09-28", hoje: "2026-11-10" }), null);
});
