"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import type { VersaoOrcamentoItem, VersaoOrcamentoCategoria } from "@/lib/types";
import { removerItem } from "../actions";
import { ItemEditorDrawer } from "./item-editor-drawer";

interface Props {
  grupoNome: string;
  itens: VersaoOrcamentoItem[];
  moeda: string;
  readOnly?: boolean;
  categorias: VersaoOrcamentoCategoria[];
}

export function ItensTable({ grupoNome, itens, moeda, readOnly, categorias }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<VersaoOrcamentoItem | null>(null);
  const [removing, setRemoving] = React.useState<VersaoOrcamentoItem | null>(null);

  function handleRemoveConfirm() {
    if (!removing) return;
    const target = removing;
    startTransition(async () => {
      const res = await removerItem(target.id);
      if (!res.ok) alert(res.message);
      setRemoving(null);
      router.refresh();
    });
  }

  const colSpan = readOnly ? 12 : 13;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left font-semibold px-3 py-2">Item</th>
              <th className="text-left font-semibold px-3 py-2">Tipo</th>
              <th className="text-left font-semibold px-3 py-2">Categoria</th>
              <th className="text-right font-semibold px-3 py-2">R$ Orç.</th>
              <th className="text-right font-semibold px-3 py-2">QT</th>
              <th className="text-right font-semibold px-3 py-2">D/M</th>
              <th className="text-right font-semibold px-3 py-2">Total Orç.</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60">R$ Plan.</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60">QT</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60">D/M</th>
              <th className="text-right font-semibold px-3 py-2 bg-blue-50/60">Total Plan.</th>
              <th className="text-right font-semibold px-3 py-2">Rentab.</th>
              {!readOnly && <th className="w-[80px]"></th>}
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr>
                <td
                  colSpan={colSpan}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  Sem itens neste grupo ainda.
                </td>
              </tr>
            )}
            {itens.map((item) => (
              <tr
                key={item.id}
                onClick={() => setEditing(item)}
                className="border-b border-border hover:bg-accent/40 transition-colors cursor-pointer"
              >
                <td className="px-3 py-2 text-sm text-foreground">{item.item}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{item.tipo_custo}</Badge>
                </td>
                <td className="px-3 py-2 text-xs">
                  {(() => {
                    const cat = categorias.find((c) => c.id === item.categoria_id);
                    return cat ? (
                      <Badge variant="neutral">{cat.nome}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {formatCurrency(item.valor_unitario_orcado, moeda)}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {Number(item.quantidade_orcada)}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {Number(item.dias_meses_orcado)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                  {formatCurrency(item.total_orcado, moeda)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs bg-blue-50/40">
                  {item.valor_unitario_planejado > 0
                    ? formatCurrency(item.valor_unitario_planejado, moeda)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right text-xs bg-blue-50/40">
                  {item.quantidade_planejada > 0 ? Number(item.quantidade_planejada) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-xs bg-blue-50/40">
                  {item.dias_meses_planejado > 0 ? Number(item.dias_meses_planejado) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs font-semibold bg-blue-50/40">
                  {item.total_planejado > 0
                    ? formatCurrency(item.total_planejado, moeda)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {(() => {
                    if (item.total_planejado <= 0) {
                      return <span className="text-muted-foreground">—</span>;
                    }
                    const rentab = item.total_orcado - item.total_planejado;
                    const cor = rentab >= 0 ? "text-emerald-700" : "text-california-red";
                    return <span className={cor}>{formatCurrency(rentab, moeda)}</span>;
                  })()}
                </td>
                {!readOnly && (
                  <td
                    onClick={(e) => e.stopPropagation()}
                    className="px-3 py-2 text-right"
                  >
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        onClick={() => setEditing(item)}
                        disabled={pending}
                        title="Editar"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoving(item)}
                        disabled={pending}
                        title="Remover"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ItemEditorDrawer
        grupoNome={grupoNome}
        item={editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        showTrigger={false}
        categorias={categorias}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remover item?"
        description={
          <>
            <strong className="text-foreground">{removing?.item}</strong> será
            removido. Você pode adicionar novamente depois se precisar.
          </>
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleRemoveConfirm}
      />
    </>
  );
}
