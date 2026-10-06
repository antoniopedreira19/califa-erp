"use client";

import { useState } from "react";
import { HeartPulse, Smile, Edit3, CheckCircle2, XCircle } from "lucide-react";
import type { BeneficioCompleto } from "@/lib/queries/beneficios";
import { coresBeneficio, compararPlanosParaChip } from "@/lib/beneficios/cores";
import { DrawerCatalogoBeneficio } from "./drawer-catalogo-beneficio";

const formatarBrl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

export function TabCatalogo({ beneficios }: { beneficios: BeneficioCompleto[] }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const beneficioAberto = beneficios.find((b) => b.id === aberto);

  if (beneficios.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
        Nenhum benefício cadastrado. O catálogo nasce com Bradesco Dental, SulAmerica Direto e SulAmerica Especial.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...beneficios].sort(compararPlanosParaChip).map((b) => {
          const cores = coresBeneficio(b.tipo);
          return (
          <button
            key={b.id}
            type="button"
            onClick={() => setAberto(b.id)}
            className="group relative flex flex-col rounded-xl border border-border bg-card p-5 text-left shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
          >
            <div className="flex items-start justify-between gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${cores.bgSuave} ${cores.icon}`}
              >
                {b.tipo === "saude" ? (
                  <HeartPulse className="h-5 w-5" />
                ) : (
                  <Smile className="h-5 w-5" />
                )}
              </div>
              <Edit3 className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground group-hover:text-california-red">
              {b.nome}
            </h3>
            <p className="text-xs text-muted-foreground">{b.operadora}</p>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
              {b.modelo_preco === "flat" ? (
                <span className="text-muted-foreground">
                  Flat {formatarBrl(Number(b.valor_flat ?? 0))}/mês
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {b.faixas.length} faixa{b.faixas.length !== 1 ? "s" : ""} de preço
                </span>
              )}
              {b.ativo ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Ativo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <XCircle className="h-3 w-3" />
                  Inativo
                </span>
              )}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Empresa {b.percentual_empresa_titular}% · colaborador {100 - b.percentual_empresa_titular}% (titular)
            </div>
          </button>
          );
        })}
      </div>

      {beneficioAberto && (
        <DrawerCatalogoBeneficio
          beneficio={beneficioAberto}
          beneficiosParaBase={beneficios.filter(
            (b) => b.id !== beneficioAberto.id && b.tipo === beneficioAberto.tipo && b.modelo_preco === "faixa_etaria",
          )}
          onClose={() => setAberto(null)}
        />
      )}
    </>
  );
}
