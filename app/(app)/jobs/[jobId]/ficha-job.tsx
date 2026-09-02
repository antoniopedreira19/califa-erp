import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { LinkSaidaDeModulo } from "@/components/financeiro/link-saida-de-modulo";
import { cn } from "@/lib/utils";
import { competenciaLabelLongo, jobStatusLabel } from "@/lib/types";
import type { JobStatus } from "@/lib/types";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";

/** "17/08/2026" a partir de um `date` ou de um `timestamptz` do banco. */
function formatData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "17/08/2026 → 31/08/2026". Travessão quando as duas pontas faltam. */
function formatPeriodo(inicio: string | null, fim: string | null): string {
  if (!inicio && !fim) return "—";
  return `${formatData(inicio)} → ${formatData(fim)}`;
}

export interface JobDaFicha {
  codigo: string;
  nome: string;
  categoriaNome: string | null;
  produto: string | null;
  regionalNome: string | null;
  cidade: string | null;
  competenciaTrimestre: number | null;
  competenciaAno: number | null;
  dataInicio: string | null;
  dataFim: string | null;
  dataAbertura: string | null;
  abertoPorNome: string | null;
  dataPrevistaFaturamento: string | null;
}

export interface ProjetoDaFicha {
  id: string;
  codigo: string;
  nome: string;
  clienteNome: string | null;
  /** Categoria do projeto (`categorias_dominio`, escopo 'projeto'). */
  tipoNome: string | null;
  dataInicio: string | null;
  dataFim: string | null;
}

export interface JobIrmao {
  id: string;
  codigo: string;
  nome: string;
  status: JobStatus;
}

export interface OrigemDaFicha {
  projetoHref: string;
  orcamentoHref: string;
  orcamentoCodigo: string | null;
  /** Nome da versão aprovada — "Teste A1 - V1". */
  versaoLabel: string;
}

interface Props {
  /** `jobs.observacoes`, rotulado "Descritivo do job" desde 17/08/2026. */
  descritivo: string | null;
  job: JobDaFicha;
  projeto: ProjetoDaFicha;
  /** Todos os jobs do projeto, o desta tela incluído. */
  jobsDoProjeto: JobIrmao[];
  jobAtualId: string;
  /** `?from=...` preservado nos links para os jobs irmãos. */
  jobLinkSuffix: string;
  /**
   * Rota base dos jobs irmãos. Default `/jobs/` — a página de Jobs. O
   * financeiro passa `/financeiro/jobs/`: aquele módulo não encaminha
   * para telas de outros (decisão do Tiago, 20/08/2026).
   */
  jobHrefBase?: string;
  /**
   * Quando a ficha é renderizada FORA do módulo de Jobs, o link do
   * orçamento aprovado passa por uma confirmação de saída de módulo. É a
   * exceção combinada com o Tiago (20/08/2026): o orçamento só existe em
   * Orçamentos, então o caminho fica, mas avisado.
   */
  confirmarSaidaParaOrcamento?: boolean;
  gpNome: string | null;
  produtorNome: string | null;
  origem: OrigemDaFicha;
  contatos: ContatoCobranca[];
  statusBadgeClasses: (status: JobStatus) => string;
}

/**
 * Ficha da aba "Informações do Job" — handoff "Job · Informações —
 * Cabeçalho" (turno 6, 19/08/2026).
 *
 * O descritivo abre a aba numa faixa da largura da tela, em 16px: era o
 * texto mais lido da abertura e vivia no pé da ficha. Abaixo, a ficha
 * separa o que é do JOB do que é do PROJETO em duas colunas da mesma
 * tabela — antes os dois se misturavam num card só chamado "Metadata",
 * onde "Cliente" na verdade mostrava o nome do projeto.
 */
