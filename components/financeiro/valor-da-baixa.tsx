"use client";

/**
 * O bloco de valores da baixa (decisão 125) — o mesmo nas duas pontas,
 * Títulos a Receber e Títulos a Pagar, como no protótipo aprovado em
 * 28/09/2026 (versão 4, "A simplificada").
 *
 * - **Valor a dar baixa**: um valor só. Vem travado no que falta do
 *   título; a chave "Baixa parcial" libera a edição, e o restante continua
 *   em aberto. Nunca passa do que falta (D13: o que entrou a mais vira
 *   recebimento avulso).
 * - **Impostos retidos**: a chave abre ISS, PIS, COFINS, CSLL e IRRF, cada
 *   um por alíquota OU por valor (um calcula o outro), sobre o valor a dar
 *   baixa. Termina em "valor total − impostos retidos = valor líquido" — o
 *   líquido é o que entra ou sai da conta e vai para o extrato.
 *
 * As alíquotas começam em branco; o "Repetir as alíquotas" traz as da
 * última baixa com retenção do mesmo cliente ou fornecedor (D6 2a).
 *
 * Módulo fiscal (02/10/2026): na parcela de PP aprovada com retenção, as
 * alíquotas começam nas da APROVAÇÃO (`daAprovacao`), com a chave ligada e
 * tudo editável. Elas podem chegar depois de o formulário abrir — a baixa
 * as busca no servidor —, e entram quando chegam.
 *
 * O estado mora em `useValorDaBaixa`, e o componente que o usa deve ser
 * montado com `key` do título: trocar de título recomeça do zero.
 */

import * as React from "react";
import { Info } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { MoneyInput } from "@/components/ui/money-input";
import {
  IMPOSTOS_RETIDOS,
  type ImpostoRetido,
  type RetencaoDaBaixa,
} from "@/lib/types";
import type { RetencaoDaAprovacao } from "@/lib/fiscal/retencao-da-aprovacao";

export type LadoDaBaixa = "receber" | "pagar";

/** A última retenção do mesmo cliente ou fornecedor, para o "Repetir". */
export interface UltimaRetencao {
  /** "NF 1229", "PP-00083", "AV-00012". */
  referencia: string;
  data: string;
  aliquotas: Partial<Record<ImpostoRetido, number>>;
}

const TEXTOS: Record<
  LadoDaBaixa,
  {
    falta: string;
    parcialAjuda: string;
    retem: string;
    liquido: string;
    restoEmAberto: string;
  }
> = {
  receber: {
    falta: "Falta receber",
    parcialAjuda: "O restante continua em aberto.",
    retem: "O cliente reteve impostos na fonte",
    liquido: "(=) Valor líquido recebido",
    restoEmAberto: "em aberto",
  },
  pagar: {
    falta: "Falta pagar",
    parcialAjuda: "O restante continua a pagar.",
    retem: "Reter impostos na fonte",
    liquido: "(=) Valor líquido pago ao fornecedor",
    restoEmAberto: "a pagar",
  },
};

type PorImposto<T> = Record<ImpostoRetido, T>;

const SEM_ALIQUOTA: PorImposto<number | null> = {
  ISS: null,
  PIS: null,
  COFINS: null,
  CSLL: null,
  IRRF: null,
};
const SEM_VALOR: PorImposto<number> = { ISS: 0, PIS: 0, COFINS: 0, CSLL: 0, IRRF: 0 };

/** Arredonda para centavos: 0,1 + 0,2 não pode virar 0,30000000004. */
export function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function valorDaAliquota(base: number, aliquota: number | null): number {
  return aliquota ? arredondar((base * aliquota) / 100) : 0;
}

