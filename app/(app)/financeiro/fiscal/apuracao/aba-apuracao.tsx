"use client";

/**
 * A aba Apuração da seção Fiscal (módulo fiscal, entrega 2; lista por
 * vencimento desde a decisão 181, 16/10/2026): todas as guias numa lista
 * só, na ordem de vencimento, com Competência (mês) e Trimestre em colunas,
 * débito, créditos, retido, apurado, guia aprovada e situação (em curso · a
 * aprovar · aprovada · diferença). A competência e a situação viram filtros
 * rápidos (padrão "Em aberto": o que ainda não foi aprovado), o CNPJ tem
 * atalho próprio (como a regional na aba PPs), e os títulos das colunas
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
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { trimestreDe } from "@/lib/fiscal/apuracao";
import { dataBr, mesDe, nomeDoMes, proximoMes, r2 } from "@/lib/fiscal/datas";
import { aprovarGuiasPeloCalculado } from "./actions";
import type { DadosDaApuracao, EstabelecimentoDaTela, GuiaDaTela, PJDaTela } from "./dados";
import { MemoriaDialog } from "./memoria-dialog";
import { MultiSelectCnpjs } from "./multi-select-cnpjs";
import { Nota, ResumoItem, moeda, nomeGuia, situacaoDa, somaGrupo } from "./ui";
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
type Mostrar = "aberto" | "a_aprovar" | "em_curso" | "aprovadas" | "todas";
const MOSTRAR: Array<[Mostrar, string, (g: GuiaDaTela) => boolean]> = [
  ["aberto", "Em aberto", (g) => g.estado !== "aprovada"],
  ["a_aprovar", "A aprovar", (g) => g.estado === "a_aprovar" || g.estado === "diferenca"],
  ["em_curso", "Em curso", (g) => g.estado === "em_curso"],
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
      rotulo: "CNPJ",
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

/** As larguras da tabela (`table-fixed`). */
const LARGURAS = ["7%", "13.5%", "10%", "6.5%", "6.5%", "7.5%", "7%", "7%", "7%", "7.5%", "6.5%", "6.5%", "7.5%"];

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

  // Os chips de competência: os meses e os trimestres que têm guia.
  const meses = React.useMemo(() => [...new Set(guias.filter((g) => g.periodo === "mensal").map((g) => g.competencia))].sort(), [guias]);
  const trimestres = React.useMemo(() => [...new Set(guias.map(trimestreDaGuia))].sort(), [guias]);
  const opcoesDeCnpj = React.useMemo(
    () =>
      pjs.map((p) => ({
        id: p.id,
        nome: p.nome,
        cnpj: (p.matriz_id ? estabelecimentos.find((e) => e.id === p.matriz_id)?.cnpj : null) ?? "—",
      })),
    [pjs, estabelecimentos],
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
  const aAprovar = lista.filter((g) => g.estado === "a_aprovar");
  const pendentes = lista.filter((g) => g.estado === "a_aprovar" || g.estado === "diferenca");
  const totalAAprovar = r2(pendentes.reduce((s, g) => s + aAprovarDa(g), 0));
  const emCurso = lista.filter((g) => g.estado === "em_curso");
  const totalEmCurso = r2(emCurso.reduce((s, g) => s + g.apurado, 0));
  const proxima = [...pendentes].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
  const guiaAberta = aberta ? guias.find((g) => g.chave === aberta) ?? null : null;
  const contagem = (f: (g: GuiaDaTela) => boolean) => porCnpj.filter(f).length;

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
              <Chip key={k} ativo={mostrar === k} onClick={() => setMostrar(k)} n={k === "todas" ? undefined : contagem(f)}>
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
        <div className="ml-auto">
          <MultiSelectCnpjs opcoes={opcoesDeCnpj} selecionados={cnpjs} onSelectionChange={setCnpjs} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5">
        <ResumoItem
          icone={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
          label={`A aprovar · ${pendentes.length} ${pendentes.length === 1 ? "guia" : "guias"}`}
          valor={moeda(totalAAprovar)}
        />
        <div className="h-5 w-px bg-border" />
        <ResumoItem icone={<Hourglass className="h-3.5 w-3.5 text-muted-foreground" />} label="Em curso (estimativa)" valor={moeda(totalEmCurso)} />
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
        {aAprovar.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setErroLote(null);
              setConfirmarLote(true);
            }}
            className="ml-auto inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-white px-3.5 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
          >
            <ListChecks className="h-4 w-4" />
            Aprovar {aAprovar.length === 1 ? "a guia" : `as ${aAprovar.length} guias`} pelo valor calculado
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
            {lista.length === 0 && (
              <tr>
                <td colSpan={LARGURAS.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {colunas.ativo || mostrar !== "todas" || cnpjs.length ? "Nenhuma guia com esse filtro." : "Nenhuma guia até agora."}
                </td>
              </tr>
            )}
            {lista.map((g) => (
              <LinhaGuia
                key={g.chave}
                g={g}
                hoje={dados.hoje}
                pj={pjPorId.get(g.empresa_contabil_id)}
                estab={g.estabelecimento_id ? estabPorId.get(g.estabelecimento_id) : undefined}
                aprovarEmCurso={aprovaEmCurso(g)}
                onAbrir={() => setAberta(g.chave)}
              />
            ))}
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

      <BlocosAApurar dados={dados} pjPorId={pjPorId} />

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Clique numa guia para ver a memória de cálculo. A competência em curso é estimativa e não se aprova (na PJ de teste, aprova com
          confirmação). Aprovada, a guia vira imposto a pagar com o valor que a contabilidade mandou. Uma nota registrada com data de uma
          competência já aprovada reabre a guia como diferença a aprovar. Fora desta versão (pendência): rendimento de aplicação, recebimento
          avulso e as mudanças da reforma tributária.
        </span>
      </p>

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
              Aprovar pelo valor calculado
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

/**
 * "<PJ> · a apurar no recebimento" (protótipo `telas/apuracao.tsx`): no lucro
 * presumido pelo caixa, PIS, COFINS, IRPJ e CSLL só nascem no recebimento.
 * Até lá, os títulos em aberto das notas da PJ são projetados pela previsão
 * de recebimento (`lib/fiscal/a-apurar.ts`), e a projeção entra no fluxo de
 * caixa como estimativa. Vale para todas as competências; sem título em
 * aberto, o bloco não aparece.
 */
function BlocosAApurar({ dados, pjPorId }: { dados: DadosDaApuracao; pjPorId: Map<string, PJDaTela> }) {
  return (
    <>
      {dados.aApurarErro && (
        <Nota tom="ambar" icone={<AlertTriangle className="h-3.5 w-3.5" />}>
          Não foi possível projetar o que falta apurar no recebimento: {dados.aApurarErro}
        </Nota>
      )}
      {dados.aApurar.map((b) => (
        <div key={b.pj} className="rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Hourglass className="h-4 w-4 text-muted-foreground" />
            {pjPorId.get(b.pj)?.nome ?? b.pj_nome} · a apurar no recebimento
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            No regime de caixa, PIS, COFINS, IRPJ e CSLL só nascem quando o cliente paga. Enquanto isso, o sistema projeta pela previsão de
            recebimento dos títulos em aberto, e a projeção entra no fluxo de caixa como estimativa.
          </p>
          <table className="mt-3 w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1 font-semibold">Nota</th>
                <th className="py-1 font-semibold">Recebimento previsto</th>
                <th className="py-1 text-right font-semibold">A receber</th>
                <th className="py-1 text-right font-semibold">PIS + COFINS</th>
                <th className="py-1 text-right font-semibold">Vencem em</th>
                <th className="py-1 pl-4 font-semibold">IRPJ e CSLL</th>
              </tr>
            </thead>
            <tbody>
              {b.linhas.map((l) => (
                <tr key={l.titulo_id} className="border-t border-border">
                  <td className="py-1.5">{l.rotulo}</td>
                  <td className="py-1.5 font-mono">
                    {dataBr(l.previsao)}
                    {/* Previsão que já passou: a projeção conta o recebimento a partir de amanhã. */}
                    {l.recebimento !== l.previsao && (
                      <span className="block font-sans text-[10.5px] text-muted-foreground">
                        vencida · projetada para {dataBr(l.recebimento)}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono">{moeda(l.a_receber)}</td>
                  <td className="py-1.5 text-right font-mono">{moeda(l.pis_cofins)}</td>
                  <td className="py-1.5 text-right font-mono">{dataBr(l.vencimento)}</td>
                  <td className="py-1.5 pl-4 text-muted-foreground">entra na base do {l.rotulo_trimestre}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
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
        <span className="font-semibold">
          {g.titulo}
          {g.codigo && <span className="ml-1.5 font-mono text-[11px] font-medium text-muted-foreground">DARF {g.codigo}</span>}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{pj?.nome ?? "—"}</span>
          <span className="truncate text-[11px] text-muted-foreground" title={pj?.como_apura ?? pj?.rotulo_regime}>
            {estab ? `${estab.municipio}-${estab.uf}` : "federal"} · {pj?.rotulo_regime ?? ""}
          </span>
        </div>
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
          <span className="block font-sans text-[10px]">{pj?.regime === "lucro_presumido" ? "base presumida" : "lucro bruto"}</span>
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
        {g.saldo_credor_gerado > 0 && (
          <span className="block whitespace-normal font-sans text-[10px] font-semibold leading-tight text-sky-700">
            saldo credor {moeda(g.saldo_credor_gerado)}
          </span>
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
