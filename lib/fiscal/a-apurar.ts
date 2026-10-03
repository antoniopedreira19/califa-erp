/**
 * "<PJ> · a apurar no recebimento" (módulo fiscal, 03/10/2026 — protótipo
 * aprovado pelo Tiago em 02/10/2026: `telas/apuracao.tsx` e
 * `copias/central-fluxo/dados-do-fluxo.ts`). Funções PURAS: os títulos vêm
 * de `./a-apurar-dados.ts`.
 *
 * No lucro presumido pelo caixa (`fiscal_regimes`; hoje só a Hitlab), PIS,
 * COFINS, IRPJ e CSLL só nascem quando o cliente paga: a Apuração os vê no
 * recebimento, e não na emissão. Até lá, o que falta receber de cada título
 * das notas da PJ é projetado pela previsão de recebimento do título, com as
 * regras do motor (`./apuracao.ts`), sem repeti-las aqui:
 *   - PIS e COFINS: o bruto que falta, nas alíquotas do CNAE da nota
 *     vigentes na emissão (`cnaeNaEmissao` + `debitoNoCaixa`, como a guia),
 *     vencendo no dia do PIS/COFINS do mês seguinte ao recebimento
 *     (`vencimentoDoPisCofins`, o mesmo da guia);
 *   - IRPJ e CSLL: a guia do trimestre do recebimento com o que falta
 *     receber MENOS a guia só com o recebido até hoje — que já está no fluxo
 *     como "Apuração em curso" —, em cotas (`cotasDe`). Assim nada conta duas
 *     vezes, e o adicional de 10% e a presunção da LC 224 caem no real certo.
 * A previsão vencida é lida em hoje + 1 (`rolar`, como toda previsão do
 * fluxo fiscal): o dinheiro só pode entrar daqui em diante.
 *
 * Diferença do protótipo: lá a nota se dividia em parcelas iguais e o PIS +
 * COFINS era 3,65% fixo; aqui as linhas são os títulos a receber de verdade
 * (valor, previsão e o que as baixas já quitaram) e as alíquotas são as do
 * CNAE da nota.
 */
import { regimeDaPJ, type CadastroFiscal } from "./cadastro";
import {
  cnaeNaEmissao,
  comJobs,
  cotasDe,
  debitoNoCaixa,
  fimDoTrimestre,
  guiasIrpjCsllDoTrimestre,
  matrizDaPJ,
  nomeDaPJ,
  nomeDoTrimestre,
  rateioPelasNotas,
  trimestreDe,
  vencimentoDoPisCofins,
  type FatosFiscais,
  type Guia,
  type RateioDaGuia,
  type RecebimentoFiscal,
} from "./apuracao";
import { mesDe, r2 } from "./datas";
import { rolar } from "./fluxo-fiscal";

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

/** Um título a receber de nota de PJ do caixa, com o que as baixas já quitaram. */
export interface TituloAApurar {
  id: string;
  /** `faturamento_id`. */
  nota_id: string;
  numero_parcela: number;
  /** Quantas parcelas a nota tem (sem as canceladas). */
  total_parcelas: number;
  valor: number;
  /** A previsão de recebimento do título; sem ela, o vencimento. */
  previsao: string;
  /** O que as baixas já quitaram: líquido + retidos. */
  recebido: number;
}

/** Uma linha do bloco: o que falta receber de um título e os impostos que ele vai gerar. */
export interface LinhaAApurar {
  titulo_id: string;
  nota_id: string;
  numero_nf: string;
  parcela_numero: number;
  /** "1/2". */
  parcela: string;
  /** "NF 1204 · parcela 1/2 · TES-1013/26 Festival". */
  rotulo: string;
  /** A previsão de recebimento do título (a coluna "Recebimento previsto"). */
  previsao: string;
  /** A data que a projeção usa: a previsão, ou hoje + 1 quando ela já passou. */
  recebimento: string;
  a_receber: number;
  pis: number;
  cofins: number;
  pis_cofins: number;
  /** Vencimento do PIS e da COFINS do mês do recebimento. */
  vencimento: string;
  vencimento_motivo: string | null;
  /** O trimestre do recebimento: é nele que o valor entra na base do IRPJ e da CSLL. */
  trimestre: string;
  /** "4º trimestre/2026". */
  rotulo_trimestre: string;
  /** O job da nota, quando ela é de um job só (vai para o item do fluxo). */
  job_id: string | null;
  /** O PIS + COFINS rateado pelas empresas e regionais dos jobs da nota. */
  rateio: RateioDaGuia[];
}

/** O bloco de uma PJ do caixa na aba Apuração (sem linha, o bloco não aparece). */
export interface BlocoAApurar {
  /** `empresa_contabil_id`. */
  pj: string;
  /** Do nome da matriz ("Hitlab · Salvador" → "Hitlab"), como o `local` das guias. */
  pj_nome: string;
  linhas: LinhaAApurar[];
}

