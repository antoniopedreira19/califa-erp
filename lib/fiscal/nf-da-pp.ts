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
 * registrados SÓ pelo financeiro, na aprovação, olhando a nota ao lado.
 * ⚠️ Revista pela decisão 152 (07/10/2026): a NF virou cadastro próprio
 * (`notas_fiscais_fornecedor`), a PP pode ter várias e uma nota pode cobrir
 * mais de uma PP. A produção informa os dados de cada nota no envio; o
 * financeiro confere e corrige, e a correção vale para todas as PPs da nota.
 * A nota conta UMA vez no fiscal, pelo total, a partir do registro.
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
import { dataBr, mesDe, ultimoDiaDoMes, vencimentoNoMesSeguinte, type Vencimento } from "./datas";

// ---------------------------------------------------------------------------
// A linha da PP
// ---------------------------------------------------------------------------

/** O regime tributário do fornecedor, como o cadastro guarda hoje. */
export interface RegimeDoFornecedorDaPP {
  regime: RegimeTributarioFornecedor;
  /** Data da última consulta do CNPJ — só quando ela indicou este regime. */
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
    /** O regime que a consulta do CNPJ indicou (decisão 142). */
    regime_consulta: string | null;
    regime_consultado_em: string | null;
    declaracao_simples_recebida: boolean | null;
  } | null,
): RegimeDoFornecedorDaPP | null {
  if (verbaProducao || !fornecedor) return null;
  const regime = REGIMES.find((r) => r === fornecedor.regime_tributario);
  if (!regime) return null;
  // Desde a decisão 142 o cadastro guarda a consulta mesmo quando o regime
  // foi trocado à mão; "· consulta do CNPJ em" só acompanha o regime que
  // ela indicou. Sem `regime_consulta` (gravado antes da 142), a data só
  // existia com o regime indicado.
  const indicou = fornecedor.regime_consulta ?? fornecedor.regime_tributario;
  return {
    regime,
    consultado_em: indicou === regime ? fornecedor.regime_consultado_em ?? null : null,
    declaracao_simples_recebida: fornecedor.declaracao_simples_recebida === true,
  };
}

/** O registro fiscal da nota no cadastro (`notas_fiscais_fornecedor`). */
export interface RegistroDaNota {
  em: string;
  /** "PP-00110": a PP em cuja aprovação a nota foi registrada. */
  na_pp: string | null;
  /** O ISS retido decidido naquela aprovação (a guia sai do total da nota). */
  iss_aliquota: number | null;
  credito_retirado: boolean;
  credito_motivo: string | null;
}

/**
 * Uma NF da PP — um anexo do tipo NF (decisão 152). Os dados são os da nota
 * do cadastro quando o anexo já está ligado a ela; antes disso, os que a
 * produção informou no anexo.
 */
export interface NotaDaLinhaPP {
  anexo_id: string;
  arquivo_nome: string;
  nota_id: string | null;
  numero: string;
  /** "AAAA-MM-DD". */
  emissao: string | null;
  /** O valor TOTAL da nota. */
  valor: number | null;
  tomador: string | null;
  /** A parte da nota que é desta PP (null = a nota inteira). */
  valor_na_pp: number | null;
  /** Null enquanto a nota não foi registrada pelo financeiro. */
  registrada: RegistroDaNota | null;
  /** As outras PPs (não canceladas) que esta nota cobre. */
  outras_pps: Array<{ codigo: string; valor_na_pp: number }>;
}

/**
 * As NFs do fornecedor na linha da PP. Só existe quando a PP tem anexo do
 * tipo NF e não é verba de produção — fora disso o grupo "Notas fiscais do
 * fornecedor" não aparece e a aprovação segue como antes.
 */
export interface NotasFiscaisDaLinhaPP {
  /** Na ordem em que os arquivos foram anexados. */
  notas: NotaDaLinhaPP[];
  /** O financeiro conferiu as notas desta PP na aprovação (`nf_registrada_em`). */
  conferidas_em: string | null;
}

/**
 * O anexo com a nota, como `SELECT_ANEXOS_COM_NOTA` traz. As colunas `nf_*`
 * do anexo são o que a produção informou; `nota`, o cadastro.
 */
export interface AnexoComNotaDoBanco {
  id: string;
  arquivo_nome_original: string;
  documento_tipo: DocumentoTipo | null;
  documento_numero: string | null;
  created_at: string;
  nf_data_emissao: string | null;
  nf_valor: string | number | null;
  nf_tomador_estabelecimento_id: string | null;
  nf_valor_na_pp: string | number | null;
  nota: {
    id: string;
    numero: string;
    data_emissao: string;
    valor: string | number;
    tomador_estabelecimento_id: string;
    registrada_em: string | null;
    iss_retido_aliquota: string | number | null;
    credito_pis_cofins_retirado: boolean | null;
    credito_pis_cofins_motivo: string | null;
    registrada_na_pp: { codigo: string } | null;
    anexos: Array<{
      pedido_compra_id: string;
      nf_valor_na_pp: string | number | null;
      pp: { codigo: string; status: string } | null;
    }> | null;
  } | null;
}

