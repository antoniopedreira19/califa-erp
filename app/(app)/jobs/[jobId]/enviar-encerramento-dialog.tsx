"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Lock, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import {
  situacaoVerbaLabel,
  type CategoriaModeloPlanilha,
  type ItemBv,
  type ItemPlanilhaJob,
  type JobItemRealizado,
  type SituacaoVerba,
} from "@/lib/types";
import type { ParametrosInternacionais } from "@/lib/calculos/versao-totais";
import type { MoedaEstrangeira } from "@/app/(app)/_planilha/moeda-estrangeira";
import { JobTotaisCard } from "./realizado/job-totais-card";
import { encerrarJob } from "./actions-encerramento";
import { listaPtBr } from "./envio-faturamento-ui";

/**
 * O fechamento do job, calculado no servidor pela página (decisão 087).
 *
 * O que trava o envio para encerramento é só o que é da produção: PP em
 * aberto, verba não concluída, BV não recebido e item sem marcação. O
 * faturamento aparece como aviso — o job encerrado continua na fila.
 */
export interface FechamentoDoJob {
  /** PPs sem baixa e rejeitadas (decisão 083) — travam. */
  ppsEmAberto: { codigo: string; status: string }[];
  /** Verbas de produção pagas que ainda não fecharam (decisão 081 §7). */
  verbasEmAberto: { codigo: string; situacao: Exclude<SituacaoVerba, "concluida"> }[];
  bvsEmAberto: { item: string; situacao: string }[];
  /** Itens de custo que ainda não disseram se sai mais PP (decisão 052). */
  itensSemMarcacao: { item: string }[];
  /** Quanto do envio ainda não virou nota emitida. Não trava. */
  saldoAFaturar: number;
  /** Job normal ainda não enviado para faturamento. Não trava. */
  semEnvio: boolean;
  /** Mensal: os meses ainda por enviar, pelo nome. Não travam. */
  mesesSemEnvio: string[];
  /** Todo o faturamento já saiu em nota — o job fica finalizado ao encerrar. */
  faturamentoCompleto: boolean;
  encerradoEm: string | null;
  encerradoPorNome: string | null;
  finalizadoEm: string | null;
}

/** O que o card de Totais do fechamento precisa — os mesmos dados da
 *  Planilha Interna, sem consulta nova. */
export interface TotaisDoFechamento {
  itens: ItemPlanilhaJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  bvsPorItem: Record<string, ItemBv[]>;
  jobAberto: boolean;
  percentualHonorarios: number;
  percentualImposto: number;
  moeda: string;
  modeloPlanilha: CategoriaModeloPlanilha;
  internacional: ParametrosInternacionais | null;
  moedaEstrangeira: MoedaEstrangeira | null;
}

export function pendenciasDoFechamento(f: FechamentoDoJob): number {
  return (
    f.ppsEmAberto.length +
    f.verbasEmAberto.length +
    f.bvsEmAberto.length +
    f.itensSemMarcacao.length
  );
}

/** "novembro e dezembro" → "Novembro e dezembro": só a frase abre com
 *  maiúscula; o nome do mês, no meio dela, fica minúsculo. */
function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function dataBrDeInstante(instante: string | null): string {
  return instante ? new Date(instante).toLocaleDateString("pt-BR") : "—";
}

