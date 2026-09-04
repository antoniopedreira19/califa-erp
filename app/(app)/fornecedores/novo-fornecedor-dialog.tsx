"use client";

/** Cadastro rápido de fornecedor, de dentro de outro formulário.
 *
 *  Nasceu para o "+" ao lado do combo de fornecedor da PP (04/09/2026,
 *  decisão 048): quem está gerando a PP cadastra o fornecedor ali mesmo
 *  e volta com ele já selecionado. É o MESMO formulário da página de
 *  cadastro, no modo `dialog` — documento, e-mail e telefone obrigatórios,
 *  e o "Criar e selecionar" devolve o registro em vez de redirecionar.
 *
 *  Dialog centrado, e não drawer: quem o abre já é um drawer à direita
 *  (o da PP), e dois drawers brigariam pelo mesmo lado. O drawer de trás
 *  continua montado, com o que a pessoa já digitou.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FornecedorForm } from "./fornecedor-form";
import type { FornecedorResumo } from "./actions";

export function NovoFornecedorDialog({
  open,
  onOpenChange,
  onCriado,
  onSelecionarExistente,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCriado: (fornecedor: FornecedorResumo) => void;
  onSelecionarExistente: (fornecedor: FornecedorResumo) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Novo fornecedor</DialogTitle>
          <DialogDescription>
            Cadastro completo, sem sair da PP. Ao criar, o fornecedor já
            fica selecionado no formulário.
          </DialogDescription>
        </DialogHeader>
        {/* Remonta a cada abertura: o formulário é não controlado e
            guardaria o que foi digitado da vez anterior. */}
        {open && (
          <FornecedorForm
            modo="dialog"
            onCancelar={() => onOpenChange(false)}
            onCriado={(f) => {
              onCriado(f);
              onOpenChange(false);
            }}
            onSelecionarExistente={(f) => {
              onSelecionarExistente(f);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