/** O IRPJ e a CSLL que o que falta receber acrescenta a um trimestre. */
export interface IrpjCsllAApurar {
  pj: string;
  pj_nome: string;
  trimestre: string;
  rotulo_trimestre: string;
  /** Guia do trimestre com o que falta receber − guia só com o recebido até hoje. */
  irpj: number;
  csll: number;
  /** As cotas (`cotasDe`) de cada imposto, somadas cota a cota, com os juros. */
  cotas: Array<{ numero: number; vencimento: string; valor: number }>;
  /** Pelas empresas e regionais dos jobs das notas, na proporção do que falta receber. */
  rateio: RateioDaGuia[];
}

// ---------------------------------------------------------------------------
// As PJs, as notas e os títulos
// ---------------------------------------------------------------------------

/** As PJs no lucro presumido pelo caixa em `data`, na ordem do cadastro. */
export function pjsNoCaixa(cad: CadastroFiscal, data: string): string[] {
  const ordem = [...cad.estabelecimentos].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  return [...new Set(ordem.map((e) => e.empresa_contabil_id))].filter((pj) => {
    const r = regimeDaPJ(cad, pj, data);
    return r.regime === "lucro_presumido" && r.regime_caixa;
  });
}

/**
 * As notas das PJs do caixa cujos títulos a leitura precisa ver: as que os
 * recebimentos conhecidos ainda não quitaram (a nota quitada não tem título
 * em aberto). Mantém a consulta curta com o tempo.
 */
export function notasAConsultar(cad: CadastroFiscal, fatos: FatosFiscais, hoje: string): string[] {
  const pjs = new Set(pjsNoCaixa(cad, hoje));
  if (pjs.size === 0) return [];
  const pjDoEstab = new Map(cad.estabelecimentos.map((e) => [e.id, e.empresa_contabil_id]));
  const recebido = new Map<string, number>();
  for (const r of fatos.recebimentos) recebido.set(r.nota_id, (recebido.get(r.nota_id) ?? 0) + r.bruto);
  return fatos.notas
    .filter((n) => pjs.has(pjDoEstab.get(n.estabelecimento_id) ?? "") && r2(n.valor - (recebido.get(n.id) ?? 0)) > 0.009)
    .map((n) => n.id);
}

interface TituloDoBanco {
  id: string;
  faturamento_id: string;
  numero_parcela: number;
  valor: number | string;
  data_vencimento: string;
  data_previsao_recebimento: string | null;
  status: string;
}

/**
 * Os títulos em aberto, montados do que o banco devolve: `titulos_receber`
 * das notas (todas as parcelas não canceladas, para contar "1/2") e o
 * `baixado` de `vw_baixado_por_documento` (líquido + retidos, o mesmo "o que
 * falta" da lista de títulos e do fluxo de caixa).
 */
export function montarTitulosAApurar(titulos: unknown[] | null, baixado: unknown[] | null): TituloAApurar[] {
  const vivos = ((titulos ?? []) as TituloDoBanco[]).filter((t) => t.status !== "cancelado");
  const parcelas = new Map<string, number>();
  for (const t of vivos) parcelas.set(t.faturamento_id, (parcelas.get(t.faturamento_id) ?? 0) + 1);
  const quitado = new Map<string, number>();
  for (const b of (baixado ?? []) as Array<{ documento_id: string; baixado: number | string }>) {
    quitado.set(b.documento_id, (quitado.get(b.documento_id) ?? 0) + Number(b.baixado));
  }
  return vivos
    .filter((t) => t.status === "em_aberto")
    .map((t) => ({
      id: t.id,
      nota_id: t.faturamento_id,
      numero_parcela: Number(t.numero_parcela),
      total_parcelas: parcelas.get(t.faturamento_id) ?? 1,
      valor: Number(t.valor),
      previsao: t.data_previsao_recebimento ?? t.data_vencimento,
      recebido: r2(quitado.get(t.id) ?? 0),
    }));
}

// ---------------------------------------------------------------------------
// O bloco da Apuração (e o PIS + COFINS de cada título)
// ---------------------------------------------------------------------------

