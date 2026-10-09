"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  FrequenciaRecorrencia,
  PlanoContaTipo,
  PlanoContaSubtipo,
} from "@/lib/types";
import { ContaRecorrenteDrawer } from "./conta-recorrente-drawer";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

// ---------------------------------------------------------------------------
// Tipos exportados
// ---------------------------------------------------------------------------

export interface RecorrenteRow {
  id: string;
  descricao: string;
  valor: number;
  frequencia: FrequenciaRecorrencia;
  dia_do_mes: number | null;
  dia_quinzena_1: number | null;
  dia_quinzena_2: number | null;
  dia_do_ano_dia: number | null;
  dia_do_ano_mes: number | null;
  proxima_data: string;
  data_fim: string | null;
  ativo: boolean;
  fornecedor_nome: string | null;
  empresa_nome: string;
  tipo_codigo: string;
  subtipo_nome: string;
}

// ---------------------------------------------------------------------------
// Constantes de filtros
// ---------------------------------------------------------------------------

type AtivoFiltro = "ativas" | "paradas" | "todas";

const ATIVO_FILTROS: Array<{ key: AtivoFiltro; label: string }> = [
  { key: "ativas", label: "Ativas" },
  { key: "paradas", label: "Paradas" },
  { key: "todas", label: "Todas" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MESES_ABR = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function formatFrequenciaResumo(r: RecorrenteRow): string {
  if (r.frequencia === "mensal") return `Mensal · dia ${r.dia_do_mes}`;
  if (r.frequencia === "quinzenal")
    return `Quinzenal · ${r.dia_quinzena_1} e ${r.dia_quinzena_2}`;
  return `Anual · ${r.dia_do_ano_dia}/${MESES_ABR[(r.dia_do_ano_mes ?? 1) - 1]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Filtro e ordem pelo título da coluna, como no Excel (pedido do Tiago,
// 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job). Fica de fora só a coluna
// Ações (o link "Ver detalhes").
// ---------------------------------------------------------------------------

/** Em ordem alfabética: "de A a Z" põe Anual, Mensal e Quinzenal nessa
 *  ordem, e o dia (ou dia e mês) ordena como número dentro de cada uma. */
const FREQUENCIAS: Array<[FrequenciaRecorrencia, string]> = [
  ["anual", "Anual"],
  ["mensal", "Mensal"],
  ["quinzenal", "Quinzenal"],
];

/** Ordena pelo tipo e, dentro dele, pelo dia — "dia 3" antes de "dia 10". */
function ordemDaFrequencia(r: RecorrenteRow): number {
  const tipo = FREQUENCIAS.findIndex(([f]) => f === r.frequencia);
  const dia =
    r.frequencia === "mensal"
      ? (r.dia_do_mes ?? 0)
      : r.frequencia === "quinzenal"
        ? (r.dia_quinzena_1 ?? 0)
        : (r.dia_do_ano_mes ?? 0) * 100 + (r.dia_do_ano_dia ?? 0);
  return tipo * 10000 + dia;
}

const COLUNAS: ColunaFiltravel<RecorrenteRow>[] = [
  { chave: "descricao", rotulo: "Descrição", tipo: "texto", celula: (r) => celulaTexto(r.descricao) },
  {
    // Árvore tipo ▸ dia, como a célula: "Mensal ▸ Mensal · dia 5".
    chave: "frequencia",
    rotulo: "Frequência",
    tipo: "texto",
    celula: (r) => ({
      ...celulaTexto(formatFrequenciaResumo(r)),
      ordem: ordemDaFrequencia(r),
      grupo: FREQUENCIAS.find(([f]) => f === r.frequencia)?.[1] ?? "",
    }),
  },
  { chave: "proxima", rotulo: "Próxima data", tipo: "data", celula: (r) => celulaData(r.proxima_data) },
  { chave: "fornecedor", rotulo: "Fornecedor", tipo: "texto", celula: (r) => celulaTexto(r.fornecedor_nome) },
  { chave: "empresa", rotulo: "Empresa", tipo: "texto", celula: (r) => celulaTexto(r.empresa_nome) },
  {
    chave: "valor",
    rotulo: "Valor",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (r) => celulaValor(r.valor, formatMoney),
  },
  {
    chave: "status",
    rotulo: "Status",
    tipo: "texto",
    celula: (r) => ({ ...celulaTexto(r.ativo ? "Ativa" : "Parada"), ordemNaLista: r.ativo ? 0 : 1 }),
  },
];

// ---------------------------------------------------------------------------
// Props do componente
// ---------------------------------------------------------------------------

interface Props {
  rows: RecorrenteRow[];
  tenantId: string;
  empresas: Array<{ id: string; nome: string }>;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** `cpf_cnpj` é a chave de busca e a segunda linha da opção do campo
   *  de fornecedor (decisão 067). Ele SÓ atravessa até aqui se cada
   *  fronteira declarar o campo: tipo de prop estreito não apaga o dado
   *  em tempo de execução, mas apaga do tipo — e o próximo `.map` no
   *  caminho o descartaria de vez, com `tsc` limpo. */
  fornecedores: Array<{ id: string; nome: string; cpf_cnpj?: string | null }>;
  clientes: Array<{ id: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  cartoes: CartaoOption[];
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function RecorrentesList({
  rows,
  tenantId,
  empresas,
  tipos,
  subtipos,
  fornecedores,
  clientes,
  regionais,
  cartoes,
}: Props) {
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [ativoFiltro, setAtivoFiltro] = React.useState<AtivoFiltro>("ativas");

  /** O que passa nos filtros de CIMA (chip e busca). Os dos títulos vêm
   *  depois, sobre esta lista. */
  const doTopo = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (ativoFiltro === "ativas" && !r.ativo) return false;
      if (ativoFiltro === "paradas" && r.ativo) return false;
      if (!q) return true;
      return (
        r.descricao.toLowerCase().includes(q) ||
        (r.fornecedor_nome ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, busca, ativoFiltro]);
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "contas-a-pagar-recorrencias" });
  const filtered = colunas.visiveis;

  return (
    <div className="space-y-4">
      {/* Barra de filtros + busca + botão nova recorrência */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Chips de status */}
          {ATIVO_FILTROS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setAtivoFiltro(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                ativoFiltro === f.key
                  ? "border-california-red bg-california-red text-white"
                  : "border-border bg-white text-muted-foreground hover:border-california-red/50",
              )}
            >
              {f.label}
            </button>
          ))}

          {/* Campo de busca */}
          <div className="relative ml-auto flex-1 min-w-[240px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por descrição ou fornecedor..."
              className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
            />
          </div>
        </div>

        {/* Botão nova recorrência */}
        <ContaRecorrenteDrawer
          mode="criar"
          tenantId={tenantId}
          empresas={empresas}
          tipos={tipos}
          subtipos={subtipos}
          fornecedores={fornecedores}
          clientes={clientes}
          regionais={regionais}
          cartoes={cartoes}
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <Plus className="h-4 w-4" />
              Nova recorrência
            </button>
          }
        />
      </div>

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="recorrência"
          plural="recorrências"
          onLimpar={colunas.limpar}
        />
      )}

      {/* Tabela ou empty state. O vazio pelos filtros dos títulos não troca
          a tabela pelo aviso: ela fica, com os títulos, para desfazer. */}
      {doTopo.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhuma recorrência cadastrada ainda."
              : "Nenhuma recorrência corresponde aos filtros aplicados."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                {/* `tracking-normal`: o cabeçalho desta tabela não tem o
                    espaçamento largo que o botão do título traz. */}
                <th className="px-3 py-2 text-left">{colunas.titulo("descricao", "tracking-normal")}</th>
                <th className="px-3 py-2 text-left">{colunas.titulo("frequencia", "tracking-normal")}</th>
                <th className="px-3 py-2 text-left">{colunas.titulo("proxima", "tracking-normal")}</th>
                <th className="px-3 py-2 text-left">{colunas.titulo("fornecedor", "tracking-normal")}</th>
                <th className="px-3 py-2 text-left">{colunas.titulo("empresa", "tracking-normal")}</th>
                <th className="px-3 py-2 text-right">{colunas.titulo("valor", "tracking-normal")}</th>
                <th className="px-3 py-2 text-left">{colunas.titulo("status", "tracking-normal")}</th>
                <th className="px-3 py-2 text-left">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma recorrência com esse filtro.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/financeiro/contas-a-pagar/recorrente/${r.id}`)}
                  className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                >
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/financeiro/contas-a-pagar/recorrente/${r.id}`}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-california-red hover:underline"
                    >
                      {r.descricao}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {formatFrequenciaResumo(r)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {formatDate(r.proxima_data)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.fornecedor_nome ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.empresa_nome}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                    {formatMoney(r.valor)}
                  </td>
                  <td className="px-3 py-2">
                    {r.ativo ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                        Ativa
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        Parada
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/financeiro/contas-a-pagar/recorrente/${r.id}`}
                      prefetch={false}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-muted-foreground hover:text-california-red hover:underline"
                    >
                      Ver detalhes
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
