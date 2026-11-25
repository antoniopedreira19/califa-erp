"use client";

/**
 * A aba Apuração da seção Fiscal (módulo fiscal, entrega 2; lista por
 * vencimento desde a decisão 181, 16/10/2026; por CNPJ desde a 277,
 * 23/11/2026): um bloco por CNPJ — a faixa com CNPJ, regime, o que falta
 * aprovar, o que vence primeiro e o "Aprovar" só daquele CNPJ — e, dentro
 * dele, as guias na ordem de vencimento, com Competência (mês) e Trimestre em colunas,
 * débito, créditos, retido, apurado, guia aprovada e situação (em curso · a
 * aprovar · aprovada · diferença). A competência e a situação viram filtros
 * rápidos (padrão "Em aberto": o que ainda não foi aprovado), o CNPJ tem
 * botões próprios (como a competência), e os títulos das colunas
 * filtram e ordenam. Clicar abre a memória de cálculo; "Aprovar" leva a guia
 * para Impostos a Pagar. Na PJ de teste, a guia em curso também se aprova,
 * com confirmação.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Eye,
  Hourglass,
  Info,
  ListChecks,
  Loader2,
  Undo2,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FAIXA_GRUPO_LISTA } from "@/app/(app)/_planilha/blocos";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { trimestreDe } from "@/lib/fiscal/apuracao";
import { dataBr, mesDe, nomeDoMes, proximoMes, r2 } from "@/lib/fiscal/datas";
import { aprovarGuiasPeloCalculado } from "./actions";
import type { DadosDaApuracao, EstabelecimentoDaTela, GuiaDaContabilidade, GuiaDaTela, PJDaTela } from "./dados";
import { MemoriaDialog } from "./memoria-dialog";
import { NomeDaGuia, Nota, ResumoItem, cnpjBr, moeda, nomeGuia, situacaoDa, somaGrupo, tituloPorExtenso } from "./ui";
import { DialogoAApurar, ItemDoResumo, LinhaProjecao, projecoesDe, type Projecao } from "./a-apurar";
import { DialogoGuiaDaContabilidade, LinhaDaContabilidade } from "./guia-da-contabilidade";
import {
  BarraDosFiltrosDeColuna,
  FILTRO_VAZIO,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";

const ORDEM: Record<string, number> = { ISS: 1, PIS: 2, COFINS: 3, ISS_RET: 4, CSRF: 5, IRRF: 6, IRPJ: 7, CSLL: 8 };
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10" → "out/2026". */
const mesCurto = (c: string) => `${MES_CURTO[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
/** "2026-T4" → "4º tri/2026". */
const triCurto = (t: string) => `${t.split("-T")[1]}º tri/${t.slice(0, 4)}`;
/** O trimestre da guia: o dela (IRPJ/CSLL) ou o do mês. */
const trimestreDaGuia = (g: GuiaDaTela) => (g.periodo === "trimestral" ? g.competencia : trimestreDe(`${g.competencia}-01`));
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);

/** Os filtros rápidos da situação. "Em aberto" é tudo que não foi aprovado. */
type Mostrar = "aberto" | "a_aprovar" | "em_curso" | "a_apurar" | "aprovadas" | "todas";
const MOSTRAR: Array<[Mostrar, string, (g: GuiaDaTela) => boolean]> = [
  ["aberto", "Em aberto", (g) => g.estado !== "aprovada"],
  ["a_aprovar", "A aprovar", (g) => g.estado === "a_aprovar" || g.estado === "diferenca"],
  ["em_curso", "Em curso", (g) => g.estado === "em_curso"],
  // Decisão 183: o que ainda vai nascer no recebimento (linhas "A apurar").
  ["a_apurar", "A apurar", () => false],
  ["aprovadas", "Aprovadas", (g) => g.estado === "aprovada"],
  ["todas", "Todas", () => true],
];

// ---------------------------------------------------------------------------
// Filtro e ordem pelo título da coluna, como no Excel (pedido do Tiago,
// 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job)
// ---------------------------------------------------------------------------

/** O texto do selo da coluna Situação (`situacaoDa`, em `./ui`). */
function rotuloDaSituacao(g: GuiaDaTela): string {
  if (g.estado === "em_curso") return "Em curso";
  if (g.estado === "a_aprovar") return g.apurado > 0 ? "A aprovar" : "A confirmar";
  if (g.estado === "diferenca") return "Diferença";
  return "Aprovada";
}
/** A lista da Situação na ordem da aprovação. */
const ORDEM_DA_SITUACAO = ["Em curso", "A aprovar", "A confirmar", "Diferença", "Aprovada"];

/** Os valores das colunas, como `LinhaGuia` calcula. Créditos e retidos
 *  vêm com sinal negativo na memória: o filtro e a ordem usam o valor
 *  abatido, positivo (o "de / até" só aceita valor positivo). */
function valoresDaGuia(g: GuiaDaTela) {
  const baseRotulo = g.periodo === "trimestral" ? g.memoria.filter((m) => m.grupo === "base").slice(-1)[0] : null;
  return {
    base: baseRotulo ? baseRotulo.valor : g.base,
    debito: somaGrupo(g, ["debito"]),
    creditos: Math.abs(somaGrupo(g, ["credito", "rateio_credito"])),
    retido: Math.abs(somaGrupo(g, ["retido", "saldo", "compensacao"])),
    aprovado: r2(g.aprovacoes.reduce((s, a) => s + a.valor_guia, 0)),
  };
}

/** O que a guia ainda pede para aprovar: o apurado, ou a diferença. */
const aAprovarDa = (g: GuiaDaTela) => (g.estado === "diferenca" ? Math.max(0, g.delta) : g.estado === "a_aprovar" ? g.apurado : 0);

function colunasDaApuracao(
  pjPorId: Map<string, PJDaTela>,
  estabPorId: Map<string, EstabelecimentoDaTela>,
  ordemPj: (id: string) => number,
): ColunaFiltravel<GuiaDaTela>[] {
  return [
    { chave: "vencimento", rotulo: "Vencimento", tipo: "data", alinhar: "left", celula: (g) => celulaData(g.vencimento) },
    {
      chave: "guia",
      rotulo: "Guia",
      tipo: "texto",
      celula: (g) => ({ ...celulaTexto(nomeGuia(g)), ordemNaLista: ORDEM[g.tributo] ?? 99 }),
    },
    {
      // Árvore PJ ▸ estabelecimento: a PJ marca as guias federais e as do ISS.
      chave: "cnpj",
      rotulo: "Local",
      tipo: "texto",
      rotuloSemGrupo: "(sem PJ)",
      celula: (g) => {
        const pj = pjPorId.get(g.empresa_contabil_id)?.nome ?? "—";
        const estab = g.estabelecimento_id ? estabPorId.get(g.estabelecimento_id) : undefined;
        const rotulo = estab ? `${pj} · ${estab.municipio}` : pj;
        return { valor: rotulo, rotulo, ordem: rotulo, ordemNaLista: ordemPj(g.empresa_contabil_id) * 100 + (estab ? 1 : 0), grupo: pj };
      },
    },
    {
      chave: "competencia",
      rotulo: "Competência",
      tipo: "texto",
      alinhar: "center",
      celula: (g) =>
        g.periodo === "trimestral"
          ? { valor: "—", rotulo: "Trimestral (IRPJ e CSLL)", ordem: `${g.competencia}z`, ordemNaLista: 9e9 }
          : { valor: g.competencia, rotulo: nomeDoMes(g.competencia), ordem: g.competencia, ordemNaLista: Number(g.competencia.replace("-", "")) },
    },
    {
      chave: "trimestre",
      rotulo: "Trimestre",
      tipo: "texto",
      alinhar: "center",
      celula: (g) => {
        const t = trimestreDaGuia(g);
        return { valor: t, rotulo: triCurto(t), ordem: t, ordemNaLista: Number(t.replace("-T", "")) };
      },
    },
    { chave: "base", rotulo: "Base", tipo: "valor", faixa: true, alinhar: "right", celula: (g) => celulaValor(valoresDaGuia(g).base, moeda) },
    { chave: "debito", rotulo: "Débito", tipo: "valor", faixa: true, alinhar: "right", celula: (g) => celulaValor(valoresDaGuia(g).debito, moeda) },
    {
      chave: "creditos",
      rotulo: "(−) Créditos",
      tipo: "valor",
      faixa: true,
      alinhar: "right",
      celula: (g) => celulaValor(valoresDaGuia(g).creditos, moeda),
    },
    {
      chave: "retido",
      rotulo: "(−) Retido / saldo",
      tipo: "valor",
      faixa: true,
      alinhar: "right",
      celula: (g) => celulaValor(valoresDaGuia(g).retido, moeda),
    },
    { chave: "apurado", rotulo: "(=) Apurado", tipo: "valor", faixa: true, alinhar: "right", celula: (g) => celulaValor(g.apurado, moeda) },
    {
      // Sem aprovação a célula mostra "—": vale zero ("de R$ 0,01" tira).
      chave: "aprovada",
      rotulo: "Guia aprovada",
      tipo: "valor",
      faixa: true,
      alinhar: "right",
      celula: (g) => celulaValor(valoresDaGuia(g).aprovado, moeda),
    },
    {
      // A lista na ordem da aprovação; as linhas, de A a Z pelo rótulo.
      chave: "situacao",
      rotulo: "Situação",
      tipo: "texto",
      alinhar: "center",
      celula: (g) => ({ ...celulaTexto(rotuloDaSituacao(g)), ordemNaLista: ORDEM_DA_SITUACAO.indexOf(rotuloDaSituacao(g)) }),
    },
  ];
}

/**
 * As larguras da tabela (`table-fixed`). Decisão 277: o CNPJ foi para a faixa
 * do bloco e a coluna Local é curta; a largura passou para Base, Débito e
 * Apurado, medidas pelo maior valor real (R$ 46.500.000,00 na base do IOF,
 * R$ 2.661.685,92 no débito do IRPJ do 4º tri na tela de 1.616 px).
 */
const LARGURAS = ["7%", "12%", "8%", "6.5%", "6%", "9%", "8.5%", "7%", "7%", "9%", "6.5%", "6.5%", "7.5%"];

function Chip({ ativo, onClick, n, children }: { ativo: boolean; onClick: () => void; n?: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo ? "border-california-red bg-california-red text-white" : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {children}
      {n !== undefined && n > 0 && (
        <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums", ativo ? "bg-white/25 text-white" : "bg-muted text-muted-foreground")}>
          {n}
        </span>
      )}
    </button>
  );
}

export function AbaApuracao({ dados }: { dados: DadosDaApuracao }) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const { guias, pjs, estabelecimentos } = dados;

  const estabPorId = React.useMemo(() => new Map(estabelecimentos.map((e) => [e.id, e])), [estabelecimentos]);
  const pjPorId = React.useMemo(() => new Map(pjs.map((p) => [p.id, p])), [pjs]);
  const ordemPj = React.useCallback(
    (id: string) => {
      const i = pjs.findIndex((p) => p.id === id);
      return i < 0 ? 999 : i;
    },
    [pjs],
  );
  /** Decisão 181: na PJ de teste, a guia em curso se aprova (com confirmação). */
  const aprovaEmCurso = React.useCallback(
    (g: GuiaDaTela) => g.estado === "em_curso" && pjPorId.get(g.empresa_contabil_id)?.de_teste === true,
    [pjPorId],
  );

  const [mostrar, setMostrar] = React.useState<Mostrar>("aberto");
  const [cnpjs, setCnpjs] = React.useState<string[]>([]);
  const [periodo, setPeriodo] = React.useState<string | null>(null);
  const [aberta, setAberta] = React.useState<string | null>(null);
  const [confirmarLote, setConfirmarLote] = React.useState(false);
  const [aprovandoLote, setAprovandoLote] = React.useState(false);
  const [erroLote, setErroLote] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ texto: string; link: boolean } | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // Só os feriados e os parâmetros vão para as cotas (o resto do cadastro fica no servidor).
  const cadastroDasCotas: CadastroFiscal = React.useMemo(
    () => ({ regimes: [], estabelecimentos: [], cnaes: [], feriados: dados.feriados, parametros: dados.parametros, receitasAnteriores: [] }),
    [dados.feriados, dados.parametros],
  );

  // A ordem de base: vencimento, depois PJ, tributo e estabelecimento.
  // (Os ganchos ficam antes dos `return` de erro: não podem vir depois deles.)
  const ordenadas = React.useMemo(() => {
    const ordemEstab = (id: string | null) => (id ? estabelecimentos.findIndex((e) => e.id === id) : -1);
    return [...guias].sort(
      (a, b) =>
        a.vencimento.localeCompare(b.vencimento) ||
        ordemPj(a.empresa_contabil_id) - ordemPj(b.empresa_contabil_id) ||
        (ORDEM[a.tributo] ?? 99) - (ORDEM[b.tributo] ?? 99) ||
        ordemEstab(a.estabelecimento_id) - ordemEstab(b.estabelecimento_id),
    );
  }, [guias, estabelecimentos, ordemPj]);
  // O CNPJ recorta o universo ANTES das contagens dos chips, como a
  // regional na aba PPs do Contas a Pagar.
  const porCnpj = React.useMemo(
    () => (cnpjs.length === 0 ? ordenadas : ordenadas.filter((g) => cnpjs.includes(g.empresa_contabil_id))),
    [ordenadas, cnpjs],
  );
  const filtroDoMostrar = MOSTRAR.find(([k]) => k === mostrar)![2];
  const listaDoTopo = React.useMemo(() => porCnpj.filter(filtroDoMostrar), [porCnpj, filtroDoMostrar]);
  const colunasDaTabela = React.useMemo(() => colunasDaApuracao(pjPorId, estabPorId, ordemPj), [pjPorId, estabPorId, ordemPj]);
  const colunas = useFiltrosDeColuna(listaDoTopo, colunasDaTabela, { guardarEm: "fiscal-apuracao-vencimento" });
  // Decisão 277: os blocos recolhidos e o "Aprovar" de um CNPJ só (nulo = todos).
  const [recolhidos, setRecolhidos] = React.useState<Set<string>>(new Set());
  const [loteDoCnpj, setLoteDoCnpj] = React.useState<string | null>(null);
  /** Decisão 277 (2b): o CNPJ da Guia da contabilidade em lançamento. */
  const [guiaContabilDe, setGuiaContabilDe] = React.useState<PJDaTela | null>(null);
  const [aApurarAberto, setAApurarAberto] = React.useState<Projecao | null>(null);
  const todasProjecoes = React.useMemo(() => projecoesDe(dados, pjPorId), [dados, pjPorId]);

  // Os chips de competência: os meses e os trimestres que têm guia.
  // Com as competências das guias da contabilidade (decisão 277): setembro, o 3º trimestre...
  const meses = React.useMemo(
    () =>
      [
        ...new Set([
          ...guias.filter((g) => g.periodo === "mensal").map((g) => g.competencia),
          ...dados.guiasDaContabilidade.filter((c) => c.periodo === "mensal").map((c) => c.competencia),
        ]),
      ].sort(),
    [guias, dados.guiasDaContabilidade],
  );
  const trimestres = React.useMemo(
    () => [...new Set([...guias.map(trimestreDaGuia), ...dados.guiasDaContabilidade.map((c) => c.trimestre)])].sort(),
    [guias, dados.guiasDaContabilidade],
  );

  /** O chip de competência põe o filtro na coluna Competência (mês) ou
   *  Trimestre: o trimestre traz também as guias mensais dos três meses. */
  function escolherPeriodo(p: string | null) {
    setPeriodo(p);
    colunas.definir("competencia", FILTRO_VAZIO);
    colunas.definir("trimestre", FILTRO_VAZIO);
    if (!p) return;
    if (p.includes("-T")) colunas.definir("trimestre", { ...FILTRO_VAZIO, marcados: [p] });
    else colunas.definir("competencia", { ...FILTRO_VAZIO, marcados: [p] });
  }

  if (dados.erro) {
    return (
      <Nota tom="ambar" icone={<AlertTriangle className="h-3.5 w-3.5" />}>
        Não foi possível calcular a apuração agora: {dados.erro}
      </Nota>
    );
  }

  // As guias que passam também nos títulos. O resumo e o "Aprovar as N
  // guias pelo valor calculado" seguem esta lista: o lote nunca aprova uma
  // guia que o filtro escondeu.
  const lista = colunas.visiveis;
  // Decisão 183: as linhas "A apurar" seguem o CNPJ e a competência de cima
  // e entram em "Em aberto", "A apurar" e "Todas". Os filtros dos títulos
  // são das guias: com um deles ligado (fora o da competência), elas saem.
  const projecoesDoCnpj = todasProjecoes.filter((p) => cnpjs.length === 0 || cnpjs.includes(p.pj));
  const projecoes =
    !["aberto", "a_apurar", "todas"].includes(mostrar) || (colunas.filtrando && !periodo)
      ? []
      : projecoesDoCnpj.filter((p) => !periodo || (periodo.includes("-T") ? p.trimestre === periodo : p.competencia === periodo));
  // Decisão 277 (2b): as guias da contabilidade já nascem aprovadas — entram em
  // "Aprovadas" e "Todas", com o CNPJ e a competência de cima.
  const contabeisDoCnpj = dados.guiasDaContabilidade.filter((c) => cnpjs.length === 0 || cnpjs.includes(c.empresa_contabil_id));
  const contabeis =
    !["aprovadas", "todas"].includes(mostrar) || (colunas.filtrando && !periodo)
      ? []
      : contabeisDoCnpj.filter((c) => !periodo || (periodo.includes("-T") ? c.trimestre === periodo : c.competencia === periodo));
  type LinhaDaTabela =
    | { tipo: "guia"; g: GuiaDaTela; v: string }
    | { tipo: "a_apurar"; p: Projecao; v: string }
    | { tipo: "contabil"; c: GuiaDaContabilidade; v: string };
  const linhasDaTabela: LinhaDaTabela[] = [
    ...lista.map((g) => ({ tipo: "guia" as const, g, v: g.vencimento })),
    ...projecoes.map((p) => ({ tipo: "a_apurar" as const, p, v: p.vencimento })),
    ...contabeis.map((c) => ({ tipo: "contabil" as const, c, v: c.vencimento })),
  ];
  // Com ordem pelo título, as linhas "A apurar" ficam no fim; sem ela, entram pela data.
  if (!colunas.ordenacao) linhasDaTabela.sort((a, b) => a.v.localeCompare(b.v));
  const aAprovarTodas = lista.filter((g) => g.estado === "a_aprovar");
  const aAprovar = loteDoCnpj ? aAprovarTodas.filter((g) => g.empresa_contabil_id === loteDoCnpj) : aAprovarTodas;
  const pendentes = lista.filter((g) => g.estado === "a_aprovar" || g.estado === "diferenca");
  const totalAAprovar = r2(pendentes.reduce((s, g) => s + aAprovarDa(g), 0));
  const emCurso = lista.filter((g) => g.estado === "em_curso");
  const totalEmCurso = r2(emCurso.reduce((s, g) => s + g.apurado, 0));
  const proxima = [...pendentes].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
  const guiaAberta = aberta ? guias.find((g) => g.chave === aberta) ?? null : null;
  const contagem = (f: (g: GuiaDaTela) => boolean) => porCnpj.filter(f).length;
  // Os botões de CNPJ contam pelo filtro "Mostrar", antes do recorte do CNPJ.
  const comProjecoes = ["aberto", "a_apurar", "todas"].includes(mostrar);
  const comContabeis = ["aprovadas", "todas"].includes(mostrar);
  const contagemDoCnpj = (pj: string) =>
    ordenadas.filter((g) => g.empresa_contabil_id === pj && filtroDoMostrar(g)).length +
    (comProjecoes ? todasProjecoes.filter((p) => p.pj === pj).length : 0) +
    (comContabeis ? dados.guiasDaContabilidade.filter((c) => c.empresa_contabil_id === pj).length : 0);
  const pjsComGuia = pjs.filter(
    (p) =>
      guias.some((g) => g.empresa_contabil_id === p.id) ||
      todasProjecoes.some((x) => x.pj === p.id) ||
      dados.guiasDaContabilidade.some((c) => c.empresa_contabil_id === p.id),
  );
  // Os blocos: um por CNPJ, na ordem do cadastro. O bloco vazio no filtro fica
  // (só a faixa): é dela que sai a Guia da contabilidade.
  const pjDaLinha = (l: LinhaDaTabela) => (l.tipo === "guia" ? l.g.empresa_contabil_id : l.tipo === "a_apurar" ? l.p.pj : l.c.empresa_contabil_id);
  const blocos = pjs
    .filter((pj) => cnpjs.length === 0 || cnpjs.includes(pj.id))
    .map((pj) => ({ pj, linhas: linhasDaTabela.filter((l) => pjDaLinha(l) === pj.id) }));

  function nomeDoLocal(g: GuiaDaTela) {
    return g.estabelecimento_id ? estabPorId.get(g.estabelecimento_id)?.nome ?? g.local : pjPorId.get(g.empresa_contabil_id)?.nome ?? g.local;
  }

  async function aprovarLote() {
    if (aprovandoLote) return;
    setAprovandoLote(true);
    setErroLote(null);
    let r: Awaited<ReturnType<typeof aprovarGuiasPeloCalculado>>;
    try {
      r = await aprovarGuiasPeloCalculado({ chaves: aAprovar.map((g) => g.chave) });
    } catch {
      r = { ok: false, message: "Não foi possível falar com o servidor. Tente de novo." };
    }
    setAprovandoLote(false);
    if (!r.ok) {
      setErroLote(r.message);
      // Uma falha no meio do lote pode deixar parte aprovada: a tela relê.
      startTransition(() => router.refresh());
      return;
    }
    if (r.falhas.length) {
      setErroLote(
        `${r.aprovadas} ${r.aprovadas === 1 ? "guia aprovada" : "guias aprovadas"}. Não deu para aprovar: ${r.falhas
          .map((f) => `${f.titulo} (${f.message})`)
          .join("; ")}`,
      );
      startTransition(() => router.refresh());
      return;
    }
    setConfirmarLote(false);
    setToast({
      texto: `${r.aprovadas} ${r.aprovadas === 1 ? "guia aprovada" : "guias aprovadas"}. As que têm valor já estão em Impostos a Pagar.`,
      link: true,
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mostrar</span>
            {MOSTRAR.map(([k, rotulo, f]) => (
              <Chip
                key={k}
                ativo={mostrar === k}
                onClick={() => setMostrar(k)}
                n={
                  k === "todas"
                    ? undefined
                    : k === "a_apurar"
                      ? projecoesDoCnpj.length
                      : contagem(f) + (k === "aberto" ? projecoesDoCnpj.length : 0) + (k === "aprovadas" ? contabeisDoCnpj.length : 0)
                }
              >
                {rotulo}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Competência</span>
            <Chip ativo={periodo === null} onClick={() => escolherPeriodo(null)}>
              Todas
            </Chip>
            {meses.map((m) => (
              <Chip key={m} ativo={periodo === m} onClick={() => escolherPeriodo(m)}>
                {mesCurto(m)}
              </Chip>
            ))}
            {trimestres.map((t) => (
              <Chip key={t} ativo={periodo === t} onClick={() => escolherPeriodo(t)}>
                {triCurto(t)}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">CNPJ</span>
        <Chip ativo={cnpjs.length === 0} onClick={() => setCnpjs([])}>
          Todos
        </Chip>
        {pjsComGuia.map((p) => (
          <Chip
            key={p.id}
            ativo={cnpjs.length === 1 && cnpjs[0] === p.id}
            onClick={() => setCnpjs(cnpjs.length === 1 && cnpjs[0] === p.id ? [] : [p.id])}
            n={contagemDoCnpj(p.id)}
          >
            {p.nome}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5">
        <ResumoItem
          icone={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
          label={`A aprovar · ${pendentes.length} ${pendentes.length === 1 ? "guia" : "guias"}`}
          valor={moeda(totalAAprovar)}
        />
        <div className="h-5 w-px bg-border" />
        <ResumoItem icone={<Hourglass className="h-3.5 w-3.5 text-muted-foreground" />} label="Em curso (estimativa)" valor={moeda(totalEmCurso)} />
        <ItemDoResumo projecoes={projecoes} />
        {proxima && (
          <>
            <div className="h-5 w-px bg-border" />
            <ResumoItem
              icone={<CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Vence primeiro"
              valor={dataBr(proxima.vencimento)}
              extra={
                <span className="text-xs text-muted-foreground">
                  · {proxima.titulo} · {nomeDoLocal(proxima)}
                </span>
              }
            />
          </>
        )}
        {aAprovarTodas.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setErroLote(null);
              setLoteDoCnpj(null);
              setConfirmarLote(true);
            }}
            className="ml-auto inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-white px-3.5 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
          >
            <ListChecks className="h-4 w-4" />
            Aprovar {aAprovarTodas.length === 1 ? "a guia" : `as ${aAprovarTodas.length} guias`} pelo valor calculado
          </button>
        )}
      </div>

      <AvisoDosFatos dados={dados} />

      {/* Quantas guias os filtros dos títulos deixaram (o mesmo aviso da aba
          PPs): o filtro mora escondido no título. */}
      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="guia"
          plural="guias"
          onLimpar={() => {
            colunas.limpar();
            setPeriodo(null);
          }}
        />
      )}

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {LARGURAS.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/30 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-3 text-left font-semibold">{colunas.titulo("vencimento")}</th>
              <th className="px-3 py-3 text-left font-semibold">{colunas.titulo("guia")}</th>
              <th className="px-3 py-3 text-left font-semibold">{colunas.titulo("cnpj")}</th>
              <th className="px-2 py-3 font-semibold">{colunas.titulo("competencia")}</th>
              <th className="px-2 py-3 font-semibold">{colunas.titulo("trimestre")}</th>
              <th className="px-3 py-3 text-right font-semibold">{colunas.titulo("base")}</th>
              <th className="px-3 py-3 text-right font-semibold">{colunas.titulo("debito")}</th>
              <th className="px-3 py-3 text-right font-semibold">{colunas.titulo("creditos")}</th>
              <th className="px-3 py-3 text-right font-semibold">{colunas.titulo("retido")}</th>
              <th className="px-3 py-3 text-right font-semibold">{colunas.titulo("apurado")}</th>
              <th className="px-3 py-3 text-right font-semibold">{colunas.titulo("aprovada")}</th>
              <th className="px-2 py-3 font-semibold">{colunas.titulo("situacao")}</th>
              <th className="px-2 py-3 font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {blocos.length === 0 && (
              <tr>
                <td colSpan={LARGURAS.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {colunas.ativo || mostrar !== "todas" || cnpjs.length ? "Nenhuma guia com esse filtro." : "Nenhuma guia até agora."}
                </td>
              </tr>
            )}
            {blocos.map((b) => {
              const recolhido = recolhidos.has(b.pj.id);
              const guiasDoBloco = b.linhas.flatMap((l) => (l.tipo === "guia" ? [l.g] : []));
              const pendentesDoBloco = guiasDoBloco.filter((g) => g.estado === "a_aprovar" || g.estado === "diferenca");
              const aAprovarDoBloco = guiasDoBloco.filter((g) => g.estado === "a_aprovar");
              const emCursoDoBloco = guiasDoBloco.filter((g) => g.estado === "em_curso");
              const totalPendente = r2(pendentesDoBloco.reduce((s, g) => s + aAprovarDa(g), 0));
              const totalEmCursoBloco = r2(emCursoDoBloco.reduce((s, g) => s + g.apurado, 0));
              const contabeisDoBloco = b.linhas.flatMap((l) => (l.tipo === "contabil" ? [l.c] : []));
              const aprovadoDoBloco = r2(
                guiasDoBloco.reduce((s, g) => s + valoresDaGuia(g).aprovado, 0) + contabeisDoBloco.reduce((s, c) => s + c.valor, 0),
              );
              const primeira = [...pendentesDoBloco].sort((x, y) => x.vencimento.localeCompare(y.vencimento))[0];
              const dias = primeira ? diasEntre(dados.hoje, primeira.vencimento) : 0;
              const matriz = matrizDa(b.pj.id, pjPorId, estabPorId);
              const projecoesDoBloco = b.linhas.filter((l) => l.tipo === "a_apurar").length;
              return (
                <React.Fragment key={b.pj.id}>
                  <tr
                    className={cn(FAIXA_GRUPO_LISTA, "cursor-pointer")}
                    title={recolhido ? "Abrir o bloco" : "Recolher o bloco"}
                    onClick={() =>
                      setRecolhidos((r) => {
                        const n = new Set(r);
                        if (n.has(b.pj.id)) n.delete(b.pj.id);
                        else n.add(b.pj.id);
                        return n;
                      })
                    }
                  >
                    <td colSpan={5} className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {recolhido ? (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="text-[15px] font-bold">{b.pj.nome}</span>
                        <span className="font-mono text-xs text-muted-foreground">{cnpjBr(matriz?.cnpj)}</span>
                        <span className="text-xs text-muted-foreground">· {b.pj.rotulo_regime}</span>
                        <button
                          type="button"
                          title="A guia que o sistema ainda não calcula entra aprovada, com o valor da contabilidade"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGuiaContabilDe(b.pj);
                          }}
                          className="ml-2 inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
                        >
                          + Guia da contabilidade
                        </button>
                      </div>
                      {primeira && (
                        <span
                          className={cn(
                            "ml-6 block text-[11px] font-semibold",
                            dias < 0 ? "text-rose-700" : dias <= 5 ? "text-amber-700" : "text-muted-foreground",
                          )}
                        >
                          Vence primeiro {dataBr(primeira.vencimento)} ·{" "}
                          {dias < 0 ? `venceu há ${-dias} ${-dias === 1 ? "dia" : "dias"}` : dias === 0 ? "vence hoje" : `em ${dias} ${dias === 1 ? "dia" : "dias"}`} ·{" "}
                          {tituloPorExtenso(primeira)}
                        </span>
                      )}
                    </td>
                    <td colSpan={4} className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                      {[
                        pendentesDoBloco.length ? `${pendentesDoBloco.length} a aprovar` : null,
                        emCursoDoBloco.length ? `${emCursoDoBloco.length} em curso (${moeda(totalEmCursoBloco)})` : null,
                        projecoesDoBloco ? `${projecoesDoBloco} a apurar` : null,
                        contabeisDoBloco.length ? `${contabeisDoBloco.length} da contabilidade` : null,
                        b.linhas.length === 0 ? "nenhuma guia neste filtro" : null,
                        recolhido && b.linhas.length ? `${b.linhas.length} ${b.linhas.length === 1 ? "linha recolhida" : "linhas recolhidas"}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-sm font-bold tabular-nums">
                      {pendentesDoBloco.length ? moeda(totalPendente) : "—"}
                      {pendentesDoBloco.length > 0 && <span className="block font-sans text-[10px] font-semibold text-amber-700">a aprovar</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{aprovadoDoBloco ? moeda(aprovadoDoBloco) : ""}</td>
                    <td colSpan={2} className="px-2 py-2.5 text-center">
                      {aAprovarDoBloco.length > 0 && (
                        <button
                          type="button"
                          title={`Aprovar ${aAprovarDoBloco.length === 1 ? "a guia" : `as ${aAprovarDoBloco.length} guias`} de ${b.pj.nome} pelo valor calculado`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setErroLote(null);
                            setLoteDoCnpj(b.pj.id);
                            setConfirmarLote(true);
                          }}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
                        >
                          <ListChecks className="h-3.5 w-3.5" />
                          Aprovar {aAprovarDoBloco.length === 1 ? "a guia" : `as ${aAprovarDoBloco.length}`} pelo calculado
                        </button>
                      )}
                    </td>
                  </tr>
                  {!recolhido &&
                    b.linhas.map((l) =>
                      l.tipo === "contabil" ? (
                        <LinhaDaContabilidade
                          key={l.c.id}
                          c={l.c}
                          local={
                            l.c.estabelecimento_id
                              ? (() => {
                                  const e = estabPorId.get(l.c.estabelecimento_id!);
                                  return e ? `${e.municipio}-${e.uf}` : "—";
                                })()
                              : "Federal"
                          }
                        />
                      ) : l.tipo === "a_apurar" ? (
                        <LinhaProjecao key={l.p.chave} p={l.p} pj={pjPorId.get(l.p.pj)} semCnpj onAbrir={() => setAApurarAberto(l.p)} />
                      ) : (
                        <LinhaGuia
                          key={l.g.chave}
                          g={l.g}
                          hoje={dados.hoje}
                          pj={pjPorId.get(l.g.empresa_contabil_id)}
                          estab={l.g.estabelecimento_id ? estabPorId.get(l.g.estabelecimento_id) : undefined}
                          aprovarEmCurso={aprovaEmCurso(l.g)}
                          onAbrir={() => setAberta(l.g.chave)}
                        />
                      ),
                    )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {dados.aRecuperar.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-sky-900">
            <Undo2 className="h-4 w-4" />
            ISS a recuperar · {moeda(r2(dados.aRecuperar.reduce((s, a) => s + a.valor, 0)))}
          </p>
          <ul className="mt-2 space-y-1 text-[12.5px] text-sky-900">
            {dados.aRecuperar.map((a) => {
              const e = estabPorId.get(a.estabelecimento_id);
              const mes = mesDe(a.data) > a.competencia_nota ? mesDe(a.data) : proximoMes(mesDe(a.data));
              return (
                <li key={a.id}>
                  NF {a.nota_numero}
                  {a.jobs ? ` (${a.jobs})` : ""} · {e?.nome ?? "—"}: o cliente reteve {moeda(a.valor)} em {dataBr(a.data)}, depois de paga a
                  guia de {nomeDoMes(a.competencia_nota)}.{" "}
                  {a.forma === "compensar" ? (
                    <b className="font-semibold">
                      {e?.municipio ?? "O município"} permite compensar: entra como sugestão na guia de ISS de {nomeDoMes(mes)}.
                    </b>
                  ) : (
                    <b className="font-semibold">
                      {e?.municipio ?? "O município"} pede restituição: fica aqui até a contabilidade concluir o pedido.
                    </b>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {dados.aApurarErro && (
        <Nota tom="ambar" icone={<AlertTriangle className="h-3.5 w-3.5" />}>
          Não foi possível projetar o que falta apurar no recebimento: {dados.aApurarErro}
        </Nota>
      )}
      {aApurarAberto && (
        <DialogoAApurar dados={dados} pjPorId={pjPorId} p={aApurarAberto} onClose={() => setAApurarAberto(null)} />
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Clique numa guia para ver a memória de cálculo. A competência em curso é estimativa e não se aprova (na PJ de teste, aprova com
          confirmação). Aprovada, a guia vira imposto a pagar com o valor que a contabilidade mandou. Uma nota registrada com data de uma
          competência já aprovada reabre a guia como diferença a aprovar. Fora desta versão (pendência): rendimento de aplicação, recebimento
          avulso e as mudanças da reforma tributária.
        </span>
      </p>

      {guiaContabilDe && (
        <DialogoGuiaDaContabilidade
          pj={guiaContabilDe}
          dados={dados}
          onClose={() => setGuiaContabilDe(null)}
          onLancada={(texto) => {
            setGuiaContabilDe(null);
            setToast({ texto, link: true });
            startTransition(() => router.refresh());
          }}
        />
      )}

      {guiaAberta && (
        <MemoriaDialog
          key={guiaAberta.chave}
          g={guiaAberta}
          tenantId={dados.tenantId}
          pj={pjPorId.get(guiaAberta.empresa_contabil_id)}
          estab={guiaAberta.estabelecimento_id ? estabPorId.get(guiaAberta.estabelecimento_id) : undefined}
          cidadeDaMatriz={matrizDa(guiaAberta.empresa_contabil_id, pjPorId, estabPorId)?.municipio ?? ""}
          cnpjDaMatriz={matrizDa(guiaAberta.empresa_contabil_id, pjPorId, estabPorId)?.cnpj ?? "—"}
          cadastroDasCotas={cadastroDasCotas}
          hoje={dados.hoje}
          aprovarEmCurso={aprovaEmCurso(guiaAberta)}
          onClose={() => setAberta(null)}
          onAprovada={(texto) => {
            setAberta(null);
            setToast({ texto, link: true });
            startTransition(() => router.refresh());
          }}
        />
      )}

      <Dialog open={confirmarLote} onOpenChange={(o) => !aprovandoLote && setConfirmarLote(o)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCheck className="h-5 w-5 text-california-red" />
              Aprovar pelo valor calculado{loteDoCnpj ? ` · ${pjPorId.get(loteDoCnpj)?.nome ?? ""}` : ""}
            </DialogTitle>
            <DialogDescription>
              Use quando as guias da contabilidade batem com o sistema. Cada guia vira um imposto a pagar com o valor abaixo; guia sem valor só
              fica confirmada.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border rounded-xl border border-border text-[13px]">
            {aAprovar.map((g) => (
              <div key={g.chave} className="flex items-center justify-between gap-3 px-3.5 py-2">
                <span className="min-w-0 truncate">
                  {nomeGuia(g)} · <span className="text-muted-foreground">{nomeDoLocal(g)}</span>
                </span>
                <span className="font-mono font-semibold">{moeda(g.apurado)}</span>
              </div>
            ))}
          </div>
          {erroLote && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-[12.5px] text-california-red">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erroLote}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setConfirmarLote(false)}
              disabled={aprovandoLote}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void aprovarLote()}
              disabled={aprovandoLote || aAprovar.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
            >
              {aprovandoLote ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              Aprovar {aAprovar.length === 1 ? "a guia" : `as ${aAprovar.length} guias`}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-[560px] items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">
            {toast.texto}
            {toast.link && (
              <>
                {" "}
                <Link href="/financeiro/fiscal?aba=impostos" prefetch={false} className="whitespace-nowrap text-california-red hover:underline">
                  Ver em Impostos a Pagar →
                </Link>
              </>
            )}
          </span>
          <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso" className="text-emerald-700 hover:text-emerald-900">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** Quantos dias faltam, nas guias que ainda pedem aprovação. */
function Prazo({ g, hoje }: { g: GuiaDaTela; hoje: string }) {
  if (g.estado !== "a_aprovar" && g.estado !== "diferenca") return null;
  const d = diasEntre(hoje, g.vencimento);
  const texto = d < 0 ? `venceu há ${-d} ${-d === 1 ? "dia" : "dias"}` : d === 0 ? "vence hoje" : `em ${d} ${d === 1 ? "dia" : "dias"}`;
  return (
    <span className={cn("block text-[10.5px] font-semibold", d < 0 ? "text-rose-700" : d <= 5 ? "text-amber-700" : "text-muted-foreground")}>
      {texto}
    </span>
  );
}

function matrizDa(pjId: string, pjs: Map<string, PJDaTela>, estabs: Map<string, EstabelecimentoDaTela>) {
  const id = pjs.get(pjId)?.matriz_id;
  return id ? estabs.get(id) : undefined;
}

/**
 * O que entra e o que fica fora da apuração hoje: sem nota de saída com CNPJ
 * emissor, as guias só têm o que vem das NFs de fornecedor (crédito,
 * retenções, custo do trimestre).
 */
function AvisoDosFatos({ dados }: { dados: DadosDaApuracao }) {
  if (dados.notasNaApuracao > 0 && dados.notasSemCnpj === 0) return null;
  const fora =
    dados.notasSemCnpj > 0
      ? ` ${dados.notasSemCnpj === 1 ? "Uma nota emitida" : `${dados.notasSemCnpj} notas emitidas`} desde 01/10/2026 ${
          dados.notasSemCnpj === 1 ? "não diz" : "não dizem"
        } por qual CNPJ ${dados.notasSemCnpj === 1 ? "saiu e fica" : "saíram e ficam"} fora da apuração.`
      : "";
  if (dados.notasNaApuracao > 0) {
    return (
      <Nota tom="ambar" icone={<Info className="h-3.5 w-3.5" />}>
        {fora.trim()} O CNPJ emissor e o CNAE se escolhem no Faturar.
      </Nota>
    );
  }
  return (
    <Nota tom="ambar" icone={<Info className="h-3.5 w-3.5" />}>
      Ainda não há nota de saída com CNPJ emissor: o ISS, o PIS e a COFINS das vendas (e a receita na base do IRPJ e da CSLL) aparecem a partir da
      primeira nota emitida pelo Faturar com o CNPJ e o CNAE.{fora}{" "}
      {dados.nfsDeFornecedor > 0
        ? `Por enquanto, a apuração só tem ${
            dados.nfsDeFornecedor === 1 ? "a NF de fornecedor registrada" : `as ${dados.nfsDeFornecedor} NFs de fornecedor registradas`
          } na aprovação das PPs: o crédito de PIS e COFINS e o custo do trimestre. As retenções de CSRF e IRRF entram no mês em que a PP é paga.`
        : "Também não há NF de fornecedor registrada na aprovação das PPs."}
    </Nota>
  );
}

function LinhaGuia({
  g,
  hoje,
  pj,
  estab,
  aprovarEmCurso,
  onAbrir,
}: {
  g: GuiaDaTela;
  hoje: string;
  /** O regime diz se a base do IRPJ/CSLL é presumida ou o lucro bruto. */
  pj: PJDaTela | undefined;
  estab: EstabelecimentoDaTela | undefined;
  /** Na PJ de teste, a guia em curso ganha o "Aprovar" de contorno. */
  aprovarEmCurso: boolean;
  onAbrir: () => void;
}) {
  const debito = somaGrupo(g, ["debito"]);
  const creditos = somaGrupo(g, ["credito", "rateio_credito"]);
  const retido = somaGrupo(g, ["retido", "saldo", "compensacao"]);
  const temRateio = g.memoria.some((m) => m.grupo === "rateio_credito");
  const baseRotulo = g.periodo === "trimestral" ? g.memoria.filter((m) => m.grupo === "base").slice(-1)[0] : null;
  const base = baseRotulo ? baseRotulo.valor : g.base;
  const aprovado = r2(g.aprovacoes.reduce((s, a) => s + a.valor_guia, 0));
  const original = g.aprovacoes.find((a) => !a.diferenca);
  const motivoCurto = g.vencimento_motivo?.split("·")[1]?.trim();
  // O botão de ação abre a mesma memória de cálculo: com ele, o olho sai.
  const temAcao = aprovarEmCurso || g.estado === "a_aprovar" || g.estado === "diferenca";
  return (
    <tr onClick={onAbrir} className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40">
      <td className="px-3 py-3">
        <span className="whitespace-nowrap font-mono text-xs font-semibold">{dataBr(g.vencimento)}</span>
        <Prazo g={g} hoje={hoje} />
        {g.periodo === "trimestral" && g.cotas && g.cotas.length > 1 && (
          <span className="block text-[10px] text-muted-foreground">1ª de {g.cotas.length} cotas</span>
        )}
        {motivoCurto && (
          <span className="block text-[10px] leading-tight text-muted-foreground" title={g.vencimento_motivo ?? undefined}>
            {motivoCurto}
          </span>
        )}
      </td>
      <td className="px-3 py-3">
        <NomeDaGuia g={g} />
      </td>
      <td className="px-3 py-3">
        <span className="truncate font-medium">{estab ? `${estab.municipio}-${estab.uf}` : "Federal"}</span>
      </td>
      <td className="px-2 py-3 text-center text-xs">
        {g.periodo === "mensal" ? mesCurto(g.competencia) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-3 text-center text-xs">
        <span className={cn(g.periodo === "trimestral" && "font-semibold")}>{triCurto(trimestreDaGuia(g))}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-muted-foreground">
        {base ? moeda(base) : "—"}
        {g.periodo === "trimestral" && (
          <span className="block font-sans text-[10px]">
            {pj?.regime === "lucro_presumido" ? "base presumida" : g.lucro_real?.ajuste ? "base ajustada" : "lucro bruto"}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs">{debito ? moeda(debito) : "—"}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-emerald-700">
        {creditos ? moeda(creditos) : "—"}
        {temRateio && <span className="block font-sans text-[10px] font-semibold text-rose-700">sem a parte do 12.08</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-emerald-700">{retido ? moeda(retido) : "—"}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-sm font-bold tabular-nums">
        {moeda(g.apurado)}
        {/* Decisão 277: o saldo que a contabilidade levou vale no lugar do calculado. */}
        {(original?.saldo_credor_contabil ?? null) !== null ? (
          <span
            className="block whitespace-normal font-sans text-[10px] font-semibold leading-tight text-sky-700"
            title={`Informado pela contabilidade; o sistema calculou ${moeda(g.saldo_credor_gerado)}.`}
          >
            saldo credor {moeda(original!.saldo_credor_contabil!)} (contabilidade)
          </span>
        ) : (
          g.saldo_credor_gerado > 0 && (
            <span className="block whitespace-normal font-sans text-[10px] font-semibold leading-tight text-sky-700">
              saldo credor {moeda(g.saldo_credor_gerado)}
            </span>
          )
        )}
        {/* Só o valor a mais (ou a menos) desde a aprovação: a frase inteira
            passava da coluna. O sentido fica na dica. */}
        {g.estado === "diferenca" && (
          <span
            className={cn("block whitespace-nowrap font-sans text-[10.5px] font-semibold", g.delta > 0 ? "text-rose-700" : "text-emerald-700")}
            title={`${g.delta > 0 ? "A mais" : "A menos"} desde a aprovação`}
          >
            {g.delta > 0 ? "+" : "−"}
            {moeda(Math.abs(g.delta))}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs">
        {g.aprovacoes.length ? moeda(aprovado) : <span className="text-muted-foreground">—</span>}
        {original && Math.abs(original.valor_guia - original.valor_calculado) >= 0.01 && (
          <span className="block whitespace-normal font-sans text-[10px] leading-tight text-amber-700">
            calculado {moeda(original.valor_calculado)}
          </span>
        )}
      </td>
      <td className="px-2 py-3 text-center">{situacaoDa(g)}</td>
      <td className="px-2 py-3 text-center">
        <div className="flex items-center justify-center gap-1">
          {aprovarEmCurso && (
            <button
              type="button"
              title="Competência em curso: aprova com confirmação (PJ de teste)"
              onClick={(e) => {
                e.stopPropagation();
                onAbrir();
              }}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-california-red/60 bg-white px-2 py-1.5 text-[11px] font-semibold text-california-red transition-colors hover:bg-california-red/5"
            >
              <ClipboardCheck className="h-3 w-3" />
              Aprovar
            </button>
          )}
          {(g.estado === "a_aprovar" || g.estado === "diferenca") && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAbrir();
              }}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-california-red px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <ClipboardCheck className="h-3 w-3" />
              {g.estado === "diferenca" ? "Diferença" : g.apurado > 0 ? "Aprovar" : "Confirmar"}
            </button>
          )}
          {!temAcao && (
            <button
              type="button"
              title="Ver a memória de cálculo"
              aria-label="Ver a memória de cálculo"
              onClick={(e) => {
                e.stopPropagation();
                onAbrir();
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
}
