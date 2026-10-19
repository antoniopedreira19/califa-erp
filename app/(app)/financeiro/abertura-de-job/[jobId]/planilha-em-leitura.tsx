"use client";

/**
 * O pop-up com a Planilha Interna de um job, em leitura (revisão da decisão
 * 155, 19/10/2026). Serve aos três atalhos da abertura: a planilha do
 * próprio job, a do job de origem de um consumo e a de cada job que consome
 * o crédito deste. A planilha só é lida quando o pop-up abre
 * (`lerPlanilhaEmLeitura`), e abre com o Resultado dos Totais em
 * "Planejada" (Tiago, 08/10/2026).
 */

import * as React from "react";
import { Loader2, Table2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { JobRealizadoSection } from "@/app/(app)/jobs/[jobId]/realizado/job-realizado-section";
import {
  lerPlanilhaEmLeitura,
  type PlanilhaEmLeitura as PropsDaPlanilha,
} from "../planilha-em-leitura-actions";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "pronta"; props: PropsDaPlanilha }
  | { tipo: "erro"; message: string };

/** A planilha, lida ao montar — o `DialogContent` só monta aberto. */
function PlanilhaCarregada({
  jobId,
  codigo,
  destacarItens,
}: {
  jobId: string;
  codigo: string;
  destacarItens: string[];
}) {
  const [estado, setEstado] = React.useState<Estado>({ tipo: "carregando" });

  React.useEffect(() => {
    let vivo = true;
    lerPlanilhaEmLeitura(jobId)
      .then((r) => {
        if (!vivo) return;
        setEstado(r.ok ? { tipo: "pronta", props: r.props } : { tipo: "erro", message: r.message });
      })
      .catch(() => {
        if (vivo) setEstado({ tipo: "erro", message: "Não foi possível carregar a planilha. Tente de novo." });
      });
    return () => {
      vivo = false;
    };
  }, [jobId]);

  if (estado.tipo === "carregando") {
    return (
      <div className="flex items-center gap-2 px-1 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando a planilha do {codigo}…
      </div>
    );
  }
  if (estado.tipo === "erro") {
    return <p className="px-1 py-10 text-sm text-muted-foreground">{estado.message}</p>;
  }
  return (
    <JobRealizadoSection
      {...estado.props}
      destacarItens={destacarItens}
      resultadoInicial="planejada"
    />
  );
}

/** O pop-up: título "Planilha interna do {código}", uma linha de apoio e a
 *  planilha. Controlado por quem abre (atalho ou botão de ícone). */
export function PopUpDaPlanilha({
  aberto,
  onOpenChange,
  jobId,
  codigo,
  descricao,
  destacarItens = SEM_DESTAQUE,
}: {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  jobId: string;
  codigo: string;
  /** A linha de apoio, abaixo do título. */
  descricao: string;
  /** Linhas em destaque (`jobs_itens_orcado.id`) — a do pedido de save em
   *  aprovação, na planilha do próprio job. */
  destacarItens?: string[];
}) {
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-48px)] max-w-[1660px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[19px]">Planilha interna do {codigo}</DialogTitle>
          <DialogDescription className="text-[13px]">{descricao}</DialogDescription>
        </DialogHeader>
        {aberto && (
          <PlanilhaCarregada jobId={jobId} codigo={codigo} destacarItens={destacarItens} />
        )}
      </DialogContent>
    </Dialog>
  );
}

const SEM_DESTAQUE: string[] = [];

/** O botão de ícone, com dica, que abre a planilha de OUTRO job — a ponta
 *  das linhas do bloco "Saves deste job". */
export function BotaoDaPlanilha({
  jobId,
  codigo,
  descricao,
}: {
  jobId: string;
  codigo: string;
  descricao: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setAberto(true)}
            aria-label={`Visualizar planilha do ${codigo}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-california-red transition-colors hover:border-california-red/50 hover:bg-california-red/5"
          >
            <Table2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Visualizar planilha do {codigo}</TooltipContent>
      </Tooltip>
      <PopUpDaPlanilha
        aberto={aberto}
        onOpenChange={setAberto}
        jobId={jobId}
        codigo={codigo}
        descricao={descricao}
      />
    </>
  );
}
