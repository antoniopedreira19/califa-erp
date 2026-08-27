import Link from "next/link";
import type { JobStatus } from "@/lib/types";
import { jobEstaCongelado, jobStatusLabel } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { StatusActions } from "./status-actions";
import { EnviarFaturamentoDrawer, type PortalOption } from "./enviar-faturamento-drawer";
import type { ResumoEncerramento } from "./encerrar-dialog";

function formatData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export interface EnvioFaturamento {
  enviado_em: string;
  valor_faturado: number | string;
  data_faturamento: string;
}

interface Props {
  jobId: string;
  jobCodigo: string;
  status: JobStatus;
  transicoes: JobStatus[];
  envioFaturamento: EnvioFaturamento | null;
  podeEnviarFaturamento: boolean;
  faturamentoPrevisto: number;
  /** Quanto do faturamento previsto é saldo em save. */
  faturamentoSavePrevisto?: number;
  /** Job pago inteiramente com crédito de outro job: pula a etapa de
   *  faturamento e já pode encerrar (decisão 028 §11). */
  pagoSoPorSave?: boolean;
  dataPrevistaFaturamento: string | null;
  portais: PortalOption[];
  moeda: string;
  resumoEncerramento: ResumoEncerramento | null;
}

/**
 * Barra fixa de ações do job — handoff "Job · Informações — Barra de ações"
 * (19/08/2026), no mesmo padrão da barra de aprovação do orçamento
 * (`fluxo-abertura.tsx`).
 *
 * Substitui o card "Status", que vivia no corpo da aba Informações. As
 * frases que moravam nele viraram o texto à esquerda: a barra sempre diz em
 * que ponto do fluxo o job está, mesmo quando não há nenhum botão (job
 * encerrado). Fica FORA das abas de propósito — as ações são do job, não da
 * aba, e o desenho as mantém à mão em todas elas.
 *
 * "Cancelar job" só existe antes de o financeiro abrir o job. Depois disso
 * o cancelamento, se necessário, é ação do financeiro — não do módulo de
 * Jobs. A `atualizarStatusJob` continua aceitando o cancelamento; o que
 * muda é a superfície que o oferece.
 */
export function BarraAcoesJob({
  jobId,
  jobCodigo,
  status,
  transicoes,
  envioFaturamento,
  podeEnviarFaturamento,
  faturamentoPrevisto,
  faturamentoSavePrevisto = 0,
  pagoSoPorSave = false,
  dataPrevistaFaturamento,
  portais,
  moeda,
  resumoEncerramento,
}: Props) {
  const aindaNaoAberto =
    status === "aguardando_abertura" || status === "rejeitado_financeiro";
  const transicoesVisiveis = aindaNaoAberto ? transicoes : [];
  const mostrarEncerramento =
    status === "aberto" && (envioFaturamento !== null || pagoSoPorSave);

  const linhas = montarLinhas({
    status,
    envioFaturamento,
    faturamentoPrevisto,
    moeda,
    mostrarEncerramento,
    pagoSoPorSave,
  });

  return (
    <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-4 rounded-t-2xl border border-b-0 border-border bg-white/95 px-5 py-2 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {linhas.map((linha, i) => (
          <span key={i} className="text-xs text-muted-foreground">
            {linha}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {podeEnviarFaturamento && (
          <EnviarFaturamentoDrawer
            jobId={jobId}
            jobCodigo={jobCodigo}
            valorFaturado={faturamentoPrevisto}
            valorSave={faturamentoSavePrevisto}
            dataPrevistaFaturamento={dataPrevistaFaturamento}
            portais={portais}
            moeda={moeda}
          />
        )}
        {(transicoesVisiveis.length > 0 || mostrarEncerramento) && (
          <StatusActions
            jobId={jobId}
            transicoes={transicoesVisiveis}
            mostrarEncerramento={mostrarEncerramento}
            resumoEncerramento={resumoEncerramento}
          />
        )}
      </div>
    </div>
  );
}

function montarLinhas({
  status,
  envioFaturamento,
  faturamentoPrevisto,
  moeda,
  mostrarEncerramento,
  pagoSoPorSave,
}: {
  status: JobStatus;
  envioFaturamento: EnvioFaturamento | null;
  faturamentoPrevisto: number;
  moeda: string;
  mostrarEncerramento: boolean;
  pagoSoPorSave: boolean;
}): React.ReactNode[] {
  if (status === "aguardando_abertura") {
    return [
      "Aguardando abertura pelo financeiro.",
      <>
        A conferência e a abertura acontecem na Central Financeira, em{" "}
        <Link
          href="/financeiro/abertura-de-job"
          prefetch={false}
          className="font-medium text-california-red hover:underline"
        >
          Abertura de Job
        </Link>
        .
      </>,
    ];
  }

  if (status === "rejeitado_financeiro") {
    return [
      "Job rejeitado pelo financeiro.",
      "Corrija o que foi apontado acima e reenvie para abertura.",
    ];
  }

  const registro = envioFaturamento ? (
    <>
      Enviado para faturamento em{" "}
      <strong className="font-mono font-semibold text-foreground">
        {formatData(envioFaturamento.enviado_em)}
      </strong>{" "}
      no valor de{" "}
      <strong className="font-semibold text-foreground">
        {formatCurrency(Number(envioFaturamento.valor_faturado), moeda)}
      </strong>
      , com vencimento em{" "}
      <strong className="font-mono font-semibold text-foreground">
        {formatData(envioFaturamento.data_faturamento)}
      </strong>
      .
    </>
  ) : null;

  if (jobEstaCongelado(status)) {
    const linhas: React.ReactNode[] = [
      `Job ${jobStatusLabel(status).toLowerCase()} — é histórico. Não aceita edição, PP nem BV.`,
    ];
    if (registro) linhas.push(registro);
    return linhas;
  }

  if (registro) {
    return [
      registro,
      mostrarEncerramento
        ? "Próximo passo: encerrar o job e travar o resultado."
        : "O encerramento acontece pelo resumo de fechamento.",
    ];
  }

  if (pagoSoPorSave) {
    return [
      <>
        Job {jobStatusLabel(status).toLowerCase()} · pago por saldo em save,
        sem nota a emitir
      </>,
      "O cliente já pagou este job na nota do job que gerou o crédito. Não há faturamento a enviar — o encerramento já está disponível.",
    ];
  }

  return [
    <>
      Job {jobStatusLabel(status).toLowerCase()} · faturamento previsto{" "}
      <strong className="font-mono font-semibold text-foreground">
        {formatCurrency(faturamentoPrevisto, moeda)}
      </strong>
    </>,
    "Enviar para faturamento libera o financeiro a emitir a nota. O encerramento fica disponível depois disso.",
  ];
}
