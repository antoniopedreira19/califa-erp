"use client";

/**
 * Financeiro › Mútuos entre empresas (decisão 230). Quem deve a quem, os mútuos
 * de cada par, a situação das pernas no banco e as saídas: devolver, corrigir,
 * cancelar a baixa, dar baixa e excluir. A devolução é um mútuo no sentido
 * contrário, com um saldo por par.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AlertCircle, ArrowRight, Banknote, Building2, CheckCheck, Circle, Handshake, Pencil, Percent, Plus, Trash2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { DatePicker } from "@/components/ui/date-picker";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import {
  ehParteDeFora,
  iofDoPar,
  jurosDaAbertura,
  jurosDoMutuo,
  nomeDaParte,
  parDeFora,
  parteDeFora,
  parteDoLado,
  quemDeve,
  saldosDosPares,
  umaPernaSo,
  type DadosDoMutuo,
  type MutuoDaLista,
  type SaldoDoPar,
} from "@/lib/financeiro/mutuo";
import { cancelarBaixa } from "@/app/(app)/financeiro/actions-baixa-registrada";
import { darBaixaTransferencia, excluirTituloReceberAvulso } from "@/app/(app)/financeiro/contas-a-receber/actions-recebimento-avulso";
import { definirJurosDaAbertura } from "./actions";
import { MutuoForm, type AlvoDoForm } from "./mutuo-form";

const brl = (v: number) => formatCurrency(v, "BRL");
const diaBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const ICONE = "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

function Icone({ dica, onClick, children, vermelho }: { dica: string; onClick: () => void; children: React.ReactNode; vermelho?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={dica} onClick={onClick} className={cn(ICONE, vermelho && "text-california-red hover:bg-california-red/10 hover:text-california-red")}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{dica}</TooltipContent>
    </Tooltip>
  );
}

function SeloPerna({ ok, rotulo }: { ok: boolean; rotulo: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-semibold", ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-white text-muted-foreground")}>
      {ok ? <CheckCheck className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}
      {rotulo}
    </span>
  );
}

/** A coluna "No banco": uma selo por perna. */
function Pernas({ m }: { m: MutuoDaLista }) {
  if (m.status === "a_transferir") return <span className="text-xs text-muted-foreground">A transferir</span>;
  return (
    <span className="flex items-center gap-1">
      {m.pernas
        .slice()
        .sort((x) => (x.lado === "saida" ? -1 : 1))
        .map((p) => (
          <SeloPerna key={p.lado} ok={p.conciliada} rotulo={p.lado === "saida" ? "Saída" : "Entrada"} />
        ))}
    </span>
  );
}

function textoDoPar(n: number, abertura: boolean): string {
  const mov = n === 1 ? "1 movimento" : `${n} movimentos`;
  if (!abertura) return mov;
  return n === 0 ? "Saldo da planilha" : `${mov} e o saldo da planilha`;
}

/** A empresa de fora: quanto deve, a quem, quando volta e o IOF pago. */
function BlocoDeFora({ d, pares }: { d: DadosDoMutuo; pares: SaldoDoPar[] }) {
  const fora = pares[0].a;
  const total = Math.round(pares.reduce((s, p) => s + p.saldo, 0) * 100) / 100;
  const previstos = d.mutuos.filter((m) => m.status === "a_transferir" && m.fornecedorId && !m.origemId && parteDeFora(m.fornecedorId) === fora);
  const datas = [...new Set(previstos.map((m) => m.data))].sort();
  const iof = Math.round(pares.reduce((s, p) => s + iofDoPar(d, p.a, p.b), 0) * 100) / 100;
  const nome = nomeDaParte(d, fora);
  const Item = ({ rotulo, valor, nota, destaque }: { rotulo: string; valor: string; nota?: string; destaque?: boolean }) => (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 truncate font-mono font-semibold", destaque ? "text-lg" : "text-base")}>{valor}</p>
      {nota && <p className="mt-1 text-[11px] text-muted-foreground">{nota}</p>}
    </div>
  );
  const jurosDoPar = (p: SaldoDoPar) => {
    const ab = d.aberturas.find((x) => x.id === p.aberturaId);
    return ab ? jurosDaAbertura(ab, d.hoje) : 0;
  };
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{nome}</h2>
        <span className="text-xs text-muted-foreground">Empresa de fora do sistema: sem conta e sem DRE. Só a nossa perna é lançada.</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-5">
        <Item rotulo={total < 0 ? `Devemos à ${nome}` : `${nome} deve`} valor={brl(Math.abs(total))} destaque />
        {pares.map((p) => (
          <Item
            key={p.chave}
            rotulo={p.saldo < 0 ? `A ${nomeDaParte(d, p.b)} deve` : `À ${nomeDaParte(d, p.b)}`}
            valor={brl(Math.abs(p.saldo))}
            nota={jurosDoPar(p) ? `+ ${brl(jurosDoPar(p))} de juros até hoje` : textoDoPar(p.movimentos.filter((m) => m.status === "transferida").length, p.abertura !== 0)}
          />
        ))}
        <Item
          rotulo="Volta prevista"
          valor={datas.length ? datas.map(diaBr).join(", ") : "Sem previsão"}
          nota={previstos.length ? `${previstos.length === 1 ? "1 título" : `${previstos.length} títulos`} a receber · ${brl(previstos.reduce((s, m) => s + m.valor, 0))}` : undefined}
        />
        <Item rotulo="IOF pago até hoje" valor={iof ? brl(iof) : "—"} nota={iof ? "Pago pelas nossas contas" : undefined} />
      </div>
    </section>
  );
}

