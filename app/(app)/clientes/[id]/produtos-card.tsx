"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Package, Power, PowerOff } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ClienteProduto } from "@/lib/types";
import { ProdutoDrawer } from "./produto-drawer";
import { inativarProduto, reativarProduto } from "./produtos-actions";

export function ProdutosCard({
  clienteId,
  produtos,
}: {
  clienteId: string;
  produtos: ClienteProduto[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<ClienteProduto | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    produto: ClienteProduto;
    acao: "inativar" | "reativar";
  } | null>(null);

  function handleConfirm() {
    if (!confirmando) return;
    const { produto, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarProduto(clienteId, produto.id)
          : await reativarProduto(clienteId, produto.id);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex items-center justify-between gap-4 border-b border-border p-6">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-california-red" />
          <div>
            <h2 className="text-lg font-semibold leading-none tracking-tight">
              Produtos
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Aparecem no dropdown de Produto do projeto. O primeiro
              representa a marca do cliente e acompanha o nome fantasia.
            </p>
          </div>
        </div>
        <ProdutoDrawer clienteId={clienteId} mode="criar" />
      </div>

      {produtos.length === 0 ? (
        <div className="p-6">
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Package className="h-7 w-7 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Nenhum produto cadastrado.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sem produto cadastrado não é possível abrir job para este cliente.
            </p>
          </div>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-6 py-3 text-left font-medium text-muted-foreground w-28">
                Código
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Nome
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                Status
              </th>
              <th className="px-6 py-3 text-right font-medium text-muted-foreground w-20">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => (
              <tr
                key={p.id}
                onClick={() => {
                  if (!p.padrao) setEditando(p);
                }}
                className={`border-b border-border last:border-0 transition-colors ${
                  p.padrao ? "bg-muted/20" : "cursor-pointer hover:bg-muted/50"
                }`}
              >
                <td className="px-6 py-3 font-mono text-xs text-muted-foreground">
                  {p.codigo}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2">
                    {p.nome}
                    {p.padrao && (
                      <span
                        title="Marca do cliente. Não pode ser apagada nem editada — o nome acompanha o nome fantasia."
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        Marca
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.ativo
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        p.ativo ? "bg-emerald-500" : "bg-muted-foreground"
                      }`}
                    />
                    {p.ativo ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td
                  className="px-6 py-3 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!p.padrao && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmando({
                          produto: p,
                          acao: p.ativo ? "inativar" : "reativar",
                        })
                      }
                      title={p.ativo ? "Inativar" : "Reativar"}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      {p.ativo ? (
                        <PowerOff className="h-3.5 w-3.5" />
                      ) : (
                        <Power className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editando && (
        <ProdutoDrawer
          clienteId={clienteId}
          mode="editar"
          produto={editando}
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
              ? "Inativar produto?"
              : "Reativar produto?"
          }
          description={
            confirmando.acao === "inativar"
              ? `"${confirmando.produto.nome}" some do dropdown de novos jobs, mas continua nos jobs que já o usam.`
              : `"${confirmando.produto.nome}" volta a aparecer no dropdown.`
          }
          confirmLabel={confirmando.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
