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
  chaveDoNumeroDaNf,
  creditoDaNf,
  faltaNasNotasParaAprovar,
  guiaDoIssRetido,
  nfIncompleta,
  nfInicial,
  notasFiscaisDaLinhaPP,
  numerosDasNotas,
  parteDaNota,
  regimeDoFornecedorDaPP,
  somaDasPartes,
  retencoesParaRegistrar,
  rotuloCurtoDoRegime,
  textoDoMotivo,
  textoDoRegime,
  tomadoresPadrao,
  vencimentoDasGuiasFederais,
  type AnexoComNotaDoBanco,
  type NfEmConferencia,
  type NotaDaLinhaPP,
} from "./nf-da-pp";
import { ultimasRetencoesDasPPs } from "./aprovacao-da-pp";
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
  receitasAnteriores: [],
};

// --- A linha da PP -------------------------------------------------------

/** Um anexo como `SELECT_ANEXOS_COM_NOTA` traz (decisão 152). */
function anexo(parcial: Partial<AnexoComNotaDoBanco> & Pick<AnexoComNotaDoBanco, "id">): AnexoComNotaDoBanco {
  return {
    arquivo_nome_original: `${parcial.id}.pdf`,
    documento_tipo: "nota_fiscal",
    documento_numero: null,
    created_at: CARIMBO,
    nf_data_emissao: null,
    nf_valor: null,
    nf_tomador_estabelecimento_id: null,
    nf_valor_na_pp: null,
    nota: null,
    ...parcial,
  };
}

test("as NFs só existem com anexo do tipo NF e fora da verba, uma por anexo, na ordem anexada", () => {
  const anexos = [
    anexo({ id: "b", documento_tipo: "boleto", documento_numero: "B-1", created_at: "2026-09-30T10:00:00Z" }),
    anexo({ id: "n2", documento_numero: "603", created_at: "2026-09-30T12:00:00Z" }),
    anexo({ id: "n1", documento_numero: " 602 ", created_at: "2026-09-30T11:00:00Z" }),
  ];
  const r = notasFiscaisDaLinhaPP({ id: "pp", verba_producao: false, nf_registrada_em: null, anexos });
  assert.deepEqual(r?.notas.map((n) => [n.anexo_id, n.numero]), [["n1", "602"], ["n2", "603"]]);
  assert.equal(numerosDasNotas(r), "602, 603");
  assert.equal(notasFiscaisDaLinhaPP({ id: "pp", verba_producao: true, nf_registrada_em: null, anexos }), null);
  assert.equal(
    notasFiscaisDaLinhaPP({ id: "pp", verba_producao: false, nf_registrada_em: null, anexos: [anexos[0]] }),
    null,
  );
  assert.equal(notasFiscaisDaLinhaPP({ id: "pp", verba_producao: false, nf_registrada_em: null, anexos: null }), null);
  // Anexo de NF sem número: a nota aparece, com o número em branco.
  const semNumero = notasFiscaisDaLinhaPP({ id: "pp", verba_producao: false, nf_registrada_em: null, anexos: [anexo({ id: "x" })] });
  assert.equal(semNumero?.notas[0].numero, "");
  assert.equal(numerosDasNotas(semNumero), null);
});