type Dlg =
  | { tipo: "form"; alvo: AlvoDoForm; titulo: string; subtitulo?: string }
  | { tipo: "cancelar"; m: MutuoDaLista }
  | { tipo: "baixa"; m: MutuoDaLista }
  | { tipo: "excluir"; m: MutuoDaLista }
  | { tipo: "juros"; aberturaId: string; atual: number | null }
  | null;

export function TelaMutuos({ dados: d }: { dados: DadosDoMutuo }) {
  const router = useRouter();
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const pares = saldosDosPares(d);
  const doGrupo = pares.filter((p) => !parDeFora(p));
  const deFora = pares.filter(parDeFora);

  React.useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const fechar = () => setDlg(null);
  const feito = (t: string) => {
    setDlg(null);
    setAviso(t);
    router.refresh();
  };

  const nomeDoLado = (contaId: string | null, m: MutuoDaLista) =>
    contaId ? d.contas.find((c) => c.id === contaId)?.nome ?? "—" : nomeDaParte(d, parteDeFora(m.fornecedorId as string));

  function devolver(m: MutuoDaLista) {
    const fora = m.fornecedorId ? parteDeFora(m.fornecedorId) : "";
    setDlg({
      tipo: "form",
      alvo: { modo: "novo", inicial: { origem: m.destinoId ?? fora, destino: m.origemId ?? fora, data: d.hoje, trimestre: m.trimestre, ano: m.ano } },
      titulo: "Mútuo no sentido contrário",
      subtitulo: `As contas do ${m.codigo}, invertidas. O valor abate o saldo do par.`,
    });
  }

  const corrigir = (m: MutuoDaLista) =>
    setDlg({ tipo: "form", alvo: { modo: "corrigir", mutuo: m }, titulo: `Corrigir ${m.codigo}`, subtitulo: "O mesmo formulário. Só a descrição não mexe nas pernas." });

  const colunas = ["Código", "Data", "Sai de → Entra em", "Valor", "Depois deste", "No banco", ""];

  return (
    <TooltipProvider>
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Mútuos entre empresas"
        description="Quem deve a quem entre os CNPJs do grupo e com as empresas de fora. Não é receita nem despesa: fica abaixo do Lucro líquido."
        icon={Handshake}
        actions={
          <button
            type="button"
            onClick={() => setDlg({ tipo: "form", alvo: { modo: "novo" }, titulo: "Mútuo entre empresas" })}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
          >
            <Plus className="h-4 w-4" />
            Novo mútuo
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {doGrupo.map((p) => (
          <div key={p.chave} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{quemDeve(d, p, p.saldo)}</p>
            <p className="mt-1 font-mono text-lg font-semibold">{brl(Math.abs(p.saldo))}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {textoDoPar(p.movimentos.filter((m) => m.status === "transferida").length, p.abertura !== 0)}
              {p.movimentos.some((m) => jurosDoMutuo(m, d.hoje)) ? ` · juros ${brl(p.movimentos.reduce((s, m) => s + jurosDoMutuo(m, d.hoje), 0))}` : ""}
              {iofDoPar(d, p.a, p.b) ? ` · IOF ${brl(iofDoPar(d, p.a, p.b))}` : ""}
            </p>
          </div>
        ))}
        {doGrupo.length === 0 && <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Nenhum mútuo lançado.</div>}
      </div>

      {deFora.length > 0 && <BlocoDeFora d={d} pares={deFora} />}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1250px] table-fixed text-sm">
          <colgroup>
            <col style={{ width: 112 }} />
            <col style={{ width: 104 }} />
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 340 }} />
            <col style={{ width: 164 }} />
            <col style={{ width: 132 }} />
          </colgroup>
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              {colunas.map((c, i) => (
                <th key={c || i} className={cn("px-3 py-2 text-left", c === "Valor" && "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pares.map((p) => (
              <Par key={p.chave} p={p} d={d} colunas={colunas.length} nomeDoLado={nomeDoLado} devolver={devolver} corrigir={corrigir} setDlg={setDlg} />
            ))}
            {pares.length === 0 && (
              <tr>
                <td colSpan={colunas.length} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum mútuo lançado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dlg?.tipo === "form" && (
        <Dialog open onOpenChange={(o) => !o && fechar()}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[780px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Handshake className="h-5 w-5 text-california-red" />
                {dlg.titulo}
              </DialogTitle>
              {dlg.subtitulo && <DialogDescription>{dlg.subtitulo}</DialogDescription>}
            </DialogHeader>
            <MutuoForm dados={d} alvo={dlg.alvo} onFechar={fechar} onFeito={feito} />
          </DialogContent>
        </Dialog>
      )}
      {dlg?.tipo === "cancelar" && <CancelarDialog d={d} m={dlg.m} nomeDoLado={nomeDoLado} onFechar={fechar} onFeito={feito} />}
      {dlg?.tipo === "baixa" && <BaixaDialog m={dlg.m} nomeDoLado={nomeDoLado} onFechar={fechar} onFeito={feito} />}
      {dlg?.tipo === "excluir" && <ExcluirDialog m={dlg.m} nomeDoLado={nomeDoLado} onFechar={fechar} onFeito={feito} />}
      {dlg?.tipo === "juros" && <JurosDialog aberturaId={dlg.aberturaId} atual={dlg.atual} onFechar={fechar} onFeito={feito} />}

      {aviso && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg">
          {aviso}
        </div>
      )}
    </TooltipProvider>
  );
}

function Par({
  p,
  d,
  colunas,
  nomeDoLado,
  devolver,
  corrigir,
  setDlg,
}: {
  p: SaldoDoPar;
  d: DadosDoMutuo;
  colunas: number;
  nomeDoLado: (contaId: string | null, m: MutuoDaLista) => string;
  devolver: (m: MutuoDaLista) => void;
  corrigir: (m: MutuoDaLista) => void;
  setDlg: (d: Dlg) => void;
}) {
  let corrente = p.abertura;
  const abertura = d.aberturas.find((x) => x.id === p.aberturaId);
  return (
    <>
      <tr className="border-b border-border bg-[#f3f2ee]">
        <td colSpan={colunas} className="px-3 py-1.5 text-xs font-semibold">
          {nomeDaParte(d, p.a)} × {nomeDaParte(d, p.b)}
          {ehParteDeFora(p.a) && <span className="ml-2 font-normal text-muted-foreground">Empresa de fora: só a nossa perna</span>}
        </td>
      </tr>
      {p.abertura !== 0 && (
        <tr className="border-b border-border">
          <td className="px-3 py-2 text-xs text-muted-foreground">Planilha</td>
          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.dataDaAbertura ? diaBr(p.dataDaAbertura) : "—"}</td>
          <td className="truncate px-3 py-2 text-xs text-muted-foreground" title={p.notaDaAbertura ?? ""}>
            Saldo de abertura{p.notaDaAbertura ? ` · ${p.notaDaAbertura}` : ""}
          </td>
          <td className="px-3 py-2 text-right font-mono text-xs">{brl(Math.abs(p.abertura))}</td>
          <td className="truncate px-3 py-2 text-xs">
            {quemDeve(d, p, p.abertura)} <b className="font-mono font-semibold">{brl(Math.abs(p.abertura))}</b>
          </td>
          <td className="px-3 py-2" />
          <td className="px-3 py-2">
            {ehParteDeFora(p.a) && abertura && (
              <span className="flex items-center justify-end gap-1">
                <Icone dica="Informar juros" onClick={() => setDlg({ tipo: "juros", aberturaId: abertura.id, atual: abertura.juros })}>
                  <Percent className="h-3.5 w-3.5" />
                </Icone>
              </span>
            )}
          </td>
        </tr>
      )}
      {p.movimentos.map((m) => {
        if (m.status === "transferida") corrente += parteDoLado(d, m.destinoId, m.fornecedorId) === p.a ? m.valor : -m.valor;
        const j = jurosDoMutuo(m, d.hoje);
        return (
          <tr key={m.id} className="border-b border-border">
            <td className="px-3 py-2 font-mono text-xs font-semibold">{m.codigo}</td>
            <td className="px-3 py-2 font-mono text-xs">{diaBr(m.data)}</td>
            <td className="px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className="truncate">{nomeDoLado(m.origemId, m)}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{nomeDoLado(m.destinoId, m)}</span>
              </span>
            </td>
            <td className="px-3 py-2 text-right font-mono text-xs">
              {brl(m.valor)}
              {j > 0 && <span className="block text-[10.5px] text-muted-foreground">+ {brl(j)} de juros</span>}
            </td>
            <td className="truncate px-3 py-2 text-xs">
              {m.status === "a_transferir" ? (
                <span className="text-muted-foreground">A transferir</span>
              ) : (
                <>
                  {quemDeve(d, p, corrente)} <b className="font-mono font-semibold">{brl(Math.abs(Math.round(corrente * 100) / 100))}</b>
                </>
              )}
            </td>
            <td className="px-3 py-2">
              <Pernas m={m} />
            </td>
            <td className="px-3 py-2">
              <span className="flex items-center justify-end gap-1">
                {m.status === "a_transferir" ? (
                  <>
                    <Icone dica="Dar baixa" onClick={() => setDlg({ tipo: "baixa", m })}>
                      <Banknote className="h-3.5 w-3.5" />
                    </Icone>
                    <Icone dica="Corrigir" onClick={() => corrigir(m)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Icone>
                    <Icone dica="Excluir" vermelho onClick={() => setDlg({ tipo: "excluir", m })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Icone>
                  </>
                ) : (
                  <>
                    <Icone dica="Lançar no sentido contrário" onClick={() => devolver(m)}>
                      <Undo2 className="h-3.5 w-3.5" />
                    </Icone>
                    <Icone dica="Corrigir" onClick={() => corrigir(m)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Icone>
                    <Icone dica="Cancelar a baixa" vermelho onClick={() => setDlg({ tipo: "cancelar", m })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Icone>
                  </>
                )}
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

const BOTAO = "rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted";

function Erro({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{texto}</span>
    </div>
  );
}

function CancelarDialog({
  d,
  m,
  nomeDoLado,
  onFechar,
  onFeito,
}: {
  d: DadosDoMutuo;
  m: MutuoDaLista;
  nomeDoLado: (contaId: string | null, m: MutuoDaLista) => string;
  onFechar: () => void;
  onFeito: (t: string) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const ligadas = m.pernas.filter((p) => p.conciliada);
  const uma = umaPernaSo(m);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Cancelar a baixa</DialogTitle>
          <DialogDescription>
            {m.codigo} · {nomeDoLado(m.origemId, m)} → {nomeDoLado(m.destinoId, m)} · {diaBr(m.data)} · {brl(m.valor)}
          </DialogDescription>
        </DialogHeader>
        <p className="text-[12.5px] text-muted-foreground">{uma ? "Tira a linha do Extrato." : "Tira as duas linhas do Extrato."} O mútuo fica a transferir de novo.</p>
        {ligadas.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            {uma ? "A perna está conciliada" : ligadas.length === 1 ? "Uma perna está conciliada" : "As duas pernas estão conciliadas"}:{" "}
            {ligadas.map((p) => d.contas.find((c) => c.id === p.contaId)?.nome ?? "conta").join(" e ")} {ligadas.length === 1 ? "volta" : "voltam"} para pendente.
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="cancelar-motivo" className="text-xs font-semibold">
            Motivo <span className="text-california-red">*</span>
          </label>
          <textarea
            id="cancelar-motivo"
            value={motivo}
            onChange={(ev) => {
              setMotivo(ev.target.value);
              setErro(null);
            }}
            rows={2}
            placeholder="Ex.: lançado na conta errada"
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        {erro && <Erro texto={erro} />}
        <DialogFooter className="items-center gap-2">
          <button type="button" className={BOTAO} onClick={onFechar}>
            Voltar
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
            onClick={() =>
              startTransition(async () => {
                const r = await cancelarBaixa({ tipo: "transferencia", id: m.id, motivo });
                if (!r.ok) return setErro(r.message);
                onFeito(`Baixa do ${m.codigo} cancelada: ${uma ? "a linha saiu" : "as duas pernas saíram"} do extrato e ele ficou a transferir de novo.`);
              })
            }
          >
            Cancelar a baixa
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BaixaDialog({
  m,
  nomeDoLado,
  onFechar,
  onFeito,
}: {
  m: MutuoDaLista;
  nomeDoLado: (contaId: string | null, m: MutuoDaLista) => string;
  onFechar: () => void;
  onFeito: (t: string) => void;
}) {
  const [data, setData] = React.useState(m.data);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Dar baixa no {m.codigo}</DialogTitle>
          <DialogDescription>
            {nomeDoLado(m.origemId, m)} → {nomeDoLado(m.destinoId, m)} · {brl(m.valor)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Data <span className="text-california-red">*</span>
          </label>
          <DatePicker name="data_baixa" defaultValue={data} onDateChange={(dia) => setData(dia ? format(dia, "yyyy-MM-dd") : "")} />
        </div>
        {erro && <Erro texto={erro} />}
        <DialogFooter className="items-center gap-2">
          <button type="button" className={BOTAO} onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            onClick={() => {
              if (!data) return setErro("Informe a data.");
              startTransition(async () => {
                const r = await darBaixaTransferencia({ transferencia_id: m.id, data });
                if (!r.ok) return setErro(r.message);
                onFeito(`${m.codigo} registrado, com ${umaPernaSo(m) ? "a linha" : "as duas linhas"} no extrato.`);
              });
            }}
          >
            <Banknote className="h-4 w-4" />
            Dar baixa
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExcluirDialog({
  m,
  nomeDoLado,
  onFechar,
  onFeito,
}: {
  m: MutuoDaLista;
  nomeDoLado: (contaId: string | null, m: MutuoDaLista) => string;
  onFechar: () => void;
  onFeito: (t: string) => void;
}) {
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Excluir o {m.codigo}?</DialogTitle>
          <DialogDescription>
            {nomeDoLado(m.origemId, m)} → {nomeDoLado(m.destinoId, m)} · {brl(m.valor)}. Ele ainda não tem linhas no extrato.
          </DialogDescription>
        </DialogHeader>
        {erro && <Erro texto={erro} />}
        <DialogFooter className="items-center gap-2">
          <button type="button" className={BOTAO} onClick={onFechar}>
            Voltar
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
            onClick={() =>
              startTransition(async () => {
                const r = await excluirTituloReceberAvulso({ origem: "transferencia", id: m.id });
                if (!r.ok) return setErro(r.message);
                onFeito(`${m.codigo} excluído.`);
              })
            }
          >
            Excluir
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JurosDialog({ aberturaId, atual, onFechar, onFeito }: { aberturaId: string; atual: number | null; onFechar: () => void; onFeito: (t: string) => void }) {
  const [texto, setTexto] = React.useState(atual != null ? String(atual).replace(".", ",") : "");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Juros do saldo de abertura</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="juros-abertura" className="text-xs font-semibold">
            Juros ao mês (%)
          </label>
          <input
            id="juros-abertura"
            value={texto}
            onChange={(ev) => setTexto(ev.target.value)}
            placeholder="0,00"
            className="flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 font-mono text-sm focus-visible:border-california-red focus-visible:outline-none"
          />
          <p className="text-[11px] text-muted-foreground">Opcional. Vazio é sem juros. Preenchido, mostra os juros até hoje. Nada é lançado até o dinheiro passar pelo banco.</p>
        </div>
        {erro && <Erro texto={erro} />}
        <DialogFooter className="items-center gap-2">
          <button type="button" className={BOTAO} onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            onClick={() => {
              const limpo = texto.trim();
              const taxa = limpo ? Number(limpo.replace(",", ".")) : null;
              if (taxa !== null && !(taxa > 0)) return setErro("Informe juros maiores que zero, ou deixe vazio.");
              startTransition(async () => {
                const r = await definirJurosDaAbertura({ id: aberturaId, juros_ao_mes: taxa });
                if (!r.ok) return setErro(r.message);
                onFeito(taxa ? `Juros de ${limpo}% ao mês informados.` : "Saldo sem juros informados.");
              });
            }}
          >
            Salvar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
