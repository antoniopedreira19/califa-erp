"use client";

import * as React from "react";
import { cn, formatCnpj, formatCpf, formatTelefone, onlyDigits } from "@/lib/utils";

export type Mask = "telefone" | "cpf" | "cnpj";

const config: Record<
  Mask,
  { maxDigits: number; maxLength: number; format: (d: string) => string; placeholder: string }
> = {
  telefone: {
    maxDigits: 11,
    maxLength: 15, // "(XX) XXXXX-XXXX"
    format: formatTelefone,
    placeholder: "(11) 99999-9999",
  },
  cpf: {
    maxDigits: 11,
    maxLength: 14, // "XXX.XXX.XXX-XX"
    format: formatCpf,
    placeholder: "000.000.000-00",
  },
  cnpj: {
    maxDigits: 14,
    maxLength: 18, // "XX.XXX.XXX/XXXX-XX"
    format: formatCnpj,
    placeholder: "00.000.000/0000-00",
  },
};

export interface MaskedInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value" | "type"
  > {
  mask: Mask;
  defaultValue?: string;
  /** Callback opcional recebendo só os dígitos (útil para validação inline). */
  onDigitsChange?: (digits: string) => void;
}

/**
 * Input controlado que aplica máscara de telefone/CPF/CNPJ enquanto o
 * usuário digita. Só aceita dígitos e limita a quantidade máxima.
 * O valor que aparece no FormData continua sendo a string formatada —
 * o consumidor precisa chamar onlyDigits() antes de enviar ao servidor
 * (já é o comportamento dos handlers dos formulários deste projeto).
 */
export const MaskedInput = React.forwardRef<HTMLInputElement, MaskedInputProps>(
  ({ mask, className, defaultValue = "", onDigitsChange, ...props }, ref) => {
    const { maxDigits, maxLength, format, placeholder } = config[mask];
    const [value, setValue] = React.useState(() =>
      format(onlyDigits(defaultValue).slice(0, maxDigits)),
    );

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const digits = onlyDigits(e.target.value).slice(0, maxDigits);
      setValue(format(digits));
      onDigitsChange?.(digits);
    }

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={handleChange}
        maxLength={maxLength}
        placeholder={props.placeholder ?? placeholder}
        className={cn(
          "flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 text-sm text-foreground ring-offset-background transition-colors placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
MaskedInput.displayName = "MaskedInput";