test("antes da ligação vale o que a produção informou; depois, a nota do cadastro (numeric chega como texto)", () => {
  const informada = notasFiscaisDaLinhaPP({
    id: "pp",
    verba_producao: false,
    nf_registrada_em: null,
    anexos: [
      anexo({
        id: "n1",
        documento_numero: "602",
        nf_data_emissao: "2026-09-28",
        nf_valor: "18000.00",
        nf_tomador_estabelecimento_id: "ssa",
      }),
    ],
  });
  assert.deepEqual(
    { ...informada!.notas[0] },
    {
      anexo_id: "n1",
      arquivo_nome: "n1.pdf",
      nota_id: null,
      numero: "602",
      emissao: "2026-09-28",
      valor: 18000,
      tomador: "ssa",
      valor_na_pp: null,
      registrada: null,
      outras_pps: [],
    },
  );

  // A nota cobre esta PP e a PP-00140 (a cancelada não conta); o
  // financeiro corrigiu o número para 0602 e o valor, que vale para todas.
  const ligada = notasFiscaisDaLinhaPP({
    id: "pp",
    verba_producao: false,
    nf_registrada_em: "2026-10-02T14:00:00Z",
    anexos: [
      anexo({
        id: "n1",
        documento_numero: "602",
        nf_valor: "18000.00",
        nf_valor_na_pp: "6000.00",
        nota: {
          id: "nota-1",
          numero: "0602",
          data_emissao: "2026-09-28",
          valor: "10000.00",
          tomador_estabelecimento_id: "sa",
          registrada_em: "2026-10-01T10:00:00Z",
          iss_retido_aliquota: "5.0000",
          credito_pis_cofins_retirado: true,
          credito_pis_cofins_motivo: "Reembolso de despesa do cliente",
          registrada_na_pp: { codigo: "PP-00140" },
          anexos: [
            { pedido_compra_id: "pp", nf_valor_na_pp: "6000.00", pp: { codigo: "PP-00139", status: "em_avaliacao" } },
            { pedido_compra_id: "outra", nf_valor_na_pp: "4000.00", pp: { codigo: "PP-00140", status: "aprovada" } },
            { pedido_compra_id: "cancelada", nf_valor_na_pp: "4000.00", pp: { codigo: "PP-00120", status: "cancelada" } },
          ],
        },
      }),
    ],
  });
  const n = ligada!.notas[0];
  assert.equal(n.nota_id, "nota-1");
  assert.equal(n.numero, "0602");
  assert.equal(n.valor, 10000);
  assert.equal(n.tomador, "sa");
  assert.equal(n.valor_na_pp, 6000);
  assert.deepEqual(n.registrada, {
    em: "2026-10-01T10:00:00Z",
    na_pp: "PP-00140",
    iss_aliquota: 5,
    credito_retirado: true,
    credito_motivo: "Reembolso de despesa do cliente",
  });
  assert.deepEqual(n.outras_pps, [{ codigo: "PP-00140", valor_na_pp: 4000 }]);
  assert.equal(ligada!.conferidas_em, "2026-10-02T14:00:00Z");
});

test("a chave do número: sem pontuação, espaços e zeros à esquerda (espelho do banco)", () => {
  assert.equal(chaveDoNumeroDaNf("00000602"), "602");
  assert.equal(chaveDoNumeroDaNf(" 6.02 "), "602");
  assert.equal(chaveDoNumeroDaNf("a-12"), "A12");
  assert.equal(chaveDoNumeroDaNf("000"), null);
  assert.equal(chaveDoNumeroDaNf(""), null);
});

test("regime do fornecedor: texto da coluna e rótulo do pop-up", () => {
  assert.equal(regimeDoFornecedorDaPP(true, { regime_tributario: "normal", regime_consulta: null, regime_consultado_em: null, declaracao_simples_recebida: false }), null);
  assert.equal(regimeDoFornecedorDaPP(false, { regime_tributario: null, regime_consulta: null, regime_consultado_em: null, declaracao_simples_recebida: false }), null);
  assert.equal(regimeDoFornecedorDaPP(false, null), null);
  const normal = regimeDoFornecedorDaPP(false, {
    regime_tributario: "normal",
    regime_consulta: "normal",
    regime_consultado_em: "2026-10-01",
    declaracao_simples_recebida: null,
  });
  assert.ok(normal);
  assert.equal(textoDoRegime(normal), "Lucro Real ou Presumido · consulta do CNPJ em 01/10/2026");
  assert.equal(
    textoDoRegime({ regime: "simples", consultado_em: null, declaracao_simples_recebida: true }),
    "Optante do Simples Nacional · declaração recebida",
  );
  assert.equal(
    textoDoRegime({ regime: "simples", consultado_em: "2026-09-21", declaracao_simples_recebida: false }),
    "Optante do Simples Nacional · consulta do CNPJ em 21/09/2026",
  );
  assert.equal(textoDoRegime({ regime: "mei", consultado_em: null, declaracao_simples_recebida: false }), "MEI");
  assert.equal(rotuloCurtoDoRegime("normal"), "Lucro Real ou Presumido");
  assert.equal(rotuloCurtoDoRegime("simples"), "optante do Simples");
  assert.equal(rotuloCurtoDoRegime("mei"), "MEI");
  assert.equal(rotuloCurtoDoRegime(null), "regime não informado");
});

