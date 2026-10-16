"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  STATUS_FILTRAVEIS,
  STATUS_LABEL,
} from "../../_components/status-badge";

export function ChipsStatus() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const ativos = React.useMemo(() => {
    const raw = searchParams.get("status");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  function toggleStatus(valor: string) {
    const nova = new Set(ativos);
    if (nova.has(valor)) nova.delete(valor);
    else nova.add(valor);

    const params = new URLSearchParams(searchParams.toString());
    if (nova.size > 0) {
      params.set("status", Array.from(nova).join(","));
    } else {
      params.delete("status");
    }
    const qs = params.toString();
    router.push(`/freelancers/lista${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-2">
        Status
      </span>
      {STATUS_FILTRAVEIS.map((s) => {
        const ativo = ativos.has(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => toggleStatus(s)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all border",
              ativo
                ? "bg-california-dark text-white border-california-dark"
                : "bg-white text-foreground border-border hover:border-california-red/40",
            )}
          >
            {STATUS_LABEL[s]}
          </button>
        );
      })}
    </div>
  );
}
