"use client";

import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

export function ExportarButton() {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const href = `/api/freelancers/export${qs ? `?${qs}` : ""}`;

  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
    >
      <Download className="h-4 w-4" />
      Exportar
    </a>
  );
}
