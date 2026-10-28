"use client";

import { Building2, MapPin, Percent } from "lucide-react";
import type { AlocacaoVigenteSnapshot } from "@/lib/types";

type Props = {
  snapshot: AlocacaoVigenteSnapshot | null;
  permitirAlterar: boolean;
  onAlterar?: () => void;
};

/**
 * Card visual da alocação vigente. Suporta o modelo novo multi-empresa
 * (N itens com regionais aninhadas) e o legado (1 empresa, rateio padrão
 * ou regional específica).
 *
 * O modal de edição permanece em card-alocacoes.tsx (chamando
 * alterarAlocacaoLegacy) enquanto Task 6 não migra o editor. Este card
 * só exibe — o chamador injeta `onAlterar` que abre o modal antigo.
 */
export function CardAlocacao({ snapshot, permitirAlterar, onAlterar }: Props) {
  const pacote = snapshot?.pacote ?? null;
  const itens = snapshot?.itens ?? [];

  const temItens = itens.length > 0;
  const multiEmpresa = itens.length >= 2;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Building2 className="h-4 w-4 text-california-red" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Alocação</h2>
            <p className="text-xs text-muted-foreground">
              {multiEmpresa
                ? "Multi-empresa — distribuição vigente"
                : "Vigente por vez. Regional ou rateio padrão."}
            </p>
          </div>
        </div>
        {permitirAlterar && onAlterar && (
          <button
            type="button"
            onClick={onAlterar}
            className="inline-flex items-center gap-1.5 rounded-md bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red/90 transition-colors shrink-0"
          >
            Alterar
          </button>
        )}
      </div>

      {/* Corpo */}
      <div className="mt-5">
        {!pacote || !temItens ? (
          <EmptyState />
        ) : (
          <div className="rounded-xl border-2 border-california-red/40 bg-california-red/5 px-4 py-3">
            {/* Badge VIGENTE + data */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-california-red px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                Vigente
              </span>
              <span className="text-xs text-muted-foreground">
                desde {formatarData(pacote.data_inicio)}
              </span>
            </div>

            {/* Lista de itens */}
            <ul className="mt-3 space-y-2">
              {itens.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg bg-white/60 px-3 py-2"
                >
                  {/* Linha empresa + badge % */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {item.empresa_nome || "—"}
                    </span>
                    {multiEmpresa && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-california-red/10 px-2 py-0.5 text-[10px] font-semibold text-california-red">
                        <Percent className="h-2.5 w-2.5" />
                        {Number(item.percentual_empresa).toFixed(0)}
                      </span>
                    )}
                  </div>

                  {/* Subtexto: rateio padrão ou lista de regionais */}
                  {item.usa_rateio_empresa ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      rateio padrão
                    </p>
                  ) : item.regionais.length === 1 ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {item.regionais[0].regional_nome}
                    </p>
                  ) : item.regionais.length > 1 ? (
                    <ul className="mt-1 space-y-0.5">
                      {item.regionais.map((reg) => (
                        <li
                          key={reg.id}
                          className="flex items-center justify-between text-xs text-muted-foreground"
                        >
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {reg.regional_nome}
                          </span>
                          <span className="tabular-nums font-medium">
                            {Number(reg.percentual_regional).toFixed(0)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <p className="text-sm text-muted-foreground">
      Nenhuma alocação registrada ainda.
    </p>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}
