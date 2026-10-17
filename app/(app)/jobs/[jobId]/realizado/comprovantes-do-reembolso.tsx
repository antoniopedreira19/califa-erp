"use client";

/**
 * Os comprovantes do reembolso de despesas (decisão 187, 17/10/2026).
 *
 * Cada arquivo leva número, data e valor — embaixo dele, no lugar e no
 * desenho dos campos da NF —, e a soma fecha o valor da PP. São opcionais
 * para salvar e gerar, e obrigatórios no envio ao financeiro (a regra está
 * em `lib/calculos/reembolso.ts`, a mesma do servidor). No reembolso de
 * veículo próprio o anexo (foto da quilometragem, print do mapa) não leva
 * tipo nem campo.
 */

import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { MoneyInput } from "@/components/ui/money-input";
import { cn, formatCurrency } from "@/lib/utils";
import type { ComprovanteDoReembolso } from "@/lib/calculos/reembolso";
import type { AnexoEmEdicao } from "./anexos-da-pp";

const ROTULO = "text-[11px] font-medium text-muted-foreground";
const ALTURA = "h-8 px-2 text-xs";
const VERMELHO = "border-california-red ring-2 ring-california-red/15";

function isoDoDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** O número do comprovante: na NF ele mora em `nf.numero`, nos outros em `numero`. */
function numeroDoAnexo(a: AnexoEmEdicao): string {
  return a.tipo === "nota_fiscal" ? a.nf.numero : (a.numero ?? "");
}

/** Os anexos em edição, no formato da regra dos comprovantes. Os que ainda
 *  sobem ficam de fora — quem chama confere o upload antes. */
export function comprovantesDosAnexos(anexos: AnexoEmEdicao[]): ComprovanteDoReembolso[] {
  return anexos
    .filter((a) => a.status === "ok")
    .map((a) => ({
      tipo: a.tipo,
      numero: numeroDoAnexo(a).trim() || null,
      data: a.nf.emissao || null,
      valor: a.nf.valor > 0 ? a.nf.valor : null,
    }));
}

/** Número, data e valor, embaixo do arquivo. */
export function CamposDoComprovante({
  anexo,
  onNumero,
  onData,
  onValor,
  hoje,
  destacarFaltas,
  disabled,
}: {
  anexo: AnexoEmEdicao;
  onNumero: (numero: string) => void;
  onData: (iso: string) => void;
  onValor: (valor: number) => void;
  hoje: string;
  /** Depois de uma tentativa de enviar: os campos vazios em vermelho. */
  destacarFaltas: boolean;
  disabled?: boolean;
}) {
  const id = `comprovante-${anexo.id}`;
  const numero = numeroDoAnexo(anexo);
  return (
    <div className="grid grid-cols-[148px_148px_132px] gap-x-2 gap-y-2">
      <div className="min-w-0">
        <label htmlFor={`${id}-numero`} className={ROTULO}>
          Número *
        </label>
        <Input
          id={`${id}-numero`}
          value={numero}
          onChange={(e) => onNumero(e.target.value)}
          autoComplete="off"
          maxLength={60}
          disabled={disabled}
          className={cn("font-mono", ALTURA, destacarFaltas && !numero.trim() && VERMELHO)}
        />
      </div>
      <div className="min-w-0">
        <label htmlFor={`${id}-data`} className={ROTULO}>
          Data da despesa *
        </label>
        <DatePicker
          id={`${id}-data`}
          name={`${id}_data`}
          defaultValue={anexo.nf.emissao || undefined}
          placeholder="Selecione"
          onDateChange={(d) => onData(d ? isoDoDia(d) : "")}
          dateDisabled={(d) => isoDoDia(d) > hoje}
          disabled={disabled}
          className={cn(ALTURA, destacarFaltas && !anexo.nf.emissao && VERMELHO)}
        />
      </div>
      <div className="min-w-0">
        <label htmlFor={`${id}-valor`} className={ROTULO}>
          Valor pago *
        </label>
        <MoneyInput
          id={`${id}-valor`}
          value={anexo.nf.valor > 0 ? anexo.nf.valor : null}
          onValueChange={onValor}
          aria-label="Valor pago"
          disabled={disabled}
          className={cn(ALTURA, destacarFaltas && !(anexo.nf.valor > 0) && VERMELHO)}
        />
      </div>
    </div>
  );
}

/** A soma dos comprovantes contra o valor da PP, embaixo da lista. */
export function ResumoDosComprovantes({ anexos, valorPP }: { anexos: AnexoEmEdicao[]; valorPP: number }) {
  const ok = anexos.filter((a) => a.status === "ok");
  if (ok.length === 0) return null;
  const soma = Math.round(ok.reduce((t, a) => t + (a.nf.valor || 0), 0) * 100) / 100;
  const bate = soma > 0 && valorPP > 0 && Math.abs(soma - valorPP) <= 0.004;
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-baseline justify-end gap-x-3 text-[11.5px] text-muted-foreground">
        <span>
          Soma {ok.length === 1 ? "do comprovante" : `dos ${ok.length} comprovantes`}{" "}
          <b className={cn("font-mono text-foreground", soma > 0 && !bate && "text-amber-800")}>
            {formatCurrency(soma, "BRL")}
          </b>
        </span>
        <span>
          Valor da PP <b className="font-mono text-foreground">{formatCurrency(valorPP, "BRL")}</b>
        </span>
        {bate && <CheckCircle2 className="h-3.5 w-3.5 self-center text-emerald-600" aria-label="A soma fecha" />}
      </p>
      {soma > 0 && valorPP > 0 && !bate && (
        <p className="flex items-start justify-end gap-1.5 text-[11.5px] font-semibold leading-snug text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          O reembolso devolve o que foi pago: a soma precisa ser o valor da PP.
        </p>
      )}
    </div>
  );
}
