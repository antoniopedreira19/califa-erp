"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { jobStatusLabel, type JobStatus } from "@/lib/types";

export interface JobDoProjetoRow {
  id: string;
  codigo: string;
  nome: string;
  status: JobStatus;
  valor_total: number | string | null;
  responsavel: { nome: string } | null;
}

function statusBadgeClasses(status: JobStatus): string {
  switch (status) {
    case "aberto":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "em_producao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "encerrado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
    case "aguardando_abertura":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "rejeitado_financeiro":
      return "bg-red-50 text-red-700 border-red-200";
  }
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function JobsDoProjetoTable({ jobs }: { jobs: JobDoProjetoRow[] }) {
  const router = useRouter();

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <th className="px-4 py-3 font-semibold">Código</th>
          <th className="px-4 py-3 font-semibold">Nome</th>
          <th className="px-4 py-3 font-semibold">Responsável</th>
          <th className="px-4 py-3 font-semibold text-right">Valor</th>
          <th className="px-4 py-3 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr
            key={j.id}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/jobs/${j.id}?from=jobs`)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push(`/jobs/${j.id}?from=jobs`);
              }
            }}
            className="border-b border-border last:border-0 cursor-pointer hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:bg-accent/40"
          >
            <td className="px-4 py-3 font-mono text-xs">
              <Link
                href={`/jobs/${j.id}?from=jobs`}
                prefetch={false}
                className="text-california-red hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {j.codigo}
              </Link>
            </td>
            <td className="px-4 py-3 font-medium">{j.nome}</td>
            <td className="px-4 py-3 text-muted-foreground">
              {j.responsavel?.nome ?? "—"}
            </td>
            <td className="px-4 py-3 text-right font-mono">
              {j.valor_total !== null && j.valor_total !== undefined
                ? formatMoney(Number(j.valor_total))
                : "—"}
            </td>
            <td className="px-4 py-3">
              <Badge className={cn("border", statusBadgeClasses(j.status))}>
                {jobStatusLabel(j.status)}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
