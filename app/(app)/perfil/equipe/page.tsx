import { redirect } from "next/navigation";
import { Users2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { KpiCardsEquipe } from "./kpi-cards-equipe";
import { EquipeTabs } from "./equipe-tabs";
import { AbaEquipe } from "./aba-equipe";
import { AbaFerias } from "./aba-ferias";

export const dynamic = "force-dynamic";

export default async function EquipePage() {
  const session = await requireSession();
  const supabase = createClient();

  // Busca os IDs dos liderados do caller via `vw_equipe_do_lider`
  // (view com filtro embutido por `auth.uid()`). NÃO confiar só em RLS
  // nas queries abaixo: a tabela `colaboradores_ferias_lancamentos` tem
  // uma policy que libera TUDO do tenant pra `administrador` e `rh` —
  // se não filtrarmos explicitamente, o admin-que-também-é-líder vê
  // pendências de colaboradores de outros líderes.
  const { data: liderados } = await supabase
    .from("vw_equipe_do_lider")
    .select("colaborador_id");

  const lideradoIds = (liderados ?? []).map(
    (l: { colaborador_id: string }) => l.colaborador_id,
  );
  if (lideradoIds.length === 0) {
    redirect("/home?reason=sem_equipe");
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const daqui60 = new Date();
  daqui60.setDate(daqui60.getDate() + 60);
  const daqui60Str = daqui60.toISOString().slice(0, 10);

  const [aguardandoVoce, feriasHoje, vencendo60d] = await Promise.all([
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("id", { count: "exact", head: true })
      .in("colaborador_id", lideradoIds)
      .eq("status", "aguardando_gestor"),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("id", { count: "exact", head: true })
      .in("colaborador_id", lideradoIds)
      .eq("status", "aprovado")
      .in("tipo", ["usufruto", "abono_combinado"])
      .lte("data_inicio", hoje)
      .gte("data_fim", hoje),
    supabase
      .from("colaboradores_ferias_periodos")
      .select("id", { count: "exact", head: true })
      .in("colaborador_id", lideradoIds)
      .in("status", ["apto", "em_alerta"])
      .lte("data_limite_gozo", daqui60Str)
      .gte("data_limite_gozo", hoje),
  ]);

  const nLiderados = lideradoIds.length;
  const nAguardando = aguardandoVoce.count ?? 0;
  const nFeriasHoje = feriasHoje.count ?? 0;
  const nVencendo = vencendo60d.count ?? 0;

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/perfil" />
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
        feriasContent={<AbaFerias lideradoIds={lideradoIds} />}
      />
    </div>
  );
}
