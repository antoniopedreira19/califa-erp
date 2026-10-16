import Link from "next/link";
import { FileText, ArrowRight, Plus } from "lucide-react";
import type { FreelancerContrato } from "@/lib/types";
import { formatCurrency, cn } from "@/lib/utils";

interface ContratoLinha extends FreelancerContrato {
  job_codigo: string | null;
  job_nome: string | null;
}

interface Props {
  freelancerId: string;
  contratos: ContratoLinha[];
  podeCriar: boolean;
}

export function ContratosDoFreelancer({ freelancerId, contratos, podeCriar }: Props) {
  if (contratos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">
          Nenhum contrato ainda
        </p>
        <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
          Freelancers precisam ter contrato pra registrar valor, cargo e período
          de trabalho em um job.
        </p>
        {podeCriar && (
          <Link
            href={`/freelancers/contratos/novo?freelancer=${freelancerId}`}
            prefetch={false}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo contrato
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
      <table className="w-full text-xs">
        <thead className="bg-muted/20 border-b border-border">
          <tr>
            <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
              Job
            </th>
            <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
              Cargo
            </th>
            <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
              Valor
            </th>
            <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
              Período
            </th>
            <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]">
              Trabalhando
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {contratos.map((c) => (
            <ContratoRow key={c.id} contrato={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TIPO_SIGLA: Record<string, string> = {
  mensal: "/mês",
  periodo: " total",
  diarias: "/dia",
};

function ContratoRow({ contrato: c }: { contrato: ContratoLinha }) {
  const href = `/freelancers/contratos/${c.id}`;
  const periodoInicio = c.data_inicio
    ? formatDataBr(c.data_inicio)
    : "—";
  const periodoTermino = c.data_termino
    ? formatDataBr(c.data_termino)
    : "em aberto";

  return (
    <tr className="border-b border-border last:border-0 hover:bg-california-red/[0.02] transition-colors group">
      <td className="px-3 py-2.5">
        <Link
          href={href}
          prefetch={false}
          className="font-semibold text-foreground group-hover:text-california-red transition-colors"
        >
          {c.job_codigo ? (
            <span className="text-muted-foreground tabular-nums mr-1">
              {c.job_codigo}
            </span>
          ) : null}
          <span>{c.nome_job}</span>
        </Link>
        {c.origem_sistema === "ag_california_rh" && (
          <span className="ml-2 inline-flex items-center rounded-full bg-zinc-100 text-zinc-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
            Legado
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-foreground">
        {c.cargo || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {formatCurrency(Number(c.valor))}
        <span className="text-[10px] text-muted-foreground">
          {TIPO_SIGLA[c.tipo] ?? ""}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums text-foreground">
        <span className="whitespace-nowrap">
          {periodoInicio} → {periodoTermino}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
            c.status_real
              ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
              : "bg-zinc-100 text-zinc-500 ring-zinc-300/60",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              c.status_real ? "bg-emerald-500" : "bg-zinc-400",
            )}
          />
          {c.status_real ? "Ativo" : "Inativo"}
        </span>
      </td>
      <td className="px-2 py-2.5 text-right">
        <Link
          href={href}
          prefetch={false}
          aria-label="Abrir contrato"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-california-red hover:bg-california-red/10 transition-colors"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </td>
    </tr>
  );
}

function formatDataBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
