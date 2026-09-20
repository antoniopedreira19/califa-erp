"use client";

/** Cadastro de cliente de dentro de outro formulário.
 *
 *  Nasceu para o "+" ao lado do campo Cliente do projeto (17/09/2026,
 *  decisão 089), no mesmo molde do `NovoFornecedorDialog` da PP: o mesmo
 *  `ClienteForm` da página, no modo `dialog`. O que o dialog assume do
 *  formulário é só o cabeçalho — título e a linha que explica o que
 *  acontece ao salvar.
 *
 *  Dialog centrado, e não drawer: quem o abre pode já ser um drawer (a
 *  edição do projeto), e dois drawers brigariam pelo mesmo lado. O
 *  formulário de trás continua montado, com o que a pessoa já digitou.
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
import type { Cliente, ClienteProduto, ClientePortal } from "@/lib/types";
import { ClienteForm } from "./cliente-form";

export function NovoClienteDialog({
  open,
  onOpenChange,
  onCriado,
  onSalvo,
  cliente,
  marcas,
  portais,
  nomeInicial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Criação: o cliente gravado, para ficar escolhido no campo. */
  onCriado: (cliente: { id: string; nome_fantasia: string }) => void;
  /** Edição: o cadastro foi salvo. A escolha do campo não muda. */
  onSalvo?: () => void;
  /** Preenchido = EDIÇÃO do cadastro deste cliente (o lápis do campo).
   *  Ausente = cadastro novo. */
  cliente?: Cliente;
  marcas?: ClienteProduto[];
  portais?: ClientePortal[];
  /** Nome já preenchido — vem do "Cadastrar «…»" da busca. */
  nomeInicial?: string;
}) {
  const editando = Boolean(cliente);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-64px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="flex-none flex-row items-start gap-4 space-y-0 border-b border-border px-6 pb-[18px] pt-6">
          <span className="mt-0.5 hidden flex-none text-california-red sm:block">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle>
              {editando ? "Editar cadastro do cliente" : "Novo cliente"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12.5px] leading-snug">
              {editando
                ? "Salvar volta para o projeto com este cliente ainda escolhido. O que você digitou no projeto continua lá."
                : "Ao criar, ele já fica selecionado no projeto — com a marca pronta para escolher. O que você digitou no projeto continua lá."}
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* `key` remonta o formulário a cada abertura: ele guarda o estado
            todo em `useState` de inicialização, então reabrir sem remontar
            traria o cliente anterior. */}
        <ClienteForm
          key={`${cliente?.id ?? "novo"}-${nomeInicial ?? ""}`}
          modo="dialog"
          cliente={cliente}
          marcas={marcas}
          portais={portais}
          nomeInicial={nomeInicial}
          onCriado={onCriado}
          onSalvo={onSalvo}
          onCancelar={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
