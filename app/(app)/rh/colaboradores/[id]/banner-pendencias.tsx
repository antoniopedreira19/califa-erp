import { AlertCircle } from "lucide-react";
import type { Pendencias } from "@/lib/rh/pendencias";
import { rotuloCampo } from "@/lib/rh/pendencias";

/**
 * Banner exibido no topo do detalhe do colaborador quando ele tem
 * pendências. Só aparece quando `nivel !== "completo"`.
 *
 * - Crítica: fundo vermelho suave, ícone de alerta, lista dos itens
 *   que impedem pagamento.
 * - Parcial: fundo âmbar suave, ícone informativo, lista dos itens
 *   do cadastro que ainda faltam.
 */
export function BannerPendencias({ pendencias }: { pendencias: Pendencias }) {
  if (pendencias.nivel === "completo") return null;

  const critica = pendencias.nivel === "critica";
  const itens = critica
    ? pendencias.criticas.map(rotuloCampo)
    : pendencias.parciais.map(rotuloCampo);

  const tituloCritica =
    pendencias.criticas.length === 1
      ? "1 pendência crítica impede pagamento"
      : `${pendencias.criticas.length} pendências críticas impedem pagamento`;
  const tituloParcial =
    pendencias.parciais.length === 1
      ? "Cadastro com 1 informação em aberto"
      : `Cadastro com ${pendencias.parciais.length} informações em aberto`;

  return (
    <div
      className={`rounded-2xl border p-4 flex items-start gap-3 ${
        critica
          ? "border-california-red/30 bg-california-red/5 text-california-red"
          : "border-amber-300/60 bg-amber-50 text-amber-900"
      }`}
    >
      <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-semibold">
          {critica ? tituloCritica : tituloParcial}
        </p>
        <p className="text-xs">
          {itens.join(" · ")}
        </p>
        {critica && pendencias.parciais.length > 0 && (
          <p className="text-xs opacity-80">
            Também há {pendencias.parciais.length}{" "}
            {pendencias.parciais.length === 1
              ? "informação"
              : "informações"}{" "}
            do cadastro em aberto:{" "}
            {pendencias.parciais.map(rotuloCampo).join(", ")}.
          </p>
        )}
      </div>
    </div>
  );
}