/**
 * O embed dos anexos com a nota e as outras PPs dela. Três chaves entre as
 * tabelas (anexo → nota, nota → anexos, nota → PP que registrou): a última
 * vai com o nome da coluna, senão o PostgREST recusa por ambiguidade.
 */
export const SELECT_ANEXOS_COM_NOTA = `anexos:pedidos_compra_anexos(
          id, arquivo_nome_original, arquivo_tamanho_bytes, created_at,
          documento_tipo, documento_numero,
          nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id, nf_valor_na_pp,
          nota:notas_fiscais_fornecedor(
            id, numero, data_emissao, valor, tomador_estabelecimento_id,
            registrada_em, iss_retido_aliquota,
            credito_pis_cofins_retirado, credito_pis_cofins_motivo,
            registrada_na_pp:pedidos_compra!registrada_na_pp_id(codigo),
            anexos:pedidos_compra_anexos(pedido_compra_id, nf_valor_na_pp, pp:pedidos_compra(codigo, status))
          )
        )`;

/** O que a consulta da PP traz para montar `NotasFiscaisDaLinhaPP`. */
export interface ColunasDaNfNaPP {
  id: string;
  verba_producao: boolean | null;
  nf_registrada_em: string | null;
  anexos: AnexoComNotaDoBanco[] | null;
}

const numeroOuNull = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function notasFiscaisDaLinhaPP(r: ColunasDaNfNaPP): NotasFiscaisDaLinhaPP | null {
  if (r.verba_producao) return null;
  const anexosNf = (r.anexos ?? [])
    .filter((a) => a.documento_tipo === "nota_fiscal")
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (anexosNf.length === 0) return null;
  const notas = anexosNf.map((a): NotaDaLinhaPP => {
    const n = a.nota;
    return {
      anexo_id: a.id,
      arquivo_nome: a.arquivo_nome_original,
      nota_id: n?.id ?? null,
      numero: (n?.numero ?? a.documento_numero ?? "").trim(),
      emissao: (n?.data_emissao ?? a.nf_data_emissao)?.slice(0, 10) ?? null,
      valor: numeroOuNull(n ? n.valor : a.nf_valor),
      tomador: n?.tomador_estabelecimento_id ?? a.nf_tomador_estabelecimento_id ?? null,
      valor_na_pp: numeroOuNull(a.nf_valor_na_pp),
      registrada: n?.registrada_em
        ? {
            em: n.registrada_em,
            na_pp: n.registrada_na_pp?.codigo ?? null,
            iss_aliquota: numeroOuNull(n.iss_retido_aliquota),
            credito_retirado: n.credito_pis_cofins_retirado === true,
            credito_motivo: n.credito_pis_cofins_motivo ?? null,
          }
        : null,
      outras_pps: (n?.anexos ?? [])
        .filter((x) => x.pedido_compra_id !== r.id && x.pp && x.pp.status !== "cancelada")
        .map((x) => ({ codigo: x.pp!.codigo, valor_na_pp: numeroOuNull(x.nf_valor_na_pp) ?? 0 }))
        .sort((x, y) => x.codigo.localeCompare(y.codigo)),
    };
  });
  return { notas, conferidas_em: r.nf_registrada_em };
}

/** "602", ou "602, 603" quando a PP tem mais de uma nota. Null sem número. */
export function numerosDasNotas(n: NotasFiscaisDaLinhaPP | null): string | null {
  const numeros = (n?.notas ?? []).map((x) => x.numero).filter((x) => x !== "");
  return numeros.length ? numeros.join(", ") : null;
}

/**
 * A chave que identifica a mesma nota do mesmo fornecedor — o espelho de
 * `public.chave_do_numero_da_nf`: sem pontuação, espaços e zeros à esquerda.
 */
export function chaveDoNumeroDaNf(numero: string): string | null {
  const s = numero.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^0+/, "");
  return s === "" ? null : s;
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
        : "Lucro Real ou Presumido";
  return r.consultado_em ? `${texto} · consulta do CNPJ em ${dataBr(r.consultado_em)}` : texto;
}

/** Ao lado do nome do fornecedor, na linha das retenções do pop-up. */
export function rotuloCurtoDoRegime(regime: RegimeTributarioFornecedor | null): string {
  if (regime === "normal") return "Lucro Real ou Presumido";
  if (regime === "simples") return "optante do Simples";
  if (regime === "mei") return "MEI";
  return "regime não informado";
}

// ---------------------------------------------------------------------------
// A NF em conferência: a tela guarda, a coluna "Dados da PP" edita e o
// pop-up de aprovação usa (base das retenções e mês do crédito).
// ---------------------------------------------------------------------------