/** O bloco de cada PJ do caixa com título a receber, na ordem do cadastro. */
export function blocosAApurar(cad: CadastroFiscal, fatos: FatosFiscais, titulos: TituloAApurar[], hoje: string): BlocoAApurar[] {
  const pjs = pjsNoCaixa(cad, hoje);
  if (pjs.length === 0 || titulos.length === 0) return [];
  const pjDoEstab = new Map(cad.estabelecimentos.map((e) => [e.id, e.empresa_contabil_id]));
  const notaPorId = new Map(fatos.notas.map((n) => [n.id, n]));
  const porPj = new Map<string, LinhaAApurar[]>(pjs.map((pj) => [pj, []]));

  for (const t of titulos) {
    const n = notaPorId.get(t.nota_id);
    const pj = n ? pjDoEstab.get(n.estabelecimento_id) : undefined;
    const linhas = pj ? porPj.get(pj) : undefined;
    if (!n || !pj || !linhas) continue;
    const aReceber = r2(t.valor - t.recebido);
    if (aReceber <= 0.009) continue;

    const recebimento = rolar(t.previsao, hoje);
    const cnae = cnaeNaEmissao(cad, n);
    const pis = debitoNoCaixa(cnae, "PIS", aReceber);
    const cofins = debitoNoCaixa(cnae, "COFINS", aReceber);
    const pisCofins = r2(pis + cofins);
    const v = vencimentoDoPisCofins(cad, pj, mesDe(recebimento));
    const trimestre = trimestreDe(recebimento);
    const parcela = `${t.numero_parcela}/${t.total_parcelas}`;
    // A nota avulsa ou de BV entra no motor com um job de mentira ("nota:<id>").
    const umJob = n.jobs.length === 1 && !n.jobs[0].job_id.startsWith("nota:") ? n.jobs[0].job_id : null;
    linhas.push({
      titulo_id: t.id,
      nota_id: n.id,
      numero_nf: n.numero,
      parcela_numero: t.numero_parcela,
      parcela,
      rotulo: comJobs(`NF ${n.numero} · parcela ${parcela}`, n),
      previsao: t.previsao,
      recebimento,
      a_receber: aReceber,
      pis,
      cofins,
      pis_cofins: pisCofins,
      vencimento: v.data,
      vencimento_motivo: v.motivo,
      trimestre,
      rotulo_trimestre: nomeDoTrimestre(trimestre),
      job_id: umJob,
      rateio: rateioPelasNotas([{ nota: n, valor: aReceber }], pisCofins),
    });
  }

  return pjs
    .filter((pj) => (porPj.get(pj) ?? []).length > 0)
    .map((pj) => ({
      pj,
      pj_nome: nomeDaPJ(cad, pj),
      // Pela previsão de recebimento; no mesmo dia, pela NF e pela parcela.
      linhas: (porPj.get(pj) ?? []).sort(
        (a, b) =>
          a.previsao.localeCompare(b.previsao) ||
          a.numero_nf.localeCompare(b.numero_nf, "pt-BR", { numeric: true }) ||
          a.parcela_numero - b.parcela_numero,
      ),
    }));
}

// ---------------------------------------------------------------------------
// IRPJ e CSLL por trimestre do recebimento
// ---------------------------------------------------------------------------

const apuradoDe = (guias: Guia[], tributo: "IRPJ" | "CSLL") => guias.find((g) => g.tributo === tributo)?.apurado ?? 0;

/**
 * O IRPJ e a CSLL que o que falta receber acrescenta a cada trimestre: a guia
 * com os recebimentos previstos (cada linha recebida na data da projeção, sem
 * retenção) menos a guia de hoje, em cotas.
 */
export function irpjCsllAApurar(cad: CadastroFiscal, fatos: FatosFiscais, blocos: BlocoAApurar[], hoje: string): IrpjCsllAApurar[] {
  const previstos: RecebimentoFiscal[] = blocos.flatMap((b) =>
    b.linhas.map((l) => ({ id: `previsto:${l.titulo_id}`, nota_id: l.nota_id, data: l.recebimento, bruto: l.a_receber, retido: {} })),
  );
  if (previstos.length === 0) return [];
  const comPrevistos: FatosFiscais = { ...fatos, recebimentos: [...fatos.recebimentos, ...previstos] };
  const notaPorId = new Map(fatos.notas.map((n) => [n.id, n]));

  const out: IrpjCsllAApurar[] = [];
  for (const b of blocos) {
    const cidade = matrizDaPJ(cad, b.pj).municipio;
    for (const t of [...new Set(b.linhas.map((l) => l.trimestre))].sort()) {
      const hojeNoTrimestre = guiasIrpjCsllDoTrimestre(cad, fatos, b.pj, t, hoje);
      const comOQueFalta = guiasIrpjCsllDoTrimestre(cad, comPrevistos, b.pj, t, fimDoTrimestre(t));
      const irpj = r2(Math.max(0, apuradoDe(comOQueFalta, "IRPJ") - apuradoDe(hojeNoTrimestre, "IRPJ")));
      const csll = r2(Math.max(0, apuradoDe(comOQueFalta, "CSLL") - apuradoDe(hojeNoTrimestre, "CSLL")));
      const cotasIrpj = cotasDe(irpj, t, cidade, cad);
      const cotasCsll = cotasDe(csll, t, cidade, cad);
      const cotas = Array.from({ length: Math.max(cotasIrpj.length, cotasCsll.length) }, (_, k) => {
        const a = cotasIrpj[k];
        const c = cotasCsll[k];
        return {
          numero: k + 1,
          vencimento: (a ?? c).vencimento,
          valor: r2((a ? a.principal + a.juros : 0) + (c ? c.principal + c.juros : 0)),
        };
      });
      const linhas = b.linhas.filter((l) => l.trimestre === t);
      out.push({
        pj: b.pj,
        pj_nome: b.pj_nome,
        trimestre: t,
        rotulo_trimestre: nomeDoTrimestre(t),
        irpj,
        csll,
        cotas,
        rateio: rateioPelasNotas(
          linhas.flatMap((l) => {
            const nota = notaPorId.get(l.nota_id);
            return nota ? [{ nota, valor: l.a_receber }] : [];
          }),
          r2(irpj + csll),
        ),
      });
    }
  }
  return out;
}
