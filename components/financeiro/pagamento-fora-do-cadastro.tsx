"use client";

/**
 * O pagamento fora do cadastro de uma PP, como as telas o leem (decisão
 * 127, 29/09/2026).
 *
 * Duas peças, as duas curtas de propósito — o Tiago cortou o texto do
 * primeiro desenho por cansar quem usa todo dia:
 *
 * - `PagamentoForaDoCadastroCartao`: três linhas logo abaixo do fornecedor
 *   (aviso e meio, para onde vai o dinheiro, motivo). Vai no dossiê do
 *   financeiro e na ficha da PP no job.
 * - `AprovarForaDoCadastro`: a marcação obrigatória do pop-up de aprovar,
 *   que carrega a própria chave e não repete o cartão do dossiê.
 *
 * O PDF não tem nada disto: o documento sai igual ao de sempre, só com a
 * chave (ou a conta) escolhida.
 */

import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { chavePixLegivel, nomeCurtoDoBanco } from "@/lib/data/foto-pagamento-da-pp";
import type { PagamentoForaDoCadastroDaPP, PixTipoChave, TipoContaBancariaFornecedor } from "@/lib/types";

const ROTULO_PIX: Record<PixTipoChave, string> = {
  cnpj: "CNPJ",
  cpf: "CPF",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Aleatória",
};

const ROTULO_CONTA: Record<TipoContaBancariaFornecedor, string> = {
  corrente: "Corrente",
  poupanca: "Poupança",
  pagamento: "Pagamento",
};

/** "PIX · Aleatória" ou "ITAÚ UNIBANCO". */
function meioLegivel(p: PagamentoForaDoCadastroDaPP): string {
  if (p.meio === "pix") return p.pix_tipo ? `PIX · ${ROTULO_PIX[p.pix_tipo]}` : "PIX";
  return p.banco_codigo ? nomeCurtoDoBanco(p.banco_codigo, p.banco_nome) : "Conta";
}

/** A chave, ou agência e conta — o que se digita no banco para pagar. */
export function destinoLegivel(p: PagamentoForaDoCadastroDaPP): string {
  if (p.meio === "pix") return chavePixLegivel(p.pix_tipo, p.pix_chave);
  const tipo = p.tipo_conta ? ROTULO_CONTA[p.tipo_conta] : "Conta";
  return `Ag. ${p.agencia ?? ""}${p.agencia_dv ? `-${p.agencia_dv}` : ""} · ${tipo} ${p.conta ?? ""}-${p.conta_dv ?? ""}`;
}

export function PagamentoForaDoCadastroCartao({
  pagamento,
  className,
}: {
  pagamento: PagamentoForaDoCadastroDaPP;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-amber-300 bg-amber-50/70 px-2.5 py-2", className)}>
      <p className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 flex-none" />
          Fora do cadastro
        </span>
        <span className="text-muted-foreground">{meioLegivel(pagamento)}</span>
      </p>
      <p className="mt-1 break-words font-mono text-[12.5px] font-semibold leading-snug tracking-[-0.01em]">
        {destinoLegivel(pagamento)}
      </p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{pagamento.motivo}</p>
    </div>
  );
}

export function AprovarForaDoCadastro({
  pagamento,
  marcado,
  onChange,
  emFalta,
  disabled,
}: {
  pagamento: PagamentoForaDoCadastroDaPP;
  marcado: boolean;
  onChange: (marcado: boolean) => void;
  /** Tentou aprovar sem marcar: borda vermelha. */
  emFalta: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcado}
      disabled={disabled}
      onClick={() => onChange(!marcado)}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[12.5px] leading-snug transition-colors disabled:opacity-50",
        marcado
          ? "border-emerald-300 bg-emerald-50/60"
          : emFalta
            ? "border-california-red bg-california-red/[0.04]"
            : "border-amber-300 bg-amber-50/70",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border transition-colors",
          marcado ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/50 bg-white",
        )}
      >
        {marcado && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="font-semibold">Aprovar pagamento fora do cadastro:</span>{" "}
        <span className="break-words font-mono">{destinoLegivel(pagamento)}</span>
      </span>
    </button>
  );
}
