"use client";

/**
 * O pop-up do envio em lote para faturamento (decisão 188; refeito pela
 * decisão 263 em 16/11/2026 para ficar parecido com o envio de um job).
 *
 * À esquerda, as notas que o cliente pediu. Abre já com a nota 1 (o CNPJ do
 * cliente, o valor dos jobs e o vencimento sugerido), e cada nota é o cartão
 * do envio de um job: CNPJ, valor, vencimento, CNAE, parcelas (1×, 2×, 3×,
 * 6×, Nova parcela) e descritivo. No pé do cartão, os jobs da nota, cada um
 * com uma caixa de marcar, a porcentagem e o valor; "Dividir à mão" abre os
 * campos de valor e de porcentagem ali mesmo. Com várias notas, só a que
 * está em edição fica aberta; as outras viram uma linha com o que falta.
 *
 * À direita, o valor a faturar (com a porcentagem de cada job e o que falta
 * dele nas notas), a PO de cada job, o portal, a observação para o
 * financeiro e os contatos de cobrança.
 *
 * O valor de cada job vem do servidor (`carregarEnvioEmLote`) e é relido no
 * envio; o rateio da tela e o do servidor são a mesma conta
 * (`lib/calculos/envio-em-lote.ts`).
 */

import * as React from "react";
import { AlertCircle, Check, Copy, FileText, Info, Loader2, Lock, Plus, Send, Trash2, X } from "lucide-react";
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
  /** O CNPJ para o qual o nome do tomador vale (o do cliente, ou o do envio copiado). */
  cnpjDoTomador: string;
  /** Decisão 263: o vencimento, as parcelas e o CNAE de cada nota, como no envio de um job. */
  venc: string;
  parcelas: Parcela[] | null;
  parcelasManuais: boolean;
  cnae: string;
  /** Na proporcional, os jobs marcados na linha da nota; nulo = todos. */
  marcados: string[] | null;
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
        className="flex max-h-[97vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1280px]"
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

interface Parcela {
  id: string;
  valor: number;
  data: string;
}

/** Atalhos 1×, 2×, 3× e 6×: partes iguais, vencimentos a cada 30 dias (como no envio de um job). */
function dividirEmParcelas(total: number, k: number, primeira: string): Parcela[] {
  const cents = centavos(total);
  const base = Math.floor(cents / k);
  const sobra = cents - base * k;
  return Array.from({ length: k }, (_, i) => ({
    id: novoId(),
    valor: (i === k - 1 ? base + sobra : base) / 100,
    data: i === 0 ? primeira : somaDiasIso(primeira, 30 * i),
  }));
}

/** O valor da nota mudou: as parcelas dos atalhos se refazem; as escritas à mão ficam. */
function acompanharValor(n: Nota): Nota {
  if (!n.parcelas || n.parcelasManuais) return n;
  const soma = n.parcelas.reduce((s, p) => s + centavos(p.valor), 0);
  if (soma === centavos(n.valor)) return n;
  const novas = dividirEmParcelas(Math.max(0, n.valor), n.parcelas.length, n.parcelas[0].data);
  return { ...n, parcelas: n.parcelas.map((p, i) => ({ ...p, valor: novas[i].valor })) };
}

