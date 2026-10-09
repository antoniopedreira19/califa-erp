"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MultiSelectRegionais } from "@/components/ui/multi-select-regionais";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Empresa,
  FolhaLinhaStatus,
  FolhaOrigem,
  TipoContratacao,
} from "@/lib/types";
import { folhaLinhaStatusLabel, tipoContratacaoLabel } from "@/lib/types";
import {
  formaDePagamento,
  rotuloTipoPix,
  type ColaboradorPagamento,
} from "@/lib/financeiro/colaboradores-pagamento";
import { RevisarFolhaDrawer } from "./revisar-folha-drawer";
import {
  BarraDosFiltrosDeColuna,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export type FolhaLinhaFinanceiro = {
  id: string;
  competencia_ano: number;
  competencia_mes: number;
  salario_base: string;
  status: FolhaLinhaStatus;
  motivo_pendencia: string | null;
  /** Origem da linha: "california" (fluxo PJ) ou "contabilidade" (fluxo CLT). */
  origem: FolhaOrigem;
  /** NF anexada pra essa (colab, competência). Só relevante quando origem=california
   *  e tipo in (pj, mei, clt_recibo). */
  nf: {
    id: string;
    arquivo_nome: string;
    uploaded_at: string;
  } | null;
  /**
   * O colaborador inteiro como o financeiro enxerga (decisão 132): nome,
   * contratação, documentos e pagamento. Obrigatório de propósito — um
   * campo a menos aqui sumiria em silêncio da tela (CLAUDE.md).
   */
  colaborador: ColaboradorPagamento;
  alocacoes: {
    id: string;
    empresa_id: string;
    regional_id: string;
    percentual: string;
    empresa_nome: string;
    regional_nome: string;
  }[];
};

type StatusFiltro = "todos" | FolhaLinhaStatus;
type TipoFiltro = "todos" | TipoContratacao;
type OrigemFiltro = "todas" | FolhaOrigem;

const ORDEM_TIPO: TipoContratacao[] = ["pj", "mei", "clt_recibo", "clt", "estagio", "socio"];

/**
 * Linha com mais de uma regional no rateio. No filtro de regionais ela fica
 * num grupo só, e não em cada regional do rateio (pedido do Tiago em
 * 30/09/2026). O nome é o da lista de colaboradores do RH, que chama de
 * "Hub" quem é alocado em todas as regionais pelo rateio anual — em
 * setembro, as 25 linhas com mais de uma regional eram exatamente os 25 Hub.
 */
const HUB = "__hub__";

function regionaisDaLinha(l: FolhaLinhaFinanceiro): string[] {
  return [...new Set(l.alocacoes.map((a) => a.regional_id))];
}

function percentualCurto(p: string): string {
  return Number(p).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

/** O número da competência: 202609 para setembro de 2026. */
function chaveCompetencia(l: FolhaLinhaFinanceiro): number {
  return l.competencia_ano * 100 + l.competencia_mes;
}

/** A ordem dos status no funil: a da esteira (o RH envia, o financeiro devolve). */
const ORDEM_DO_STATUS: FolhaLinhaStatus[] = ["rascunho", "enviada", "pendente_correcao", "aprovada", "paga"];

/** O selo da coluna Pagamento, em texto — é por ele que a coluna filtra. */
function rotuloDoPagamento(c: ColaboradorPagamento): string {
  const forma = formaDePagamento(c);
  if (forma === "pix" && c.pix_tipo) return `PIX · ${rotuloTipoPix(c.pix_tipo)}`;
  if (forma === "conta") return "TED";
  return "Sem dados";
}

/**
 * As colunas que filtram e ordenam pelo título, como no Excel (pedido do
 * Tiago, 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job). Substituem o
 * cabeçalho que só ordenava (Colaborador e Valor).
 *
 * A competência continua agrupando: com ordem por outro título, as linhas
 * se ordenam DENTRO de cada competência, e a competência mais recente
 * segue em cima. Só o título Competência inverte a ordem delas.
 */
const COLUNAS: ColunaFiltravel<FolhaLinhaFinanceiro>[] = [
  {
    chave: "competencia",
    rotulo: "Competência",
    tipo: "data",
    // Lista com a mais recente em cima, como a tabela.
    celula: (l) => ({
      valor: String(chaveCompetencia(l)),
      rotulo: `${NOMES_MES[l.competencia_mes - 1]}/${l.competencia_ano}`,
      ordem: chaveCompetencia(l),
      ordemNaLista: -chaveCompetencia(l),
    }),
  },
  {
    chave: "colaborador",
    rotulo: "Colaborador",
    tipo: "texto",
    // A busca da coluna acha pela função também, como a busca de cima.
    celula: (l) => ({
      ...celulaTexto(l.colaborador.nome),
      busca: `${l.colaborador.nome} ${l.colaborador.funcao}`,
    }),
  },
  {
    chave: "alocacao",
    rotulo: "Alocação",
    tipo: "texto",
    // Árvore empresa ▸ regional. A linha do rateio em várias regionais é
    // um valor só ("Hub"), como no filtro de regionais de cima (pedido do
    // Tiago, 30/09/2026) — e não uma entrada em cada regional do rateio.
    // Na lista: as empresas em ordem alfabética, com o Hub no topo de cada
    // uma, e o rateio entre empresas por último.
    celula: (l) => {
      const nomes = [...new Set(l.alocacoes.map((a) => a.empresa_nome))];
      const empresas = nomes.join(" + ");
      if (regionaisDaLinha(l).length > 1) {
        return {
          valor: `hub|${empresas}`,
          rotulo: "Hub · várias regionais",
          ordem: `${nomes.length > 1 ? 2 : 1} ${empresas} 0`,
          grupo: empresas,
        };
      }
      const a = l.alocacoes[0];
      if (!a) return { ...celulaTexto(null), grupo: "" };
      return {
        valor: `${a.empresa_id}|${a.regional_id}`,
        rotulo: a.regional_nome,
        ordem: `1 ${a.empresa_nome} 1 ${a.regional_nome}`,
        grupo: a.empresa_nome,
      };
    },
    rotuloSemGrupo: "(sem alocação)",
  },
  {
    chave: "pagamento",
    rotulo: "Pagamento",
    tipo: "texto",
    celula: (l) => celulaTexto(rotuloDoPagamento(l.colaborador)),
  },
  {
    chave: "valor",
    rotulo: "Valor",
    tipo: "valor",
    faixa: true,
    alinhar: "right",
    celula: (l) => celulaValor(Number(l.salario_base), formatBRL),
  },
  {
    chave: "status",
    rotulo: "Status",
    tipo: "texto",
    // Última coluna, encostada na borda: o cartão abre centrado embaixo do
    // título para não passar da tela (o título continua à esquerda).
    alinhar: "center",
    celula: (l) => ({
      ...celulaTexto(folhaLinhaStatusLabel(l.status)),
      ordemNaLista: ORDEM_DO_STATUS.indexOf(l.status),
    }),
  },
];

/** O título da folha é em caixa normal: o botão do filtro não muda isso. */
const TITULO = "normal-case tracking-normal";

export function FolhasPagarList({
  linhas,
  empresas,
  regionais,
}: {
  linhas: FolhaLinhaFinanceiro[];
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
}) {
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("todos");
  const [tipo, setTipo] = React.useState<TipoFiltro>("todos");
  const [origem, setOrigem] = React.useState<OrigemFiltro>("todas");
  // Vazio = todas as regionais, como no filtro da aba de PPs.
  const [regionaisFiltro, setRegionaisFiltro] = React.useState<string[]>([]);
  // Pelo id, e não pelo objeto: depois de um refresh (salvar o pagamento,
  // por exemplo) o painel mostra a linha atualizada.
  const [revisandoId, setRevisandoId] = React.useState<string | null>(null);
  const linhaRevisando = linhas.find((l) => l.id === revisandoId) ?? null;

  // Só as regionais que têm linha, cada uma com a contagem; o Hub primeiro,
  // como na lista de colaboradores do RH.
  const opcoesRegional = React.useMemo(() => {
    const porRegional = new Map<string, { nome: string; n: number }>();
    let hub = 0;
    for (const l of linhas) {
      const regionais = regionaisDaLinha(l);
      if (regionais.length > 1) {
        hub += 1;
        continue;
      }
      const a = l.alocacoes[0];
      if (!a) continue;
      const atual = porRegional.get(a.regional_id) ?? { nome: a.regional_nome, n: 0 };
      atual.n += 1;
      porRegional.set(a.regional_id, atual);
    }
    const lista = [...porRegional.entries()]
      .sort((x, y) => x[1].nome.localeCompare(y[1].nome, "pt-BR"))
      .map(([id, v]) => ({ id, nome: `${v.nome} (${v.n})` }));
    return hub > 0
      ? [{ id: HUB, nome: `Hub · várias regionais (${hub})` }, ...lista]
      : lista;
  }, [linhas]);

  // Regional que some da lista (a última linha dela foi aprovada) sai da
  // seleção, senão o filtro fica preso a ela sem aparecer no seletor.
  React.useEffect(() => {
    setRegionaisFiltro((sel) => {
      const validas = sel.filter((id) => opcoesRegional.some((o) => o.id === id));
      return validas.length === sel.length ? sel : validas;
    });
  }, [opcoesRegional]);

  // A regional recorta o universo antes das contagens, como na aba de PPs:
  // senão os números dos seletores não batem com a tabela.
  const linhasPorRegional = React.useMemo(() => {
    if (regionaisFiltro.length === 0 || regionaisFiltro.length === opcoesRegional.length) {
      return linhas;
    }
    const sel = new Set(regionaisFiltro);
    return linhas.filter((l) => {
      const regionais = regionaisDaLinha(l);
      return regionais.length > 1 ? sel.has(HUB) : sel.has(regionais[0]);
    });
  }, [linhas, regionaisFiltro, opcoesRegional.length]);

  const tiposPresentes = React.useMemo(() => {
    const presentes = new Set(linhas.map((l) => l.colaborador.tipo_contratacao));
    return ORDEM_TIPO.filter((t) => presentes.has(t));
  }, [linhas]);

  /** As linhas que passam nos filtros de CIMA, na ordem de sempre:
   *  competência mais recente primeiro, como vem do servidor; dentro dela,
   *  o nome de A a Z, sem distinguir acento ("Álvaro" fica entre os A). Os
   *  filtros dos títulos vêm depois, sobre esta lista. */
  const doTopo = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhasPorRegional
      .filter((l) => {
        if (status !== "todos" && l.status !== status) return false;
        if (tipo !== "todos" && l.colaborador.tipo_contratacao !== tipo) return false;
        if (origem !== "todas" && l.origem !== origem) return false;
        if (!q) return true;
        return (
          l.colaborador.nome.toLowerCase().includes(q) ||
          l.colaborador.funcao.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          chaveCompetencia(b) - chaveCompetencia(a) ||
          a.colaborador.nome.localeCompare(b.colaborador.nome, "pt-BR", { sensitivity: "base" }),
      );
  }, [linhasPorRegional, busca, status, tipo, origem]);

  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "contas-a-pagar-folhas" });
  /** O que passa em tudo — a base da tabela e da soma do canto. */
  const filtradas = colunas.visiveis;

  // A competência continua agrupando: com ordem por outro título, a lista
  // volta para a competência mais recente em cima, e o título escolhido
  // ordena DENTRO de cada uma (a ordenação é estável). Só o título
  // Competência inverte a ordem das competências.
  const ordenadas = React.useMemo(
    () =>
      colunas.ordenacao?.coluna === "competencia"
        ? filtradas
        : [...filtradas].sort((a, b) => chaveCompetencia(b) - chaveCompetencia(a)),
    [filtradas, colunas.ordenacao],
  );

  const contagem = React.useMemo(() => {
    const c = { enviada: 0, pendente_correcao: 0 };
    for (const l of linhasPorRegional) {
      if (l.status === "enviada") c.enviada += 1;
      if (l.status === "pendente_correcao") c.pendente_correcao += 1;
    }
    return c;
  }, [linhasPorRegional]);

  const totalFiltrado = filtradas.reduce(
    (acc, l) => acc + Math.round(Number(l.salario_base) * 100),
    0,
  ) / 100;
  const semPagamento = filtradas.filter(
    (l) => formaDePagamento(l.colaborador) === null,
  ).length;

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma folha aguardando ação. Quando o RH enviar, aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Input
            placeholder="Buscar por nome ou função..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFiltro)}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos ({linhasPorRegional.length})</SelectItem>
            <SelectItem value="enviada">
              Aguardando aprovação ({contagem.enviada})
            </SelectItem>
            <SelectItem value="pendente_correcao">
              Aguardando o RH corrigir ({contagem.pendente_correcao})
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFiltro)}>
          <SelectTrigger className="w-56" aria-label="Contratação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as contratações</SelectItem>
            {tiposPresentes.map((t) => (
              <SelectItem key={t} value={t}>
                {tipoContratacaoLabel(t)} (
                {linhasPorRegional.filter((l) => l.colaborador.tipo_contratacao === t).length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={origem}
          onValueChange={(v) => setOrigem(v as OrigemFiltro)}
        >
          <SelectTrigger className="w-48" aria-label="Origem da folha">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">
              Origem: Todas ({linhasPorRegional.length})
            </SelectItem>
            <SelectItem value="california">
              Origem: PJ (
              {linhasPorRegional.filter((l) => l.origem === "california").length}
              )
            </SelectItem>
            <SelectItem value="contabilidade">
              Origem: CLT (
              {
                linhasPorRegional.filter((l) => l.origem === "contabilidade")
                  .length
              }
              )
            </SelectItem>
          </SelectContent>
        </Select>
        <MultiSelectRegionais
          regionais={opcoesRegional}
          selecionadas={regionaisFiltro}
          onSelectionChange={setRegionaisFiltro}
          className="h-11 w-56 justify-between rounded-lg px-3.5 text-sm font-normal"
        />
        <p className="ml-auto text-sm text-muted-foreground">
          {filtradas.length} {filtradas.length === 1 ? "linha" : "linhas"} ·{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatBRL(totalFiltrado)}
          </span>
          {semPagamento > 0 && (
            <span className="text-california-red"> · {semPagamento} sem pagamento</span>
          )}
        </p>
      </div>

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="linha"
          plural="linhas"
          onLimpar={colunas.limpar}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                {colunas.titulo("competencia", TITULO)}
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                {colunas.titulo("colaborador", TITULO)}
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                {colunas.titulo("alocacao", TITULO)}
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">
                {colunas.titulo("pagamento", TITULO)}
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-40">
                {colunas.titulo("valor", TITULO)}
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">
                {colunas.titulo("status", TITULO)}
              </th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((l) => (
              <tr
                key={l.id}
                onClick={() => setRevisandoId(l.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setRevisandoId(l.id);
                  }
                }}
                className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3 text-muted-foreground tabular-nums">
                  {NOMES_MES[l.competencia_mes - 1]}/{l.competencia_ano}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.colaborador.nome}</span>
                    <SeloContratacao tipo={l.colaborador.tipo_contratacao} />
                    <SeloOrigem origem={l.origem} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {l.colaborador.funcao}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  <AlocacaoDaLinha linha={l} />
                </td>
                <td className="px-4 py-3">
                  <SeloPagamento colaborador={l.colaborador} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {formatBRL(Number(l.salario_base))}
                </td>
                <td className="px-4 py-3">
                  <BadgeStatus status={l.status} />
                  {l.status === "pendente_correcao" && l.motivo_pendencia && (
                    <div className="mt-1 flex items-start gap-1 text-[10px] text-california-red">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{l.motivo_pendencia}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  {/* Vazia pelos títulos, a tabela fica (com os títulos,
                      para desfazer) e diz que foi o filtro. */}
                  {doTopo.length === 0
                    ? "Nenhuma linha corresponde aos filtros."
                    : "Nenhuma linha com esse filtro."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {linhaRevisando && (
        <RevisarFolhaDrawer
          linha={linhaRevisando}
          empresas={empresas}
          regionais={regionais}
          open={!!linhaRevisando}
          onOpenChange={(next) => {
            if (!next) setRevisandoId(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Uma regional: "Agência California · SP · 100%". Mais de uma: a empresa com
 * "Hub" e o rateio numa linha só, em vez de uma linha por regional.
 */
function AlocacaoDaLinha({ linha }: { linha: FolhaLinhaFinanceiro }) {
  if (regionaisDaLinha(linha).length > 1) {
    const empresas = [...new Set(linha.alocacoes.map((a) => a.empresa_nome))].join(" + ");
    return (
      <div>
        <div>
          {empresas} · <span className="font-semibold text-foreground">Hub</span>
        </div>
        <div className="tabular-nums">
          {linha.alocacoes
            .map((a) => `${a.regional_nome} ${percentualCurto(a.percentual)}%`)
            .join(" · ")}
        </div>
      </div>
    );
  }
  return (
    <>
      {linha.alocacoes.map((a) => (
        <div key={a.id}>
          {a.empresa_nome} · {a.regional_nome} ·{" "}
          <span className="tabular-nums font-medium">{percentualCurto(a.percentual)}%</span>
        </div>
      ))}
    </>
  );
}

/** CLT e estágio em âmbar: esperam o líquido da contabilidade. */
function SeloContratacao({ tipo }: { tipo: TipoContratacao }) {
  const clt = tipo === "clt" || tipo === "estagio";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold ${
        clt
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-border text-muted-foreground"
      }`}
    >
      {tipoContratacaoLabel(tipo)}
    </span>
  );
}

/** Rótulo do fluxo que originou a linha (PJ = California gerou; CLT = veio da contabilidade). */
function SeloOrigem({ origem }: { origem: FolhaOrigem }) {
  const pj = origem === "california";
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold ${
        pj ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"
      }`}
      title={
        pj ? "Gerada pela California (fluxo PJ)" : "Importada da contabilidade (fluxo CLT)"
      }
    >
      {pj ? "PJ" : "CLT"}
    </span>
  );
}

function SeloPagamento({ colaborador }: { colaborador: ColaboradorPagamento }) {
  const forma = formaDePagamento(colaborador);
  if (forma === "pix" && colaborador.pix_tipo) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        PIX · {rotuloTipoPix(colaborador.pix_tipo)}
      </span>
    );
  }
  if (forma === "conta") {
    return (
      <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
        TED
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-md bg-california-red/10 px-2 py-0.5 text-[11px] font-semibold text-california-red">
      Sem dados
    </span>
  );
}

function BadgeStatus({ status }: { status: FolhaLinhaStatus }) {
  const cores: Record<FolhaLinhaStatus, string> = {
    rascunho: "bg-muted text-muted-foreground",
    enviada: "bg-blue-50 text-blue-700",
    aprovada: "bg-emerald-50 text-emerald-700",
    pendente_correcao: "bg-california-red/10 text-california-red",
    paga: "bg-emerald-600 text-white",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cores[status]}`}
    >
      {folhaLinhaStatusLabel(status)}
    </span>
  );
}
