import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Briefcase, Circle, Info, Lock, Table2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { competenciaLabel, jobStatusLabel, type JobStatus } from "@/lib/types";
import { formatCurrency, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { carregarJobNoFinanceiro } from "./dados";
import { PrevisoesCard } from "./previsoes-card";
import { PpsCard } from "./pps-card";

export const dynamic = "force-dynamic";

function formatDataBr(iso: string | null): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}

function formatDataHoraBr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function pct(parte: number, todo: number): string {
  if (todo <= 0) return "—";
  return `${((parte / todo) * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * O job na visão do financeiro: somente leitura, focada em dinheiro.
 *
 * Rota própria, e não a página de Jobs, porque as duas respondem a
 * perguntas diferentes — lá é a operação do job, aqui é o compromisso
 * financeiro dele. Planilha interna, erratas e chat continuam morando na
 * página de Jobs; daqui se navega para lá, sem duplicar tela cara de
 * manter.
 */
export default async function JobNoFinanceiroPage({
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

  const dados = await carregarJobNoFinanceiro(
    session.activeTenant.id,
    params.jobId,
  );
  if (!dados) notFound();

  const { job, previsoes, pps } = dados;

  // Job que ainda não passou pela abertura não tem o que mostrar aqui —
  // o lugar dele é a fila.
  if (job.status === "aguardando_abertura") {
    redirect(`/financeiro/abertura-de-job/${job.id}`);
  }

  const custoPrevisto = job.custo_previsto_total ?? 0;
  const margem = job.valor_total - custoPrevisto;

  const metadata: { rotulo: string; valor: string; mono?: boolean }[] = [
    { rotulo: "Cliente", valor: job.cliente_nome ?? "—" },
    { rotulo: "Produto", valor: job.produto ?? "—" },
    { rotulo: "Categoria", valor: job.categoria_nome ?? "—" },
    { rotulo: "Empresa", valor: job.empresa_nome ?? "—" },
    {
      rotulo: "Cidade · Regional",
      valor:
        [job.cidade, job.regional_nome].filter(Boolean).join(" · ") || "—",
    },
    { rotulo: "GP responsável", valor: job.responsavel_nome ?? "—" },
    { rotulo: "Produtor responsável", valor: job.produtor_nome ?? "—" },
    {
      rotulo: "Início · fim",
      valor: `${formatDataBr(job.data_inicio_prevista)} → ${formatDataBr(job.data_fim_prevista)}`,
      mono: true,
    },
    {
      rotulo: "Faturamento em",
      valor: formatDataBr(job.data_prevista_faturamento),
      mono: true,
    },
  ];

  const registro: { rotulo: string; valor: string; mono?: boolean }[] = [
    {
      rotulo: "Competência",
      valor: competenciaLabel(job.competencia_trimestre, job.competencia_ano),
      mono: true,
    },
    {
      rotulo: "Aberto em",
      valor: formatDataHoraBr(job.data_abertura_financeiro),
      mono: true,
    },
    { rotulo: "Aberto por", valor: job.aberto_por_nome ?? "—" },
    {
      rotulo: "Nome na produção",
      valor: job.nome_producao,
    },
  ];

  const kpis = [
    { rotulo: "Valor do job", valor: formatCurrency(job.valor_total, job.moeda) },
    {
      rotulo: "Custo previsto",
      valor: formatCurrency(custoPrevisto, job.moeda),
    },
    {
      rotulo: "Custo planejado",
      valor: formatCurrency(job.planejado_total, job.moeda),
    },
    {
      rotulo: "Custo realizado",
      valor:
        job.realizado_total > 0
          ? formatCurrency(job.realizado_total, job.moeda)
          : "—",
    },
    {
      rotulo: "Margem prevista",
      valor: `${formatCurrency(margem, job.moeda)} · ${pct(margem, job.valor_total)}`,
      destaque: margem >= 0 ? "text-emerald-700" : "text-california-red",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/financeiro/abertura-de-job"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para jobs abertos
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Briefcase className="h-5 w-5 text-california-red" />
          </div>
          <div>
            <p className="font-mono text-xs font-semibold text-muted-foreground">
              {job.codigo}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{job.nome}</h1>
          </div>
          <Badge className="border border-blue-200 bg-blue-50 text-blue-700">
            {jobStatusLabel(job.status as JobStatus)}
          </Badge>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            <Lock className="h-3 w-3" />
            Somente leitura
          </span>
        </div>
      </div>

      {/* KPIs. Um número só do par do fechamento — o Valor do Job —,
          seguindo a regra fixada em 12/08: os dois lado a lado ficam
          restritos aos cards de Totais. */}
      <div className="flex flex-wrap items-stretch overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        {kpis.map((k, i) => (
          <div
            key={k.rotulo}
            className={cn(
              "flex flex-1 flex-col gap-0.5 px-[18px] py-3",
              i > 0 && "border-l border-border",
            )}
          >
            <p className="whitespace-nowrap text-[9.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              {k.rotulo}
            </p>
            <p
              className={cn(
                "whitespace-nowrap font-mono text-sm font-bold",
                k.destaque,
              )}
            >
              {k.valor}
            </p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="mb-[18px] flex items-center gap-2">
            <Info className="h-4 w-4 text-california-red" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em]">
              Metadata
            </h2>
          </div>
          <div className="flex flex-col gap-3 text-[13.5px]">
            {metadata.map((d) => (
              <div
                key={d.rotulo}
                className="grid grid-cols-2 items-baseline gap-4"
              >
                <span className="text-muted-foreground">{d.rotulo}</span>
                <span className={d.mono ? "font-mono text-[12.5px]" : ""}>
                  {d.valor}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="mb-[18px] flex items-center gap-2">
            <Circle className="h-4 w-4 text-california-red" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em]">
              Registro no financeiro
            </h2>
          </div>
          <div className="flex flex-col gap-3 text-[13.5px]">
            {registro.map((d) => (
              <div
                key={d.rotulo}
                className="grid grid-cols-2 items-baseline gap-4"
              >
                <span className="text-muted-foreground">{d.rotulo}</span>
                <span className={d.mono ? "font-mono text-[12.5px]" : ""}>
                  {d.valor}
                </span>
              </div>
            ))}
            <div className="grid grid-cols-2 items-baseline gap-4 border-t border-border pt-3">
              <span className="text-muted-foreground">Origem</span>
              <div className="flex flex-col gap-1">
                <Link
                  href={`/orcamentos/${job.projeto_id}`}
                  prefetch={false}
                  className="font-mono text-[12.5px] text-california-red hover:underline"
                >
                  {job.projeto_codigo ?? "Projeto"}
                </Link>
                <Link
                  href={`/orcamentos/${job.projeto_id}/${job.orcamento_id}`}
                  prefetch={false}
                  className="font-mono text-[12.5px] text-california-red hover:underline"
                >
                  {job.orcamento_codigo ?? "Orçamento"}
                  {job.versao_numero !== null && ` · v${job.versao_numero}`}
                </Link>
              </div>
            </div>
          </div>
          <Link
            href={`/jobs/${job.id}?from=financeiro&aba=planilha`}
            prefetch={false}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors hover:border-[#d7d7d7] hover:bg-muted/70"
          >
            <Table2 className="h-3.5 w-3.5" />
            Ver planilha interna, erratas e comunicação
          </Link>
        </section>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <PrevisoesCard
          previsoes={previsoes}
          custoPrevisto={job.custo_previsto_total}
          valorJob={job.valor_total}
          moeda={job.moeda}
        />
        <PpsCard
          pps={pps}
          custoPrevisto={job.custo_previsto_total}
          moeda={job.moeda}
        />
      </div>

      {job.observacoes && (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          {/* `jobs.observacoes` — o texto que a produção escreve no envio
              do job. Rótulo unificado em 17/08/2026. */}
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em]">
            Descritivo do Job
          </h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {job.observacoes}
          </p>
        </section>
      )}
    </div>
  );
}
