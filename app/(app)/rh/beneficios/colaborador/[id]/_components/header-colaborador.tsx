import { UserRound } from "lucide-react";
import { AcoesColaborador } from "./acoes-colaborador";
import type { ColaboradorBasico, VinculoDoColaborador } from "@/lib/queries/beneficios";
import type { BeneficioTipo } from "@/lib/types";

const TIPO_LABEL: Record<string, string> = {
  pj: "PJ",
  mei: "MEI",
  clt_recibo: "CLT + Recibo",
  clt: "CLT",
  estagio: "Estagiário",
  socio: "Sócio",
};

const formatarData = (iso: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

type BeneficioOpcao = {
  id: string;
  nome: string;
  tipo: BeneficioTipo;
  beneficio_base_id: string | null;
};

export function HeaderColaborador({
  colaborador,
  colaboradorId,
  ano,
  mes,
  beneficios,
  vinculosAtivos,
  colaboradorTemCpf,
  colaboradorTemDataNasc,
}: {
  colaborador: ColaboradorBasico;
  colaboradorId: string;
  ano: number;
  mes: number;
  beneficios: BeneficioOpcao[];
  vinculosAtivos: VinculoDoColaborador[];
  colaboradorTemCpf: boolean;
  colaboradorTemDataNasc: boolean;
}) {
  const meta = [
    TIPO_LABEL[colaborador.tipo_contratacao] ?? colaborador.tipo_contratacao,
    colaborador.funcao,
    `Admissão ${formatarData(colaborador.data_admissao)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-3 mb-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-california-red">
        RH · Benefícios
      </p>
      <div className="flex items-start justify-between gap-6 flex-wrap">
        {/* Lado esquerdo: ícone + nome + meta */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-california-red/10 p-2 shrink-0">
            <UserRound className="h-5 w-5 text-california-red" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {colaborador.nome}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
          </div>
        </div>

        {/* Lado direito: competência + botões */}
        <AcoesColaborador
          colaboradorId={colaboradorId}
          ano={ano}
          mes={mes}
          beneficios={beneficios}
          vinculosAtivos={vinculosAtivos}
          colaboradorTemCpf={colaboradorTemCpf}
          colaboradorTemDataNasc={colaboradorTemDataNasc}
        />
      </div>
    </div>
  );
}
