import { Building2, UserCircle2, MapPin } from "lucide-react";
import { CardBase } from "./card-base";
import type { AlocacaoVigenteSnapshot } from "@/lib/types";

type Props = {
  snapshot: AlocacaoVigenteSnapshot | null;
  liderNome: string | null;
  area: string | null;
  nivel: { codigo: string; descricao: string | null } | null;
};

export function CardAlocacaoAtual({
  snapshot,
  liderNome,
  area,
  nivel,
}: Props) {
  const itens = snapshot?.itens ?? [];
  const temAlocacao = itens.length > 0;
  const multiEmpresa = itens.length >= 2;

  return (
    <CardBase titulo="Alocação atual" icon={Building2}>
      <div className="space-y-4">
        {temAlocacao ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Empresa &amp; regional
            </p>
            <ul className="space-y-2">
              {itens.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {item.empresa_nome || "—"}
                    </p>
                    {item.usa_rateio_empresa ? (
                      <p className="text-xs text-muted-foreground">
                        rateio padrão
                      </p>
                    ) : item.regionais.length === 1 ? (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {item.regionais[0].regional_nome}
                      </p>
                    ) : item.regionais.length > 1 ? (
                      <ul className="mt-0.5 space-y-0.5">
                        {item.regionais.map((reg) => (
                          <li
                            key={reg.id}
                            className="flex items-center gap-1 text-xs text-muted-foreground"
                          >
                            <MapPin className="h-3 w-3 shrink-0" />
                            {reg.regional_nome}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {multiEmpresa && (
                    <span className="text-xs font-medium text-muted-foreground shrink-0">
                      {Number(item.percentual_empresa).toFixed(0)}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma alocação vigente.
          </p>
        )}

        {(area || nivel) && (
          <div className="border-t border-border pt-4 space-y-2">
            {nivel && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Nível
                </p>
                <p className="mt-0.5 text-sm">
                  <span className="font-medium">{nivel.codigo}</span>
                  <span className="text-muted-foreground"> · {nivel.descricao}</span>
                </p>
              </div>
            )}
            {area && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Área
                </p>
                <p className="mt-0.5 text-sm font-medium">{area}</p>
              </div>
            )}
          </div>
        )}

        {liderNome && (
          <div className="border-t border-border pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Líder direto
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
              <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
              {liderNome}
            </p>
          </div>
        )}
      </div>
    </CardBase>
  );
}
