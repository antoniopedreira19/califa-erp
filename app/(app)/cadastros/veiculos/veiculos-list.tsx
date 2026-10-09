"use client";

// A lista de veículos (decisão 150). Segue a lista de Fornecedores
// (`fornecedores-list.tsx`): busca, contagem, "Mostrar inativos", linha
// clicável e o Inativar na ponta — que inativa o fornecedor, porque o
// veículo é o mesmo cadastro. O que é só do veículo: o filtro por meio, a
// coluna "Usado em" (os meios das planilhas em que ele já foi escolhido) e o
// aviso de pagamento que falta para a PP do repasse.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Search, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { formatDocumento, formatTelefone } from "@/lib/utils";
import { MEIOS } from "@/lib/midia/meios";
import type { Fornecedor } from "@/lib/types";
import { inativarFornecedor, reativarFornecedor } from "@/app/(app)/fornecedores/actions";

export interface VeiculoDaTela {
  fornecedor: Fornecedor;
  /** Os meios em que o veículo já foi usado nas planilhas de mídia. */
  usadoEm: string[];
}

/** Sem conta e sem PIX: o veículo grava, mas a PP do repasse vai pedir.
 *  Marcado "Sem conta nem PIX" (decisão 161) o cadastro está completo — a
 *  PP pede boleto ou chave aleatória —, e o selo não aparece. */
function semPagamento(f: Fornecedor): boolean {
  return !f.sem_dados_pagamento && !f.banco_codigo && !f.pix_chave;
}

const TODOS = "todos";

export function VeiculosList({ veiculos }: { veiculos: VeiculoDaTela[] }) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [meio, setMeio] = React.useState<string>(TODOS);
  const [mostrarInativos, setMostrarInativos] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [askInativar, setAskInativar] = React.useState<{ id: string; nome: string } | null>(null);

  const filtered = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    const digitos = q.replace(/\D/g, "");
    return veiculos.filter(({ fornecedor: f, usadoEm }) => {
      if (!mostrarInativos && f.status !== "ativo") return false;
      if (meio !== TODOS && !usadoEm.includes(meio)) return false;
      if (!q) return true;
      return (
        f.nome.toLowerCase().includes(q) ||
        (f.razao_social?.toLowerCase().includes(q) ?? false) ||
        (digitos.length > 0 && (f.cpf_cnpj?.includes(digitos) ?? false))
      );
    });
  }, [veiculos, busca, meio, mostrarInativos]);

  const ativos = veiculos.filter((v) => v.fornecedor.status === "ativo").length;
  const inativos = veiculos.length - ativos;

  function handleInativarConfirm() {
    if (!askInativar) return;
    const alvo = askInativar;
    startTransition(async () => {
      const res = await inativarFornecedor(alvo.id);
      if (!res.ok) alert(res.message);
      setAskInativar(null);
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
        <div className="flex w-full flex-1 items-center gap-3">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou documento..."
              className="pl-10"
            />
          </div>
          <Select value={meio} onValueChange={setMeio}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os meios</SelectItem>
              {MEIOS.map((m) => (
                <SelectItem key={m.nome} value={m.nome}>
                  {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-none items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {ativos} {ativos === 1 ? "ativo" : "ativos"}
            {inativos > 0 ? ` · ${inativos} ${inativos === 1 ? "inativo" : "inativos"}` : ""}
          </span>
          <label className="inline-flex cursor-pointer items-center gap-2">
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

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Usado em</TableHead>
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
            {filtered.map(({ fornecedor: f, usadoEm }) => {
              const href = `/cadastros/veiculos/${f.id}`;
              return (
                <TableRow
                  key={f.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(href)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(href);
                    }
                  }}
                  className="cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={href}
                        prefetch={false}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-foreground transition-colors hover:text-california-red"
                      >
                        {f.nome}
                      </Link>
                      {semPagamento(f) && (
                        <span
                          title="Sem conta bancária e sem PIX: vão ser exigidos para gerar a PP do repasse (A · Repasse)."
                          className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                        >
                          Sem pagamento
                        </span>
                      )}
                    </div>
                    {f.razao_social && (
                      <TruncateTooltip as="p" text={f.razao_social} className="max-w-[280px] text-xs text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[300px] flex-wrap gap-1">
                      {usadoEm.length === 0 && (
                        <span className="text-xs italic text-muted-foreground/70">Ainda não usado</span>
                      )}
                      {usadoEm.map((m) => (
                        <span
                          key={m}
                          className="inline-flex items-center rounded-md border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {f.status === "ativo" ? (
                      <button
                        type="button"
                        onClick={() => setAskInativar({ id: f.id, nome: f.nome })}
                        disabled={pending}
                        title="Inativar"
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-50"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReativar(f.id)}
                        disabled={pending}
                        title="Reativar"
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-50"
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={askInativar !== null}
        onOpenChange={(o) => !o && setAskInativar(null)}
        title="Inativar veículo?"
        description={
          <>
            <strong className="text-foreground">{askInativar?.nome}</strong> deixa de aparecer na escolha de
            veículo das planilhas de mídia e, como é o mesmo cadastro, na de fornecedor dos orçamentos e das PPs.
            O histórico é preservado e você pode reativar a qualquer momento.
          </>
        }
        confirmLabel="Inativar"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleInativarConfirm}
      />
    </div>
  );
}
