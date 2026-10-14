import { Building2, Users, Receipt } from "lucide-react";
import type { FechamentoDetalhe } from "@/lib/types";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function KpisFechamento(props: { detalhe: FechamentoDetalhe }) {
  const { total_empresa, total_colaborador, valor_integral, qtd_vinculos } =
    props.detalhe.cabecalho;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Card
        icon={Building2}
        rotulo="Custo empresa"
        valor={brl.format(total_empresa)}
        sublinha="Parte paga pela California (vai para 05.002 Benefícios no DRE)"
      />
      <Card
        icon={Users}
        rotulo="Custo colaborador"
        valor={brl.format(total_colaborador)}
        sublinha={`${qtd_vinculos} vínculos — repasse volta para Despesa com Pessoal no DRE`}
      />
      <Card
        icon={Receipt}
        rotulo="Valor integral"
        valor={brl.format(valor_integral)}
        sublinha="Valor cheio das avulsas geradas (soma das faturas das operadoras)"
      />
    </div>
  );
}

function Card(props: {
  icon: React.ElementType;
  rotulo: string;
  valor: string;
  sublinha: string;
}) {
  const Icon = props.icon;
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {props.rotulo}
        </p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-2xl font-semibold tracking-tight">{props.valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{props.sublinha}</p>
    </div>
  );
}
