/**
 * As linhas da aba Títulos da conciliação: os títulos a pagar e a receber
 * (no tipo das listas reais) num formato só, para a tabela, a busca e os
 * filtros. Módulo puro — vale no servidor, no cliente e no teste.
 */

import type { TituloParaLote } from "@/components/financeiro/baixa-em-lote";
import type { TituloRow as TituloAPagar } from "../contas-a-pagar/titulos-pagar-list";
import type { TituloRow as TituloAReceber } from "../contas-a-receber/titulos-list";
import {
  chaveDoLoteAPagar,
  chaveDoLoteAReceber,
  faltaPagar,
  faltaReceber,
  motivoForaDoLoteAPagar,
  motivoForaDoLoteAReceber,
  paraOLoteAPagar,
  paraOLoteAReceber,
} from "./alvos-da-baixa";

// ---------------------------------------------------------------------------
// A linha da aba
// ---------------------------------------------------------------------------

export type Lado = "pagar" | "receber";

interface LinhaBase {
  /** Única entre os dois lados — a mesma chave da baixa em lote das
   *  listas (`pagar|pp|<id>`, `receber|nf|<id>`…). */
  chave: string;
  /** A pagar: a data de pagamento vigente (a que a lista ordena e
   *  repactua). A receber: o vencimento da nota (o da inadimplência). */
  vencimento: string | null;
  titulo: string;
  referencia: string;
  contraparte: string;
  empresa: string;
  job: { codigo: string; titulo: string } | null;
  /** O que falta: o valor menos as baixas já feitas (decisão 125). */
  aberto: number;
  valor: number;
  baixado: number;
  /** Com baixa e ainda faltando. */
  parcial: boolean;
  /** O dinheiro ENTRA na conta: o a receber, e o estorno de verba (que
   *  mora em Contas a Pagar, mas é dinheiro voltando). */
  entra: boolean;
  busca: string;
  /** Por que não entra na baixa em lote; `null` entra. */
  motivoForaDoLote: string | null;
  /** O título no formato do lote; `null` na origem que não entra nele. */
  lote: TituloParaLote | null;
}

export type Linha =
  | (LinhaBase & { lado: "pagar"; t: TituloAPagar })
  | (LinhaBase & { lado: "receber"; t: TituloAReceber });

/** "PP-00127", "Lançamento avulso"… e a parcela, quando há mais de uma. */
function referenciaAPagar(t: TituloAPagar): string {
  const origem =
    t.origem === "pp"
      ? t.origem_label
      : t.origem === "recorrencia"
        ? "Recorrência"
        : t.origem === "desembolso"
          ? `Desembolso ${t.origem_label}`
          : t.origem === "pp_devolucao_verba"
            ? `Estorno de verba ${t.origem_label.replace(/^ESTORNO /, "")}`
            : t.origem === "fatura_cartao"
              ? `Fatura de cartão ${t.origem_label}`
              : t.origem === "folha"
                ? "Folha de pagamento"
                : "Lançamento avulso";
  return t.parcela_total > 1 ? `${origem} · parcela ${t.parcela_numero}/${t.parcela_total}` : origem;
}

export function linhaAPagar(t: TituloAPagar, empresas: Record<string, string>): Linha {
  const aberto = faltaPagar(t);
  const titulo = t.descricao;
  const referencia = referenciaAPagar(t);
  const contraparte = t.fornecedor_nome || "—";
  const empresa = empresas[t.empresa_id] ?? "—";
  const job = t.job_codigo && t.job_codigo !== "—" ? { codigo: t.job_codigo, titulo: t.job_nome } : null;
  return {
    lado: "pagar",
    t,
    chave: chaveDoLoteAPagar(t),
    vencimento: t.data_pagamento,
    titulo,
    referencia,
    contraparte,
    empresa,
    job,
    aberto,
    valor: t.valor,
    baixado: t.baixado,
    parcial: t.baixas.length > 0 && aberto > 0.004,
    entra: t.origem === "pp_devolucao_verba",
    busca: [titulo, referencia, contraparte, empresa, t.job_codigo, t.job_nome, t.origem_label]
      .join(" ")
      .toLowerCase(),
    motivoForaDoLote: motivoForaDoLoteAPagar(t),
    lote: paraOLoteAPagar(t),
  };
}

export function linhaAReceber(t: TituloAReceber, empresas: Record<string, string>): Linha {
  const aberto = faltaReceber(t);
  const nota = t.origem === "nf";
  const titulo = nota
    ? `NF ${t.fat_numero_nf}${t.total_parcelas > 1 ? ` · parcela ${t.numero_parcela}/${t.total_parcelas}` : ""}`
    : t.fat_descricao;
  const referencia = nota
    ? t.fat_descricao
    : `${t.codigo_avulsa ?? "—"} · ${t.origem === "rendimento" ? "Rendimento" : "Recebimento avulso"}`;
  const empresa = empresas[t.empresa_id] ?? "—";
  const job =
    t.jobs.length > 0
      ? {
          codigo: t.jobs.length > 1 ? `${t.jobs[0].codigo} +${t.jobs.length - 1}` : t.jobs[0].codigo,
          titulo: t.jobs_cobertos.join(" · "),
        }
      : null;
  return {
    lado: "receber",
    t,
    chave: chaveDoLoteAReceber(t),
    vencimento: t.data_vencimento,
    titulo,
    referencia,
    contraparte: t.contraparte_nome,
    empresa,
    job,
    aberto,
    valor: t.valor,
    baixado: t.baixado,
    parcial: t.baixas.length > 0 && aberto > 0.004,
    entra: true,
    busca: [titulo, referencia, t.contraparte_nome, empresa, ...t.jobs_cobertos, t.codigo_avulsa ?? ""]
      .join(" ")
      .toLowerCase(),
    motivoForaDoLote: motivoForaDoLoteAReceber(t),
    lote: paraOLoteAReceber(t),
  };
}

/** Todas as linhas, por vencimento (sem data por último); no mesmo dia, o
 *  a pagar antes do a receber, e depois o título. */
export function montarLinhas(
  aPagar: TituloAPagar[],
  aReceber: TituloAReceber[],
  empresas: Record<string, string>,
): Linha[] {
  return [
    ...aPagar.map((t) => linhaAPagar(t, empresas)),
    ...aReceber.map((t) => linhaAReceber(t, empresas)),
  ].sort(
    (a, b) =>
      (a.vencimento ?? "9999-12-31").localeCompare(b.vencimento ?? "9999-12-31") ||
      a.lado.localeCompare(b.lado) ||
      a.titulo.localeCompare(b.titulo, "pt-BR"),
  );
}

export type FiltroVencimento = "vencidos" | "ate_hoje" | "proximos_7" | "todos";

/** Some `dias` a uma data ISO (no calendário local). */
export function somaDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(y, m - 1, d + dias);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

/**
 * O filtro de vencimento: vencidos (antes de hoje), até hoje (hoje
 * inclusive), os próximos 7 dias (de hoje a hoje + 7) e todos. Sem data,
 * só em Todos.
 */
export function casaVencimento(v: string | null, filtro: FiltroVencimento, hoje: string): boolean {
  if (filtro === "todos") return true;
  if (v === null) return false;
  if (filtro === "vencidos") return v < hoje;
  if (filtro === "ate_hoje") return v <= hoje;
  return v >= hoje && v <= somaDias(hoje, 7);
}
