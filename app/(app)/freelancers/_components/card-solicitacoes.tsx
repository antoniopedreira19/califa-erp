import Link from "next/link";
import { UserCheck, Clock, CheckCircle2, Ban, XCircle, ArrowRight } from "lucide-react";
import type { FreelancerSolicitacaoStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SolicitacaoResumo {
  id: string;
  nome_freela: string;
  cargo: string | null;
  status: FreelancerSolicitacaoStatus;
  created_at: string;
  solicitante_nome: string | null;
  job_nome: string | null;
}

const STATUS_ICON: Record<
  FreelancerSolicitacaoStatus,
  { icon: React.ElementType; color: string }
> = {
  pendente: { icon: Clock, color: "text-amber-500" },
  aprovada: { icon: CheckCircle2, color: "text-sky-500" },
  cadastrada: { icon: CheckCircle2, color: "text-emerald-500" },
  rejeitada: { icon: XCircle, color: "text-california-red" },
  cancelada: { icon: Ban, color: "text-muted-foreground" },
};

interface Props {
  solicitacoes: SolicitacaoResumo[];
  modo: "pendentes" | "minhas";
}

export function CardSolicitacoes({ solicitacoes, modo }: Props) {
  const titulo =
    modo === "pendentes"
      ? "Solicitações pendentes"
      : "Minhas solicitações";
  const subtituloVazio =
    modo === "pendentes"
      ? "Tudo em dia. Novas solicitações aparecem aqui."
      : "Você não tem solicitações no momento.";

  return (
    <div className="rounded-2xl border border-border bg-white shadow-soft overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <UserCheck className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-foreground">{titulo}</h2>
          <p className="text-xs text-muted-foreground">
            {solicitacoes.length === 0
              ? subtituloVazio
              : `${solicitacoes.length} ${
                  modo === "pendentes" ? "aguardando aprovação" : "em andamento"
                }`}
          </p>
        </div>
        <Link
          href={
            modo === "pendentes"
              ? "/freelancers/solicitacoes?status=pendente"
              : "/freelancers/solicitacoes"
          }
          prefetch={false}
          className="text-[11px] font-semibold text-california-red hover:underline whitespace-nowrap"
        >
          Ver todas
        </Link>
      </div>

      {solicitacoes.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs text-muted-foreground">{subtituloVazio}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border max-h-[360px] overflow-y-auto">
          {solicitacoes.map((s) => {
            const Icon = STATUS_ICON[s.status].icon;
            const cor = STATUS_ICON[s.status].color;
            return (
              <li key={s.id}>
                <Link
                  href={`/freelancers/solicitacoes`}
                  prefetch={false}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors group"
                >
                  <Icon className={cn("h-4 w-4 shrink-0", cor)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {s.nome_freela}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {s.cargo ?? "—"}
                      {s.job_nome && (
                        <>
                          {" · "}
                          <span>{s.job_nome}</span>
                        </>
                      )}
                      {modo === "pendentes" && s.solicitante_nome && (
                        <>
                          {" · por "}
                          <span>{s.solicitante_nome}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-california-red transition-colors shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
