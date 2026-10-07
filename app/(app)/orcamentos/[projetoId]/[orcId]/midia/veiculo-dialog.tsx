"use client";

/**
 * O cadastro rápido do veículo, aberto pela célula Veículo da planilha de
 * Mídia Off (decisões 147 e 150). É o MESMO formulário do fornecedor — o
 * veículo é um fornecedor marcado como veículo —, no pop-up "Novo
 * fornecedor" da PP (`FornecedorForm`, modo "dialog", variante "veiculo"),
 * com os dados de pagamento opcionais (passam a ser exigidos só para gerar
 * a PP do repasse, nas linhas A · Repasse).
 *
 * Desde a decisão 150 (Tiago, 07/10/2026) não há meio nem praça no
 * cadastro: os meios do veículo vêm das linhas em que ele é escolhido, e a
 * praça fica na linha. O pop-up também não mostra a nota do regime
 * tributário (as retenções são da aprovação da PP).
 */

import * as React from "react";
import { AlertCircle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FornecedorForm } from "@/app/(app)/fornecedores/fornecedor-form";
import { carregarFornecedor, type FornecedorResumo } from "@/app/(app)/fornecedores/actions";
import type { Fornecedor, TipoPessoa } from "@/lib/types";
import type { VeiculoDaLista } from "./secoes";

export function VeiculoDialog({
  open,
  onOpenChange,
  veiculo,
  nomeInicial,
  onCriado,
  onSelecionarExistente,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Presente: edição do veículo escolhido na linha. */
  veiculo?: VeiculoDaLista;
  /** Vem do "Cadastrar «…» como novo veículo" da busca. */
  nomeInicial?: string;
  onCriado: (f: FornecedorResumo) => void;
  /** O documento já era de um fornecedor: escolhê-lo como veículo. */
  onSelecionarExistente: (f: FornecedorResumo) => void;
  onSalvo: () => void;
}) {
  const editando = Boolean(veiculo);
  const [tipoPessoa, setTipoPessoa] = React.useState<TipoPessoa>("juridica");
  const [fornecedor, setFornecedor] = React.useState<Fornecedor | null>(null);
  const [erroAoCarregar, setErroAoCarregar] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFornecedor(null);
    setErroAoCarregar(null);
    setTipoPessoa("juridica");
    if (!veiculo) return;
    let vivo = true;
    carregarFornecedor(veiculo.id).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setFornecedor(r.fornecedor);
        setTipoPessoa(r.fornecedor.tipo_pessoa);
      } else {
        setErroAoCarregar(r.message);
      }
    });
    return () => {
      vivo = false;
    };
  }, [open, veiculo]);

  const pronto = !editando || fornecedor !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-64px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="flex-none flex-row items-start gap-4 space-y-0 border-b border-border px-6 pb-[18px] pt-6">
          <span className="mt-0.5 hidden flex-none text-california-red sm:block">
            <Radio className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle>{editando ? "Editar cadastro do veículo" : "Novo veículo"}</DialogTitle>
            <DialogDescription className="mt-1 text-[12.5px] leading-snug">
              {editando
                ? "Salvar volta para a planilha com este veículo ainda escolhido na linha."
                : "Ao criar, ele já fica escolhido na linha. O que você digitou na planilha continua lá."}
            </DialogDescription>
          </div>
          <div className="flex-none">
            <div className="inline-flex gap-[3px] rounded-[10px] border border-border bg-muted/40 p-[3px]">
              {(["juridica", "fisica"] as const).map((tp) => (
                <button
                  type="button"
                  key={tp}
                  onClick={() => setTipoPessoa(tp)}
                  aria-pressed={tipoPessoa === tp}
                  title={tp === "juridica" ? "Pessoa Jurídica" : "Pessoa Física"}
                  className={cn(
                    "rounded-lg px-3.5 py-[7px] text-[12.5px] font-bold tracking-wide transition-colors",
                    tipoPessoa === tp ? "bg-california-red text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tp === "juridica" ? "PJ" : "PF"}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        {erroAoCarregar && (
          <div className="m-6 flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erroAoCarregar}</span>
          </div>
        )}
        {open && pronto && !erroAoCarregar && (
          <FornecedorForm
            key={veiculo?.id ?? `novo:${nomeInicial ?? ""}`}
            fornecedor={fornecedor ?? undefined}
            nomeInicial={nomeInicial}
            modo="dialog"
            variante="veiculo"
            tipoPessoa={tipoPessoa}
            onTipoPessoaChange={setTipoPessoa}
            onCancelar={() => onOpenChange(false)}
            onCriado={onCriado}
            onSelecionarExistente={onSelecionarExistente}
            onSalvo={onSalvo}
          />
        )}
        {open && !pronto && !erroAoCarregar && (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">Carregando o cadastro…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
