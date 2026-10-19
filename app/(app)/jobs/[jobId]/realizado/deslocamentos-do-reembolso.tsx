"use client";

/**
 * O reembolso de deslocamento com veículo próprio (decisão 187, 17/10/2026):
 * o "Valor desta PP" vira a conta da planilha "Reembolso de Gasolina" —
 * combustível (km ÷ consumo × preço do litro) mais desgaste (km × o valor
 * por km que o financeiro define). O trio da PP fica total × 1 × 1: são as
 * colunas da planilha do job. A conta mora em `lib/calculos/reembolso.ts`,
 * a mesma que o servidor refaz.
 */

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { MoneyInput } from "@/components/ui/money-input";
import { cn, formatCurrency } from "@/lib/utils";
import {
  contaDosDeslocamentos,
  contaPorExtenso,
  type DeslocamentosDoReembolso,
} from "@/lib/calculos/reembolso";

/** Uma linha como a pessoa digita (km em texto, "40,1"). */
export interface DeslocamentoEmEdicao {
  id: string;
  /** "AAAA-MM-DD" ou "". */
  data: string;
  trajeto: string;
  km: string;
  vezes: string;
}

export interface DeslocamentosEmEdicao {
  /** Km por litro, como digitado ("10"). */
  consumo: string;
  precoLitro: number;
  linhas: DeslocamentoEmEdicao[];
}

const novaLinha = (): DeslocamentoEmEdicao => ({ id: crypto.randomUUID(), data: "", trajeto: "", km: "", vezes: "1" });

export function deslocamentosVazios(): DeslocamentosEmEdicao {
  return { consumo: "", precoLitro: 0, linhas: [novaLinha()] };
}

function numero(texto: string): number {
  const n = Number(String(texto).trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const texto = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });

/** O que a PP grava, com o desgaste por km de agora. */
export function deslocamentosParaGravar(e: DeslocamentosEmEdicao, desgastePorKm: number): DeslocamentosDoReembolso {
  return {
    consumo_km_l: numero(e.consumo),
    preco_litro: e.precoLitro,
    desgaste_por_km: desgastePorKm,
    linhas: e.linhas.map((l) => ({
      data: l.data,
      trajeto: l.trajeto.trim(),
      km_ida_volta: numero(l.km),
      vezes: Math.trunc(numero(l.vezes)),
    })),
  };
}

/** A PP gravada de volta no formulário. */
export function deslocamentosEmEdicao(d: DeslocamentosDoReembolso): DeslocamentosEmEdicao {
  return {
    consumo: texto(d.consumo_km_l),
    precoLitro: d.preco_litro,
    linhas: d.linhas.length
      ? d.linhas.map((l) => ({
          id: crypto.randomUUID(),
          data: l.data,
          trajeto: l.trajeto,
          km: texto(l.km_ida_volta),
          vezes: String(l.vezes),
        }))
      : [novaLinha()],
  };
}

const ROTULO = "text-[11px] font-medium text-muted-foreground";
const VERMELHO = "border-california-red ring-2 ring-california-red/15";
const GRADE = "grid grid-cols-[120px_minmax(0,1fr)_92px_48px_80px_28px] gap-x-2";

function isoDoDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function DeslocamentosDoReembolsoField({
  valor,
  onChange,
  onTotal,
  desgastePorKm,
  destacarFaltas,
  hoje,
  disabled,
}: {
  valor: DeslocamentosEmEdicao;
  onChange: (d: DeslocamentosEmEdicao) => void;
  /** O total vai para o trio da PP: total × 1 × 1. */
  onTotal: (total: number) => void;
  /** O desgaste por km do financeiro. Null enquanto carrega. */
  desgastePorKm: number | null;
  destacarFaltas: boolean;
  hoje: string;
  disabled?: boolean;
}) {
  const gravavel = deslocamentosParaGravar(valor, desgastePorKm ?? 0);
  const conta = contaDosDeslocamentos(gravavel);
  const consumo = gravavel.consumo_km_l;
  const pronto = desgastePorKm !== null && consumo > 0 && valor.precoLitro > 0;

  React.useEffect(() => {
    onTotal(desgastePorKm === null ? 0 : conta.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conta.total, desgastePorKm]);

  const mudarLinha = (id: string, parte: Partial<DeslocamentoEmEdicao>) =>
    onChange({ ...valor, linhas: valor.linhas.map((l) => (l.id === id ? { ...l, ...parte } : l)) });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Valor desta PP</h4>
        <span className="text-[11px] text-muted-foreground">combustível + desgaste do veículo, por km</span>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="min-w-0">
          <label htmlFor="desl-consumo" className="text-xs font-medium">
            Consumo do veículo *
          </label>
          <div className="relative">
            <Input
              id="desl-consumo"
              value={valor.consumo}
              onChange={(e) => onChange({ ...valor, consumo: e.target.value })}
              inputMode="decimal"
              disabled={disabled}
              className={cn("no-spinner pr-12 text-right font-mono font-semibold", destacarFaltas && !(consumo > 0) && VERMELHO)}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
              km/l
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor="desl-preco" className="text-xs font-medium">
            Preço do litro *
          </label>
          <MoneyInput
            id="desl-preco"
            value={valor.precoLitro > 0 ? valor.precoLitro : null}
            onValueChange={(v) => onChange({ ...valor, precoLitro: v })}
            aria-label="Preço do litro"
            disabled={disabled}
            className={cn("text-right font-mono font-semibold", destacarFaltas && !(valor.precoLitro > 0) && VERMELHO)}
          />
        </div>
        <div className="min-w-0">
          <span className="text-xs font-medium">Desgaste por km</span>
          <div
            className="flex h-11 items-center justify-end rounded-md border border-dashed border-border px-3 font-mono text-sm font-semibold text-muted-foreground"
            title="Valor definido pelo financeiro"
          >
            {desgastePorKm === null ? "…" : formatCurrency(desgastePorKm, "BRL")}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className={cn(GRADE, "px-0.5")}>
          <span className={ROTULO}>Data *</span>
          <span className={ROTULO}>Trajeto *</span>
          <span className={cn(ROTULO, "whitespace-nowrap text-right")}>Km ida e volta</span>
          <span className={cn(ROTULO, "text-right")}>Vezes</span>
          <span className={cn(ROTULO, "text-right")}>Valor</span>
          <span />
        </div>
        {valor.linhas.map((l, i) => (
          <div key={l.id} className={cn(GRADE, "items-center")}>
            <DatePicker
              id={`desl-data-${l.id}`}
              name={`desl_data_${l.id}`}
              defaultValue={l.data || undefined}
              placeholder="Selecione"
              onDateChange={(d) => mudarLinha(l.id, { data: d ? isoDoDia(d) : "" })}
              dateDisabled={(d) => isoDoDia(d) > hoje}
              disabled={disabled}
              className={cn("h-9 px-2 text-xs", destacarFaltas && !l.data && VERMELHO)}
            />
            <Input
              aria-label={`Trajeto do ${i + 1}º deslocamento`}
              value={l.trajeto}
              onChange={(e) => mudarLinha(l.id, { trajeto: e.target.value })}
              placeholder="Saída → paradas → volta"
              title={l.trajeto}
              maxLength={500}
              disabled={disabled}
              className={cn("h-9 px-2 text-xs", destacarFaltas && !l.trajeto.trim() && VERMELHO)}
            />
            <Input
              aria-label={`Km ida e volta do ${i + 1}º deslocamento`}
              value={l.km}
              onChange={(e) => mudarLinha(l.id, { km: e.target.value })}
              inputMode="decimal"
              disabled={disabled}
              className={cn(
                "no-spinner h-9 px-2 text-right font-mono text-xs",
                destacarFaltas && !(numero(l.km) > 0) && VERMELHO,
              )}
            />
            <Input
              aria-label={`Vezes do ${i + 1}º deslocamento`}
              value={l.vezes}
              onChange={(e) => mudarLinha(l.id, { vezes: e.target.value.replace(/\D/g, "").slice(0, 2) })}
              inputMode="numeric"
              disabled={disabled}
              className={cn(
                "no-spinner h-9 px-2 text-right font-mono text-xs",
                destacarFaltas && !(numero(l.vezes) >= 1) && VERMELHO,
              )}
            />
            <span className="text-right font-mono text-xs font-semibold">
              {pronto && conta.porLinha[i] > 0 ? formatCurrency(conta.porLinha[i], "BRL") : "—"}
            </span>
            <button
              type="button"
              onClick={() => onChange({ ...valor, linhas: valor.linhas.filter((x) => x.id !== l.id) })}
              disabled={disabled || valor.linhas.length === 1}
              aria-label={`Remover o ${i + 1}º deslocamento`}
              title="Remover"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-california-red disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...valor, linhas: [...valor.linhas, novaLinha()] })}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:border-california-red/40 hover:text-california-red disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar deslocamento
        </button>
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-border pt-2.5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] text-muted-foreground">
            {conta.km.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km · combustível{" "}
            <b className="font-mono text-foreground">{formatCurrency(pronto ? conta.combustivel : 0, "BRL")}</b> ·
            desgaste <b className="font-mono text-foreground">{formatCurrency(pronto ? conta.desgaste : 0, "BRL")}</b>
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {pronto ? contaPorExtenso(gravavel) : "preencha o consumo, o preço do litro e os deslocamentos"}
          </p>
        </div>
        <span className="flex-none font-mono text-xl font-bold">
          {pronto && conta.total > 0 ? formatCurrency(conta.total, "BRL") : "—"}
        </span>
      </div>
    </div>
  );
}
