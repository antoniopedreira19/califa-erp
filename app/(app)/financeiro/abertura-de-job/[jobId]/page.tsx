import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { carregarJobParaAbertura } from "../dados";
import { formatDataHoraBr } from "../formatos";
import { sugerirCurva, trimestreDe } from "../curva";
import { AberturaForm } from "./abertura-form";

export const dynamic = "force-dynamic";

export default async function AbrirJobNoFinanceiroPage({
  params,
}: {
  params: { jobId: string };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const [carregado, categoriasRes] = await Promise.all([
    carregarJobParaAbertura(session.activeTenant.id, params.jobId),
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "job")
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (!carregado) notFound();

  // Quem chegou por link antigo (ou por outra aba que já resolveu o job)
  // vai para a página do job, e não para um formulário que não grava.
  if (carregado.status !== "aguardando_abertura") {
    redirect(`/jobs/${params.jobId}?from=financeiro`);
  }

  if (categoriasRes.error) {
    console.error("[abertura-job.categorias]", categoriasRes.error.message);
  }

  const { job } = carregado;
  const agora = new Date();
  const hojeIso = agora.toISOString().slice(0, 10);

  // Custo previsto = custo planejado da planilha interna. A Server Action
  // relê esse mesmo número do banco antes de gravar — o que vai daqui é
  // só o que a tela precisa mostrar.
  const custoPrevisto = Math.round(job.planilha_planejado * 100) / 100;

  const baseCompetencia = job.data_inicio_prevista ?? hojeIso;
  const anoSugerido = Number(baseCompetencia.slice(0, 4));
  const anoAtual = Number(hojeIso.slice(0, 4));
  const anos = Array.from(
    new Set([anoAtual, anoSugerido, anoSugerido + 1]),
  ).sort((a, b) => a - b);

  return (
    <AberturaForm
      job={job}
      categorias={categoriasRes.data ?? []}
      custoPrevisto={custoPrevisto}
      curvaInicial={sugerirCurva(
        custoPrevisto,
        job.data_inicio_prevista,
        job.data_fim_prevista,
        hojeIso,
      )}
      trimestreSugerido={trimestreDe(baseCompetencia)}
      anoSugerido={anoSugerido}
      anos={anos}
      hojeIso={hojeIso}
      agoraLabel={formatDataHoraBr(agora)}
    />
  );
}
