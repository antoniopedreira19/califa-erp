import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import {
  kpisTenantBeneficios,
  listarColaboradoresComBeneficios,
  listarBeneficiosDoCatalogo,
} from "@/lib/queries/beneficios";
import type { BeneficioModoCusteio } from "@/lib/types";
import { KpisBeneficios } from "./_components/kpis-beneficios";
import { SeletorCompetencia } from "./_components/seletor-competencia";
import { FiltrosColaboradores } from "./_components/filtros-colaboradores";
import { TabelaColaboradores } from "./_components/tabela-colaboradores";

export const dynamic = "force-dynamic";

type Tab = "colaboradores" | "catalogo";

const TABS: { key: Tab; label: string }[] = [
  { key: "colaboradores", label: "Colaboradores" },
  { key: "catalogo", label: "Catálogo" },
];

function normalizarTab(valor: string | undefined): Tab {
  return valor === "catalogo" ? "catalogo" : "colaboradores";
}

const MODOS_VALIDOS: BeneficioModoCusteio[] = [
  "rateado",
  "integral_empresa",
  "integral_empresa_com_upgrade",
];

function normalizarModo(valor: string | undefined): BeneficioModoCusteio | undefined {
  if (!valor) return undefined;
  return MODOS_VALIDOS.includes(valor as BeneficioModoCusteio)
    ? (valor as BeneficioModoCusteio)
    : undefined;
}

export default async function BeneficiosPage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
    ano?: string;
    mes?: string;
    busca?: string;
    beneficioId?: string;
    modoCusteio?: string;
  };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const hoje = new Date();
  const ano = Number(searchParams.ano) || hoje.getFullYear();
  const mes = Number(searchParams.mes) || hoje.getMonth() + 1;
  const tab: Tab = normalizarTab(searchParams.tab);
  const busca = searchParams.busca?.trim() || undefined;
  const beneficioId = searchParams.beneficioId?.trim() || undefined;
  const modoCusteio = normalizarModo(searchParams.modoCusteio);

  const [kpis, catalogo, linhas] = await Promise.all([
    kpisTenantBeneficios({
      tenantId: session.activeTenant.id,
      ano,
      mes,
    }),
    listarBeneficiosDoCatalogo({ tenantId: session.activeTenant.id }),
    tab === "colaboradores"
      ? listarColaboradoresComBeneficios({
          tenantId: session.activeTenant.id,
          ano,
          mes,
          busca,
          beneficioId,
          modoCusteio,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh" />
      <PageHeader
        eyebrow="RH"
        title="Gestão de Benefícios"
        description="Planos de saúde, dental e dependentes dos colaboradores. Custo mensal calculado por faixa etária e modo de custeio."
        icon={ShieldPlus}
        actions={<SeletorCompetencia ano={ano} mes={mes} />}
      />

      <KpisBeneficios kpis={kpis} />

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-6">
          {TABS.map((t) => {
            const ativo = t.key === tab;
            const params = new URLSearchParams();
            params.set("tab", t.key);
            params.set("ano", String(ano));
            params.set("mes", String(mes));
            return (
              <Link
                key={t.key}
                href={`/rh/beneficios?${params.toString()}`}
                prefetch={false}
                className={`px-1 pb-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  ativo
                    ? "border-california-red text-california-red"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Conteúdo da tab */}
      {tab === "colaboradores" && (
        <div className="space-y-4">
          <FiltrosColaboradores
            busca={busca}
            beneficioId={beneficioId}
            modoCusteio={modoCusteio}
            beneficios={catalogo.filter((b) => b.ativo).map((b) => ({ id: b.id, nome: b.nome }))}
          />
          <TabelaColaboradores
            linhas={linhas}
            ano={ano}
            mes={mes}
            beneficios={catalogo
              .filter((b) => b.ativo)
              .map((b) => ({
                id: b.id,
                nome: b.nome,
                tipo: b.tipo,
                beneficio_base_id: b.beneficio_base_id,
              }))}
          />
        </div>
      )}

      {tab === "catalogo" && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          Em breve (S5): catálogo editável de benefícios e faixas de preço.
        </div>
      )}
    </div>
  );
}
