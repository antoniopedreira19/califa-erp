/**
 * Peças da prestação de contas da verba iguais nos dois lados (decisão
 * 189): o selo de cada documento e a barra do que já está comprovado. A
 * produção as vê na gaveta e no cartão do painel do item; o financeiro, no
 * selo dos documentos da conferência.
 */
import * as React from "react";
import { cn, formatCurrency } from "@/lib/utils";
import type { DevolucaoDaVerba, PPVerbaPrestacaoStatus } from "@/lib/types";

/** Onde o documento está — o mesmo para todos os documentos da prestação:
 *  ela vai e volta inteira (versão A, decisão 189). */
export type SituacaoDoDocumento = "salvo" | "com_financeiro" | "conferido";

export function situacaoDoDocumento(status: PPVerbaPrestacaoStatus | null): SituacaoDoDocumento {
  if (status === "em_avaliacao") return "com_financeiro";
  if (status === "aprovada") return "conferido";
  // Rascunho, ou reprovada: voltou para a produção corrigir.
  return "salvo";
}

const SELO: Record<SituacaoDoDocumento, [string, string]> = {
  salvo: ["Salvo · não enviado", "border-dashed border-slate-300 bg-slate-50 text-slate-600"],
  com_financeiro: ["Com o financeiro", "border-yellow-200 bg-yellow-50 text-yellow-800"],
  conferido: ["Conferido", "border-emerald-200 bg-emerald-50 text-emerald-700"],
};

export function SeloDoDocumento({
  situacao,
  className,
}: {
  situacao: SituacaoDoDocumento;
  className?: string;
}) {
  const [rotulo, cor] = SELO[situacao];
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider",
        cor,
        className,
      )}
    >
      {rotulo}
    </span>
  );
}

const PARTES: Array<[SituacaoDoDocumento, string, string]> = [
  ["conferido", "bg-emerald-500", "Conferido"],
  ["com_financeiro", "bg-yellow-400", "Com o financeiro"],
  ["salvo", "bg-slate-300", "Salvo, a enviar"],
];

/**
 * A barra do comprovado: conferido (verde), com o financeiro (amarelo),
 * salvo e ainda não enviado (cinza), e o que falta até a verba.
 */
export function BarraDoComprovado({
  status,
  comprovado,
  verba,
  devolucao,
  compacta = false,
}: {
  /** O status da prestação (null = nada salvo ainda). */
  status: PPVerbaPrestacaoStatus | null;
  /** A soma dos documentos que comprovam gasto (boleto e contrato fora). */
  comprovado: number;
  verba: number;
  devolucao: Pick<DevolucaoDaVerba, "valor" | "pago_em"> | null;
  compacta?: boolean;
}) {
  const brl = (n: number) => formatCurrency(n, "BRL");
  const situacao = situacaoDoDocumento(status);
  const saldo = Math.round((verba - comprovado) * 100) / 100;
  const pct = (v: number) => `${verba > 0 ? Math.max(0, Math.min(100, (v / verba) * 100)) : 0}%`;
  return (
    <div className={cn("flex flex-col", compacta ? "gap-1" : "gap-1.5")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("font-semibold", compacta ? "text-[11px]" : "text-[12.5px]")}>
          Comprovado <span className="font-mono">{brl(comprovado)}</span>{" "}
          <span className="font-normal text-muted-foreground">de {brl(verba)}</span>
        </span>
        <span className={cn("whitespace-nowrap font-mono text-muted-foreground", compacta ? "text-[10.5px]" : "text-[11.5px]")}>
          {devolucao
            ? devolucao.pago_em
              ? `devolvido ${brl(devolucao.valor)}`
              : `estorno ${brl(devolucao.valor)} a receber`
            : saldo >= 0
              ? `saldo ${brl(saldo)}`
              : `passa ${brl(-saldo)}`}
        </span>
      </div>
      <div className={cn("flex w-full overflow-hidden rounded-full bg-muted", compacta ? "h-1.5" : "h-2")}>
        {comprovado > 0 &&
          PARTES.filter(([s]) => s === situacao).map(([s, cor, rotulo]) => (
            <span key={s} className={cor} style={{ width: pct(comprovado) }} title={`${rotulo}: ${brl(comprovado)}`} />
          ))}
      </div>
      {!compacta && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
          {PARTES.map(([s, cor, rotulo]) => (
            <span key={s} className="inline-flex items-center gap-1">
              <i className={cn("inline-block h-2 w-2 rounded-full", cor)} />
              {rotulo} <span className="font-mono text-foreground/80">{brl(s === situacao ? comprovado : 0)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
