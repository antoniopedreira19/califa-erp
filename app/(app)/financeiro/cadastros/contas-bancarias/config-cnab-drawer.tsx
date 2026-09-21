"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Landmark } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarConfigCnabContaBancaria } from "./actions";
import type { ContaBancaria } from "@/lib/types";

interface Props {
  conta: ContaBancaria;
  open: boolean;
  onClose: () => void;
}

export function ConfigCnabDrawer({ conta, open, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res = await salvarConfigCnabContaBancaria(conta.id, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-california-red" />
            Configuração CNAB Santander
          </DialogTitle>
          <DialogDescription>
            {conta.nome} — dados do convênio Santander desta conta pra
            geração de arquivo de remessa. Preencha depois de contratar e
            homologar o convênio com o gerente da conta.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="convenio_cnab_santander">
                Código do convênio
              </Label>
              <Input
                id="convenio_cnab_santander"
                name="convenio_cnab_santander"
                maxLength={20}
                placeholder="Fornecido pelo gerente Santander"
                defaultValue={conta.convenio_cnab_santander ?? ""}
              />
              {fieldErrors.convenio_cnab_santander?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Agência</Label>
                <div className="flex gap-2">
                  <Input
                    name="agencia"
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="0000"
                    defaultValue={conta.agencia ?? ""}
                    className="flex-1"
                  />
                  <Input
                    name="agencia_dv"
                    maxLength={1}
                    placeholder="0"
                    aria-label="DV agência"
                    defaultValue={conta.agencia_dv ?? ""}
                    className="w-14 text-center"
                  />
                </div>
                {fieldErrors.agencia?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>
              <div className="space-y-2">
                <Label>Conta corrente</Label>
                <div className="flex gap-2">
                  <Input
                    name="numero_conta"
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="00000000"
                    defaultValue={conta.numero_conta ?? ""}
                    className="flex-1"
                  />
                  <Input
                    name="numero_conta_dv"
                    maxLength={1}
                    placeholder="0"
                    aria-label="DV conta"
                    defaultValue={conta.numero_conta_dv ?? ""}
                    className="w-14 text-center"
                  />
                </div>
                {fieldErrors.numero_conta?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sequencial_arquivo">
                Sequencial do próximo arquivo{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (comece em 11)
                </span>
              </Label>
              <Input
                id="sequencial_arquivo"
                name="sequencial_arquivo"
                inputMode="numeric"
                maxLength={6}
                placeholder="11"
                defaultValue={
                  conta.sequencial_arquivo !== null
                    ? String(conta.sequencial_arquivo)
                    : ""
                }
              />
              <p className="text-xs text-muted-foreground">
                Sequenciais de 1 a 10 são tratados como teste pelo banco (Nota
                G010 do manual CNAB). Não use.
              </p>
              {fieldErrors.sequencial_arquivo?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
            >
              {pending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
