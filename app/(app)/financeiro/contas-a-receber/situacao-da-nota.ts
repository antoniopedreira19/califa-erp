/**
 * A situação de recebimento de cada nota emitida, para a aba Faturamento de
 * Contas a Receber (decisão 260, protótipo "Faturar em pé" aprovado pelo
 * Tiago em 16/11/2026). Funções puras, sobre os títulos da nota com as
 * mesmas regras da aba Títulos a Receber (`titulos-list.tsx`):
 *
 * - Recebida: todas as parcelas pagas.
 * - Inadimplente: uma parcela venceu sem nada recebido nela. A parcela
 *   vencida que já começou a ser paga NÃO é inadimplente (decisão 125): o
 *   que falta dela fica em "a receber".
 * - Recebida em parte: já entrou dinheiro, e o resto não venceu.
 * - A receber: nada recebido e nada vencido.
 *
 * Os chips da aba mostram PEDAÇOS da nota (`partes`): o recebido em
 * "Recebidos", o vencido sem recebimento em "Inadimplentes" e o que ainda
 * vai vencer em "A receber". A nota recebida em parte vira mais de uma linha.
 * O recebido conta o bruto (o líquido mais os impostos retidos), como o
 * "baixado" dos títulos.
 */

/** O que estas regras leem de um título (a `TituloRow` serve inteira). */
export interface TituloDaNota {
  status: string;
  valor: number;
  /** O que as baixas quitaram: líquido + retidos. */
  baixado: number;
  baixas: readonly unknown[];
  data_vencimento: string;
  pago_em: string | null;
}

export type SituacaoDaNota = "a_receber" | "inadimplente" | "parcial" | "recebida";

/** Um pedaço da nota emitida: cada um é uma linha nos chips. */
export interface ParteDaNota {
  tipo: "recebido" | "inadimplente" | "a_receber";
  valor: number;
  /** As datas, para o selo mostrar ao passar o mouse. */
  dica: string;
}

export interface RecebimentoDaNota {
  /** A situação da nota inteira (a linha do chip "Faturados"). */
  situacao: SituacaoDaNota;
  /** A segunda linha da célula Situação; nulo: a célula mostra a emissão. */
  detalhe: string | null;
  /** Os pedaços, na ordem em que aparecem juntos em "Todos". */
  partes: ParteDaNota[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function moeda(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / 86_400_000);
}

function faltaDo(t: TituloDaNota): number {
  return Math.max(0, r2(t.valor - t.baixado));
}

/**
 * A situação e os pedaços da nota, pelos títulos dela. `hoje` é a data de
 * Brasília (AAAA-MM-DD). Sem título nenhum (a nota acabou de sair), a nota
 * inteira está a receber.
 */
export function recebimentoDaNota(titulos: readonly TituloDaNota[], hoje: string, total: number): RecebimentoDaNota {
  const vivos = titulos.filter((t) => t.status !== "cancelado");
  if (vivos.length === 0) {
    return {
      situacao: "a_receber",
      detalhe: null,
      partes: [{ tipo: "a_receber", valor: r2(total), dica: "Ainda sem parcelas registradas" }],
    };
  }
  const porData = (a: TituloDaNota, b: TituloDaNota) => a.data_vencimento.localeCompare(b.data_vencimento);
  const recebido = r2(vivos.reduce((soma, t) => soma + (t.status === "pago" ? t.valor : Math.min(t.valor, t.baixado)), 0));
  const abertos = vivos.filter((t) => t.status === "em_aberto" && faltaDo(t) > 0.004);
  // Inadimplente é a parcela vencida sem NADA recebido nela (decisão 125).
  const vencidos = abertos.filter((t) => t.baixas.length === 0 && t.data_vencimento < hoje).sort(porData);
  const aVencer = abertos.filter((t) => !vencidos.includes(t)).sort(porData);
  const ultimoPagamento = vivos.map((t) => t.pago_em ?? "").sort().pop() ?? "";

  const partes: ParteDaNota[] = [];
  if (recebido > 0.004) {
    partes.push({
      tipo: "recebido",
      valor: recebido,
      dica: ultimoPagamento ? `Último recebimento em ${dataBr(ultimoPagamento)}` : "Recebido em parte",
    });
  }
  let diasVencida = 0;
  if (vencidos.length > 0) {
    diasVencida = diasEntre(vencidos[0].data_vencimento, hoje);
    partes.push({
      tipo: "inadimplente",
      valor: r2(vencidos.reduce((soma, t) => soma + faltaDo(t), 0)),
      dica: `Vencida há ${diasVencida} dia${diasVencida === 1 ? "" : "s"}, desde ${dataBr(vencidos[0].data_vencimento)}`,
    });
  }
  const faltaAVencer = r2(aVencer.reduce((soma, t) => soma + faltaDo(t), 0));
  if (aVencer.length > 0) {
    const primeiro = aVencer[0].data_vencimento;
    partes.push({
      tipo: "a_receber",
      valor: faltaAVencer,
      dica:
        primeiro < hoje
          ? `Venceu em ${dataBr(primeiro)} e já começou a ser paga`
          : `Próximo vencimento em ${dataBr(primeiro)}`,
    });
  }

  if (abertos.length === 0) {
    return { situacao: "recebida", detalhe: ultimoPagamento ? `Em ${dataBr(ultimoPagamento)}` : null, partes };
  }
  if (vencidos.length > 0) {
    return { situacao: "inadimplente", detalhe: `Vencida há ${diasVencida} dia${diasVencida === 1 ? "" : "s"}`, partes };
  }
  if (recebido > 0.004) {
    const falta = r2(abertos.reduce((soma, t) => soma + faltaDo(t), 0));
    return { situacao: "parcial", detalhe: `Falta ${moeda(falta)}`, partes };
  }
  return { situacao: "a_receber", detalhe: null, partes };
}