export interface NfEmConferencia {
  /** O anexo do tipo NF que esta nota é. */
  anexo_id: string;
  numero: string;
  /** "AAAA-MM-DD"; vazia até alguém informar. */
  emissao: string;
  /** O valor TOTAL da nota. Zero até alguém informar. */
  valor: number;
  /** `fiscal_estabelecimentos.id`; vazio só quando o cadastro não tem CNPJ ativo. */
  tomador: string;
  /** A parte da nota nesta PP — só vale com `cobre_outra`. */
  valor_na_pp: number;
  /** "Esta NF também cobre outra PP": a parte deixa de ser a nota inteira. */
  cobre_outra: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Começa no que a linha traz (o cadastro, ou o que a produção informou);
 * sem tomador, no CNPJ tomador sugerido. A parte começa no que o anexo
 * guardou; na nota que já está em outra PP, no que falta da nota.
 */
export function nfInicial(nota: NotaDaLinhaPP, tomadorPadrao: string | null): NfEmConferencia {
  const valor = nota.valor ?? 0;
  const jaNasOutras = nota.outras_pps.reduce((s, o) => s + o.valor_na_pp, 0);
  const parteGuardada = nota.valor_na_pp;
  const cobreOutra =
    nota.outras_pps.length > 0 ||
    (parteGuardada !== null && valor > 0 && Math.abs(parteGuardada - valor) > 0.004);
  const parte =
    parteGuardada ?? (nota.outras_pps.length > 0 ? Math.max(0, r2(valor - jaNasOutras)) : valor);
  return {
    anexo_id: nota.anexo_id,
    numero: nota.numero,
    emissao: nota.emissao ?? "",
    valor,
    tomador: nota.tomador ?? tomadorPadrao ?? "",
    valor_na_pp: parte,
    cobre_outra: cobreOutra,
  };
}

/** A parte da nota que é desta PP: a nota inteira, salvo quando cobre outra. */
export function parteDaNota(nf: NfEmConferencia): number {
  return nf.cobre_outra ? nf.valor_na_pp : nf.valor;
}

/** A soma das partes das notas desta PP — a base das retenções do pagamento. */
export function somaDasPartes(nfs: readonly NfEmConferencia[]): number {
  return r2(nfs.reduce((s, nf) => s + parteDaNota(nf), 0));
}

/** Sem data de emissão ou valor, não há mês de crédito nem base de retenção. */
export function nfIncompleta(nf: NfEmConferencia): boolean {
  return !nf.emissao || !(nf.valor > 0) || !(parteDaNota(nf) > 0);
}

/** O que impede aprovar com estas notas (null = nada). A soma das partes
 *  das notas vai até o valor da PP (revisão da decisão 152, 07/10/2026; o
 *  banco confere de novo em `_conferir_partes_da_nota`). */
export function faltaNasNotasParaAprovar(nfs: readonly NfEmConferencia[], valorPP: number): string | null {
  for (const nf of nfs) {
    const qual = nfs.length > 1 && nf.numero.trim() ? ` da NF ${nf.numero.trim()}` : "";
    if (!nf.numero.trim()) {
      return "Preencha o número de cada nota fiscal em “Dados da PP”, olhando a nota ao lado.";
    }
    if (!nf.emissao || !(nf.valor > 0)) {
      return `Preencha a data de emissão e o valor${qual} em “Dados da PP”, olhando a nota ao lado.`;
    }
    if (!nf.tomador) return `Escolha o CNPJ tomador${qual} em “Dados da PP”.`;
    if (nf.cobre_outra && !(nf.valor_na_pp > 0)) {
      return `Informe o valor${qual} nesta PP.`;
    }
    if (nf.cobre_outra && nf.valor_na_pp > nf.valor + 0.004) {
      return `O valor${qual} nesta PP não pode passar do valor da nota.`;
    }
  }
  const chaves = nfs.map((nf) => chaveDoNumeroDaNf(nf.numero));
  if (chaves.some((c, i) => c !== null && chaves.indexOf(c) !== i)) {
    return "A mesma NF aparece duas vezes nesta PP.";
  }
  const soma = somaDasPartes(nfs);
  if (valorPP > 0 && soma > valorPP + 0.004) {
    const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return nfs.length > 1
      ? `As notas somam ${brl(soma)} nesta PP, mais que o valor da PP (${brl(valorPP)}). Ajuste o “Valor nesta PP”.`
      : `A NF nesta PP (${brl(soma)}) passa do valor da PP (${brl(valorPP)}). Use “Esta NF também cobre outra PP” e informe só a parte desta PP.`;
  }
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
    // O dia vigente no fim do mês do pagamento, como no motor da Apuração.
    parametrosDeRetencao(cad, ultimoDiaDoMes(mesDe(dataPagamento))).retencoes_dia,
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
 * tomador vindo do cadastro e as alíquotas dos parâmetros. É o crédito
 * cheio: a parte do 12.08 sai na Apuração, pelo rateio proporcional do mês
 * (decisão 146). A caixa "Não gera crédito" só vale quando a regra daria
 * crédito — e pede o motivo.
 */
export function creditoDaNf(e: {
  nf: NfEmConferencia;
  cadastro: CadastroFiscal;
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
