// A aba Recorrências (decisão 272): o que a lista, os detalhes e o
// formulário leem. Sem dependência de servidor: o `carregar.ts` monta, e os
// componentes de cliente consomem. As regras puras (status do título,
// pendência do documento, próximas datas) moram aqui para valer igual nas
// três telas.
import type { DocumentoTipo, FormaPagamento, FrequenciaRecorrencia } from "@/lib/types";

/** A recorrência vira título 30 dias antes (`recorrencia_antecedencia_dias`). */
export const ANTECEDENCIA = 30;

export type Situacao = "ativa" | "pausada" | "encerrada";

export interface AnexoDoTitulo {
  id: string;
  nome: string;
  tipo: DocumentoTipo | null;
  numero: string | null;
  quando: string;
}

/** O status do título, como a lista e os detalhes mostram. */
export type Estado = "aguardando" | "previsto" | "a_pagar" | "atrasado" | "sem_extrato" | "a_conciliar" | "pago";

export const ROTULO_DO_ESTADO: Record<Estado, string> = {
  aguardando: "Aguardando conta",
  previsto: "Previsto",
  a_pagar: "A pagar",
  atrasado: "Atrasado",
  sem_extrato: "Sem extrato",
  a_conciliar: "A conciliar",
  pago: "Pago",
};

/** A linha do extrato que o reconhecimento do custo fixo achou para o título. */
export interface NoBanco {
  data: string;
  valor: number;
  contaNome: string;
  historico: string;
  motivo: string;
  valorIgual: boolean;
}

export interface TituloDaRecorrencia {
  id: string;
  codigo: string;
  vencimento: string;
  valor: number;
  pago: boolean;
  pagoEm: string | null;
  anexos: AnexoDoTitulo[];
  /** Pago sem nenhum documento anexado: a pendência. */
  semDocumento: boolean;
  /** A conta que varia ainda não chegou: o valor é a estimativa. */
  estimado: boolean;
  contaLancadaEm: string | null;
  /** A baixa está ligada a uma linha do extrato. */
  conciliado: boolean;
  /** Já tem baixa (parcial ou total), fatura de cartão ou remessa: não muda pela recorrência. */
  travado: boolean;
  estado: Estado;
  /** O extrato que mostra o pagamento (estado "a_conciliar" de título em aberto). */
  banco: NoBanco | null;
  /** O dia até onde o extrato foi importado (para "Sem extrato"/"Atrasado"). */
  bancoAte: string | null;
}

export interface RateioDaRecorrencia {
  regional_id: string;
  nome: string;
  percentual: number;
}

