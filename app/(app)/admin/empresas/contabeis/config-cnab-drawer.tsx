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
import { salvarConfigCnabEmpresaContabil } from "./actions";
import type { EmpresaContabilRow } from "./types";

interface Props {
  empresa: EmpresaContabilRow;
  open: boolean;
  onClose: () => void;
}

export function ConfigCnabDrawer({ empresa, open, onClose }: Props) {
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
      const res = await salvarConfigCnabEmpresaContabil(empresa.id, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  const nomeExibicao = empresa.nome_fantasia ?? empresa.razao_social;

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
            {nomeExibicao} — dados do convênio Santander pra geração de arquivo
            de remessa. Preencha depois de contratar e homologar o convênio com
            o gerente da conta.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Convênio e conta de débito
              </h3>

              <div className="space-y-2">
                <Label htmlFor="convenio_cnab_santander">
                  Código do convênio
                </Label>
                <Input
                  id="convenio_cnab_santander"
                  name="convenio_cnab_santander"
                  maxLength={20}
                  placeholder="Fornecido pelo gerente Santander"
                  defaultValue={empresa.convenio_cnab_santander ?? ""}
                />
                {fieldErrors.convenio_cnab_santander?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Agência do débito</Label>
                  <div className="flex gap-2">
                    <Input
                      name="agencia_debito"
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="0000"
                      defaultValue={empresa.agencia_debito ?? ""}
                      className="flex-1"
                    />
                    <Input
                      name="agencia_debito_dv"
                      maxLength={1}
                      placeholder="0"
                      aria-label="DV agência"
                      defaultValue={empresa.agencia_debito_dv ?? ""}
                      className="w-14 text-center"
                    />
                  </div>
                  {fieldErrors.agencia_debito?.map((msg, i) => (
                    <p key={i} className="text-xs text-california-red">
                      {msg}
                    </p>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label>Conta corrente</Label>
                  <div className="flex gap-2">
                    <Input
                      name="conta_debito"
                      inputMode="numeric"
                      maxLength={12}
                      placeholder="00000000"
                      defaultValue={empresa.conta_debito ?? ""}
                      className="flex-1"
                    />
                    <Input
                      name="conta_debito_dv"
                      maxLength={1}
                      placeholder="0"
                      aria-label="DV conta"
                      defaultValue={empresa.conta_debito_dv ?? ""}
                      className="w-14 text-center"
                    />
                  </div>
                  {fieldErrors.conta_debito?.map((msg, i) => (
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
                    empresa.sequencial_arquivo !== null
                      ? String(empresa.sequencial_arquivo)
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
            </section>

            <div className="h-px bg-border" />

            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Endereço da PJ contábil
              </h3>
              <p className="text-xs text-muted-foreground">
                Vai no header do arquivo. Opcional pelo layout Santander, mas
                alguns bancos exigem em homologação.
              </p>

              <div className="space-y-2">
                <Label htmlFor="endereco_logradouro">Logradouro</Label>
                <Input
                  id="endereco_logradouro"
                  name="endereco_logradouro"
                  maxLength={200}
                  placeholder="Rua, número, complemento"
                  defaultValue={empresa.endereco_logradouro ?? ""}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_140px_80px]">
                <div className="space-y-2">
                  <Label htmlFor="endereco_cidade">Cidade</Label>
                  <Input
                    id="endereco_cidade"
                    name="endereco_cidade"
                    maxLength={100}
                    defaultValue={empresa.endereco_cidade ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endereco_cep">CEP</Label>
                  <Input
                    id="endereco_cep"
                    name="endereco_cep"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="00000000"
                    defaultValue={empresa.endereco_cep ?? ""}
                  />
                  {fieldErrors.endereco_cep?.map((msg, i) => (
                    <p key={i} className="text-xs text-california-red">
                      {msg}
                    </p>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endereco_uf">UF</Label>
                  <Input
                    id="endereco_uf"
                    name="endereco_uf"
                    maxLength={2}
                    placeholder="SP"
                    defaultValue={empresa.endereco_uf ?? ""}
                    className="uppercase"
                  />
                  {fieldErrors.endereco_uf?.map((msg, i) => (
                    <p key={i} className="text-xs text-california-red">
                      {msg}
                    </p>
                  ))}
                </div>
              </div>
            </section>

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
