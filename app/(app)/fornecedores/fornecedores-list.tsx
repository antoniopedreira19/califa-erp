"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Archive, Undo2, Download, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { ROTULO_DO_REGIME, formatarCnae } from "@/lib/fiscal/regime-do-fornecedor";
import type { FornecedorDaLista } from "./colunas-da-lista";
import { inativarFornecedor, reativarFornecedor } from "./actions";
import {
  BarraDosFiltrosDeColuna,
  celulaTexto,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

function fornecedorIncompleto(f: FornecedorDaLista): boolean {
  return !f.cep || (!f.banco_codigo && !f.pix_chave);
}

/**
 * As colunas que filtram e ordenam pelo título, como no Excel (decisão 165 —
 * o mesmo filtro da aba PPs do job). As colunas dependem de quem é veículo
 * (o selo do Nome) e da descrição de cada CNAE; a das ações
 * (Inativar/Reativar) não filtra.
 */
function colunasDosFornecedores(
  ehVeiculo: Set<string>,
  descricaoDosCnaes: Record<string, string>,
): ColunaFiltravel<FornecedorDaLista>[] {
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
      // Acha com ou sem a pontuação. O título é "CNPJ" desde 12/11/2026
      // (Tiago); a pessoa física continua mostrando o CPF aqui. A chave
      // segue "documento": é ela que guarda o filtro de quem já usa.
      chave: "documento",
      rotulo: "CNPJ",
      tipo: "texto",
      celula: (f) =>
        f.cpf_cnpj
          ? { ...celulaTexto(formatDocumento(f.cpf_cnpj)), busca: `${formatDocumento(f.cpf_cnpj)} ${f.cpf_cnpj}` }
          : celulaTexto(null),
    },
    {
      // O regime gravado no cadastro (o da consulta do CNPJ ou o trocado à
      // mão). Pessoa física não tem: fica "(vazio)", e o Tipo separa.
      chave: "regime",
      rotulo: "Regime tributário",
      tipo: "texto",
      celula: (f) =>
        celulaTexto(f.regime_tributario ? ROTULO_DO_REGIME[f.regime_tributario] : null),
    },
    {
      // O CNAE principal, ordenado pelo código; a busca acha pelo código
      // (com ou sem pontuação) e pela atividade.
      chave: "cnae",
      rotulo: "CNAE",
      tipo: "texto",
      celula: (f) => {
        if (!f.cnae) return celulaTexto(null);
        const codigo = formatarCnae(f.cnae);
        const atividade = descricaoDosCnaes[f.cnae];
        return {
          ...celulaTexto(atividade ? `${codigo} · ${atividade}` : codigo, f.cnae),
          busca: `${codigo} ${f.cnae} ${atividade ?? ""}`,
        };
      },
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
  descricaoDosCnaes,
  podeExportar,
  podeInativar,
}: {
  /** "Exportar Excel": só Admin e Financeiro (12/11/2026) — o arquivo leva
   *  conta e PIX de todos. Sem a permissão, o botão não aparece. */
  podeExportar: boolean;
  fornecedores: FornecedorDaLista[];
  /** A atividade de cada CNAE da lista, montada no servidor: a lista
   *  inteira do CNAE (lib/fiscal/cnaes) é grande demais para ir à tela. */
  descricaoDosCnaes: Record<string, string>;
  /** Inativar e reativar: só Admin e Financeiro (10/11/2026). Sem a
   *  permissão, a coluna das ações fica vazia. */
  podeInativar: boolean;
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

  const colunasDaTabela = React.useMemo(
    () => colunasDosFornecedores(ehVeiculo, descricaoDosCnaes),
    [ehVeiculo, descricaoDosCnaes],
  );
  const colunas = useFiltrosDeColuna(doTopo, colunasDaTabela, { guardarEm: "cadastro-fornecedores" });
  const filtered = colunas.visiveis;

  const ativos = fornecedores.filter((f) => f.status === "ativo").length;
  const inativos = fornecedores.length - ativos;

  const [exportando, setExportando] = React.useState(false);
  const [erroExportar, setErroExportar] = React.useState<string | null>(null);
  const filtrado = busca.trim() !== "" || colunas.ativo;

  /**
   * Baixa em Excel os fornecedores da tela, na ordem dela, com todos os
   * campos do cadastro (pedido do Tiago, 12/11/2026). A rota lê o cadastro
   * inteiro de cada um: a lista só tem o que mostra.
   */
  async function exportar() {
    if (exportando || filtered.length === 0) return;
    setExportando(true);
    setErroExportar(null);
    try {
      const res = await fetch("/api/fornecedores/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: filtered.map((f) => f.id), filtrado }),
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
        setErroExportar(corpo?.error ?? "Não foi possível gerar a planilha. Tente de novo.");
        return;
      }
      const nome =
        /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
        "Fornecedores.xlsx";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = decodeURIComponent(nome);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // O clique já entregou o arquivo ao navegador; a URL pode ir embora depois.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("[fornecedores.exportar]", e);
      setErroExportar("Não foi possível gerar a planilha. Tente de novo.");
    } finally {
      setExportando(false);
    }
  }

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
          {podeExportar && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={exportar}
                  disabled={exportando || filtered.length === 0}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 text-[12.5px] font-semibold text-foreground transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exportando ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-california-red" />
                  ) : (
                    <Download className="h-3.5 w-3.5 text-california-red" />
                  )}
                  {exportando ? "Exportando…" : "Exportar Excel"}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end">
                {filtered.length === 1
                  ? "O fornecedor da lista"
                  : `Os ${filtered.length.toLocaleString("pt-BR")} fornecedores da lista`}
                {filtrado ? ", com os filtros aplicados" : ""}, com todos os dados do cadastro
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {erroExportar && (
        <p className="text-right text-[12px] text-california-red">{erroExportar}</p>
      )}

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
              <TableHead>{colunas.titulo("regime")}</TableHead>
              <TableHead>{colunas.titulo("cnae")}</TableHead>
              <TableHead>{colunas.titulo("contato")}</TableHead>
              <TableHead>{colunas.titulo("status")}</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
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
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {f.cpf_cnpj ? formatDocumento(f.cpf_cnpj) : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-foreground">
                  {f.regime_tributario ? ROTULO_DO_REGIME[f.regime_tributario] : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {f.cnae ? (
                    <>
                      <div className="font-mono text-foreground">{formatarCnae(f.cnae)}</div>
                      {descricaoDosCnaes[f.cnae] && (
                        <TruncateTooltip
                          as="p"
                          text={descricaoDosCnaes[f.cnae]}
                          className="text-muted-foreground max-w-[240px]"
                        />
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
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
                  {!podeInativar ? null : f.status === "ativo" ? (
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
