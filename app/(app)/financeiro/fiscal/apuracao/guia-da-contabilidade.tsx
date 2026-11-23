"use client";

/**
 * A Guia da contabilidade (decisão 277, entrega 2b): a guia que a Apuração
 * não calcula — competência de antes de outubro/2026 paga no 4º trimestre,
 * filial sem nota no sistema, imposto fora da apuração — entra aprovada, com
 * o valor que a contabilidade mandou, o motivo e o rateio por empresa
 * gerencial (as regionais pela receita do período). Vai para Impostos a
 * Pagar e aparece no bloco do CNPJ.
 */
import * as React from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { RateioDaGuia } from "@/lib/fiscal/apuracao";
import { mesDe } from "@/lib/fiscal/datas";
import { gerenciaisDaBase, rateioPorGerencial, type ParteDaGerencial } from "@/lib/fiscal/rateio-gerencial";
import { regrasDoCnpj } from "@/lib/fiscal/rateio-gerencial-dados";
import { lancarGuiaDaContabilidade, previaDaReceitaDoPeriodo } from "./actions";
import type { DadosDaApuracao, GuiaDaContabilidade, PJDaTela } from "./dados";
import { NomeDaGuia, moeda, tituloPorExtenso } from "./ui";
import { RateioPorGerencial } from "./rateio-por-gerencial";

type Tributo = "ISS" | "ISS_RET" | "PIS" | "COFINS" | "IRPJ" | "CSLL" | "CSRF" | "IRRF" | "IOF";
interface Opcao {
  chave: string;
  titulo: string;
  tributo: Tributo;
  periodo: "mensal" | "trimestral";
  municipal: boolean;
  codigo: string | null;
}

