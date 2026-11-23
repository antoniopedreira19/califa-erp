"use client";

/**
 * O planejado e o realizado do job de Mídia Off (decisão 275, entrega 5).
 *
 * Visão única (Tiago, 23/11/2026, opção A): a planilha mostra a campanha
 * como está — a linha que mudou fica laranja, com o inicial riscado; a
 * extensão é linha vermelha "Extensão". Este card guarda o planejado
 * inicial ao lado do atual (valor do job, faturamento, resultado), as duas
 * ações — encerrar a veiculação antes do fim e estender — e o registro de
 * cada mudança, com quem fez e quando.
 *
 * Regras do Tiago: o cliente paga só o que foi ao ar (encerrar antes, com o
 * negociado proporcional sugerido e editável no período, 1c); a extensão é
 * linha nova, sem planejado, e precisa de AP e PI próprios; o mês enviado
 * não muda; o motivo é opcional. Nada passa pela errata.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CalendarX2, History, Loader2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoedaInput } from "@/components/ui/moeda-input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ERRATA, PLANEJADO, REALIZADO, corDoDelta } from "@/app/(app)/_planilha/blocos";
import {
  cortarLinha,
  diaSeguinte,
  diasDoMes,
  diasEntre,
  linhaDaExtensao,
  negociadoPorDia,
  nomeDoMesMidia,
  proporcionalDoPeriodo,
  veiculaDepois,
  type FechamentoMidia,
} from "@/lib/calculos/midia-off";
import { encerrarVeiculacaoAntes, estenderVeiculacao } from "./actions-midia-realizado";

const brl = (v: number) => formatCurrency(v, "BRL");
const comSinal = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${brl(Math.abs(v))}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const isoDe = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
function diaMes(iso: string): string {
  return dataBr(iso).slice(0, 5);
}
function nomeCurto(mes: string): string {
  return nomeDoMesMidia(mes).split(" ")[0].toLowerCase();
}
function proximoMes(mes: string): string {
  const [a, m] = mes.slice(0, 7).split("-").map(Number);
  const t = a * 12 + m;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}
function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(a, m, 0, 12)).toISOString().slice(0, 10);
}

/** Uma linha da cópia do job, como o card a usa. */
export interface LinhaDoRealizado {
  id: string;
  /** "Salvador/BA · Fornecedor Teste". */
  nome: string;
  meio: string;
  /** `YYYY-MM-01`. */
  mes: string;
  tipo: string;
  extensao: boolean;
  /** A · Repasse: o que as PPs do repasse da linha já somam. */
  emPPs: number;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  total_orcado: number;
  insercoes_por_dia: Record<string, number> | null;
  data_inicio: string | null;
  data_fim: string | null;
}

/** Uma mudança no registro. */
export interface RegistroDoRealizado {
  id: string;
  tipo: "encerramento" | "extensao";
  /** O último dia no ar (encerramento) ou o mês da extensão. */
  data: string;
  detalhe: string;
  motivo: string | null;
  /** Negociado antes (null: extensão, sem planejado) e depois. */
  de: number | null;
  para: number;
  em: string;
  porNome: string | null;
}

export interface PropsDoRealizado {
  jobId: string;
  jobCodigo: string;
  linhas: LinhaDoRealizado[];
  registros: RegistroDoRealizado[];
  /** O job como foi aberto e como está. */
  inicial: FechamentoMidia;
  atual: FechamentoMidia;
  /** A conta de um conjunto de linhas, para os números de antes e depois
   *  dos pop-ups. */
  fechar: (linhas: LinhaDoRealizado[]) => FechamentoMidia;
  /** Os meses do job (`YYYY-MM-01`) e os já enviados ao faturamento. */
  meses: string[];
  mesesEnviados: string[];
  /** O último dia de veiculação da campanha, como está. */
  fimDaVeiculacao: string | null;
  hoje: string;
  /** Quem mexe no job, com ele aberto. `null`: pode; texto: o motivo. */
  travadoPor: string | null;
  podeMexer: boolean;
}

