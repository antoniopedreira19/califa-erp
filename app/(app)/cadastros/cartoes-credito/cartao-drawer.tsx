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
import { criarCartao, atualizarCartao } from "./actions";
import type { CartaoCredito, BandeiraCartao } from "@/lib/types";

type Props =
  | {
      mode: "criar";
      trigger?: React.ReactNode;
    }
  | {
      mode: "editar";
      cartao: CartaoCredito;
      trigger?: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    };

export function CartaoDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const isEditar = props.mode === "editar";
  const cartao = isEditar ? (props as Extract<Props, { mode: "editar" }>).cartao : undefined;

  const [bandeira, setBandeira] = React.useState<string>(
    cartao?.bandeira ?? ""
  );

  const isControlled =
    props.mode === "editar" &&
    (props as Extract<Props, { mode: "editar" }>).open !== undefined;
  const open = isControlled
    ? (props as Extract<Props, { mode: "editar" }>).open!
    : internalOpen;
  const setOpen = isControlled
    ? (props as Extract<Props, { mode: "editar" }>).onOpenChange!
    : setInternalOpen;

  // Resetar estado ao abrir
  React.useEffect(() => {
    if (open && isEditar && cartao) {
      setBandeira(cartao.bandeira);
    }
    if (open && !isEditar) {
      setBandeira("");
    }
    if (!open) {
      setError(null);
    }
  }, [open, isEditar, cartao]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
    }
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    const nome = formData.get("nome")?.toString().trim() ?? "";
    const banco = formData.get("banco")?.toString().trim() ?? "";
    const dono = formData.get("dono")?.toString().trim() ?? "";
    const ultimos_4_digitos = formData.get("ultimos_4_digitos")?.toString().trim() ?? "";
    const diaRaw = formData.get("dia_vencimento_fatura")?.toString() ?? "";
    const dia = parseInt(diaRaw, 10);

    const input = {
      nome,
      banco,
      bandeira: bandeira as BandeiraCartao,
      ultimos_4_digitos,
      dono,
      dia_vencimento_fatura: isNaN(dia) ? undefined : dia,
      ...(isEditar && cartao ? { id: cartao.id } : {}),
    };

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarCartao(input)
          : await atualizarCartao(input);

      if (!res.ok) {
        setError(res.message);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  const title = props.mode === "criar" ? "Novo cartão de crédito" : "Editar cartão de crédito";
  const submitLabel =
    props.mode === "criar"
      ? pending
        ? "Criando..."
        : "Salvar"
      : pending
        ? "Salvando..."
        : "Salvar";

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
            Novo cartão
          </button>
        </DialogTrigger>
      )}
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Cadastre um cartão para usar como forma de pagamento em PPs, contas avulsas e recorrências."
              : "Edite os dados do cartão de crédito."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Nome */}
            <div className="space-y-2">
              <Label htmlFor="nome">Nome *</Label>
              <Input
                id="nome"
                name="nome"
                autoFocus
                required
                maxLength={80}
                defaultValue={cartao?.nome ?? ""}
                placeholder="Ex.: Nubank Antonio, Itaú Corporativo"
              />
            </div>

            {/* Banco */}
            <div className="space-y-2">
              <Label htmlFor="banco">Banco *</Label>
              <Input
                id="banco"
                name="banco"
                required
                maxLength={80}
                defaultValue={cartao?.banco ?? ""}
                placeholder="Ex.: Nubank, Itaú, Bradesco"
              />
            </div>

            {/* Bandeira */}
            <div className="space-y-2">
              <Label htmlFor="bandeira">Bandeira *</Label>
              <Select value={bandeira} onValueChange={setBandeira} required>
                <SelectTrigger id="bandeira">
                  <SelectValue placeholder="Selecione a bandeira" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="visa">Visa</SelectItem>
                  <SelectItem value="master">Mastercard</SelectItem>
                  <SelectItem value="elo">Elo</SelectItem>
                  <SelectItem value="amex">American Express</SelectItem>
                  <SelectItem value="hipercard">Hipercard</SelectItem>
                  <SelectItem value="outra">Outra</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Últimos 4 dígitos + Dono (2 colunas) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ultimos_4_digitos">Últimos 4 dígitos *</Label>
                <Input
                  id="ultimos_4_digitos"
                  name="ultimos_4_digitos"
                  required
                  maxLength={4}
                  inputMode="numeric"
                  defaultValue={cartao?.ultimos_4_digitos ?? ""}
                  placeholder="1234"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dia_vencimento_fatura">Dia do vencimento *</Label>
                <Input
                  id="dia_vencimento_fatura"
                  name="dia_vencimento_fatura"
                  type="number"
                  min="1"
                  max="31"
                  step="1"
                  required
                  defaultValue={cartao?.dia_vencimento_fatura ?? ""}
                  placeholder="15"
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>

            {/* Dono */}
            <div className="space-y-2">
              <Label htmlFor="dono">Dono do cartão *</Label>
              <Input
                id="dono"
                name="dono"
                required
                maxLength={80}
                defaultValue={cartao?.dono ?? ""}
                placeholder="Ex.: Antonio Pedreira, Agência California"
              />
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
