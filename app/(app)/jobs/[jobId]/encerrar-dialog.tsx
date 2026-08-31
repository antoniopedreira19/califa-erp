"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Lock, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { calcularResultadoOperacional } from "@/lib/calculos/versao-totais";
import { encerrarJob } from "./actions-encerramento";

/** Números do fechamento, calculados no servidor pela página do job. */
export interface ResumoEncerramento {
  /** Faturamento previsto congelado na abertura do job. */
  faturamentoAbertura: number | null;
  /** Faturamento previsto agora — vira só "Faturamento" no encerramento. */
  faturamentoFechamento: number;
  /** Valor que a produção mandou faturar. */
  valorEnviado: number;
  orcado: number;
  honorarios: number;
  imposto: number;
  percentualHonorarios: number;
  percentualImposto: number;
  valorJob: number;
  custoRealizado: number;
  /** Quanto do orçado deste job foi pago com crédito de outro job. Zero
   *  na maioria; quando cobre o job inteiro, é o que explica um
   *  faturamento zerado (decisão 028). */
  saveConsumido?: number;
  moeda: string;
  /** PPs sem baixa e BVs não recebidos — travam o encerramento. */
  ppsEmAberto: { codigo: string; status: string }[];
  bvsEmAberto: { item: string; situacao: string }[];
  /** Quanto do envio ainda não virou nota emitida — também trava. */
  saldoAFaturar: number;
}

