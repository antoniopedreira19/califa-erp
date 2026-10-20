"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { MaskedInput } from "@/components/ui/masked-input";

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  erro?: boolean;
}

export interface CepInputProps {
  name?: string;
  id?: string;
  defaultValue?: string;
  disabled?: boolean;
  onEnderecoEncontrado?: (dados: {
    rua: string;
    bairro: string;
    cidade: string;
  }) => void;
  /** Reporta os dígitos do CEP pra quem precisa (ex.: form controlado). */
  onDigitsChange?: (digits: string) => void;
}

/**
 * Input de CEP que busca na ViaCEP no onBlur. Não quebra se API cair —
 * só não popula. `onEnderecoEncontrado` é chamado no sucesso pra pai
 * atualizar os campos de endereço.
 */
export function CepInput({
  name = "cep",
  id,
  defaultValue,
  disabled,
  onEnderecoEncontrado,
  onDigitsChange,
}: CepInputProps) {
  const [digits, setDigits] = React.useState("");
  const [buscando, setBuscando] = React.useState(false);

  async function buscar() {
    if (digits.length !== 8) return;
    setBuscando(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!r.ok) return;
      const d = (await r.json()) as ViaCepResponse;
      if (d.erro) return;
      onEnderecoEncontrado?.({
        rua: d.logradouro ?? "",
        bairro: d.bairro ?? "",
        cidade: d.localidade ?? "",
      });
    } catch {
      // silencia; ViaCEP é opcional
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="relative">
      <MaskedInput
        mask="cep"
        name={name}
        id={id}
        defaultValue={defaultValue}
        disabled={disabled || buscando}
        onDigitsChange={(d) => {
          setDigits(d);
          onDigitsChange?.(d);
        }}
        onBlur={buscar}
      />
      {buscando && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}
