/**
 * A NF do fornecedor na aprovação da PP (módulo fiscal, entrega 1 —
 * 02/10/2026).
 *
 * O que a tela da PP (`pp-tela.tsx`), a coluna "Dados da PP"
 * (`pp-dossie.tsx`) e o pop-up de aprovação (`aprovar-pp-dialog.tsx`)
 * dividem: a NF como a linha da PP a traz (o número que a produção informou
 * no anexo do tipo NF e o que o financeiro já registrou), a NF em
 * conferência na tela, os textos do regime do fornecedor, o crédito de
 * PIS/COFINS, as guias das retenções e as retenções no formato de
 * `registrar_nf_da_pp`.
 *
 * Decisão do Tiago (02/10/2026): a data de emissão e o valor da NF são
 * registrados SÓ pelo financeiro, na aprovação, olhando a nota ao lado. A
 * produção continua informando só o número, no anexo — como hoje.
 *
 * Funções puras. A leitura do banco fica em `aprovacao-da-pp.ts`.
 * Testes: node --import tsx --test lib/fiscal/nf-da-pp.test.ts
 */
import {
  IMPOSTOS_RETIDOS,
  type DocumentoTipo,
  type ImpostoRetido,
  type RegimeTributarioFornecedor,
} from "@/lib/types";
import {
  estabelecimentoDoCalculo,
  feriadosDoCalculo,
  parametrosDeRetencao,
  regimeDaPJ,
  type CadastroFiscal,
} from "./cadastro";
import {
  situacaoDoCredito,
  vencimentoDasRetencoes,
  type EntradaDoCredito,
  type SituacaoDoCredito,
} from "./calculos";
import { dataBr, mesDe, vencimentoNoMesSeguinte, type Vencimento } from "./datas";

// ---------------------------------------------------------------------------
// A linha da PP
// ---------------------------------------------------------------------------

/** O regime tributário do fornecedor, como o cadastro guarda hoje. */
export interface RegimeDoFornecedorDaPP {
  regime: RegimeTributarioFornecedor;
  /** Data da última consulta do CNPJ. */
  consultado_em: string | null;
  /** Simples: a declaração da IN 459 foi recebida. */
  declaracao_simples_recebida: boolean;
}

const REGIMES: readonly RegimeTributarioFornecedor[] = ["normal", "simples", "mei"];

/** Null na verba de produção (não há fornecedor) e quando o cadastro não informou. */
export function regimeDoFornecedorDaPP(
  verbaProducao: boolean,
  fornecedor: {
    regime_tributario: string | null;
    regime_consultado_em: string | null;
    declaracao_simples_recebida: boolean | null;
  } | null,
): RegimeDoFornecedorDaPP | null {
  if (verbaProducao || !fornecedor) return null;
  const regime = REGIMES.find((r) => r === fornecedor.regime_tributario);
  if (!regime) return null;
  return {
    regime,
    consultado_em: fornecedor.regime_consultado_em ?? null,
    declaracao_simples_recebida: fornecedor.declaracao_simples_recebida === true,
  };
}

/** A NF que o financeiro registrou na aprovação (as colunas `nf_*` da PP). */
export interface NotaFiscalRegistradaDaPP {
  numero: string;
  data_emissao: string;
  valor: number;
  tomador_estabelecimento_id: string;
  registrada_em: string;
  credito_retirado: boolean;
  credito_motivo: string | null;
}

/**
 * A NF do fornecedor na linha da PP. Só existe quando a PP tem anexo do
 * tipo NF e não é verba de produção — fora disso o grupo "Nota fiscal do
 * fornecedor" não aparece e a aprovação segue como antes.
 */
export interface NotaFiscalDaLinhaPP {
  /** O número que a produção informou no anexo do tipo NF (o primeiro). */
  numero_do_anexo: string | null;
  /** O que o financeiro registrou; null enquanto não registrou. */
  registrada: NotaFiscalRegistradaDaPP | null;
}

/** O que a consulta da PP traz para montar `NotaFiscalDaLinhaPP`. */
export interface ColunasDaNfNaPP {
  verba_producao: boolean | null;
  anexos: Array<{
    documento_tipo: DocumentoTipo | null;
    documento_numero: string | null;
    created_at: string;
  }> | null;
  nf_numero: string | null;
  nf_data_emissao: string | null;
  nf_valor: string | number | null;
  nf_tomador_estabelecimento_id: string | null;
  nf_registrada_em: string | null;
  credito_pis_cofins_retirado: boolean | null;
  credito_pis_cofins_motivo: string | null;
}

