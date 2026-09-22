"use client";

/**
 * "Aprovar save" — o pop-up de um pedido da faixa Saves (decisão 099,
 * 22/09/2026). Não grava nada.
 *
 * Aprovar é revisar a abertura: o botão principal leva à página do job no
 * financeiro, na aba da abertura, com o formulário da revisão e a faixa
 * "Aprovação de save · revisão da abertura". É o registro daquela revisão
 * que aprova; voltar de lá sem registrar não aprova nada. A recusa sai
 * daqui mesmo, pela justificativa.
 *
 * Os números antes → depois são os que o pedido gravou quando nasceu — o
 * efeito da linha no valor do job (gera) ou no faturamento previsto
 * (consome). Os números que a revisão valida são recalculados lá.
 *
 * Do protótipo aprovado (`prototipo-save-v2`, `AprovarDialog`); o texto
 * da caixa de informação é o da especificação.
 */

import * as React from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CornerUpLeft,
  Info,
  Table2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { tipoCustoLabel } from "@/lib/types";
import { SAVE, corDoDelta } from "@/app/(app)/_planilha/blocos";
import type { SaveFilaLinha } from "./fila-list";

/** Antes → depois de um número, no formato do resumo da errata. `forte` é
 *  o número que o fechamento muda (valor do job, faturamento previsto); o
 *  saldo do save vem no peso de apoio, como no protótipo. */
function Par({
  rotulo,
  antes,
  depois,
  forte = false,
}: {
  rotulo: string;
  antes: number | null;
  depois: number | null;
  forte?: boolean;
}) {
  const rotuloClasses = forte
    ? "text-[12.5px] font-semibold text-foreground"
    : "text-[12.5px] text-muted-foreground";
  if (antes === null || depois === null) {
    return (
      <div className="flex items-center justify-between gap-4 py-1.5">
        <span className={rotuloClasses}>{rotulo}</span>
        <span className="text-[12.5px] text-muted-foreground">não registrado</span>
      </div>
    );
  }
  const delta = depois - antes;
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className={rotuloClasses}>{rotulo}</span>
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-mono text-[11.5px] text-muted-foreground line-through">
          {formatCurrency(antes)}
        </span>
        <span
          className={cn(
            "font-mono font-bold text-foreground",
            forte ? "text-[13.5px]" : "text-[12.5px]",
          )}
        >
          {formatCurrency(depois)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
          {delta === 0
            ? formatCurrency(0)
            : `${delta > 0 ? "+" : "−"}${formatCurrency(Math.abs(delta))}`}
        </span>
      </div>
    </div>
  );
}

function LinhaDado({
  rotulo,
  valor,
  mono,
}: {
  rotulo: string;
  valor: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-muted-foreground">{rotulo}</span>
      <span
        className={
          mono
            ? "text-right font-mono text-[13px] font-semibold"
            : "text-right text-[13px] font-semibold"
        }
      >
        {valor}
      </span>
    </div>
  );
}

