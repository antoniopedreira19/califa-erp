/**
 * PP de reembolso (decisão 187, 17/10/2026) — a regra num lugar só, para a
 * tela e o servidor contarem igual.
 *
 * Dois tipos de reembolso:
 *
 * - **despesas**: alguém da equipe pagou do próprio bolso (o almoço da
 *   equipe, um táxi, um material comprado na hora). Os comprovantes são
 *   obrigatórios no ENVIO ao financeiro — não na geração —, cada um com
 *   número, data e valor, e a soma deles é o valor da PP.
 * - **veículo próprio**: deslocamento com o carro da pessoa. O valor sai da
 *   conta da planilha "Reembolso de Gasolina" que o financeiro usava:
 *
 *       km do deslocamento = km ida e volta × vezes
 *       combustível        = km ÷ consumo do veículo (km/l) × preço do litro
 *       desgaste           = km × desgaste por km (R$ 0,40 hoje)
 *       valor              = combustível + desgaste
 *
 *   Na planilha o desgaste era um segundo bloco, digitado à parte com os
 *   mesmos trajetos, e nas abas de 2026 ele já divergia do bloco do
 *   combustível (1ª aba: R$ 87,48 × R$ 85,80 pelos mesmos trajetos). Aqui
 *   uma lista só alimenta as duas contas. Todo deslocamento conta nas duas
 *   (resposta 3 do Tiago). A conta arredonda só no fim, como a planilha.
 *   O anexo do veículo próprio (foto da quilometragem, print do mapa) é
 *   obrigatório no envio e não leva tipo (resposta 4).
 *
 * O desgaste por km é um valor da casa que só o financeiro altera
 * (`financeiro_parametros`); a PP guarda o da data em que foi feita.
 */

import type { DocumentoTipo } from "@/lib/types";

export type ReembolsoTipo = "despesas" | "veiculo_proprio";

export const REEMBOLSO_TIPOS: ReadonlyArray<[ReembolsoTipo, string]> = [
  ["despesas", "Despesas"],
  ["veiculo_proprio", "Veículo próprio"],
];

/** "Reembolso de despesas", "Reembolso de veículo próprio". */
export function rotuloDoReembolso(tipo: ReembolsoTipo | null | undefined): string {
  return tipo === "veiculo_proprio" ? "Reembolso de veículo próprio" : "Reembolso de despesas";
}

/** O desgaste por km da planilha — o padrão quando o parâmetro não veio. */
export const DESGASTE_POR_KM_PADRAO = 0.4;

export interface DeslocamentoDoReembolso {
  /** "AAAA-MM-DD". */
  data: string;
  trajeto: string;
  km_ida_volta: number;
  vezes: number;
}

/** O que a PP de veículo próprio guarda em `reembolso_deslocamentos`. */
export interface DeslocamentosDoReembolso {
  consumo_km_l: number;
  preco_litro: number;
  /** O desgaste por km da data da PP (o parâmetro do financeiro). */
  desgaste_por_km: number;
  linhas: DeslocamentoDoReembolso[];
}

export interface ContaDosDeslocamentos {
  km: number;
  litros: number;
  combustivel: number;
  desgaste: number;
  total: number;
  /** O valor de cada linha (sem arredondar), na ordem. */
  porLinha: number[];
}

const centavos = (n: number) => Math.round(n * 100) / 100;

export function contaDosDeslocamentos(d: DeslocamentosDoReembolso): ContaDosDeslocamentos {
  const consumo = d.consumo_km_l;
  let km = 0;
  const porLinha = d.linhas.map((l) => {
    const k = (l.km_ida_volta || 0) * (l.vezes || 0);
    km += k;
    const combustivel = consumo > 0 ? (k / consumo) * d.preco_litro : 0;
    return combustivel + k * d.desgaste_por_km;
  });
  const litros = consumo > 0 ? km / consumo : 0;
  const combustivel = litros * d.preco_litro;
  const desgaste = km * d.desgaste_por_km;
  return {
    km,
    litros,
    combustivel: centavos(combustivel),
    desgaste: centavos(desgaste),
    total: centavos(combustivel + desgaste),
    porLinha,
  };
}