export function FichaJob({
  descritivo,
  job,
  projeto,
  jobsDoProjeto,
  jobAtualId,
  jobLinkSuffix,
  jobHrefBase = "/jobs/",
  confirmarSaidaParaOrcamento = false,
  gpNome,
  produtorNome,
  origem,
  contatos,
  statusBadgeClasses,
}: Props) {
  const texto = descritivo?.trim();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card px-[26px] py-5 shadow-soft">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Descritivo do job
        </p>
        {/* 104ch: o texto para de crescer antes de virar linha larga demais
            para o olho voltar ao começo, mesmo com a tela em 1452px. */}
        <p
          className={cn(
            "mt-1.5 max-w-[104ch] whitespace-pre-wrap text-base leading-[1.55]",
            texto ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {texto || "Sem descritivo do job."}
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_400px]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="grid grid-cols-2">
            <div className="flex flex-col">
              <CabecalhoColuna titulo="Job">
                <span className="font-mono text-[11.5px] font-semibold text-muted-foreground">
                  {job.codigo}
                </span>
              </CabecalhoColuna>
              <Campo rotulo="Nome do job" destaque>
                {job.nome}
              </Campo>
              <Campo rotulo="Categoria do job">{job.categoriaNome ?? "—"}</Campo>
              <Campo rotulo="Marca">{job.produto ?? "—"}</Campo>
              <Campo rotulo="Regional · Cidade">
                {[job.regionalNome, job.cidade].filter(Boolean).join(" · ") ||
                  "—"}
              </Campo>
              <Campo rotulo="Competência">
                {competenciaLabelLongo(
                  job.competenciaTrimestre,
                  job.competenciaAno,
                )}
              </Campo>
              <Campo rotulo="Período" mono>
                {formatPeriodo(job.dataInicio, job.dataFim)}
              </Campo>
              <Campo rotulo="Abertura">
                {job.dataAbertura ? (
                  <>
                    <span className="font-mono text-[13px]">
                      {formatData(job.dataAbertura)}
                    </span>
                    {job.abertoPorNome && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {job.abertoPorNome}
                      </span>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </Campo>
              <Campo rotulo="Prev. recebimento" mono ultimo>
                {formatData(job.dataPrevistaFaturamento)}
              </Campo>
            </div>

            <div className="flex flex-col border-l border-border">
              <CabecalhoColuna titulo="Projeto">
                <Link
                  href={origem.projetoHref}
                  prefetch={false}
                  className="font-mono text-[11.5px] font-semibold text-california-red hover:underline"
                >
                  {projeto.codigo}
                </Link>
              </CabecalhoColuna>
              <Campo rotulo="Nome do projeto" destaque>
                {projeto.nome}
              </Campo>
              <Campo rotulo="Cliente">{projeto.clienteNome ?? "—"}</Campo>
              <Campo rotulo="Tipo do projeto">{projeto.tipoNome ?? "—"}</Campo>
              <Campo rotulo="Período do projeto" mono ultimo>
                {formatPeriodo(projeto.dataInicio, projeto.dataFim)}
              </Campo>

              <div className="flex items-baseline justify-between gap-3 border-t border-border px-[26px] pb-2 pt-3">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  Jobs do projeto
                </p>
                <span className="text-[11px] text-muted-foreground">
                  {jobsDoProjeto.length}
                </span>
              </div>
              {jobsDoProjeto.map((irmao) => {
                const atual = irmao.id === jobAtualId;
                const conteudo = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">
                        {irmao.nome}
                      </span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {irmao.codigo}
                        {atual && " · aberto nesta tela"}
                      </span>
                    </span>
                    <Badge
                      className={cn(
                        "border px-2 py-px text-[9.5px] font-bold uppercase tracking-[0.05em]",
                        statusBadgeClasses(irmao.status),
                      )}
                    >
                      {jobStatusLabel(irmao.status)}
                    </Badge>
                  </>
                );
                const classes =
                  "flex items-center gap-3 border-t border-border/50 px-[26px] py-2";
                return atual ? (
                  <div key={irmao.id} className={classes}>
                    {conteudo}
                  </div>
                ) : (
                  <Link
                    key={irmao.id}
                    href={`${jobHrefBase}${irmao.id}${jobLinkSuffix}`}
                    prefetch={false}
                    className={cn(classes, "transition-colors hover:bg-muted/40")}
                  >
                    {conteudo}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-[22px] pb-[18px] pt-4 shadow-soft">
            <h4 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Responsáveis
            </h4>
            <CampoLateral rotulo="GP responsável" destaque>
              {gpNome ?? "—"}
            </CampoLateral>
            <CampoLateral rotulo="Produtor" destaque>
              {produtorNome ?? "—"}
            </CampoLateral>
          </div>

          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-[22px] pb-[18px] pt-4 shadow-soft">
            <h4 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Origem
            </h4>
            <CampoLateral rotulo="Código do job">
              <span className="font-mono text-[13px] font-semibold">
                {job.codigo}
              </span>
            </CampoLateral>
            <CampoLateral rotulo="Projeto">
              <Link
                href={origem.projetoHref}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                <span className="font-mono text-[13px]">{projeto.codigo}</span> ·{" "}
                {projeto.nome}
              </Link>
            </CampoLateral>
            <CampoLateral rotulo="Orçamento aprovado">
              {confirmarSaidaParaOrcamento ? (
                <LinkSaidaDeModulo
                  href={origem.orcamentoHref}
                  modulo="Orçamentos"
                  descricao={
                    <>
                      A versão aprovada{" "}
                      <span className="font-mono">
                        {origem.orcamentoCodigo ?? "—"}
                      </span>{" "}
                      · {origem.versaoLabel} mora no módulo de Orçamentos —
                      não existe cópia dela no financeiro. Você sai desta
                      tela para abri-la.
                    </>
                  }
                  className="text-california-red hover:underline"
                >
                  <span>
                    <span className="font-mono text-[13px]">
                      {origem.orcamentoCodigo ?? "—"}
                    </span>{" "}
                    · {origem.versaoLabel}
                  </span>
                </LinkSaidaDeModulo>
              ) : (
              <Link
                href={origem.orcamentoHref}
                prefetch={false}
                className="text-california-red hover:underline"
              >
                <span className="font-mono text-[13px]">
                  {origem.orcamentoCodigo ?? "—"}
                </span>{" "}
                · {origem.versaoLabel}
              </Link>
              )}
            </CampoLateral>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-soft">
            <div className="flex items-baseline justify-between gap-3 px-[22px] pb-2.5 pt-4">
              <h4 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Contatos de cobrança
              </h4>
              <span className="text-[11px] text-muted-foreground">
                {contatos.length}
              </span>
            </div>
            {contatos.length === 0 ? (
              // Job anterior a 17/08/2026 não tem contato: a exigência
              // nasceu com o envio para abertura e não houve backfill.
              <p className="border-t border-border/50 px-[22px] py-[9px] text-[12.5px] text-muted-foreground">
                Nenhum contato de cobrança informado na abertura.
              </p>
            ) : (
              <div className="flex flex-col">
                {contatos.map((contato, i) => (
                  <div
                    key={`${contato.email}-${i}`}
                    className="flex flex-col gap-0.5 border-t border-border/50 px-[22px] py-[9px]"
                  >
                    <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                      {contato.nome || "—"}
                      {/* O primeiro da lista é o principal na prática: a
                          ordem é a do formulário de abertura. */}
                      {i === 0 && (
                        <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-[7px] py-px text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                          Principal
                        </span>
                      )}
                    </span>
                    {contato.email && (
                      <span className="break-all text-[12.5px] text-muted-foreground">
                        {contato.email}
                      </span>
                    )}
                    {contato.numero && (
                      <span className="font-mono text-[11.5px] text-muted-foreground">
                        {contato.numero}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CabecalhoColuna({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-[26px] py-[13px]">
      <h4 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {titulo}
      </h4>
      {children}
    </div>
  );
}

function Campo({
  rotulo,
  children,
  destaque,
  mono,
  ultimo,
}: {
  rotulo: string;
  children: React.ReactNode;
  destaque?: boolean;
  mono?: boolean;
  ultimo?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-[26px] py-[9px]",
        !ultimo && "border-b border-border/50",
      )}
    >
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p
        className={cn(
          "mt-0.5",
          mono ? "font-mono text-[13px]" : "text-sm",
          destaque && "font-semibold",
        )}
      >
        {children}
      </p>
    </div>
  );
}

function CampoLateral({
  rotulo,
  children,
  destaque,
}: {
  rotulo: string;
  children: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-0.5 text-sm", destaque && "font-semibold")}>
        {children}
      </p>
    </div>
  );
}
