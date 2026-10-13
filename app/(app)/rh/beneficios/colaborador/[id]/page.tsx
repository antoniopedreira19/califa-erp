import { redirect, notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import {
  colaboradorPorId,
  listarVinculosDoColaborador,
  listarDependentesDoColaborador,
  custoMensalDoColaborador,
  listarBeneficiosDoCatalogo,
} from "@/lib/queries/beneficios";
import { HeaderColaborador } from "./_components/header-colaborador";
import { TabsNav, type AbaColaborador } from "./_components/tabs-nav";
import { TabVinculos } from "./_components/tab-vinculos";
import { TabDependentes } from "./_components/tab-dependentes";
import { TabBreakdown } from "./_components/tab-breakdown";

export const dynamic = "force-dynamic";

function normalizarTab(valor: string | undefined): AbaColaborador {
  if (valor === "dependentes") return "dependentes";
  if (valor === "breakdown") return "breakdown";
  return "vinculos";
}

export default async function ColaboradorBeneficiosPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    tab?: string;
    ano?: string;
    mes?: string;
    novo?: string;
    voltarA?: string;
  };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const tenantId = session.activeTenant.id;
  const hoje = new Date();
  const ano = Number(searchParams.ano) || hoje.getFullYear();
  const mes = Number(searchParams.mes) || hoje.getMonth() + 1;
  const tab = normalizarTab(searchParams.tab);
  const novo = searchParams.novo;

  const [colaborador, vinculos, dependentes, breakdown, catalogo] =
    await Promise.all([
      colaboradorPorId({ tenantId, colaboradorId: params.id }),
      listarVinculosDoColaborador({ tenantId, colaboradorId: params.id }),
      listarDependentesDoColaborador({ tenantId, colaboradorId: params.id }),
      custoMensalDoColaborador({ ano, mes, colaboradorId: params.id }),
      listarBeneficiosDoCatalogo({ tenantId }),
    ]);

  if (!colaborador) {
    notFound();
  }

  const vinculosAtivos = vinculos.filter((v) => v.data_fim === null);
  const beneficiosAtivos = catalogo
    .filter((b) => b.ativo)
    .map((b) => ({
      id: b.id,
      nome: b.nome,
      tipo: b.tipo,
      beneficio_base_id: b.beneficio_base_id,
    }));

  // URL base pra links que preservam competência
  const base = new URLSearchParams();
  base.set("ano", String(ano));
  base.set("mes", String(mes));

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh/beneficios?tab=quadro" />

      <HeaderColaborador
        colaborador={colaborador}
        colaboradorId={params.id}
        ano={ano}
        mes={mes}
      />

      <TabsNav
        tabAtual={tab}
        colaboradorId={params.id}
        baseParams={base.toString()}
      />

      {tab === "vinculos" && (
        <TabVinculos
          colaboradorId={params.id}
          vinculos={vinculos}
          beneficios={beneficiosAtivos}
          mostrandoForm={novo === "vinculo"}
          colaboradorTemCpf={!!colaborador.cpf}
          colaboradorTemDataNasc={!!colaborador.data_nascimento}
        />
      )}

      {tab === "dependentes" && (
        <TabDependentes
          colaboradorId={params.id}
          dependentes={dependentes}
          vinculosAtivos={vinculosAtivos}
          mostrandoForm={novo === "dependente"}
        />
      )}

      {tab === "breakdown" && (
        <TabBreakdown breakdown={breakdown} ano={ano} mes={mes} />
      )}
    </div>
  );
}
