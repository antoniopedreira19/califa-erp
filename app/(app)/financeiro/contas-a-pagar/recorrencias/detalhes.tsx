"use client";
// Os detalhes da recorrência no pop-up, no lugar da página (decisão 272).
// O cabeçalho traz o código, a situação e as ações; o corpo, o cadastro, a
// pendência de documento e os títulos (gerados e previstos), cada um com o
// status (o mesmo selo da lista) e o documento.
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Pause, Pencil, Play, Repeat, Square, Trash2, Upload } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formaPagamentoLabel } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ANTECEDENCIA, brl, dia, dicaDoEstado, frequenciaNome, somarDias, vencimentoResumo, type Recorrencia, type TituloDaRecorrencia } from "./dados";
import { DocumentosDoTitulo } from "./documento";
import type { Desativar } from "./desativar";
import { Selo } from "./lancar-conta";

/** `empilhado`: a data embaixo do selo (na coluna estreita da lista). */
export function SeloSituacao({ rec, empilhado }: { rec: Pick<Recorrencia, "situacao" | "data_fim">; empilhado?: boolean }) {
  const data =
    rec.situacao === "ativa" && rec.data_fim ? `até ${dia(rec.data_fim)}` : rec.situacao === "encerrada" && rec.data_fim ? `em ${dia(rec.data_fim)}` : null;
  const selo =
    rec.situacao === "ativa" ? (
      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
        Ativa
      </span>
    ) : rec.situacao === "pausada" ? (
      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
        Pausada
      </span>
    ) : (
      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Encerrada
      </span>
    );
  if (!data) return selo;
  return (
    <span className={cn("inline-flex gap-1", empilhado ? "flex-col items-start" : "items-center")}>
      {selo}
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">{data}</span>
    </span>
  );
}

function Botao({
  icone: Icone,
  texto,
  onClick,
  perigo,
  dica,
}: {
  icone: React.ComponentType<{ className?: string }>;
  texto: string;
  onClick: () => void;
  perigo?: boolean;
  dica?: string;
}) {
  const b = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold transition-colors",
        perigo
          ? "border-california-red/30 text-california-red hover:bg-california-red hover:text-white"
          : "border-border text-foreground hover:border-california-red/50 hover:text-california-red",
      )}
    >
      <Icone className="h-3.5 w-3.5" />
      {texto}
    </button>
  );
  if (!dica) return b;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{b}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{dica}</TooltipContent>
    </Tooltip>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className="mt-0.5 truncate text-sm">{children}</div>
    </div>
  );
}

export function regionalResumo(r: Pick<Recorrencia, "rateio">): string {
  if (r.rateio.length === 0) return "—";
  if (r.rateio.length === 1) return r.rateio[0].nome;
  return `Todas (TD), pelo rateio: ${r.rateio.map((x) => `${x.nome} ${x.percentual.toLocaleString("pt-BR")}%`).join(" · ")}`;
}

export function CabecalhoDosDetalhes({
  rec,
  posicao,
  onAnterior,
  onProxima,
  onEditar,
  onDesativar,
}: {
  rec: Recorrencia;
  posicao: { i: number; n: number } | null;
  onAnterior?: () => void;
  onProxima?: () => void;
  onEditar: () => void;
  onDesativar: (q: Desativar) => void;
}) {
  return (
    <div className="border-b border-border px-6 py-4 pr-14">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Repeat className="h-5 w-5 text-california-red" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-california-red">{rec.codigo}</span>
              <SeloSituacao rec={rec} />
            </div>
            <h2 className="mt-0.5 truncate text-lg font-bold leading-tight">{rec.descricao}</h2>
          </div>
        </div>
        {posicao && posicao.n > 1 && (
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onAnterior}
                  disabled={!onAnterior}
                  className="rounded-md border border-border p-1 hover:text-california-red disabled:opacity-40"
                  aria-label="Recorrência anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>A anterior da lista (com os filtros de agora)</TooltipContent>
            </Tooltip>
            <span className="w-16 whitespace-nowrap text-center font-mono">
              {posicao.i + 1} de {posicao.n}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onProxima}
                  disabled={!onProxima}
                  className="rounded-md border border-border p-1 hover:text-california-red disabled:opacity-40"
                  aria-label="Próxima recorrência"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>A próxima da lista</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rec.situacao === "ativa" && <Botao icone={Pencil} texto="Editar" onClick={onEditar} />}
        {rec.situacao === "ativa" && (
          <Botao icone={Pause} texto="Pausar" onClick={() => onDesativar("pausar")} dica="Para de gerar títulos até reativar. Pergunta o que fazer com o título que já nasceu." />
        )}
        {rec.situacao !== "ativa" && <Botao icone={Play} texto="Reativar" onClick={() => onDesativar("reativar")} />}
        {rec.situacao !== "encerrada" && (
          <Botao icone={Square} texto="Encerrar" onClick={() => onDesativar("encerrar")} dica="O custo acabou: escolha o último vencimento a pagar." />
        )}
        {rec.titulos.length === 0 && (
          <Botao icone={Trash2} texto="Excluir" perigo onClick={() => onDesativar("excluir")} dica="Só aparece na recorrência que nunca gerou título." />
        )}
      </div>
    </div>
  );
}