/** Os impostos que a guia pode ser, com o código do DARF do regime do CNPJ. */
function opcoesDo(presumido: boolean): Opcao[] {
  const m = (chave: string, titulo: string, tributo: Tributo, codigo: string | null, municipal = false): Opcao => ({
    chave,
    titulo,
    tributo,
    periodo: "mensal",
    municipal,
    codigo,
  });
  const t = (chave: string, titulo: string, tributo: Tributo, codigo: string): Opcao => ({
    chave,
    titulo,
    tributo,
    periodo: "trimestral",
    municipal: false,
    codigo,
  });
  return [
    m("iss", "ISS próprio", "ISS", null, true),
    m("iss_ret", "ISS retido de fornecedores", "ISS_RET", null, true),
    ...(presumido
      ? [m("pis", "PIS", "PIS", "8109"), m("cofins", "COFINS", "COFINS", "2172")]
      : [
          m("pis", "PIS", "PIS", "6912"),
          m("pis_cum", "PIS cumulativo", "PIS", "8109"),
          m("cofins", "COFINS", "COFINS", "5856"),
          m("cofins_cum", "COFINS cumulativa", "COFINS", "2172"),
        ]),
    m("csrf", "PIS/COFINS/CSLL retidos de fornecedores", "CSRF", "5952"),
    m("irrf", "IRRF retido de fornecedores", "IRRF", "1708"),
    m("iof", "IOF do mútuo", "IOF", "1150"),
    t("irpj", "IRPJ (com adicional)", "IRPJ", presumido ? "2089" : "0220"),
    t("csll", "CSLL", "CSLL", presumido ? "2372" : "6012"),
  ];
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
const rotuloTri = (t: string) => `${t.split("-T")[1]}º tri/${t.slice(0, 4)}`;
const nomeMesLongo = (c: string) =>
  `${["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
const triDe = (c: string) => `${c.slice(0, 4)}-T${Math.ceil(Number(c.slice(5, 7)) / 3)}`;

/** As competências que a guia pode ter: de julho/2026 (o 3º trimestre) até o mês de hoje. */
function competencias(hoje: string) {
  const meses: string[] = [];
  for (let c = "2026-07"; c <= mesDe(hoje); ) {
    meses.push(c);
    const [a, m] = c.split("-").map(Number);
    c = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  }
  const tris = [...new Set(meses.map(triDe))];
  return { meses, tris };
}

const COTAS = [
  ["unica", "Cota única"],
  ["1", "1ª de 3 cotas"],
  ["2", "2ª de 3 cotas"],
  ["3", "3ª de 3 cotas"],
] as const;

const CAMPO = "h-9 w-full rounded-md border border-input bg-white px-2.5 text-sm";

export function DialogoGuiaDaContabilidade({
  pj,
  dados,
  onClose,
  onLancada,
}: {
  pj: PJDaTela;
  dados: DadosDaApuracao;
  onClose: () => void;
  onLancada: (texto: string) => void;
}) {
  const presumido = pj.regime === "lucro_presumido";
  const opcoes = React.useMemo(() => opcoesDo(presumido), [presumido]);
  const estabs = dados.estabelecimentos.filter((e) => e.empresa_contabil_id === pj.id);
  const { meses, tris } = React.useMemo(() => competencias(dados.hoje), [dados.hoje]);
  const regras = regrasDoCnpj(dados.regrasDoRateio, pj.id);
  const gerencial = dados.regrasDoRateio.gerencialDoCnpj[pj.id] ?? null;

  const [chave, setChave] = React.useState("pis");
  const op = opcoes.find((o) => o.chave === chave) ?? opcoes[0];
  const [estab, setEstab] = React.useState(estabs[0]?.id ?? "");
  const [mes, setMes] = React.useState(meses.includes("2026-09") ? "2026-09" : meses[0]);
  const [tri, setTri] = React.useState(tris.includes("2026-T3") ? "2026-T3" : tris[0]);
  const [cota, setCota] = React.useState<(typeof COTAS)[number][0]>("unica");
  const [vencimento, setVencimento] = React.useState("");
  const [valor, setValor] = React.useState(0);
  const [motivo, setMotivo] = React.useState("");
  const competencia = op.periodo === "trimestral" ? tri : mes;

  // A receita do período (do servidor): a base que divide cada gerencial entre as regionais.
  const [base, setBase] = React.useState<RateioDaGuia[] | null>(null);
  const [fonte, setFonte] = React.useState<"sistema" | "historico" | null>(null);
  const [erroBase, setErroBase] = React.useState<string | null>(null);
  const [partes, setPartes] = React.useState<ParteDaGerencial[]>([]);
  React.useEffect(() => {
    let vivo = true;
    setBase(null);
    setErroBase(null);
    previaDaReceitaDoPeriodo({ empresa_contabil_id: pj.id, competencia })
      .then((r) => {
        if (!vivo) return;
        if (!r.ok) {
          setErroBase(r.message);
          setBase([]);
          return;
        }
        setBase(r.base);
        setFonte(r.fonte);
      })
      .catch(() => vivo && (setErroBase("Não foi possível ler a receita do período."), setBase([])));
    return () => {
      vivo = false;
    };
  }, [pj.id, competencia]);
  // Nova base: a sugestão por gerencial recomeça (com o valor de agora).
  React.useEffect(() => {
    if (base) setPartes(gerenciaisDaBase(base, valor, gerencial));
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  // A guia que o sistema já calcula se aprova por ela, não por aqui.
  const calculada = dados.guias.find(
    (g) =>
      g.empresa_contabil_id === pj.id &&
      g.competencia === competencia &&
      (op.municipal ? g.tributo === op.tributo && g.estabelecimento_id === estab : g.codigo === op.codigo),
  );

  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  async function lancar() {
    if (enviando) return;
    setErro(null);
    if (calculada) return setErro("O sistema já calcula esta guia: aprove por ela, com o valor da contabilidade.");
    if (op.municipal && !estab) return setErro("Escolha o município da guia.");
    if (!vencimento) return setErro("Informe o vencimento da guia.");
    if (!(valor > 0)) return setErro("Informe o valor da guia.");
    if (motivo.trim().length < 10) return setErro("Explique por que o sistema não calculou esta guia (mínimo 10 caracteres).");
    if (!base) return setErro("Espere a receita do período carregar.");
    const conferido = rateioPorGerencial(partes, base, regras, valor);
    if (!conferido.ok) return setErro(conferido.message);
    const sufixoCota = op.periodo === "trimestral" && cota !== "unica" ? ` · ${COTAS.find(([k]) => k === cota)![1]}` : "";
    setEnviando(true);
    let r: Awaited<ReturnType<typeof lancarGuiaDaContabilidade>>;
    try {
      r = await lancarGuiaDaContabilidade({
        tributo: op.tributo,
        titulo: `${op.titulo}${sufixoCota}`,
        codigo_receita: op.codigo,
        empresa_contabil_id: pj.id,
        estabelecimento_id: op.municipal ? estab : null,
        competencia,
        rotulo_competencia: op.periodo === "trimestral" ? `${tri.split("-T")[1]}º trimestre/${tri.slice(0, 4)}` : nomeMesLongo(mes),
        motivo: motivo.trim(),
        vencimento,
        valor,
        rateio_gerencial: partes,
        guia_path: null,
      });
    } catch {
      r = { ok: false, message: "Não foi possível falar com o servidor. Tente de novo." };
    }
    setEnviando(false);
    if (!r.ok) return setErro(r.message);
    onLancada(
      `${tituloPorExtenso({ titulo: op.titulo, codigo: op.codigo })}${sufixoCota} de ${op.periodo === "trimestral" ? rotuloTri(tri) : rotuloMes(mes)} (${pj.nome}) entrou aprovada, com ${moeda(valor)}. Está em "Aprovadas" e em Impostos a Pagar.`,
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !enviando && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-california-red" />
            Guia da contabilidade · {pj.nome}
          </DialogTitle>
          <DialogDescription>
            Para a guia que o sistema ainda não calcula: competência de antes de outubro/2026, filial sem nota no sistema, imposto fora da
            apuração. Ela entra aprovada, com o valor que a contabilidade mandou, e vai para Impostos a Pagar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2 space-y-1">
            <span className="text-xs font-semibold">Imposto</span>
            <select className={CAMPO} value={chave} onChange={(e) => setChave(e.target.value)}>
              {opcoes.map((o) => (
                <option key={o.chave} value={o.chave}>
                  {o.codigo === "6912" ? "PIS não cumulativo" : o.codigo === "5856" ? "COFINS não cumulativa" : o.titulo}
                  {o.codigo ? ` · DARF ${o.codigo}` : " · guia municipal"}
                </option>
              ))}
            </select>
          </label>
          {op.municipal && (
            <label className="space-y-1">
              <span className="text-xs font-semibold">Município</span>
              <select className={CAMPO} value={estab} onChange={(e) => setEstab(e.target.value)}>
                {estabs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.municipio}-{e.uf}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1">
            <span className="text-xs font-semibold">{op.periodo === "trimestral" ? "Trimestre" : "Competência"}</span>
            {op.periodo === "trimestral" ? (
              <select className={CAMPO} value={tri} onChange={(e) => setTri(e.target.value)}>
                {tris.map((t) => (
                  <option key={t} value={t}>
                    {rotuloTri(t)}
                  </option>
                ))}
              </select>
            ) : (
              <select className={CAMPO} value={mes} onChange={(e) => setMes(e.target.value)}>
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {rotuloMes(m)}
                  </option>
                ))}
              </select>
            )}
          </label>
          {op.periodo === "trimestral" && (
            <label className="space-y-1">
              <span className="text-xs font-semibold">Cota</span>
              <select className={CAMPO} value={cota} onChange={(e) => setCota(e.target.value as (typeof COTAS)[number][0])}>
                {COTAS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1">
            <span className="text-xs font-semibold">Vencimento</span>
            <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold">Valor da guia</span>
            <MoneyInput value={valor} onValueChange={setValor} />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-xs font-semibold">Por que o sistema não calculou?</span>
            <Textarea
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: PIS de setembro, pago em outubro: competência de antes da apuração do sistema."
            />
          </label>
        </div>

        {calculada && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[12.5px] text-amber-900">
            O sistema já calcula esta guia ({calculada.titulo} de {calculada.rotulo_competencia}): aprove por ela na lista, com o valor da
            contabilidade.
          </p>
        )}

        {base === null ? (
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Lendo a receita do período…
          </p>
        ) : (
          <div className="space-y-1">
            {valor > 0 && <RateioPorGerencial total={valor} base={base} regras={regras} partes={partes} onChange={setPartes} />}
            <p className="text-[11px] text-muted-foreground">
              {erroBase ??
                (base.length === 0
                  ? "Sem receita do CNPJ no período: escolha a regional de cada empresa."
                  : fonte === "historico"
                    ? "As regionais dividem pela receita do período no histórico da planilha."
                    : "As regionais dividem pela receita do período nas notas do sistema.")}
            </p>
          </div>
        )}

        {erro && <p className="rounded-lg border border-california-red/40 bg-california-red/5 p-2.5 text-[12.5px] text-california-red">{erro}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} disabled={enviando} className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void lancar()}
            disabled={enviando || !!calculada}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Lançar a guia aprovada
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A linha da guia da contabilidade, nas mesmas 13 colunas da lista. */
export function LinhaDaContabilidade({ c, local }: { c: GuiaDaContabilidade; local: string }) {
  const dica = `${c.motivo}\nRateio: ${c.rateio.map((r) => `${r.empresa}${r.regional ? ` · ${r.regional}` : ""} ${moeda(r.valor)}`).join("; ")}`;
  const competencia = c.periodo === "mensal" ? rotuloMes(c.competencia) : "—";
  return (
    <tr className="border-b border-border bg-amber-50/30 last:border-0" title={dica}>
      <td className="px-3 py-3">
        <span className="whitespace-nowrap font-mono text-xs font-semibold">{c.vencimento.split("-").reverse().join("/")}</span>
        {c.status === "pago" && c.pago_em && (
          <span className="block text-[10.5px] text-muted-foreground">paga em {c.pago_em.split("-").reverse().join("/")}</span>
        )}
      </td>
      <td className="px-3 py-3">
        <NomeDaGuia g={{ titulo: c.titulo, codigo: c.codigo }} />
        <span className="block text-[10.5px] text-amber-800">guia da contabilidade</span>
      </td>
      <td className="px-3 py-3">
        <span className="truncate font-medium">{local}</span>
      </td>
      <td className="px-2 py-3 text-center text-xs">{competencia}</td>
      <td className="px-2 py-3 text-center text-xs">{rotuloTri(c.trimestre)}</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground">—</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground">—</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground">—</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground">—</td>
      <td className="px-3 py-3 text-right">
        <span className="font-mono text-xs text-muted-foreground">—</span>
        <span className="block text-[10px] leading-tight text-muted-foreground">sem cálculo no sistema</span>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs font-semibold">{moeda(c.valor)}</td>
      <td className="px-2 py-3 text-center">
        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
          Aprovada
        </span>
        <span className="block text-[10px] text-muted-foreground">{c.status === "pago" ? "e paga" : "pela contabilidade"}</span>
      </td>
      <td className="px-2 py-3 text-center text-[10.5px] text-muted-foreground" />
    </tr>
  );
}
