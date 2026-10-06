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
  listarBeneficiosCompletos,
} from "@/lib/queries/beneficios";
import type { BeneficioModoCusteio } from "@/lib/types";
import { KpisBeneficios } from "./_components/kpis-beneficios";
import { FiltrosQuadro } from "./_components/filtros-quadro";
import { TabelaColaboradores } from "./_components/tabela-colaboradores";
import { TabCatalogo } from "./_components/tab-catalogo";

export const dynamic = "force-dynamic";

type Tab = "quadro" | "catalogo";

const TABS: { key: Tab; label: string }[] = [
  { key: "quadro", label: "Quadro" },
  { key: "catalogo", label: "Catálogo" },
];

function normalizarTab(valor: string | undefined): Tab {
  // Compatibilidade: tab "colaboradores" (legada) vira "quadro"
  if (valor === "catalogo") return "catalogo";
  return "quadro";
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

  // Catálogo é usado em ambas as tabs (quadro: select de filtro + drawer; catalogo: lista)
  const catalogo = await listarBeneficiosDoCatalogo({
    tenantId: session.activeTenant.id,
  });

  // Carrega dados específicos de cada tab em paralelo
  const [kpis, linhas, catalogoCompleto] = await Promise.all([
    tab === "quadro"
      ? kpisTenantBeneficios({
          tenantId: session.activeTenant.id,
          ano,
          mes,
        })
      : Promise.resolve({
          qtde_vinculos_saude: 0,
          qtde_vinculos_dental: 0,
          custo_total_empresa: 0,
          custo_total_colaboradores: 0,
        }),
    tab === "quadro"
      ? listarColaboradoresComBeneficios({
          tenantId: session.activeTenant.id,
          ano,
          mes,
          busca,
          beneficioId,
          modoCusteio,
        })
      : Promise.resolve([]),
    tab === "catalogo"
      ? listarBeneficiosCompletos({ tenantId: session.activeTenant.id })
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
      />

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-6">
          {TABS.map((t) => {
            const ativo = t.key === tab;
            const params = new URLSearchParams();
            params.set("tab", t.key);
            // Preserva competência entre tabs
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

      {tab === "quadro" && (
        <div className="space-y-6">
          <FiltrosQuadro
            busca={busca}
            beneficioId={beneficioId}
            modoCusteio={modoCusteio}
            ano={ano}
            mes={mes}
            beneficios={catalogo
              .filter((b) => b.ativo)
              .map((b) => ({ id: b.id, nome: b.nome }))}
          />
          <KpisBeneficios kpis={kpis} />
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

      {tab === "catalogo" && <TabCatalogo beneficios={catalogoCompleto} />}
    </div>
  );
}
