"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus } from "lucide-react";
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
import { DatePicker } from "@/components/ui/date-picker";
import { criarContaBancaria, editarContaBancaria } from "./actions";
import type { ContaBancaria, Empresa } from "@/lib/types";

type EmpresaResumida = Pick<Empresa, "id" | "razao_social" | "nome_fantasia">;

type ContaBancariaComEmpresa = ContaBancaria & {
  empresas: {
    razao_social: string;
    nome_fantasia: string | null;
  };
};

type Props =
  | {
      mode: "criar";
      empresas: EmpresaResumida[];
      trigger?: React.ReactNode;
    }
  | {
      mode: "editar";
      conta: ContaBancariaComEmpresa;
      empresas: EmpresaResumida[];
      hasLancamentos?: boolean;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

export function ContaBancariaDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // Estado controlado para os selects (precisam de valor explícito)
  const isEditar = props.mode === "editar";
  const conta = isEditar ? props.conta : undefined;
  const hasLancamentos = isEditar ? (props as any).hasLancamentos ?? false : false;

  const [empresaId, setEmpresaId] = React.useState<string>(
    conta?.empresa_id ?? ""
  );
  const [tipo, setTipo] = React.useState<string>(conta?.tipo ?? "");

  const isControlled =
    props.mode === "editar" && (props as any).open !== undefined;
  const open = isControlled ? (props as any).open : internalOpen;
  const setOpen = isControlled ? (props as any).onOpenChange : setInternalOpen;

  // Resetar selects ao abrir em modo editar
  React.useEffect(() => {
    if (open && isEditar && conta) {
      setEmpresaId(conta.empresa_id);
      setTipo(conta.tipo);
    }
    if (open && !isEditar) {
      setEmpresaId("");
      setTipo("");
    }
  }, [open, isEditar, conta]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
    }
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    // Injetar valores dos selects controlados
    formData.set("empresa_id", empresaId);
    formData.set("tipo", tipo);

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarContaBancaria(formData)
          : await editarContaBancaria(props.conta.id, formData);

      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const title =
    props.mode === "criar" ? "Nova conta bancária" : "Editar conta bancária";
  const submitLabel =
    props.mode === "criar"
      ? pending
        ? "Criando..."
        : "Salvar"
      : pending
        ? "Salvando..."
        : "Salvar";

  const saldoBloqueado = isEditar && hasLancamentos;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.trigger && <DialogTrigger asChild>{props.trigger}</DialogTrigger>}
      {props.mode === "criar" && !props.trigger && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova conta bancária
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Cadastre uma nova conta bancária vinculada a uma empresa do tenant."
              : "Edite os dados da conta bancária. Saldo inicial e data não podem ser alterados após lançamentos."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Empresa */}
            <div className="space-y-2">
              <Label htmlFor="empresa_id">Empresa *</Label>
              <Select
                value={empresaId}
                onValueChange={setEmpresaId}
                required
              >
                <SelectTrigger id="empresa_id">
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {props.empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome_fantasia ?? e.razao_social}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.empresa_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Nome */}
            <div className="space-y-2">
              <Label htmlFor="nome">Nome *</Label>
              <Input
                id="nome"
                name="nome"
                autoFocus
                required
                maxLength={120}
                defaultValue={conta?.nome ?? ""}
                placeholder="Ex.: Santander Corrente, Caixa Pequena SP"
              />
              {fieldErrors.nome?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Banco */}
            <div className="space-y-2">
              <Label htmlFor="banco">Banco *</Label>
              <Input
                id="banco"
                name="banco"
                required
                maxLength={80}
                defaultValue={conta?.banco ?? ""}
                placeholder="Ex.: Santander, Itaú, Bradesco"
              />
              {fieldErrors.banco?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Agência + Número da conta (2 colunas) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="agencia">Agência</Label>
                <Input
                  id="agencia"
                  name="agencia"
                  maxLength={20}
                  defaultValue={conta?.agencia ?? ""}
                  placeholder="Ex.: 0001"
                />
                {fieldErrors.agencia?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="numero_conta">Número da conta</Label>
                <Input
                  id="numero_conta"
                  name="numero_conta"
                  maxLength={30}
                  defaultValue={conta?.numero_conta ?? ""}
                  placeholder="Ex.: 12345-6"
                />
                {fieldErrors.numero_conta?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>
            </div>

            {/* Tipo */}
            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo *</Label>
              <Select value={tipo} onValueChange={setTipo} required>
                <SelectTrigger id="tipo">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="corrente">Corrente</SelectItem>
                  <SelectItem value="poupanca">Poupança</SelectItem>
                  <SelectItem value="investimento">Investimento</SelectItem>
                  <SelectItem value="caixa">Caixa</SelectItem>
                </SelectContent>
              </Select>
              {fieldErrors.tipo?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Saldo inicial */}
            <div className="space-y-2">
              <Label htmlFor="saldo_inicial">
                Saldo inicial *
                {saldoBloqueado && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    (bloqueado — conta com lançamentos)
                  </span>
                )}
              </Label>
              <Input
                id="saldo_inicial"
                name="saldo_inicial"
                type="number"
                step="0.01"
                required
                disabled={saldoBloqueado}
                defaultValue={
                  conta ? String(Number(conta.saldo_inicial)) : "0"
                }
                placeholder="0,00"
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {fieldErrors.saldo_inicial?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Data do saldo inicial */}
            <div className="space-y-2">
              <Label>
                Data do saldo inicial *
                {saldoBloqueado && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    (bloqueado — conta com lançamentos)
                  </span>
                )}
              </Label>
              <DatePicker
                name="saldo_inicial_data"
                defaultValue={conta?.saldo_inicial_data ?? ""}
                placeholder="Selecione a data"
                required
                disabled={saldoBloqueado}
              />
              {fieldErrors.saldo_inicial_data?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Ordem */}
            <div className="space-y-2">
              <Label htmlFor="ordem">Ordem</Label>
              <Input
                id="ordem"
                name="ordem"
                type="number"
                min={0}
                step={1}
                defaultValue={conta?.ordem ?? 0}
                placeholder="0"
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {fieldErrors.ordem?.map((msg, i) => (
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
              {submitLabel}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
