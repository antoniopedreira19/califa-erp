"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Power, PowerOff, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CartaoCredito } from "@/lib/types";
import { bandeiraCartaoLabel } from "@/lib/types";
import { CartaoDrawer } from "./cartao-drawer";
import { inativarCartao, reativarCartao } from "./actions";

type StatusFiltro = "ativas" | "inativas" | "todas";

export function CartoesList({ rows }: { rows: CartaoCredito[] }) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<CartaoCredito | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    cartao: CartaoCredito;
    acao: "inativar" | "reativar";
  } | null>(null);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((c) => {
      if (status === "ativas" && !c.ativo) return false;
      if (status === "inativas" && c.ativo) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        c.banco.toLowerCase().includes(q) ||
        c.dono.toLowerCase().includes(q)
      );
    });
  }, [rows, busca, status]);

  function handleConfirm() {
    if (!confirmando) return;
    const { cartao, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarCartao({ id: cartao.id })
          : await reativarCartao({ id: cartao.id });
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, banco ou dono..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as StatusFiltro)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativas">Ativos</SelectItem>
              <SelectItem value="inativas">Inativos</SelectItem>
              <SelectItem value="todas">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CartaoDrawer mode="criar" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhum cartão cadastrado. Cadastre para poder usar como forma de pagamento em PPs, avulsas e recorrências."
              : "Nenhum cartão corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Banco / Bandeira
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                  Número
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">
                  Vencimento fatura
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-28">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setEditando(c)}
                  className="border-b border-border last:border-0 transition-colors hover:bg-muted/50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium">
                    <div>{c.nome}</div>
                    <div className="text-xs text-muted-foreground">{c.dono}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{c.banco}</div>
                    <div className="text-xs text-muted-foreground">
                      {bandeiraCartaoLabel(c.bandeira)}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    •••• {c.ultimos_4_digitos}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Todo dia {c.dia_vencimento_fatura}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.ativo
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          c.ativo ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                      />
                      {c.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditando(c)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmando({
                            cartao: c,
                            acao: c.ativo ? "inativar" : "reativar",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={c.ativo ? "Inativar" : "Reativar"}
                      >
                        {c.ativo ? (
                          <PowerOff className="h-3.5 w-3.5" />
                        ) : (
                          <Power className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <CartaoDrawer
          mode="editar"
          cartao={editando}
          open={!!editando}
          onOpenChange={(next) => {
            if (!next) setEditando(null);
          }}
        />
      )}

      {confirmando && (
        <ConfirmDialog
          open={!!confirmando}
          onOpenChange={(next) => {
            if (!next) setConfirmando(null);
          }}
          title={
            confirmando.acao === "inativar"
              ? "Inativar cartão?"
              : "Reativar cartão?"
          }
          description={
            confirmando.acao === "inativar"
              ? `O cartão "${confirmando.cartao.nome}" ficará inativo e não poderá ser selecionado como forma de pagamento.`
              : `O cartão "${confirmando.cartao.nome}" voltará a ficar disponível como forma de pagamento.`
          }
          confirmLabel={confirmando.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
