"use client";

/** Cadastro de fornecedor de dentro de outro formulário.
 *
 *  Nasceu para o "+" ao lado do combo de fornecedor da PP (04/09/2026,
 *  decisão 048): quem está gerando a PP cadastra o fornecedor ali mesmo
 *  e volta com ele já selecionado. Desde 09/09/2026 ele também **edita**
 *  o cadastro do fornecedor já escolhido — é o lápis que substitui o "+"
 *  quando o campo tem alguém (desenho "PP - Campo Fornecedor").
 *
 *  É o MESMO `FornecedorForm` da página, no modo `dialog`. O que o dialog
 *  assume do formulário é só o cabeçalho: título, nota e o **tipo de
 *  pessoa**, que no desenho "Fornecedores - Novo Cadastro na PP" mora ao
 *  lado do título em vez de uma linha própria — ali o espaço é do dialog.
 *
 *  Dialog centrado, e não drawer: quem o abre já é um drawer à direita
 *  (o da PP), e dois drawers brigariam pelo mesmo lado. O drawer de trás
 *  continua montado, com o que a pessoa já digitou.
 */

import * as React from "react";
import { Building2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Fornecedor, TipoPessoa } from "@/lib/types";
import { FornecedorForm } from "./fornecedor-form";
import type { FornecedorResumo } from "./actions";

/** De onde o dialog foi aberto. Só muda as palavras — o formulário e as
 *  regras são os mesmos. A PP é o padrão porque foi dela que o dialog
 *  nasceu (decisão 048); o BV entrou em 09/09/2026 (decisão 067), e as
 *  demais telas com campo de fornecedor entram depois. */
export type ContextoCadastro = "pp" | "bv";

const CONTEXTO: Record<
  ContextoCadastro,
  { em: string; para: string; oQueFicouAtras: string }
> = {
  pp: { em: "na PP", para: "para a PP", oQueFicouAtras: "no pedido" },
  bv: { em: "no BV", para: "para o BV", oQueFicouAtras: "no BV" },
};

export function NovoFornecedorDialog({
  open,
  onOpenChange,
  onCriado,
  onSelecionarExistente,
  fornecedor,
  onSalvo,
  nomeInicial,
  contexto = "pp",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCriado: (fornecedor: FornecedorResumo) => void;
  onSelecionarExistente: (fornecedor: FornecedorResumo) => void;
  /** Preenchido = EDIÇÃO do cadastro deste fornecedor (o lápis do campo).
   *  Ausente = cadastro novo. */
  fornecedor?: Fornecedor;
  /** Só na edição: o cadastro foi salvo. Quem abriu decide o que fazer
   *  (a PP mantém o fornecedor escolhido e recarrega a lista). */
  onSalvo?: () => void;
  /** Nome já preenchido — vem do "Cadastrar «…»" da busca. */
  nomeInicial?: string;
  /** Qual formulário ficou atrás — só o texto do cabeçalho muda. */
  contexto?: ContextoCadastro;
}) {
  const editando = Boolean(fornecedor);
  const onde = CONTEXTO[contexto];

  /** O tipo de pessoa sobe para cá porque o toggle mora no cabeçalho. */
  const [tipoPessoa, setTipoPessoa] = React.useState<TipoPessoa>(
    fornecedor?.tipo_pessoa ?? "juridica",
  );
  React.useEffect(() => {
    if (open) setTipoPessoa(fornecedor?.tipo_pessoa ?? "juridica");
  }, [open, fornecedor?.tipo_pessoa]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-64px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="flex-none flex-row items-start gap-4 space-y-0 border-b border-border px-6 pb-[18px] pt-6">
          <span className="mt-0.5 hidden flex-none text-california-red sm:block">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle>
              {editando ? "Editar cadastro do fornecedor" : "Novo fornecedor"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12.5px] leading-snug">
              {editando
                ? `Salvar volta ${onde.para} com este fornecedor ainda escolhido. O que você digitou ${onde.oQueFicouAtras} continua lá.`
                : `Ao criar, ele já fica selecionado ${onde.em}. O que você digitou ${onde.oQueFicouAtras} continua lá.`}
            </DialogDescription>
          </div>

          {/* O tipo de pessoa manda nos rótulos do formulário inteiro
              (Nome fantasia/Nome, CNPJ/CPF) — por isso fica aqui em cima,
              onde se lê antes de começar a preencher. */}
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
                    tipoPessoa === tp
                      ? "bg-california-red text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tp === "juridica" ? "PJ" : "PF"}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        {/* Remonta a cada abertura: o formulário é não controlado e
            guardaria o que foi digitado da vez anterior. */}
        {open && (
          <FornecedorForm
            key={fornecedor?.id ?? `novo:${nomeInicial ?? ""}`}
            fornecedor={fornecedor}
            nomeInicial={nomeInicial}
            modo="dialog"
            tipoPessoa={tipoPessoa}
            onTipoPessoaChange={setTipoPessoa}
            onCancelar={() => onOpenChange(false)}
            onCriado={(f) => {
              onCriado(f);
              onOpenChange(false);
            }}
            onSelecionarExistente={(f) => {
              onSelecionarExistente(f);
              onOpenChange(false);
            }}
            onSalvo={() => {
              onSalvo?.();
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
