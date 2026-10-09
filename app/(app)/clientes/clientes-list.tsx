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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { formatCnpj, formatTelefone } from "@/lib/utils";
import type { Cliente } from "@/lib/types";
import { inativarCliente, reativarCliente } from "./actions";
import {
  BarraDosFiltrosDeColuna,
  celulaTexto,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

/**
 * As colunas que filtram e ordenam pelo título, como no Excel (decisão 165 —
 * o mesmo filtro da aba PPs do job). A coluna das ações (Inativar/Reativar)
 * não filtra.
 */
const COLUNAS: ColunaFiltravel<Cliente>[] = [
  {
    // A busca da coluna acha pela razão social também, como a de cima.
    chave: "nome",
    rotulo: "Nome fantasia",
    tipo: "texto",
    celula: (c) => ({ ...celulaTexto(c.nome_fantasia), busca: `${c.nome_fantasia} ${c.razao_social ?? ""}` }),
  },
  { chave: "codigo", rotulo: "Código", tipo: "texto", celula: (c) => celulaTexto(c.codigo_curto) },
  {
    // Acha com ou sem a pontuação.
    chave: "cnpj",
    rotulo: "CNPJ",
    tipo: "texto",
    celula: (c) => (c.cnpj ? { ...celulaTexto(formatCnpj(c.cnpj)), busca: `${formatCnpj(c.cnpj)} ${c.cnpj}` } : celulaTexto(null)),
  },
  {
    // Árvore E-mail ▸ endereço e Telefone ▸ número: os dois da célula. A
    // ordem é pelo e-mail (o de cima na célula); sem e-mail, pelo telefone.
    chave: "contato",
    rotulo: "Contato",
    tipo: "texto",
    celula: (x) => {
      const valores = [
        ...(x.email ? [{ ...celulaTexto(x.email, `1 ${x.email}`), grupo: "E-mail" }] : []),
        ...(x.telefone
          ? [{ ...celulaTexto(formatTelefone(x.telefone), `2 ${x.telefone}`), grupo: "Telefone" }]
          : []),
      ];
      return valores.length > 0 ? valores : { ...celulaTexto(null), grupo: "" };
    },
    rotuloSemGrupo: "(sem contato)",
  },
  {
    chave: "status",
    rotulo: "Status",
    tipo: "texto",
    // Perto da borda direita: o cartão abre centrado embaixo do título.
    alinhar: "center",
    celula: (x) => celulaTexto(x.status === "ativo" ? "Ativo" : "Inativo"),
  },
];

export function ClientesList({ clientes }: { clientes: Cliente[] }) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [mostrarInativos, setMostrarInativos] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [askInativar, setAskInativar] = React.useState<
    { id: string; nome: string } | null
  >(null);

  /** Os clientes que passam nos filtros de CIMA (busca, inativos). Os
   *  filtros dos títulos vêm depois, sobre esta lista. */
  const doTopo = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return clientes.filter((c) => {
      if (!mostrarInativos && c.status !== "ativo") return false;
      if (!q) return true;
      return (
        c.nome_fantasia.toLowerCase().includes(q) ||
        (c.razao_social?.toLowerCase().includes(q) ?? false) ||
        (c.cnpj?.includes(q.replace(/\D/g, "")) ?? false) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.codigo_curto?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [clientes, busca, mostrarInativos]);

  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "cadastro-clientes" });
  const filtered = colunas.visiveis;

  const ativos = clientes.filter((c) => c.status === "ativo").length;
  const inativos = clientes.length - ativos;

  function handleInativarConfirm() {
    if (!askInativar) return;
    const target = askInativar;
    startTransition(async () => {
      const res = await inativarCliente(target.id);
      if (!res.ok) alert(res.message);
      setAskInativar(null);
      router.refresh();
    });
  }

  function handleReativar(id: string) {
    startTransition(async () => {
      const res = await reativarCliente(id);
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
            placeholder="Buscar por nome, CNPJ ou e-mail..."
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

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="cliente"
          plural="clientes"
          onLimpar={colunas.limpar}
        />
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{colunas.titulo("nome")}</TableHead>
              <TableHead className="px-4 py-3 font-semibold">{colunas.titulo("codigo")}</TableHead>
              <TableHead>{colunas.titulo("cnpj")}</TableHead>
              <TableHead>{colunas.titulo("contato")}</TableHead>
              <TableHead>{colunas.titulo("status")}</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {/* Vazia pelos títulos, a tabela fica (com os títulos,
                      para desfazer) e diz que foi o filtro. */}
                  {doTopo.length === 0 ? "Nenhum resultado." : "Nenhum cliente com esse filtro."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c) => {
              const href = `/clientes/${c.id}`;
              return (
              <TableRow
                key={c.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(href)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
                className="cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50"
              >
                <TableCell>
                  <Link
                    href={href}
                    prefetch={false}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-foreground hover:text-california-red transition-colors"
                  >
                    {c.nome_fantasia}
                  </Link>
                  {c.razao_social && (
                    <TruncateTooltip
                      as="p"
                      text={c.razao_social}
                      className="text-xs text-muted-foreground max-w-[280px]"
                    />
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {c.codigo_curto}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {c.cnpj ? formatCnpj(c.cnpj) : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>{c.email ?? "—"}</div>
                  {c.telefone && <div>{formatTelefone(c.telefone)}</div>}
                </TableCell>
                <TableCell>
                  {c.status === "ativo" ? (
                    <Badge variant="soft">Ativo</Badge>
                  ) : (
                    <Badge variant="neutral">Inativo</Badge>
                  )}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {c.status === "ativo" ? (
                    <button
                      type="button"
                      onClick={() =>
                        setAskInativar({ id: c.id, nome: c.nome_fantasia })
                      }
                      disabled={pending}
                      title="Inativar"
                      className="p-2 rounded-lg text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReativar(c.id)}
                      disabled={pending}
                      title="Reativar"
                      className="p-2 rounded-lg text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
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
        title="Inativar cliente?"
        description={
          <>
            <strong className="text-foreground">{askInativar?.nome}</strong>{" "}
            deixa de aparecer nas seleções de orçamento. O histórico é
            preservado e você pode reativar a qualquer momento.
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
