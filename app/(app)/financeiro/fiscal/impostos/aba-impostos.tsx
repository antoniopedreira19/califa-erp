"use client";

/**
 * A aba Impostos a Pagar da seção Fiscal (módulo fiscal, entrega 2 —
 * desenho aprovado pelo Tiago no protótipo de 30/09 a 02/10/2026).
 *
 * Os títulos que a aprovação de uma guia cria (e os lançados à mão), com o
 * status (A pagar · Vencidos · Pagos · Todos), o filtro de PJ, a busca, os
 * totais e a tabela. Daqui se dá baixa (uma a uma ou em lote), se corrige o
 * valor quando a guia da contabilidade vem diferente, se lança um imposto
 * avulso e se confere — e, se preciso, cancela — a baixa registrada.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  CreditCard,
  Eye,
  Info,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Wallet,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BaixaEmLoteDialog,
  BarraDeSelecao,
  CaixaDaLinha,
  CaixaDoCabecalho,
  useSelecao,
  type TituloParaLote,
} from "@/components/financeiro/baixa-em-lote";
import { LinkAnexo, nomeDoAnexo } from "@/components/financeiro/anexo-de-imposto";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import type { DadosDosImpostos, ImpostoDaLista } from "./dados";
import {
  AvulsoDialog,
  BaixaImpostoDialog,
  BaixaRegistradaDialog,
  CancelarImpostoDialog,
  CorrigirDialog,
  br,
  hojeIso,
  moeda,
  r2,
  somaDias,
} from "./dialogos";
import { paraOLoteImposto } from "./lote";

type Filtro = "a_pagar" | "vencidos" | "pagos" | "todos";

type Status = "pago" | "vencido" | "a_pagar" | "cancelado";

function statusDo(t: ImpostoDaLista, hoje: string): Status {
  if (t.status === "pago") return "pago";
  // Decisão 145: cancelado à mão, com motivo; só aparece em "Todos".
  if (t.status === "cancelado") return "cancelado";
  return t.vencimento < hoje ? "vencido" : "a_pagar";
}

/** Em aberto: nem pago, nem cancelado. */
const estaEmAberto = (t: ImpostoDaLista) => t.status === "a_pagar";

// ---------------------------------------------------------------------------
// Filtro e ordem pelo título da coluna, como no Excel (pedido do Tiago,
// 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job)
// ---------------------------------------------------------------------------

const ROTULO_DO_STATUS: Record<Status, string> = {
  a_pagar: "A pagar",
  vencido: "Vencido",
  pago: "Pago",
  cancelado: "Cancelado",
};
const ORDEM_DO_STATUS: Status[] = ["a_pagar", "vencido", "pago", "cancelado"];

const ROTULO_DA_ORIGEM = { apuracao: "Apuração", diferenca: "Complementar", avulso: "Avulso" } as const;
const ORDEM_DA_ORIGEM = ["apuracao", "diferenca", "avulso"];

/** A competência na ordem do tempo: o trimestre entra depois do último mês
 *  dele ("2026-T4" → "2026-12z"). */
function ordemDaCompetencia(c: string): string {
  const t = /^(\d{4})-T(\d)$/.exec(c);
  return t ? `${t[1]}-${String(Number(t[2]) * 3).padStart(2, "0")}z` : c;
}

