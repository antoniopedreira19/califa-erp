"use client";

/**
 * O histórico de versões da Planilha Interna (decisão 186, 17/10/2026), do
 * protótipo aprovado pelo Tiago em 15/10/2026. Três peças, no molde das que
 * a planilha já tem:
 *   - `BotaoHistorico`: o botão da barra, ao lado do Bruto/Líquido, com a
 *     lista dos momentos do job (o molde do menu "Exibir");
 *   - `FaixaDaVersao`: a faixa acima da planilha quando uma versão antiga
 *     está na tela (o molde da faixa da errata pronta);
 *   - `SeloDaLinha`: o selo da linha que mudou naquela versão (os selos da
 *     errata).
 * A conta das versões mora em `lib/calculos/historico-da-planilha.ts`.
 */
import * as React from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FilePenLine,
  History,
  Landmark,
  Loader2,
  PiggyBank,
  Plus,
  Send,
  Undo2,
  Unlock,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { ERRATA, HISTORICO } from "@/app/(app)/_planilha/blocos";
import { tipoCustoLabel } from "@/lib/types";
import { formatDataAsHoraBr, formatDiaHoraCurtoBr } from "@/lib/formatar-data-hora";
import type { MudancaNaLinha, VersaoDaPlanilha } from "@/lib/calculos/historico-da-planilha";

