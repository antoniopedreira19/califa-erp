"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import type { VersaoOrcamentoItem } from "@/lib/types";
import { removerItem } from "../actions";
import { ItemEditorDrawer } from "./item-editor-drawer";

interface Props {
  grupoNome: string;
  itens: VersaoOrcamentoItem[];
  moeda: string;
  readOnly?: boolean;
}

export function ItensTable({ grupoNome, itens, moeda, readOnly }: Props) {
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

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="w-[120px]">Tipo</TableHead>
            <TableHead className="text-right w-[120px]">Valor unit.</TableHead>
            <TableHead className="text-right w-[90px]">Qtd</TableHead>
            <TableHead className="text-right w-[90px]">D/M</TableHead>
            <TableHead className="text-right w-[140px]">Total</TableHead>
            {!readOnly && <TableHead className="w-[80px]"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={readOnly ? 6 : 7}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                Sem itens neste grupo ainda.
              </TableCell>
            </TableRow>
          )}
          {itens.map((it) => (
            <TableRow key={it.id}>
              <TableCell>
                <div className="font-medium text-foreground">{it.item}</div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="font-mono">
                  {it.tipo_custo}
                </Badge>
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                {formatCurrency(it.valor_unitario_orcado, moeda)}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                {formatNumber(it.quantidade_orcada)}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                {formatNumber(it.dias_meses_orcado)}
              </TableCell>
              <TableCell className="text-right text-sm font-semibold tabular-nums">
                {formatCurrency(it.total_orcado, moeda)}
              </TableCell>
              {!readOnly && (
                <TableCell>
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => setEditing(it)}
                      disabled={pending}
                      title="Editar"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(it)}
                      disabled={pending}
                      title="Remover"
                      className="p-1.5 rounded-md text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ItemEditorDrawer
        grupoNome={grupoNome}
        item={editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        showTrigger={false}
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

function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(num)) return "—";
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}