export function CorpoDosDetalhes({
  rec,
  onAnexar,
  onLancar,
  onMudou,
}: {
  rec: Recorrencia;
  onAnexar: (t: TituloDaRecorrencia) => void;
  onLancar: (t: TituloDaRecorrencia) => void;
  onMudou: () => void;
}) {
  const pendentes = rec.titulos.filter((t) => t.semDocumento);
  const linhasPrevistas = rec.previstas.map((d) => ({ d, nasce: somarDias(d, -ANTECEDENCIA) }));
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
      {pendentes.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/25 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {pendentes.length === 1 ? "1 pagamento" : `${pendentes.length} pagamentos`} sem o documento da cobrança:{" "}
            {pendentes.map((t) => `${t.codigo} (${dia(t.vencimento)})`).join(", ")}. Anexe na linha do título abaixo.
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-x-6 gap-y-4 rounded-xl border border-border bg-muted/20 p-4">
        <Campo rotulo="Valor">
          <span className="font-mono font-semibold">{brl(rec.valor)}</span>
          {rec.valor_variavel && <span className="text-muted-foreground"> · varia (estimado)</span>}
        </Campo>
        <Campo rotulo="Vencimento">
          {vencimentoResumo(rec)} <span className="text-muted-foreground">· {frequenciaNome(rec.frequencia).toLowerCase()}</span>
        </Campo>
        <Campo rotulo="Fornecedor">{rec.fornecedor_nome ?? <span className="text-amber-700">Sem fornecedor ligado</span>}</Campo>
        <Campo rotulo="Forma de pagamento">
          {rec.forma_pagamento ? formaPagamentoLabel(rec.forma_pagamento) : <span className="text-muted-foreground">Não definida</span>}
        </Campo>
        <Campo rotulo="Empresa">{rec.empresa_nome}</Campo>
        <Campo rotulo="Plano de contas">
          <span className="font-mono">{rec.tipo_codigo}</span> · {rec.subtipo_nome}
        </Campo>
        <Campo rotulo="Regional">
          <span title={regionalResumo(rec)}>{regionalResumo(rec)}</span>
        </Campo>
        {rec.forma_pagamento === "debito_automatico" && (
          <Campo rotulo="Como aparece no extrato">
            {rec.texto_no_extrato ? <span className="font-mono text-xs">{rec.texto_no_extrato}</span> : <span className="text-muted-foreground">Não informado</span>}
          </Campo>
        )}
        <Campo rotulo="Último vencimento">{rec.data_fim ? dia(rec.data_fim) : <span className="text-muted-foreground">Sem data para acabar</span>}</Campo>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Títulos</h3>
        <div className="relative overflow-x-auto rounded-xl border border-border">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 170 }} />
              <col />
            </colgroup>
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Título</th>
                <th className="px-3 py-2 text-left">Vencimento</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Documento</th>
              </tr>
            </thead>
            <tbody>
              {[...rec.titulos].reverse().map((t) => (
                <tr key={t.id} className={cn("border-b border-border last:border-0", t.semDocumento && "bg-california-red/[0.03]")}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link prefetch={false} href={`/financeiro/contas-a-pagar/avulsa/${t.id}`} className="hover:text-california-red hover:underline">
                          {t.codigo}
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>Abrir o título (baixa, anexos e histórico)</TooltipContent>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{dia(t.vencimento)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                    {t.estimado ? <span className="italic text-muted-foreground">≈ {brl(t.valor)}</span> : brl(t.valor)}
                  </td>
                  <td className="px-3 py-2">
                    <Selo e={t.estado} dica={dicaDoEstado(t)} />
                  </td>
                  <td className="px-3 py-2">
                    {t.estimado && !t.travado ? (
                      <button
                        type="button"
                        onClick={() => onLancar(t)}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 hover:border-amber-500"
                      >
                        <Upload className="h-3 w-3" /> Lançar a conta
                      </button>
                    ) : (
                      <DocumentosDoTitulo t={t} onAnexar={() => onAnexar(t)} onMudou={onMudou} />
                    )}
                  </td>
                </tr>
              ))}
              {linhasPrevistas.map(({ d, nasce }) => (
                <tr key={d} className="border-b border-border bg-muted/10 text-muted-foreground last:border-0">
                  <td className="px-3 py-2 text-xs">—</td>
                  <td className="px-3 py-2 font-mono text-xs">{dia(d)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{brl(rec.valor)}</td>
                  <td className="px-3 py-2 text-xs" colSpan={2}>
                    Previsto · vira título em {dia(nasce)}
                  </td>
                </tr>
              ))}
              {rec.titulos.length === 0 && linhasPrevistas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Nenhum título.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">O título nasce {ANTECEDENCIA} dias antes do vencimento e é pago em Títulos a Pagar.</p>
      </div>
    </div>
  );
}