interface Props {
  jobId: string;
  resumo: ResumoEncerramento;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function taxa(p: number): string {
  return `${String(p).replace(".", ",")}%`;
}

function percentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

function Linha({
  rotulo,
  valor,
  destaque,
  vermelho,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
  vermelho?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={
          destaque
            ? "text-[13px] font-semibold"
            : "text-[13px] text-muted-foreground"
        }
      >
        {rotulo}
      </span>
      <span
        className={[
          "whitespace-nowrap text-right font-mono",
          destaque ? "text-[15px] font-bold" : "text-[13px] font-semibold",
          vermelho ? "text-california-red" : "",
        ].join(" ")}
      >
        {valor}
      </span>
    </div>
  );
}

/**
 * Resumo de fechamento — a última tela antes de o job virar histórico.
 *
 * Mostra o que a abertura previu, o que está sendo faturado, de onde esse
 * número sai (custos, honorários, impostos), quanto custou de fato e a
 * margem que sobrou, em reais e em percentual.
 *
 * O encerramento é travado enquanto houver PP sem baixa ou BV não
 * recebido: o custo realizado ainda pode mudar, e a margem daqui seria
 * mentira. Também trava com saldo a faturar: o job encerrado sai da fila
 * de faturamento e não tem como voltar (31/08/2026). A trava é refeita no
 * servidor — esta é a explicação, não a regra.
 */
export function EncerrarDialog({ jobId, resumo, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const {
    moeda,
    ppsEmAberto,
    bvsEmAberto,
    saldoAFaturar,
    faturamentoAbertura,
    faturamentoFechamento,
    valorEnviado,
  } = resumo;

  const travado =
    ppsEmAberto.length > 0 || bvsEmAberto.length > 0 || saldoAFaturar > 0;

  const { resultadoOperacional: margem, resultadoGeral: margemPct } =
    calcularResultadoOperacional(
      resumo.valorJob,
      resumo.imposto,
      resumo.custoRealizado,
    );

  // O envio para faturamento congelou um valor. Se uma errata mexeu no job
  // depois disso, o fechamento não bate com o que foi mandado faturar — e
  // isso precisa aparecer, não ser escondido atrás do número novo.
  const divergeDoEnvio = Math.abs(valorEnviado - faturamentoFechamento) >= 0.01;

  function handleEncerrar() {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[540px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
              <Lock className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[19px]">
                Resumo de fechamento
              </DialogTitle>
              <DialogDescription className="pt-1.5 text-[13.5px] leading-relaxed">
                Confira antes de encerrar. Depois do encerramento o job vira
                histórico: nada mais é editado, nenhuma PP é gerada e nenhum BV
                é lançado.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {travado && (
          <div className="flex gap-3 rounded-xl border border-california-red/25 bg-california-red/5 px-4 py-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
            <div className="min-w-0 space-y-1.5 text-[12.5px] leading-relaxed">
              <p className="font-semibold text-california-red">
                Este job ainda não pode ser encerrado.
              </p>
              {ppsEmAberto.length > 0 && (
                <p className="text-muted-foreground">
                  {ppsEmAberto.length === 1
                    ? "1 PP sem baixa"
                    : `${ppsEmAberto.length} PPs sem baixa`}
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
              {saldoAFaturar > 0 && (
                <p className="text-muted-foreground">
                  <strong className="font-mono text-california-red">
                    {formatCurrency(saldoAFaturar, moeda)}
                  </strong>{" "}
                  ainda não viraram nota. Encerrar agora tiraria o job da fila
                  de faturamento sem caminho de volta.
                </p>
              )}
              {(ppsEmAberto.length > 0 || bvsEmAberto.length > 0) && (
                <p className="text-muted-foreground">
                  Dê baixa nesses documentos — pagamento da PP, recebimento do
                  BV — e volte aqui.
                </p>
              )}
              {saldoAFaturar > 0 && (
                <p className="text-muted-foreground">
                  Peça ao financeiro a emissão da nota do saldo antes de
                  encerrar.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
          <Linha
            rotulo="Faturamento previsto na abertura"
            valor={
              faturamentoAbertura === null
                ? "—"
                : formatCurrency(faturamentoAbertura, moeda)
            }
          />
          <Linha
            rotulo="Faturamento"
            valor={formatCurrency(faturamentoFechamento, moeda)}
            destaque
            vermelho
          />
          {divergeDoEnvio && (
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              A produção enviou{" "}
              <strong className="font-mono text-foreground">
                {formatCurrency(valorEnviado, moeda)}
              </strong>{" "}
              para faturamento. O job mudou depois do envio — confirme com o
              financeiro qual valor foi para a nota.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
          <p className="mb-0.5 text-[12.5px] font-bold uppercase tracking-wider">
            De onde vem esse número
          </p>
          <Linha
            rotulo="Total dos custos orçados"
            valor={formatCurrency(resumo.orcado, moeda)}
          />
          <Linha
            rotulo={`Honorários (${taxa(resumo.percentualHonorarios)})`}
            valor={formatCurrency(resumo.honorarios, moeda)}
          />
          <Linha
            rotulo={`Encargos e impostos (${taxa(resumo.percentualImposto)})`}
            valor={formatCurrency(resumo.imposto, moeda)}
          />
          {(resumo.saveConsumido ?? 0) > 0.005 && (
            <Linha
              rotulo="Pago com saldo em save de outro job"
              valor={formatCurrency(resumo.saveConsumido ?? 0, moeda)}
            />
          )}
          <div className="mt-1 border-t border-border pt-2.5">
            <Linha
              rotulo="Valor do Job"
              valor={formatCurrency(resumo.valorJob, moeda)}
              destaque
            />
          </div>
          {(resumo.saveConsumido ?? 0) > 0.005 &&
            faturamentoFechamento <= 0.004 && (
              <p className="pt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                O faturamento deste job é zero porque ele foi pago
                inteiramente com crédito de outro job — a nota já saiu lá.
                Por isso ele pulou a etapa de faturamento.
              </p>
            )}
        </div>

        <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
          <Linha
            rotulo="Custo realizado"
            valor={formatCurrency(resumo.custoRealizado, moeda)}
          />
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">Margem</p>
              <p className="text-[11px] text-muted-foreground">
                Valor do Job − impostos − custo realizado
              </p>
            </div>
            <div className="text-right">
              <p className="whitespace-nowrap font-mono text-[15px] font-bold">
                {margem === null ? "—" : formatCurrency(margem, moeda)}
              </p>
              <p className="whitespace-nowrap font-mono text-[12.5px] font-semibold text-muted-foreground">
                {margemPct === null ? "—" : percentual(margemPct)}
              </p>
            </div>
          </div>
          {margem === null && (
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Sem custo realizado lançado não há margem para calcular — a conta
              apareceria como se a receita inteira fosse lucro.
            </p>
          )}
        </div>

        {erro && (
          <p className="rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-[13px] text-california-red">
            {erro}
          </p>
        )}

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-4 py-2.5 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleEncerrar}
            disabled={travado || pending}
            title={
              travado
                ? saldoAFaturar > 0 &&
                  ppsEmAberto.length === 0 &&
                  bvsEmAberto.length === 0
                  ? "Falta emitir a nota do saldo antes de encerrar"
                  : saldoAFaturar > 0
                    ? "Resolva as pendências acima antes de encerrar"
                    : "Dê baixa nas PPs e nos BVs em aberto antes de encerrar"
                : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-[18px] py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {pending ? "Encerrando..." : "Encerrar job"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
