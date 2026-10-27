"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RhFeriasFluxoRow, ColunaFluxoFerias, TipoContratacao } from "@/lib/types";
import { formatarTipoContratacao } from "@/lib/colaboradores/format-tipo-contratacao";
import { enviarFolhasFerias } from "./actions-pagamentos";
import { ModalAnexarRecibo } from "./modal-anexar-recibo";

// ---------------------------------------------------------------------------
// Tipos locais (não compartilhados globalmente — usados só pelo modal)
// ---------------------------------------------------------------------------

export type FolhaDoc = {
  id: string;
  origem: "california" | "contabilidade";
  tipo_folha_ferias: "usufruto" | "abono" | null;
  salario_base: number;
  status: "rascunho" | "enviada" | "aprovada" | "pendente_correcao" | "paga";
  anexo_url: string | null;
  nf_anexada: boolean;
};

export type PagamentoFerias = {
  id: string;
  colaborador_id: string;
  colaborador_nome: string;
  tipo_contratacao: TipoContratacao;
  salario_base: number;
  status: "rascunho" | "enviada" | "aprovada" | "pendente_correcao" | "paga";
  origem: "california" | "contabilidade";
  tipo_folha_ferias: "usufruto" | "abono" | null;
  data_pagamento_prevista: string | null;
  data_pagamento: string | null;
  anexo_url: string | null;
  lancamento_ferias_id: string | null;
  lancamento_data_inicio: string | null;
  lancamento_data_fim: string | null;
  lancamento_dias: number | null;
  enviada_em: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function fmtMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function labelTipoLancamento(tipo: RhFeriasFluxoRow["tipo_lancamento"]): string {
  switch (tipo) {
    case "usufruto":
      return "Férias";
    case "abono_combinado":
      return "Abono combinado";
    case "abono_avulso":
      return "Só venda";
    case "abono_excepcional":
      return "Abono excepcional";
  }
}

function labelSlot(folha: FolhaDoc): string {
  const isClT = folha.origem === "contabilidade";
  const tipoLabel =
    folha.tipo_folha_ferias === "abono" ? "Abono" : "Férias";
  if (isClT) {
    return folha.tipo_folha_ferias === "abono"
      ? "Abono / CLT · Recibo abono California"
      : "Férias / CLT · Recibo contabilidade";
  }
  return `${tipoLabel} / PJ · NF`;
}

function folhaEstaCompleta(folha: FolhaDoc): boolean {
  if (folha.origem === "contabilidade") {
    return folha.anexo_url !== null;
  }
  // PJ (california)
  return folha.nf_anexada;
}

// ---------------------------------------------------------------------------
// Slot individual
// ---------------------------------------------------------------------------

function SlotFolha({
  folha,
  readonly,
  row,
  onAnexarSucesso,
}: {
  folha: FolhaDoc;
  readonly: boolean;
  row: RhFeriasFluxoRow;
  onAnexarSucesso: () => void;
}) {
  const [abrirAnexar, setAbrirAnexar] = React.useState(false);
  const completa = folhaEstaCompleta(folha);

  // Constrói um PagamentoFerias mínimo pro ModalAnexarRecibo
  const folhaAdaptada: PagamentoFerias = {
    id: folha.id,
    colaborador_id: row.colaborador_id,
    colaborador_nome: row.colaborador_nome,
    tipo_contratacao: row.tipo_contratacao,
    salario_base: folha.salario_base,
    status: folha.status,
    origem: folha.origem,
    tipo_folha_ferias: folha.tipo_folha_ferias,
    data_pagamento_prevista: row.vencimento_mais_proximo,
    data_pagamento: null,
    anexo_url: folha.anexo_url,
    lancamento_ferias_id: row.lancamento_id,
    lancamento_data_inicio: row.data_inicio,
    lancamento_data_fim: row.data_fim,
    lancamento_dias: row.dias,
    enviada_em: null,
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-gray-50 p-3">
      {/* Esquerda: ícone + label + valor */}
      <div className="flex items-start gap-2 min-w-0">
        <FileText className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground leading-tight">
            {labelSlot(folha)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtMoeda(folha.salario_base)}
          </p>
        </div>
      </div>

      {/* Direita: status + ação */}
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        {folha.origem === "california" ? (
          /* PJ */
          folha.nf_anexada ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              NF anexada
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[180px] text-right leading-tight">
                Aguardando colaborador anexar no quadro NF do perfil
              </span>
            </span>
          )
        ) : (
          /* CLT */
          folha.anexo_url ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Recibo anexado
              </span>
              <a
                href={folha.anexo_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Ver
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : readonly ? (
            <span className="text-xs text-muted-foreground">Sem recibo</span>
          ) : (
            <button
              type="button"
              onClick={() => setAbrirAnexar(true)}
              className="rounded border border-border bg-white px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
            >
              Anexar
            </button>
          )
        )}
      </div>

      {/* Sub-modal para anexar recibo CLT */}
      {abrirAnexar && (
        <ModalAnexarRecibo
          folha={folhaAdaptada}
          onFechar={() => setAbrirAnexar(false)}
          onSucesso={() => {
            setAbrirAnexar(false);
            onAnexarSucesso();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra de progresso
// ---------------------------------------------------------------------------

function BarraProgresso({ valor, total }: { valor: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  const completo = valor === total && total > 0;
  return (
    <div className="space-y-1.5">
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-[width] ${completo ? "bg-emerald-500" : "bg-sky-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {valor}/{total} {total === 1 ? "documento" : "documentos"} anexados
        </span>
        {completo ? (
          <span className="text-xs font-medium text-emerald-700">
            Pronto para envio!
          </span>
        ) : (
          <span className="text-xs text-amber-700">
            Faltam {total - valor} documento{total - valor !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props do modal
// ---------------------------------------------------------------------------

type Props = {
  row: RhFeriasFluxoRow;
  folhas: FolhaDoc[];
  coluna: ColunaFluxoFerias;
  open: boolean;
  onClose: () => void;
  onSucesso: () => void;
};

// ---------------------------------------------------------------------------
// Modal principal
// ---------------------------------------------------------------------------

export function ModalDocumentos({
  row,
  folhas,
  coluna,
  open,
  onClose,
  onSucesso,
}: Props) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const readonly = coluna !== "em_andamento";

  const docsConcluidos = folhas.filter(folhaEstaCompleta).length;
  const docsTotal = folhas.length;
  const podeEnviar = !readonly && docsConcluidos === docsTotal && docsTotal > 0;
  const faltam = docsTotal - docsConcluidos;

  async function handleEnviar() {
    if (!podeEnviar) return;
    setErro(null);
    setEnviando(true);
    try {
      const ids = folhas.map((f) => f.id);
      const res = await enviarFolhasFerias({ ids });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onSucesso();
      router.refresh();
    } catch {
      setErro("Erro inesperado ao enviar.");
    } finally {
      setEnviando(false);
    }
  }

  function handleAnexarSucesso() {
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {/* ------------------------------------------------------------------ */}
        {/* Header                                                              */}
        {/* ------------------------------------------------------------------ */}
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            {row.colaborador_nome}
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {formatarTipoContratacao(row.tipo_contratacao)}
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-white px-2 py-0.5 text-xs font-medium text-foreground">
              {labelTipoLancamento(row.tipo_lancamento)}
            </span>
          </DialogTitle>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              {fmtData(row.data_inicio)} a {fmtData(row.data_fim)} ·{" "}
              {row.dias} {row.dias === 1 ? "dia" : "dias"}
              {row.dias_abono > 0 && ` · ${row.dias_abono} dias vendidos`}
            </span>
            {row.vencimento_mais_proximo && (
              <span className="text-amber-700 font-medium">
                Vence {fmtData(row.vencimento_mais_proximo)}
              </span>
            )}
          </div>
        </DialogHeader>

        {/* ------------------------------------------------------------------ */}
        {/* Corpo                                                               */}
        {/* ------------------------------------------------------------------ */}
        <div className="space-y-4 py-2">
          {/* Progresso */}
          <BarraProgresso valor={docsConcluidos} total={docsTotal} />

          {/* Erro de envio */}
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          {/* Slots */}
          {folhas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma folha de pagamento gerada para este lançamento.
            </p>
          ) : (
            <div className="space-y-2">
              {folhas.map((folha) => (
                <SlotFolha
                  key={folha.id}
                  folha={folha}
                  readonly={readonly}
                  row={row}
                  onAnexarSucesso={handleAnexarSucesso}
                />
              ))}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Footer                                                              */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Fechar
          </button>

          {!readonly && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <button
                      type="button"
                      onClick={handleEnviar}
                      disabled={!podeEnviar || enviando}
                      className="rounded-lg bg-california-red px-4 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {enviando ? "Enviando..." : "Enviar ao financeiro"}
                    </button>
                  </span>
                </TooltipTrigger>
                {!podeEnviar && faltam > 0 && (
                  <TooltipContent side="top">
                    Faltam {faltam} documento{faltam !== 1 ? "s" : ""}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
