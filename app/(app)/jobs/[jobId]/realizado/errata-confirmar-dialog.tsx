"use client";

/**
 * O pop-up que fecha a errata.
 *
 * Ele é o último lugar em que dá para voltar atrás, então mostra as três
 * coisas que a errata muda — o que aconteceu com cada linha, o total do
 * orçado e o par faturamento/valor do job — e pede a **descrição**, que é
 * obrigatória: é ela que vai para o histórico, para o fio da Comunicação e
 * para a fila de abertura do financeiro.
 *
 * Do design `Planilha Interna - Alterar Orcado (Errata).dc.html` (projeto
 * Claude Design `69342d83`), 27/08/2026.
 */

import * as React from "react";
import { AlertCircle, FilePenLine, Landmark } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCurrency } from "@/lib/utils";
import { ERRATA } from "@/app/(app)/_planilha/blocos";
import type { MudancaErrata } from "./errata-rascunho";

interface ParDeValores {
  antes: number;
  depois: number;
}

interface Props {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  jobCodigo: string;
  jobNome: string;
  resumo: string;
  mudancas: MudancaErrata[];
  orcado: ParDeValores;
  faturamento: ParDeValores;
  valorJob: ParDeValores;
  moeda: string;
  /** Alguma linha nova ainda está sem descrição. */
  faltaNomear: boolean;
  salvando: boolean;
  erro: string | null;
  onConfirmar: (descricao: string) => void;
}

function corDoDelta(delta: number): string {
  if (delta > 0) return "text-[#c2410c]";
  if (delta < 0) return "text-[#047857]";
  return "text-muted-foreground";
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (v === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

function tagDaMudanca(m: MudancaErrata): { classe: string; texto: string } {
  if (m.acao === "removida") return { classe: ERRATA.tagRemovida, texto: "Removida" };
  if (m.acao === "nova") {
    return m.vermelha
      ? { classe: ERRATA.tagVermelha, texto: "Vermelha" }
      : { classe: ERRATA.tagNova, texto: "Nova" };
  }
  return { classe: ERRATA.tagAlterada, texto: "Alterada" };
}

function LinhaDeValor({
  rotulo,
  par,
  moeda,
  forte,
}: {
  rotulo: string;
  par: ParDeValores;
  moeda: string;
  forte?: boolean;
}) {
  const delta = par.depois - par.antes;
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span
        className={cn(
          "text-[12.5px]",
          forte ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {rotulo}
      </span>
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-mono text-[11.5px] text-muted-foreground line-through">
          {formatCurrency(par.antes, moeda)}
        </span>
        <span
          className={cn(
            "font-mono font-bold text-foreground",
            forte ? "text-[13.5px]" : "text-[12.5px]",
          )}
        >
          {formatCurrency(par.depois, moeda)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
          {comSinal(delta, moeda)}
        </span>
      </div>
    </div>
  );
}

export function ErrataConfirmarDialog({
  open,
  onOpenChange,
  jobCodigo,
  jobNome,
  resumo,
  mudancas,
  orcado,
  faturamento,
  valorJob,
  moeda,
  faltaNomear,
  salvando,
  erro,
  onConfirmar,
}: Props) {
  const [descricao, setDescricao] = React.useState("");

  // Zera a cada abertura: o texto de uma errata não pode vazar para a
  // seguinte, e reabrir depois de um erro tem que ser um recomeço limpo.
  React.useEffect(() => {
    if (open) setDescricao("");
  }, [open]);

  const descricaoOk = descricao.trim().length >= 5;
  const podeConfirmar =
    descricaoOk && !faltaNomear && !salvando && mudancas.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[620px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
              <FilePenLine className="h-4.5 w-4.5 text-california-red" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[19px]">Confirmar errata</DialogTitle>
              <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                {jobCodigo} · {jobNome} · {resumo}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* O que muda no orçado */}
          <section className="rounded-xl border border-border">
            <h3 className="border-b border-border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              O que muda no orçado
            </h3>
            <ul className="divide-y divide-border">
              {mudancas.map((m) => {
                const tag = tagDaMudanca(m);
                return (
                  <li
                    key={m.chave}
                    className="flex items-center justify-between gap-3 px-3.5 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={tag.classe}>{tag.texto}</span>
                      <span className="truncate text-[12.5px] text-foreground">
                        {m.item}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11.5px]">
                      <span className="text-muted-foreground">
                        {m.acao === "nova" ? "—" : formatCurrency(m.totalDe, moeda)}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-foreground">
                        {m.acao === "removida"
                          ? "—"
                          : formatCurrency(m.totalPara, moeda)}
                      </span>
                      <span className={cn("font-bold", corDoDelta(m.delta))}>
                        {comSinal(m.delta, moeda)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Os números */}
          <section className="rounded-xl border border-border px-3.5 py-2">
            <LinhaDeValor rotulo="Total do orçado" par={orcado} moeda={moeda} />
            <LinhaDeValor
              rotulo="Faturamento previsto"
              par={faturamento}
              moeda={moeda}
            />
            <LinhaDeValor
              rotulo="Valor do job"
              par={valorJob}
              moeda={moeda}
              forte
            />
          </section>

          {/* A consequência que não está nos números */}
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
            <Landmark className="mt-0.5 h-4 w-4 flex-none text-california-red" />
            <div className="space-y-1">
              <p className="text-[12.5px] font-semibold text-foreground">
                Confirmar devolve o job ao mural de abertura
              </p>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                O financeiro revisa a abertura com os números novos — previsão
                de recebimento ({formatCurrency(faturamento.depois, moeda)}),
                curva de desembolso do custo planejado e competência. O envio
                para faturamento fica bloqueado até essa revisão ser salva.
              </p>
            </div>
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <label
                htmlFor="descricao-errata"
                className="text-[12.5px] font-semibold text-foreground"
              >
                Descrição da errata
              </label>
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-california-red">
                obrigatória
              </span>
            </div>
            <Textarea
              id="descricao-errata"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              maxLength={500}
              autoFocus
              placeholder="Ex.: Iluminação renegociada com o fornecedor depois da visita técnica ao espaço."
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Vai para o histórico de erratas, para o fio da Comunicação e para
              a fila de abertura do financeiro — com autor, data e hora. O
              orçado aprovado da versão não muda: a errata fica registrada
              sobre ele.
            </p>
          </div>

          {faltaNomear && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-700" />
              <span className="text-[12px] text-amber-900">
                Uma das linhas novas está sem descrição. Preencha o nome dela na
                planilha antes de confirmar.
              </span>
            </div>
          )}

          {erro && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-california-red" />
              <span className="text-[12px] text-foreground">{erro}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
              className="inline-flex items-center rounded-lg border border-border bg-white px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:opacity-50"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => onConfirmar(descricao.trim())}
              disabled={!podeConfirmar}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FilePenLine className="h-3.5 w-3.5" />
              {salvando ? "Registrando…" : "Confirmar errata"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
