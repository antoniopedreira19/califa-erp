import Link from "next/link";
import { Users2, ArrowRight } from "lucide-react";
import { CardBase } from "./card-base";

type Props = {
  liderados: number;
  aguardandoVoce: number;
};

export function CardMinhaEquipe({ liderados, aguardandoVoce }: Props) {
  return (
    <CardBase titulo="Minha equipe" icon={Users2}>
      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Liderados
          </p>
          <p className="mt-0.5 text-sm">
            <span className="font-medium">{liderados}</span>{" "}
            <span className="text-muted-foreground">
              {liderados === 1
                ? "colaborador reporta a você"
                : "colaboradores reportam a você"}
            </span>
          </p>
        </div>

        {aguardandoVoce > 0 ? (
          <div className="border-t border-border pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Aguardando sua aprovação
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-sm">
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                {aguardandoVoce}
              </span>
              <span className="text-muted-foreground">
                {aguardandoVoce === 1
                  ? "solicitação de férias"
                  : "solicitações de férias"}
              </span>
            </p>
          </div>
        ) : null}

        <Link
          href="/perfil/equipe"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted/60"
        >
          Abrir painel da equipe
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </CardBase>
  );
}
