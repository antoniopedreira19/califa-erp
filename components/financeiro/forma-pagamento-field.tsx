"use client";

import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { proximaFatura, formatarISO } from "@/lib/cartoes/proxima-fatura";
import {
  type FormaPagamento,
  type BandeiraCartao,
  formaPagamentoLabel,
  bandeiraCartaoLabel,
} from "@/lib/types";

export interface CartaoOption {
  id: string;
  nome: string;
  banco: string;
  bandeira: BandeiraCartao;
  ultimos_4_digitos: string;
  dia_vencimento_fatura: number;
  /** Decide em QUAL fatura a compra cai. Ausente = cartão cadastrado
   *  antes de 28/08/2026; a conta cai no comportamento antigo. */
  dia_fechamento_fatura?: number | null;
}

export interface FormaPagamentoValue {
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
}

interface Props {
  cartoes: CartaoOption[];
  value: FormaPagamentoValue;
  /**
   * onChange recebe o valor novo. Se a mudança selecionar um cartão,
   * também recebe a data ISO sugerida (`dataPagamentoSugerida`) — o
   * consumidor decide se auto-preenche o campo de data do form.
   */
  onChange: (
    v: FormaPagamentoValue,
    opts?: { dataPagamentoSugerida?: string },
  ) => void;
  disabled?: boolean;
  obrigatorio?: boolean;
  /**
   * Esconde "Cartão de Crédito" da lista. É para o pagamento em que o
   * cartão não faz sentido nenhum — a baixa da fatura de cartão, que não
   * se paga com outro cartão. O banco já recusa; sem isto a tela
   * oferecia um caminho que só terminava em erro (28/08/2026).
   */
  semCartao?: boolean;
  /** Erro do formulário, exibido abaixo do campo. */
  error?: string;
}

const FORMAS: FormaPagamento[] = [
  "pix",
  "transferencia",
  "boleto",
  "cartao_credito",
];

const FORMAS_SEM_CARTAO = FORMAS.filter((f) => f !== "cartao_credito");

export function FormaPagamentoField({
  cartoes,
  value,
  onChange,
  disabled,
  obrigatorio = true,
  semCartao = false,
  error,
}: Props) {
  const formas = semCartao ? FORMAS_SEM_CARTAO : FORMAS;
  function handleFormaChange(nova: FormaPagamento) {
    if (nova !== "cartao_credito") {
      onChange({ forma_pagamento: nova, cartao_credito_id: null });
      return;
    }
    // Ao virar cartão: se só há 1 cartão, seleciona automaticamente.
    if (cartoes.length === 1) {
      const unico = cartoes[0];
      const dia = unico.dia_vencimento_fatura;
      const data = formatarISO(
        proximaFatura(dia, new Date(), unico.dia_fechamento_fatura),
      );
      onChange(
        { forma_pagamento: "cartao_credito", cartao_credito_id: unico.id },
        { dataPagamentoSugerida: data },
      );
      return;
    }
    onChange({ forma_pagamento: "cartao_credito", cartao_credito_id: null });
  }

  function handleCartaoChange(cartaoId: string) {
    const c = cartoes.find((c) => c.id === cartaoId);
    if (!c) return;
    const data = formatarISO(
      proximaFatura(c.dia_vencimento_fatura, new Date(), c.dia_fechamento_fatura),
    );
    onChange(
      { forma_pagamento: "cartao_credito", cartao_credito_id: cartaoId },
      { dataPagamentoSugerida: data },
    );
  }

  const mostraCartao = value.forma_pagamento === "cartao_credito";
  const semCartoes = mostraCartao && cartoes.length === 0;

  return (
    <div className="space-y-2">
      <Label>Forma de pagamento{obrigatorio ? " *" : ""}</Label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select
          value={value.forma_pagamento ?? undefined}
          onValueChange={(v) => handleFormaChange(v as FormaPagamento)}
          disabled={disabled}
        >
          <SelectTrigger aria-required={obrigatorio}>
            <SelectValue placeholder="Selecione a forma" />
          </SelectTrigger>
          <SelectContent>
            {formas.map((f) => (
              <SelectItem key={f} value={f}>
                {formaPagamentoLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {mostraCartao && !semCartoes && (
          <Select
            value={value.cartao_credito_id ?? undefined}
            onValueChange={handleCartaoChange}
            disabled={disabled}
          >
            <SelectTrigger aria-required>
              <SelectValue placeholder="Selecione o cartão" />
            </SelectTrigger>
            <SelectContent>
              {cartoes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} · {bandeiraCartaoLabel(c.bandeira)} · ••••
                  {c.ultimos_4_digitos}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {semCartoes && (
        <p className="text-xs text-muted-foreground">
          Nenhum cartão cadastrado.{" "}
          <Link
            href="/cadastros/cartoes-credito"
            target="_blank"
            className="text-california-red underline hover:no-underline"
          >
            Cadastrar cartão
          </Link>
          .
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
