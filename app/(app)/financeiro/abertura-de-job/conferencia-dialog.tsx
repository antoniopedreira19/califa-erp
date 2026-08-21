"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  CornerUpLeft,
  Table2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { ContatosCobrancaCaixa } from "@/components/financeiro/contatos-cobranca";
import type { JobNaFila } from "./dados";
import { formatDataBr, formatPeriodo } from "./formatos";

interface Props {
  job: JobNaFila | null;
  onOpenChange: (open: boolean) => void;
  onReprovar: () => void;
}

/**
 * Conferência: o que a produção mandou, antes de o financeiro assumir o
 * job. Não grava nada — é a leitura que antecede a decisão de abrir ou
 * devolver.
 */
export function ConferenciaDialog({ job, onOpenChange, onReprovar }: Props) {
  const router = useRouter();

  if (!job) return null;

  const dados: { rotulo: string; valor: string; mono?: boolean }[] = [
    { rotulo: "Job", valor: job.nome },
    { rotulo: "Código", valor: job.codigo, mono: true },
    {
      rotulo: "Projeto",
      valor: [job.projeto_nome, job.projeto_codigo].filter(Boolean).join(" · ") || "—",
    },
    { rotulo: "Cliente", valor: job.cliente_nome ?? "—" },
    { rotulo: "Produto", valor: job.produto ?? "—" },
    // Vem do orçamento: é a categoria que a produção deu ao job e a que a
    // tela de abertura pré-seleciona.
    { rotulo: "Categoria", valor: job.categoria_nome ?? "— não informada" },
    {
      rotulo: "Cidade · Regional",
      valor:
        [job.cidade, job.regional_nome].filter(Boolean).join(" · ") || "—",
    },
    { rotulo: "GP Responsável", valor: job.responsavel_nome ?? "—" },
    { rotulo: "Produtor Responsável", valor: job.produtor_nome ?? "—" },
    {
      rotulo: "Início · fim",
      valor: formatPeriodo(job.data_inicio_prevista, job.data_fim_prevista),
      mono: true,
    },
    {
      rotulo: "Faturamento em",
      valor: formatDataBr(job.data_prevista_faturamento),
      mono: true,
    },
  ];

  const resumoPlanilha =
    job.planilha_itens > 0
      ? `${job.planilha_grupos} ${job.planilha_grupos === 1 ? "agrupamento" : "agrupamentos"} · ${job.planilha_itens} ${job.planilha_itens === 1 ? "item" : "itens"} · orçado ${formatCurrency(job.planilha_orcado)}`
      : "Planilha interna sem itens.";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[520px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[19px]">
                Conferir o job antes de abrir
              </DialogTitle>
              <DialogDescription className="pt-1.5 text-[13.5px] leading-relaxed">
                Dados enviados pela produção a partir do orçamento{" "}
                <strong className="font-mono text-foreground">
                  {job.orcamento_codigo ?? "—"}
                </strong>
                . Abra a planilha interna para conferir item por item.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
          {dados.map((d) => (
            <div
              key={d.rotulo}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-[13px] text-muted-foreground">
                {d.rotulo}
              </span>
              <span
                className={
                  d.mono
                    ? "text-right font-mono text-[13px] font-semibold"
                    : "text-right text-[13px] font-semibold"
                }
              >
                {d.valor}
              </span>
            </div>
          ))}
          {/* Os dois números do fechamento, como no modal do envio do job:
              o que a California emite nota e o compromisso total do
              cliente. */}
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
            <span className="text-[13px] font-semibold">
              Faturamento previsto
            </span>
            <span className="font-mono text-[14px] font-bold text-california-red">
              {formatCurrency(job.faturamento_previsto)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold">Valor total</span>
            <span className="font-mono text-base font-bold">
              {formatCurrency(job.valor_total)}
            </span>
          </div>
        </div>

        {/* Planilha DENTRO do financeiro: a rota
            `/financeiro/abertura-de-job/[jobId]/planilha` mostra a mesma
            planilha em leitura, sem tirar quem confere do módulo
            (decisão do Tiago, 20/08/2026). */}
        <Link
          href={`/financeiro/abertura-de-job/${job.id}/planilha`}
          prefetch={false}
          className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-4 py-3 text-left transition-colors hover:border-california-red/50 hover:bg-california-red/5"
        >
          <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-border bg-white text-california-red">
            <Table2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">
              Visualizar planilha interna
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              {resumoPlanilha}
            </p>
          </div>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>

        <div className="space-y-1.5">
          {/* Mesmo dado que a produção digita no modal de envio: coluna
              `jobs.observacoes`, rotulada "Descritivo do Job" nas duas
              pontas desde 17/08/2026. */}
          <p className="text-[12.5px] font-semibold">Descritivo do Job</p>
          <div className="rounded-lg border border-border bg-muted px-3.5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {job.observacoes?.trim() || "Sem descritivo do job."}
          </div>
        </div>

        {/* Mesma natureza do Descritivo — o que a produção informou no
            envio — e por isso a mesma caixa. Aqui é o único momento em
            que dá para devolver o job por contato faltando ou e-mail
            torto, ANTES de assumi-lo (docs/decisions/012). */}
        <ContatosCobrancaCaixa contatos={job.contatos} />

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onReprovar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-california-red transition-colors hover:border-california-red hover:bg-california-red/5"
          >
            <CornerUpLeft className="h-4 w-4" />
            Reprovar
          </button>
          <button
            type="button"
            onClick={() => router.push(`/financeiro/abertura-de-job/${job.id}`)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-[18px] py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red-hover"
          >
            <Check className="h-4 w-4" />
            Preencher Abertura
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
