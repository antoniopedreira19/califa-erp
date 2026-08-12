"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Check,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import { aprovarVersao } from "../actions";
import { enviarJobParaAbertura } from "./abertura-actions";
import {
  EnviarJobModal,
  type DadosJob,
  type HerdadosJob,
} from "./enviar-job-modal";
import { ConfirmarEnvioModal } from "./confirmar-envio-modal";

type Modal = "aprovar" | "form" | "envio" | null;

export interface JobExistente {
  id: string;
  codigo: string;
  data_prevista_faturamento: string | null;
  produto: string | null;
  cidade: string | null;
  regional_id: string | null;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
  observacoes: string | null;
  nome: string;
}

interface Props {
  versaoId: string;
  versaoLabel: string;
  versaoStatus: string;
  orcamentoCodigo: string;
  jobHref: string | null;

  qtdGrupos: number;
  qtdItens: number;
  custoPlanejado: number;
  /** O que a California emite nota. */
  faturamentoPrevisto: number;
  /** Compromisso total do cliente — é o que vai para `jobs.valor_total`. */
  valorJob: number;
  moeda: string;

  clienteNome: string;
  proximoCodigoJob: string;
  projetoNome: string;
  projetoCodigo: string;

  /** Produto, cidade, regional, GP e produtor: só exibidos. O servidor
   *  relê tudo do projeto/orçamento na hora de gravar o job. */
  herdados: HerdadosJob;

  /** Valores que pré-preenchem o modal, vindos do orçamento. */
  inicial: DadosJob;
  job: JobExistente | null;
}