interface Props {
  jobId: string;
  jobCodigo: string;
  /** `enviar`: o envio para encerramento. `ver`: o fechamento de um job já
   *  encerrado ou finalizado, só leitura. */
  modo: "enviar" | "ver";
  fechamento: FechamentoDoJob;
  totais: TotaisDoFechamento;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Envio para encerramento — e o "Ver envio" dele (decisão 087, 16/09/2026).
 *
 * O resumo de fechamento de antes (faturamento, custos, honorários,
 * impostos, custo realizado e margem num diálogo de 540 px) deu lugar ao
 * card de Totais do fim da Planilha Interna, com o Resultado travado no
 * realizado, que no encerramento já está completo. O card se adapta sozinho
 * ao internacional (cadeia) e ao save (colunas abertas por padrão e "Save
 * gerado" no fim).
 *
 * Moldura do "Enviar job para abertura" (`enviar-job-modal.tsx`):
 * `sm:max-w-5xl`, cabeçalho e rodapé fixos, só o miolo rola.
 *
 * ⚠️ Mudança de número: o resumo antigo não somava o BV na margem. O card
 * soma — no JOB-0033 a margem ia de R$ 95.950,00 para R$ 100.450,00.
 *
 * A trava é refeita no servidor — esta é a explicação, não a regra.
 */
export function EnviarEncerramentoDialog({
  jobId,
  jobCodigo,
  modo,
  fechamento,
  totais,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const {
    ppsEmAberto,
    verbasEmAberto,
    bvsEmAberto,
    itensSemMarcacao,
    saldoAFaturar,
    semEnvio,
    mesesSemEnvio,
    faturamentoCompleto,
  } = fechamento;
  const travado = modo === "enviar" && pendenciasDoFechamento(fechamento) > 0;
  const mensal = totais.modeloPlanilha === "mensal";

  function handleEnviar() {
    setErro(null);
    startTransition(async () => {
      const res = await encerrarJob(jobId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  // O que falta faturar, dito uma vez só. Não trava — o job encerrado
  // segue na fila de faturamento.
  const faltaFaturar: string | null = faturamentoCompleto
    ? null
    : mensal
      ? mesesSemEnvio.length > 0
        ? `${maiuscula(listaPtBr(mesesSemEnvio))} ${
            mesesSemEnvio.length === 1 ? "ainda não foi enviado" : "ainda não foram enviados"
          } para faturamento${saldoAFaturar > 0 ? `, e ${formatCurrency(saldoAFaturar, totais.moeda)} já enviados ainda não viraram nota` : ""}. O envio dos meses continua disponível depois do encerramento, e o job segue na fila até a última nota.`
        : `${formatCurrency(saldoAFaturar, totais.moeda)} ainda não viraram nota. O job continua na fila do financeiro depois de encerrado.`
      : semEnvio
        ? "O job ainda não foi enviado para faturamento. O envio continua disponível depois do encerramento, e o job entra na fila do financeiro normalmente."
        : `${formatCurrency(saldoAFaturar, totais.moeda)} ainda não viraram nota. O job continua na fila do financeiro depois de encerrado.`;

  const titulo =
    modo === "enviar"
      ? `Enviar ${jobCodigo} para encerramento`
      : `Envio para encerramento · ${jobCodigo}`;
  const descricao =
    modo === "enviar"
      ? "Confira o fechamento antes de enviar. Depois do envio o job vira histórico: nada mais é editado, nenhuma PP é gerada e nenhum BV é lançado."
      : `Enviado para encerramento em ${dataBrDeInstante(fechamento.encerradoEm)}${
          fechamento.encerradoPorNome ? ` por ${fechamento.encerradoPorNome}` : ""
        }. O job é histórico: estes números não mudam mais.`;

  const rodape =
    modo === "enviar"
      ? mensal
        ? "O resultado usa o custo realizado dos meses: todas as PPs pagas e todos os BVs recebidos."
        : "O resultado usa o custo realizado: todas as PPs pagas e todos os BVs recebidos."
      : fechamento.finalizadoEm
        ? `Finalizado em ${dataBrDeInstante(fechamento.finalizadoEm)}: faturado e encerrado.`
        : faturamentoCompleto
          ? "Faturamento concluído."
          : "O faturamento deste job ainda está em andamento na fila do financeiro.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[97vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 flex-row items-start gap-4 border-b border-border px-6 py-5 pr-14">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <Lock className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-xl">{titulo}</DialogTitle>
            <DialogDescription>{descricao}</DialogDescription>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {travado && (
            <div className="flex gap-3 rounded-xl border border-california-red/25 bg-california-red/5 px-4 py-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
              <div className="min-w-0 space-y-1.5 text-[12.5px] leading-relaxed">
                <p className="font-semibold text-california-red">
                  Este job ainda não pode ser enviado para encerramento.
                </p>
                {ppsEmAberto.length > 0 && (
                  <p className="text-muted-foreground">
                    {ppsEmAberto.length === 1
                      ? "1 PP em aberto"
                      : `${ppsEmAberto.length} PPs em aberto`}
                    : {ppsEmAberto.map((p) => p.codigo).join(", ")}.
                  </p>
                )}
                {bvsEmAberto.length > 0 && (
                  <p className="text-muted-foreground">
                    {bvsEmAberto.length === 1
                      ? "1 BV ainda não recebido"
                      : `${bvsEmAberto.length} BVs ainda não recebidos`}
                    : {bvsEmAberto.map((b) => b.item).join(", ")}.
                  </p>
                )}
                {verbasEmAberto.length > 0 && (
                  <p className="text-muted-foreground">
                    {verbasEmAberto.length === 1
                      ? "1 verba de produção ainda não concluída"
                      : `${verbasEmAberto.length} verbas de produção ainda não concluídas`}
                    :{" "}
                    {verbasEmAberto
                      .map((v) => `${v.codigo} (${situacaoVerbaLabel(v.situacao).toLowerCase()})`)
                      .join(", ")}
                    .
                  </p>
                )}
                {itensSemMarcacao.length > 0 && (
                  <p className="text-muted-foreground">
                    {itensSemMarcacao.length === 1
                      ? "1 item de custo ainda não disse se sai mais PP"
                      : `${itensSemMarcacao.length} itens de custo ainda não disseram se sai mais PP`}
                    : {itensSemMarcacao.map((i) => i.item).join(", ")}.
                  </p>
                )}
                {(ppsEmAberto.length > 0 || bvsEmAberto.length > 0) && (
                  <p className="text-muted-foreground">
                    Resolva esses documentos — a PP rejeitada volta para a
                    produção corrigir ou cancelar, a aprovada espera a baixa, e o
                    BV espera o recebimento.
                  </p>
                )}
                {verbasEmAberto.length > 0 && (
                  <p className="text-muted-foreground">
                    A produção presta contas da verba na aba de PPs; o financeiro
                    aprova e dá baixa no estorno do que não foi gasto.
                  </p>
                )}
                {itensSemMarcacao.length > 0 && (
                  <p className="text-muted-foreground">
                    No painel de cada item, na Planilha Interna, marque que todas
                    as PPs dele já foram geradas — vale também para o item que
                    não vai gerar PP nenhuma.
                  </p>
                )}
              </div>
            </div>
          )}

          {modo === "enviar" && faltaFaturar && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="min-w-0 space-y-1.5 text-[12.5px] leading-relaxed">
                <p className="font-semibold text-amber-700">
                  Falta faturar — mas isso não trava o encerramento.
                </p>
                <p className="text-muted-foreground">{faltaFaturar}</p>
              </div>
            </div>
          )}

          <JobTotaisCard
            itens={totais.itens}
            realizadosMap={totais.realizadosMap}
            bvsPorItem={totais.bvsPorItem}
            jobAberto={totais.jobAberto}
            percentualHonorarios={totais.percentualHonorarios}
            percentualImposto={totais.percentualImposto}
            moeda={totais.moeda}
            modeloPlanilha={totais.modeloPlanilha}
            internacional={totais.internacional}
            moedaEstrangeira={totais.moedaEstrangeira}
            titulo={mensal ? "Totais do trimestre" : "Totais"}
            subtitulo={
              mensal
                ? "Orçado × Planejado × Realizado · soma dos meses."
                : "Orçado × Planejado × Realizado · valores calculados a partir dos itens."
            }
            somenteRealizada
            colunasSaveAbertas
          />

          {erro && (
            <p className="rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-[13px] text-california-red">
              {erro}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/30 px-6 py-3">
          <span className="text-xs text-muted-foreground">{rodape}</span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              {modo === "enviar" ? "Cancelar" : "Fechar"}
            </button>
            {modo === "enviar" && (
              <button
                type="button"
                onClick={handleEnviar}
                disabled={travado || pending}
                title={travado ? "Resolva as pendências acima antes de enviar" : undefined}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-california-red-hover hover:shadow-brand disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
              >
                <Send className="h-4 w-4" />
                {pending ? "Enviando..." : "Enviar para encerramento"}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
