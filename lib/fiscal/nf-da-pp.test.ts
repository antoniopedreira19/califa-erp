/**
 * Testes da NF do fornecedor na aprovação da PP (módulo fiscal, entrega 1,
 * 02/10/2026). Rodar: node --import tsx --test lib/fiscal/nf-da-pp.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  FiscalEstabelecimento,
  FiscalFeriado,
  FiscalParametro,
  FiscalRegime,
} from "@/lib/types";
import type { CadastroFiscal } from "./cadastro";
import {
  creditoDaNf,
  faltaNaNfParaAprovar,
  faturadoNo1208ParaANf,
  guiaDoIssRetido,
  nfIncompleta,
  nfInicial,
  notaFiscalDaLinhaPP,
  regimeDoFornecedorDaPP,
  retencoesParaRegistrar,
  rotuloCurtoDoRegime,
  textoDoMotivo,
  textoDoRegime,
  tomadoresPadrao,
  vencimentoDasGuiasFederais,
  type ColunasDaNfNaPP,
  type NfEmConferencia,
} from "./nf-da-pp";
import { notasDosJobsParaCredito, ultimasRetencoesDasPPs } from "./aprovacao-da-pp";
import { retencoesPadrao, valoresRetidos } from "./calculos";

// --- O cadastro de impostos, como a carga da migration 20261002100001 ----

const T = "tenant";
const CARIMBO = "2026-10-02T00:00:00Z";

function estab(
  id: string,
  pj: string,
  nome: string,
  cnpj: string | null,
  municipio: string,
  uf: string,
  dia: number,
  ordem: number,
  ativo = true,
): FiscalEstabelecimento {
  return {
    id,
    tenant_id: T,
    empresa_contabil_id: pj,
    nome,
    cnpj,
    papel: ordem <= 1 || ordem >= 4 ? "matriz" : "filial",
    municipio,
    uf,
    iss_dia: dia,
    iss_retido_dia: dia,
    iss_regra: "prorroga",
    ativo,
    ordem,
    observacao: null,
    created_at: CARIMBO,
    updated_at: CARIMBO,
  };
}

function regime(pj: string, r: "lucro_real" | "lucro_presumido", caixa = false): FiscalRegime {
  return {
    id: `reg-${pj}`,
    tenant_id: T,
    empresa_contabil_id: pj,
    regime: r,
    regime_caixa: caixa,
    vigencia_inicio: "2026-01-01",
    vigencia_fim: null,
    observacao: null,
    created_at: CARIMBO,
    updated_at: CARIMBO,
  };
}

function parametro(chave: string, valor: number, vigencia = "2026-01-01"): FiscalParametro {
  return {
    id: `par-${chave}-${vigencia}`,
    tenant_id: T,
    chave,
    valor,
    descricao: chave,
    vigencia_inicio: vigencia,
    created_at: CARIMBO,
    updated_at: CARIMBO,
  };
}

function feriado(data: string, nome: string, municipio: string | null = null): FiscalFeriado {
  return { id: `fer-${data}-${municipio ?? ""}`, tenant_id: T, data, nome, municipio, created_at: CARIMBO };
}

const SALVADOR = estab("ssa", "pj-ca", "California · Salvador", "19437976000154", "Salvador", "BA", 5, 1);
const SAO_PAULO = estab("sp", "pj-ca", "California · São Paulo", null, "São Paulo", "SP", 10, 2, false);
const SANTO_ANDRE = estab("sa", "pj-gc", "GoCrazy · Santo André", "29943648000183", "Santo André", "SP", 20, 4);
const HITLAB = estab("hit", "pj-hit", "Hitlab · Salvador", "04409741000181", "Salvador", "BA", 5, 5);

const CADASTRO: CadastroFiscal = {
  regimes: [regime("pj-ca", "lucro_real"), regime("pj-gc", "lucro_real"), regime("pj-hit", "lucro_presumido", true)],
  estabelecimentos: [SALVADOR, SAO_PAULO, SANTO_ANDRE, HITLAB],
  cnaes: [],
  feriados: [
    feriado("2026-11-20", "Dia da Consciência Negra"),
    feriado("2026-12-25", "Natal"),
    feriado("2026-12-08", "Nossa Senhora da Conceição da Praia", "Salvador"),
  ],
  parametros: [
    parametro("csrf_pis", 0.65),
    parametro("csrf_cofins", 3),
    parametro("csrf_csll", 1),
    parametro("irrf_servicos", 1.5),
    parametro("retencoes_dia", 20),
    parametro("credito_pis", 1.65),
    parametro("credito_cofins", 7.6),
  ],
};

// --- A linha da PP -------------------------------------------------------

const SEM_REGISTRO: Omit<ColunasDaNfNaPP, "verba_producao" | "anexos"> = {
  nf_numero: null,
  nf_data_emissao: null,
  nf_valor: null,
  nf_tomador_estabelecimento_id: null,
  nf_registrada_em: null,
  credito_pis_cofins_retirado: false,
  credito_pis_cofins_motivo: null,
};

test("a NF só existe com anexo do tipo NF e fora da verba; o número vem do primeiro anexo de NF", () => {
  const anexos = [
    { documento_tipo: "boleto" as const, documento_numero: "B-1", created_at: "2026-09-30T10:00:00Z" },
    { documento_tipo: "nota_fiscal" as const, documento_numero: " 602 ", created_at: "2026-09-30T11:00:00Z" },
    { documento_tipo: "nota_fiscal" as const, documento_numero: "603", created_at: "2026-09-30T12:00:00Z" },
  ];
  const nf = notaFiscalDaLinhaPP({ ...SEM_REGISTRO, verba_producao: false, anexos });
  assert.deepEqual(nf, { numero_do_anexo: "602", registrada: null });
  assert.equal(notaFiscalDaLinhaPP({ ...SEM_REGISTRO, verba_producao: true, anexos }), null);
  assert.equal(
    notaFiscalDaLinhaPP({ ...SEM_REGISTRO, verba_producao: false, anexos: [anexos[0]] }),
    null,
  );
  assert.equal(notaFiscalDaLinhaPP({ ...SEM_REGISTRO, verba_producao: false, anexos: null }), null);
  // Anexo de NF sem número: o grupo aparece, com o número em branco.
  assert.deepEqual(
    notaFiscalDaLinhaPP({
      ...SEM_REGISTRO,
      verba_producao: false,
      anexos: [{ documento_tipo: "nota_fiscal", documento_numero: null, created_at: CARIMBO }],
    }),
    { numero_do_anexo: null, registrada: null },
  );
});

test("o registro do financeiro vem das colunas nf_* (numeric chega como texto)", () => {
  const nf = notaFiscalDaLinhaPP({
    verba_producao: false,
    anexos: [{ documento_tipo: "nota_fiscal", documento_numero: "602", created_at: CARIMBO }],
    nf_numero: "602",
    nf_data_emissao: "2026-09-28",
    nf_valor: "18000.00",
    nf_tomador_estabelecimento_id: "ssa",
    nf_registrada_em: "2026-10-02T14:00:00Z",
    credito_pis_cofins_retirado: true,
    credito_pis_cofins_motivo: "Reembolso de despesa do cliente",
  });
  assert.deepEqual(nf?.registrada, {
    numero: "602",
    data_emissao: "2026-09-28",
    valor: 18000,
    tomador_estabelecimento_id: "ssa",
    registrada_em: "2026-10-02T14:00:00Z",
    credito_retirado: true,
    credito_motivo: "Reembolso de despesa do cliente",
  });
});

test("regime do fornecedor: texto da coluna e rótulo do pop-up", () => {
  assert.equal(regimeDoFornecedorDaPP(true, { regime_tributario: "normal", regime_consultado_em: null, declaracao_simples_recebida: false }), null);
  assert.equal(regimeDoFornecedorDaPP(false, { regime_tributario: null, regime_consultado_em: null, declaracao_simples_recebida: false }), null);
  assert.equal(regimeDoFornecedorDaPP(false, null), null);
  const normal = regimeDoFornecedorDaPP(false, {
    regime_tributario: "normal",
    regime_consultado_em: "2026-10-01",
    declaracao_simples_recebida: null,
  });
  assert.ok(normal);
  assert.equal(textoDoRegime(normal), "Regime normal (Lucro Real ou Presumido) · consulta do CNPJ em 01/10/2026");
  assert.equal(
    textoDoRegime({ regime: "simples", consultado_em: null, declaracao_simples_recebida: true }),
    "Optante do Simples Nacional · declaração recebida",
  );
  assert.equal(
    textoDoRegime({ regime: "simples", consultado_em: "2026-09-21", declaracao_simples_recebida: false }),
    "Optante do Simples Nacional · consulta do CNPJ em 21/09/2026",
  );
  assert.equal(textoDoRegime({ regime: "mei", consultado_em: null, declaracao_simples_recebida: false }), "MEI");
  assert.equal(rotuloCurtoDoRegime("normal"), "regime normal");
  assert.equal(rotuloCurtoDoRegime("simples"), "optante do Simples");
  assert.equal(rotuloCurtoDoRegime("mei"), "MEI");
  assert.equal(rotuloCurtoDoRegime(null), "regime não informado");
});

test("a NF em conferência começa no registro ou no anexo, e a aprovação cobra data e valor", () => {
  const semRegistro = nfInicial({ numero_do_anexo: "602", registrada: null }, "ssa");
  assert.deepEqual(semRegistro, { numero: "602", emissao: "", valor: 0, tomador: "ssa" });
  assert.equal(nfIncompleta(semRegistro), true);
  assert.match(faltaNaNfParaAprovar(semRegistro) ?? "", /número, data de emissão e valor/);

  const registrada = nfInicial(
    {
      numero_do_anexo: "602",
      registrada: {
        numero: "0602",
        data_emissao: "2026-09-28",
        valor: 17500,
        tomador_estabelecimento_id: "sa",
        registrada_em: CARIMBO,
        credito_retirado: false,
        credito_motivo: null,
      },
    },
    "ssa",
  );
  assert.deepEqual(registrada, { numero: "0602", emissao: "2026-09-28", valor: 17500, tomador: "sa" });
  assert.equal(nfIncompleta(registrada), false);
  assert.equal(faltaNaNfParaAprovar(registrada), null);
  assert.match(faltaNaNfParaAprovar({ ...registrada, numero: "  " }) ?? "", /número/);
  assert.match(faltaNaNfParaAprovar({ ...registrada, tomador: "" }) ?? "", /CNPJ tomador/);
});

test("retenções para registrar: só com a chave ligada, pela alíquota ou pelo valor digitado", () => {
  assert.deepEqual(retencoesParaRegistrar(false, { PIS: 0.65 }, { PIS: 117 }, 18000), []);
  const padrao = retencoesPadrao("normal");
  const v = valoresRetidos(18000, padrao);
  assert.deepEqual(retencoesParaRegistrar(true, padrao, v.porImposto, 18000), [
    { imposto: "PIS", aliquota: 0.65 },
    { imposto: "COFINS", aliquota: 3 },
    { imposto: "CSLL", aliquota: 1 },
    { imposto: "IRRF", aliquota: 1.5 },
  ]);
  // ISS informado pelo valor (R$ 333,33 de R$ 18.000): a alíquota sai dele.
  assert.deepEqual(retencoesParaRegistrar(true, { ISS: null }, { ISS: 333.33 }, 18000), [
    { imposto: "ISS", aliquota: 1.8518 },
  ]);
  // Alíquota sem valor (base zero) não entra.
  assert.deepEqual(retencoesParaRegistrar(true, { PIS: 0.65 }, { PIS: 0 }, 0), []);
});

test("as guias: DARF no dia 20 do mês seguinte ao pagamento; ISS retido pelo município do tomador", () => {
  // pagamento em 20/11/2026 → 20/12 é domingo → antecipa para 18/12.
  assert.equal(vencimentoDasGuiasFederais(CADASTRO, "ssa", "2026-11-20")?.data, "2026-12-18");
  assert.equal(vencimentoDasGuiasFederais(CADASTRO, "ssa", ""), null);
  assert.equal(vencimentoDasGuiasFederais(CADASTRO, "nenhum", "2026-11-20"), null);
  // NF de 03/11/2026 em Salvador: 05/12 é sábado → prorroga para 07/12.
  const iss = guiaDoIssRetido(CADASTRO, "ssa", "2026-11-03");
  assert.equal(iss?.municipio, "Salvador");
  assert.equal(iss?.uf, "BA");
  assert.equal(iss?.vencimento.data, "2026-12-07");
  assert.equal(guiaDoIssRetido(CADASTRO, "ssa", ""), null);
});

// --- O crédito -----------------------------------------------------------

const NF: NfEmConferencia = { numero: "602", emissao: "2026-11-03", valor: 18000, tomador: "ssa" };
const HOJE = "2026-11-05";

test("crédito: a confirmar sem nota de saída, e gera com nota fora do 12.08", () => {
  const sem = creditoDaNf({ nf: NF, cadastro: CADASTRO, notasDoJob: { tem_nota: false, primeira_1208: null }, semCredito: false, motivoSemCredito: "", hoje: HOJE });
  assert.equal(sem.final.estado, "confirmar");
  assert.equal(sem.final.total, 1665);
  assert.equal(sem.final.mes, "novembro/2026");
  assert.equal(sem.tirado, false);
  const com = creditoDaNf({ nf: NF, cadastro: CADASTRO, notasDoJob: { tem_nota: true, primeira_1208: null }, semCredito: false, motivoSemCredito: "", hoje: HOJE });
  assert.equal(com.final.estado, "sim");
});

test("crédito: o 12.08 do mesmo mês ou de antes tira; de mês posterior, não", () => {
  assert.equal(faturadoNo1208ParaANf("2026-11-30", "2026-11-03"), true);
  assert.equal(faturadoNo1208ParaANf("2026-10-15", "2026-11-03"), true);
  assert.equal(faturadoNo1208ParaANf("2026-12-01", "2026-11-03"), false);
  assert.equal(faturadoNo1208ParaANf(null, "2026-11-03"), false);
  const c = creditoDaNf({ nf: NF, cadastro: CADASTRO, notasDoJob: { tem_nota: true, primeira_1208: "2026-10-15" }, semCredito: false, motivoSemCredito: "", hoje: HOJE });
  assert.equal(c.final.estado, "nao");
  assert.match(c.final.motivo, /12\.08/);
});

test("crédito: tomador no lucro presumido não gera, e a caixa não tira o que a regra não dá", () => {
  const c = creditoDaNf({ nf: { ...NF, tomador: "hit" }, cadastro: CADASTRO, notasDoJob: { tem_nota: true, primeira_1208: null }, semCredito: true, motivoSemCredito: "Outro", hoje: HOJE });
  assert.equal(c.automatico.gera, false);
  assert.equal(c.tirado, false);
  assert.match(c.final.motivo, /lucro presumido/);
});

test("crédito: o financeiro tira com motivo; sem motivo, a tela pede", () => {
  const sem = creditoDaNf({ nf: NF, cadastro: CADASTRO, notasDoJob: { tem_nota: true, primeira_1208: null }, semCredito: true, motivoSemCredito: "", hoje: HOJE });
  assert.equal(sem.tirado, true);
  assert.equal(sem.final.gera, false);
  assert.equal(sem.final.motivo, "Marcado pelo financeiro como sem crédito: escolha o motivo.");
  const com = creditoDaNf({ nf: NF, cadastro: CADASTRO, notasDoJob: { tem_nota: true, primeira_1208: null }, semCredito: true, motivoSemCredito: "Reembolso de despesa do cliente", hoje: HOJE });
  assert.equal(com.final.motivo, "Marcado pelo financeiro como sem crédito: reembolso de despesa do cliente.");
  assert.equal(textoDoMotivo("Outro"), "outro motivo");
});

test("crédito: as alíquotas vêm do parâmetro vigente na emissão", () => {
  const cad: CadastroFiscal = {
    ...CADASTRO,
    parametros: [...CADASTRO.parametros, parametro("credito_cofins", 8, "2026-11-01")],
  };
  const c = creditoDaNf({ nf: NF, cadastro: cad, notasDoJob: { tem_nota: true, primeira_1208: null }, semCredito: false, motivoSemCredito: "", hoje: HOJE });
  assert.equal(c.aliquotaCofins, 8);
  assert.equal(c.final.cofins, 1440);
  const antes = creditoDaNf({ nf: { ...NF, emissao: "2026-10-30" }, cadastro: cad, notasDoJob: { tem_nota: true, primeira_1208: null }, semCredito: false, motivoSemCredito: "", hoje: HOJE });
  assert.equal(antes.aliquotaCofins, 7.6);
});

// --- O que o servidor monta ---------------------------------------------

test("CNPJ tomador sugerido: o da empresa da PP; sem ele, a matriz California", () => {
  const p = tomadoresPadrao(CADASTRO.estabelecimentos, [
    { id: "emp-ca", cnpj: "19437976000154", principal: true },
    { id: "emp-hit", cnpj: "04409741000181", principal: false },
    { id: "emp-cch", cnpj: "00000000000000", principal: false },
  ]);
  assert.equal(p.geral, "ssa");
  assert.deepEqual(p.porEmpresa, { "emp-ca": "ssa", "emp-hit": "hit", "emp-cch": "ssa" });
  // Sem empresa principal: a primeira matriz ativa. Filial inativa nunca.
  const semPrincipal = tomadoresPadrao(CADASTRO.estabelecimentos, [{ id: "x", cnpj: null, principal: false }]);
  assert.equal(semPrincipal.geral, "ssa");
  assert.equal(tomadoresPadrao([], []).geral, null);
});

test("notas dos jobs: emitida conta, cancelada não; a primeira no 12.08", () => {
  const r = notasDosJobsParaCredito([
    { origem_id: "j1", faturamento: { data_emissao: "2026-11-10", status: "emitido", fiscal_cnae: { subitem: "12.08" } } },
    { origem_id: "j1", faturamento: { data_emissao: "2026-10-05", status: "emitido", fiscal_cnae: { subitem: "12.08" } } },
    { origem_id: "j1", faturamento: { data_emissao: "2026-09-01", status: "emitido", fiscal_cnae: { subitem: "17.10" } } },
    { origem_id: "j2", faturamento: { data_emissao: "2026-09-01", status: "emitido", fiscal_cnae: null } },
    { origem_id: "j3", faturamento: { data_emissao: "2026-09-01", status: "cancelado", fiscal_cnae: null } },
    { origem_id: null, faturamento: null },
  ]);
  assert.deepEqual(r, {
    j1: { tem_nota: true, primeira_1208: "2026-10-05" },
    j2: { tem_nota: true, primeira_1208: null },
  });
});

test("última retenção do fornecedor: a PP mais recente, com as alíquotas em número", () => {
  const r = ultimasRetencoesDasPPs([
    { codigo: "PP-00140", fornecedor_id: "f1", aprovada_em: "2026-10-02T12:00:00Z", retencoes: [{ imposto: "PIS", aliquota: "0.6500" }, { imposto: "IRRF", aliquota: "1.5000" }] },
    { codigo: "PP-00120", fornecedor_id: "f1", aprovada_em: "2026-09-02T12:00:00Z", retencoes: [{ imposto: "ISS", aliquota: "5" }] },
    { codigo: "PP-00110", fornecedor_id: "f2", aprovada_em: "2026-08-02T12:00:00Z", retencoes: [{ imposto: "ISS", aliquota: "2.0000" }] },
  ]);
  assert.deepEqual(r, {
    f1: { referencia: "PP-00140", data: "2026-10-02", aliquotas: { PIS: 0.65, IRRF: 1.5 } },
    f2: { referencia: "PP-00110", data: "2026-08-02", aliquotas: { ISS: 2 } },
  });
});