function formatarPercentual(n: number): string {
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** Módulo fiscal: o ponto de partida das retenções — em branco, ou as
 *  alíquotas da aprovação da PP, já calculadas sobre a base. */
function retencaoInicial(base: number, daAprovacao: RetencaoDaAprovacao | null) {
  const aliquotas = { ...SEM_ALIQUOTA };
  const valores = { ...SEM_VALOR };
  let alguma = false;
  for (const { imposto } of IMPOSTOS_RETIDOS) {
    const a = daAprovacao?.aliquotas[imposto];
    if (typeof a === "number" && a > 0) {
      aliquotas[imposto] = a;
      valores[imposto] = valorDaAliquota(base, a);
      alguma = true;
    }
  }
  return { retem: alguma, aliquotas, valores };
}

export function useValorDaBaixa(
  aberto: number,
  ultima: UltimaRetencao | null,
  /** Módulo fiscal: as alíquotas da aprovação da PP. `null` (o padrão)
   *  começa em branco, como sempre. */
  daAprovacao: RetencaoDaAprovacao | null = null,
) {
  const [parcial, setParcialBruto] = React.useState(false);
  const [editado, setEditado] = React.useState(aberto);
  const [partida] = React.useState(() => retencaoInicial(aberto, daAprovacao));
  const [retem, setRetemBruto] = React.useState(partida.retem);
  const [aliquotas, setAliquotas] = React.useState(partida.aliquotas);
  const [valores, setValores] = React.useState(partida.valores);

  const valor = parcial ? editado : aberto;

  // Módulo fiscal: as alíquotas da aprovação que chegam depois de o
  // formulário abrir ligam a chave, uma vez. Enquanto elas não chegam, a
  // baixa deixa a chave travada ("Buscando…"): não há o que atropelar.
  // Compara pelo conteúdo: um objeto igual remontado a cada renderização
  // não pode passar por cima do que a pessoa editou.
  const conteudoDaAprovacao = daAprovacao ? JSON.stringify(daAprovacao) : null;
  const aprovacaoAplicada = React.useRef(conteudoDaAprovacao);
  React.useEffect(() => {
    if (!daAprovacao || aprovacaoAplicada.current === conteudoDaAprovacao) return;
    aprovacaoAplicada.current = conteudoDaAprovacao;
    const p = retencaoInicial(valor, daAprovacao);
    if (!p.retem) return;
    setRetemBruto(true);
    setAliquotas(p.aliquotas);
    setValores(p.valores);
    // Só a chegada decide; a base é o valor a dar baixa de agora.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conteudoDaAprovacao]);

  // A base dos impostos é o valor a dar baixa: mudou o valor, o imposto
  // informado por alíquota acompanha.
  const valorAnterior = React.useRef(valor);
  React.useEffect(() => {
    if (valorAnterior.current === valor) return;
    valorAnterior.current = valor;
    setValores((atuais) => {
      const novos = { ...atuais };
      for (const { imposto } of IMPOSTOS_RETIDOS) {
        if (aliquotas[imposto] !== null) {
          novos[imposto] = valorDaAliquota(valor, aliquotas[imposto]);
        }
      }
      return novos;
    });
  }, [valor, aliquotas]);

  const retido = retem
    ? arredondar(IMPOSTOS_RETIDOS.reduce((s, { imposto }) => s + valores[imposto], 0))
    : 0;
  const liquido = arredondar(valor - retido);
  const resta = arredondar(aberto - valor);

  return {
    aberto,
    parcial,
    valor,
    retem,
    aliquotas,
    valores,
    retido,
    liquido,
    resta,
    ultima,
    setParcial(x: boolean) {
      setParcialBruto(x);
      if (!x) setEditado(aberto);
    },
    setValor(x: number) {
      setEditado(arredondar(x));
    },
    setRetem(x: boolean) {
      setRetemBruto(x);
      if (!x) {
        setAliquotas(SEM_ALIQUOTA);
        setValores(SEM_VALOR);
      } else if (daAprovacao) {
        // Módulo fiscal: religar a chave traz de volta as alíquotas da
        // aprovação da PP, e não a tabela em branco.
        const p = retencaoInicial(valor, daAprovacao);
        setAliquotas(p.aliquotas);
        setValores(p.valores);
      }
    },
    porAliquota(imposto: ImpostoRetido, aliquota: number | null) {
      setAliquotas((a) => ({ ...a, [imposto]: aliquota }));
      setValores((v) => ({ ...v, [imposto]: valorDaAliquota(valor, aliquota) }));
    },
    porValor(imposto: ImpostoRetido, reais: number) {
      const r = arredondar(reais);
      setValores((v) => ({ ...v, [imposto]: r }));
      setAliquotas((a) => ({
        ...a,
        [imposto]: valor > 0 && r > 0 ? Math.round((r / valor) * 10000) / 100 : null,
      }));
    },
    repetir() {
      if (!ultima) return;
      const novas = { ...SEM_ALIQUOTA };
      const novos = { ...SEM_VALOR };
      for (const { imposto } of IMPOSTOS_RETIDOS) {
        const a = ultima.aliquotas[imposto];
        if (typeof a === "number" && a > 0) {
          novas[imposto] = a;
          novos[imposto] = valorDaAliquota(valor, a);
        }
      }
      setAliquotas(novas);
      setValores(novos);
    },
    /** O que vai para o servidor: só os impostos com valor. */
    retencoes(): RetencaoDaBaixa[] {
      if (!retem) return [];
      return IMPOSTOS_RETIDOS.filter(({ imposto }) => valores[imposto] > 0).map(
        ({ imposto }) => ({
          imposto,
          aliquota: aliquotas[imposto],
          valor: valores[imposto],
        }),
      );
    },
    erro(): string | null {
      if (!valor || valor <= 0) return "Informe o valor a dar baixa.";
      if (valor > aberto + 0.004) {
        return `O valor a dar baixa passa do que falta (${formatCurrency(aberto, "BRL")}).`;
      }
      if (retem && retido <= 0) {
        return "Informe ao menos um imposto retido, ou desligue a retenção.";
      }
      if (retem && retido >= valor) {
        return "Os impostos retidos não podem ser maiores que o valor a dar baixa.";
      }
      return null;
    },
  };
}

export type EstadoDoValorDaBaixa = ReturnType<typeof useValorDaBaixa>;

/**
 * Percentual pt-BR controlado ("0,65"). O texto é do campo enquanto se
 * digita; ele só se reescreve quando o número muda por fora (o "Repetir",
 * ou o valor informado à mão recalculando a alíquota).
 */
function PercentualInput({
  valor,
  onChange,
  rotulo,
}: {
  valor: number | null;
  onChange: (x: number | null) => void;
  rotulo: string;
}) {
  const paraTexto = (n: number | null) =>
    n === null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  const [texto, setTexto] = React.useState(paraTexto(valor));

  React.useEffect(() => {
    // "0," a meio caminho de "0,65" vale nulo, como o `onChange` mandou:
    // não pode reescrever o que a pessoa ainda está digitando.
    const n = Number(texto.replace(",", "."));
    const digitado = texto.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
    if (digitado !== valor) {
      setTexto(paraTexto(valor));
    }
    // Só o número de fora reescreve o texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={rotulo}
        value={texto}
        placeholder="0,00"
        onChange={(e) => {
          const limpo = e.target.value.replace(/[^\d,]/g, "");
          setTexto(limpo);
          if (limpo.trim() === "") {
            onChange(null);
            return;
          }
          const n = Number(limpo.replace(",", "."));
          if (Number.isFinite(n)) onChange(n > 0 ? n : null);
        }}
        className="flex h-9 w-full rounded-lg border border-border bg-white py-1.5 pl-3 pr-7 text-right font-mono text-sm tabular-nums transition-colors placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:border-california-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/15"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        %
      </span>
    </div>
  );
}

function Chave({
  id,
  ligada,
  onChange,
  rotulo,
  desligada,
}: {
  id: string;
  ligada: boolean;
  onChange: (x: boolean) => void;
  rotulo: string;
  desligada: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      disabled={desligada}
      onClick={() => onChange(!ligada)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed",
        ligada ? "bg-california-red" : "bg-muted-foreground/30",
        desligada && "bg-[#e5e5e5]",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          ligada ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

function LinhaChave({
  id,
  ligada,
  onChange,
  rotulo,
  ajuda,
  desligada = false,
  direita,
}: {
  id: string;
  ligada: boolean;
  onChange: (x: boolean) => void;
  rotulo: string;
  ajuda?: string | null;
  desligada?: boolean;
  direita?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-border px-4 py-2.5",
        desligada && "opacity-60",
      )}
    >
      <Chave id={id} ligada={ligada} onChange={onChange} rotulo={rotulo} desligada={desligada} />
      <label htmlFor={id} className={cn("flex-1 text-[13px]", !desligada && "cursor-pointer")}>
        <span className="font-semibold">{rotulo}</span>
        {ajuda && <span className="ml-2 text-[11.5px] text-muted-foreground">{ajuda}</span>}
      </label>
      {direita}
    </div>
  );
}

function formatarDataCurta(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/**
 * O bloco em si. `parcial` e `retencao` dizem se a chave aparece e, quando
 * aparece desligada, por quê (o motivo vai no lugar da ajuda).
 */
export function BlocoValorDaBaixa({
  v,
  lado,
  valorDoTitulo,
  parcelaRotulo,
  restoTexto,
  parcial,
  retencao,
  ajudaDaRetencao = null,
}: {
  v: EstadoDoValorDaBaixa;
  lado: LadoDaBaixa;
  valorDoTitulo: number;
  /** "Parcela 1/2", mostrado enquanto o título não tem baixa. */
  parcelaRotulo: string;
  /** O fim da frase do restante: ", com a previsão de 10/10, que dá para
   *  repactuar pelo lápis." — `null` fecha a frase no ponto. */
  restoTexto: string | null;
  parcial: { aceita: true } | { aceita: false; motivo: string };
  retencao: { mostra: false } | { mostra: true; motivo: string | null };
  /** Módulo fiscal: a ajuda ao lado da chave de retenção quando ela está
   *  liberada ("Retenções informadas na aprovação da PP (20/10/2026) ·
   *  editáveis"). Com a chave travada, vale o motivo. */
  ajudaDaRetencao?: string | null;
}) {
  const t = TEXTOS[lado];
  const jaBaixado = arredondar(valorDoTitulo - v.aberto);
  const retencaoLiberada = retencao.mostra && retencao.motivo === null;

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-xs font-semibold">
            Valor a dar baixa <span className="text-california-red">*</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            {jaBaixado > 0.004
              ? `${t.falta} ${formatCurrency(v.aberto, "BRL")} de ${formatCurrency(valorDoTitulo, "BRL")}`
              : parcelaRotulo}
          </p>
        </div>
        {v.parcial ? (
          <div className="w-[200px]">
            <MoneyInput
              value={v.valor}
              onValueChange={v.setValor}
              aria-label="Valor a dar baixa"
              className="h-10 text-right"
            />
          </div>
        ) : (
          <span className="font-mono text-lg font-bold">{formatCurrency(v.valor, "BRL")}</span>
        )}
      </div>

      <LinhaChave
        id={`baixa-parcial-${lado}`}
        ligada={v.parcial}
        onChange={v.setParcial}
        rotulo="Baixa parcial"
        ajuda={parcial.aceita ? t.parcialAjuda : parcial.motivo}
        desligada={!parcial.aceita}
      />
      {v.parcial && v.resta > 0.004 && (
        <div className="flex items-start gap-2 border-t border-sky-200 bg-sky-50 px-4 py-2.5 text-[12.5px] text-sky-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Restam <b className="font-mono">{formatCurrency(v.resta, "BRL")}</b> {t.restoEmAberto}
            {restoTexto ?? "."}
          </span>
        </div>
      )}

      {retencao.mostra && (
        <LinhaChave
          id={`baixa-retem-${lado}`}
          ligada={v.retem}
          onChange={v.setRetem}
          rotulo={t.retem}
          ajuda={retencao.motivo ?? ajudaDaRetencao}
          desligada={!retencaoLiberada}
          direita={
            v.retem && v.ultima ? (
              <button
                type="button"
                onClick={v.repetir}
                className="rounded-md border border-border bg-white px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
              >
                Repetir as alíquotas da {v.ultima.referencia} ({formatarDataCurta(v.ultima.data)})
              </button>
            ) : null
          }
        />
      )}

      {retencaoLiberada && v.retem && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          <div className="grid grid-cols-[1fr_110px_170px] gap-3 border-b border-border pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Imposto</span>
            <span className="text-right">Alíquota</span>
            <span className="text-right">Valor retido</span>
          </div>
          {IMPOSTOS_RETIDOS.map(({ imposto, dica, nota }) => (
            <div key={imposto} className="grid grid-cols-[1fr_110px_170px] items-center gap-3">
              <span className="text-[13px]" title={dica}>
                <b className="font-semibold">{imposto}</b>
                {nota && <span className="text-[11px] text-muted-foreground"> · {nota}</span>}
              </span>
              <PercentualInput
                valor={v.aliquotas[imposto]}
                onChange={(x) => v.porAliquota(imposto, x)}
                rotulo={`Alíquota de ${imposto}`}
              />
              <MoneyInput
                value={v.valores[imposto]}
                onValueChange={(x) => v.porValor(imposto, x)}
                aria-label={`Valor retido de ${imposto}`}
                className="h-9 text-right"
              />
            </div>
          ))}
          <div className="grid grid-cols-[1fr_auto] gap-y-1 border-t border-border pt-2.5 text-[13px]">
            <span className="text-muted-foreground">Valor total</span>
            <span className="text-right font-mono">{formatCurrency(v.valor, "BRL")}</span>
            <span className="text-muted-foreground">
              (−) Impostos retidos{" "}
              <span className="text-[11px]">
                ({v.valor > 0 ? formatarPercentual(Math.round((v.retido / v.valor) * 10000) / 100) : "0%"})
              </span>
            </span>
            <span className="text-right font-mono text-california-red">
              − {formatCurrency(v.retido, "BRL")}
            </span>
            <span className="font-semibold">{t.liquido}</span>
            <span className="text-right font-mono text-[15px] font-bold">
              {formatCurrency(v.liquido, "BRL")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
