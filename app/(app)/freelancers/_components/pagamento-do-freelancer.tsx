"use client";

/**
 * A seção "Pagamento" do cadastro do freela (decisão 212, 26/10/2026), no
 * editar e no novo do RH e no formulário que o freela preenche pelo link.
 *
 * Chave PIX e conta bancária ficam sempre à vista, como no cadastro de
 * fornecedor (decisão 161): antes, um seletor "Tipo de pagamento" mostrava
 * uma OU outra, e o editar escondia o PIX de todos os freelas marcados
 * "Conta bancária" (os 59 ativos com PIX). A chave pede o tipo — é ele que
 * deixa a PP de verba do freela levar o PIX do cadastro automaticamente
 * (decisão 193) — e a conta ganha o tipo de conta. O "tipo de pagamento"
 * gravado passa a sair do que foi preenchido (`tipoDePagamentoPreenchido`).
 */

import * as React from "react";
import { Landmark, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaskedInput } from "@/components/ui/masked-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PIX_TIPOS, chavePixParaExibir } from "@/lib/pix";
import type { PixTipoChave } from "@/lib/types";

type FieldErrors = Record<string, string[] | undefined>;

const PLACEHOLDER_CHAVE: Record<PixTipoChave, string> = {
  cnpj: "00.000.000/0000-00",
  cpf: "000.000.000-00",
  email: "chave@exemplo.com.br",
  telefone: "(11) 99999-9999",
  aleatoria: "Cole a chave aleatória",
};

/** O "tipo de pagamento" que vai para o banco: a conta, quando algum campo
 *  dela foi preenchido (a validação cobra o resto); senão o PIX. */
export function tipoDePagamentoPreenchido(state: Record<string, string>): string {
  if ((state.banco ?? "").trim() || (state.agencia ?? "").trim() || (state.conta ?? "").trim()) {
    return "conta_bancaria";
  }
  return (state.pix_chave ?? "").trim() ? "pix" : "";
}

function Campo({
  rotulo,
  erro,
  children,
  className,
}: {
  rotulo: string;
  erro?: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-semibold text-foreground">{rotulo}</Label>
      {children}
      {erro && erro.length > 0 && <p className="text-xs text-california-red font-medium">{erro[0]}</p>}
    </div>
  );
}

/** Um bloco do pagamento, com o selo "preenchido" — o desenho do
 *  fornecedor (decisão 161). */
function Bloco({
  Icone,
  rotulo,
  completo,
  children,
}: {
  Icone: typeof Landmark;
  rotulo: string;
  completo: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Icone className="h-[15px] w-[15px] flex-none text-muted-foreground" />
        <span className="text-[13.5px] font-semibold">{rotulo}</span>
        {completo && (
          <span className="ml-auto inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-emerald-700">
            preenchido
          </span>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function PagamentoDoFreelancer({
  state,
  set,
  fieldErrors,
  pending,
  avisarChaveSemTipo,
}: {
  state: Record<string, string>;
  set: (key: string, value: string) => void;
  fieldErrors: FieldErrors;
  pending: boolean;
  /** No editar: a chave do cadastro antigo veio sem o tipo. */
  avisarChaveSemTipo: boolean;
}) {
  const pixTipo = (state.pix_tipo ?? "") as PixTipoChave | "";
  const chave = state.pix_chave ?? "";
  const chaveSemTipo = avisarChaveSemTipo && !!chave.trim() && !pixTipo;
  const pixCompleto = !!pixTipo && !!chave.trim();
  const contaCompleta =
    !!(state.banco ?? "").trim() && !!(state.agencia ?? "").trim() && !!(state.conta ?? "").trim() && !!state.tipo_conta;

  return (
    <div className="flex flex-col gap-3">
      <Bloco Icone={Zap} rotulo="Chave PIX" completo={pixCompleto}>
        <div className="grid grid-cols-12 gap-4">
          <Campo rotulo="Tipo de chave" erro={fieldErrors.pix_tipo} className="col-span-12 sm:col-span-4">
            <Select
              value={pixTipo || undefined}
              disabled={pending}
              onValueChange={(v) => {
                // A chave que veio sem o tipo fica; trocar de um tipo para
                // outro começa a chave de novo.
                if (pixTipo) set("pix_chave", "");
                set("pix_tipo", v);
              }}
            >
              <SelectTrigger
                aria-label="Tipo de chave PIX"
                className={cn(fieldErrors.pix_tipo ? "border-california-red" : chaveSemTipo && "border-amber-400")}
              >
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {PIX_TIPOS.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Chave PIX" erro={fieldErrors.pix_chave} className="col-span-12 sm:col-span-8">
            {pixTipo === "cpf" || pixTipo === "cnpj" || pixTipo === "telefone" ? (
              <MaskedInput
                key={pixTipo}
                mask={pixTipo}
                aria-label="Chave PIX"
                defaultValue={chavePixParaExibir(pixTipo, chave)}
                onDigitsChange={(d) => set("pix_chave", d)}
                disabled={pending}
                placeholder={PLACEHOLDER_CHAVE[pixTipo]}
                className={cn(fieldErrors.pix_chave && "border-california-red")}
              />
            ) : (
              <Input
                key={pixTipo || "sem-tipo"}
                aria-label="Chave PIX"
                value={chave}
                onChange={(e) => set("pix_chave", e.target.value)}
                disabled={pending}
                spellCheck={false}
                placeholder={pixTipo ? PLACEHOLDER_CHAVE[pixTipo] : "Escolha o tipo antes"}
                className={cn(fieldErrors.pix_chave && "border-california-red", pixTipo === "aleatoria" && "font-mono")}
              />
            )}
          </Campo>
        </div>
        {chaveSemTipo && !fieldErrors.pix_tipo && (
          <p className="mt-2 text-xs text-amber-700">O cadastro não diz o tipo desta chave. Escolha o tipo.</p>
        )}
      </Bloco>

      <Bloco Icone={Landmark} rotulo="Conta bancária" completo={contaCompleta}>
        <div className="grid grid-cols-12 gap-4">
          <Campo rotulo="Banco" erro={fieldErrors.banco} className="col-span-12">
            <Input
              value={state.banco ?? ""}
              onChange={(e) => set("banco", e.target.value)}
              placeholder="Nome do banco"
              disabled={pending}
            />
          </Campo>
          <Campo rotulo="Agência" erro={fieldErrors.agencia} className="col-span-6 sm:col-span-4">
            <Input value={state.agencia ?? ""} onChange={(e) => set("agencia", e.target.value)} disabled={pending} />
          </Campo>
          <Campo rotulo="Conta" erro={fieldErrors.conta} className="col-span-6 sm:col-span-4">
            <Input value={state.conta ?? ""} onChange={(e) => set("conta", e.target.value)} disabled={pending} />
          </Campo>
          <Campo rotulo="Tipo de conta" erro={fieldErrors.tipo_conta} className="col-span-12 sm:col-span-4">
            <Select value={state.tipo_conta || undefined} onValueChange={(v) => set("tipo_conta", v)} disabled={pending}>
              <SelectTrigger aria-label="Tipo de conta">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corrente">Conta corrente</SelectItem>
                <SelectItem value="poupanca">Conta poupança</SelectItem>
                <SelectItem value="pagamento">Conta de pagamento</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        </div>
      </Bloco>
    </div>
  );
}