/** A linha "de → para" dos números do pop-up, como na errata. */
function DePara({ rotulo, de, para, forte }: { rotulo: string; de: number; para: number; forte?: boolean }) {
  const delta = r2(para - de);
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className={cn("text-[12.5px]", forte ? "font-semibold text-foreground" : "text-muted-foreground")}>{rotulo}</span>
      <div className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11.5px]">
        <span className="text-muted-foreground">{brl(de)}</span>
        <span className="text-muted-foreground">→</span>
        <span className={cn(forte ? "font-bold text-foreground" : "text-foreground")}>{brl(para)}</span>
        <span className={cn("w-[96px] text-right font-bold", corDoDelta(delta))}>{delta === 0 ? "" : comSinal(delta)}</span>
      </div>
    </div>
  );
}

function Numeros({ antes, depois, inicial }: { antes: FechamentoMidia; depois: FechamentoMidia; inicial: FechamentoMidia }) {
  return (
    <section className="rounded-xl border border-border px-3.5 py-2">
      <DePara rotulo="Faturamento previsto" de={antes.faturamentoPrevisto} para={depois.faturamentoPrevisto} />
      <DePara rotulo="Valor do job" de={antes.valorJob} para={depois.valorJob} />
      <div className="my-1 border-t border-border" />
      <DePara rotulo="Resultado operacional" de={antes.resultadoOperacional} para={depois.resultadoOperacional} forte />
      <p className="pb-1 text-right font-mono text-[10.5px] text-muted-foreground">
        <span className={PLANEJADO.textoSuave}>planejado inicial</span> {brl(inicial.resultadoOperacional)}
      </p>
    </section>
  );
}

const BOTAO_ACAO =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-foreground";

// ---- Encerrar a veiculação antes do fim ------------------------------------