test("regime do fornecedor: a data da consulta só acompanha o regime que ela indicou (decisão 142)", () => {
  // Trocado à mão: a consulta disse normal e o cadastro diz Simples.
  const trocado = regimeDoFornecedorDaPP(false, {
    regime_tributario: "simples",
    regime_consulta: "normal",
    regime_consultado_em: "2026-10-02",
    declaracao_simples_recebida: true,
  });
  assert.ok(trocado);
  assert.equal(trocado.consultado_em, null);
  assert.equal(textoDoRegime(trocado), "Optante do Simples Nacional · declaração recebida");
  // A consulta indicou o regime gravado.
  const indicado = regimeDoFornecedorDaPP(false, {
    regime_tributario: "mei",
    regime_consulta: "mei",
    regime_consultado_em: "2026-10-02",
    declaracao_simples_recebida: false,
  });
  assert.equal(indicado?.consultado_em, "2026-10-02");
  // Gravado antes da 142: só a data, e só quando o regime era o indicado.
  const antigo = regimeDoFornecedorDaPP(false, {
    regime_tributario: "simples",
    regime_consulta: null,
    regime_consultado_em: "2026-09-21",
    declaracao_simples_recebida: false,
  });
  assert.equal(antigo?.consultado_em, "2026-09-21");
});

const NOTA_VAZIA: NotaDaLinhaPP = {
  anexo_id: "n1",
  arquivo_nome: "n1.pdf",
  nota_id: null,
  numero: "602",
  emissao: null,
  valor: null,
  tomador: null,
  valor_na_pp: null,
  registrada: null,
  outras_pps: [],
};

test("a NF em conferência começa no que a linha traz, e a aprovação cobra data, valor e tomador", () => {
  const vazia = nfInicial(NOTA_VAZIA, "ssa");
  assert.deepEqual(vazia, {
    anexo_id: "n1",
    numero: "602",
    emissao: "",
    valor: 0,
    tomador: "ssa",
    valor_na_pp: 0,
    cobre_outra: false,
  });
  assert.equal(nfIncompleta(vazia), true);
  assert.match(faltaNasNotasParaAprovar([vazia]) ?? "", /data de emissão e o valor/);

  const cheia = nfInicial({ ...NOTA_VAZIA, numero: "0602", emissao: "2026-09-28", valor: 17500, tomador: "sa" }, "ssa");
  assert.deepEqual(cheia, {
    anexo_id: "n1",
    numero: "0602",
    emissao: "2026-09-28",
    valor: 17500,
    tomador: "sa",
    valor_na_pp: 17500,
    cobre_outra: false,
  });
  assert.equal(nfIncompleta(cheia), false);
  assert.equal(faltaNasNotasParaAprovar([cheia]), null);
  assert.match(faltaNasNotasParaAprovar([{ ...cheia, numero: "  " }]) ?? "", /número/);
  assert.match(faltaNasNotasParaAprovar([{ ...cheia, tomador: "" }]) ?? "", /CNPJ tomador/);
  // A mesma nota duas vezes na PP ("602" e "0602" são a mesma).
  assert.match(
    faltaNasNotasParaAprovar([cheia, { ...cheia, anexo_id: "n2", numero: "602" }]) ?? "",
    /duas vezes/,
  );
});

test("a parte da nota nesta PP: a nota inteira, salvo quando cobre outra PP (decisão 152)", () => {
  const nf: NfEmConferencia = {
    anexo_id: "n1",
    numero: "602",
    emissao: "2026-09-28",
    valor: 10000,
    tomador: "ssa",
    valor_na_pp: 6000,
    cobre_outra: false,
  };
  assert.equal(parteDaNota(nf), 10000);
  assert.equal(parteDaNota({ ...nf, cobre_outra: true }), 6000);
  assert.equal(
    somaDasPartes([{ ...nf, cobre_outra: true }, { ...nf, anexo_id: "n2", numero: "603", valor: 2000 }]),
    8000,
  );
  assert.match(faltaNasNotasParaAprovar([{ ...nf, cobre_outra: true, valor_na_pp: 0 }]) ?? "", /nesta PP/);
  assert.match(
    faltaNasNotasParaAprovar([{ ...nf, cobre_outra: true, valor_na_pp: 12000 }]) ?? "",
    /não pode passar do valor da nota/,
  );

  // Já em outra PP: o campo vem aberto, sugerindo o que falta da nota.
  const emOutra = nfInicial(
    {
      ...NOTA_VAZIA,
      emissao: "2026-09-28",
      valor: 10000,
      tomador: "ssa",
      outras_pps: [{ codigo: "PP-00140", valor_na_pp: 4000 }],
    },
    null,
  );
  assert.equal(emOutra.cobre_outra, true);
  assert.equal(emOutra.valor_na_pp, 6000);
  // A parte guardada vale; diferente do total, o campo abre.
  const guardada = nfInicial({ ...NOTA_VAZIA, emissao: "2026-09-28", valor: 10000, tomador: "ssa", valor_na_pp: 7000 }, null);
  assert.equal(guardada.cobre_outra, true);
  assert.equal(guardada.valor_na_pp, 7000);
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
  // Dia trocado no cadastro para 15 a partir de 01/12/2026: o pagamento de
  // novembro vence no dia de antes; o de dezembro, no novo — o dia vigente no
  // fim do mês do pagamento, como no motor (não o de hoje).
  const trocado = { ...CADASTRO, parametros: [...CADASTRO.parametros, parametro("retencoes_dia", 15, "2026-12-01")] };
  assert.equal(vencimentoDasGuiasFederais(trocado, "ssa", "2026-11-20")?.data, "2026-12-18");
  assert.equal(vencimentoDasGuiasFederais(trocado, "ssa", "2026-12-10")?.data, "2027-01-15");
  // NF de 03/11/2026 em Salvador: 05/12 é sábado → prorroga para 07/12.
  const iss = guiaDoIssRetido(CADASTRO, "ssa", "2026-11-03");
  assert.equal(iss?.municipio, "Salvador");
  assert.equal(iss?.uf, "BA");
  assert.equal(iss?.vencimento.data, "2026-12-07");
  assert.equal(guiaDoIssRetido(CADASTRO, "ssa", ""), null);
});

