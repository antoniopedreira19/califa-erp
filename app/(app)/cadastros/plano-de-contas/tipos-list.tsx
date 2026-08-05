"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Power, PowerOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PlanoContaTipo, NaturezaPadraoTipo } from "@/lib/types";
import { TipoDrawer } from "./tipo-drawer";
import { inativarTipo, reativarTipo } from "./actions";

type StatusFiltro = "ativas" | "inativas" | "todas";

function NaturezaChip({ natureza }: { natureza: NaturezaPadraoTipo }) {
  if (natureza === "entrada") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Entrada
      </span>
    );
  }
  if (natureza === "saida") {
    return (
      <span className="inline-flex items-center rounded-full border border-california-red/20 bg-california-red/5 px-2 py-0.5 text-xs font-medium text-california-red">
        Saída
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Ambos
    </span>
  );
}

export function TiposList({
  tipos,
  tiposComLancamento,
  canEdit,
}: {
  tipos: PlanoContaTipo[];
  tiposComLancamento: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<PlanoContaTipo | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    tipo: PlanoContaTipo;
    acao: "inativar" | "reativar";
  } | null>(null);

  const tiposComLancamentoSet = React.useMemo(
    () => new Set(tiposComLancamento),
    [tiposComLancamento],
  );

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return tipos.filter((t) => {
      if (status === "ativas" && !t.ativo) return false;
      if (status === "inativas" && t.ativo) return false;
      if (!q) return true;
      return (
        t.codigo.toLowerCase().includes(q) || t.nome.toLowerCase().includes(q)
      );
    });
  }, [tipos, busca, status]);

  function handleConfirm() {
    if (!confirmando) return;
    const { tipo, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarTipo(tipo.id)
          : await reativarTipo(tipo.id);
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
              placeholder="Buscar por código ou nome..."
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
        {canEdit && <TipoDrawer mode="criar" />}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {tipos.length === 0
              ? "Nenhum tipo cadastrado ainda."
              : "Nenhum tipo corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-28">
                  Código
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-36">
                  Natureza padrão
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-20">
                  Ordem
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
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => canEdit && setEditando(t)}
                  className={`border-b border-border last:border-0 transition-colors hover:bg-muted/50 ${canEdit ? "cursor-pointer" : ""}`}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold tracking-wide">
                      {t.codigo}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{t.nome}</td>
                  <td className="px-4 py-3">
                    <NaturezaChip natureza={t.natureza_padrao} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {t.ordem}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.ativo
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${t.ativo ? "bg-emerald-500" : "bg-muted-foreground"}`}
                      />
                      {t.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmando({
                            tipo: t,
                            acao: t.ativo ? "inativar" : "reativar",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={t.ativo ? "Inativar" : "Reativar"}
                      >
                        {t.ativo ? (
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
        </div>
      )}

      {editando && (
        <TipoDrawer
          mode="editar"
          tipo={editando}
          codigoBloqueado={tiposComLancamentoSet.has(editando.id)}
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
              ? "Inativar tipo?"
              : "Reativar tipo?"
          }
          description={
            confirmando.acao === "inativar"
              ? `O tipo "${confirmando.tipo.nome}" (${confirmando.tipo.codigo}) ficará inativo e não poderá ser usado em novos lançamentos.`
              : `O tipo "${confirmando.tipo.nome}" (${confirmando.tipo.codigo}) voltará a ficar disponível.`
          }
          confirmLabel={confirmando.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