/** "47,9%": a parte sobre o todo, com uma casa. */
const porcento = (parte: number, todo: number) =>
  todo > 0 ? `${((parte / todo) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—";

const soDigitos = (x: string | null | undefined) => (x ?? "").replace(/\D/g, "");

/** Os jobs marcados de uma nota: todos, alguns (proporcional entre eles), um só ou os da divisão à mão. */
function jobsMarcados(n: Nota, jobs: JobDoLote[]): string[] {
  if (n.modo === MANUAL) return jobs.map((j) => j.id).filter((jid) => centavos(n.manual[jid] ?? 0) > 0);
  if (n.modo === PROPORCIONAL) return n.marcados ?? jobs.map((j) => j.id);
  return [n.modo];
}

/** Na proporcional de alguns jobs, quais; nas outras, nada (vai `undefined`). */
const deAlgunsJobs = (n: Nota) => (n.modo === PROPORCIONAL && n.marcados && n.marcados.length > 0 ? n.marcados : undefined);

const CABECALHO_CNAES =
  "Os CNAEs cadastrados nos CNPJs do grupo. O financeiro escolhe o CNPJ que emite e confirma o CNAE no Faturar.";

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
  const nomeMes = jobs.find((j) => j.mes)?.mes?.nome ?? null;

  const linha = (p: Partial<Nota>): Nota => ({
    id: novoId(),
    tomador: dados.cliente.nome,
    cnpj: dados.cliente.cnpj ?? "",
    cnpjDoTomador: dados.cliente.cnpj ?? "",
    exterior: false,
    valor: 0,
    descritivo: "",
    modo: PROPORCIONAL,
    manual: {},
    marcados: null,
    venc: dados.vencimentoSugerido,
    parcelas: null,
    parcelasManuais: false,
    cnae: "",
    ...p,
  });
  // A: abre como o envio de um job, com a nota 1 já preenchida.
  const [notas, setNotas] = React.useState<Nota[]>(() => [linha({ valor: total / 100 })]);
  const [po, setPo] = React.useState<Record<string, string>>({});
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
  const fimDasNotas = React.useRef<HTMLDivElement>(null);
  const [rolarParaNova, setRolarParaNova] = React.useState(false);
  React.useEffect(() => {
    if (!rolarParaNova) return;
    fimDasNotas.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setRolarParaNova(false);
  }, [rolarParaNova]);

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
                return { value: codigo, label: c.descricao, descricao: codigo, curto: codigo, busca: `${rotuloDoCnae(c)} ${digitos}` };
              }),
            ]
          : [{ value: CNAE_NENHUM, label: "Nenhum" }],
      );
    });
    return () => {
      vivo = false;
    };
  }, []);

  React.useEffect(() => {
    if (portalPendente && portais.some((p) => p.id === portalPendente)) {
      setPortalId(portalPendente);
      setPortalPendente(null);
    }
  }, [portais, portalPendente]);

  const partes = React.useMemo(
    () =>
      ratearNotas(
        notas.map((n) => ({ id: n.id, valor: n.valor, modo: n.modo, manual: n.manual, jobs: deAlgunsJobs(n) })),
        jobs.map((j) => ({ id: j.id, valor: j.valor })),
      ),
    [notas, jobs],
  );
  const noJob = (jid: string) => centavosDoJobNasNotas(partes, jid);
  const somaNotas = notas.reduce((s, n) => s + centavos(n.valor), 0);

  const mexerCom = (id: string, f: (n: Nota) => Nota) =>
    setNotas((ns) => ns.map((n) => (n.id === id ? acompanharValor(f(n)) : n)));
  const mexer = (id: string, patch: Partial<Nota>) => mexerCom(id, (n) => ({ ...n, ...patch }));

  // ---- Copiar de um envio anterior (o mesmo da entrega 3)
  const [copiar, setCopiar] = React.useState(false);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const idsDoLote = React.useMemo(() => jobs.map((j) => j.id), [jobs]);
  const mesmosJobs = (ev: EnvioAnterior) =>
    ev.jobs.length === jobs.length && ev.jobs.every((j) => idsDoLote.includes(j.id));
  function copiarDe(ev: EnvioAnterior, ajustar: boolean) {
    const r = copiarNotas(ev.notas, { jobs: idsDoLote, totalCentavos: total, ajustar, mesDe: ev.mes, mesPara: dados.mes });
    setNotas(
      r.notas.map((n) =>
        linha({
          tomador: n.tomador,
          cnpj: n.exterior ? "" : (n.cnpj ?? ""),
          cnpjDoTomador: n.exterior ? "" : (n.cnpj ?? ""),
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
    if (r.trocouMes && ev.mes && dados.mes) partesDoAviso.push(`troquei “${nomeDoMes(ev.mes)}” por “${nomeDoMes(dados.mes)}” nos descritivos`);
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
    setAviso(`${partesDoAviso.join("; ")}. Confira o vencimento e o CNAE de cada nota antes de enviar.`);
  }

  const acoes: AcoesDaNota = {
    adicionar: () => {
      setNotas((ns) => [
        ...ns,
        linha({
          valor: Math.max(0, total - ns.reduce((s, n) => s + centavos(n.valor), 0)) / 100,
          venc: ns[0] ? (ns[0].parcelas ? ns[0].parcelas[0].data : ns[0].venc) : dados.vencimentoSugerido,
        }),
      ]);
      setRolarParaNova(true);
    },
    remover: (id) => setNotas((ns) => ns.filter((n) => n.id !== id)),
    mexer,
    mudarModo: (n, modo) => {
      if (modo === MANUAL) {
        const atual = partes[n.id] ?? {};
        mexer(n.id, { modo, manual: Object.fromEntries(Object.entries(atual).map(([k, v]) => [k, v / 100])) });
      } else mexer(n.id, { modo, marcados: null });
    },
    // Os jobs da nota, marcados na própria linha.
    marcarJob: (n, jid) => {
      const atuais = jobsMarcados(n, jobs);
      const novos = atuais.includes(jid) ? atuais.filter((x) => x !== jid) : jobs.map((j) => j.id).filter((x) => x === jid || atuais.includes(x));
      if (novos.length === 0) return;
      mexer(n.id, novos.length === 1 ? { modo: novos[0], marcados: null } : { modo: PROPORCIONAL, marcados: novos.length === jobs.length ? null : novos });
    },
    // Escrever o valor (ou a porcentagem) de um job passa a nota para a divisão à mão.
    escreverParte: (n, jid, v) => {
      const base =
        n.modo === MANUAL ? n.manual : Object.fromEntries(jobs.map((j) => [j.id, (partes[n.id]?.[j.id] ?? 0) / 100]));
      if (n.modo !== MANUAL && centavos(v) === centavos(base[jid] ?? 0)) return;
      mexer(n.id, { modo: MANUAL, manual: { ...base, [jid]: v } });
    },
    // Volta à proporção com os mesmos jobs que tinham valor (ficam marcados).
    voltarAProporcao: (n) => {
      const com = jobs.map((j) => j.id).filter((jid) => centavos(n.manual[jid] ?? 0) > 0);
      mexer(
        n.id,
        com.length === 1
          ? { modo: com[0], marcados: null }
          : { modo: PROPORCIONAL, marcados: com.length === 0 || com.length === jobs.length ? null : com },
      );
    },
    parcelas: (id, k) =>
      mexerCom(id, (n) => {
        const prim = (n.parcelas ? n.parcelas[0].data : n.venc) || dados.vencimentoSugerido;
        if (k === 1) return { ...n, parcelas: null, parcelasManuais: false, venc: prim };
        return { ...n, venc: prim, parcelasManuais: false, parcelas: dividirEmParcelas(Math.max(0, n.valor), k, prim) };
      }),
    novaParcela: (id) =>
      mexerCom(id, (n) => {
        const base = n.parcelas ?? [{ id: novoId(), valor: n.valor, data: n.venc }];
        const ultima = base[base.length - 1].data || n.venc;
        return { ...n, parcelasManuais: true, parcelas: [...base, { id: novoId(), valor: 0, data: ultima ? somaDiasIso(ultima, 30) : "" }] };
      }),
    removerParcela: (id, pid) =>
      mexerCom(id, (n) => {
        const restantes = (n.parcelas ?? []).filter((p) => p.id !== pid);
        if (restantes.length <= 1) return { ...n, parcelas: null, parcelasManuais: false, venc: restantes[0]?.data ?? n.venc };
        return { ...n, parcelas: restantes, venc: restantes[0].data };
      }),
    alterarParcela: (id, pid, patch) =>
      mexerCom(id, (n) => {
        const ps = (n.parcelas ?? []).map((p) => (p.id === pid ? { ...p, ...patch } : p));
        return { ...n, parcelas: ps, parcelasManuais: n.parcelasManuais || patch.valor !== undefined, venc: ps[0]?.data ?? n.venc };
      }),
  };

  // ---- o que falta (a régua do envio de um job, nota a nota, mais o rateio)
  const pendencias: string[] = [];
  if (notas.length === 0) pendencias.push("as notas fiscais que o cliente pediu");
  notas.forEach((n, i) => {
    const r = notas.length > 1 ? `nota ${i + 1}` : "nota";
    if (!n.exterior && !isValidCnpj(n.cnpj)) pendencias.push(`o CNPJ da ${r}`);
    if (centavos(n.valor) <= 0) pendencias.push(`o valor da ${r}`);
    if (n.parcelas) {
      if (n.parcelas.some((p) => p.data.length !== 10)) pendencias.push(`o vencimento das parcelas da ${r}`);
      if (n.parcelas.some((p) => centavos(p.valor) <= 0)) pendencias.push(`o valor das parcelas da ${r}`);
      else if (n.parcelas.reduce((s, p) => s + centavos(p.valor), 0) !== centavos(n.valor))
        pendencias.push(`as parcelas da ${r} (a soma não fecha)`);
    } else if (n.venc.length !== 10) pendencias.push(`o vencimento da ${r}`);
    if (n.modo === MANUAL && Object.values(n.manual).reduce((s, v) => s + centavos(v), 0) !== centavos(n.valor))
      pendencias.push(`a divisão à mão da ${r} não fecha`);
  });
  const manualAberto = notas.some(
    (n) => n.modo === MANUAL && Object.values(n.manual).reduce((s, v) => s + centavos(v), 0) !== centavos(n.valor),
  );
  if (notas.length && somaNotas !== total) pendencias.push(`a soma das notas não fecha com o valor total`);
  else if (notas.length && !manualAberto)
    for (const j of jobs) {
      const d = centavos(j.valor) - noJob(j.id);
      if (d > 0) pendencias.push(`faltam ${brlc(d)} do ${j.codigo} nas notas`);
      if (d < 0) pendencias.push(`sobram ${brlc(-d)} no ${j.codigo}`);
    }
  const contatosValidos = contatos.filter((c) => c.nome.trim().length >= 2 && /\S+@\S+\.\S+/.test(c.email.trim()));
  if (contatosValidos.length === 0) pendencias.push("ao menos um contato de cobrança");
  if (contatos.some((c) => c.novo && !contatosValidos.includes(c))) pendencias.push("o nome e o e-mail do contato novo");

  /** O primeiro que falta numa nota (o resumo da nota fechada mostra). */
  const faltaDaNota = (n: Nota): string | null => {
    if (!n.exterior && !isValidCnpj(n.cnpj)) return "o CNPJ";
    if (centavos(n.valor) <= 0) return "o valor";
    if (n.parcelas) {
      if (n.parcelas.some((x) => x.data.length !== 10)) return "o vencimento das parcelas";
      if (n.parcelas.some((x) => centavos(x.valor) <= 0)) return "o valor das parcelas";
      if (n.parcelas.reduce((s2, x) => s2 + centavos(x.valor), 0) !== centavos(n.valor)) return "fechar as parcelas";
    } else if (n.venc.length !== 10) return "o vencimento";
    if (n.modo === MANUAL && Object.values(n.manual).reduce((s2, v) => s2 + centavos(v), 0) !== centavos(n.valor))
      return "fechar a divisão à mão";
    return null;
  };

  const datasDa = (n: Nota) => (n.parcelas ? n.parcelas.map((p) => p.data) : [n.venc]);
  const primeiroVenc = notas.flatMap(datasDa).filter((d) => d.length === 10).sort()[0] ?? "";

  async function enviar() {
    setEnviando(true);
    setErro(null);
    const r = await enviarLoteParaFaturamento({
      jobs: jobs.map((j) => ({ job_id: j.id, numero_po: po[j.id] ?? null })),
      mes: dados.mes,
      // O que valia para todas as notas agora vem em cada uma (abaixo).
      vencimento: primeiroVenc,
      parcelas: 1,
      cnae_sugerido: null,
      portal_id: portalId === SEM_PORTAL ? null : portalId,
      observacao: observacao || null,
      contatos: contatosValidos.map((c) => ({ nome: c.nome.trim(), numero: c.numero.trim() || null, email: c.email.trim() })),
      notas: notas.map((n) => ({
        // A tela só pede o CNPJ, como no envio de um job. O nome do
        // tomador vai quando o sistema o conhece: o do cliente, se o CNPJ é o
        // dele; o do envio copiado, se o CNPJ é o mesmo de lá.
        tomador_nome: n.exterior
          ? n.tomador || null
          : soDigitos(n.cnpj) === soDigitos(n.cnpjDoTomador)
            ? n.tomador || null
            : soDigitos(n.cnpj) === soDigitos(dados.cliente.cnpj)
              ? dados.cliente.nome
              : null,
        cnpj: n.exterior ? null : n.cnpj,
        tomador_exterior: n.exterior,
        valor: n.valor,
        descritivo: n.descritivo || null,
        rateio: n.modo,
        manual: n.modo === MANUAL ? n.manual : undefined,
        jobs_da_nota: deAlgunsJobs(n),
        cnae_sugerido: n.cnae || null,
        parcelas: n.parcelas
          ? n.parcelas.map((p) => ({ valor: p.valor, data_vencimento: p.data }))
          : [{ valor: n.valor, data_vencimento: n.venc }],
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
          Os jobs entram na fila de faturamento do financeiro com estas informações. O valor de cada job vem
          {nomeMes ? ` do faturamento de ${nomeMes} na planilha` : " do faturamento previsto"} e não é editável aqui.
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
          <ForaDoLote itens={dados.foraDoLote} />
          <AreaDasNotas
            notas={notas}
            jobs={jobs}
            partes={partes}
            total={total}
            acoes={acoes}
            itensCnae={itensCnae}
            ultimo={dados.anteriores[0] ?? null}
            onCopiar={() => setCopiar(true)}
            aviso={aviso}
            onFecharAviso={() => setAviso(null)}
            faltaDaNota={faltaDaNota}
          />
          <div ref={fimDasNotas} />
        </div>
        <ResumoDoLote
          dados={dados}
          total={total}
          notas={notas}
          noJob={noJob}
          somaNotas={somaNotas}
          po={po}
          setPo={setPo}
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
              Tudo pronto para enviar.
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
        contentClassName="sm:max-w-[620px]"
        title={
          nomeMes && jobs.every((j) => j.mes)
            ? `Enviar ${nomeMes} de ${qtdJobs(jobs.length)} do cliente ${dados.cliente.nome} para faturamento?`
            : `Enviar ${qtdJobs(jobs.length)} do cliente ${dados.cliente.nome} para faturamento?`
        }
        description={
          <span className="block space-y-3">
            <span className="block">
              Os jobs entram na fila de faturamento do financeiro no valor de <strong>{brlc(total)}</strong>
              {notas.length > 1 ? (
                <>
                  , em <strong>{qtdNotas(notas.length)}</strong>:
                </>
              ) : (
                <>, em uma nota fiscal:</>
              )}
            </span>
            <span className="block max-h-[360px] overflow-y-auto rounded-xl border border-border">
              {notas.map((n, i) => {
                const ks = Object.keys(partes[n.id] ?? {});
                return (
                  <span
                    key={n.id}
                    className={cn("grid grid-cols-[48px_1fr_auto] gap-x-3 px-3.5 py-2 text-foreground", i > 0 && "border-t border-border")}
                  >
                    <span className="pt-px text-xs font-semibold text-muted-foreground">NF {i + 1}</span>
                    <span className="min-w-0 text-[13px]">
                      <span className="block font-mono">{n.exterior ? "Tomador no exterior, sem CNPJ" : formatCnpj(n.cnpj)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {n.parcelas
                          ? `${n.parcelas.length} parcelas, de ${dataBr(n.parcelas[0].data)} a ${dataBr(n.parcelas[n.parcelas.length - 1].data)}`
                          : `vence em ${dataBr(n.venc)}`}
                        {n.cnae ? ` · CNAE ${n.cnae}` : ""}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {ks.length === 1
                          ? `só o ${jobs.find((j) => j.id === ks[0])?.codigo}`
                          : n.modo === MANUAL
                            ? `dividida à mão entre ${ks.length} jobs`
                            : ks.length < jobs.length
                              ? `dividida entre ${ks.map((k) => jobs.find((j) => j.id === k)?.codigo).join(" e ")}`
                              : `dividida entre os ${ks.length} jobs`}
                      </span>
                    </span>
                    <span className="font-mono text-[13px] font-semibold">{brl(n.valor)}</span>
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
              {primeiroVenc ? `O primeiro vencimento é ${dataBr(primeiroVenc)}. ` : ""}
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
// As notas: o título e os botões do envio de um job, a abertura e os cartões
// ---------------------------------------------------------------------------

interface AcoesDaNota {
  adicionar: () => void;
  remover: (id: string) => void;
  mexer: (id: string, patch: Partial<Nota>) => void;
  mudarModo: (n: Nota, modo: string) => void;
  marcarJob: (n: Nota, jobId: string) => void;
  escreverParte: (n: Nota, jobId: string, valor: number) => void;
  voltarAProporcao: (n: Nota) => void;
  parcelas: (id: string, k: number) => void;
  novaParcela: (id: string) => void;
  removerParcela: (id: string, parcelaId: string) => void;
  alterarParcela: (id: string, parcelaId: string, patch: Partial<Parcela>) => void;
}

/** O "Adicionar nota fiscal" do envio de um job. */
const BOTAO_TRACEJADO =
  "inline-flex flex-none items-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red";

// As notas. Envio de muitas notas (já houve de 18): só a nota em edição fica
// aberta, e as outras viram uma linha com o número, o valor, o CNPJ, o
// vencimento, os jobs e o que falta; o clique abre. O descritivo começa com
// uma linha e cresce no foco.

function AreaDasNotas(p: {
  notas: Nota[];
  jobs: JobDoLote[];
  partes: Record<string, Record<string, number>>;
  total: number;
  acoes: AcoesDaNota;
  itensCnae: ComboboxItem[] | null;
  /** O envio mais recente do cliente (o "Copiar do último envio"). */
  ultimo: EnvioAnterior | null;
  onCopiar: () => void;
  aviso: string | null;
  onFecharAviso: () => void;
  faltaDaNota: (n: Nota) => string | null;
}) {
  const [aberta, setAberta] = React.useState<string | null>(p.notas[0]?.id ?? null);
  // A nota que entra abre sozinha: a nova, no "Adicionar"; a primeira, quando
  // entram várias de uma vez (copiar, uma por job).
  const qtd = p.notas.length;
  const qtdAntes = React.useRef(qtd);
  React.useEffect(() => {
    if (qtd > qtdAntes.current) setAberta(qtd - qtdAntes.current === 1 ? p.notas[qtd - 1].id : p.notas[0].id);
    qtdAntes.current = qtd;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtd]);
  const abertaId = p.notas.some((n) => n.id === aberta) ? aberta : (p.notas[0]?.id ?? null);
  const comFalta = p.notas.filter((n) => p.faltaDaNota(n)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">
            Notas fiscais{qtd > 1 ? ` (${qtd})` : ""}
            {qtd > 1 && comFalta > 0 && (
              <span className="ml-2 text-xs font-medium text-california-red">
                {comFalta === 1 ? "1 com pendência" : `${comFalta} com pendência`}
              </span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            Uma nota para cada CNPJ, CNAE ou descritivo diferente. Parcelas são vencimentos da mesma nota.
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {p.ultimo && (
            <button type="button" onClick={p.onCopiar} className={BOTAO_TRACEJADO}>
              <Copy className="h-3.5 w-3.5" />
              Copiar de um envio anterior
            </button>
          )}
          <button type="button" onClick={p.acoes.adicionar} className={BOTAO_TRACEJADO}>
            <Plus className="h-3.5 w-3.5" />
            Adicionar nota fiscal
          </button>
        </div>
      </div>
      {p.aviso && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <Info className="mt-px h-3.5 w-3.5 flex-none" />
          <span className="min-w-0 flex-1">{p.aviso}</span>
          <button
            type="button"
            onClick={p.onFecharAviso}
            aria-label="Fechar o aviso"
            className="flex-none rounded p-0.5 text-sky-700 transition-colors hover:bg-sky-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="space-y-2">
        {p.notas.map((n, i) =>
          qtd > 1 && n.id !== abertaId ? (
            <ResumoDaNota
              key={n.id}
              n={n}
              i={i}
              jobs={p.jobs}
              falta={p.faltaDaNota(n)}
              onAbrir={() => setAberta(n.id)}
            />
          ) : (
            <CartaoNotaDoLote
              key={n.id}
              n={n}
              i={i}
              multi={qtd > 1}
              jobs={p.jobs}
              partes={p.partes[n.id] ?? {}}
              acoes={p.acoes}
              itensCnae={p.itensCnae}
            />
          ),
        )}
      </div>
      {qtd > 1 && (
        <button
          type="button"
          onClick={p.acoes.adicionar}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-white py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar nota fiscal
        </button>
      )}
    </div>
  );
}

/** O nome curto do rateio da nota, para o resumo e o campo do cabeçalho. */
function rateioCurto(n: Nota, jobs: JobDoLote[]): string {
  if (n.modo === MANUAL) return "Dividida à mão";
  if (n.modo === PROPORCIONAL) {
    if (n.marcados && n.marcados.length < jobs.length) return `${n.marcados.length} de ${jobs.length} jobs, na proporção`;
    return jobs.length > 1 ? `Os ${jobs.length} jobs, na proporção` : "Todo deste job";
  }
  return `Só o ${jobs.find((j) => j.id === n.modo)?.codigo ?? "job"}`;
}

/** A nota fechada: uma linha com o que ela é e o que falta; o clique abre. */
function ResumoDaNota({
  n,
  i,
  jobs,
  falta,
  onAbrir,
}: {
  n: Nota;
  i: number;
  jobs: JobDoLote[];
  falta: string | null;
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={n.descritivo || undefined}
      className={cn(
        "grid w-full grid-cols-[22px_96px_128px_148px_120px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border bg-white px-4 py-2.5 text-left transition-colors hover:border-california-red/40 hover:bg-california-red/[0.02]",
        falta ? "border-california-red/40" : "border-border",
      )}
     
    >
      <FileText className="h-4 w-4 text-california-red" />
      <span className="text-[13px] font-semibold">Nota fiscal {i + 1}</span>
      <span className="font-mono text-[13px] font-semibold tabular-nums">{brl(n.valor)}</span>
      <span className="truncate font-mono text-[12px] text-muted-foreground">
        {n.exterior ? "Tomador no exterior" : n.cnpj ? formatCnpj(n.cnpj) : "sem CNPJ"}
      </span>
      <span className="truncate text-[12px] text-muted-foreground">
        {n.parcelas ? `${n.parcelas.length} parcelas` : n.venc ? `vence ${dataBr(n.venc)}` : "sem vencimento"}
      </span>
      <span className="truncate text-[12px] text-muted-foreground">{rateioCurto(n, jobs)}</span>
      {falta ? (
        <span className="whitespace-nowrap text-[11px] font-semibold text-california-red">Falta {falta}</span>
      ) : (
        <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          Pronta
        </span>
      )}
    </button>
  );
}

/** A nota aberta: o cartão do envio de um job, compacto, com os jobs no cabeçalho. */
function CartaoNotaDoLote({
  n,
  i,
  multi,
  jobs,
  partes,
  acoes,
  itensCnae,
}: {
  n: Nota;
  i: number;
  multi: boolean;
  jobs: JobDoLote[];
  partes: Record<string, number>;
  acoes: AcoesDaNota;
  itensCnae: ComboboxItem[] | null;
}) {
  const [cnpjTocado, setCnpjTocado] = React.useState(false);
  const [descritivoFocado, setDescritivoFocado] = React.useState(false);
  const qtdParcelas = n.parcelas ? n.parcelas.length : 1;
  const cnpjErrado = !n.exterior && cnpjTocado && n.cnpj.length > 0 && !isValidCnpj(n.cnpj);
  const somaParcelas = (n.parcelas ?? []).reduce((s, x) => s + x.valor, 0);
  const parcelasFecham = centavos(somaParcelas) === centavos(n.valor);
  const somaManual = Object.values(n.manual).reduce((s, v) => s + centavos(v), 0);
  const dManual = centavos(n.valor) - somaManual;
  const itensDaNota =
    n.cnae && itensCnae && !itensCnae.some((x) => x.value === n.cnae) ? [{ value: n.cnae, label: n.cnae, curto: n.cnae }, ...itensCnae] : (itensCnae ?? []);

  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-california-red" />
          Nota fiscal {i + 1}
          <span className="font-mono text-[13px] font-medium text-muted-foreground">{brl(n.valor)}</span>
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Parcelas</span>
          <div className="flex gap-1">
            {[1, 2, 3, 6].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => acoes.parcelas(n.id, k)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                  qtdParcelas === k
                    ? "border-california-red bg-california-red/10 text-california-red"
                    : "border-border bg-white text-muted-foreground hover:border-california-red/40 hover:text-foreground",
                )}
              >
                {k}×
              </button>
            ))}
          </div>
          {multi && (
            <button
              type="button"
              onClick={() => acoes.remover(n.id)}
              aria-label={`Remover nota ${i + 1}`}
              title={`Remover nota ${i + 1}`}
              className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] items-start gap-3">
          <div className="space-y-1.5">
            <Label>
              CNPJ do cliente <span className="text-california-red">*</span>
            </Label>
            {n.exterior ? (
              <div className="flex h-11 items-center rounded-lg border border-dashed border-border bg-muted/50 px-3 text-[13px] text-muted-foreground">
                Sem CNPJ
              </div>
            ) : (
              <MaskedInput
                key={`cnpj-${n.id}`}
                mask="cnpj"
                defaultValue={n.cnpj}
                onDigitsChange={(d) => acoes.mexer(n.id, { cnpj: d })}
                onBlur={() => setCnpjTocado(true)}
                aria-label={`CNPJ do cliente da nota ${i + 1}`}
                className={cn("font-mono", cnpjErrado && "border-california-red ring-2 ring-california-red/15")}
              />
            )}
            {cnpjErrado && (
              <p className="text-[11px] text-california-red">{n.cnpj.length < 14 ? "Faltam números no CNPJ." : "CNPJ inválido."}</p>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-muted-foreground">
              <Checkbox
                checked={n.exterior}
                onCheckedChange={(v) => acoes.mexer(n.id, { exterior: v === true })}
                aria-label={`Tomador no exterior, sem CNPJ, na nota ${i + 1}`}
              />
              Tomador no exterior, sem CNPJ
            </label>
          </div>

          <div className="space-y-1.5">
            <Label>
              Valor da nota <span className="text-california-red">*</span>
            </Label>
            <MoneyInput value={n.valor} onValueChange={(v) => acoes.mexer(n.id, { valor: v })} aria-label={`Valor da nota ${i + 1}`} />
          </div>

          <div className="space-y-1.5">
            <Label>
              Vencimento <span className="text-california-red">*</span>
            </Label>
            {n.parcelas ? (
              <div className="flex h-11 items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3.5 text-sm text-muted-foreground">
                <span className="truncate">{n.parcelas.length} parcelas</span>
              </div>
            ) : (
              <DatePicker
                key={`venc-${n.id}-${n.venc}`}
                name={`venc-${n.id}`}
                defaultValue={n.venc}
                onDateChange={(d) => acoes.mexer(n.id, { venc: d ? isoLocal(d) : "" })}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>
              CNAE sugerido <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Combobox
              items={itensDaNota}
              value={n.cnae || null}
              onChange={(v) => acoes.mexer(n.id, { cnae: v && v !== CNAE_NENHUM ? v : "" })}
              disabled={itensCnae === null}
              placeholder={itensCnae === null ? "Carregando…" : "Opcional"}
              buscaPlaceholder="Escreva o código ou a atividade"
              ariaLabel={`CNAE sugerido da nota ${i + 1}`}
              limpavel
              className={cn(COMBOBOX_COMO_SELECT, "font-mono text-[13px]")}
              larguraLista="w-[520px]"
              alinharLista="end"
              cabecalhoLista={CABECALHO_CNAES}
            />
          </div>
        </div>

        {n.parcelas && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wider text-foreground">Parcelas desta nota</span> · uma nota só, com
              um vencimento por parcela. Cada job entra em cada parcela na proporção da parte dele na nota.
            </p>
            <div className="max-w-[640px] space-y-2">
              {n.parcelas.map((x, j) => (
                <div key={x.id} className="grid grid-cols-[34px_minmax(0,1fr)_minmax(0,1fr)_32px] items-center gap-2">
                  <span className="text-center font-mono text-xs text-muted-foreground">
                    {j + 1}/{n.parcelas?.length}
                  </span>
                  <MoneyInput
                    value={x.valor}
                    onValueChange={(v) => acoes.alterarParcela(n.id, x.id, { valor: v })}
                    aria-label={`Valor da parcela ${j + 1} da nota ${i + 1}`}
                  />
                  <DatePicker
                    key={`venc-${x.id}-${x.data}`}
                    name={`venc-${x.id}`}
                    defaultValue={x.data}
                    onDateChange={(d) => acoes.alterarParcela(n.id, x.id, { data: d ? isoLocal(d) : "" })}
                  />
                  <button
                    type="button"
                    onClick={() => acoes.removerParcela(n.id, x.id)}
                    aria-label="Remover parcela"
                    className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border/60 pt-2">
                <button
                  type="button"
                  onClick={() => acoes.novaParcela(n.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-white px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-california-red/40 hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                  Nova parcela
                </button>
                <p className={cn("text-xs font-medium", parcelasFecham ? "text-emerald-700" : "text-california-red")}>
                  Soma {brl(somaParcelas)} / {brl(n.valor)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>
              Descritivo da nota fiscal <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <span className="text-[11px] text-muted-foreground">{n.descritivo.length.toLocaleString("pt-BR")} de 2.000 caracteres</span>
          </div>
          <Textarea
            rows={descritivoFocado || n.descritivo.length > 110 ? 3 : 1}
            value={n.descritivo}
            onFocus={() => setDescritivoFocado(true)}
            onBlur={() => setDescritivoFocado(false)}
            onChange={(e) => acoes.mexer(n.id, { descritivo: e.target.value })}
            maxLength={2000}
            aria-label={`Descritivo da nota ${i + 1}`}
            placeholder="Ex.: Serviços de produção referentes à campanha X, conforme PO 4500123456."
            className="min-h-0 resize-none"
          />
        </div>

        {/* A parte de cada job: uma linha no pé do cartão (opções A e B; na C, o quadro embaixo das notas). */}
        {jobs.length > 1 && (
          <LinhaDosJobs n={n} i={i} jobs={jobs} partes={partes} acoes={acoes} />
        )}
      </div>
    </div>
  );
}


/** O texto pequeno de uma ação da linha ("Dividir à mão", "Voltar à proporção"). */
const LINK_DA_LINHA =
  "whitespace-nowrap rounded px-1 text-[11.5px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-california-red";

/** Faltam / passam / fecha, na divisão à mão. */
function FechaANota({ n }: { n: Nota }) {
  const d = centavos(n.valor) - Object.values(n.manual).reduce((s, v) => s + centavos(v), 0);
  return (
    <span className={cn("whitespace-nowrap text-[11px] font-semibold", d === 0 ? "text-emerald-700" : "text-california-red")}>
      {d === 0 ? "✓ fecha a nota" : d > 0 ? `faltam ${brlc(d)}` : `passam ${brlc(-d)}`}
    </span>
  );
}

/**
 * A linha dos jobs no pé do cartão: cada job com uma caixa de marcar, a
 * porcentagem e o valor. Os marcados dividem a nota na proporção do que falta
 * de cada um; um só marcado leva a nota inteira. "Dividir à mão" abre os
 * campos de valor e de porcentagem na mesma linha.
 */
function LinhaDosJobs({
  n,
  i,
  jobs,
  partes,
  acoes,
}: {
  n: Nota;
  i: number;
  jobs: JobDoLote[];
  partes: Record<string, number>;
  acoes: AcoesDaNota;
}) {
  const todo = centavos(n.valor);
  const manual = n.modo === MANUAL;
  const marcados = jobsMarcados(n, jobs);

  // Até 4 jobs numa linha só; de 5 em diante, duas linhas. Cada job numa célula estreita (146 px) de duas linhas: o
  // código e a porcentagem em cima, o valor embaixo — nos campos, a mesma
  // ordem (porcentagem ao lado do código, valor embaixo).
  const aoMudar = (jid: string, x: number) =>
    manual ? acoes.mexer(n.id, { manual: { ...n.manual, [jid]: x } }) : acoes.escreverParte(n, jid, x);
  const colunas = jobs.length <= 4 ? jobs.length : Math.ceil(jobs.length / 2);
  const campos = jobs.map((j) => {
    const v = manual ? (n.manual[j.id] ?? 0) : (partes[j.id] ?? 0) / 100;
    return (
      <span key={j.id} className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-1.5">
          <span className="whitespace-nowrap font-mono text-[12px] font-semibold leading-none">{j.codigo}</span>
          <PorcentoInput
            parte={centavos(v)}
            todo={todo}
            onValor={(x) => aoMudar(j.id, x)}
            ariaLabel={`Porcentagem do ${j.codigo} na nota ${i + 1}`}
            apagado={!manual}
            compacto
          />
        </span>
        <MoneyInput
          value={v}
          onValueChange={(x) => aoMudar(j.id, x)}
          aria-label={`${j.codigo} na nota ${i + 1}`}
          className={cn("h-8 w-full px-2 text-right text-[12.5px]", !manual && "text-muted-foreground")}
        />
      </span>
    );
  });

  return (
    <div className="flex items-start gap-x-3 border-t border-border/60 pt-2.5">
      <span className="pt-px text-[11px] font-semibold uppercase leading-none tracking-wider text-muted-foreground">Jobs</span>
      <div className="grid min-w-0 flex-1 gap-x-3 gap-y-2.5" style={{ gridTemplateColumns: `repeat(${colunas}, 146px)` }}>
        {manual
          ? campos
          : jobs.map((j) => {
              const on = marcados.includes(j.id);
              const unico = on && marcados.length === 1;
              return (
                <label
                  key={j.id}
                  title={unico ? "A nota precisa de pelo menos um job." : undefined}
                  className={cn("flex items-start gap-1.5", unico ? "cursor-default" : "cursor-pointer")}
                >
                  <Checkbox
                    checked={on}
                    disabled={unico}
                    onCheckedChange={() => acoes.marcarJob(n, j.id)}
                    aria-label={`${j.codigo} na nota ${i + 1}`}
                    className={cn("-mt-px", unico && "disabled:opacity-100")}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-1 whitespace-nowrap leading-none">
                      <span className={cn("font-mono text-[12px] font-semibold", !on && "text-muted-foreground")}>{j.codigo}</span>
                      {on && <span className="font-mono text-[11px] font-semibold">{porcento(partes[j.id] ?? 0, todo)}</span>}
                    </span>
                    <span className="font-mono text-[11.5px] leading-none text-muted-foreground">
                      {on ? brlc(partes[j.id] ?? 0) : <span className="font-sans italic">fora desta nota</span>}
                    </span>
                  </span>
                </label>
              );
            })}
      </div>
      <span className="ml-auto flex flex-none flex-col items-end gap-1">
        {manual && <FechaANota n={n} />}
        {manual ? (
          <button type="button" onClick={() => acoes.voltarAProporcao(n)} className={LINK_DA_LINHA}>
            Voltar à proporção
          </button>
        ) : (
          <button type="button" onClick={() => acoes.mudarModo(n, MANUAL)} className={LINK_DA_LINHA}>
            Dividir à mão
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * A parte do job pela porcentagem da nota. Escrever 50 dá metade do valor da nota, no centavo; o valor e a
 * porcentagem andam juntos.
 */
function PorcentoInput({
  parte,
  todo,
  onValor,
  ariaLabel,
  apagado = false,
  compacto = false,
  className,
}: {
  parte: number;
  todo: number;
  onValor: (reais: number) => void;
  ariaLabel: string;
  apagado?: boolean;
  /** Na linha da nota: o campo baixo e estreito, ao lado do código do job. */
  compacto?: boolean;
  className?: string;
}) {
  const fmt = (c: number) => (todo > 0 ? ((c / todo) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "");
  const [texto, setTexto] = React.useState(() => fmt(parte));
  const [foco, setFoco] = React.useState(false);
  React.useEffect(() => {
    if (!foco) setTexto(fmt(parte));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parte, todo, foco]);
  return (
    <span className={cn("relative flex flex-none items-center", className)}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={texto}
        aria-label={ariaLabel}
        onFocus={(e) => {
          setFoco(true);
          e.target.select();
        }}
        onBlur={() => setFoco(false)}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d,.]/g, "").replace(".", ",");
          setTexto(t);
          const x = Number(t.replace(",", "."));
          if (t === "" || !Number.isFinite(x)) return;
          onValor(Math.round((todo * Math.min(100, Math.max(0, x))) / 100) / 100);
        }}
        className={cn(
          "rounded-lg border border-border bg-white text-right font-mono transition-colors hover:border-california-red/40 focus-visible:border-california-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/15",
          compacto ? "h-7 w-[58px] pl-1 pr-3.5 text-[12px]" : "h-8 w-[62px] pl-2 pr-5 text-[12.5px]",
          apagado && !foco && "text-muted-foreground",
        )}
      />
      <span className={cn("pointer-events-none absolute text-[11.5px] text-muted-foreground", compacto ? "right-1" : "right-2")}>%</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// À direita: a coluna do envio de um job (valor, PO, portal, contatos), com os
// jobs do envio junto do valor a faturar
// ---------------------------------------------------------------------------

function ResumoDoLote(p: {
  dados: DadosDoLote;
  total: number;
  notas: Nota[];
  noJob: (id: string) => number;
  somaNotas: number;
  po: Record<string, string>;
  setPo: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  portais: DadosDoLote["portais"];
  portalId: string;
  setPortalId: (v: string) => void;
  onPortalCadastrado: (p: DadosDoLote["portais"][number]) => void;
  observacao: string;
  setObservacao: (v: string) => void;
  contatos: Contato[];
  setContatos: React.Dispatch<React.SetStateAction<Contato[]>>;
}) {
  const jobs = p.dados.jobs;
  const nomeMes = jobs.find((j) => j.mes)?.mes?.nome ?? null;
  const temNotas = p.notas.length > 0;
  const fecha = p.somaNotas === p.total;
  return (
    <aside className="min-h-0 w-[380px] flex-none space-y-6 overflow-y-auto border-l border-border bg-muted/30 p-6">
      <div className="space-y-2.5">
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
            A soma dos {jobs.length} jobs, na empresa {p.dados.empresa.nome}. Já considera as erratas registradas até agora.
          </p>
        </div>
        <div className="space-y-2.5 rounded-xl border border-border bg-white p-3">
          {jobs.map((j) => {
            const v = centavos(j.valor);
            const nas = p.noJob(j.id);
            const ok = nas === v && temNotas;
            return (
              <div key={j.id} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="flex-none font-mono text-[12px] font-semibold text-california-red">{j.codigo}</span>
                    <span className="truncate text-muted-foreground" title={j.nome}>
                      {j.nome}
                    </span>
                  </span>
                  <span className="flex-none font-mono font-semibold">{brlc(v)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    <span className="font-mono font-semibold text-foreground">{porcento(v, p.total)}</span> do total
                  </span>
                  <span
                    className={cn(
                      "flex-none whitespace-nowrap text-[10.5px] font-semibold",
                      ok ? "text-emerald-700" : nas > v ? "text-california-red" : "text-muted-foreground",
                    )}
                  >
                    {!temNotas ? "sem nota" : ok ? "✓ nas notas" : nas > v ? `sobram ${brlc(nas - v)}` : `faltam ${brlc(v - nas)}`}
                  </span>
                </div>
              </div>
            );
          })}
          {temNotas && (
            <div className="border-t border-border pt-2">
              <p className={cn("text-xs font-medium", fecha ? "text-emerald-700" : "text-california-red")}>
                Soma das notas {brlc(p.somaNotas)} / {brlc(p.total)}
              </p>
              {!fecha && (
                <p className="text-[11px] text-california-red">
                  {p.somaNotas < p.total ? `Faltam ${brlc(p.total - p.somaNotas)}.` : `Passam ${brlc(p.somaNotas - p.total)}.`} A soma não fecha.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Número da PO</Label>
        {jobs.map((j) => (
          <div key={j.id} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
            <span className="font-mono text-[12px] font-semibold">{j.codigo.replace(/\/\d+$/, "")}</span>
            <Input
              value={p.po[j.id] ?? ""}
              onChange={(e) => p.setPo((x) => ({ ...x, [j.id]: e.target.value }))}
              placeholder="Opcional"
              maxLength={60}
              aria-label={`Número da PO do ${j.codigo}`}
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Uma PO por job, quando o cliente emite. Nem todo cliente emite PO.</p>
      </div>

      <CampoPortal
        clienteJobId={jobs[0].id}
        portais={p.portais}
        portalId={p.portalId}
        setPortalId={p.setPortalId}
        onCadastrado={p.onPortalCadastrado}
      />

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

      <Contatos contatos={p.contatos} setContatos={p.setContatos} n={jobs.length} />
    </aside>
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
