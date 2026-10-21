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
  FileText,
  Info,
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
import { BarraDosFiltrosDeColuna, useFiltrosDeColuna } from "@/components/ui/filtro-de-coluna";
import { PlanilhaDeTitulos } from "@/components/financeiro/planilha-de-titulos/planilha";
import { colunasFiltraveis } from "@/components/financeiro/planilha-de-titulos/colunas";
import { BotaoDetalhes, type AcaoDoDetalhe } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import { EXTRAS_VAZIOS } from "@/lib/data/planilha-de-titulos";
import { linhaDeImposto, prepararContexto, type Linha } from "../../conciliacao/linhas-da-aba";
import type { DadosDosImpostos, ImpostoDaLista } from "./dados";
import {
  AvulsoDialog,
  BaixaImpostoDialog,
  BaixaRegistradaDialog,
  CancelarImpostoDialog,
  CENTRO,
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

/** O imposto por trás da linha da planilha. */
function impostoDe(l: Linha): ImpostoDaLista {
  return l.t as ImpostoDaLista;
}

export function AbaImpostos({ dados }: { dados: DadosDosImpostos }) {
  const router = useRouter();
  const hoje = hojeIso();
  const [filtro, setFiltro] = React.useState<Filtro>("a_pagar");
  const [pjFiltro, setPjFiltro] = React.useState<string>("todos");
  const [busca, setBusca] = React.useState("");
  const [baixandoId, setBaixandoId] = React.useState<string | null>(null);
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
  // Desde a decisão 195 a lista é a planilha de títulos, com a coluna Crédito
  // fina (imposto só sai da conta) e as linhas da mesma montagem da
  // conciliação (`linhaDeImposto`).
  const contexto = React.useMemo(
    () =>
      prepararContexto({
        hoje,
        empresas: {},
        tipos: [],
        subtipos: [],
        cartoes: [],
        contas: dados.contas,
        centroDoImposto: CENTRO,
        extras: EXTRAS_VAZIOS,
      }),
    [hoje, dados.contas],
  );
  const linhasDoTopo = React.useMemo(() => doTopo.map((t) => linhaDeImposto(t, contexto)), [doTopo, contexto]);
  const colunasDoFiltro = React.useMemo(
    () => colunasFiltraveis({ contaId: null, hoje, rotuloContraparte: "Órgão", status: true }),
    [hoje],
  );
  const colunas = useFiltrosDeColuna<Linha>(linhasDoTopo, colunasDoFiltro, { guardarEm: "fiscal-impostos-planilha" });
  /** Os impostos que passam em tudo, na ordem do título escolhido (sem
   *  nenhum, a de sempre). A seleção do lote sai daqui: só o que está na tela. */
  const filtrados = React.useMemo(() => colunas.visiveis.map(impostoDe), [colunas.visiveis]);

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

      <PlanilhaDeTitulos<Linha>
        linhas={colunas.visiveis}
        contaId={null}
        hoje={hoje}
        colunaStatus
        creditoFino
        titulo={(chave) => colunas.titulo(chave)}
        cabecalhoDaSelecao={<CaixaDoCabecalho {...selecao.cabecalho} />}
        caixa={(l) => {
          const t = impostoDe(l);
          return estaEmAberto(t) ? (
            <CaixaDaLinha marcado={selecao.marcado(t.id)} onAlternar={() => selecao.alternar(t.id)} />
          ) : null;
        }}
        onBaixar={(l) => setBaixandoId(impostoDe(l).id)}
        onEditarData={() => undefined}
        onVerBaixas={(l) => setVendoId(impostoDe(l).id)}
        detalhes={(l) => {
          const t = impostoDe(l);
          // O valor da guia só muda na Apuração, onde ela é aprovada; aqui, na
          // baixa, só entram multa e juros (decisão 195).
          const acoes: AcaoDoDetalhe[] = [
            { rotulo: "Abrir na Apuração", icone: FileText, onClick: () => router.push("/financeiro/fiscal?aba=apuracao") },
          ];
          if (estaEmAberto(t)) {
            acoes.push({ rotulo: "Cancelar o imposto", icone: XCircle, perigo: true, onClick: () => setCancelandoId(t.id) });
          }
          return (
            <BotaoDetalhes
              chave={l.chave}
              titulo={l.descricao}
              recebimento={false}
              job={null}
              vencimentoDiferente={null}
              retencoes={[]}
              rateio={l.rateio}
              acoes={acoes}
            />
          );
        }}
        vazio={
          titulos.length === 0
            ? "Nenhum imposto a pagar ainda. Aprove uma guia na Apuração ou crie um lançamento avulso."
            : doTopo.length === 0
              ? "Nenhum imposto encontrado com esses filtros."
              : "Nenhum imposto com esse filtro."
        }
      />

      <BarraDeSelecao itens={selecionados} onLimpar={selecao.limpar} onBaixar={() => setLoteAberto(true)} />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" />
        A baixa é feita aqui e vai para a conciliação, rateada entre as empresas e regionais. Para pagar várias guias de uma
        vez, selecione-as. O valor da guia só muda na Apuração, onde ela é aprovada; aqui, na baixa, entram só multa e
        juros. O olho do imposto pago abre a baixa para conferir e, se preciso, cancelar.
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
        // Imposto não se paga com cartão (decisão 197).
        cartoes={[]}
        faturas={[]}
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