export function notaFiscalDaLinhaPP(r: ColunasDaNfNaPP): NotaFiscalDaLinhaPP | null {
  if (r.verba_producao) return null;
  const anexosNf = (r.anexos ?? [])
    .filter((a) => a.documento_tipo === "nota_fiscal")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (anexosNf.length === 0) return null;
  const numero =
    anexosNf.map((a) => (a.documento_numero ?? "").trim()).find((n) => n !== "") ?? null;
  // `registrar_nf_da_pp` grava os quatro juntos; um só preenchido não é registro.
  const registrada: NotaFiscalRegistradaDaPP | null =
    r.nf_registrada_em && r.nf_data_emissao && r.nf_valor != null && r.nf_tomador_estabelecimento_id
      ? {
          numero: r.nf_numero ?? "",
          data_emissao: r.nf_data_emissao.slice(0, 10),
          valor: Number(r.nf_valor),
          tomador_estabelecimento_id: r.nf_tomador_estabelecimento_id,
          registrada_em: r.nf_registrada_em,
          credito_retirado: r.credito_pis_cofins_retirado === true,
          credito_motivo: r.credito_pis_cofins_motivo ?? null,
        }
      : null;
  return { numero_do_anexo: numero, registrada };
}

// ---------------------------------------------------------------------------
// Os textos do regime
// ---------------------------------------------------------------------------

/** Embaixo do nome do fornecedor, na coluna "Dados da PP". */
export function textoDoRegime(r: RegimeDoFornecedorDaPP): string {
  const texto =
    r.regime === "mei"
      ? "MEI"
      : r.regime === "simples"
        ? r.declaracao_simples_recebida
          ? "Optante do Simples Nacional · declaração recebida"
          : "Optante do Simples Nacional"
        : "Regime normal (Lucro Real ou Presumido)";
  return r.consultado_em ? `${texto} · consulta do CNPJ em ${dataBr(r.consultado_em)}` : texto;
}

/** Ao lado do nome do fornecedor, na linha das retenções do pop-up. */
export function rotuloCurtoDoRegime(regime: RegimeTributarioFornecedor | null): string {
  if (regime === "normal") return "regime normal";
  if (regime === "simples") return "optante do Simples";
  if (regime === "mei") return "MEI";
  return "regime não informado";
}

// ---------------------------------------------------------------------------
// A NF em conferência: a tela guarda, a coluna "Dados da PP" edita e o
// pop-up de aprovação usa (base das retenções e mês do crédito).
// ---------------------------------------------------------------------------

export interface NfEmConferencia {
  numero: string;
  /** "AAAA-MM-DD"; vazia até o financeiro informar. */
  emissao: string;
  /** Zero até o financeiro informar. */
  valor: number;
  /** `fiscal_estabelecimentos.id`; vazio só quando o cadastro não tem CNPJ ativo. */
  tomador: string;
}

/**
 * Começa no que já está registrado na PP; sem registro, no número do anexo
 * e no CNPJ tomador sugerido, com a data e o valor em branco.
 */
export function nfInicial(nota: NotaFiscalDaLinhaPP, tomadorPadrao: string | null): NfEmConferencia {
  const r = nota.registrada;
  if (r) {
    return {
      numero: r.numero,
      emissao: r.data_emissao,
      valor: r.valor,
      tomador: r.tomador_estabelecimento_id,
    };
  }
  return { numero: nota.numero_do_anexo ?? "", emissao: "", valor: 0, tomador: tomadorPadrao ?? "" };
}

/** Sem data de emissão ou valor, não há mês de crédito nem base de retenção. */
export function nfIncompleta(nf: NfEmConferencia): boolean {
  return !nf.emissao || !(nf.valor > 0);
}

/** O que impede aprovar com esta NF (null = nada). */
export function faltaNaNfParaAprovar(nf: NfEmConferencia): string | null {
  if (!nf.numero.trim() || nfIncompleta(nf)) {
    return "Preencha a nota fiscal do fornecedor em “Dados da PP”, olhando a nota ao lado: número, data de emissão e valor são obrigatórios para aprovar.";
  }
  if (!nf.tomador) return "Escolha o CNPJ tomador da NF em “Dados da PP”.";
  return null;
}

// ---------------------------------------------------------------------------
// As retenções
// ---------------------------------------------------------------------------

/**
 * A alíquota de um imposto retido: a informada ou, quando o financeiro
 * digitou o valor, a que sai dele sobre o valor da NF. Zero sem valor.
 */
