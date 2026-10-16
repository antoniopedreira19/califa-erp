"use client";

import * as React from "react";
import { Briefcase, Plus, Pencil, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { FreelancerCargo } from "@/lib/types";
import { criarCargo, renomearCargo, toggleCargoAtivo } from "../actions";

interface Props {
  cargos: FreelancerCargo[];
}

export function GerenciarCargosDialog({ cargos }: Props) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
        >
          <Briefcase className="h-4 w-4" />
          Gerenciar cargos
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Gerenciar cargos</DialogTitle>
          <DialogDescription>
            Catálogo usado no autocomplete dos contratos de freelancer. Inativar não apaga —
            o cargo some do dropdown de novos contratos, mas continua visível em contratos
            antigos.
          </DialogDescription>
        </DialogHeader>

        <NovoCargoForm />

        <div className="max-h-[400px] overflow-y-auto divide-y divide-border -mx-6 px-6 border-t border-border">
          {cargos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum cargo cadastrado ainda.
            </p>
          ) : (
            cargos.map((c) => <CargoRow key={c.id} cargo={c} />)
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:border-california-red/40 transition-all"
            >
              Fechar
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NovoCargoForm() {
  const [valor, setValor] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nome = valor.trim();
    if (!nome) return;

    const fd = new FormData();
    fd.set("nome", nome);

    startTransition(async () => {
      const r = await criarCargo(fd);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setErro(null);
      setValor("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            if (erro) setErro(null);
          }}
          placeholder="Nome do novo cargo"
          disabled={pending}
          className={cn(
            "flex-1 h-10 rounded-lg border bg-white px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2",
            erro
              ? "border-california-red focus:ring-california-red/15"
              : "border-border focus:border-california-red focus:ring-california-red/15",
          )}
        />
        <button
          type="submit"
          disabled={pending || !valor.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="h-4 w-4" />
          Adicionar
        </button>
      </div>
      {erro && <p className="text-xs text-california-red">{erro}</p>}
    </form>
  );
}

function CargoRow({ cargo }: { cargo: FreelancerCargo }) {
  const [editando, setEditando] = React.useState(false);
  const [valor, setValor] = React.useState(cargo.nome);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  async function salvar() {
    const nome = valor.trim();
    if (!nome || nome === cargo.nome) {
      setEditando(false);
      setValor(cargo.nome);
      return;
    }

    const fd = new FormData();
    fd.set("id", cargo.id);
    fd.set("nome", nome);

    startTransition(async () => {
      const r = await renomearCargo(fd);
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setErro(null);
      setEditando(false);
    });
  }

  async function toggle() {
    const fd = new FormData();
    fd.set("id", cargo.id);
    fd.set("ativo", String(!cargo.ativo));
    startTransition(async () => {
      await toggleCargoAtivo(fd);
    });
  }

  return (
    <div className="py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        {editando ? (
          <div className="space-y-1">
            <input
              type="text"
              value={valor}
              autoFocus
              onChange={(e) => {
                setValor(e.target.value);
                if (erro) setErro(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvar();
                if (e.key === "Escape") {
                  setEditando(false);
                  setValor(cargo.nome);
                  setErro(null);
                }
              }}
              disabled={pending}
              className={cn(
                "w-full h-8 rounded-md border bg-white px-2 text-sm focus:outline-none focus:ring-2",
                erro
                  ? "border-california-red focus:ring-california-red/15"
                  : "border-border focus:border-california-red focus:ring-california-red/15",
              )}
            />
            {erro && <p className="text-[11px] text-california-red">{erro}</p>}
          </div>
        ) : (
          <span
            className={cn(
              "text-sm",
              cargo.ativo ? "text-foreground" : "text-muted-foreground line-through",
            )}
          >
            {cargo.nome}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {editando ? (
          <>
            <button
              type="button"
              onClick={salvar}
              disabled={pending}
              className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50"
              aria-label="Salvar"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditando(false);
                setValor(cargo.nome);
                setErro(null);
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
              aria-label="Cancelar"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Renomear"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={pending}
              className={cn(
                "inline-flex items-center rounded-full h-5 w-9 transition-colors shrink-0",
                cargo.ativo ? "bg-california-red" : "bg-muted",
              )}
              aria-label={cargo.ativo ? "Inativar cargo" : "Reativar cargo"}
              role="switch"
              aria-checked={cargo.ativo}
            >
              <span
                className={cn(
                  "h-4 w-4 rounded-full bg-white shadow transition-transform",
                  cargo.ativo ? "translate-x-[18px]" : "translate-x-0.5",
                )}
              />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
