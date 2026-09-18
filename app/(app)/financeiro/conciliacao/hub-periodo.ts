/**
 * Períodos da página inicial da Conciliação (decisão 091).
 *
 * Módulo PURO: ele é importado pelo componente client da tabela, e um
 * `next/headers` na cadeia quebraria a rota inteira.
 */

export type PeriodoChave = "mes" | "anterior" | "90d" | "ano";

export const PERIODOS: Array<{ chave: PeriodoChave; label: string }> = [
  { chave: "mes", label: "Mês atual" },
  { chave: "anterior", label: "Mês anterior" },
  { chave: "90d", label: "Últimos 90 dias" },
  { chave: "ano", label: "No ano" },
];

export const TIPO_CONTA_LABEL: Record<string, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  investimento: "Investimento",
  caixa: "Caixa",
  cartao_credito: "Cartão de crédito",
};

/** Data local em ISO. `toISOString()` vira o dia à noite, no fuso de SP. */
export function isoLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function faixaDoPeriodo(chave: PeriodoChave): {
  de: string;
  ate: string;
  label: string;
} {
  const hoje = new Date();
  const label = PERIODOS.find((p) => p.chave === chave)?.label ?? "Mês atual";
  switch (chave) {
    case "anterior": {
      const de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const ate = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      return { de: isoLocal(de), ate: isoLocal(ate), label };
    }
    case "90d": {
      const de = new Date(hoje);
      de.setDate(de.getDate() - 89);
      return { de: isoLocal(de), ate: isoLocal(hoje), label };
    }
    case "ano": {
      const de = new Date(hoje.getFullYear(), 0, 1);
      return { de: isoLocal(de), ate: isoLocal(hoje), label };
    }
    default: {
      const de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const ate = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
      return { de: isoLocal(de), ate: isoLocal(ate), label };
    }
  }
}

export function lerPeriodo(valor: string | undefined): PeriodoChave {
  return valor === "anterior" || valor === "90d" || valor === "ano"
    ? valor
    : "mes";
}

/** "17/09/26" — a data como o extrato já mostra. */
export function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

export function hrefExtrato(contaId: string, de: string, ate: string): string {
  return `/financeiro/conciliacao?conta=${contaId}&de=${de}&ate=${ate}`;
}

/** Uma conta na página inicial, com os agregados que a RPC devolve. */
export type ContaResumo = {
  id: string;
  nome: string;
  banco: string;
  tipo: string;
  agenciaConta: string | null;
  empresaContabil: string;
  ativa: boolean;
  /** saldo_inicial + tudo que entrou e saiu até hoje. */
  saldoAtual: number;
  creditosPeriodo: number;
  debitosPeriodo: number;
  lancamentosPeriodo: number;
  ultimoMovimento: string | null;
};

export type TotaisConciliacao = {
  saldo: number;
  creditos: number;
  debitos: number;
  contas: number;
  lancamentos: number;
};