function colunasDosImpostos(hoje: string): ColunaFiltravel<ImpostoDaLista>[] {
  return [
    { chave: "vencimento", rotulo: "Vencimento", tipo: "data", alinhar: "center", celula: (t) => celulaData(t.vencimento) },
    {
      // O imposto (o título); a busca acha também pelo DARF, pela cota, pelo
      // município da guia municipal e pela descrição do avulso.
      chave: "imposto",
      rotulo: "Imposto",
      tipo: "texto",
      celula: (t) => ({
        ...celulaTexto(t.titulo),
        busca: [
          t.titulo,
          t.cota_numero ? `cota ${t.cota_numero}/${t.cota_total}` : "",
          t.codigo_receita ? `DARF ${t.codigo_receita}` : "",
          t.municipio ?? "",
          t.origem === "avulso" ? t.descricao : "",
        ].join(" "),
      }),
    },
    {
      // Árvore PJ ▸ o nome que a célula mostra em cima: a PJ (as guias
      // federais, pelo CNPJ da matriz) e cada estabelecimento (as guias
      // municipais). A PJ marca todos de uma vez; a busca acha pelo CNPJ.
      chave: "cnpj",
      rotulo: "CNPJ",
      tipo: "texto",
      rotuloSemGrupo: "(sem PJ)",
      celula: (t) => ({
        valor: `${t.local}|${t.cnpj}`,
        rotulo: t.local,
        ordem: `${t.local === t.pj ? "0" : "1"}${t.local}`,
        busca: `${t.local} ${t.cnpj} ${t.pj}`,
        grupo: t.pj,
      }),
    },
    {
      chave: "competencia",
      rotulo: "Competência",
      tipo: "texto",
      alinhar: "center",
      celula: (t) => ({ ...celulaTexto(t.rotulo_competencia), ordem: ordemDaCompetencia(t.competencia) }),
    },
    {
      chave: "origem",
      rotulo: "Origem",
      tipo: "texto",
      alinhar: "center",
      celula: (t) => ({ ...celulaTexto(ROTULO_DA_ORIGEM[t.origem]), ordemNaLista: ORDEM_DA_ORIGEM.indexOf(t.origem) }),
    },
    {
      chave: "valor",
      rotulo: "Valor",
      tipo: "valor",
      faixa: true,
      alinhar: "right",
      celula: (t) => celulaValor(t.valor, moeda),
    },
    {
      // Com ou sem a guia anexada; a busca acha pelo nome do arquivo.
      chave: "guia",
      rotulo: "Guia",
      tipo: "texto",
      celula: (t) => ({
        ...celulaTexto(t.guia_path ? "Com guia" : "Sem guia"),
        busca: `${t.guia_path ? `com guia ${nomeDoAnexo(t.guia_path)}` : "sem guia"}${t.comprovante_path ? " comprovante" : ""}`,
      }),
    },
    {
      // A lista na ordem do pagamento; as linhas, de A a Z pelo rótulo.
      chave: "status",
      rotulo: "Status",
      tipo: "texto",
      alinhar: "center",
      celula: (t) => {
        const s = statusDo(t, hoje);
        return { ...celulaTexto(ROTULO_DO_STATUS[s]), ordemNaLista: ORDEM_DO_STATUS.indexOf(s) };
      },
    },
  ];
}

