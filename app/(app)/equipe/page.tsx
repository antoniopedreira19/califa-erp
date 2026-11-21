import { redirect } from "next/navigation";
import { Users2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { temLiderados } from "@/lib/equipe/tem-liderados";
import { KpiCardsEquipe } from "./kpi-cards-equipe";
import { EquipeTabs } from "./equipe-tabs";
import { AbaEquipe } from "./aba-equipe";
import { AbaFerias } from "./aba-ferias";

export const dynamic = "force-dynamic";

export default async function EquipePage() {
  const session = await requireSession();
  const supabase = createClient();

  const liderado = await temLiderados(
    supabase,
    session.profile.id,
    session.activeTenant.id,
  );
  if (!liderado) {
    redirect("/home?reason=sem_equipe");
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const daqui60 = new Date();
  daqui60.setDate(daqui60.getDate() + 60);
  const daqui60Str = daqui60.toISOString().slice(0, 10);

  // `vw_equipe_do_lider` já filtra por auth.uid() no WHERE embutido.
  // As queries de férias dependem da RLS `*_lider_select` do PR 1.
  const [liderados, aguardandoVoce, feriasHoje, vencendo60d] =
    await Promise.all([
      supabase
        .from("vw_equipe_do_lider")
        .select("colaborador_id", { count: "exact", head: true }),
      supabase
        .from("colaboradores_ferias_lancamentos")
        .select("id", { count: "exact", head: true })
        .eq("status", "aguardando_gestor"),
      supabase
        .from("colaboradores_ferias_lancamentos")
        .select("id", { count: "exact", head: true })
        .eq("status", "aprovado")
        .lte("data_inicio", hoje)
        .gte("data_fim", hoje),
      supabase
        .from("colaboradores_ferias_periodos")
        .select("id", { count: "exact", head: true })
        .in("status", ["apto", "em_alerta"])
        .lte("data_limite_gozo", daqui60Str)
        .gte("data_limite_gozo", hoje),
    ]);

  const nLiderados = liderados.count ?? 0;
  const nAguardando = aguardandoVoce.count ?? 0;
  const nFeriasHoje = feriasHoje.count ?? 0;
  const nVencendo = vencendo60d.count ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Equipe"
        description="Visão dos colaboradores que reportam a você: quadro atual e aprovações pendentes de férias."
        icon={Users2}
      />

      <KpiCardsEquipe
        liderados={nLiderados}
        aguardandoVoce={nAguardando}
        feriasHoje={nFeriasHoje}
        vencendo60d={nVencendo}
      />

      <EquipeTabs
        badgeFerias={nAguardando}
        equipeContent={<AbaEquipe />}
        feriasContent={<AbaFerias />}
      />
    </div>
  );
}