export interface Recorrencia {
  id: string;
  codigo: string;
  descricao: string;
  valor: number;
  empresa_id: string;
  empresa_nome: string;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  cliente_id: string | null;
  tipo_id: string;
  tipo_codigo: string;
  tipo_nome: string;
  subtipo_id: string;
  subtipo_nome: string;
  frequencia: FrequenciaRecorrencia;
  dia_do_mes: number | null;
  dia_quinzena_1: number | null;
  dia_quinzena_2: number | null;
  dia_do_ano_dia: number | null;
  dia_do_ano_mes: number | null;
  proxima_data: string;
  data_fim: string | null;
  ativo: boolean;
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
  valor_variavel: boolean;
  texto_no_extrato: string | null;
  situacao: Situacao;
  rateio: RateioDaRecorrencia[];
  /** Do mais antigo ao mais novo, sem os excluídos. */
  titulos: TituloDaRecorrencia[];
  /** As próximas datas que ainda são previsão (até 3). */
  previstas: string[];
  /** Títulos pagos sem documento. */
  pendentes: number;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function dia(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Calendario = Pick<Recorrencia, "frequencia" | "dia_do_mes" | "dia_quinzena_1" | "dia_quinzena_2" | "dia_do_ano_dia" | "dia_do_ano_mes">;

export function vencimentoResumo(r: Calendario): string {
  if (r.frequencia === "mensal") return `Todo dia ${r.dia_do_mes}`;
  if (r.frequencia === "quinzenal") return `Dias ${r.dia_quinzena_1} e ${r.dia_quinzena_2}`;
  return `Todo ${r.dia_do_ano_dia}/${MESES[(r.dia_do_ano_mes ?? 1) - 1]}`;
}

export function frequenciaNome(f: FrequenciaRecorrencia): string {
  return f === "mensal" ? "Mensal" : f === "quinzenal" ? "Quinzenal" : "Anual";
}

export function somarDias(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** As datas da recorrência a partir de `de` (inclusive), até `n` datas. O
 *  dia que não existe no mês cai no último dia, como `data_quinzena_do_mes`. */
export function proximasDatas(r: Calendario, de: string, n: number, ate?: string | null): string[] {
  const out: string[] = [];
  const [y0, m0] = de.split("-").map(Number);
  const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, ultimoDia(y, m))).padStart(2, "0")}`;
  for (let k = 0; k < 40 && out.length < n; k++) {
    const y = y0 + Math.floor((m0 - 1 + k) / 12);
    const m = ((m0 - 1 + k) % 12) + 1;
    const dias =
      r.frequencia === "mensal"
        ? [r.dia_do_mes ?? 1]
        : r.frequencia === "quinzenal"
          ? [r.dia_quinzena_1 ?? 1, r.dia_quinzena_2 ?? 15]
          : m === (r.dia_do_ano_mes ?? 1)
            ? [r.dia_do_ano_dia ?? 1]
            : [];
    for (const d of dias) {
      const x = iso(y, m, d);
      if (x < de) continue;
      if (ate && x > ate) return out;
      out.push(x);
      if (out.length >= n) break;
    }
  }
  return out;
}

/** A situação da recorrência: ativa, pausada (sem fim) ou encerrada (com fim). */
export function situacaoDa(r: { ativo: boolean; data_fim: string | null }, hoje: string): Situacao {
  if (r.ativo) return r.data_fim && r.data_fim < hoje ? "encerrada" : "ativa";
  return r.data_fim ? "encerrada" : "pausada";
}

/** O status do título. `banco`: a linha do extrato reconhecida (título em aberto). */
export function estadoDoTitulo(
  t: { pago: boolean; conciliado: boolean; estimado: boolean; vencimento: string },
  banco: NoBanco | null,
  bancoAte: string | null,
  hoje: string,
): Estado {
  if (t.pago) return t.conciliado ? "pago" : "a_conciliar";
  if (banco) return "a_conciliar";
  if (t.vencimento >= hoje) return t.estimado ? "aguardando" : "a_pagar";
  if (bancoAte && bancoAte >= t.vencimento) return "atrasado";
  return "sem_extrato";
}

/** O que o status quer dizer, na dica do selo. */
export function dicaDoEstado(
  t: Pick<TituloDaRecorrencia, "estado" | "vencimento" | "bancoAte" | "banco" | "pagoEm">,
): string {
  switch (t.estado) {
    case "aguardando":
      return "A conta deste mês ainda não chegou: o valor é o estimado. Lance a conta (valor real e fatura) antes de pagar.";
    case "previsto":
      return `Ainda é previsão: vira título em ${dia(somarDias(t.vencimento, -ANTECEDENCIA))}.`;
    case "a_pagar":
      return "Título em aberto, com o valor certo.";
    case "atrasado":
      return `Venceu em ${dia(t.vencimento)} e o extrato (importado até ${dia(t.bancoAte)}) não mostra o pagamento.`;
    case "sem_extrato":
      return t.bancoAte
        ? `Venceu em ${dia(t.vencimento)}, mas o extrato só foi importado até ${dia(t.bancoAte)}.`
        : "Nenhum extrato foi importado: o banco ainda não tem como mostrar o pagamento.";
    case "a_conciliar":
      return t.banco
        ? `O extrato mostra o pagamento em ${dia(t.banco.data)} (${t.banco.contaNome}). Falta conciliar, na Conciliação.`
        : `Baixado em ${dia(t.pagoEm ?? t.vencimento)}. Falta conciliar com o extrato, na Conciliação.`;
    default:
      return "Pago e conciliado.";
  }
}

/** O título que a coluna "Próximo título" mostra: o primeiro que ainda não
 *  fechou (pago e conciliado). Sem nenhum, nulo — a coluna usa a previsão. */
export function tituloEmFoco(r: Pick<Recorrencia, "titulos">): TituloDaRecorrencia | null {
  return r.titulos.find((t) => t.estado !== "pago") ?? null;
}
