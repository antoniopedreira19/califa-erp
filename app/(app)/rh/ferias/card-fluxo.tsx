"use client";

import { Check, X, Minus } from "lucide-react";
import type { RhFeriasFluxoRow, ColunaFluxoFerias } from "@/lib/types";
import { formatarTipoContratacao } from "@/lib/colaboradores/format-tipo-contratacao";
import { AcoesLancamento } from "./acoes-lancamento";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatarData(iso: string): string {
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [ano, mes, dia] = parts;
  return `${dia}/${mes}`;
}

function formatarDataCurta(iso: string): string {
  return formatarData(iso);
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

// ---------------------------------------------------------------------------
// Sub-componentes de UI reutilizáveis
// ---------------------------------------------------------------------------

function BadgeTipo({ tipo }: { tipo: RhFeriasFluxoRow["tipo_lancamento"] }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-border bg-white px-2 py-0.5 text-[10px] font-medium text-foreground">
      {labelTipoLancamento(tipo)}
    </span>
  );
}

function BadgeContratacao({ tipo }: { tipo: RhFeriasFluxoRow["tipo_contratacao"] }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
      {formatarTipoContratacao(tipo)}
    </span>
  );
}

function BarraProgresso({ valor, total }: { valor: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className="h-full rounded-full bg-sky-500 transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variantes por coluna
// ---------------------------------------------------------------------------

function CardPendente({ row }: { row: RhFeriasFluxoRow }) {
  return (
    <div className="rounded border border-amber-200 bg-white p-3 space-y-2 shadow-sm">
      {/* Linha 1: nome */}
      <p className="text-sm font-semibold text-foreground leading-tight truncate">
        {row.colaborador_nome}
      </p>

      {/* Linha 2: N dias · DD/MM a DD/MM */}
      <p className="text-xs text-muted-foreground">
        {row.dias} {row.dias === 1 ? "dia" : "dias"} · {formatarDataCurta(row.data_inicio)} a{" "}
        {formatarDataCurta(row.data_fim)}
      </p>

      {/* Linha 3: badges contratação + tipo */}
      <div className="flex flex-wrap items-center gap-1.5">
        <BadgeContratacao tipo={row.tipo_contratacao} />
        <BadgeTipo tipo={row.tipo_lancamento} />
      </div>

      {/* Rodapé: ações */}
      <div className="pt-1 border-t border-border">
        <AcoesLancamento
          lancamentoId={row.lancamento_id}
          status={row.status_lancamento}
          colaboradorNome={row.colaborador_nome}
        />
      </div>
    </div>
  );
}

function CardEmAndamento({
  row,
  onClick,
}: {
  row: RhFeriasFluxoRow;
  onClick?: (row: RhFeriasFluxoRow) => void;
}) {
  const docsConcluidos = row.folhas_clt_com_recibo + row.folhas_pj_com_nf;
  const docsTotal = row.folhas_total;

  return (
    <button
      type="button"
      className="w-full text-left rounded border border-sky-200 bg-white p-3 space-y-2 shadow-sm hover:border-sky-400 hover:shadow-md transition-all"
      onClick={() => onClick?.(row)}
    >
      {/* Linha 1: nome + badges */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground leading-tight truncate">
          {row.colaborador_nome}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <BadgeTipo tipo={row.tipo_lancamento} />
          <BadgeContratacao tipo={row.tipo_contratacao} />
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="space-y-1">
        <BarraProgresso valor={docsConcluidos} total={docsTotal} />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {docsConcluidos}/{docsTotal} documentos
          </span>
        </div>
      </div>

      {/* Vencimento */}
      {row.vencimento_mais_proximo && (
        <p className="text-[10px] text-amber-700 font-medium">
          Vence {formatarDataCurta(row.vencimento_mais_proximo)}
        </p>
      )}
    </button>
  );
}

function CardEnviada({
  row,
  onClick,
}: {
  row: RhFeriasFluxoRow;
  onClick?: (row: RhFeriasFluxoRow) => void;
}) {
  return (
    <button
      type="button"
      className="w-full text-left rounded border border-violet-200 bg-white p-3 space-y-2 shadow-sm hover:border-violet-400 hover:shadow-md transition-all"
      onClick={() => onClick?.(row)}
    >
      {/* Linha 1: nome + badge tipo */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground leading-tight truncate">
          {row.colaborador_nome}
        </p>
        <BadgeTipo tipo={row.tipo_lancamento} />
      </div>

      {/* Badge "Enviado em DD/MM" */}
      {row.aprovado_em && (
        <span className="inline-flex items-center rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[10px] font-medium text-violet-700">
          Enviado em {formatarDataCurta(row.aprovado_em)}
        </span>
      )}
    </button>
  );
}

function CardParcial({
  row,
  onClick,
}: {
  row: RhFeriasFluxoRow;
  onClick?: (row: RhFeriasFluxoRow) => void;
}) {
  const pagas = row.folhas_pagas;
  const total = row.folhas_total;

  return (
    <button
      type="button"
      className="w-full text-left rounded border border-fuchsia-200 bg-white p-3 space-y-2 shadow-sm hover:border-fuchsia-400 hover:shadow-md transition-all"
      onClick={() => onClick?.(row)}
    >
      {/* Linha 1: nome + badge tipo */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground leading-tight truncate">
          {row.colaborador_nome}
        </p>
        <BadgeTipo tipo={row.tipo_lancamento} />
      </div>

      {/* Badge N/M pagas + barra */}
      <div className="space-y-1">
        <BarraProgresso valor={pagas} total={total} />
        <span className="inline-flex items-center rounded-full bg-fuchsia-50 border border-fuchsia-200 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700">
          {pagas}/{total} pagas
        </span>
      </div>
    </button>
  );
}

function CardFinalizada({
  row,
  onClick,
}: {
  row: RhFeriasFluxoRow;
  onClick?: (row: RhFeriasFluxoRow) => void;
}) {
  const status = row.status_lancamento;

  const iconeMotivo =
    status === "reprovado" ? (
      <span className="flex items-center gap-1 text-red-600">
        <X className="h-3 w-3 shrink-0" />
        <span className="text-[10px] truncate max-w-[140px]">
          {row.motivo_reprovacao
            ? row.motivo_reprovacao.length > 50
              ? row.motivo_reprovacao.slice(0, 50) + "..."
              : row.motivo_reprovacao
            : "Reprovado"}
        </span>
      </span>
    ) : status === "cancelado" ? (
      <span className="flex items-center gap-1 text-slate-500">
        <Minus className="h-3 w-3 shrink-0" />
        <span className="text-[10px]">Cancelado</span>
      </span>
    ) : (
      <span className="flex items-center gap-1 text-emerald-600">
        <Check className="h-3 w-3 shrink-0" />
        <span className="text-[10px]">Finalizado</span>
      </span>
    );

  return (
    <button
      type="button"
      className="w-full text-left rounded border border-slate-200 bg-white p-3 space-y-2 shadow-sm hover:border-slate-400 hover:shadow-md transition-all"
      onClick={() => onClick?.(row)}
    >
      {/* Linha 1: nome + badge tipo */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground leading-tight truncate">
          {row.colaborador_nome}
        </p>
        <BadgeTipo tipo={row.tipo_lancamento} />
      </div>

      {/* Ícone + motivo */}
      {iconeMotivo}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

type CardFluxoProps = {
  row: RhFeriasFluxoRow;
  coluna: ColunaFluxoFerias;
  onClick?: (row: RhFeriasFluxoRow) => void;
};

export function CardFluxo({ row, coluna, onClick }: CardFluxoProps) {
  switch (coluna) {
    case "pendente":
      return <CardPendente row={row} />;
    case "em_andamento":
      return <CardEmAndamento row={row} onClick={onClick} />;
    case "enviada":
      return <CardEnviada row={row} onClick={onClick} />;
    case "parcial":
      return <CardParcial row={row} onClick={onClick} />;
    case "finalizada":
      return <CardFinalizada row={row} onClick={onClick} />;
  }
}
