import { HeartPulse, Smile, Users } from "lucide-react";
import { CardBase, EmBreve } from "./card-base";
import type { BeneficioModoCusteio, BeneficioTipo } from "@/lib/types";
import { coresBeneficio, compararPlanosParaChip } from "@/lib/beneficios/cores";

const MODO_LABEL: Record<BeneficioModoCusteio, string> = {
  rateado: "Rateio 60/40",
  integral_empresa: "100% empresa",
  integral_empresa_com_upgrade: "Integral + upgrade",
};

const formatarBrl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

export interface VinculoResumo {
  beneficio_nome: string;
  beneficio_tipo: BeneficioTipo;
  modo_custeio: BeneficioModoCusteio;
  qtde_dependentes_no_plano: number;
}

export interface BeneficiosResumo {
  vinculos: VinculoResumo[];
  qtde_dependentes_total: number;
  valor_empresa_mes: number;
  valor_desconto_folha_mes: number;
  competencia_mes: number;
  competencia_ano: number;
}

const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

export function CardBeneficios({ resumo }: { resumo: BeneficiosResumo | null }) {
  if (!resumo || resumo.vinculos.length === 0) {
    return (
      <CardBase titulo="Benefícios" icon={HeartPulse} variante="placeholder">
        <EmBreve texto="Você ainda não tem benefícios ativos. O RH é quem cadastra planos de saúde, dental e dependentes." />
      </CardBase>
    );
  }

  const mesLabel = `${MESES_CURTOS[resumo.competencia_mes - 1]}/${resumo.competencia_ano}`;

  return (
    <CardBase titulo="Benefícios" icon={HeartPulse}>
      <div className="space-y-3">
        {/* Lista de planos (ordem canônica: dental primeiro) */}
        <ul className="space-y-2">
          {[...resumo.vinculos]
            .sort((a, b) =>
              compararPlanosParaChip(
                { tipo: a.beneficio_tipo, nome: a.beneficio_nome },
                { tipo: b.beneficio_tipo, nome: b.beneficio_nome },
              ),
            )
            .map((v, i) => (
              <LinhaVinculo key={i} vinculo={v} />
            ))}
        </ul>

        {/* Dependentes */}
        {resumo.qtde_dependentes_total > 0 && (
          <div className="flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>
              {resumo.qtde_dependentes_total === 1
                ? "1 dependente incluído"
                : `${resumo.qtde_dependentes_total} dependentes incluídos`}
            </span>
          </div>
        )}

        {/* Breakdown da competência atual */}
        <div className="space-y-1.5 rounded-md bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Neste mês ({mesLabel})
          </p>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">California cobre</span>
            <span className="tabular-nums font-semibold text-emerald-700">
              {formatarBrl(Number(resumo.valor_empresa_mes))}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Desconto na sua folha</span>
            <span className="tabular-nums font-semibold text-amber-700">
              {formatarBrl(Number(resumo.valor_desconto_folha_mes))}
            </span>
          </div>
        </div>
      </div>
    </CardBase>
  );
}

function LinhaVinculo({ vinculo }: { vinculo: VinculoResumo }) {
  const Icon = vinculo.beneficio_tipo === "saude" ? HeartPulse : Smile;
  const cores = coresBeneficio(vinculo.beneficio_tipo);
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cores.icon}`} />
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-tight text-foreground">
          {vinculo.beneficio_nome}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {MODO_LABEL[vinculo.modo_custeio]}
          {vinculo.qtde_dependentes_no_plano > 0 && (
            <> · {vinculo.qtde_dependentes_no_plano} dep.</>
          )}
        </p>
      </div>
    </li>
  );
}