export function aliquotaEfetiva(
  imposto: ImpostoRetido,
  aliquotas: Partial<Record<ImpostoRetido, number | null>>,
  valores: Partial<Record<ImpostoRetido, number>>,
  base: number,
): number {
  const valor = valores[imposto] ?? 0;
  if (!(valor > 0)) return 0;
  const informada = aliquotas[imposto];
  if (informada != null && informada > 0) return informada;
  return base > 0 ? (valor / base) * 100 : 0;
}

const quatroCasas = (n: number) => Math.round(n * 10000) / 10000;

/**
 * As retenções no formato de `registrar_nf_da_pp` ([{imposto, aliquota}],
 * quatro casas como a coluna). Vazio com a retenção desligada.
 */
export function retencoesParaRegistrar(
  retem: boolean,
  aliquotas: Partial<Record<ImpostoRetido, number | null>>,
  valores: Partial<Record<ImpostoRetido, number>>,
  base: number,
): Array<{ imposto: ImpostoRetido; aliquota: number }> {
  if (!retem) return [];
  const lista: Array<{ imposto: ImpostoRetido; aliquota: number }> = [];
  for (const { imposto } of IMPOSTOS_RETIDOS) {
    const aliquota = quatroCasas(aliquotaEfetiva(imposto, aliquotas, valores, base));
    if (aliquota > 0 && aliquota < 100) lista.push({ imposto, aliquota });
  }
  return lista;
}

/** "0,65%", "3%", "1,5%". */
export function percentual(n: number): string {
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * Vencimento das DARF de retenção (dia 20 do mês seguinte ao PAGAMENTO,
 * antecipa), pela cidade da matriz da PJ tomadora. Null sem data de
 * pagamento ou sem CNPJ tomador.
 */
export function vencimentoDasGuiasFederais(
  cad: CadastroFiscal,
  tomadorId: string,
  dataPagamento: string,
): Vencimento | null {
  if (!dataPagamento) return null;
  const estab = cad.estabelecimentos.find((e) => e.id === tomadorId);
  if (!estab) return null;
  const calculo = estabelecimentoDoCalculo(cad, estab, dataPagamento);
  return vencimentoDasRetencoes(
    dataPagamento,
    feriadosDoCalculo(cad),
    calculo.municipio_da_matriz,
    parametrosDeRetencao(cad).retencoes_dia,
  );
}

/**
 * A guia municipal do ISS retido: no município do CNPJ tomador, no mês
 * seguinte ao da emissão da NF, pela regra do município.
 */
export function guiaDoIssRetido(
  cad: CadastroFiscal,
  tomadorId: string,
  emissao: string,
): { municipio: string; uf: string; vencimento: Vencimento } | null {
  if (!emissao) return null;
  const estab = cad.estabelecimentos.find((e) => e.id === tomadorId);
  if (!estab) return null;
  return {
    municipio: estab.municipio,
    uf: estab.uf,
    vencimento: vencimentoNoMesSeguinte(
      mesDe(emissao),
      estab.iss_retido_dia,
      estab.iss_regra,
      feriadosDoCalculo(cad),
      estab.municipio,
    ),
  };
}

// ---------------------------------------------------------------------------
// O crédito de PIS/COFINS
// ---------------------------------------------------------------------------

/** As notas de saída do job que o crédito olha. */
export interface NotasDoJobParaCredito {
  /** O job já tem nota de saída emitida (cancelada não conta). */
  tem_nota: boolean;
  /** A emissão da primeira nota do job no 82.30-0-01 · 12.08, se houver. */
  primeira_1208: string | null;
}

export const SEM_NOTAS_DO_JOB: NotasDoJobParaCredito = { tem_nota: false, primeira_1208: null };

/**
 * O job conta como faturado no 12.08 para esta NF quando a nota no 12.08
 * saiu no mês da emissão da NF ou antes. Nota no 12.08 de mês posterior
 * não tira o crédito daqui: ele entra no mês da emissão e é estornado no
 * mês da nota (regra do protótipo aprovado).
 */
export function faturadoNo1208ParaANf(primeira1208: string | null, emissao: string): boolean {
  if (!primeira1208) return false;
  if (!emissao) return true;
  return mesDe(primeira1208) <= mesDe(emissao);
}

/** O parâmetro do cadastro vigente na data (a linha mais recente que já começou). */
function parametroNaData(cad: CadastroFiscal, chave: string, data: string): number | null {
  const p = cad.parametros
    .filter((x) => x.chave === chave && x.vigencia_inicio <= data)
    .sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0];
  return p ? Number(p.valor) : null;
}

