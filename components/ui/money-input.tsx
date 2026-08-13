"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input de moeda BRL controlado. Digita da direita pra esquerda em centavos,
 * formata display como "R$ 111.111,11" à medida que o usuário digita.
 *
 * value: number em reais (não centavos). Ex: 1234.56.
 * onValueChange: recebe o número em reais a cada mudança.
 */

export interface MoneyInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value" | "type" | "inputMode"
  > {
  value: number | null;
  onValueChange: (value: number) => void;
  /** Símbolo mostrado no display. Default "R$". */
  symbol?: string;
}

function formatBRL(cents: number, symbol: string): string {
  const reais = cents / 100;
  const s = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(reais);
  return `${symbol} ${s}`;
}

function centsFromValue(value: number | null): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  // Evita erros de ponto flutuante: arredonda pra centavo
  return Math.round(value * 100);
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    { value, onValueChange, symbol = "R$", className, placeholder, ...props },
    ref,
  ) => {
    const [display, setDisplay] = React.useState(() =>
      formatBRL(centsFromValue(value), symbol),
    );

    // Sincroniza display quando value externo muda (ex: parcelamento padrão)
    React.useEffect(() => {
      setDisplay(formatBRL(centsFromValue(value), symbol));
    }, [value, symbol]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value.replace(/\D/g, ""); // só dígitos
      const cents = raw === "" ? 0 : parseInt(raw, 10);
      const reais = cents / 100;
      setDisplay(formatBRL(cents, symbol));
      onValueChange(reais);
    }

    function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
      // Move cursor pro fim (input funciona da direita pra esquerda)
      const len = e.target.value.length;
      e.target.setSelectionRange(len, len);
      props.onFocus?.(e);
    }

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder={placeholder ?? `${symbol} 0,00`}
        className={cn(
          "flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 text-sm text-foreground ring-offset-background transition-colors placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50 font-mono",
          className,
        )}
        {...props}
      />
    );
  },
);
MoneyInput.displayName = "MoneyInput";
