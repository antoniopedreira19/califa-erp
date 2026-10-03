import { Building2, UserCircle2, MapPin } from "lucide-react";
import { CardBase } from "./card-base";

type AlocacaoResumo = {
  empresa_nome: string;
  regional_nome: string | null;
  percentual: number | null;
};

type Props = {
  alocacoes: AlocacaoResumo[];
  liderNome: string | null;
  area: string | null;
  nivel: { codigo: string; descricao: string | null } | null;
};

export function CardAlocacaoAtual({
  alocacoes,
  liderNome,
  area,
  nivel,
}: Props) {
  const temAlocacao = alocacoes.length > 0;

  return (
    <CardBase titulo="Alocação atual" icon={Building2}>
      <div className="space-y-4">
        {temAlocacao ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Empresa & regional
            </p>
            <ul className="space-y-2">
              {alocacoes.map((a, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{a.empresa_nome}</p>
                    {a.regional_nome && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {a.regional_nome}
                      </p>
                    )}
                  </div>
                  {a.percentual !== null && alocacoes.length > 1 && (
                    <span className="text-xs font-medium text-muted-foreground shrink-0">
                      {a.percentual}%
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
