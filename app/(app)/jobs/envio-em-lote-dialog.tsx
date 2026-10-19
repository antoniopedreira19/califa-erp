"use client";

/**
 * O pop-up do envio em lote para faturamento (decisão 188, entrega 1) —
 * design aprovado pelo Tiago em 19/10/2026 (protótipo "lista de notas").
 *
 * De cima para baixo:
 * 1. Os jobs do envio em cartões, cada um com uma cor, o valor (o do mês,
 *    no mensal) e uma barra de quanto dele já está nas notas.
 * 2. As notas que o cliente pediu, uma por linha: tomador, CNPJ (ou
 *    exterior), valor, descritivo e o "Rateio" — Proporcional, Só o job X,
 *    ou Dividir à mão (os campos abrem na própria linha). Atalhos para
 *    começar: uma nota para todos os jobs, uma nota por job, ou nota a nota.
 * 3. À direita, o que vale para todas as notas (vencimento e parcelas, CNAE
 *    sugerido, portal com cadastro), a observação para o financeiro e os
 *    contatos de cobrança.
 *
 * O valor de cada job vem do servidor (`carregarEnvioEmLote`) e é relido no
 * envio; o rateio da tela e o do servidor são a mesma conta
 * (`lib/calculos/envio-em-lote.ts`).
 */

import * as React from "react";
import { AlertCircle, Check, Copy, Info, Layers, Loader2, Lock, Plus, Repeat, Rows3, Send, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, COMBOBOX_COMO_SELECT, type ComboboxItem } from "@/components/ui/combobox";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn, formatCnpj, formatCurrency, isValidCnpj } from "@/lib/utils";
import { codigoDoCnae, rotuloDoCnae } from "@/lib/fiscal/calculos";
import {
  MANUAL,
  PROPORCIONAL,
  centavos,
  centavosDoJobNasNotas,
  copiarNotas,
  escalarCentavos,
  ratearNotas,
  somaDiasIso,
} from "@/lib/calculos/envio-em-lote";
import { nomeDoMes, rotuloMes } from "@/lib/calculos/meses-trimestre";
import {
  carregarEnvioEmLote,
  enviarLoteParaFaturamento,
  type DadosDoLote,
  type EnvioAnterior,
  type JobDoLote,
} from "./actions-envio-lote";
import { cadastrarPortalDoClienteDoJob } from "./[jobId]/actions-faturamento";
import { listarCnaesDoGrupo } from "./[jobId]/actions-cnae-sugerido";

const MOEDA = "BRL";
const SEM_PORTAL = "__sem_portal__";
const CNAE_NENHUM = "__nenhum__";
/** Uma cor por job: a barra da nota e o cartão do job dizem de quem é cada parte. */
const CORES = ["#7C5CD6", "#0E9384", "#D98A1E", "#3B82C4", "#D2577A", "#6B8E23", "#8C6D46", "#C0504D"];

const brl = (v: number) => formatCurrency(v, MOEDA);
const brlc = (c: number) => formatCurrency(c / 100, MOEDA);
const qtdJobs = (n: number) => (n === 1 ? "1 job" : `${n} jobs`);
const qtdNotas = (n: number) => (n === 1 ? "1 nota fiscal" : `${n} notas fiscais`);
const dataBr = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

let sequencia = 0;
const novoId = () => `l${++sequencia}`;