export function AbaImpostos({ dados }: { dados: DadosDosImpostos }) {
  const router = useRouter();
  const hoje = hojeIso();
  const [filtro, setFiltro] = React.useState<Filtro>("a_pagar");
  const [pjFiltro, setPjFiltro] = React.useState<string>("todos");
  const [busca, setBusca] = React.useState("");
  const [baixandoId, setBaixandoId] = React.useState<string | null>(null);
  const [corrigindoId, setCorrigindoId] = React.useState<string | null>(null);
  const [cancelandoId, setCancelandoId] = React.useState<string | null>(null);
  const [vendoId, setVendoId] = React.useState<string | null>(null);
  const [criando, setCriando] = React.useState(false);
  /** "Criar e dar baixa": a baixa abre quando o imposto novo chega da página. */
  const [baixarDepois, setBaixarDepois] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const titulos = dados.impostos;
  const porId = (id: string | null) => (id ? titulos.find((t) => t.id === id) ?? null : null);

  React.useEffect(() => {
    if (!baixarDepois) return;
    if (titulos.some((t) => t.id === baixarDepois)) {
      setBaixandoId(baixarDepois);
      setBaixarDepois(null);
    }
  }, [baixarDepois, titulos]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const nomesDasPJs = React.useMemo(
    () => Object.fromEntries(dados.pjs.map((p) => [p.id, p.nome])),
    [dados.pjs],
  );

  const q = busca.trim().toLowerCase();
  const base = titulos.filter(
    (t) =>
      (pjFiltro === "todos" || t.empresa_contabil_id === pjFiltro) &&
      (!q ||
        `${t.titulo} ${t.descricao} ${t.codigo_receita ?? ""} ${t.local} ${t.cnpj} ${t.rotulo_competencia}`
          .toLowerCase()
          .includes(q)),
  );
  /** Os impostos que passam nos filtros de CIMA (status, PJ e busca). Os
   *  filtros dos títulos das colunas vêm depois, sobre esta lista. */
  // Memorizada: o gancho dos títulos recalcula as células quando a lista muda.
  const doTopo = React.useMemo(
    () =>
      base
        .filter((t) => {
          const s = statusDo(t, hoje);
          if (filtro === "a_pagar") return s === "a_pagar" || s === "vencido";
          if (filtro === "vencidos") return s === "vencido";
          if (filtro === "pagos") return s === "pago";
          return true;
        })
        .sort((a, b) =>
          filtro === "pagos"
            ? (b.pago_em ?? "").localeCompare(a.pago_em ?? "")
            : a.vencimento.localeCompare(b.vencimento),
        ),
    // `base` sai de `titulos`, `pjFiltro` e `q`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [titulos, pjFiltro, q, filtro, hoje],
  );
  const colunasDaTabela = React.useMemo(() => colunasDosImpostos(hoje), [hoje]);
  const colunas = useFiltrosDeColuna(doTopo, colunasDaTabela, { guardarEm: "fiscal-impostos" });
  /** Os impostos que passam em tudo, na ordem do título escolhido (sem
   *  nenhum, a de sempre). A seleção do lote sai daqui: só o que está na tela. */
  const filtrados = colunas.visiveis;

  const abertos = titulos.filter(estaEmAberto);
  const limite = somaDias(hoje, 7);
  const emAberto = r2(abertos.reduce((s, t) => s + t.valor, 0));
  const semana = r2(
    abertos.filter((t) => t.vencimento >= hoje && t.vencimento <= limite).reduce((s, t) => s + t.valor, 0),
  );
  const vencidos = abertos.filter((t) => t.vencimento < hoje);
  const mesAtual = hoje.slice(0, 7);
  const pagosMes = r2(
    titulos
      .filter((t) => t.status === "pago" && (t.pago_em ?? "").slice(0, 7) === mesAtual)
      .reduce((s, t) => s + t.valor + t.multa_juros, 0),
  );
  const contagem = (p: string) =>
    titulos.filter((t) => (p === "todos" || t.empresa_contabil_id === p) && estaEmAberto(t)).length;

  // Baixa em lote: só os impostos em aberto que a lista mostra — todos da
  // mesma origem (Imposto), então a regra de uma origem por lote não barra
  // nenhum aqui.
  const elegiveis = filtrados
    .filter(estaEmAberto)
    .map((t) => ({ chave: t.id, origem: "imposto" as const }));
  const selecao = useSelecao(elegiveis);
  const [loteAberto, setLoteAberto] = React.useState(false);
  const selecionados: TituloParaLote[] = filtrados.filter((t) => selecao.marcado(t.id)).map(paraOLoteImposto);

  const baixando = porId(baixandoId);
  const corrigindo = porId(corrigindoId);
  const cancelando = porId(cancelandoId);
  const vendo = porId(vendoId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
          <StatusChip ativo={filtro === "a_pagar"} onClick={() => setFiltro("a_pagar")} label="A pagar" />
          <StatusChip
            ativo={filtro === "vencidos"}
            onClick={() => setFiltro("vencidos")}
            label={vencidos.length ? `Vencidos · ${vencidos.length}` : "Vencidos"}
          />
          <StatusChip ativo={filtro === "pagos"} onClick={() => setFiltro("pagos")} label="Pagos" />
          <StatusChip ativo={filtro === "todos"} onClick={() => setFiltro("todos")} label="Todos" />
        </div>
        <button
          type="button"
          onClick={() => setCriando(true)}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
        >
          <Plus className="h-4 w-4" />
          Lançamento Avulso
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por imposto, CNPJ ou competência..."
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        <Chip
          ativo={pjFiltro === "todos"}
          onClick={() => setPjFiltro("todos")}
          label="Todas as empresas"
          count={contagem("todos")}
        />
        {dados.pjs.map((p) => (
          <Chip
            key={p.id}
            ativo={pjFiltro === p.id}
            onClick={() => setPjFiltro(p.id)}
            label={p.nome}
            count={contagem(p.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <ResumoItem icone={<Wallet className="h-3.5 w-3.5 text-california-red" />} label="Em aberto" valor={moeda(emAberto)} />
        <div className="h-5 w-px bg-border" />
        <ResumoItem
          icone={<CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Vencendo em 7 dias"
          valor={moeda(semana)}
        />
        {vencidos.length > 0 && (
          <>
            <div className="h-5 w-px bg-border" />
            <ResumoItem
              icone={<AlertTriangle className="h-3.5 w-3.5 text-california-red" />}
              label="Vencidos"
              valor={moeda(r2(vencidos.reduce((s, t) => s + t.valor, 0)))}
            />
          </>
        )}
        <div className="h-5 w-px bg-border" />
        <ResumoItem
          icone={<CheckCheck className="h-3.5 w-3.5 text-emerald-700" />}
          label="Pagos este mês"
          valor={moeda(pagosMes)}
        />
      </div>

      {dados.erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Não foi possível ler os impostos a pagar. Recarregue a página.</span>
        </div>
      )}

      {/* Quantos impostos os filtros dos títulos deixaram (o mesmo aviso da
          aba PPs): o filtro mora escondido no título. */}
      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="imposto"
          plural="impostos"
          onLimpar={colunas.limpar}
        />
      )}

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[3%] py-3 pl-4 pr-1 font-semibold">
                <CaixaDoCabecalho {...selecao.cabecalho} />
              </th>
              <th className="w-[8%] px-2 py-3 font-semibold">{colunas.titulo("vencimento")}</th>
              <th className="w-[19%] px-3 py-3 text-left font-semibold">{colunas.titulo("imposto")}</th>
              <th className="w-[15%] px-3 py-3 text-left font-semibold">{colunas.titulo("cnpj")}</th>
              <th className="w-[10%] px-2 py-3 font-semibold">{colunas.titulo("competencia")}</th>
              <th className="w-[9%] px-2 py-3 font-semibold">{colunas.titulo("origem")}</th>
              <th className="w-[10%] px-3 py-3 text-right font-semibold">{colunas.titulo("valor")}</th>
              <th className="w-[10%] px-3 py-3 text-left font-semibold">{colunas.titulo("guia")}</th>
              <th className="w-[7%] px-2 py-3 font-semibold">{colunas.titulo("status")}</th>
              <th className="w-[9%] px-3 py-3 font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {titulos.length === 0
                    ? "Nenhum imposto a pagar ainda. Aprove uma guia na Apuração ou crie um lançamento avulso."
                    : doTopo.length === 0
                      ? "Nenhum imposto encontrado com esses filtros."
                      : // Vazio por causa dos títulos: a tabela fica, para desfazer.
                        "Nenhum imposto com esse filtro."}
                </td>
              </tr>
            )}
            {filtrados.map((t) => {
              const s = statusDo(t, hoje);
              const pago = s === "pago";
              const cancelado = s === "cancelado";
              const aberto = !pago && !cancelado;
              const marcado = selecao.marcado(t.id);
              const corrigidoDe = t.correcoes[0]?.de;
              return (
                <tr
                  key={t.id}
                  onClick={pago ? () => setVendoId(t.id) : aberto ? () => selecao.alternar(t.id) : undefined}
                  className={cn(
                    "border-b border-border transition-colors last:border-0",
                    !cancelado && "cursor-pointer hover:bg-accent/40",
                    cancelado && "text-muted-foreground",
                    marcado && "bg-california-red/[0.04]",
                  )}
                >
                  <td
                    className="py-3 pl-4 pr-1 text-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (aberto) selecao.alternar(t.id);
                    }}
                  >
                    {aberto && <CaixaDaLinha marcado={marcado} onAlternar={() => selecao.alternar(t.id)} />}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span
                      className={cn(
                        "whitespace-nowrap font-mono text-xs",
                        s === "vencido" && "font-semibold text-california-red",
                      )}
                    >
                      {br(t.vencimento)}
                    </span>
                    {pago && (
                      <span className="block whitespace-nowrap text-[10.5px] text-emerald-700">pago {br(t.pago_em)}</span>
                    )}
                    {cancelado && (
                      <span className="block whitespace-nowrap text-[10.5px]">cancelado {br(t.cancelado_em)}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="break-words font-semibold">
                        {t.titulo}
                        {t.cota_numero && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · cota {t.cota_numero}/{t.cota_total}
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {t.codigo_receita
                          ? `DARF ${t.codigo_receita}`
                          : t.tributo === "ISS" || t.tributo === "ISS_RET"
                            ? `Guia municipal · ${t.municipio ?? t.local}`
                            : "—"}
                        {t.origem === "avulso" && ` · ${t.descricao}`}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <span className="block truncate" title={t.local}>
                      {t.local}
                    </span>
                    <span className="block font-mono text-[10.5px]">{t.cnpj}</span>
                  </td>
                  <td className="px-2 py-3 text-center text-xs">{t.rotulo_competencia}</td>
                  <td className="px-2 py-3 text-center">
                    {t.origem === "apuracao" ? (
                      <Pilula tom="cinza">Apuração</Pilula>
                    ) : t.origem === "diferenca" ? (
                      <Pilula tom="rosa">Complementar</Pilula>
                    ) : (
                      <Pilula tom="violeta">Avulso</Pilula>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                    {moeda(t.valor)}
                    {t.juros > 0 && (
                      <span className="block text-[10.5px] font-medium text-muted-foreground">
                        {moeda(t.principal)} + juros {moeda(t.juros)}
                      </span>
                    )}
                    {corrigidoDe !== undefined && (
                      <span className="block text-[10.5px] font-medium text-amber-700">
                        corrigido de {moeda(corrigidoDe)}
                      </span>
                    )}
                    {pago && t.multa_juros > 0 && (
                      <span className="block text-[10.5px] font-medium text-rose-700">
                        + multa e juros {moeda(t.multa_juros)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {t.guia_path ? <LinkAnexo path={t.guia_path} /> : <span className="text-muted-foreground">sem guia</span>}
                      {t.comprovante_path && (
                        <span className="truncate text-[10.5px] text-muted-foreground">
                          <Paperclip className="mr-0.5 inline h-2.5 w-2.5" />
                          comprovante
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center">
                    {pago ? (
                      <Pilula tom="verde">Pago</Pilula>
                    ) : cancelado ? (
                      <span
                        title={`Cancelado${t.cancelado_por_nome ? ` por ${t.cancelado_por_nome}` : ""}: ${t.motivo_cancelamento ?? ""}`}
                      >
                        <Pilula tom="cinza">Cancelado</Pilula>
                      </span>
                    ) : s === "vencido" ? (
                      <Pilula tom="vermelho">Vencido</Pilula>
                    ) : (
                      <Pilula tom="ambar">A pagar</Pilula>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {aberto && (
                        <>
                          <button
                            type="button"
                            title="Cancelar o imposto (deixou de ser devido), com motivo"
                            aria-label="Cancelar imposto"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCancelandoId(t.id);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Corrigir o valor (guia da contabilidade diferente)"
                            aria-label="Corrigir valor"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCorrigindoId(t.id);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setBaixandoId(t.id);
                            }}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                          >
                            <CreditCard className="h-3 w-3" />
                            Baixar
                          </button>
                        </>
                      )}
                      {pago && (
                        <button
                          type="button"
                          title="Ver a baixa registrada — cancelar, se preciso"
                          aria-label="Ver baixa registrada"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVendoId(t.id);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BarraDeSelecao itens={selecionados} onLimpar={selecao.limpar} onBaixar={() => setLoteAberto(true)} />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" />
        A baixa é feita aqui e vai para a conciliação, rateada entre as empresas e regionais. Para pagar várias guias de uma
        vez, selecione-as. A guia que a contabilidade mandar diferente se corrige pelo lápis, com justificativa. Clique num
        imposto pago para conferir a baixa e, se preciso, cancelar.
      </p>

      {baixando && (
        <BaixaImpostoDialog
          imposto={baixando}
          contas={dados.contas}
          nomesDasPJs={nomesDasPJs}
          tenantId={dados.tenantId}
          onClose={() => setBaixandoId(null)}
          onBaixado={({ mensagem }) => {
            setBaixandoId(null);
            setToast(mensagem);
            router.refresh();
          }}
        />
      )}
      <BaixaEmLoteDialog
        open={loteAberto}
        onOpenChange={setLoteAberto}
        itens={selecionados}
        contas={dados.contas.map((c) => ({ ...c, ativo: true }))}
        tipos={[]}
        subtipos={[]}
        tenantId={dados.tenantId}
        nomesDasPJs={nomesDasPJs}
        onConcluido={(mensagem) => {
          selecao.limpar();
          setToast(mensagem);
        }}
      />
      {cancelando && (
        <CancelarImpostoDialog
          imposto={cancelando}
          onClose={() => setCancelandoId(null)}
          onCancelado={(mensagem) => {
            setCancelandoId(null);
            selecao.limpar();
            setToast(mensagem);
            router.refresh();
          }}
        />
      )}
      {corrigindo && (
        <CorrigirDialog
          imposto={corrigindo}
          tenantId={dados.tenantId}
          onClose={() => setCorrigindoId(null)}
          onCorrigido={(mensagem) => {
            setCorrigindoId(null);
            setToast(mensagem);
            router.refresh();
          }}
        />
      )}
      {vendo && (
        <BaixaRegistradaDialog
          imposto={vendo}
          onClose={() => setVendoId(null)}
          onCancelada={(mensagem) => {
            setVendoId(null);
            setToast(mensagem);
            router.refresh();
          }}
        />
      )}
      {criando && (
        <AvulsoDialog
          dados={dados}
          onClose={() => setCriando(false)}
          onCriado={(id, comBaixa, mensagem) => {
            setCriando(false);
            setToast(mensagem);
            if (comBaixa) setBaixarDepois(id);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-[560px] items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Fechar aviso"
            className="text-emerald-700 hover:text-emerald-900"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças pequenas (as mesmas classes das listas do financeiro)
// ---------------------------------------------------------------------------

function StatusChip({ ativo, onClick, label }: { ativo: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
    </button>
  );
}

function Chip({ ativo, onClick, label, count }: { ativo: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
      <span className={cn("tabular-nums", ativo ? "text-white/85" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

function ResumoItem({ icone, label, valor }: { icone: React.ReactNode; label: string; valor: string }) {
  return (
    <div className="flex items-center gap-2.5">
      {icone}
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{valor}</span>
    </div>
  );
}

const TONS = {
  ambar: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
  verde: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cinza: "border-border bg-muted text-muted-foreground",
  rosa: "border-rose-200 bg-rose-50 text-rose-700",
  vermelho: "border-california-red/30 bg-california-red/[0.07] text-california-red",
  violeta: "border-violet-200 bg-violet-50 text-violet-700",
} as const;

function Pilula({ tom, children }: { tom: keyof typeof TONS; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        TONS[tom],
      )}
    >
      {children}
    </span>
  );
}
