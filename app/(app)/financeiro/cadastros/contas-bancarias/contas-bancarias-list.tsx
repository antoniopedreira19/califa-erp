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
import type { ContaBancaria } from "@/lib/types";
import { tipoContaBancariaLabel } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { ContaBancariaDrawer } from "./conta-bancaria-drawer";
import { inativarContaBancaria, reativarContaBancaria } from "./actions";
import type { EmpresaContabilSumario } from "./types";

type StatusFiltro = "ativas" | "inativas" | "todas";

function formatDataBR(iso: string): string {
  // iso é YYYY-MM-DD — não passar por new Date() direto (desloca fuso)
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function ContasBancariasList({
  contas,
  canEdit,
  empresasContabeis,
}: {
  contas: ContaBancaria[];
  canEdit: boolean;
  empresasContabeis: EmpresaContabilSumario[];
}) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("ativas");
  const [pending, startTransition] = React.useTransition();
  const [editando, setEditando] = React.useState<ContaBancaria | null>(null);
  const [confirmando, setConfirmando] = React.useState<{
    conta: ContaBancaria;
    acao: "inativar" | "reativar";
  } | null>(null);

  const empresaContabilMap = React.useMemo(
    () => new Map(empresasContabeis.map((e) => [e.id, e.nome_fantasia ?? e.razao_social])),
    [empresasContabeis],
  );

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return contas.filter((c) => {
      if (status === "ativas" && !c.ativo) return false;
      if (status === "inativas" && c.ativo) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        c.banco.toLowerCase().includes(q)
      );
    });
  }, [contas, busca, status]);

  function handleConfirm() {
    if (!confirmando) return;
    const { conta, acao } = confirmando;
    startTransition(async () => {
      const res =
        acao === "inativar"
          ? await inativarContaBancaria(conta.id)
          : await reativarContaBancaria(conta.id);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      setConfirmando(null);
      router.refresh();
    });
  }

  function agConta(c: ContaBancaria): string {
    if (c.agencia && c.numero_conta) return `${c.agencia} / ${c.numero_conta}`;
    if (c.agencia) return c.agencia;
    if (c.numero_conta) return c.numero_conta;
    return "—";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou banco..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFiltro)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ativas">Ativas</SelectItem>
              <SelectItem value="inativas">Inativas</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <ContaBancariaDrawer mode="criar" empresasContabeis={empresasContabeis} />
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {contas.length === 0
              ? "Nenhuma conta bancária cadastrada ainda."
              : "Nenhuma conta bancária corresponde aos filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Banco</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Contábil</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">Ag / Conta</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-40">Saldo inicial</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">Data start</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => canEdit && setEditando(c)}
                  className={`border-b border-border last:border-0 transition-colors hover:bg-muted/50 ${canEdit ? "cursor-pointer" : ""}`}
                >
                  <td className="px-4 py-3 font-medium">
                    <div>{c.nome}</div>
                    <div className="text-xs text-muted-foreground">{tipoContaBancariaLabel(c.tipo)}</div>
                  </td>
                  <td className="px-4 py-3">{c.banco}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {empresaContabilMap.get(c.empresa_contabil_id) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{agConta(c)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(Number(c.saldo_inicial))}
                  </td>
                  <td className="px-4 py-3">{formatDataBR(c.saldo_inicial_data)}</td>
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
                      {c.ativo ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmando({
                            conta: c,
                            acao: c.ativo ? "inativar" : "reativar",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={c.ativo ? "Inativar" : "Reativar"}
                      >
                        {c.ativo ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
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
        <ContaBancariaDrawer
          mode="editar"
          conta={editando}
          open={!!editando}
          onOpenChange={(next) => {
            if (!next) setEditando(null);
          }}
          empresasContabeis={empresasContabeis}
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
              ? "Inativar conta bancária?"
              : "Reativar conta bancária?"
          }
          description={
            confirmando.acao === "inativar"
              ? `A conta "${confirmando.conta.nome}" ficará inativa e não poderá receber lançamentos.`
              : `A conta "${confirmando.conta.nome}" voltará a ficar disponível para lançamentos.`
          }
          confirmLabel={confirmando.acao === "inativar" ? "Inativar" : "Reativar"}
          onConfirm={handleConfirm}
          pending={pending}
        />
      )}
    </div>
  );
}