/** O dia do envio, no horário de Brasília. */
const diaDoEnvio = (ev: EnvioAnterior) =>
  new Date(ev.enviadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
/** "Outubro de 2026" (mensal) ou "Envio de 16/10/2026". */
const tituloDoEnvio = (ev: EnvioAnterior) => (ev.mes ? rotuloMes(ev.mes) : `Envio de ${diaDoEnvio(ev)}`);
/** No meio da frase: "de outubro de 2026" ou "do envio de 16/10/2026". */
const deDoEnvio = (ev: EnvioAnterior) =>
  ev.mes ? `de ${nomeDoMes(ev.mes)} de ${ev.mes.slice(0, 4)}` : `do envio de ${diaDoEnvio(ev)}`;

interface Nota {
  id: string;
  tomador: string;
  cnpj: string;
  exterior: boolean;
  valor: number;
  descritivo: string;
  /** "proporcional", "manual" ou o id do job. */
  modo: string;
  manual: Record<string, number>;
}

interface Contato {
  id: string;
  nome: string;
  numero: string;
  email: string;
  deJobs: string[];
  novo: boolean;
}

export interface EnvioEmLoteResultado {
  qtdJobs: number;
  qtdNotas: number;
  cliente: string;
}

// ---------------------------------------------------------------------------
// O pop-up
// ---------------------------------------------------------------------------

export function EnvioEmLoteDialog({
  jobIds,
  onClose,
  onEnviado,
}: {
  jobIds: string[];
  onClose: () => void;
  onEnviado: (r: EnvioEmLoteResultado) => void;
}) {
  const [dados, setDados] = React.useState<DadosDoLote | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivo = true;
    carregarEnvioEmLote(jobIds).then((r) => {
      if (!vivo) return;
      if (r.ok) setDados(r.dados);
      else setErro(r.message);
    });
    return () => {
      vivo = false;
    };
  }, [jobIds]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[97vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1560px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {dados && dados.jobs.length > 0 ? (
          <Formulario dados={dados} onClose={onClose} onEnviado={onEnviado} />
        ) : (
          <>
            <DialogHeader className="border-b border-border p-6 pr-12">
              <DialogTitle>Enviar para faturamento</DialogTitle>
              <DialogDescription>
                {dados ? "Nenhum dos jobs marcados pode ir agora." : erro ? "Não deu para abrir o envio." : "Lendo os jobs marcados…"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 p-6">
              {!dados && !erro && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Conferindo cada job: status, saves, errata e o valor a faturar.
                </p>
              )}
              {erro && <p className="text-sm text-california-red">{erro}</p>}
              {dados && <ForaDoLote itens={dados.foraDoLote} />}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ForaDoLote({ itens }: { itens: DadosDoLote["foraDoLote"] }) {
  if (itens.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-semibold">
        {itens.length === 1 ? "1 job ficou fora deste envio:" : `${itens.length} jobs ficaram fora deste envio:`}
      </p>
      {itens.map((f) => (
        <p key={f.id}>
          <span className="font-mono font-semibold">{f.codigo}</span> — {f.motivo}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O formulário
// ---------------------------------------------------------------------------

function Formulario({
  dados,
  onClose,
  onEnviado,
}: {
  dados: DadosDoLote;
  onClose: () => void;
  onEnviado: (r: EnvioEmLoteResultado) => void;
}) {
  const jobs = dados.jobs;
  const total = jobs.reduce((s, j) => s + centavos(j.valor), 0);
  const cor = (jid: string) => CORES[jobs.findIndex((j) => j.id === jid) % CORES.length];
  const nomeMes = jobs.find((j) => j.mes)?.mes?.nome ?? null;

  const [notas, setNotas] = React.useState<Nota[]>([]);
  const [focarId, setFocarId] = React.useState<string | null>(null);
  const [po, setPo] = React.useState<Record<string, string>>({});
  const [venc, setVenc] = React.useState(dados.vencimentoSugerido);
  const [parcelas, setParcelas] = React.useState(1);
  const [cnae, setCnae] = React.useState("");
  const [portais, setPortais] = React.useState(dados.portais);
  const [portalId, setPortalId] = React.useState(SEM_PORTAL);
  const [portalPendente, setPortalPendente] = React.useState<string | null>(null);
  const [observacao, setObservacao] = React.useState("");
  const [contatos, setContatos] = React.useState<Contato[]>(() =>
    dados.contatos.map((c) => ({ id: novoId(), ...c, novo: false })),
  );
  const [itensCnae, setItensCnae] = React.useState<ComboboxItem[] | null>(null);
  const [confirmar, setConfirmar] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivo = true;
    listarCnaesDoGrupo().then((r) => {
      if (!vivo) return;
      setItensCnae(
        r.ok
          ? [
              { value: CNAE_NENHUM, label: "Nenhum" },
              ...r.cnaes.map((c) => {
                const codigo = codigoDoCnae(c);
                const digitos = c.codigo.replace(/\D/g, "");
                return {
                  value: codigo,
                  label: c.descricao,
                  descricao: codigo,
                  curto: codigo,
                  busca: `${rotuloDoCnae(c)} ${digitos}`,
                };
              }),
            ]
          : [{ value: CNAE_NENHUM, label: "Nenhum" }],
      );
    });
    return () => {
      vivo = false;
    };
  }, []);

  // O Select só recebe o portal novo depois que a opção já está na lista:
  // valor e opção na mesma renderização zeram o Select do Radix.
  React.useEffect(() => {
    if (portalPendente && portais.some((p) => p.id === portalPendente)) {
      setPortalId(portalPendente);
      setPortalPendente(null);
    }
  }, [portais, portalPendente]);

  const partes = React.useMemo(
    () =>
      ratearNotas(
        notas.map((n) => ({ id: n.id, valor: n.valor, modo: n.modo, manual: n.manual })),
        jobs.map((j) => ({ id: j.id, valor: j.valor })),
      ),
    [notas, jobs],
  );
  const noJob = (jid: string) => centavosDoJobNasNotas(partes, jid);
  const somaNotas = notas.reduce((s, n) => s + centavos(n.valor), 0);

  const linha = (p: Partial<Nota>): Nota => ({
    id: novoId(),
    tomador: "",
    cnpj: dados.cliente.cnpj ?? "",
    exterior: false,
    valor: 0,
    descritivo: "",
    modo: PROPORCIONAL,
    manual: {},
    ...p,
  });
  const mexer = (id: string, patch: Partial<Nota>) =>
    setNotas((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  // ---- Copiar de um envio anterior (entrega 3)
  // "Repetir" é o envio mais recente com estes mesmos jobs — o mês anterior
  // deles, no mensal.
  const [copiar, setCopiar] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const idsDoLote = React.useMemo(() => jobs.map((j) => j.id), [jobs]);
  const mesmosJobs = (ev: EnvioAnterior) =>
    ev.jobs.length === jobs.length && ev.jobs.every((j) => idsDoLote.includes(j.id));
  const anterior = dados.anteriores.find(mesmosJobs) ?? null;
  function copiarDe(ev: EnvioAnterior, ajustar: boolean) {
    const r = copiarNotas(ev.notas, {
      jobs: idsDoLote,
      totalCentavos: total,
      ajustar,
      mesDe: ev.mes,
      mesPara: dados.mes,
    });
    setNotas(
      r.notas.map((n) =>
        linha({
          tomador: n.tomador,
          cnpj: n.exterior ? "" : (n.cnpj ?? ""),
          exterior: n.exterior,
          valor: n.valor,
          descritivo: n.descritivo,
          modo: n.modo,
        }),
      ),
    );
    const partesDoAviso = [
      `${mesmosJobs(ev) ? "Repeti" : "Copiei"} ${ev.notas.length === 1 ? "a nota" : `as ${ev.notas.length} notas`} ${deDoEnvio(ev)}`,
    ];
    if (r.trocouMes && ev.mes && dados.mes)
      partesDoAviso.push(`troquei “${nomeDoMes(ev.mes)}” por “${nomeDoMes(dados.mes)}” nos descritivos`);
    if (r.ajustou) partesDoAviso.push(`ajustei os valores na mesma proporção ao total de ${brlc(total)}`);
    if (r.voltaramDeJob > 0)
      partesDoAviso.push(
        r.voltaramDeJob === 1
          ? "1 nota que era de um job de lá voltou para Proporcional"
          : `${r.voltaramDeJob} notas que eram de um job de lá voltaram para Proporcional`,
      );
    if (r.voltaramDeManual > 0)
      partesDoAviso.push(
        r.voltaramDeManual === 1
          ? "1 nota dividida à mão voltou para Proporcional"
          : `${r.voltaramDeManual} notas divididas à mão voltaram para Proporcional`,
      );
    setAviso(`${partesDoAviso.join("; ")}. Confira antes de enviar.`);
  }

  const acoes: Acoes = {
    umaParaTodos: () => setNotas([linha({ tomador: dados.cliente.nome, valor: total / 100 })]),
    umaPorJob: () => setNotas(jobs.map((j) => linha({ tomador: dados.cliente.nome, valor: j.valor, modo: j.id }))),
    adicionar: () => {
      const nova = linha({ valor: Math.max(0, total - somaNotas) / 100 });
      setFocarId(nova.id);
      setNotas((ns) => [...ns, nova]);
    },
    remover: (id) => setNotas((ns) => ns.filter((n) => n.id !== id)),
    limpar: () => {
      setNotas([]);
      setAviso(null);
    },
    mexer,
    mudarModo: (n, modo) => {
      if (modo === MANUAL) {
        const atual = partes[n.id] ?? {};
        mexer(n.id, { modo, manual: Object.fromEntries(Object.entries(atual).map(([k, v]) => [k, v / 100])) });
      } else mexer(n.id, { modo });
    },
  };

  // ---- o que falta
  const pendencias: string[] = [];
  if (notas.length === 0) pendencias.push("as notas fiscais que o cliente pediu");
  notas.forEach((n, i) => {
    const r = `nota ${i + 1}${n.tomador ? ` (${n.tomador})` : ""}`;
    if (!n.exterior && !isValidCnpj(n.cnpj)) pendencias.push(`o CNPJ da ${r}`);
    if (centavos(n.valor) <= 0) pendencias.push(`o valor da ${r}`);
    if (n.modo === MANUAL && Object.values(n.manual).reduce((s, v) => s + centavos(v), 0) !== centavos(n.valor))
      pendencias.push(`a divisão à mão da ${r} não fecha`);
  });
  if (notas.length && venc.length !== 10) pendencias.push("o vencimento");
  const manualAberto = notas.some(
    (n) => n.modo === MANUAL && Object.values(n.manual).reduce((s, v) => s + centavos(v), 0) !== centavos(n.valor),
  );
  if (notas.length && somaNotas !== total) pendencias.push(`as notas somam ${brlc(somaNotas)}; os jobs, ${brlc(total)}`);
  else if (notas.length && !manualAberto)
    for (const j of jobs) {
      const d = centavos(j.valor) - noJob(j.id);
      if (d > 0) pendencias.push(`faltam ${brlc(d)} do ${j.codigo} nas notas`);
      if (d < 0) pendencias.push(`sobram ${brlc(-d)} no ${j.codigo}`);
    }
  const contatosValidos = contatos.filter((c) => c.nome.trim().length >= 2 && /\S+@\S+\.\S+/.test(c.email.trim()));
  if (contatosValidos.length === 0) pendencias.push("ao menos um contato de cobrança");
  if (contatos.some((c) => c.novo && !contatosValidos.includes(c))) pendencias.push("o nome e o e-mail do contato novo");

  async function enviar() {
    setEnviando(true);
    setErro(null);
    const r = await enviarLoteParaFaturamento({
      jobs: jobs.map((j) => ({ job_id: j.id, numero_po: po[j.id] ?? null })),
      mes: dados.mes,
      vencimento: venc,
      parcelas,
      cnae_sugerido: cnae || null,
      portal_id: portalId === SEM_PORTAL ? null : portalId,
      observacao: observacao || null,
      contatos: contatosValidos.map((c) => ({ nome: c.nome.trim(), numero: c.numero.trim() || null, email: c.email.trim() })),
      notas: notas.map((n) => ({
        tomador_nome: n.tomador || null,
        cnpj: n.exterior ? null : n.cnpj,
        tomador_exterior: n.exterior,
        valor: n.valor,
        descritivo: n.descritivo || null,
        rateio: n.modo,
        manual: n.modo === MANUAL ? n.manual : undefined,
      })),
    });
    setEnviando(false);
    setConfirmar(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onEnviado({ qtdJobs: r.qtdJobs, qtdNotas: r.qtdNotas, cliente: dados.cliente.nome });
  }

  return (
    <>
      <DialogHeader className="border-b border-border p-6 pr-12">
        <DialogTitle>
          {nomeMes && jobs.every((j) => j.mes)
            ? `Enviar ${nomeMes} de ${qtdJobs(jobs.length)} do cliente ${dados.cliente.nome} para faturamento`
            : `Enviar ${qtdJobs(jobs.length)} do cliente ${dados.cliente.nome} para faturamento`}
        </DialogTitle>
        <DialogDescription>
          Cada nota que o cliente pediu entra na fila do financeiro com o rateio entre os jobs. O valor de cada job vem
          {nomeMes ? ` do faturamento de ${nomeMes} na planilha` : " do faturamento previsto"} e não é editável aqui.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto p-6">
          <ForaDoLote itens={dados.foraDoLote} />
          <CartoesDosJobs jobs={jobs} cor={cor} noJob={noJob} temNotas={notas.length > 0} po={po} setPo={setPo} />
          <Notas
            notas={notas}
            jobs={jobs}
            partes={partes}
            cor={cor}
            focarId={focarId}
            acoes={acoes}
            somaNotas={somaNotas}
            total={total}
            anterior={anterior}
            temAnteriores={dados.anteriores.length > 0}
            onRepetir={() => anterior && copiarDe(anterior, false)}
            onCopiar={() => setCopiar(true)}
            aviso={aviso}
            onFecharAviso={() => setAviso(null)}
          />
        </div>
        <Resumo
          dados={dados}
          total={total}
          venc={venc}
          setVenc={setVenc}
          parcelas={parcelas}
          setParcelas={setParcelas}
          cnae={cnae}
          setCnae={setCnae}
          itensCnae={itensCnae}
          portais={portais}
          portalId={portalId}
          setPortalId={setPortalId}
          onPortalCadastrado={(p) => {
            setPortais((ps) => [...ps, p]);
            setPortalPendente(p.id);
          }}
          observacao={observacao}
          setObservacao={setObservacao}
          contatos={contatos}
          setContatos={setContatos}
        />
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border p-4">
        <div className="min-w-0 flex-1">
          {erro ? (
            <p className="flex items-start gap-1.5 text-xs text-california-red">
              <AlertCircle className="mt-px h-3.5 w-3.5 flex-none" />
              {erro}
            </p>
          ) : pendencias.length > 0 ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertCircle className="mt-px h-3.5 w-3.5 flex-none text-california-red" />
              <span>
                <span className="font-semibold text-foreground">Falta:</span> {pendencias.slice(0, 3).join("; ")}
                {pendencias.length > 3 ? `; e mais ${pendencias.length - 3}.` : "."}
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Tudo pronto: {qtdJobs(jobs.length)} em {qtdNotas(notas.length)}, cada job fechado nas notas.
            </p>
          )}
        </div>
        <div className="flex flex-none items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => setConfirmar(true)}
            disabled={pendencias.length > 0 || enviando}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Enviar {qtdJobs(jobs.length)}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmar}
        onOpenChange={(o) => !o && !enviando && setConfirmar(false)}
        contentClassName="sm:max-w-[680px]"
        title={
          nomeMes && jobs.every((j) => j.mes)
            ? `Enviar ${nomeMes} de ${qtdJobs(jobs.length)} do cliente ${dados.cliente.nome} para faturamento?`
            : `Enviar ${qtdJobs(jobs.length)} do cliente ${dados.cliente.nome} para faturamento?`
        }
        description={
          <span className="block space-y-3">
            <span className="block">
              O financeiro recebe <strong>{qtdNotas(notas.length)}</strong>, num total de <strong>{brlc(total)}</strong>,{" "}
              {parcelas > 1
                ? `em ${parcelas} parcelas, de ${dataBr(venc)} a ${dataBr(somaDiasIso(venc, 30 * (parcelas - 1)))}`
                : `vencimento em ${dataBr(venc)}`}
              . Cada nota leva o seu rateio entre os jobs:
            </span>
            <span className="block max-h-[360px] overflow-y-auto rounded-xl border border-border">
              {notas.map((n, i) => {
                const ks = Object.keys(partes[n.id] ?? {});
                return (
                  <span
                    key={n.id}
                    className={cn(
                      "grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1.5 text-foreground",
                      i > 0 && "border-t border-border",
                    )}
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">
                        {n.tomador || "Sem nome"}{" "}
                        <span className="font-mono text-[11px] font-normal text-muted-foreground">
                          {n.exterior ? "exterior" : formatCnpj(n.cnpj)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {ks.map((k) => (
                          <span key={k} className="h-1.5 w-1.5 rounded-full" style={{ background: cor(k) }} />
                        ))}
                        {ks.length === 1
                          ? `só o ${jobs.find((j) => j.id === ks[0])?.codigo}`
                          : n.modo === MANUAL
                            ? `dividida à mão entre ${ks.length} jobs`
                            : `rateio entre ${ks.length} jobs`}
                      </span>
                    </span>
                    <span className="font-mono text-[12.5px] font-semibold">{brl(n.valor)}</span>
                  </span>
                );
              })}
            </span>
            {observacao.trim() && (
              <span className="block rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
                <span className="font-semibold">Observação:</span> {observacao.trim()}
              </span>
            )}
            <span className="block">
              {!nomeMes
                ? "O envio é definitivo: depois dele não há mais errata nem consumo de save nestes jobs."
                : jobs.every((j) => j.mes)
                  ? `O envio é definitivo: errata e consumo de save de ${nomeMes} ficam travados, e os outros meses seguem editáveis.`
                  : `O envio é definitivo: nos jobs mensais, errata e consumo de save de ${nomeMes} ficam travados (os outros meses seguem editáveis); nos demais, não há mais errata nem consumo de save.`}
            </span>
          </span>
        }
        confirmLabel={`Sim, enviar ${qtdJobs(jobs.length)}`}
        pending={enviando}
        onConfirm={enviar}
      />
      {copiar && (
        <CopiarDeEnvio
          anteriores={dados.anteriores}
          cliente={dados.cliente.nome}
          total={total}
          mes={dados.mes}
          mesmosJobs={mesmosJobs}
          idsDoLote={idsDoLote}
          onCopiar={(ev, ajustar) => {
            copiarDe(ev, ajustar);
            setCopiar(false);
          }}
          onClose={() => setCopiar(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. Os jobs
// ---------------------------------------------------------------------------

function CartoesDosJobs({
  jobs,
  cor,
  noJob,
  temNotas,
  po,
  setPo,
}: {
  jobs: JobDoLote[];
  cor: (id: string) => string;
  noJob: (id: string) => number;
  temNotas: boolean;
  po: Record<string, string>;
  setPo: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const mensal = jobs.find((j) => j.mes)?.mes ?? null;
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Jobs deste envio</h3>
        <p className="text-xs text-muted-foreground">
          {mensal
            ? `O valor de ${mensal.nome} de cada job mensal, da planilha. A barra mostra quanto dele já está nas notas.`
            : "O valor de cada job vem do faturamento previsto. A barra mostra quanto dele já está nas notas."}
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
        {jobs.map((j) => {
          const v = centavos(j.valor);
          const nas = noJob(j.id);
          const ok = nas === v && temNotas;
          const pct = v > 0 ? Math.min(100, (nas / v) * 100) : 0;
          return (
            <div key={j.id} className={cn("rounded-xl border bg-white p-3", ok ? "border-emerald-600/30" : "border-border")}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: cor(j.id) }} />
                <span className="font-mono text-xs font-semibold text-california-red">{j.codigo}</span>
                {j.mes && (
                  <span className="ml-auto whitespace-nowrap text-[10.5px] text-muted-foreground">
                    {j.mes.nome.charAt(0).toUpperCase() + j.mes.nome.slice(1)} · mês {j.mes.ordem} de {j.mes.total}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[13px]" title={j.nome}>
                {j.nome}
              </p>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-bold">{brlc(v)}</span>
                <span
                  className={cn(
                    "whitespace-nowrap text-[11px] font-semibold",
                    ok ? "text-emerald-700" : nas > v ? "text-california-red" : "text-muted-foreground",
                  )}
                >
                  {!temNotas ? "ainda sem nota" : ok ? "✓ todo nas notas" : nas > v ? `sobram ${brlc(nas - v)}` : `faltam ${brlc(v - nas)}`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: ok ? "#047857" : cor(j.id) }} />
              </div>
              <Input
                value={po[j.id] ?? ""}
                onChange={(e) => setPo((p) => ({ ...p, [j.id]: e.target.value }))}
                placeholder="Nº da PO (opcional)"
                maxLength={60}
                aria-label={`Nº da PO do ${j.codigo}`}
                className="mt-2 h-8 text-[12px]"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. As notas
// ---------------------------------------------------------------------------

interface Acoes {
  umaParaTodos: () => void;
  umaPorJob: () => void;
  adicionar: () => void;
  remover: (id: string) => void;
  limpar: () => void;
  mexer: (id: string, patch: Partial<Nota>) => void;
  mudarModo: (n: Nota, modo: string) => void;
}

const BOTAO =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red";
const BOTAO_PRIMARIO =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-california-red px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover";

function Notas({
  notas,
  jobs,
  partes,
  cor,
  focarId,
  acoes,
  somaNotas,
  total,
  anterior,
  temAnteriores,
  onRepetir,
  onCopiar,
  aviso,
  onFecharAviso,
}: {
  notas: Nota[];
  jobs: JobDoLote[];
  partes: Record<string, Record<string, number>>;
  cor: (id: string) => string;
  focarId: string | null;
  acoes: Acoes;
  somaNotas: number;
  total: number;
  /** O envio mais recente com estes mesmos jobs: o "Repetir". */
  anterior: EnvioAnterior | null;
  temAnteriores: boolean;
  onRepetir: () => void;
  onCopiar: () => void;
  /** O que a cópia fez, para conferir. */
  aviso: string | null;
  onFecharAviso: () => void;
}) {
  if (notas.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Notas fiscais</h3>
        <div className="rounded-xl border-2 border-dashed border-border bg-white px-6 py-9 text-center">
          <p className="text-sm font-semibold">Quais notas o cliente pediu?</p>
          <p className="mx-auto mt-1 max-w-[560px] text-xs text-muted-foreground">
            {anterior
              ? `Repita as notas ${deDoEnvio(anterior)} destes jobs, copie de outro envio do cliente, ou monte do zero. `
              : temAnteriores
                ? "Copie as notas de um envio anterior do cliente — de outros jobs ou de outro mês — ou monte do zero. "
                : "Uma linha por nota, como o cliente pediu: tomador, CNPJ, valor e descritivo. "}
            Depois, cada nota diz de que jobs ela é.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {anterior && (
              <button type="button" onClick={onRepetir} className={BOTAO_PRIMARIO}>
                <Repeat className="h-3.5 w-3.5" />
                {anterior.mes ? `Repetir as notas de ${nomeDoMes(anterior.mes)}` : "Repetir as notas do envio anterior"}
              </button>
            )}
            {temAnteriores && (
              <button type="button" onClick={onCopiar} className={anterior ? BOTAO : BOTAO_PRIMARIO}>
                <Copy className="h-3.5 w-3.5" />
                {anterior ? "Copiar de outro envio" : "Copiar de um envio anterior"}
              </button>
            )}
            <button type="button" onClick={acoes.umaParaTodos} className={BOTAO}>
              <Layers className="h-3.5 w-3.5" />
              Uma nota para todos os jobs
            </button>
            {jobs.length > 1 && (
              <button type="button" onClick={acoes.umaPorJob} className={BOTAO}>
                <Rows3 className="h-3.5 w-3.5" />
                Uma nota por job
              </button>
            )}
            <button type="button" onClick={acoes.adicionar} className={temAnteriores ? BOTAO : BOTAO_PRIMARIO}>
              <Plus className="h-3.5 w-3.5" />
              Adicionar nota
            </button>
          </div>
        </div>
      </div>
    );
  }
  const fecha = somaNotas === total;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-sm font-semibold">Notas fiscais ({notas.length})</h3>
        <button
          type="button"
          onClick={acoes.limpar}
          className="px-2 py-2 text-xs font-semibold text-muted-foreground hover:text-california-red"
        >
          Começar de novo
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Uma linha por nota, como o cliente pediu. Em “Rateio”, o padrão é dividir a nota na proporção do valor dos jobs;
        escolha “Só o” job quando a nota for de um job só, ou “Dividir à mão” para escrever quanto vai para cada job.
      </p>
      {aviso && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <Info className="mt-px h-3.5 w-3.5 flex-none" />
          <span className="min-w-0 flex-1">{aviso}</span>
          <button
            type="button"
            onClick={onFecharAviso}
            aria-label="Fechar o aviso"
            className="flex-none rounded p-0.5 text-sky-700 transition-colors hover:bg-sky-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <table className="w-full table-fixed text-[13px]">
          <colgroup>
            <col className="w-[40px]" />
            <col className="w-[290px]" />
            <col className="w-[150px]" />
            <col />
            <col className="w-[210px]" />
            <col className="w-[44px]" />
          </colgroup>
          <thead className="bg-muted/50">
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-2.5 text-center">#</th>
              <th className="px-3 py-2.5 text-left">Tomador e CNPJ</th>
              <th className="px-3 py-2.5 text-left">Valor</th>
              <th className="px-3 py-2.5 text-left">Descritivo da nota</th>
              <th className="px-3 py-2.5 text-left">Rateio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {notas.map((n, i) => (
              <LinhaDaNota
                key={n.id}
                n={n}
                i={i}
                jobs={jobs}
                partes={partes[n.id] ?? {}}
                cor={cor}
                focar={n.id === focarId}
                acoes={acoes}
              />
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={acoes.adicionar}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-white py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar nota
      </button>
      <div
        className={cn(
          "flex items-center justify-between rounded-lg border px-3 py-2 text-xs",
          fecha ? "border-emerald-600/25 bg-emerald-50/50" : "border-california-red/30 bg-california-red/[0.03]",
        )}
      >
        <span className="text-muted-foreground">{qtdNotas(notas.length)}</span>
        <span className={cn("font-medium", fecha ? "text-emerald-700" : "text-california-red")}>
          Soma das notas <span className="font-mono">{brlc(somaNotas)}</span> de <span className="font-mono">{brlc(total)}</span>
          {fecha ? " ✓" : somaNotas < total ? ` · faltam ${brlc(total - somaNotas)}` : ` · passam ${brlc(somaNotas - total)}`}
        </span>
      </div>
    </div>
  );
}

function LinhaDaNota({
  n,
  i,
  jobs,
  partes,
  cor,
  focar,
  acoes,
}: {
  n: Nota;
  i: number;
  jobs: JobDoLote[];
  partes: Record<string, number>;
  cor: (id: string) => string;
  focar: boolean;
  acoes: Acoes;
}) {
  const tot = Object.values(partes).reduce((s, x) => s + x, 0);
  const somaManual = Object.values(n.manual).reduce((s, v) => s + centavos(v), 0);
  const dManual = centavos(n.valor) - somaManual;
  return (
    <tr className="border-t border-border align-top">
      <td className="px-2 py-2.5 pt-4 text-center font-mono text-xs text-muted-foreground">{i + 1}</td>
      <td className="px-3 py-2.5">
        <Input
          value={n.tomador}
          onChange={(e) => acoes.mexer(n.id, { tomador: e.target.value })}
          placeholder="Nome do tomador"
          maxLength={200}
          autoFocus={focar}
          aria-label={`Tomador da nota ${i + 1}`}
          className="h-8 text-[13px]"
        />
        <div className="mt-1.5 flex items-center gap-2">
          {n.exterior ? (
            <div className="flex h-8 flex-1 items-center rounded-lg border border-dashed border-border bg-muted/50 px-3 text-[12px] text-muted-foreground">
              Sem CNPJ
            </div>
          ) : (
            <MaskedInput
              key={`cnpj-${n.id}`}
              mask="cnpj"
              defaultValue={n.cnpj}
              onDigitsChange={(d) => acoes.mexer(n.id, { cnpj: d })}
              aria-label={`CNPJ da nota ${i + 1}`}
              className={cn(
                "h-8 flex-1 font-mono text-[12.5px]",
                n.cnpj.length > 0 && !isValidCnpj(n.cnpj) && "border-california-red",
              )}
            />
          )}
          <label
            className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10.5px] text-muted-foreground"
            title="Tomador no exterior, sem CNPJ"
          >
            <Checkbox
              checked={n.exterior}
              onCheckedChange={(v) => acoes.mexer(n.id, { exterior: v === true })}
              aria-label={`Tomador no exterior, sem CNPJ, na nota ${i + 1}`}
            />
            exterior
          </label>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <MoneyInput
          value={n.valor}
          onValueChange={(v) => acoes.mexer(n.id, { valor: v })}
          aria-label={`Valor da nota ${i + 1}`}
          className="h-8 px-2.5 text-[13px]"
        />
      </td>
      <td className="px-3 py-2.5">
        <Textarea
          rows={3}
          value={n.descritivo}
          onChange={(e) => acoes.mexer(n.id, { descritivo: e.target.value })}
          maxLength={2000}
          placeholder="Opcional — o texto que vai na nota"
          aria-label={`Descritivo da nota ${i + 1}`}
          className="min-h-0 resize-none px-2.5 py-1.5 text-[12px] leading-snug"
        />
      </td>
      <td className="px-3 py-2.5">
        <Select value={n.modo} onValueChange={(v) => v && acoes.mudarModo(n, v)}>
          <SelectTrigger className="h-8 text-[12.5px]" aria-label={`Rateio da nota ${i + 1}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PROPORCIONAL}>{jobs.length > 1 ? "Proporcional" : `Todo no ${jobs[0].codigo}`}</SelectItem>
            {jobs.length > 1 &&
              jobs.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  Só o {j.codigo}
                </SelectItem>
              ))}
            {jobs.length > 1 && <SelectItem value={MANUAL}>Dividir à mão</SelectItem>}
          </SelectContent>
        </Select>
        {/* A nota em cores: quanto dela é de cada job. */}
        <div
          className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted"
          title={Object.entries(partes)
            .map(([jid, v]) => `${jobs.find((j) => j.id === jid)?.codigo}: ${brlc(v)}`)
            .join(" · ")}
        >
          {tot > 0 &&
            jobs.map((j) =>
              partes[j.id] ? <div key={j.id} style={{ width: `${(partes[j.id] / tot) * 100}%`, background: cor(j.id) }} /> : null,
            )}
        </div>
        {n.modo === PROPORCIONAL ? (
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            {jobs.length > 1 ? `Dividida entre os ${jobs.length} jobs, na proporção do valor de cada um.` : "Toda deste job."}
          </p>
        ) : n.modo !== MANUAL ? (
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Toda do {jobs.find((j) => j.id === n.modo)?.codigo}. As outras notas cobrem o resto dos jobs.
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            {jobs.map((j) => (
              <div key={j.id} className="grid grid-cols-[minmax(0,1fr)_104px] items-center gap-1.5">
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] font-semibold">
                  <span className="h-2 w-2 flex-none rounded-full" style={{ background: cor(j.id) }} />
                  <span className="truncate" title={j.codigo}>
                    {j.codigo.replace(/\/\d+$/, "")}
                  </span>
                </span>
                <MoneyInput
                  value={n.manual[j.id] ?? 0}
                  onValueChange={(v) => acoes.mexer(n.id, { manual: { ...n.manual, [j.id]: v } })}
                  aria-label={`${j.codigo} na nota ${i + 1}`}
                  className="h-7 px-2 text-right text-[11.5px]"
                />
              </div>
            ))}
            <p className={cn("text-right text-[10.5px] font-semibold", dManual === 0 ? "text-emerald-700" : "text-california-red")}>
              {dManual === 0 ? "✓ fecha a nota" : dManual > 0 ? `faltam ${brlc(dManual)}` : `passam ${brlc(-dManual)}`}
            </p>
          </div>
        )}
      </td>
      <td className="px-1 py-2.5 pt-3.5 text-center">
        <button
          type="button"
          onClick={() => acoes.remover(n.id)}
          aria-label={`Remover a nota ${i + 1}`}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Copiar as notas de um envio anterior (entrega 3, desenho de 19/10/2026)
// ---------------------------------------------------------------------------

/**
 * Os envios do cliente à esquerda, do mais recente ao mais antigo; à
 * direita, as notas do escolhido e como os valores entram: na mesma
 * proporção do total de agora (padrão quando o total mudou) ou iguais.
 */
function CopiarDeEnvio({
  anteriores,
  cliente,
  total,
  mes,
  mesmosJobs,
  idsDoLote,
  onCopiar,
  onClose,
}: {
  anteriores: EnvioAnterior[];
  cliente: string;
  total: number;
  mes: string | null;
  mesmosJobs: (ev: EnvioAnterior) => boolean;
  idsDoLote: string[];
  onCopiar: (ev: EnvioAnterior, ajustar: boolean) => void;
  onClose: () => void;
}) {
  const [selId, setSelId] = React.useState(anteriores[0]?.id ?? "");
  const [ajustar, setAjustar] = React.useState(true);
  const ev = anteriores.find((x) => x.id === selId) ?? anteriores[0];
  if (!ev) return null;
  const cents = ev.notas.map((n) => centavos(n.valor));
  const totalEv = cents.reduce((a, b) => a + b, 0);
  const difere = totalEv !== total;
  const novos = difere && ajustar ? escalarCentavos(cents, total) : cents;
  const outros = !mesmosJobs(ev);
  const voltam = ev.notas.filter((n) => n.modo === MANUAL || (n.modo !== PROPORCIONAL && !idsDoLote.includes(n.modo))).length;
  const pct = (v: number) => (totalEv > 0 ? ((v / totalEv) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "0");
  const deLa = ev.mes ? nomeDoMes(ev.mes) : "lá";
  const opcao = (ativo: boolean) =>
    cn(
      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
      ativo ? "border-california-red/50 bg-california-red/[0.04]" : "border-border bg-white hover:border-california-red/30",
    );
  const bolinha = (ativo: boolean) => (
    <span
      className={cn(
        "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border",
        ativo ? "border-california-red" : "border-border",
      )}
    >
      {ativo && <span className="h-2 w-2 rounded-full bg-california-red" />}
    </span>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1180px]"
        onOpenAutoFocus={(x) => x.preventDefault()}
      >
        <DialogHeader className="border-b border-border p-6 pr-12">
          <DialogTitle>Copiar as notas de um envio anterior</DialogTitle>
          <DialogDescription>
            Os envios do cliente {cliente}, do mais recente para o mais antigo — de quaisquer jobs. Vêm o tomador, o CNPJ,
            o descritivo e o valor de cada nota; depois você confere e ajusta o que mudou.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
          <div
            className="min-h-0 space-y-2 overflow-y-auto border-r border-border bg-muted/20 p-4"
            role="radiogroup"
            aria-label="Envios anteriores"
          >
            {anteriores.map((x) => {
              const ativo = x.id === ev.id;
              const soma = x.notas.reduce((s, n) => s + centavos(n.valor), 0);
              return (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setSelId(x.id)}
                  className={opcao(ativo)}
                >
                  {bolinha(ativo)}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{tituloDoEnvio(x)}</span>
                      {mesmosJobs(x) && (
                        <span className="whitespace-nowrap rounded-full border border-emerald-600/30 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                          Estes mesmos jobs
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {qtdNotas(x.notas.length)} · <span className="font-mono">{brlc(soma)}</span>
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {x.jobs.map((j) => (
                        <span
                          key={j.id}
                          title={j.nome}
                          className="rounded-full border border-border bg-white px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-california-red"
                        >
                          {j.codigo}
                        </span>
                      ))}
                    </span>
                    <span className="mt-1.5 block text-[11px] text-muted-foreground">
                      Enviado em {diaDoEnvio(x)}
                      {x.por ? ` por ${x.por}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="min-h-0 space-y-4 overflow-y-auto p-5">
            <div className="space-y-2">
              <Label>Valores</Label>
              {difere ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={ajustar}
                    onClick={() => setAjustar(true)}
                    className={opcao(ajustar)}
                  >
                    {bolinha(ajustar)}
                    <span>
                      <span className="block text-[13px] font-semibold">Na mesma proporção, ajustados a {brlc(total)}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Cada nota mantém a sua parte do total: a {ev.notas[0].tomador || "nota 1"} era {pct(cents[0])}% em{" "}
                        {deLa} e continua {pct(cents[0])}%.
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!ajustar}
                    onClick={() => setAjustar(false)}
                    className={opcao(!ajustar)}
                  >
                    {bolinha(!ajustar)}
                    <span>
                      <span className="block text-[13px] font-semibold">
                        Iguais aos {ev.mes ? `de ${deLa}` : "do envio"} ({brlc(totalEv)})
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        A soma fica {totalEv < total ? "abaixo" : "acima"} dos {brlc(total)} deste envio; você ajusta nota
                        a nota.
                      </span>
                    </span>
                  </button>
                </div>
              ) : (
                <p className="rounded-lg border border-emerald-600/25 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
                  ✓ {tituloDoEnvio(ev)} soma {brlc(totalEv)}, o mesmo valor deste envio: os valores vêm iguais.
                </p>
              )}
            </div>
            {mes && ev.mes && ev.mes.slice(0, 7) !== mes.slice(0, 7) && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Nos descritivos, “{nomeDoMes(ev.mes)}” vira “{nomeDoMes(mes)}”.
              </p>
            )}
            {(outros || voltam > 0) && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {outros
                  ? `Os jobs ${deDoEnvio(ev)} não são os mesmos deste envio (${ev.jobs.map((j) => j.codigo).join(", ")}). `
                  : ""}
                {voltam > 0
                  ? voltam === 1
                    ? "1 nota que era de um job de lá, ou dividida à mão, entra em “Proporcional” entre os jobs deste envio."
                    : `${voltam} notas que eram de um job de lá, ou divididas à mão, entram em “Proporcional” entre os jobs deste envio.`
                  : "As notas proporcionais se dividem entre os jobs deste envio."}
              </p>
            )}
            <div className="overflow-hidden rounded-xl border border-border bg-white">
              <table className="w-full table-fixed text-[12.5px]">
                <colgroup>
                  <col className="w-[34px]" />
                  <col />
                  <col className="w-[160px]" />
                  <col className="w-[130px]" />
                  {difere && ajustar && <col className="w-[130px]" />}
                </colgroup>
                <thead className="bg-muted/50">
                  <tr className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2 text-left">Tomador</th>
                    <th className="px-2 py-2 text-left">CNPJ</th>
                    <th className="px-2 py-2 text-right">{ev.mes ? `Em ${nomeDoMes(ev.mes)}` : "No envio"}</th>
                    {difere && ajustar && (
                      <th className="px-2 py-2 text-right">{mes ? `Em ${nomeDoMes(mes)}` : "Agora"}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {ev.notas.map((n, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1.5 text-center font-mono text-[11px] text-muted-foreground">{i + 1}</td>
                      <td className="truncate px-2 py-1.5" title={n.descritivo || undefined}>
                        {n.tomador || "Sem nome"}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11.5px]">
                        {n.exterior ? "exterior" : n.cnpj ? formatCnpj(n.cnpj) : "—"}
                      </td>
                      <td
                        className={cn("px-2 py-1.5 text-right font-mono", difere && ajustar && "text-muted-foreground")}
                      >
                        {brl(n.valor)}
                      </td>
                      {difere && ajustar && (
                        <td className="px-2 py-1.5 text-right font-mono font-semibold">{brlc(novos[i])}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onCopiar(ev, ajustar)}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-california-red-hover"
          >
            <Copy className="h-4 w-4" />
            {ev.notas.length === 1 ? "Copiar a nota" : `Copiar as ${ev.notas.length} notas`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 3. O resumo
// ---------------------------------------------------------------------------

function Resumo(p: {
  dados: DadosDoLote;
  total: number;
  venc: string;
  setVenc: (v: string) => void;
  parcelas: number;
  setParcelas: (n: number) => void;
  cnae: string;
  setCnae: (v: string) => void;
  itensCnae: ComboboxItem[] | null;
  portais: DadosDoLote["portais"];
  portalId: string;
  setPortalId: (v: string) => void;
  onPortalCadastrado: (p: DadosDoLote["portais"][number]) => void;
  observacao: string;
  setObservacao: (v: string) => void;
  contatos: Contato[];
  setContatos: React.Dispatch<React.SetStateAction<Contato[]>>;
}) {
  const nomeMes = p.dados.jobs.find((j) => j.mes)?.mes?.nome ?? null;
  return (
    <aside className="min-h-0 w-[340px] flex-none space-y-6 overflow-y-auto border-l border-border bg-muted/30 p-6">
      <div className="space-y-2">
        <Label>Valor a ser faturado</Label>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5">
          <span className="font-mono text-base font-bold">{brlc(p.total)}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            <Lock className="h-2.5 w-2.5" />
            {nomeMes ? `Do faturamento de ${nomeMes}` : "Do faturamento previsto"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          A soma dos {p.dados.jobs.length} jobs, na empresa {p.dados.empresa.nome}. Já considera as erratas registradas até agora.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vale para todas as notas</p>
        <div className="space-y-1.5">
          <Label>
            Vencimento <span className="text-california-red">*</span>
          </Label>
          <DatePicker
            key={`venc-${p.venc}`}
            name="venc-lote"
            defaultValue={p.venc}
            onDateChange={(d) => p.setVenc(d ? isoLocal(d) : "")}
          />
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Parcelas</span>
            {[1, 2, 3].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => p.setParcelas(k)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  p.parcelas === k
                    ? "border-california-red bg-california-red/10 text-california-red"
                    : "border-border bg-white text-muted-foreground hover:border-california-red/40 hover:text-foreground",
                )}
              >
                {k}×
              </button>
            ))}
          </div>
          {p.parcelas > 1 && p.venc && (
            <p className="text-[11px] text-muted-foreground">
              Cada nota em {p.parcelas} parcelas: {Array.from({ length: p.parcelas }, (_, i) => dataBr(somaDiasIso(p.venc, 30 * i))).join(", ")}.
              Cada parcela leva os jobs na proporção deles na nota.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>
            CNAE sugerido <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Combobox
            items={p.itensCnae ?? []}
            value={p.cnae || null}
            onChange={(v) => p.setCnae(!v || v === CNAE_NENHUM ? "" : v)}
            disabled={p.itensCnae === null}
            placeholder={p.itensCnae === null ? "Carregando…" : "Opcional"}
            buscaPlaceholder="Escreva o código ou a atividade"
            ariaLabel="CNAE sugerido de todas as notas"
            limpavel
            className={cn(COMBOBOX_COMO_SELECT, "font-mono text-[13px]")}
            larguraLista="w-[520px]"
            alinharLista="end"
          />
        </div>
        <CampoPortal
          clienteJobId={p.dados.jobs[0].id}
          portais={p.portais}
          portalId={p.portalId}
          setPortalId={p.setPortalId}
          onCadastrado={p.onPortalCadastrado}
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          Observação <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Textarea
          rows={3}
          value={p.observacao}
          onChange={(e) => p.setObservacao(e.target.value)}
          maxLength={1000}
          placeholder="Algo que o financeiro precisa saber sobre este envio"
          aria-label="Observação do envio"
          className="min-h-0 resize-none text-[13px]"
        />
        <p className="text-[11px] text-muted-foreground">Vai para o financeiro com o envio. Não sai na nota.</p>
      </div>

      <Contatos contatos={p.contatos} setContatos={p.setContatos} n={p.dados.jobs.length} />
    </aside>
  );
}

function CampoPortal({
  clienteJobId,
  portais,
  portalId,
  setPortalId,
  onCadastrado,
}: {
  clienteJobId: string;
  portais: DadosDoLote["portais"];
  portalId: string;
  setPortalId: (v: string) => void;
  onCadastrado: (p: DadosDoLote["portais"][number]) => void;
}) {
  const [cadastrando, setCadastrando] = React.useState(false);
  const [nome, setNome] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const escolhido = portais.find((x) => x.id === portalId);
  const abrir = () => {
    setNome("");
    setUrl("");
    setErro(null);
    setCadastrando(true);
  };
  async function salvar() {
    if (!nome.trim() || !url.trim() || salvando) return;
    setSalvando(true);
    // O portal é do cliente do job — e o lote é de um cliente só.
    const r = await cadastrarPortalDoClienteDoJob(clienteJobId, { nome: nome.trim(), url: url.trim() });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.fieldErrors?.url?.[0] ?? r.fieldErrors?.nome?.[0] ?? r.message);
      return;
    }
    onCadastrado(r.portal);
    setCadastrando(false);
  }
  return (
    <div className="space-y-2">
      <Label>Portal do cliente</Label>
      {portais.length === 0 ? (
        <div className="flex flex-col items-start gap-2.5 rounded-lg border border-dashed border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Este cliente não tem portal cadastrado. Se as notas precisarem ser lançadas em um, cadastre aqui mesmo.
          </p>
          {!cadastrando && (
            <button
              type="button"
              onClick={abrir}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:border-california-red hover:text-california-red"
            >
              <Plus className="h-3 w-3" />
              Cadastrar portal
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select value={portalId} onValueChange={(v) => v && setPortalId(v)}>
              <SelectTrigger aria-label="Portal do cliente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_PORTAL}>Sem portal</SelectItem>
                {portais.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button
            type="button"
            onClick={abrir}
            disabled={cadastrando}
            title="Cadastrar portal"
            aria-label="Cadastrar portal"
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:border-california-red/40 hover:bg-california-red/[0.06] disabled:opacity-50"
          >
            <Plus className="h-[17px] w-[17px]" />
          </button>
        </div>
      )}
      {cadastrando && (
        <div className="space-y-3 rounded-xl border border-california-red/30 bg-california-red/[0.03] p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider">Novo portal deste cliente</p>
            <p className="text-xs text-muted-foreground">
              Fica no cadastro do cliente e vale para os próximos jobs dele. Ao salvar, já entra selecionado aqui.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>
              Nome <span className="text-california-red">*</span>
            </Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoFocus placeholder="Ex.: Coupa, Ariba, Portal NF" aria-label="Nome do portal" />
          </div>
          <div className="space-y-1.5">
            <Label>
              Link <span className="text-california-red">*</span>
            </Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={500}
              placeholder="https://..."
              aria-label="Link do portal"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  salvar();
                }
              }}
            />
          </div>
          {erro && <p className="text-xs text-california-red">{erro}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCadastrando(false)}
              disabled={salvando}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || !nome.trim() || !url.trim()}
              className="rounded-lg bg-california-red px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {salvando ? "Salvando..." : "Salvar e selecionar"}
            </button>
          </div>
        </div>
      )}
      {escolhido && (
        <a
          href={escolhido.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 break-all text-xs text-california-red hover:underline"
        >
          {escolhido.url}
        </a>
      )}
    </div>
  );
}

function Contatos({
  contatos,
  setContatos,
  n,
}: {
  contatos: Contato[];
  setContatos: React.Dispatch<React.SetStateAction<Contato[]>>;
  n: number;
}) {
  const mexer = (id: string, patch: Partial<Contato>) =>
    setContatos((cs) => cs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      <Label>
        Contatos de cobrança <span className="text-california-red">*</span>
      </Label>
      <p className="text-xs text-muted-foreground">
        Recebem as notas. Vieram da abertura dos jobs e passam a valer para {n === 1 ? "o job" : `os ${n} jobs`}.
      </p>
      <div className="space-y-2 pt-1">
        {contatos.map((c) =>
          c.novo ? (
            <div key={c.id} className="space-y-2 rounded-xl border border-california-red/30 bg-california-red/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  Novo
                </span>
                <button
                  type="button"
                  onClick={() => setContatos((cs) => cs.filter((x) => x.id !== c.id))}
                  aria-label="Remover o contato novo"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input value={c.nome} onChange={(e) => mexer(c.id, { nome: e.target.value })} placeholder="Nome *" className="h-9 text-[13px]" />
              <Input value={c.email} onChange={(e) => mexer(c.id, { email: e.target.value })} placeholder="E-mail *" className="h-9 text-[13px]" />
              <Input value={c.numero} onChange={(e) => mexer(c.id, { numero: e.target.value })} placeholder="Telefone (opcional)" className="h-9 text-[13px]" />
            </div>
          ) : (
            <div key={c.id} className="flex items-start gap-2.5 rounded-xl border border-border bg-white px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{c.nome}</span>
                  <span className="inline-flex flex-none items-center whitespace-nowrap rounded-full border border-border bg-white px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Da abertura
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                {c.deJobs.length < n && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Estava só no {c.deJobs.join(", ")}.</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setContatos((cs) => cs.filter((x) => x.id !== c.id))}
                aria-label={`Remover ${c.nome}`}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ),
        )}
        <button
          type="button"
          onClick={() => setContatos((cs) => [...cs, { id: novoId(), nome: "", numero: "", email: "", deJobs: [], novo: true }])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar contato
        </button>
      </div>
    </div>
  );
}
