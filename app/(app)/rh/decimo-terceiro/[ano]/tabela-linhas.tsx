"use client";

import * as React from "react";
import {
  Pencil,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DialogEditarLinha } from "./dialog-editar-linha";

export interface ParteBreakdownRow {
  primeira_parcela: number;
  segunda_parcela: number;
  desconto_inss: number;
  desconto_irrf: number;
  total_liquido: number;
}

export interface LinhaRow {
  id: string;
  nome: string;
  empresa: string | null;
  tipo_contratacao: string;
  data_admissao: string;
  salario: number;
  /** Parte PJ do salário quando híbrido (= valor_recibo). Null quando não híbrido. */
  valor_recibo: number | null;
  avos: number;
  primeira_parcela: number;
  segunda_parcela: number;
  desconto_inss: number;
  desconto_irrf: number;
  total_liquido: number;
  /** Breakdown pro híbrido (CLT_recibo com valor_recibo). Null caso contrário. */
  parte_clt: ParteBreakdownRow | null;
  parte_pj: ParteBreakdownRow | null;
  editado_manualmente: boolean;
  salario_editado: number | null;
  avos_editado: number | null;
  obs: string | null;
  teve_reajuste_no_ano: boolean;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function tipoLabel(tipo: string): string {
  switch (tipo) {
    case "clt":
      return "CLT";
    case "clt_recibo":
      return "Híbrido";
    case "pj":
      return "PJ";
    case "mei":
      return "MEI";
    case "estagio":
      return "Estágio";
    case "socio":
      return "Sócio";
    default:
      return tipo;
  }
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

interface Props {
  linhas: LinhaRow[];
  podeEditar: boolean;
}

type OrdemCampo = "nome" | "admissao" | "salario";
type OrdemDirecao = "asc" | "desc";

export function TabelaLinhas({ linhas, podeEditar }: Props) {
  const [linhaAberta, setLinhaAberta] = React.useState<LinhaRow | null>(null);
  const [expandidas, setExpandidas] = React.useState<Set<string>>(new Set());

  const [busca, setBusca] = React.useState("");
  const [filtroEmpresa, setFiltroEmpresa] = React.useState<string>("__all__");
  const [filtroTipo, setFiltroTipo] = React.useState<string>("__all__");
  const [ordemCampo, setOrdemCampo] = React.useState<OrdemCampo>("nome");
  const [ordemDirecao, setOrdemDirecao] = React.useState<OrdemDirecao>("asc");

  const empresasDisponiveis = React.useMemo(() => {
    const set = new Set<string>();
    for (const l of linhas) if (l.empresa) set.add(l.empresa);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [linhas]);

  const tiposDisponiveis = React.useMemo(() => {
    const set = new Set<string>();
    for (const l of linhas) set.add(l.tipo_contratacao);
    return Array.from(set);
  }, [linhas]);

  const linhasFiltradas = React.useMemo(() => {
    const buscaNorm = busca
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();
    const filtradas = linhas.filter((l) => {
      if (filtroEmpresa !== "__all__" && l.empresa !== filtroEmpresa) return false;
      if (filtroTipo !== "__all__" && l.tipo_contratacao !== filtroTipo) return false;
      if (buscaNorm) {
        const nomeNorm = l.nome
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "");
        if (!nomeNorm.includes(buscaNorm)) return false;
      }
      return true;
    });

    const dir = ordemDirecao === "asc" ? 1 : -1;
    filtradas.sort((a, b) => {
      switch (ordemCampo) {
        case "admissao":
          return dir * a.data_admissao.localeCompare(b.data_admissao);
        case "salario": {
          const sa = a.salario_editado ?? a.salario;
          const sb = b.salario_editado ?? b.salario;
          return dir * (sa - sb);
        }
        default:
          return dir * a.nome.localeCompare(b.nome, "pt-BR");
      }
    });
    return filtradas;
  }, [linhas, busca, filtroEmpresa, filtroTipo, ordemCampo, ordemDirecao]);

  function toggleExpansao(id: string) {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleOrdenacao(campo: OrdemCampo) {
    if (ordemCampo === campo) {
      setOrdemDirecao((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setOrdemCampo(campo);
      setOrdemDirecao("asc");
    }
  }

  function limparFiltros() {
    setBusca("");
    setFiltroEmpresa("__all__");
    setFiltroTipo("__all__");
  }

  const temFiltro =
    busca !== "" || filtroEmpresa !== "__all__" || filtroTipo !== "__all__";

  if (linhas.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Nenhuma linha nesta folha.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome…"
            className="pl-9"
          />
        </div>

        <div className="min-w-[200px]">
          <Select value={filtroEmpresa} onValueChange={setFiltroEmpresa}>
            <SelectTrigger>
              <SelectValue placeholder="Empresa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as empresas</SelectItem>
              {empresasDisponiveis.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[180px]">
          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger>
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os tipos</SelectItem>
              {tiposDisponiveis.map((t) => (
                <SelectItem key={t} value={t}>
                  {tipoLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {temFiltro && (
          <button
            type="button"
            onClick={limparFiltros}
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Limpar filtros
          </button>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          {linhasFiltradas.length === linhas.length
            ? `${linhas.length} ${linhas.length === 1 ? "linha" : "linhas"}`
            : `${linhasFiltradas.length} de ${linhas.length}`}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-3 w-8"></th>
              <th className="px-4 py-3 text-left font-medium">
                <HeaderOrdenavel
                  label="Colaborador"
                  campo="nome"
                  ordemCampo={ordemCampo}
                  ordemDirecao={ordemDirecao}
                  onClick={() => toggleOrdenacao("nome")}
                  align="left"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium">Empresa</th>
              <th className="px-4 py-3 text-left font-medium">Tipo</th>
              <th className="px-4 py-3 text-left font-medium">
                <HeaderOrdenavel
                  label="Admissão"
                  campo="admissao"
                  ordemCampo={ordemCampo}
                  ordemDirecao={ordemDirecao}
                  onClick={() => toggleOrdenacao("admissao")}
                  align="left"
                />
              </th>
              <th className="px-4 py-3 text-right font-medium">
                <HeaderOrdenavel
                  label="Salário"
                  campo="salario"
                  ordemCampo={ordemCampo}
                  ordemDirecao={ordemDirecao}
                  onClick={() => toggleOrdenacao("salario")}
                  align="right"
                />
              </th>
              <th className="px-4 py-3 text-center font-medium">Avos</th>
              <th
                className="px-4 py-3 text-right font-medium"
                title="1ª parcela — paga em 30/11, sem descontos"
              >
                1ª parc
              </th>
              <th
                className="px-4 py-3 text-right font-medium"
                title="INSS descontado da 2ª parcela"
              >
                INSS
              </th>
              <th
                className="px-4 py-3 text-right font-medium"
                title="IRRF descontado da 2ª parcela"
              >
                IRRF
              </th>
              <th
                className="px-4 py-3 text-right font-medium"
                title="2ª parcela líquida — valor efetivamente pago em 20/12 (bruto menos INSS menos IRRF)"
              >
                2ª parc líq
              </th>
              <th className="px-4 py-3 text-right font-medium">Total líquido</th>
              <th className="px-4 py-3 text-center font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {linhasFiltradas.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhum colaborador bate com os filtros.
                </td>
              </tr>
            )}
            {linhasFiltradas.map((l) => {
              const ehHibrido = l.parte_clt != null && l.parte_pj != null;
              const expandida = expandidas.has(l.id);
              return (
                <React.Fragment key={l.id}>
                  <tr
                    onClick={() => podeEditar && setLinhaAberta(l)}
                    className={`border-t border-border transition-colors ${podeEditar ? "cursor-pointer hover:bg-muted/40" : ""}`}
                  >
                    <td className="px-2 py-3 text-center">
                      {ehHibrido && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpansao(l.id);
                          }}
                          aria-label={expandida ? "Recolher" : "Expandir"}
                          className="inline-flex items-center justify-center rounded hover:bg-muted p-1 transition-colors"
                        >
                          {expandida ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">
                        {l.nome}
                        {l.teve_reajuste_no_ano && (
                          <span
                            title="Teve mudança de salário no ano — considere ajustar via Editar linha pra aplicar retroativo."
                            className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                          >
                            <TrendingUp className="h-3 w-3" />
                            reajuste
                          </span>
                        )}
                      </div>
                      {l.obs && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {l.obs}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.empresa ?? "—"}
                    </td>
                    <td className="px-4 py-3">{tipoLabel(l.tipo_contratacao)}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {formatarData(l.data_admissao)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {brl.format(l.salario_editado ?? l.salario)}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">
                      {l.avos}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {brl.format(l.primeira_parcela)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {brl.format(l.desconto_inss)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {brl.format(l.desconto_irrf)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {brl.format(
                        l.segunda_parcela - l.desconto_inss - l.desconto_irrf,
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-california-red">
                      {brl.format(l.total_liquido)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {l.editado_manualmente && (
                        <span
                          title="Editado manualmente"
                          className="inline-flex items-center justify-center rounded-full bg-amber-100 p-1 text-amber-700"
                        >
                          <Pencil className="h-3 w-3" />
                        </span>
                      )}
                    </td>
                  </tr>
                  {ehHibrido && expandida && (
                    <>
                      <tr className="bg-muted/20 border-t border-border/50 text-xs">
                        <td className="px-2 py-2"></td>
                        <td className="px-4 py-2 pl-10 text-muted-foreground italic">
                          Parte CLT
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">—</td>
                        <td className="px-4 py-2 text-muted-foreground">CLT</td>
                        <td className="px-4 py-2 text-muted-foreground tabular-nums">
                          {brl.format((l.salario_editado ?? l.salario) - (l.valor_recibo ?? 0))}
                        </td>
                        <td className="px-4 py-2 text-center text-muted-foreground">{l.avos}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl.format(l.parte_clt!.primeira_parcela)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {brl.format(l.parte_clt!.desconto_inss)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {brl.format(l.parte_clt!.desconto_irrf)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl.format(
                            l.parte_clt!.segunda_parcela -
                              l.parte_clt!.desconto_inss -
                              l.parte_clt!.desconto_irrf,
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">
                          {brl.format(l.parte_clt!.total_liquido)}
                        </td>
                        <td className="px-4 py-2"></td>
                      </tr>
                      <tr className="bg-muted/20 border-t border-border/50 text-xs">
                        <td className="px-2 py-2"></td>
                        <td className="px-4 py-2 pl-10 text-muted-foreground italic">
                          Parte PJ (recibo)
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">—</td>
                        <td className="px-4 py-2 text-muted-foreground">PJ</td>
                        <td className="px-4 py-2 text-muted-foreground tabular-nums">
                          {brl.format(l.valor_recibo ?? 0)}
                        </td>
                        <td className="px-4 py-2 text-center text-muted-foreground">{l.avos}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl.format(l.parte_pj!.primeira_parcela)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          —
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          —
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl.format(l.parte_pj!.segunda_parcela)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">
                          {brl.format(l.parte_pj!.total_liquido)}
                        </td>
                        <td className="px-4 py-2"></td>
                      </tr>
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {linhaAberta && (
        <DialogEditarLinha
          linha={linhaAberta}
          onClose={() => setLinhaAberta(null)}
        />
      )}
    </div>
  );
}

function HeaderOrdenavel({
  label,
  campo,
  ordemCampo,
  ordemDirecao,
  onClick,
  align,
}: {
  label: string;
  campo: OrdemCampo;
  ordemCampo: OrdemCampo;
  ordemDirecao: OrdemDirecao;
  onClick: () => void;
  align: "left" | "right";
}) {
  const ativo = ordemCampo === campo;
  const Icon = !ativo
    ? ArrowUpDown
    : ordemDirecao === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
        ativo ? "text-foreground" : ""
      } ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      {label}
      <Icon className="h-3 w-3" />
    </button>
  );
}
