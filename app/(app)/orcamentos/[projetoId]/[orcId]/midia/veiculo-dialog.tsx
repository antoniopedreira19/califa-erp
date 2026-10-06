"use client";

/**
 * O cadastro do veículo (decisão 147, Tiago em 05 e 06/10/2026): o MESMO
 * formulário do fornecedor — o veículo é um fornecedor marcado como veículo
 * —, com os dados de pagamento opcionais (passam a ser exigidos só para
 * gerar a PP do repasse, nas linhas A · Repasse). É a versão do pop-up
 * "Novo fornecedor" da PP, com o formulário real (`FornecedorForm`, modo
 * "dialog", variante "veiculo") e, em cima, o que é só do veículo: os meios
 * que ele vende (o primeiro é o principal) e a praça.
 */

import * as React from "react";
import { AlertCircle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { FornecedorForm } from "@/app/(app)/fornecedores/fornecedor-form";
import { carregarFornecedor, type FornecedorResumo } from "@/app/(app)/fornecedores/actions";
import type { Fornecedor, TipoPessoa } from "@/lib/types";
import { MEIOS } from "@/lib/midia/meios";
import type { VeiculoDaLista } from "./secoes";

export function VeiculoDialog({
  open,
  onOpenChange,
  veiculo,
  nomeInicial,
  meioInicial,
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
  /** O meio da linha de onde o cadastro foi aberto. */
  meioInicial?: string;
  onCriado: (f: FornecedorResumo, meios: string[], praca: string) => void;
  /** O documento já era de um fornecedor: escolhê-lo como veículo. */
  onSelecionarExistente: (f: FornecedorResumo, meios: string[], praca: string) => void;
  onSalvo: (meios: string[], praca: string) => void;
}) {
  const editando = Boolean(veiculo);
  const [tipoPessoa, setTipoPessoa] = React.useState<TipoPessoa>("juridica");
  const [praca, setPraca] = React.useState("");
  const [meios, setMeios] = React.useState<string[]>([]);
  const [fornecedor, setFornecedor] = React.useState<Fornecedor | null>(null);
  const [erroAoCarregar, setErroAoCarregar] = React.useState<string | null>(null);
  // O formulário lê meios e praça na hora de gravar — o estado mais novo.
  const dados = React.useRef({ meios, praca });
  dados.current = { meios, praca };

  React.useEffect(() => {
    if (!open) return;
    setPraca(veiculo?.praca ?? "");
    setMeios(veiculo ? veiculo.meios : meioInicial ? [meioInicial] : []);
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
  }, [open, veiculo, meioInicial]);

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

        {/* O que é só do veículo. */}
        <div className="flex flex-none flex-col gap-3.5 border-b border-border px-6 py-[22px]">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h3 className="text-[13.5px] font-bold tracking-tight">Veículo de mídia</h3>
            <span className="inline-block flex-none rounded-full bg-california-red/[0.08] px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider text-[#c2404a]">
              Obrigatório
            </span>
            <span className="min-w-[160px] flex-1 text-right text-[11.5px] leading-snug text-muted-foreground">
              Na planilha, a lista de cada linha mostra primeiro os veículos do meio dela.
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="veiculo-meios" className="text-[12.5px] font-semibold">
                  Meios<span className="ml-1 text-california-red">*</span>
                </Label>
                <span className="text-[11px] text-muted-foreground">O primeiro é o principal</span>
              </div>
              <MultiSelect
                id="veiculo-meios"
                items={MEIOS.map((m) => ({ value: m.nome, label: m.nome }))}
                value={meios}
                onChange={setMeios}
                placeholder="Escolha um ou mais meios"
                className="min-h-11 rounded-lg bg-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="veiculo-praca" className="text-[12.5px] font-semibold">
                  Praça
                </Label>
                <span className="text-[11px] text-muted-foreground">Opcional</span>
              </div>
              <input
                id="veiculo-praca"
                value={praca}
                onChange={(e) => setPraca(e.target.value)}
                maxLength={120}
                placeholder="Nacional, Belém/PA…"
                className="flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:border-california-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/15"
              />
            </div>
          </div>
        </div>

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
            dadosDoVeiculo={() => dados.current}
            tipoPessoa={tipoPessoa}
            onTipoPessoaChange={setTipoPessoa}
            onCancelar={() => onOpenChange(false)}
            onCriado={(f) => onCriado(f, dados.current.meios, dados.current.praca)}
            onSelecionarExistente={(f) => onSelecionarExistente(f, dados.current.meios, dados.current.praca)}
            onSalvo={() => onSalvo(dados.current.meios, dados.current.praca)}
          />
        )}
        {open && !pronto && !erroAoCarregar && (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">Carregando o cadastro…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