// --- O crédito -----------------------------------------------------------

const NF: NfEmConferencia = {
  anexo_id: "n1",
  numero: "602",
  emissao: "2026-11-03",
  valor: 18000,
  tomador: "ssa",
  valor_na_pp: 18000,
  cobre_outra: false,
};
const HOJE = "2026-11-05";

test("crédito: fornecedor PJ com NF gera o crédito cheio no mês da emissão, sem olhar o job (decisão 146)", () => {
  const c = creditoDaNf({ nf: NF, cadastro: CADASTRO, semCredito: false, motivoSemCredito: "", hoje: HOJE });
  assert.equal(c.final.estado, "sim");
  assert.equal(c.final.gera, true);
  assert.equal(c.final.total, 1665);
  assert.equal(c.final.mes, "novembro/2026");
  assert.equal(c.tirado, false);
  // O valor é o cheio: a parte do 12.08 sai na Apuração, pelo rateio do mês.
  assert.equal(
    c.final.motivo,
    "Fornecedor PJ com NF. É o crédito cheio: se a PJ tomadora tiver nota no 12.08 em novembro/2026, a parte do 12.08 na receita do mês sai dele (rateio proporcional).",
  );
});

test("crédito: tomador no lucro presumido não gera, e a caixa não tira o que a regra não dá", () => {
  const c = creditoDaNf({ nf: { ...NF, tomador: "hit" }, cadastro: CADASTRO, semCredito: true, motivoSemCredito: "Outro", hoje: HOJE });
  assert.equal(c.automatico.gera, false);
  assert.equal(c.tirado, false);
  assert.match(c.final.motivo, /lucro presumido/);
});

test("crédito: o financeiro tira com motivo; sem motivo, a tela pede", () => {
  const sem = creditoDaNf({ nf: NF, cadastro: CADASTRO, semCredito: true, motivoSemCredito: "", hoje: HOJE });
  assert.equal(sem.tirado, true);
  assert.equal(sem.final.gera, false);
  assert.equal(sem.final.motivo, "Marcado pelo financeiro como sem crédito: escolha o motivo.");
  const com = creditoDaNf({ nf: NF, cadastro: CADASTRO, semCredito: true, motivoSemCredito: "Reembolso de despesa do cliente", hoje: HOJE });
  assert.equal(com.final.motivo, "Marcado pelo financeiro como sem crédito: reembolso de despesa do cliente.");
  assert.equal(textoDoMotivo("Outro"), "outro motivo");
});

test("crédito: as alíquotas vêm do parâmetro vigente na emissão", () => {
  const cad: CadastroFiscal = {
    ...CADASTRO,
    parametros: [...CADASTRO.parametros, parametro("credito_cofins", 8, "2026-11-01")],
  };
  const c = creditoDaNf({ nf: NF, cadastro: cad, semCredito: false, motivoSemCredito: "", hoje: HOJE });
  assert.equal(c.aliquotaCofins, 8);
  assert.equal(c.final.cofins, 1440);
  const antes = creditoDaNf({ nf: { ...NF, emissao: "2026-10-30" }, cadastro: cad, semCredito: false, motivoSemCredito: "", hoje: HOJE });
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
