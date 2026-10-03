import { KeyRound, CheckCircle2, Clock } from "lucide-react";
import { roleLabel } from "@/lib/types";
import type { AppRole } from "@/lib/types";
import { CardBase } from "./card-base";

type Props = {
  role: AppRole;
  statusMembership: "ativo" | "inativo";
  lastSignIn: string | null;
  temConvitePendente?: boolean;
};

function tempoRelativo(iso: string | null): string {
  if (!iso) return "nunca";
  const agora = Date.now();
  const quando = new Date(iso).getTime();
  const diffMin = Math.floor((agora - quando) / 60_000);
  if (diffMin < 1) return "agora mesmo";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "ontem";
  if (diffD < 30) return `há ${diffD} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function CardAcessoUsuario({
  role,
  statusMembership,
  lastSignIn,
  temConvitePendente,
}: Props) {
  return (
    <CardBase titulo="Acesso ao sistema" icon={KeyRound}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Papel
            </p>
            <p className="mt-0.5 text-sm font-medium">{roleLabel(role)}</p>
          </div>
          {statusMembership === "ativo" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
              <CheckCircle2 className="h-3 w-3" />
              Ativo
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Inativo
            </span>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Último acesso
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {temConvitePendente
              ? "aguardando primeiro login"
              : tempoRelativo(lastSignIn)}
          </p>
        </div>
      </div>
    </CardBase>
  );
}
