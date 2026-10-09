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
import { formatDocumento, formatTelefone } from "@/lib/utils";
import type { Fornecedor } from "@/lib/types";
import { inativarFornecedor, reativarFornecedor } from "./actions";
import {
  BarraDosFiltrosDeColuna,
  celulaTexto,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

function fornecedorIncompleto(f: Fornecedor): boolean {
  return !f.cep || (!f.banco_codigo && !f.pix_chave);
}

/**
 * As colunas que filtram e ordenam pelo título, como no Excel (decisão 165 —
 * o mesmo filtro da aba PPs do job). As colunas dependem de quem é veículo
 * (o selo do Nome); a das ações (Inativar/Reativar) não filtra.
 */
function colunasDosFornecedores(ehVeiculo: Set<string>): ColunaFiltravel<Fornecedor>[] {
  return [
    {
      // A busca da coluna acha pela razão social e pelos selos da célula:
      // "incompletos" lista quem falta CEP ou conta/PIX.
      chave: "nome",
      rotulo: "Nome",
      tipo: "texto",
      celula: (f) => ({
        ...celulaTexto(f.nome),
        busca: [
          f.nome,
          f.razao_social ?? "",
          fornecedorIncompleto(f) ? "Dados incompletos" : "",
          ehVeiculo.has(f.id) ? "Veículo" : "",
        ].join(" "),
      }),
    },
    {
      chave: "tipo",
      rotulo: "Tipo",
      tipo: "texto",
      celula: (f) => celulaTexto(f.tipo_pessoa === "fisica" ? "PF" : "PJ"),
    },
    {
      // Acha com ou sem a pontuação.
      chave: "documento",
      rotulo: "Documento",
      tipo: "texto",
      celula: (f) =>
        f.cpf_cnpj
          ? { ...celulaTexto(formatDocumento(f.cpf_cnpj)), busca: `${formatDocumento(f.cpf_cnpj)} ${f.cpf_cnpj}` }
          : celulaTexto(null),
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
}

export function FornecedoresList({
  fornecedores,
  veiculoIds,
}: {
  fornecedores: Fornecedor[];
  /** Quem também é veículo de mídia (decisão 150): ganha o selo "Veículo",
   *  que leva ao cadastro em Cadastros › Veículos. */
  veiculoIds: string[];
}) {
  const router = useRouter();
  const ehVeiculo = React.useMemo(() => new Set(veiculoIds), [veiculoIds]);
  const [busca, setBusca] = React.useState("");
  const [mostrarInativos, setMostrarInativos] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [askInativar, setAskInativar] = React.useState<
    { id: string; nome: string } | null
  >(null);

  /** Os fornecedores que passam nos filtros de CIMA (busca, inativos). Os
   *  filtros dos títulos vêm depois, sobre esta lista. */
  const doTopo = React.useMemo(() => {
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

  const colunasDaTabela = React.useMemo(() => colunasDosFornecedores(ehVeiculo), [ehVeiculo]);
  const colunas = useFiltrosDeColuna(doTopo, colunasDaTabela, { guardarEm: "cadastro-fornecedores" });
  const filtered = colunas.visiveis;

  const ativos = fornecedores.filter((f) => f.status === "ativo").length;
  const inativos = fornecedores.length - ativos;

  function handleInativarConfirm() {
    if (!askInativar) return;
    const target = askInativar;
    startTransition(async () => {
      const res = await inativarFornecedor(target.id);
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

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="fornecedor"
          plural="fornecedores"
          onLimpar={colunas.limpar}
        />
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{colunas.titulo("nome")}</TableHead>
              <TableHead>{colunas.titulo("tipo")}</TableHead>
              <TableHead>{colunas.titulo("documento")}</TableHead>
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
                  {doTopo.length === 0 ? "Nenhum resultado." : "Nenhum fornecedor com esse filtro."}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((f) => {
              const href = `/fornecedores/${f.id}`;
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
                className="cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50"
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link
                      href={href}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-foreground hover:text-california-red transition-colors"
                    >
                      {f.nome}
                    </Link>
                    {fornecedorIncompleto(f) && (
                      <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        Dados incompletos
                      </span>
                    )}
                    {ehVeiculo.has(f.id) && (
                      <Link
                        href={`/cadastros/veiculos/${f.id}`}
                        prefetch={false}
                        onClick={(e) => e.stopPropagation()}
                        title="Também é veículo de mídia: veja em Cadastros › Veículos."
                        className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
                      >
                        Veículo
                      </Link>
                    )}
                  </div>
                  {f.razao_social && (
                    <TruncateTooltip
                      as="p"
                      text={f.razao_social}
                      className="text-xs text-muted-foreground max-w-[280px]"
                    />
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
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {f.status === "ativo" ? (
                    <button
                      type="button"
                      onClick={() =>
                        setAskInativar({ id: f.id, nome: f.nome })
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
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={askInativar !== null}
        onOpenChange={(o) => !o && setAskInativar(null)}
        title="Inativar fornecedor?"
        description={
          <>
            <strong className="text-foreground">{askInativar?.nome}</strong>{" "}
            deixa de aparecer nos itens de versão de orçamento. O histórico é
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
