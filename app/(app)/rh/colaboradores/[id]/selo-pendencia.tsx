import { AlertCircle, CheckCircle2, Circle } from "lucide-react";
import type { NivelPendencia } from "@/lib/rh/pendencias";

/**
 * Selo pequeno pra header de card do detalhe do colaborador — reflete o
 * nível da pendência daquela área específica.
 *
 * - completo: verde ✓
 * - parcial: âmbar ○
 * - critica: vermelho ⚠
 */
export function SeloPendencia({ nivel }: { nivel: NivelPendencia }) {
  if (nivel === "completo") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Completo
      </span>
    );
  }
  if (nivel === "parcial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        <Circle className="h-3 w-3" />
        Incompleto
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-california-red/10 px-2 py-0.5 text-xs font-medium text-california-red">
      <AlertCircle className="h-3 w-3" />
      Pendência
    </span>
  );
}
