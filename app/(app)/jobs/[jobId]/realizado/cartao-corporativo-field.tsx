"use client";

/**
 * A PP no cartão corporativo (decisão 209, 23/10/2026): o financeiro paga
 * a compra no cartão de crédito da empresa. Não há fornecedor — no lugar do
 * campo dele, a plataforma (ou o site) e o link da compra, lado a lado. O
 * cartão e as parcelas da fatura são do financeiro, na aprovação.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  LINK_DA_COMPRA_MAX,
  PLATAFORMA_MAX,
  problemaDaPlataforma,
  problemaDoLinkDaCompra,
} from "@/lib/validations/cartao-corporativo";

export interface CartaoCorporativoEstado {
  plataforma: string;
  link: string;
}

export const CARTAO_VAZIO: CartaoCorporativoEstado = { plataforma: "", link: "" };

/** O primeiro problema, com a mesma régua do servidor. Null = pode gerar. */
export function problemaDoCartao(c: CartaoCorporativoEstado): string | null {
  return problemaDaPlataforma(c.plataforma) ?? problemaDoLinkDaCompra(c.link);
}

const CAIXA =
  "flex h-11 w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

export function CartaoCorporativoField({
  valor,
  onChange,
  destacarFalta,
  disabled,
}: {
  valor: CartaoCorporativoEstado;
  onChange: (v: CartaoCorporativoEstado) => void;
  /** A geração foi tentada com algo faltando: bordas e erros em vermelho. */
  destacarFalta: boolean;
  disabled?: boolean;
}) {
  const faltaPlataforma = destacarFalta ? problemaDaPlataforma(valor.plataforma) : null;
  // O erro do link espera a pessoa sair do campo (ou a tentativa de gerar):
  // enquanto ela digita, o link está incompleto e não errado.
  const [saiuDoLink, setSaiuDoLink] = React.useState(false);
  const erroLink =
    destacarFalta || (saiuDoLink && valor.link.trim()) ? problemaDoLinkDaCompra(valor.link) : null;
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] gap-3">
        <div>
          <label htmlFor="cartao-plataforma" className="text-xs font-medium">
            Plataforma *
          </label>
          <input
            id="cartao-plataforma"
            value={valor.plataforma}
            onChange={(e) => onChange({ ...valor, plataforma: e.target.value })}
            disabled={disabled}
            maxLength={PLATAFORMA_MAX}
            placeholder="Mercado Livre, Amazon…"
            className={cn(CAIXA, faltaPlataforma ? "border-california-red" : "border-border")}
          />
          {faltaPlataforma && <p className="mt-1 text-[11.5px] text-california-red">{faltaPlataforma}</p>}
        </div>
        <div>
          <label htmlFor="cartao-link" className="text-xs font-medium">
            Link da compra *
          </label>
          <input
            id="cartao-link"
            value={valor.link}
            onChange={(e) => onChange({ ...valor, link: e.target.value })}
            onBlur={() => setSaiuDoLink(true)}
            disabled={disabled}
            maxLength={LINK_DA_COMPRA_MAX}
            placeholder="Cole o link do produto ou do carrinho"
            spellCheck={false}
            className={cn(CAIXA, erroLink ? "border-california-red" : "border-border")}
          />
          {erroLink && <p className="mt-1 text-[11.5px] text-california-red">{erroLink}</p>}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">O financeiro paga no cartão da empresa.</p>
    </div>
  );
}
