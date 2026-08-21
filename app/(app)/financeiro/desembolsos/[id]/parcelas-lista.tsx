"use client";

import type { DesembolsoParcela } from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatCurrencyBRL(value: string | number): string {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

type ParcelaRow = Pick<
  DesembolsoParcela,
  | "id"
  | "numero"
  | "data_vencimento"
  | "data_pagamento"
  | "data_pagamento_primeira"
  | "valor"
  | "pago_em"
>;

interface ParcelasListaProps {
  parcelas: ParcelaRow[];
}

export function ParcelasLista({ parcelas }: ParcelasListaProps) {
  if (parcelas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Sem parcelas registradas.</p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Nº</th>
            <th className="px-3 py-2 text-left font-medium">Vencimento</th>
            <th className="px-3 py-2 text-left font-medium">Data de pagamento</th>
            <th className="px-3 py-2 text-right font-medium">Valor</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {parcelas.map((p) => {
            const dataAtual = p.data_pagamento;
            const dataPrimeira = p.data_pagamento_primeira;
            const repactuada =
              dataAtual && dataPrimeira && dataAtual !== dataPrimeira;
            const isPaga = !!p.pago_em;

            return (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {p.numero}
                </td>
                <td className="px-3 py-2">{formatDate(p.data_vencimento)}</td>
                <td className="px-3 py-2">
                  {dataAtual ? (
                    <span>
                      {formatDate(dataAtual)}
                      {repactuada && (
                        <span
                          className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700"
                          title={`Primeira: ${formatDate(dataPrimeira)}`}
                        >
                          primeira: {formatDate(dataPrimeira)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatCurrencyBRL(p.valor)}
                </td>
                <td className="px-3 py-2">
                  {isPaga ? (
                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                      Pago em {formatDate(p.pago_em)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      A pagar
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
