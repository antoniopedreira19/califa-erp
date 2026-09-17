"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input controlado que aplica máscara de moeda pt-BR enquanto o usuário
 * digita. Ex.: "10000" → "R$ 100,00", "1000000" → "R$ 10.000,00".
 *
 * Guarda internamente só os DÍGITOS (representando os centavos), o que
 * evita ambiguidade de vírgula/ponto. O `<input name>` renderiza o valor
 * formatado; consumidores que enviam via FormData podem receber ou
 * "10.000,00" (padrão) ou o valor decimal cru "10000.00" via prop
 * `nameCru`.
 *
 * Aceita `defaultValue` em decimal ("5000", "5000.00", "5000,00",
 * "5.000,00" — normaliza tudo).
 */

const formatador = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function centavosParaTexto(centavos: string): string {
  const digitos = centavos.replace(/\D/g, "").padStart(3, "0");
  const inteiros = digitos.slice(0, -2).replace(/^0+/, "") || "0";
  const decimais = digitos.slice(-2);
  const n = Number(`${inteiros}.${decimais}`);
  if (!Number.isFinite(n)) return "";
  return formatador.format(n);
}

function decimalParaCentavos(v: string | undefined): string {
  if (!v) return "";
  // Normaliza: aceita "5000", "5000.00", "5000,00", "5.000,00"
  const bruto = v.trim();
  if (bruto.length === 0) return "";
  // Se tem vírgula, é padrão pt-BR (pontos são separador de milhar)
  const norm = bruto.includes(",")
    ? bruto.replace(/\./g, "").replace(",", ".")
    : bruto;
  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0) return "";
  // Converte pra centavos
  return String(Math.round(n * 100));
}

function centavosParaDecimal(centavos: string): string {
  if (!centavos) return "0.00";
  const n = Number(centavos) / 100;
  return n.toFixed(2);
}

export interface MoedaInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value" | "type" | "defaultValue"
  > {
  /** Valor inicial em decimal ("5000", "5000.00", "5000,00", "5.000,00"). */
  defaultValue?: string;
  /**
   * Nome opcional para um <input hidden> paralelo, com o valor no formato
   * decimal cru "10000.00" (para consumidores que preferem ler assim).
   */
  nameCru?: string;
  /** Callback com os centavos brutos (string com dígitos apenas). */
  onCentavosChange?: (centavos: string) => void;
}

export const MoedaInput = React.forwardRef<HTMLInputElement, MoedaInputProps>(
  (
    {
      className,
      defaultValue = "",
      onCentavosChange,
      nameCru,
      name,
      placeholder,
      ...props
    },
    ref,
  ) => {
    const [centavos, setCentavos] = React.useState<string>(() =>
      decimalParaCentavos(defaultValue),
    );

    const texto = centavos ? centavosParaTexto(centavos) : "";

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const digitos = e.target.value.replace(/\D/g, "").slice(0, 15);
      setCentavos(digitos);
      onCentavosChange?.(digitos);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      // Backspace apaga um dígito por vez, sempre "do fim".
      if (e.key === "Backspace") {
        e.preventDefault();
        const novo = centavos.slice(0, -1);
        setCentavos(novo);
        onCentavosChange?.(novo);
      }
    }

    return (
      <>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            R$
          </span>
          <input
            ref={ref}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            name={name}
            value={texto}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "0,00"}
            className={cn(
              "flex h-11 w-full rounded-lg border border-border bg-white pl-9 pr-3.5 py-2 text-sm text-foreground ring-offset-background transition-colors placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50 tabular-nums text-right",
              className,
            )}
            {...props}
          />
        </div>
        {nameCru && (
          <input type="hidden" name={nameCru} value={centavosParaDecimal(centavos)} />
        )}
      </>
    );
  },
);
MoedaInput.displayName = "MoedaInput";