/** O motivo escolhido, no texto do motivo do crédito ("Outro" → "outro motivo"). */
export function textoDoMotivo(m: string): string {
  return m === "Outro" ? "outro motivo" : m.charAt(0).toLowerCase() + m.slice(1);
}

export interface CreditoDaNf {
  /** Pela regra, sem a troca manual do financeiro. */
  automatico: SituacaoDoCredito;
  /** O que vale: a regra, ou "não gera" quando o financeiro tirou. */
  final: SituacaoDoCredito;
  /** O financeiro tirou um crédito que a regra daria. */
  tirado: boolean;
  aliquotaPis: number;
  aliquotaCofins: number;
}

/**
 * O crédito de PIS/COFINS da NF (`situacaoDoCredito`), com o regime do CNPJ
 * tomador vindo do cadastro, as alíquotas dos parâmetros e as notas de
 * saída do job. A caixa "Não gera crédito" só vale quando a regra daria
 * crédito — e pede o motivo.
 */
export function creditoDaNf(e: {
  nf: NfEmConferencia;
  cadastro: CadastroFiscal;
  notasDoJob: NotasDoJobParaCredito;
  semCredito: boolean;
  motivoSemCredito: string;
  /** "AAAA-MM-DD", para quando a NF ainda não tem emissão. */
  hoje: string;
}): CreditoDaNf {
  const data = e.nf.emissao || e.hoje;
  const estab = e.cadastro.estabelecimentos.find((x) => x.id === e.nf.tomador) ?? null;
  const regimeDoTomador = estab
    ? regimeDaPJ(e.cadastro, estab.empresa_contabil_id, data).regime
    : "lucro_real";
  const aliquotaPis = parametroNaData(e.cadastro, "credito_pis", data) ?? 1.65;
  const aliquotaCofins = parametroNaData(e.cadastro, "credito_cofins", data) ?? 7.6;
  const entrada: EntradaDoCredito = {
    valor: e.nf.valor,
    emissao: e.nf.emissao || null,
    regimeDoTomador,
    retirado: false,
    jobTemNotaDeSaida: e.notasDoJob.tem_nota,
    jobFaturadoNoCumulativo: faturadoNo1208ParaANf(e.notasDoJob.primeira_1208, e.nf.emissao),
    aliquotaPis,
    aliquotaCofins,
  };
  const automatico = situacaoDoCredito(entrada);
  const tirado = e.semCredito && automatico.gera;
  if (!tirado) return { automatico, final: automatico, tirado, aliquotaPis, aliquotaCofins };
  const motivo = e.motivoSemCredito.trim();
  const retirado = situacaoDoCredito({
    ...entrada,
    retirado: true,
    motivoRetirado: motivo ? textoDoMotivo(motivo) : null,
  });
  return {
    automatico,
    final: motivo
      ? retirado
      : { ...retirado, motivo: "Marcado pelo financeiro como sem crédito: escolha o motivo." },
    tirado,
    aliquotaPis,
    aliquotaCofins,
  };
}

// ---------------------------------------------------------------------------
// O CNPJ tomador sugerido (montado no servidor)
// ---------------------------------------------------------------------------

const soDigitos = (s: string | null) => (s ?? "").replace(/\D/g, "");

/**
 * O CNPJ tomador que a NF da PP sugere: o CNPJ ativo do cadastro de
 * impostos igual ao da empresa da PP; sem ele, a matriz California (o CNPJ
 * da empresa principal), e por último a primeira matriz ativa.
 */
export function tomadoresPadrao(
  estabelecimentos: ReadonlyArray<{
    id: string;
    cnpj: string | null;
    ativo: boolean;
    papel: string;
    ordem: number;
  }>,
  empresas: ReadonlyArray<{ id: string; cnpj: string | null; principal: boolean | null }>,
): { porEmpresa: Record<string, string>; geral: string | null } {
  const ativos = estabelecimentos
    .filter((e) => e.ativo && soDigitos(e.cnpj).length === 14)
    .slice()
    .sort((a, b) => a.ordem - b.ordem);
  const porCnpj = new Map(ativos.map((e) => [soDigitos(e.cnpj), e.id]));
  const principal = empresas.find((e) => e.principal === true) ?? null;
  const geral =
    (principal ? porCnpj.get(soDigitos(principal.cnpj)) : undefined) ??
    ativos.find((e) => e.papel === "matriz")?.id ??
    ativos[0]?.id ??
    null;
  const porEmpresa: Record<string, string> = {};
  for (const emp of empresas) {
    const id = porCnpj.get(soDigitos(emp.cnpj)) ?? geral;
    if (id) porEmpresa[emp.id] = id;
  }
  return { porEmpresa, geral };
}
