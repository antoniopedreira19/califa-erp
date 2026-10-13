import Link from "next/link";
import { UserRound, Plus, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { SeletorCompetenciaInline } from "./seletor-competencia-inline";
import type { ColaboradorBasico } from "@/lib/queries/beneficios";

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

export function HeaderColaborador({
  colaborador,
  colaboradorId,
  ano,
  mes,
}: {
  colaborador: ColaboradorBasico;
  colaboradorId: string;
  ano: number;
  mes: number;
}) {
  const descricao = [
    TIPO_LABEL[colaborador.tipo_contratacao] ?? colaborador.tipo_contratacao,
    colaborador.funcao,
    `Admissão ${formatarData(colaborador.data_admissao)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const paramsVinculo = new URLSearchParams();
  paramsVinculo.set("tab", "vinculos");
  paramsVinculo.set("ano", String(ano));
  paramsVinculo.set("mes", String(mes));
  paramsVinculo.set("novo", "vinculo");

  const paramsDep = new URLSearchParams();
  paramsDep.set("tab", "dependentes");
  paramsDep.set("ano", String(ano));
  paramsDep.set("mes", String(mes));
  paramsDep.set("novo", "dependente");

  return (
    <PageHeader
      eyebrow="RH · Benefícios"
      title={colaborador.nome}
      description={descricao}
      icon={UserRound}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SeletorCompetenciaInline ano={ano} mes={mes} />
          <Link
            href={`/rh/beneficios/colaborador/${colaboradorId}?${paramsVinculo.toString()}`}
            prefetch={false}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
          >
            <Plus className="h-4 w-4" />
            Novo Benefício
          </Link>
          <Link
            href={`/rh/beneficios/colaborador/${colaboradorId}?${paramsDep.toString()}`}
            prefetch={false}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-california-red px-3 text-sm font-medium text-white hover:bg-california-red/90"
          >
            <UserPlus className="h-4 w-4" />
            Novo Dependente
          </Link>
        </div>
      }
    />
  );
}