/** Centavos: o que a tela compara para dizer se um valor mudou. */
const centavos = (v: number) => Math.round(v * 100);

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (centavos(v) === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

/** A cor do delta do valor do job, a mesma do card de Erratas: subiu em
 *  verde, desceu em vermelho. */
function corDoDelta(delta: number): string {
  if (centavos(delta) > 0) return "text-emerald-700";
  if (centavos(delta) < 0) return "text-red-700";
  return "text-muted-foreground";
}

function iconeDe(v: VersaoDaPlanilha) {
  // Decisão 226: a versão que o cliente aprovou, no histórico do orçamento.
  if (v.chave === "aprovada") return CheckCircle2;
  if (v.tipo === "errata") return v.rotulo === "Errata de save" ? PiggyBank : FilePenLine;
  if (v.tipo === "fila" || v.tipo === "alteracao") return Landmark;
  if (v.tipo === "save") return PiggyBank;
  if (v.tipo === "abertura") return Unlock;
  if (v.tipo === "envio") return Send;
  if (v.tipo === "linha_vermelha") return Plus;
  return Eye;
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "1 linha nova · 1 linha cancelada" — o que o momento mexeu. */
export function resumoDaVersao(v: VersaoDaPlanilha): string {
  if (v.tipo === "atual") return "Como está hoje";
  if (v.chave === "aprovada") return "Versão que o cliente aprovou";
  if (v.tipo === "envio") return "Nasce da versão aprovada do orçamento";
  if (v.tipo === "abertura") return "Valor inicial do job";
  if (v.tipo === "save") return "A linha sai do save";
  // Decisão 226: a linha vermelha que entrou sem errata.
  if (v.tipo === "linha_vermelha") return `${v.mudancas[0]?.item ?? "Linha"} · sem orçado e sem planejado`;
  const conta = (a: MudancaNaLinha["acao"]) => v.mudancas.filter((m) => m.acao === a).length;
  const partes: string[] = [];
  if (conta("nova")) partes.push(plural(conta("nova"), "linha nova", "linhas novas"));
  if (conta("removida")) partes.push(plural(conta("removida"), "linha removida", "linhas removidas"));
  if (conta("cancelada")) partes.push(plural(conta("cancelada"), "linha cancelada", "linhas canceladas"));
  if (conta("alterada")) partes.push(plural(conta("alterada"), "linha alterada", "linhas alteradas"));
  if (conta("save")) partes.push(`save em ${plural(conta("save"), "linha", "linhas")}`);
  if (conta("movida")) partes.push(plural(conta("movida"), "item reorganizado", "itens reorganizados"));
  if (v.estrutura.length)
    partes.push(plural(v.estrutura.length, "mudança nos agrupamentos", "mudanças nos agrupamentos"));
  return partes.join(" · ") || "Sem mudança na planilha";
}

/** O que mudou na linha, em palavras curtas. */
function textoDaMudanca(m: MudancaNaLinha, moeda: string): string {
  const r = (v: number | null) => formatCurrency(v ?? 0, moeda);
  if (m.acao === "nova") {
    const plan = m.planejadoPara !== null && centavos(m.planejadoPara) !== 0 ? ` · planejado ${r(m.planejadoPara)}` : "";
    return `nova · ${r(m.orcadoPara)}${plan}`;
  }
  if (m.acao === "removida") return `removida · ${r(m.orcadoDe)} → ${r(0)}`;
  if (m.acao === "movida") return `${m.grupoDe} → ${m.grupo}`;
  const partes: string[] = [];
  if (m.tipoDe && m.tipoPara && m.tipoDe !== m.tipoPara) partes.push(`tipo ${m.tipoDe} → ${m.tipoPara}`);
  if (m.orcadoDe !== null && m.orcadoPara !== null && centavos(m.orcadoDe) !== centavos(m.orcadoPara))
    partes.push(`orçado ${r(m.orcadoDe)} → ${r(m.orcadoPara)}`);
  if (m.planejadoDe !== null && m.planejadoPara !== null && centavos(m.planejadoDe) !== centavos(m.planejadoPara))
    partes.push(`planejado ${r(m.planejadoDe)} → ${r(m.planejadoPara)}`);
  if (m.saveDe === false && m.savePara === true) partes.unshift("vira save");
  if (m.saveDe === true && m.savePara === false) partes.unshift("sai do save");
  if (m.acao === "cancelada") partes.unshift("cancelada");
  return partes.join(" · ") || "alterada";
}

// ---- O botão da barra --------------------------------------------------------

export function BotaoHistorico({
  versoes,
  carregando,
  erro,
  selecionada,
  valorDe,
  moeda,
  onAbrir,
  onEscolher,
  titulo = "Histórico da planilha",
  dica = "As versões da planilha, de cada momento do job",
}: {
  /** O título da lista e a dica do botão: o orçamento tem os seus
   *  (decisão 226). */
  titulo?: string;
  dica?: string;
  /** Da mais nova (a atual) para a mais antiga; `null` antes da leitura. */
  versoes: VersaoDaPlanilha[] | null;
  carregando: boolean;
  erro: string | null;
  selecionada: string;
  valorDe: (v: VersaoDaPlanilha) => number;
  moeda: string;
  /** O histórico só é lido quando o menu abre pela primeira vez. */
  onAbrir: () => void;
  onEscolher: (chave: string) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const caixa = React.useRef<HTMLDivElement>(null);
  const vendoAntiga = selecionada !== "atual";

  // Clique fora e Esc fecham: o menu é flutuante e não tem overlay, como o
  // "Exibir".
  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => {
          if (!aberto) onAbrir();
          setAberto((v) => !v);
        }}
        title={dica}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
          vendoAntiga ? HISTORICO.botaoAtivo : "border-border bg-card text-foreground hover:bg-muted",
        )}
      >
        <History className={cn("h-3.5 w-3.5", vendoAntiga ? "text-california-red" : "text-muted-foreground")} />
        Histórico
        {versoes && (
          <span
            className={cn(
              "rounded-full px-1.5 py-px font-mono text-[10px] font-bold",
              vendoAntiga ? "bg-california-red text-white" : "bg-muted text-muted-foreground",
            )}
          >
            {versoes.length}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[440px] overflow-hidden rounded-xl border border-[#d7d5cf] bg-card text-left shadow-[0_14px_30px_-12px_rgba(0,0,0,.28)]">
          <p className="border-b border-border px-3.5 pb-1.5 pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
            {titulo}
          </p>
          {erro ? (
            <p className="px-3.5 py-4 text-xs text-red-700">{erro}</p>
          ) : !versoes || carregando ? (
            <p className="flex items-center gap-2 px-3.5 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando o histórico…
            </p>
          ) : (
            <ol className="max-h-[520px] overflow-y-auto py-1.5">
              {versoes.map((v, k) => {
                const Icone = iconeDe(v);
                const valor = valorDe(v);
                const anterior = versoes[k + 1];
                const delta = anterior ? valor - valorDe(anterior) : 0;
                const ativa = v.chave === selecionada;
                return (
                  <li key={v.chave} className="relative">
                    {k < versoes.length - 1 && (
                      <span aria-hidden className="absolute bottom-[-6px] left-[25px] top-[30px] w-px bg-border" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onEscolher(v.chave);
                        setAberto(false);
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 px-3.5 py-2 text-left transition-colors",
                        ativa ? "bg-california-red/[0.06]" : "hover:bg-muted/60",
                      )}
                    >
                      <span
                        className={cn(
                          "relative z-10 mt-0.5 flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border",
                          ativa
                            ? "border-california-red bg-california-red text-white"
                            : "border-border bg-card text-muted-foreground",
                        )}
                      >
                        <Icone className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[12.5px] font-semibold text-foreground">
                            {v.rotulo}
                            {v.tipo === "atual" && (
                              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                Atual
                              </span>
                            )}
                          </span>
                          <span className="flex-none font-mono text-[11.5px] font-semibold text-foreground">
                            {formatCurrency(valor, moeda)}
                          </span>
                        </span>
                        {v.descricao && (
                          <span className="mt-0.5 block truncate text-[11.5px] text-foreground/80">
                            “{v.descricao}”
                          </span>
                        )}
                        <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
                          <span className="truncate">
                            {v.tipo === "atual"
                              ? resumoDaVersao(v)
                              : `${formatDiaHoraCurtoBr(v.quando)}${v.autor ? ` · ${v.autor}` : ""} · ${resumoDaVersao(v)}`}
                          </span>
                          {centavos(delta) !== 0 && (
                            <span className={cn("flex-none font-mono font-bold", corDoDelta(delta))}>
                              {comSinal(delta, moeda)}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="border-t border-border px-3.5 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
            Clique num momento para ver a planilha como ela estava. Só leitura.
          </p>
        </div>
      )}
    </div>
  );
}

// ---- A faixa da versão antiga -----------------------------------------------

export function FaixaDaVersao({
  versao,
  valorJob,
  moeda,
  temAnterior,
  temProxima,
  onAnterior,
  onProxima,
  onAtual,
  destacar,
  onDestacar,
  nota = "Só leitura: o realizado e as PPs ficam na planilha atual.",
}: {
  /** O que a faixa diz da versão antiga: o orçamento tem a sua (decisão 226). */
  nota?: string;
  versao: VersaoDaPlanilha;
  /** O valor do job antes e depois do momento. */
  valorJob: { antes: number | null; depois: number };
  moeda: string;
  temAnterior: boolean;
  temProxima: boolean;
  onAnterior: () => void;
  onProxima: () => void;
  onAtual: () => void;
  destacar: boolean;
  onDestacar: (v: boolean) => void;
}) {
  const [todas, setTodas] = React.useState(false);
  const Icone = iconeDe(versao);
  const delta = valorJob.antes === null ? 0 : valorJob.depois - valorJob.antes;
  const mudou = valorJob.antes !== null && centavos(delta) !== 0;
  const chips = [
    ...versao.mudancas.map((m, k) => ({
      chave: `${m.acao}-${m.itemId ?? m.item}-${k}`,
      nome: m.item as string | null,
      texto: textoDaMudanca(m, moeda),
    })),
    ...versao.estrutura.map((texto, k) => ({ chave: `estrutura-${k}`, nome: null as string | null, texto })),
  ];
  const visiveis = todas ? chips : chips.slice(0, 6);

  return (
    <div className="rounded-2xl border border-california-red/30 bg-card px-4 py-3 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg bg-california-red/10 p-1.5">
            <Icone className="h-4 w-4 text-california-red" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-[13px] font-semibold text-foreground">
              Versão de {formatDataAsHoraBr(versao.quando)} · {versao.rotulo}
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {versao.autor && (
                <>
                  Por <strong className="font-semibold text-foreground">{versao.autor}</strong>.{" "}
                </>
              )}
              {versao.revisao && (
                <>
                  Revisada pelo financeiro em {formatDataAsHoraBr(versao.revisao.quando)}
                  {versao.revisao.autor ? `, por ${versao.revisao.autor}` : ""}.{" "}
                </>
              )}
              {nota}
            </p>
            {versao.descricao && (
              <p className="border-l-2 border-california-red/30 pl-2.5 text-[12px] leading-relaxed text-foreground">
                {versao.descricao}
              </p>
            )}
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {visiveis.map((c) => (
                  <span
                    key={c.chave}
                    className="inline-flex max-w-[460px] items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
                  >
                    {/* O nome não encolhe: quem se corta é o texto da mudança. */}
                    {c.nome && <strong className="max-w-[200px] shrink-0 truncate font-semibold">{c.nome}</strong>}
                    <span className="truncate text-muted-foreground">{c.texto}</span>
                  </span>
                ))}
                {chips.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setTodas((v) => !v)}
                    className="text-[11px] font-semibold text-california-red hover:underline"
                  >
                    {todas ? "mostrar menos" : `+${chips.length - 6}`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Valor do job
            </span>
            <div className="flex items-baseline gap-2">
              {mudou && valorJob.antes !== null && (
                <span className="font-mono text-[11.5px] text-muted-foreground line-through">
                  {formatCurrency(valorJob.antes, moeda)}
                </span>
              )}
              <span className="font-mono text-[13px] font-bold text-foreground">
                {formatCurrency(valorJob.depois, moeda)}
              </span>
              {mudou && (
                <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
                  {comSinal(delta, moeda)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {versao.mudancas.some((m) => m.itemId) && (
              <label className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                <input
                  type="checkbox"
                  checked={destacar}
                  onChange={(e) => onDestacar(e.target.checked)}
                  className="h-3.5 w-3.5 accent-california-red"
                />
                Destacar o que mudou
              </label>
            )}
            <div className="inline-flex overflow-hidden rounded-lg border border-border bg-white">
              <button
                type="button"
                onClick={onAnterior}
                disabled={!temAnterior}
                title="Versão anterior"
                aria-label="Versão anterior"
                className="px-2 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onProxima}
                disabled={!temProxima}
                title="Próxima versão"
                aria-label="Próxima versão"
                className="border-l border-border px-2 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={onAtual}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Voltar para a atual
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- O selo da linha ---------------------------------------------------------

/** O selo da linha que o momento mudou. A cancelada já tem o selo dela. */
export function SeloDaLinha({ mudanca, moeda }: { mudanca: MudancaNaLinha; moeda: string }) {
  if (mudanca.acao === "cancelada") return null;
  const classe =
    mudanca.acao === "nova" ? ERRATA.tagNova : mudanca.acao === "movida" ? ERRATA.tagRemovida : ERRATA.tagAlterada;
  const rotulo =
    mudanca.acao === "nova"
      ? "nova"
      : mudanca.acao === "movida"
        ? "movida"
        : mudanca.acao === "save"
          ? "save"
          : "alterada";
  const dica =
    mudanca.tipoDe && mudanca.tipoPara && mudanca.tipoDe !== mudanca.tipoPara
      ? `${textoDaMudanca(mudanca, moeda)} (${tipoCustoLabel(mudanca.tipoDe)} → ${tipoCustoLabel(mudanca.tipoPara)})`
      : textoDaMudanca(mudanca, moeda);
  return (
    <span title={dica} className={cn(classe, "flex-none")}>
      {rotulo}
    </span>
  );
}
