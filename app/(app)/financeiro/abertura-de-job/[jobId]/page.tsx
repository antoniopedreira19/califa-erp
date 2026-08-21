import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { carregarJobParaAbertura } from "../dados";
import { listarProjetosFinanceiro } from "@/lib/data/projetos-financeiro";
import { listarContasBancarias } from "@/lib/data/contas-bancarias";
import { formatDataHoraBr } from "../formatos";
import { sugerirCurva, sugerirRecebimento, trimestreDe } from "../curva";
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

  const [carregado, categoriasRes, contas] = await Promise.all([
    carregarJobParaAbertura(session.activeTenant.id, params.jobId),
    // Escopo 'orcamento': a categoria do job é a que a produção escolheu
    // no orçamento — o financeiro confere e pode trocar, mas dentro do
    // mesmo vocabulário. Não existe lista de categoria só do financeiro.
    supabase
      .from("categorias_dominio")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo", "orcamento")
      .eq("ativo", true)
      .order("nome"),
    listarContasBancarias(session.activeTenant.id),
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

  const { job, enviadoPorNome } = carregado;

  // Depende do cliente que veio do job — por isso fora do Promise.all
  // acima. O combo lista só projetos do mesmo cliente: agrupar clientes
  // diferentes sob um projeto faria o total somar dinheiro de dois.
  const projetos = await listarProjetosFinanceiro(
    session.activeTenant.id,
    job.cliente_id,
  );

  const agora = new Date();
  const hojeIso = agora.toISOString().slice(0, 10);

  // Custo previsto = planejado dos itens de calha PP — só o que a
  // California de fato desembolsa (docs/decisions/004). A Server Action
  // relê esse mesmo número do banco antes de gravar — o que vai daqui é
  // só o que a tela precisa mostrar. Zero é legítimo: job 100% A/D abre
  // sem curva.
  const custoPrevisto = Math.round(job.planilha_desembolso * 100) / 100;

  // Faturamento previsto = o que a California prevê receber do cliente.
  // É contra ele que as parcelas de recebimento fecham — e não contra o
  // valor total, que inclui o que o cliente paga direto ao fornecedor.
  // A Server Action também relê este número do banco antes de gravar.
  const faturamentoPrevisto =
    Math.round(Number(job.faturamento_previsto ?? 0) * 100) / 100;

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
      projetos={projetos}
      contas={contas}
      custoPrevisto={custoPrevisto}
      faturamentoPrevisto={faturamentoPrevisto}
      enviadoPorNome={enviadoPorNome}
      curvaInicial={sugerirCurva(
        custoPrevisto,
        job.data_inicio_prevista,
        job.data_fim_prevista,
        hojeIso,
      )}
      recebimentoInicial={sugerirRecebimento(
        faturamentoPrevisto,
        job.data_prevista_faturamento,
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
