"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Landmark, Pencil, Zap } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Colaborador } from "@/lib/types";
import { salvarDadosBancariosColaborador } from "../actions";

const NONE_SENTINEL = "__none__";

type Props = {
  colaborador: Colaborador;
};

export function CardDadosBancarios({ colaborador }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Landmark className="h-4 w-4 text-california-red" />
          </div>
          <h2 className="text-lg font-semibold">Dados bancários</h2>
        </div>
        <EditarDadosBancariosDrawer colaborador={colaborador} />
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Conta bancária
          </p>
          {colaborador.banco_codigo && colaborador.agencia && colaborador.conta ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {colaborador.banco_codigo}
                {colaborador.banco_nome ? ` — ${colaborador.banco_nome}` : ""}
              </p>
              <p className="text-muted-foreground">
                Ag. {colaborador.agencia}
                {colaborador.agencia_dv ? `-${colaborador.agencia_dv}` : ""}
                {" · "}
                Cc. {colaborador.conta}
                {colaborador.conta_dv ? `-${colaborador.conta_dv}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {colaborador.tipo_conta === "corrente"
                  ? "Conta corrente"
                  : colaborador.tipo_conta === "poupanca"
                    ? "Conta poupança"
                    : colaborador.tipo_conta === "pagamento"
                      ? "Conta de pagamento"
                      : "—"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem conta bancária cadastrada.
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Chave PIX
          </p>
          {colaborador.pix_chave ? (
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-1.5 font-medium">
                <Zap className="h-3.5 w-3.5 text-california-red" />
                {tipoChaveLabel(colaborador.pix_tipo)}
              </p>
              <p className="break-all text-muted-foreground">
                {colaborador.pix_chave}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem chave PIX cadastrada.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** As mensagens da validação do servidor embaixo do campo a que se referem. */
function ErrosDoCampo({
  erros,
  campos,
}: {
  erros: Record<string, string[]>;
  campos: string[];
}) {
  const mensagens = campos.flatMap((c) => erros[c] ?? []);
  if (mensagens.length === 0) return null;
  return (
    <>
      {mensagens.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </>
  );
}

function tipoChaveLabel(tipo: string | null): string {
  switch (tipo) {
    case "cpf":
      return "CPF";
    case "cnpj":
      return "CNPJ";
    case "email":
      return "E-mail";
    case "telefone":
      return "Telefone";
    case "aleatoria":
      return "Aleatória";
    default:
      return "—";
  }
}

function EditarDadosBancariosDrawer({ colaborador }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [tipoConta, setTipoConta] = React.useState<string>(
    colaborador.tipo_conta ?? NONE_SENTINEL,
  );
  const [pixTipo, setPixTipo] = React.useState<string>(
    colaborador.pix_tipo ?? NONE_SENTINEL,
  );

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
      setTipoConta(colaborador.tipo_conta ?? NONE_SENTINEL);
      setPixTipo(colaborador.pix_tipo ?? NONE_SENTINEL);
    }
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    if (tipoConta === NONE_SENTINEL) formData.delete("tipo_conta");
    else formData.set("tipo_conta", tipoConta);
    if (pixTipo === NONE_SENTINEL) formData.delete("pix_tipo");
    else formData.set("pix_tipo", pixTipo);

    startTransition(async () => {
      const res = await salvarDadosBancariosColaborador(colaborador.id, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
      </DialogTrigger>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Dados bancários</DialogTitle>
          <DialogDescription>
            Conta ou PIX — pelo menos um dos dois é necessário para pagamento
            por remessa CNAB. Preencha ambos sempre que possível.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Conta bancária
              </h3>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="banco_codigo">Código do banco</Label>
                  <Input
                    id="banco_codigo"
                    name="banco_codigo"
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="033"
                    defaultValue={colaborador.banco_codigo ?? ""}
                  />
                  {fieldErrors.banco_codigo?.map((msg, i) => (
                    <p key={i} className="text-xs text-california-red">
                      {msg}
                    </p>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="banco_nome">Nome do banco</Label>
                  <Input
                    id="banco_nome"
                    name="banco_nome"
                    maxLength={200}
                    placeholder="Ex.: Santander"
                    defaultValue={colaborador.banco_nome ?? ""}
                  />
                </div>
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
                      defaultValue={colaborador.agencia ?? ""}
                      className="flex-1"
                    />
                    <Input
                      name="agencia_dv"
                      maxLength={1}
                      placeholder="0"
                      aria-label="Dígito da agência"
                      defaultValue={colaborador.agencia_dv ?? ""}
                      className="w-14 text-center"
                    />
                  </div>
                  <ErrosDoCampo erros={fieldErrors} campos={["agencia", "agencia_dv"]} />
                </div>
                <div className="space-y-2">
                  <Label>Conta</Label>
                  <div className="flex gap-2">
                    <Input
                      name="conta"
                      inputMode="numeric"
                      maxLength={12}
                      placeholder="00000000"
                      defaultValue={colaborador.conta ?? ""}
                      className="flex-1"
                    />
                    <Input
                      name="conta_dv"
                      maxLength={1}
                      placeholder="0"
                      aria-label="Dígito da conta"
                      defaultValue={colaborador.conta_dv ?? ""}
                      className="w-14 text-center"
                    />
                  </div>
                  <ErrosDoCampo erros={fieldErrors} campos={["conta", "conta_dv"]} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tipo_conta">Tipo de conta</Label>
                <Select value={tipoConta} onValueChange={setTipoConta}>
                  <SelectTrigger id="tipo_conta">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_SENTINEL}>Não informado</SelectItem>
                    <SelectItem value="corrente">Conta corrente</SelectItem>
                    <SelectItem value="poupanca">Conta poupança</SelectItem>
                    <SelectItem value="pagamento">Conta de pagamento</SelectItem>
                  </SelectContent>
                </Select>
                <ErrosDoCampo erros={fieldErrors} campos={["tipo_conta"]} />
              </div>
            </section>

            <div className="h-px bg-border" />

            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Chave PIX
              </h3>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pix_tipo">Tipo de chave</Label>
                  <Select value={pixTipo} onValueChange={setPixTipo}>
                    <SelectTrigger id="pix_tipo">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_SENTINEL}>Não informado</SelectItem>
                      <SelectItem value="cpf">CPF</SelectItem>
                      <SelectItem value="cnpj">CNPJ</SelectItem>
                      <SelectItem value="email">E-mail</SelectItem>
                      <SelectItem value="telefone">Telefone</SelectItem>
                      <SelectItem value="aleatoria">Aleatória</SelectItem>
                    </SelectContent>
                  </Select>
                  <ErrosDoCampo erros={fieldErrors} campos={["pix_tipo"]} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pix_chave">Chave</Label>
                  <Input
                    id="pix_chave"
                    name="pix_chave"
                    maxLength={200}
                    placeholder="chave PIX"
                    defaultValue={colaborador.pix_chave ?? ""}
                  />
                  {fieldErrors.pix_chave?.map((msg, i) => (
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
              onClick={() => handleOpenChange(false)}
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