function EncerrarAntesDialog({ p, onFechar }: { p: PropsDoRealizado; onFechar: () => void }) {
  const router = useRouter();
  const fimReal = p.fimDaVeiculacao ?? p.hoje;
  // O mês enviado não muda: as linhas dele ficam fora da lista (os meses
  // nem sempre vão em ordem — o financeiro pode ter faturado um antes).
  const enviadosTexto = p.mesesEnviados.map((m) => nomeDoMesMidia(m).split(" ")[0]);
  const inicial = p.hoje < fimReal ? p.hoje : fimReal;
  const [ultimoDia, setUltimoDia] = React.useState(inicial);
  const [motivo, setMotivo] = React.useState("");
  const [valores, setValores] = React.useState<Record<string, number>>({});
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const candidatasDe = (dia: string) =>
    p.linhas.filter((l) => !p.mesesEnviados.includes(l.mes) && veiculaDepois(l, l.mes, dia));
  const candidatas = candidatasDe(ultimoDia);
  const [marcadas, setMarcadas] = React.useState<Set<string>>(() => new Set(candidatas.map((l) => l.id)));
  const ids = candidatas.map((l) => l.id).filter((id) => marcadas.has(id));

  const depois = p.linhas.map((l) => {
    if (!ids.includes(l.id)) return l;
    const c = cortarLinha(l, l.mes, ultimoDia, valores[l.id]);
    return c ? { ...l, ...c, total_orcado: c.total } : l;
  });
  const mesDoCorte = `${ultimoDia.slice(0, 7)}-01`;

  async function confirmar() {
    setErro(null);
    setSalvando(true);
    const res = await encerrarVeiculacaoAntes(p.jobId, {
      ultimoDia,
      linhas: ids.map((id) => ({ id, valor: valores[id] ?? null })),
      motivo: motivo.trim() || null,
    });
    setSalvando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onFechar();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !salvando && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-[680px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
              <CalendarX2 className="h-4 w-4 text-california-red" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[19px]">Encerrar veiculação antes do fim</DialogTitle>
              <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                {p.jobCodigo} · O cliente paga só o que foi ao ar. O planejado inicial não muda: a diferença fica no
                realizado.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-[220px_1fr] items-end gap-3">
            <div className="space-y-1.5">
              <Label>Último dia no ar</Label>
              <DatePicker
                name="corte-dia"
                defaultValue={ultimoDia}
                mesInicial={ultimoDia}
                dateDisabled={(d) => isoDe(d) >= fimReal}
                onDateChange={(d) => {
                  if (!d) return;
                  const novo = isoDe(d);
                  setUltimoDia(novo);
                  setValores({});
                  setMarcadas(new Set(candidatasDe(novo).map((l) => l.id)));
                }}
              />
            </div>
            <p className="pb-2 text-[11.5px] leading-relaxed text-muted-foreground">
              A veiculação vai até {dataBr(fimReal)}.
              {enviadosTexto.length
                ? ` ${enviadosTexto.join(" e ")} já ${enviadosTexto.length === 1 ? "foi" : "foram"} ao faturamento e não ${enviadosTexto.length === 1 ? "muda" : "mudam"}.`
                : ""}
            </p>
          </div>

          <section className="rounded-xl border border-border">
            <h3 className="flex items-center justify-between border-b border-border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Linhas que iam ao ar depois de {diaMes(ultimoDia)}</span>
              <span className="normal-case tracking-normal">
                {ids.length} de {candidatas.length}
              </span>
            </h3>
            {candidatas.length === 0 ? (
              <p className="px-3.5 py-3 text-[12.5px] text-muted-foreground">Nenhuma linha vai ao ar depois desse dia.</p>
            ) : (
              <ul className="divide-y divide-border">
                {candidatas.map((l) => {
                  const marcada = marcadas.has(l.id);
                  const c = cortarLinha(l, l.mes, ultimoDia, valores[l.id]);
                  const novo = marcada && c ? c.total : l.total_orcado;
                  const delta = r2(novo - l.total_orcado);
                  const periodo = !l.insercoes_por_dia;
                  const prop = periodo ? proporcionalDoPeriodo(l, ultimoDia) : null;
                  return (
                    <li key={l.id} className="flex items-start gap-3 px-3.5 py-2.5">
                      <Checkbox
                        className="mt-0.5 rounded-[4px]"
                        checked={marcada}
                        onCheckedChange={(v) =>
                          setMarcadas((s) => {
                            const n = new Set(s);
                            if (v) n.add(l.id);
                            else n.delete(l.id);
                            return n;
                          })
                        }
                        aria-label={`Encerrar ${l.nome}`}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium text-foreground">{l.nome}</span>
                          <span className="flex-none text-[11px] text-muted-foreground">
                            {l.meio} · {nomeCurto(l.mes)} · {l.tipo === "AR" ? "A · Repasse" : "A · Direto"}
                          </span>
                        </div>
                        <div className={cn("text-[11.5px]", marcada ? "text-foreground" : "text-muted-foreground")}>
                          {periodo
                            ? `${diaMes(l.data_inicio!)} a ${diaMes(l.data_fim!)}${
                                marcada && prop
                                  ? ` → ${prop.dias === 0 ? "não vai ao ar" : `${diaMes(l.data_inicio!)} a ${diaMes(ultimoDia)} · ${prop.dias} de ${prop.total} dias`}`
                                  : ""
                              }`
                            : `${l.quantidade_orcada} inserções${
                                marcada && c ? ` → ${c.quantidade_orcada} ${c.quantidade_orcada === 1 ? "inserção" : "inserções"} até ${diaMes(ultimoDia)}` : ""
                              }`}
                        </div>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1">
                        {periodo && marcada && prop && prop.dias > 0 ? (
                          <div className="w-[150px]">
                            <MoedaInput
                              key={`${l.id}-${ultimoDia}`}
                              defaultValue={(valores[l.id] ?? prop.valor).toFixed(2)}
                              onCentavosChange={(v) => setValores((x) => ({ ...x, [l.id]: Number(v || "0") / 100 }))}
                              className="h-8 text-right font-mono text-[12px]"
                            />
                          </div>
                        ) : (
                          <span className="font-mono text-[12px] text-foreground">{brl(novo)}</span>
                        )}
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          hoje {brl(l.total_orcado)}
                          {delta !== 0 && <span className={cn("ml-1.5 font-bold", corDoDelta(delta))}>{comSinal(delta)}</span>}
                        </span>
                        {(() => {
                          // A PP do repasse que já passa da nota que fica:
                          // não trava, mas a PP precisa de ajuste.
                          if (!marcada || l.tipo !== "AR" || !(l.emPPs > 0)) return null;
                          const notaNova = p.fechar([{ ...l, total_orcado: novo }]).custoPlanejado;
                          return l.emPPs > notaNova + 0.005 ? (
                            <span className="max-w-[220px] text-right text-[10.5px] font-semibold leading-snug text-amber-700">
                              As PPs do repasse somam {brl(l.emPPs)}; a nota fica {brl(notaNova)}. Ajuste a PP.
                            </span>
                          ) : null;
                        })()}
                        {periodo && marcada && prop && prop.dias > 0 && (
                          <span className="text-[10.5px] text-muted-foreground">
                            {valores[l.id] !== undefined && r2(valores[l.id]) !== prop.valor
                              ? `sugerido ${brl(prop.valor)}`
                              : "proporcional aos dias, editável"}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Numeros antes={p.atual} depois={p.fechar(depois)} inicial={p.inicial} />

          <div className="space-y-1.5">
            <Label htmlFor="corte-motivo">Motivo (opcional)</Label>
            <Textarea
              id="corte-motivo"
              rows={2}
              maxLength={500}
              value={motivo}
              onChange={(ev) => setMotivo(ev.target.value)}
              placeholder="Ex.: o cliente encerrou a campanha antes"
            />
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
            <History className="mt-0.5 h-4 w-4 flex-none text-california-red" />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Fica registrado no job, com quem fez e quando. A NF do veículo de {nomeCurto(mesDoCorte)} deve vir pelo valor
              que ficou, e {nomeCurto(mesDoCorte)} pode ir ao faturamento a partir de{" "}
              <strong className="text-foreground">{dataBr(diaSeguinte(ultimoDia))}</strong>.
            </p>
          </div>
          {erro && (
            <p className="rounded-lg border border-california-red/25 bg-california-red/5 px-3 py-2 text-[12px] text-california-red">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={salvando} onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" disabled={ids.length === 0 || salvando} onClick={() => void confirmar()}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Encerrar veiculação em {diaMes(ultimoDia)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Estender a veiculação --------------------------------------------------

function EstenderDialog({ p, onFechar }: { p: PropsDoRealizado; onFechar: () => void }) {
  const router = useRouter();
  const bases = p.linhas;
  const [baseId, setBaseId] = React.useState<string | null>(null);
  const base = baseId ? (p.linhas.find((l) => l.id === baseId) ?? null) : null;
  const grade = !!base?.insercoes_por_dia;
  const depoisDoFim = base?.data_fim ? diaSeguinte(base.data_fim) : null;
  const opcoesMes = base
    ? [base.mes, proximoMes(base.mes), proximoMes(proximoMes(base.mes))].filter((m) => !p.mesesEnviados.includes(m))
    : [];
  const [mes, setMes] = React.useState<string | null>(null);
  const mesSugerido =
    depoisDoFim && opcoesMes.includes(`${depoisDoFim.slice(0, 7)}-01`)
      ? `${depoisDoFim.slice(0, 7)}-01`
      : (opcoesMes[0] ?? null);
  const mesEfetivo = mes && opcoesMes.includes(mes) ? mes : mesSugerido;

  const [dias, setDias] = React.useState<Set<number>>(new Set());
  const [porDia, setPorDia] = React.useState("1");
  const [periodo, setPeriodo] = React.useState<{ ini: string | null; fim: string | null }>({ ini: null, fim: null });
  const [valor, setValor] = React.useState<number | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const sugestao = () => {
    if (!base || !mesEfetivo) return { ini: null as string | null, fim: null as string | null };
    const ini = depoisDoFim && depoisDoFim.slice(0, 7) === mesEfetivo.slice(0, 7) ? depoisDoFim : mesEfetivo;
    const fim = new Date(Date.parse(`${ini}T12:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
    return { ini, fim };
  };
  const n = Math.max(0, Math.round(Number(porDia) || 0));
  const ini = periodo.ini ?? sugestao().ini;
  const fim = periodo.fim ?? sugestao().fim;
  const diasPeriodo = ini && fim && fim >= ini ? diasEntre(ini, fim) : 0;
  const sugerido = base && !grade && diasPeriodo > 0 ? r2(negociadoPorDia(base) * diasPeriodo) : 0;
  const nova =
    base && mesEfetivo
      ? grade
        ? linhaDaExtensao(base, { forma: "grade", dias: Object.fromEntries([...dias].map((d) => [String(d), n])) })
        : diasPeriodo > 0
          ? linhaDaExtensao(base, { forma: "periodo", inicio: ini!, fim: fim!, valor: valor ?? sugerido })
          : null
      : null;
  const pode = !!nova && nova.total > 0 && !salvando;
  const mesNovo = mesEfetivo ? !p.meses.includes(mesEfetivo) : false;

  const depois =
    nova && base && mesEfetivo
      ? [...p.linhas, { ...base, ...nova, id: "previa", mes: mesEfetivo, extensao: true, total_orcado: nova.total }]
      : p.linhas;

  async function confirmar() {
    if (!base || !mesEfetivo) return;
    setErro(null);
    setSalvando(true);
    const res = await estenderVeiculacao(p.jobId, {
      baseId: base.id,
      mes: mesEfetivo,
      dias: grade ? Object.fromEntries([...dias].map((d) => [String(d), n])) : null,
      inicio: grade ? null : ini,
      fim: grade ? null : fim,
      valor: grade ? null : (valor ?? sugerido),
      motivo: motivo.trim() || null,
    });
    setSalvando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onFechar();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !salvando && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-[680px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
              <CalendarPlus className="h-4 w-4 text-california-red" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[19px]">Estender veiculação</DialogTitle>
              <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                {p.jobCodigo} · O cliente pediu mais veiculação com o job aberto. A extensão entra como linha nova, sem
                planejado — o ganho aparece no resultado.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-[1fr_220px] gap-3">
            <div className="space-y-1.5">
              <Label>Linha que se estende</Label>
              <Combobox
                items={bases.map((l) => ({
                  value: l.id,
                  label: l.nome,
                  descricao: `${l.meio} · ${nomeCurto(l.mes)} · ${l.tipo === "AR" ? "A · Repasse" : "A · Direto"}`,
                }))}
                value={baseId}
                onChange={(v) => {
                  setBaseId(v);
                  setMes(null);
                  setDias(new Set());
                  setPeriodo({ ini: null, fim: null });
                  setValor(null);
                  const b = p.linhas.find((l) => l.id === v);
                  const maxDia = b?.insercoes_por_dia ? Math.max(1, ...Object.values(b.insercoes_por_dia).map(Number)) : 1;
                  setPorDia(String(maxDia));
                }}
                placeholder="Escolher a linha"
                buscaPlaceholder="Buscar linha..."
                className={COMBOBOX_COMO_SELECT}
                larguraLista="w-[400px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mês da extensão</Label>
              <Select
                value={mesEfetivo ?? undefined}
                onValueChange={(v) => {
                  setMes(v);
                  setDias(new Set());
                  setPeriodo({ ini: null, fim: null });
                  setValor(null);
                }}
                disabled={!base}
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Escolha a linha" />
                </SelectTrigger>
                <SelectContent>
                  {opcoesMes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {nomeDoMesMidia(m)}
                      {!p.meses.includes(m) ? " · mês novo" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {base && mesEfetivo && grade && (
            <section className="space-y-2 rounded-xl border border-border px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">Dias da extensão em {nomeCurto(mesEfetivo)}</span>
                <span className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  Inserções em cada dia marcado
                  <Input
                    value={porDia}
                    onChange={(ev) => setPorDia(ev.target.value.replace(/\D/g, ""))}
                    className="h-8 w-14 text-center font-mono"
                    inputMode="numeric"
                  />
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {diasDoMes(mesEfetivo).map((d) => {
                  const marcado = dias.has(d.dia);
                  const doPlano = base.mes === mesEfetivo ? Number(base.insercoes_por_dia?.[String(d.dia)] ?? 0) : 0;
                  return (
                    <button
                      key={d.dia}
                      type="button"
                      onClick={() =>
                        setDias((s) => {
                          const x = new Set(s);
                          if (x.has(d.dia)) x.delete(d.dia);
                          else x.add(d.dia);
                          return x;
                        })
                      }
                      title={doPlano ? `Dia ${d.dia}: ${doPlano} no plano` : `Dia ${d.dia}`}
                      className={cn(
                        "flex h-10 w-9 flex-col items-center justify-center rounded-md border text-[10px] leading-none transition-colors",
                        marcado
                          ? "border-[#ea580c] bg-[#fff7ed] font-bold text-[#c2410c]"
                          : d.fimDeSemana
                            ? "border-border bg-[#f6f5f2] text-muted-foreground hover:border-[#f9c296]"
                            : "border-border bg-white text-foreground/80 hover:border-[#f9c296]",
                      )}
                    >
                      <span className="font-mono">{d.dia}</span>
                      <span className="mt-1 text-[8.5px] font-semibold">{marcado ? `+${n}` : doPlano ? `${doPlano}` : d.inicial}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                {nova && nova.total > 0 ? (
                  <>
                    {nova.quantidade_orcada} {nova.quantidade_orcada === 1 ? "inserção" : "inserções"} ×{" "}
                    {brl(base.valor_unitario_orcado)} = <strong className="font-mono text-foreground">{brl(nova.total)}</strong>{" "}
                    negociados, no mesmo unitário da linha.
                  </>
                ) : (
                  "Marque os dias. O número embaixo do dia é o que já está no plano."
                )}
              </p>
            </section>
          )}

          {base && mesEfetivo && !grade && (
            <section className="grid grid-cols-3 items-end gap-3 rounded-xl border border-border px-3.5 py-3">
              <div className="space-y-1.5">
                <Label>Início</Label>
                <DatePicker
                  key={`ini-${mesEfetivo}-${baseId}`}
                  name="ext-inicio"
                  defaultValue={ini ?? undefined}
                  mesInicial={ini ?? undefined}
                  // A linha mora no mês em que começa (147, p17).
                  dateDisabled={(d) => isoDe(d).slice(0, 7) !== mesEfetivo.slice(0, 7)}
                  onDateChange={(d) => {
                    setPeriodo((x) => ({ ...x, ini: d ? isoDe(d) : null }));
                    setValor(null);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fim</Label>
                <DatePicker
                  key={`fim-${mesEfetivo}-${baseId}`}
                  name="ext-fim"
                  defaultValue={fim ?? undefined}
                  mesInicial={fim ?? undefined}
                  dateDisabled={ini ? (d) => isoDe(d) < ini : undefined}
                  onDateChange={(d) => {
                    setPeriodo((x) => ({ ...x, fim: d ? isoDe(d) : null }));
                    setValor(null);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Negociado</Label>
                <MoedaInput
                  key={`v-${ini}-${fim}-${baseId}`}
                  defaultValue={sugerido.toFixed(2)}
                  onCentavosChange={(v) => setValor(Number(v || "0") / 100)}
                  className="font-mono"
                />
              </div>
              <p className="col-span-3 text-[11.5px] text-muted-foreground">
                {diasPeriodo > 0
                  ? `${diasPeriodo} dias. Sugerido: ${brl(sugerido)}, o negociado da linha por dia (${brl(r2(negociadoPorDia(base)))}) × ${diasPeriodo}. Editável: vale o que o veículo cobrar.`
                  : "Escolha início e fim."}
              </p>
            </section>
          )}

          {nova && nova.total > 0 && <Numeros antes={p.atual} depois={p.fechar(depois)} inicial={p.inicial} />}

          <div className="space-y-1.5">
            <Label htmlFor="ext-motivo">Motivo (opcional)</Label>
            <Textarea
              id="ext-motivo"
              rows={2}
              maxLength={500}
              value={motivo}
              onChange={(ev) => setMotivo(ev.target.value)}
              placeholder="Ex.: o cliente pediu mais 15 dias de outdoor"
            />
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
            <History className="mt-0.5 h-4 w-4 flex-none text-california-red" />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Como toda veiculação, a extensão precisa de <strong className="text-foreground">AP e PI</strong> do veículo
              anexados depois dela: sem eles, o mês não vai ao faturamento.
              {base?.tipo === "AR" ? " Por ser A · Repasse, ela também pede a PP do repasse." : ""}
              {mesNovo && mesEfetivo ? ` ${nomeDoMesMidia(mesEfetivo).split(" ")[0]} entra no job, com faturamento próprio.` : ""}
            </p>
          </div>
          {erro && (
            <p className="rounded-lg border border-california-red/25 bg-california-red/5 px-3 py-2 text-[12px] text-california-red">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={salvando} onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" disabled={!pode} onClick={() => void confirmar()}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Estender veiculação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- O card -------------------------------------------------------------------

export function RealizadoDaMidia(p: PropsDoRealizado) {
  const [aberto, setAberto] = React.useState<"encerrar" | "estender" | null>(null);
  // Há o que encerrar: alguma linha de mês ainda não enviado vai ao ar
  // depois de algum dia antes do fim da campanha.
  const podeEncerrar =
    p.podeMexer &&
    !p.travadoPor &&
    !!p.fimDaVeiculacao &&
    p.linhas.some((l) => !p.mesesEnviados.includes(l.mes) && l.total_orcado > 0);
  const motivoEncerrar =
    p.travadoPor ?? (podeEncerrar ? undefined : "Todas as linhas estão em meses que já foram ao faturamento.");

  const par = (rotulo: string, de: number, para: number) => {
    const d = r2(para - de);
    return (
      <span className="whitespace-nowrap">
        {rotulo} <span className={cn("font-mono", PLANEJADO.textoSuave)}>{brl(de)}</span>
        {d !== 0 && (
          <>
            {" "}
            → <span className={cn("font-mono font-semibold", REALIZADO.texto)}>{brl(para)}</span>{" "}
            <span className={cn("font-mono font-bold", corDoDelta(d))}>{comSinal(d)}</span>
          </>
        )}
      </span>
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[13px] font-bold tracking-[-0.01em] text-foreground">
            Planejado e realizado
            <span className="ml-2 text-[11.5px] font-normal text-muted-foreground">
              {p.registros.length === 0
                ? "A campanha segue como foi aprovada."
                : "A planilha mostra a campanha como está. O planejado inicial fica aqui e no registro."}
            </span>
          </p>
          <p className="flex flex-wrap gap-x-5 gap-y-0.5 text-[11.5px] text-muted-foreground">
            {par("Valor do job", p.inicial.valorJob, p.atual.valorJob)}
            {par("Faturamento", p.inicial.faturamentoPrevisto, p.atual.faturamentoPrevisto)}
            {par("Resultado", p.inicial.resultadoOperacional, p.atual.resultadoOperacional)}
          </p>
        </div>
        {p.podeMexer && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={BOTAO_ACAO}
              disabled={!podeEncerrar}
              title={motivoEncerrar}
              onClick={() => setAberto("encerrar")}
            >
              <CalendarX2 className="h-3.5 w-3.5" />
              Encerrar veiculação antes
            </button>
            <button
              type="button"
              className={BOTAO_ACAO}
              disabled={!!p.travadoPor}
              title={p.travadoPor ?? undefined}
              onClick={() => setAberto("estender")}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Estender veiculação
            </button>
          </div>
        )}
      </div>

      {p.registros.length > 0 && (
        <div className="border-t border-border px-4 py-2.5">
          <p className="pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Registro · planejado → realizado
          </p>
          <ul className="divide-y divide-border">
            {p.registros.map((r) => {
              const Icone = r.tipo === "extensao" ? CalendarPlus : CalendarX2;
              const delta = r2(r.para - (r.de ?? 0));
              return (
                <li key={r.id} className="flex items-start gap-3 py-2">
                  <Icone className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-foreground">
                      {r.tipo === "extensao"
                        ? `Veiculação estendida · ${nomeDoMesMidia(r.data)}`
                        : `Veiculação encerrada antes · último dia no ar ${dataBr(r.data)}`}
                    </p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {r.detalhe}
                      {r.motivo ? ` · “${r.motivo}”` : ""}
                    </p>
                  </div>
                  <div className="flex flex-none flex-col items-end">
                    <span className="whitespace-nowrap font-mono text-[11.5px]">
                      <span className={PLANEJADO.textoSuave}>{r.de === null ? "sem planejado" : brl(r.de)}</span>
                      <span className="text-muted-foreground"> → </span>
                      <span className={cn("font-semibold", REALIZADO.texto)}>{brl(r.para)}</span>
                      <span className={cn("ml-1.5 font-bold", corDoDelta(delta))}>{comSinal(delta)}</span>
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">
                      {r.porNome ?? "—"} · {dataBr(r.em)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="pt-1 text-[10.5px] text-muted-foreground">
            Valores no negociado. <span className={ERRATA.tagVermelha}>Extensão</span> é linha sem planejado, só com
            realizado.
          </p>
        </div>
      )}

      {aberto === "encerrar" && <EncerrarAntesDialog p={p} onFechar={() => setAberto(null)} />}
      {aberto === "estender" && <EstenderDialog p={p} onFechar={() => setAberto(null)} />}
    </div>
  );
}