export function AprovarSaveDialog({
  save,
  onOpenChange,
  onRecusar,
}: {
  save: SaveFilaLinha | null;
  onOpenChange: (aberto: boolean) => void;
  onRecusar: () => void;
}) {
  if (!save) return null;
  const gera = save.tipo === "gera";

  const dados: { rotulo: string; valor: string; mono?: boolean }[] = [
    { rotulo: "Job", valor: save.jobNome },
    { rotulo: "Código", valor: save.jobCodigo, mono: true },
    {
      rotulo: "Projeto",
      valor:
        [save.projetoNome, save.projetoCodigo].filter(Boolean).join(" · ") ||
        "—",
    },
    { rotulo: "Cliente", valor: save.clienteNome ?? "—" },
    { rotulo: "GP Responsável", valor: save.responsavelNome ?? "—" },
    {
      rotulo: "Linha",
      valor:
        [save.grupoNome, save.itemDescricao].filter(Boolean).join(" · ") || "—",
    },
    {
      rotulo: "Tipo de custo",
      valor: save.tipoCusto ? tipoCustoLabel(save.tipoCusto) : "—",
    },
    {
      rotulo: "Enviado",
      valor: [save.enviado_em_label, save.enviadoPorNome]
        .filter(Boolean)
        .join(" · "),
    },
  ];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[520px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
              {gera ? (
                <ArrowUpRight className="h-5 w-5" />
              ) : (
                <ArrowDownLeft className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[19px]">
                {gera ? "Aprovar save" : "Aprovar consumo de save"}
              </DialogTitle>
              <DialogDescription className="pt-1.5 text-[13.5px] leading-relaxed">
                {gera ? (
                  <>
                    A produção marcou esta linha do{" "}
                    <strong className="font-mono text-foreground">
                      {save.jobCodigo}
                    </strong>{" "}
                    como save. Confira a linha na planilha interna antes de
                    aprovar.
                  </>
                ) : (
                  <>
                    A produção quer pagar esta linha do{" "}
                    <strong className="font-mono text-foreground">
                      {save.jobCodigo}
                    </strong>{" "}
                    com saldo de save de outro job. Confira a linha na planilha
                    interna antes de aprovar.
                  </>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
          {dados.map((d) => (
            <LinhaDado key={d.rotulo} rotulo={d.rotulo} valor={d.valor} mono={d.mono} />
          ))}
          {gera ? (
            <>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
                <span className="text-[13px] font-semibold">
                  Crédito para {save.clienteNome ?? "o cliente"}
                </span>
                <span className={cn("font-mono text-[14px] font-bold", SAVE.textoApagado)}>
                  {formatCurrency(save.valor)}
                </span>
              </div>
              {/* O segundo número do save (decisão 028 §4): o crédito é o
                  orçado da linha; isto é o que a nota cobra por causa dela
                  — orçado + honorários + impostos. */}
              <LinhaDado
                rotulo="Faturamento desta linha"
                valor={
                  save.faturamentoDaLinha === null
                    ? "—"
                    : formatCurrency(save.faturamentoDaLinha)
                }
                mono
              />
            </>
          ) : (
            <>
              {save.origens.map((o, i) => (
                <div
                  key={o.jobId}
                  className={cn(
                    "flex items-baseline justify-between gap-3",
                    i === 0 && "border-t border-border pt-2.5",
                  )}
                >
                  <span className="text-[13px] text-muted-foreground">
                    Saldo usado ·{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {o.codigo}
                    </span>{" "}
                    {o.nome}
                  </span>
                  <span className="font-mono text-[13px] font-semibold">
                    {formatCurrency(o.valor)}
                  </span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-semibold">Total consumido</span>
                <span className={cn("font-mono text-[14px] font-bold", SAVE.textoApagado)}>
                  {formatCurrency(save.valor)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Os números que o pedido gravou quando nasceu. O save mexe no
            valor do job; o consumo, no faturamento previsto. Embaixo, o
            saldo de save: no `gera`, o do cliente antes → depois da
            aprovação; no `consome`, o que sobra em cada origem. */}
        <div className="rounded-xl border border-border px-3.5 py-2">
          {gera ? (
            <>
              <Par
                rotulo="Valor do job"
                antes={save.valorJobAntes}
                depois={save.valorJobDepois}
                forte
              />
              <Par
                rotulo={
                  save.clienteNome
                    ? `Saldo de save de ${save.clienteNome}`
                    : "Saldo de save do cliente"
                }
                antes={save.saldoDoCliente}
                depois={save.saldoDoCliente + save.valor}
              />
            </>
          ) : (
            <>
              <Par
                rotulo="Faturamento previsto"
                antes={save.faturamentoPrevistoAntes}
                depois={save.faturamentoPrevistoDepois}
                forte
              />
              {/* O saldo da origem já está com este consumo reservado —
                  a view desconta o pedido que aguarda (decisão 099 §6).
                  Por isso o número não muda com a aprovação, e a nota ao
                  lado diz isso. */}
              {save.origens.map((o) => (
                <div
                  key={o.jobId}
                  className="flex items-center justify-between gap-4 py-1.5"
                >
                  <span className="text-[12.5px] text-muted-foreground">
                    Saldo livre do {o.codigo}
                  </span>
                  <span className="font-mono text-[12.5px] font-bold">
                    {formatCurrency(o.disponivel)}{" "}
                    <span className="font-sans text-[11px] font-normal text-muted-foreground">
                      · este consumo já está reservado
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Aprovar leva à revisão da abertura: o save só fica aprovado quando
            você registrar a revisão.
          </p>
        </div>

        {/* A planilha do job em leitura, na página do job no financeiro —
            sem sair do módulo (decisão 099, item 20). O pedido vai junto:
            a planilha abre em modo destaque, com a linha marcada e o
            caminho de volta para a aprovação. */}
        <Link
          href={`/financeiro/jobs/${save.jobId}?aba=planilha&aprovarSave=${save.id}`}
          prefetch={false}
          className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-4 py-3 text-left transition-colors hover:border-california-red/50 hover:bg-california-red/5"
        >
          <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-border bg-white text-california-red">
            <Table2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">Visualizar planilha interna</p>
            <p className="text-[11.5px] text-muted-foreground">
              {gera
                ? "A linha deste save aparece destacada"
                : "A linha deste consumo aparece destacada"}
            </p>
          </div>
          <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onRecusar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-california-red transition-colors hover:border-california-red hover:bg-california-red/5"
          >
            <CornerUpLeft className="h-4 w-4" />
            {gera ? "Recusar save" : "Recusar consumo"}
          </button>
          {/* Leva à revisão; não aprova daqui. */}
          <Link
            href={`/financeiro/jobs/${save.jobId}?aba=abertura&aprovarSave=${save.id}`}
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-[18px] py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red-hover"
          >
            <Check className="h-4 w-4" />
            {gera ? "Aprovar save" : "Aprovar consumo"}
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
