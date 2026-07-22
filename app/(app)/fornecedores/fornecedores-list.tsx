"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Archive, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDocumento, formatTelefone } from "@/lib/utils";
import type { Fornecedor } from "@/lib/types";
import { inativarFornecedor, reativarFornecedor } from "./actions";

export function FornecedoresList({ fornecedores }: { fornecedores: Fornecedor[] }) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [mostrarInativos, setMostrarInativos] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return fornecedores.filter((f) => {
      if (!mostrarInativos && f.status !== "ativo") return false;
      if (!q) return true;
      return (
        f.nome.toLowerCase().includes(q) ||
        (f.razao_social?.toLowerCase().includes(q) ?? false) ||
        (f.cpf_cnpj?.includes(q.replace(/\D/g, "")) ?? false) ||
        (f.email?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [fornecedores, busca, mostrarInativos]);

  const ativos = fornecedores.filter((f) => f.status === "ativo").length;
  const inativos = fornecedores.length - ativos;

  function handleInativar(id: string, nome: string) {
    if (!confirm(`Inativar "${nome}"?`)) return;
    startTransition(async () => {
      const res = await inativarFornecedor(id);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  function handleReativar(id: string) {
    startTransition(async () => {
      const res = await reativarFornecedor(id);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, documento ou e-mail..."
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {ativos} {ativos === 1 ? "ativo" : "ativos"}
            {inativos > 0 ? ` · ${inativos} inativos` : ""}
          </span>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mostrarInativos}
              onChange={(e) => setMostrarInativos(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-california-red"
            />
            <span className="text-muted-foreground">Mostrar inativos</span>
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Nenhum resultado.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <Link
                    href={`/fornecedores/${f.id}`}
                    className="font-medium text-foreground hover:text-california-red transition-colors"
                  >
                    {f.nome}
                  </Link>
                  {f.razao_social && (
                    <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                      {f.razao_social}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {f.tipo_pessoa === "fisica" ? "PF" : "PJ"}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {f.cpf_cnpj ? formatDocumento(f.cpf_cnpj) : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>{f.email ?? "—"}</div>
                  {f.telefone && <div>{formatTelefone(f.telefone)}</div>}
                </TableCell>
                <TableCell>
                  {f.status === "ativo" ? (
                    <Badge variant="soft">Ativo</Badge>
                  ) : (
                    <Badge variant="neutral">Inativo</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {f.status === "ativo" ? (
                    <button
                      type="button"
                      onClick={() => handleInativar(f.id, f.nome)}
                      disabled={pending}
                      title="Inativar"
                      className="p-2 rounded-lg text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReativar(f.id)}
                      disabled={pending}
                      title="Reativar"
                      className="p-2 rounded-lg text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