/** O que falta nos deslocamentos para salvar ou gerar. Null = nada. */
export function faltaNosDeslocamentos(d: DeslocamentosDoReembolso): string | null {
  if (!(d.consumo_km_l > 0)) return "Informe o consumo do veículo (km por litro).";
  if (!(d.preco_litro > 0)) return "Informe o preço do litro do combustível.";
  if (d.linhas.length === 0) return "Inclua pelo menos um deslocamento.";
  const incompleta = d.linhas.findIndex(
    (l) => !/^\d{4}-\d{2}-\d{2}$/.test(l.data) || !l.trajeto.trim() || !(l.km_ida_volta > 0) || !(l.vezes >= 1),
  );
  if (incompleta >= 0) {
    return `Preencha a data, o trajeto, os km e as vezes do ${incompleta + 1}º deslocamento.`;
  }
  return null;
}

const km1 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "3 deslocamentos · 104,5 km · combustível R$ 74,09 + desgaste R$ 41,80". */
export function resumoDosDeslocamentos(d: DeslocamentosDoReembolso | null | undefined): string {
  if (!d || d.linhas.length === 0) return "—";
  const c = contaDosDeslocamentos(d);
  const n = d.linhas.length;
  return `${n} ${n === 1 ? "deslocamento" : "deslocamentos"} · ${km1(c.km)} km · combustível ${brl(c.combustivel)} + desgaste ${brl(c.desgaste)}`;
}

/** "104,5 km ÷ 10 km/l × R$ 7,09 + 104,5 km × R$ 0,40" — a conta por extenso. */
export function contaPorExtenso(d: DeslocamentosDoReembolso): string {
  const c = contaDosDeslocamentos(d);
  const consumo = d.consumo_km_l.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return `${km1(c.km)} km ÷ ${consumo} km/l × ${brl(d.preco_litro)} + ${km1(c.km)} km × ${brl(d.desgaste_por_km)}`;
}

// ---------------------------------------------------------------------------
// Comprovantes
// ---------------------------------------------------------------------------

/** Os tipos de comprovante do reembolso de despesas (o cupom fiscal só
 *  existe aqui, por enquanto). */
export const TIPOS_DE_COMPROVANTE: readonly DocumentoTipo[] = ["cupom_fiscal", "nota_fiscal", "recibo", "outro"];

/** Um comprovante, no formato que a tela e o servidor têm em comum. */
export interface ComprovanteDoReembolso {
  tipo: DocumentoTipo | null;
  numero: string | null;
  /** "AAAA-MM-DD" ou vazio. */
  data: string | null;
  valor: number | null;
}

/**
 * O que falta para ENVIAR o reembolso ao financeiro. Null = nada.
 *
 * - Despesas: ao menos um comprovante; em cada um o tipo, o número, a data
 *   e o valor; e a soma igual ao valor da PP.
 * - Veículo próprio: ao menos um arquivo, sem tipo (resposta 4 do Tiago).
 */
export function faltaNosComprovantesDoReembolso(
  comprovantes: ComprovanteDoReembolso[],
  valorPP: number,
  tipo: ReembolsoTipo,
): string | null {
  if (comprovantes.length === 0) {
    return tipo === "veiculo_proprio"
      ? "Anexe o que comprova o deslocamento: a foto da quilometragem, o print do mapa ou o que tiver."
      : "Anexe os comprovantes da despesa: o cupom, a nota ou o recibo de cada gasto.";
  }
  if (tipo === "veiculo_proprio") return null;
  if (comprovantes.some((c) => !c.tipo || !TIPOS_DE_COMPROVANTE.includes(c.tipo))) {
    return "Escolha o tipo de cada comprovante: cupom fiscal, NF, recibo ou outro.";
  }
  if (comprovantes.some((c) => !(c.numero ?? "").trim() || !c.data || !((c.valor ?? 0) > 0))) {
    return "Preencha o número, a data e o valor de cada comprovante.";
  }
  const soma = centavos(comprovantes.reduce((t, c) => t + (c.valor ?? 0), 0));
  if (Math.abs(soma - valorPP) > 0.004) {
    return `Os comprovantes somam ${brl(soma)}; o reembolso é de ${brl(valorPP)}. A soma precisa ser o valor da PP.`;
  }
  return null;
}
