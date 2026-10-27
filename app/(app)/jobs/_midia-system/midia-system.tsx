"use client";

/**
 * As peças da Mídia System (decisão 216) que a produção e o financeiro
 * veem iguais: o selo do cabeçalho do job e a marca da PP que foi sem NF,
 * embaixo do status. A regra mora em `lib/calculos/midia-system.ts`.
 */

import { FileX2, Receipt, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import {
  rotuloSituacaoMidia,
  type MidiaSystemDoJob,
  type SituacaoMidia,
} from "@/lib/calculos/midia-system";

/** O texto do envio da PP com o job em auditoria. */
export const TEXTO_ENVIO_AUDITORIA =
  "Job Mídia System em auditoria: a NF pode ir depois, quando o financeiro liberar as notas.";

/** O selo ao lado do status do job. Nada para o job que não é Mídia
 *  System. */
export function SeloMidiaSystem({ midia }: { midia: MidiaSystemDoJob | null }) {
  if (!midia) return null;
  const emAuditoria = midia.liberadoEm === null;
  return (
    <span
      title={
        emAuditoria
          ? "Auditoria do cliente em andamento: as PPs podem ir ao financeiro sem NF."
          : `NFs liberadas em ${formatDiaBr(midia.liberadoEm)}: as PPs voltaram a exigir a NF.`
      }
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-800"
    >
      <ShieldCheck className="h-3 w-3" />
      Mídia System · {emAuditoria ? "em auditoria" : "NFs liberadas"}
    </span>
  );
}

const COR_DA_MARCA: Record<SituacaoMidia, string> = {
  sem_nf: "text-muted-foreground",
  aguardando: "text-amber-800",
  em_avaliacao: "text-yellow-800",
  reprovada: "text-california-red",
  aprovada: "text-emerald-700",
};

/** Embaixo do status da PP: foi sem NF, e onde está a prestação dela. */
export function MarcaMidiaNaPP({ situacao }: { situacao: SituacaoMidia | null }) {
  if (!situacao) return null;
  const Icone = situacao === "sem_nf" ? FileX2 : Receipt;
  return (
    <span
      title={
        situacao === "sem_nf"
          ? "Foi ao financeiro sem NF: job Mídia System em auditoria. A nota entra depois da liberação."
          : undefined
      }
      className={cn("inline-flex items-center gap-1 text-[10.5px] font-semibold leading-tight", COR_DA_MARCA[situacao])}
    >
      <Icone className="h-3 w-3 flex-none" />
      {rotuloSituacaoMidia(situacao)}
    </span>
  );
}