export function FluxoAbertura({
  versaoId,
  versaoLabel,
  versaoStatus,
  orcamentoCodigo,
  jobHref,
  qtdGrupos,
  qtdItens,
  custoPlanejado,
  faturamentoPrevisto,
  valorJob,
  moeda,
  clienteNome,
  proximoCodigoJob,
  projetoNome,
  projetoCodigo,
  herdados,
  inicial,
  job,
}: Props) {
  const router = useRouter();
  const [modal, setModal] = React.useState<Modal>(null);
  const [pending, startTransition] = React.useTransition();
  // O formulário vive AQUI, não no modal: é o que faz "Voltar e revisar"
  // reabrir tudo preenchido. Fechar de vez (Cancelar/X) volta ao inicial.
  const [dados, setDados] = React.useState<DadosJob>(inicial);
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const podeAprovar = ["rascunho", "em_revisao", "enviada_cliente"].includes(
    versaoStatus,
  );
  const aprovada = versaoStatus === "aprovada";
  const etapa: "rascunho" | "aprovada" | "enviada" = job
    ? "enviada"
    : aprovada
      ? "aprovada"
      : "rascunho";

  // Estados fora do fluxo (reprovada, substituída, cancelada) não têm barra.
  if (!podeAprovar && !aprovada) return null;

  function handleAprovar() {
    setErroGeral(null);
    startTransition(async () => {
      const res = await aprovarVersao(versaoId);
      if (!res.ok) {
        setErroGeral(res.message);
        return;
      }
      setModal(null);
      router.refresh();
    });
  }

  /** Abre o formulário do zero — descarta rascunho e erros anteriores. */
  function abrirFormulario() {
    setDados(inicial);
    setErroGeral(null);
    setFieldErrors({});
    setModal("form");
  }

  /** Fechar de vez (Cancelar / X / Esc) limpa; "Voltar e revisar" não passa por aqui. */
  function fecharFormulario() {
    setModal(null);
    setDados(inicial);
    setErroGeral(null);
    setFieldErrors({});
  }

  function handleEnviar() {
    setErroGeral(null);
    setFieldErrors({});

    // Produto, cidade, regional, GP e produtor não vão no payload: o
    // servidor lê esses valores do projeto e do orçamento.
    const formData = new FormData();
    formData.set("nome", dados.nome);
    formData.set("data_inicio_prevista", dados.dataInicio);
    formData.set("data_fim_prevista", dados.dataFim);
    formData.set("data_prevista_faturamento", dados.dataFaturamento);
    formData.set("observacoes", dados.observacoes);

    startTransition(async () => {
      const res = await enviarJobParaAbertura(versaoId, formData);
      if (!res.ok) {
        setErroGeral(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        // Volta ao formulário pra mostrar o campo destacado.
        setModal("form");
        return;
      }
      setModal(null);
      router.refresh();
    });
  }

  const resumoEnvio = [
    { rotulo: "Job", valor: dados.nome || "—" },
    { rotulo: "Código", valor: proximoCodigoJob, mono: true },
    { rotulo: "Projeto", valor: `${projetoNome} · ${projetoCodigo}` },
    { rotulo: "Cliente", valor: clienteNome },
    { rotulo: "Produto", valor: herdados.produtoNome ?? "— não informado" },
    {
      rotulo: "Cidade · Regional",
      valor: `${herdados.cidadeNome ?? "—"} · ${herdados.regionalNome ?? "—"}`,
    },
    { rotulo: "GP Responsável", valor: herdados.gpNome ?? "— não informado" },
    {
      rotulo: "Produtor Responsável",
      valor: herdados.produtorNome ?? "— não informado",
    },
    {
      rotulo: "Início · fim",
      valor: `${formatarData(dados.dataInicio)} → ${formatarData(dados.dataFim)}`,
      mono: true,
    },
    {
      rotulo: "Faturamento em",
      valor: formatarData(dados.dataFaturamento),
      mono: true,
    },
  ];

  return (
    <>
      {/* Os banners de estado NÃO ficam aqui: no handoff eles vêm logo
          abaixo do cabeçalho, acima dos totais. Ver <BannersEstado>. */}

      {/* Barra de ação — gruda no rodapé da viewport enquanto a página rola. */}
      <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-4 rounded-t-2xl border border-b-0 border-border bg-white/95 px-5 py-2 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {etapa === "rascunho" && (
            <>
              <span className="text-xs text-muted-foreground">
                Aprovando{" "}
                <strong className="text-foreground">{versaoLabel}</strong> ·{" "}
                {qtdGrupos} {qtdGrupos === 1 ? "grupo" : "grupos"} · {qtdItens}{" "}
                {qtdItens === 1 ? "item" : "itens"}
              </span>
              <span className="text-xs text-muted-foreground">
                Valor do Job{" "}
                <span className="font-mono font-semibold text-foreground">
                  {formatCurrency(valorJob, moeda)}
                </span>{" "}
                · alterações salvas automaticamente
              </span>
            </>
          )}
          {etapa === "aprovada" && (
            <>
              <span className="text-xs text-muted-foreground">
                <strong className="text-emerald-700">
                  Versão {versaoLabel} aprovada
                </strong>{" "}
                · valores travados para edição
              </span>
              <span className="text-xs text-muted-foreground">
                Próximo passo: abrir o job para o financeiro
              </span>
            </>
          )}
          {etapa === "enviada" && job && (
            <>
              <span className="text-xs text-muted-foreground">
                Job{" "}
                <span className="font-mono font-semibold text-foreground">
                  {job.codigo}
                </span>{" "}
                enviado para abertura
              </span>
              <span className="text-xs text-muted-foreground">
                {job.data_prevista_faturamento
                  ? `Faturamento previsto para ${formatarData(job.data_prevista_faturamento)}`
                  : "Aguardando abertura pelo financeiro"}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {etapa === "rascunho" && (
            <button
              type="button"
              onClick={() => setModal("aprovar")}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700 hover:shadow-lg transition-all"
            >
              <CheckCircle2 className="h-4 w-4" />
              Aprovar versão
            </button>
          )}
          {etapa === "aprovada" && (
            <button
              type="button"
              onClick={abrirFormulario}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
            >
              Enviar Job para Abertura
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {etapa === "enviada" && (
            <button
              type="button"
              onClick={() => setModal("form")}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-colors"
            >
              <FileText className="h-4 w-4" />
              Ver dados do job
            </button>
          )}
        </div>
      </div>

      {/* Pop-up 1 — confirmar aprovação */}
      <ConfirmDialog
        open={modal === "aprovar"}
        onOpenChange={(o) => !o && setModal(null)}
        title="Tem certeza que quer aprovar esse orçamento?"
        description={
          <>
            A versão <strong className="text-foreground">{versaoLabel}</strong>{" "}
            passa a ser a versão aprovada do orçamento{" "}
            <strong className="text-foreground">{orcamentoCodigo}</strong> e seus
            valores ficam travados. Novas alterações exigem uma nova versão.
            <span className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted-foreground">
                  Custo planejado
                </span>
                <span className="font-mono text-[13px] font-semibold text-foreground">
                  {formatCurrency(custoPlanejado, moeda)}
                </span>
              </span>
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted-foreground">
                  Faturamento previsto
                </span>
                <span className="font-mono text-[13px] font-semibold text-foreground">
                  {formatCurrency(faturamentoPrevisto, moeda)}
                </span>
              </span>
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted-foreground">
                  Valor do Job
                </span>
                <span className="font-mono text-[13px] font-semibold text-foreground">
                  {formatCurrency(valorJob, moeda)}
                </span>
              </span>
            </span>
            {erroGeral && (
              <span className="mt-3 block text-xs text-california-red">
                {erroGeral}
              </span>
            )}
          </>
        }
        confirmLabel="Sim, aprovar versão"
        cancelLabel="Cancelar"
        pending={pending}
        onConfirm={handleAprovar}
      />

      {/* Pop-up 2 — formulário do job */}
      <EnviarJobModal
        open={modal === "form"}
        onOpenChange={(o) => !o && fecharFormulario()}
        onConfirmar={() => setModal("envio")}
        dados={dados}
        onChange={(patch) => setDados((d) => ({ ...d, ...patch }))}
        somenteLeitura={etapa === "enviada"}
        orcamentoCodigo={orcamentoCodigo}
        projetoNome={projetoNome}
        projetoCodigo={projetoCodigo}
        clienteNome={clienteNome}
        codigoJob={job?.codigo ?? proximoCodigoJob}
        versaoLabel={versaoLabel}
        valorTotal={valorJob}
        faturamentoPrevisto={faturamentoPrevisto}
        moeda={moeda}
        herdados={herdados}
        fieldErrors={fieldErrors}
        erroGeral={erroGeral}
      />

      {/* Pop-up 3 — confirmar envio. Voltar NÃO limpa o formulário. */}
      <ConfirmarEnvioModal
        open={modal === "envio"}
        onOpenChange={(o) => !o && setModal("form")}
        onVoltar={() => setModal("form")}
        onConfirmar={handleEnviar}
        pending={pending}
        orcamentoCodigo={orcamentoCodigo}
        linhas={resumoEnvio}
        valorTotal={valorJob}
        faturamentoPrevisto={faturamentoPrevisto}
        moeda={moeda}
        observacoes={dados.observacoes}
        erro={erroGeral}
      />
    </>
  );
}

/**
 * Banners de estado do handoff. Ficam entre o cabeçalho e os totais, por
 * isso vivem fora de <FluxoAbertura> — que precisa ser o último filho da
 * página para o `sticky bottom-0` da barra funcionar.
 *
 * São puramente derivados do servidor: nenhum estado de cliente aqui.
 */
export function BannersEstado({
  versaoLabel,
  aprovada,
  job,
  jobHref,
}: {
  versaoLabel: string;
  aprovada: boolean;
  job: JobExistente | null;
  jobHref: string | null;
}) {
  if (!aprovada && !job) return null;

  return (
    <>
      {aprovada && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Check className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-emerald-900">
              Versão {versaoLabel} aprovada
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">
              Valores travados para edição · novas alterações exigem uma nova versão.
            </p>
          </div>
        </div>
      )}

      {job && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
            <Briefcase className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">
              Job enviado para abertura ·{" "}
              <span className="font-mono">{job.codigo}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Aguardando abertura pelo financeiro
              {job.data_prevista_faturamento
                ? ` · faturamento previsto para ${formatarData(job.data_prevista_faturamento)}`
                : ""}
            </p>
          </div>
          {jobHref && (
            <Link
              href={jobHref}
              prefetch={false}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-[13px] font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-colors"
            >
              Ver job
              <ArrowUpRight className="h-[15px] w-[15px]" />
            </Link>
          )}
        </div>
      )}
    </>
  );
}

function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
