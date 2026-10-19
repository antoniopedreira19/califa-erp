"use client";

/**
 * O formulário de faturamento da NF (Tela 3.3), redesenhado na decisão 184
 * (protótipo aprovado em 16/10/2026, "C · Drawer que abre a nota"):
 *
 * - `origem` com uma linha  → "Faturar JOB-XXXX"
 * - `origem` com N linhas   → "Faturamento agrupado" (uma NF, vários jobs)
 * - `avulso`                → NF que não consome saldo de faturamento de job
 * - `leitura`               → nota já emitida (`nota-emitida-drawer.tsx`,
 *                             como era antes do redesenho)
 *
 * A nota já foi emitida no portal da prefeitura; aqui ela é registrada —
 * por isso o botão é "Faturar". Sem anexo, é o drawer de sempre; ao anexar
 * o PDF (área de arrastar no fim da seção Nota fiscal), o MESMO conteúdo se
 * alarga e a nota abre à esquerda para conferir. O formulário não é
 * remontado: rolagem e campos ficam onde estavam.
 *
 * Seções na ordem do fluxo: 1 Cliente e job (ou Jobs nesta NF) · 2 Valor e
 * classificação (só a avulsa) · Nota fiscal · Parcelas do recebimento.
 * Empresa (gerencial), regional e cliente vêm do job e não se escolhem; a
 * avulsa pode se referir a um job, ou ser "Sem job" (cliente, empresa e
 * rateio como antes). O CNPJ do tomador é campo nas duas notas, com
 * "Tomador no exterior, sem CNPJ". A competência é o mês da emissão: não é
 * campo.
 *
 * Recebimento antes da NF (decisão 130): o que o cliente já pagou pelas
 * notas (ou pelo BV) desta NF vira a parcela 1, travada e já quitada.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertCircle,
  CheckCircle2,
  CornerDownLeft,
  FileCheck2,
  FileText,
  Layers,
  Lock,
  Paperclip,
  Plus,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { MaskedInput } from "@/components/ui/masked-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PainelDocumento, enderecoParaVisualizar } from "@/components/documentos/painel-documento";
import { cn, formatCnpj, isValidCnpj } from "@/lib/utils";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";
import { repartirEmJobESave, rotuloDaQuebra } from "@/lib/calculos/save-faturamento";
import {
  BotaoInfo,
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";
import type { PlanoContaTipo, PlanoContaSubtipo, RateioLinhaInput } from "@/lib/types";
import { RateioRegionalEditor } from "../contas-a-pagar/rateio-regional-editor";
import { emitirFaturamento, uploadNfPdf } from "./actions";
import type { FaturamentoPendenteRow, FaturadoRow } from "./faturamento-list";
import { chaveDoRecebidoAntes, chaveInfoDoEnvio } from "./chave-info";
import { somaDosRecebidos, type RecebidoAntesDaNf } from "./recebimento-antes-nf-dialog";
import type { AnexoDaPo } from "@/components/envio/anexos-da-po";
import { rotuloMes } from "@/lib/calculos/meses-trimestre";
import { cnaesVigentes, estabelecimentoDoCalculo, feriadosDoCalculo } from "@/lib/fiscal/cadastro";
import { codigoDoCnae, rotuloDoCnae } from "@/lib/fiscal/calculos";
import {
  avisoDaApuracao,
  cnaesQueBatemComASugestao,
  diaDoPisCofins,
  rotuloDoEstabelecimento,
  sugestaoDoCnpj,
  type FiscalDoFaturar,
} from "@/lib/fiscal/faturar";
import { ImpostosDestaNota, ImpostosDestaNotaVazio } from "./impostos-desta-nota";
import { NotaEmitidaDrawer } from "./nota-emitida-drawer";

export type DrawerState =
  | { modo: "origem"; linhas: FaturamentoPendenteRow[] }
  | { modo: "avulso" }
  | { modo: "leitura"; nota: FaturadoRow };

/** O que o botão `i` mostra sobre um job. */
export interface InfoJob {
  po: string | null;
  descricaoNf: string | null;
  contatos: ContatoCobranca[];
  /** Arquivos da PO anexados no envio (decisão 123). */
  anexos: AnexoDaPo[];
}

/**
 * Decisão 184: um job no que o Faturar precisa dele — a nota de job sai na
 * empresa, na regional e para o cliente do job, e a avulsa referente a um
 * job também.
 */
export interface JobDoFaturar {
  id: string;
  codigo: string;
  nome: string;
  /** Encerrado ou finalizado: aparece marcado na lista da avulsa. */
  encerrado: boolean;
  empresa_id: string | null;
  regional_id: string | null;
  cliente_id: string | null;
}

/** Os CNPJs de um cliente: o do cadastro e os já usados em nota ou envio. */
export interface CnpjsDoCliente {
  cadastro: string | null;
  usados: string[];
}

type Parcela = { valor: number; data_vencimento: string };

interface Props {
  state: DrawerState;
  onClose: () => void;
  /**
   * A nota saiu. `mensagem`: a NF, o CNPJ emissor, o valor e o job.
   * `apuracao`: em que Apuração os impostos dela entraram (módulo fiscal);
   * nulo quando o registro fiscal da nota falhou.
   */
  onEmitida: (mensagem: string, apuracao: string | null) => void;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  /** Todas as regionais do tenant. O rateio da avulsa "Sem job" só oferece
   *  as da empresa (decisão 086). */
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  proximoNf: string;
  /** PO, instrução do GP e contatos, por job — o conteúdo do botão `i`. */
  infoPorJob: Record<string, InfoJob>;
  /** O recebido antes da NF que espera a nota, pela chave da linha
   *  (`nota:<id>` ou `bv:<id>`) — decisão 130. */
  recebidosAntes: Record<string, RecebidoAntesDaNf[]>;
  /** Módulo fiscal (02/10/2026): o cadastro de impostos e as sugestões. */
  fiscal: FiscalDoFaturar;
  /** Decisão 184: empresa, regional e cliente de cada job. */
  jobs: JobDoFaturar[];
  /** Decisão 184: os CNPJs de cada cliente, para o CNPJ do tomador. */
  cnpjsPorCliente: Record<string, CnpjsDoCliente>;
}

export function FaturarDrawer(props: Props) {
  if (props.state.modo === "leitura") {
    return (
      <NotaEmitidaDrawer
        nota={props.state.nota}
        onClose={props.onClose}
        empresas={props.empresas}
        infoPorJob={props.infoPorJob}
        fiscal={props.fiscal}
      />
    );
  }
  return <FormularioDeFaturar {...props} state={props.state} />;
}

/** O recebido antes da NF das notas (ou do BV) destas linhas, do mais
 *  antigo para o mais novo. Cada nota conta uma vez. */
function recebidosDasLinhas(
  linhas: FaturamentoPendenteRow[],
  recebidosAntes: Record<string, RecebidoAntesDaNf[]>,
): RecebidoAntesDaNf[] {
  const chaves = new Set(
    linhas
      .map((l) => chaveDoRecebidoAntes(l.envio_nota_id, l.origem_tipo === "bv" ? l.origem_id : null))
      .filter((k): k is string => k !== null),
  );
  return [...chaves].flatMap((k) => recebidosAntes[k] ?? []).sort((a, b) => a.data.localeCompare(b.data));
}

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(iso: string): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

// ---------------------------------------------------------------------------
// Peças de layout
// ---------------------------------------------------------------------------

function Secao({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3.5">
      <div className="flex min-h-[28px] items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-california-red/10 font-mono text-[10.5px] font-bold text-california-red">
          {n}
        </span>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
      </div>
      {children}
    </section>
  );
}

function Campo({
  rotulo,
  obrigatorio,
  ajuda,
  htmlFor,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  ajuda?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={htmlFor}>
        {rotulo} {obrigatorio && <span className="text-california-red">*</span>}
      </Label>
      {children}
      {ajuda && <p className="text-[11.5px] text-muted-foreground text-pretty">{ajuda}</p>}
    </div>
  );
}

/** O que vem do job e não se edita aqui: cliente, empresa, regional. */
function FaixaDoJob({ itens }: { itens: Array<{ rotulo: string; valor: React.ReactNode }> }) {
  return (
    <div
      className="grid gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
    >
      {itens.map((i) => (
        <Tooltip key={i.rotulo}>
          <TooltipTrigger asChild>
            <div className="min-w-0 cursor-default">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <Lock className="h-2.5 w-2.5" />
                {i.rotulo}
              </p>
              <p className="truncate text-[13px] font-medium text-foreground">{i.valor}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent>Vem do job — não se escolhe aqui.</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function Segmentado<T extends string>({
  valor,
  opcoes,
  onChange,
}: {
  valor: T;
  opcoes: Array<[T, string]>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-muted p-0.5">
      {opcoes.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            valor === v ? "bg-white text-california-red shadow-sm" : "text-muted-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O formulário
// ---------------------------------------------------------------------------

function FormularioDeFaturar({
  state,
  onClose,
  onEmitida,
  tipos,
  subtipos,
  empresas,
  clientes,
  regionais,
  proximoNf,
  infoPorJob,
  recebidosAntes,
  fiscal,
  jobs,
  cnpjsPorCliente,
}: Props & { state: Exclude<DrawerState, { modo: "leitura" }> }) {
  const router = useRouter();
  const cad = fiscal.cadastro;

  const avulso = state.modo === "avulso";
  const linhas = state.modo === "origem" ? state.linhas : [];
  const primeira = linhas[0] ?? null;
  // Decisão 188: a nota do envio em lote, quando todas as linhas são dela. É
  // UMA nota pedida pelo cliente, com a parte de cada job: tomador, CNPJ,
  // descritivo e vencimentos vêm dela.
  const loteDaNota =
    primeira?.lote && linhas.every((l) => l.lote?.lote_nota_id === primeira.lote?.lote_nota_id)
      ? primeira.lote
      : null;
  const origemTipo: "job" | "bv" | "avulso" = primeira?.origem_tipo ?? "avulso";
  const ehBv = origemTipo === "bv";

  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<InfoFaturamento | null>(null);

  const jobPorId = React.useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const nomeDaEmpresa = (id: string | null) => empresas.find((e) => e.id === id)?.nome ?? "—";
  const nomeDaRegional = (id: string | null) => regionais.find((r) => r.id === id)?.nome ?? "—";
  const nomeDoCliente = (id: string | null) => clientes.find((c) => c.id === id)?.nome ?? "—";

  // ---- Avulsa: cliente e job ------------------------------------------------
  const [vinculo, setVinculo] = React.useState<"job" | "sem_job">("job");
  const [jobRefId, setJobRefId] = React.useState("");
  const jobRef = avulso && vinculo === "job" ? (jobPorId.get(jobRefId) ?? null) : null;
  const [clienteSemJob, setClienteSemJob] = React.useState("");
  const [empresaSemJob, setEmpresaSemJob] = React.useState("");
  // Rateio de regional da avulsa "Sem job" (decisão 086). Nasce com uma
  // linha em branco, como a despesa sem job: não há de onde sugerir.
  const [rateio, setRateio] = React.useState<RateioLinhaInput[]>([{ regional_id: "", percentual: 100 }]);

  // O job da nota de job (no BV, o job de onde o BV saiu).
  const jobDaOrigem = primeira ? (jobPorId.get(primeira.job_id ?? primeira.origem_id) ?? null) : null;
  const clienteId = avulso
    ? vinculo === "job"
      ? (jobRef?.cliente_id ?? "")
      : clienteSemJob
    : (primeira?.cliente_id ?? "");
  const empresaId = avulso
    ? vinculo === "job"
      ? (jobRef?.empresa_id ?? "")
      : empresaSemJob
    : primeira?.empresa_id || (jobDaOrigem?.empresa_id ?? "");
  const clienteNome = avulso ? (clienteId ? nomeDoCliente(clienteId) : "") : (primeira?.contraparte_nome ?? "");

  const regionaisDaEmpresa = React.useMemo(
    () => regionais.filter((r) => r.empresa_id === empresaSemJob),
    [regionais, empresaSemJob],
  );
  // Trocar a empresa limpa as regionais que não são dela: o banco recusaria.
  React.useEffect(() => {
    setRateio((atual) =>
      atual.map((l) =>
        l.regional_id && !regionaisDaEmpresa.some((r) => r.id === l.regional_id) ? { ...l, regional_id: "" } : l,
      ),
    );
  }, [regionaisDaEmpresa]);

  // ---- CNPJ do tomador (decisão 184) ----------------------------------------
  // Campo nas duas notas: na avulsa nasce com o do cadastro do cliente; na de
  // job, com o do envio. Cliente no exterior: a nota sai para a subsidiária
  // brasileira (outro CNPJ) ou sem CNPJ.
  const cnpjDoEnvio = primeira?.cnpj_tomador ?? "";
  const [cnpjTomador, setCnpjTomador] = React.useState(avulso ? "" : cnpjDoEnvio);
  const [exterior, setExterior] = React.useState(!avulso && (primeira?.tomador_exterior ?? false));
  // O campo tem máscara e guarda o texto dele: trocar o CNPJ por fora (o
  // cliente mudou, ou clicou num CNPJ já usado) remonta o campo.
  const [cnpjVersao, setCnpjVersao] = React.useState(0);
  function usarCnpj(c: string) {
    setCnpjTomador(c);
    setCnpjVersao((v) => v + 1);
  }
  React.useEffect(() => {
    if (avulso) usarCnpj(clienteId ? (cnpjsPorCliente[clienteId]?.cadastro ?? "") : "");
  }, [clienteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cnpjDaNota = exterior ? "" : cnpjTomador;

  // ---- Valor e classificação (avulsa) ---------------------------------------
  const [avValor, setAvValor] = React.useState(0);
  const [avTipoId, setAvTipoId] = React.useState("");
  const [avSubtipoId, setAvSubtipoId] = React.useState("");
  const subtiposDoTipo = avTipoId ? subtipos.filter((s) => s.tipo_id === avTipoId && s.ativo) : [];

  // ---- Jobs nesta NF ----------------------------------------------------------
  // Decisão 123: as linhas são PARCELAS (vencimentos); a nota do envio junta
  // as dela. Uma nota só = o Faturar de uma nota do envio.
  const chaveNota = (l: FaturamentoPendenteRow) => l.envio_nota_id ?? l.envio_parcela_id ?? l.origem_id;
  const umaNotaSo = new Set(linhas.map(chaveNota)).size === 1;
  const [removidos, setRemovidos] = React.useState<Set<string>>(new Set());
  const itensAtivos = linhas.filter((l) => !removidos.has(l.envio_parcela_id ?? l.origem_id));
  const [modoValor, setModoValor] = React.useState<"total" | "parcial">("total");
  const [valores, setValores] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(linhas.map((l) => [l.envio_parcela_id ?? l.origem_id, l.saldo])),
  );
  const notasAtivas = new Set(itensAtivos.map(chaveNota)).size;
  const jobsAtivos = new Set(itensAtivos.map((l) => l.origem_id)).size;
  // Quem mandou cada job ou BV desta nota (decisão 136). Na nota do lote
  // os jobs foram juntos: uma linha só, sem o código.
  const autores = [
    ...new Map(
      linhas
        .filter((l) => l.autor_nome)
        .map((l) => [
          loteDaNota ? `lote:${l.autor_nome}:${l.autor_em}` : `${l.origem_tipo}:${l.codigo ?? l.origem_id}`,
          { codigo: l.codigo, nome: l.autor_nome as string, em: l.autor_em, bv: l.origem_tipo === "bv" },
        ]),
    ).values(),
  ];
  const autorDoDescritivo = linhas.find((l) => l.origem_tipo === "job" && l.autor_nome)?.autor_nome ?? null;

  const totalNf = avulso
    ? avValor
    : itensAtivos.reduce((s, l) => s + (valores[l.envio_parcela_id ?? l.origem_id] ?? 0), 0);
  const saldoTotal = itensAtivos.reduce((s, l) => s + l.saldo, 0);
  const volta = Math.max(saldoTotal - totalNf, 0);
  const diverge = !avulso && volta > 0.01;

  // Recebido antes da NF (decisão 130): vira a parcela 1, travada.
  const recebidosDaNf = avulso ? [] : recebidosDasLinhas(itensAtivos, recebidosAntes);
  const antesTotal = somaDosRecebidos(recebidosDaNf);
  const temAntes = antesTotal > 0;
  const antesData = recebidosDaNf[0]?.data ?? "";
  const restoNf = centavos(totalNf - antesTotal);

  /** O conteúdo do modal `i` para um job desta nota. */
  function montarInfo(
    jobId: string | null,
    referencia: string,
    opcoes: {
      quebra?: { job: number; save: number } | null;
      codigoJob?: string | null;
      ehBv?: boolean;
      descritivoNota?: string | null;
      cnpj?: string | null;
      cnaeSugerido?: string | null;
    } = {},
  ): InfoFaturamento {
    const dados = jobId ? infoPorJob[jobId] : undefined;
    if (opcoes.ehBv) {
      return { referencia, pos: [], descricaoNf: null, contatos: [], quebra: opcoes.quebra ?? null, ehBv: true };
    }
    return {
      referencia,
      pos: [{ job: opcoes.codigoJob ?? "", po: dados?.po ?? null }],
      descricaoNf: opcoes.descritivoNota ?? dados?.descricaoNf ?? null,
      anexosPo: dados?.anexos ?? [],
      cnpj: opcoes.cnpj ?? null,
      cnaeSugerido: opcoes.cnaeSugerido ?? null,
      contatos: dados?.contatos ?? [],
      quebra: opcoes.quebra ?? null,
    };
  }

  // ---- Nota fiscal ------------------------------------------------------------
  const [dataEmissao, setDataEmissao] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const dataDasListas = dataEmissao || format(new Date(), "yyyy-MM-dd");
  // O CNPJ emissor vem pela regra de antes (Hitlab vem com a Hitlab; senão o
  // último usado para o CNPJ do cliente), refeita quando o job ou o cliente
  // da avulsa muda, enquanto ninguém escolheu outro.
  const sugestao = React.useMemo(
    () =>
      sugestaoDoCnpj(
        fiscal,
        empresaId || cnpjDaNota
          ? { cnpj_tomador: cnpjDaNota || null, empresa_id: empresaId, contraparte_nome: clienteNome }
          : null,
      ),
    [fiscal, empresaId, cnpjDaNota, clienteNome],
  );
  const [estabId, setEstabId] = React.useState(sugestao.estabelecimentoId ?? "");
  const [estabTocado, setEstabTocado] = React.useState(false);
  const [numeroNf, setNumeroNf] = React.useState(
    sugestao.estabelecimentoId ? (fiscal.proximaNfPorEstab[sugestao.estabelecimentoId] ?? "") : proximoNf,
  );
  React.useEffect(() => {
    if (estabTocado || !sugestao.estabelecimentoId || sugestao.estabelecimentoId === estabId) return;
    setEstabId(sugestao.estabelecimentoId);
    setNumeroNf(fiscal.proximaNfPorEstab[sugestao.estabelecimentoId] ?? "");
  }, [sugestao.estabelecimentoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Classificação fiscal da nota: o id de um CNAE da lista do CNPJ emissor.
  const [cnaeId, setCnaeId] = React.useState("");
  const estabsAtivos = cad.estabelecimentos.filter((e) => e.ativo);
  const estabEscolhido = estabsAtivos.find((e) => e.id === estabId) ?? null;
  const estabDoCalculo = estabEscolhido ? estabelecimentoDoCalculo(cad, estabEscolhido, dataDasListas) : null;
  const cnaesDoEstab = estabEscolhido ? cnaesVigentes(cad, estabEscolhido.id, dataDasListas) : [];
  const cnaeEscolhido = cnaesDoEstab.find((c) => c.id === cnaeId) ?? null;
  const cnaeSugerido = (() => {
    const s = new Set(linhas.map((l) => l.cnae_sugerido?.trim()).filter((c): c is string => Boolean(c)));
    return s.size === 1 ? [...s][0] : null;
  })();
  // O 82.30-0-01 aparece duas vezes (12.08 e 17.10); o sugerido pelo GP vem
  // marcado, sem vir escolhido (D3, decisão 123).
  const sugeridos = cnaesQueBatemComASugestao(cnaesDoEstab, cnaeSugerido);
  const itensCnae = cnaesDoEstab.map((c) => {
    const marcas = [
      c.cumulativo && estabDoCalculo?.regime === "lucro_real" ? "alíquota reduzida, sem crédito" : null,
      sugeridos.has(c.id) ? "sugerido pelo GP" : null,
    ].filter((m): m is string => m !== null);
    return { value: c.id, label: rotuloDoCnae(c), descricao: marcas.length ? marcas.join(" · ") : undefined };
  });

  // Trocar o CNPJ refaz a sugestão do Nº NF e procura no CNPJ novo o mesmo
  // CNAE (código e subitem); se ele não tiver, o CNAE volta a ser escolhido.
  function trocarCnpj(novo: string) {
    setEstabTocado(true);
    setEstabId(novo);
    setNumeroNf(fiscal.proximaNfPorEstab[novo] ?? "");
    const codigoAtual = cnaeEscolhido ? codigoDoCnae(cnaeEscolhido) : null;
    const mesmo = codigoAtual
      ? cnaesVigentes(cad, novo, dataDasListas).find((c) => codigoDoCnae(c) === codigoAtual)
      : undefined;
    setCnaeId(mesmo?.id ?? "");
    setErro(null);
  }

  const [descricao, setDescricao] = React.useState(() => {
    // A nota do lote vem com o descritivo que a produção escreveu nela.
    if (loteDaNota) return primeira?.descritivo_nota?.trim() ?? "";
    // NF agrupada e avulsa nascem em BRANCO (decisão do Tiago, 31/08/2026).
    if (avulso || !umaNotaSo) return "";
    if (primeira?.descritivo_nota?.trim()) return primeira.descritivo_nota.trim();
    // Job mensal (decisão 078): a instrução é a do MÊS da linha.
    const i = primeira
      ? (infoPorJob[chaveInfoDoEnvio(primeira.origem_id, primeira.mes_referencia)] ?? infoPorJob[primeira.origem_id])
      : undefined;
    return i?.descricaoNf?.trim() || primeira?.descricao || "";
  });

  // ---- Anexo: arrastar ou escolher; anexado, a nota abre ao lado ------------
  const [anexoPath, setAnexoPath] = React.useState<string | null>(null);
  const [anexoNome, setAnexoNome] = React.useState<string | null>(null);
  // O PDF do próprio computador, para abrir ao lado sem ida ao servidor.
  const [anexoUrl, setAnexoUrl] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [arrastando, setArrastando] = React.useState(false);
  // Com a nota aberta ao lado, o botão de ampliar do painel mostra só a nota.
  const [soANota, setSoANota] = React.useState(false);
  const inputArquivo = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    return () => {
      if (anexoUrl) URL.revokeObjectURL(anexoUrl);
    };
  }, [anexoUrl]);

  async function anexar(file: File | undefined) {
    if (!file) return;
    setErro(null);
    if (file.type !== "application/pdf") {
      setErro("Apenas PDF é aceito.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErro("Arquivo maior que 10 MB.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadNfPdf(fd);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAnexoPath(res.path);
      setAnexoNome(file.name);
      setAnexoUrl(URL.createObjectURL(file));
    } finally {
      setUploading(false);
    }
  }
  function tirarAnexo() {
    setAnexoPath(null);
    setAnexoNome(null);
    setAnexoUrl(null);
    setSoANota(false);
  }

  // A nota saiu, mas o registro do CNPJ emissor e do CNAE falhou: o
  // formulário fica aberto com o aviso, e só fecha — faturar de novo
  // duplicaria a nota.
  const [emitidaComAviso, setEmitidaComAviso] = React.useState<{ aviso: string; mensagem: string } | null>(null);
  function fechar() {
    if (emitidaComAviso) onEmitida(emitidaComAviso.mensagem, null);
    else onClose();
  }

  // ---- Parcelas ---------------------------------------------------------------
  // As parcelas que o usuário edita. Com recebido antes da NF, a parcela 1
  // não está aqui: ela é o recebido, travada, e entra na frente.
  const [parcelas, setParcelas] = React.useState<Parcela[]>(() => {
    const antesInicial = somaDosRecebidos(recebidosDasLinhas(linhas, recebidosAntes));
    // A nota do lote (decisão 188): as partes dos jobs vencem juntas — cada
    // data vira uma parcela, com a soma das partes, e o recebido antes
    // abatido em ordem.
    if (loteDaNota) {
      const porData = new Map<string, number>();
      for (const l of linhas) {
        const data = l.data_prevista ?? format(addDays(new Date(), 30), "yyyy-MM-dd");
        porData.set(data, centavos((porData.get(data) ?? 0) + l.saldo));
      }
      let resta = antesInicial;
      return [...porData.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([data, valor]) => {
          const usa = Math.min(valor, resta);
          resta = centavos(resta - usa);
          return { valor: centavos(valor - usa), data_vencimento: data };
        })
        .filter((p) => p.valor > 0.004);
    }
    // Uma nota do envio com vários vencimentos (decisão 123): cada
    // vencimento vira uma parcela, com o recebido antes abatido em ordem.
    if (umaNotaSo && linhas.length > 1) {
      let resta = antesInicial;
      return linhas
        .map((l) => {
          const usa = Math.min(l.saldo, resta);
          resta = centavos(resta - usa);
          return {
            valor: centavos(l.saldo - usa),
            data_vencimento: l.data_prevista ?? format(addDays(new Date(), 30), "yyyy-MM-dd"),
          };
        })
        .filter((p) => p.valor > 0.004);
    }
    const resto = centavos((primeira?.saldo ?? 0) - antesInicial);
    if (antesInicial > 0 && resto <= 0.004) return [];
    return [
      {
        valor: resto,
        data_vencimento: primeira?.data_prevista ?? format(addDays(new Date(), 30), "yyyy-MM-dd"),
      },
    ];
  });
  // Enquanto houver UMA parcela, ela espelha o que falta da nota.
  React.useEffect(() => {
    setParcelas((a) => (a.length === 1 ? [{ ...a[0], valor: Math.max(restoNf, 0) }] : a));
  }, [restoNf]);
  const somaParcelas = antesTotal + parcelas.reduce((s, p) => s + p.valor, 0);
  const somaOk = Math.abs(somaParcelas - totalNf) < 0.01;
  function aplicarParcelamento(n: number) {
    const cents = Math.round(restoNf * 100);
    if (cents <= 0) return;
    const base = Math.floor(cents / n);
    const sobra = cents - base * n;
    setParcelas(
      Array.from({ length: n }, (_, i) => ({
        valor: (i === n - 1 ? base + sobra : base) / 100,
        data_vencimento: format(addDays(new Date(), 30 * (i + 1)), "yyyy-MM-dd"),
      })),
    );
    setErro(null);
  }

  // ---- O que falta --------------------------------------------------------------
  const somaRateio = rateio.reduce((s, l) => s + l.percentual, 0);
  const pendencias: Array<{ rotulo: string; ok: boolean }> = [
    ...(avulso && vinculo === "job" ? [{ rotulo: "Job de referência", ok: Boolean(jobRef) }] : []),
    ...(avulso && vinculo === "sem_job"
      ? [
          { rotulo: "Cliente", ok: Boolean(clienteSemJob) },
          { rotulo: "Empresa (gerencial)", ok: Boolean(empresaSemJob) },
          {
            rotulo: "Rateio de regional",
            ok: rateio.length > 0 && rateio.every((l) => l.regional_id) && Math.abs(somaRateio - 100) < 0.01,
          },
        ]
      : []),
    ...(!ehBv ? [{ rotulo: "CNPJ do tomador", ok: exterior || isValidCnpj(cnpjTomador) }] : []),
    ...(avulso ? [{ rotulo: "Valor da NF", ok: avValor > 0 }] : []),
    ...(avulso ? [{ rotulo: "Centro de custo", ok: Boolean(avTipoId && avSubtipoId) }] : []),
    { rotulo: "CNPJ emissor", ok: Boolean(estabEscolhido) },
    { rotulo: "Nº NF", ok: Boolean(numeroNf.trim()) },
    { rotulo: "Emissão", ok: Boolean(dataEmissao) },
    { rotulo: "CNAE", ok: Boolean(cnaeEscolhido) },
    { rotulo: "Descrição da NF", ok: descricao.trim().length >= 3 },
    { rotulo: "Anexo da NF (PDF)", ok: Boolean(anexoPath) },
    { rotulo: "Parcelas da NF", ok: totalNf > 0 && somaOk && parcelas.every((p) => p.valor > 0) },
  ];

  function handleFaturar() {
    setErro(null);
    if (emitidaComAviso) return;

    const faltando = pendencias.filter((p) => !p.ok);
    if (faltando.length > 0) {
      setErro(`Falta preencher: ${faltando.map((p) => p.rotulo).join(", ")}.`);
      return;
    }
    if (avulso && vinculo === "job" && jobRef && !jobRef.regional_id) {
      setErro(`O ${jobRef.codigo} não tem regional: escolha "Sem job" e faça o rateio.`);
      return;
    }
    if (!avulso) {
      const excedidos = itensAtivos.filter((l) => (valores[l.envio_parcela_id ?? l.origem_id] ?? 0) > l.saldo + 0.01);
      if (excedidos.length > 0) {
        setErro(
          `${excedidos.map((l) => l.codigo ?? l.descricao).join(", ")}: o valor a ` +
            "faturar não pode ser maior que o saldo a faturar do job.",
        );
        return;
      }
    }
    if (temAntes && antesTotal > totalNf + 0.004) {
      setErro(
        `O recebido antes da NF (${formatMoney(antesTotal)}) passa do valor desta ` +
          `nota (${formatMoney(totalNf)}). Fature ao menos o que já foi recebido.`,
      );
      return;
    }
    if (!estabEscolhido || !cnaeEscolhido || !anexoPath) return;

    const itens = avulso
      ? [{ origem_tipo: "avulso" as const, origem_id: null, envio_parcela_id: null, valor: totalNf }]
      : itensAtivos.flatMap((l) => {
          const valor = valores[l.envio_parcela_id ?? l.origem_id] ?? 0;
          // A parcela do envio vale o faturamento previsto inteiro, save
          // incluído — e na nota isso sai em DOIS itens (decisão 028). Job
          // primeiro: o save só começa depois que a parte do job está coberta.
          const parte = repartirEmJobESave(valor, l.saldo_proprio);
          const itensDaLinha: Array<{
            origem_tipo: "job" | "bv" | "save";
            origem_id: string | null;
            envio_parcela_id: string | null;
            valor: number;
          }> = [];
          if (parte.job > 0.004) {
            itensDaLinha.push({
              origem_tipo: l.origem_tipo,
              origem_id: l.origem_id,
              envio_parcela_id: l.envio_parcela_id,
              valor: parte.job,
            });
          }
          if (parte.save > 0.004) {
            itensDaLinha.push({
              origem_tipo: "save",
              origem_id: l.origem_id,
              envio_parcela_id: l.envio_parcela_id,
              valor: parte.save,
            });
          }
          return itensDaLinha;
        });

    // A avulsa referente a um job fica 100% na regional dele (decisão 184).
    const rateioDaNota = !avulso
      ? []
      : jobRef
        ? [{ regional_id: jobRef.regional_id as string, percentual: 100 }]
        : rateio;

    startTransition(async () => {
      const res = await emitirFaturamento({
        empresa_id: empresaId,
        origem_tipo: avulso ? "avulso" : origemTipo,
        origem_id: avulso ? null : (itensAtivos[0]?.origem_id ?? null),
        cliente_id: avulso ? clienteId : ehBv ? null : (primeira?.cliente_id ?? null),
        fornecedor_id: ehBv ? (primeira?.fornecedor_id ?? null) : null,
        numero_nf: numeroNf.trim(),
        data_emissao: dataEmissao,
        valor_total: totalNf,
        descricao: descricao.trim(),
        // O texto da nota continua gravado ("82.30-0-01 · 12.08"), tirado do
        // CNAE da lista; CNPJ emissor e id do CNAE se registram logo depois.
        cnae: codigoDoCnae(cnaeEscolhido),
        estabelecimento_id: estabEscolhido.id,
        fiscal_cnae_id: cnaeEscolhido.id,
        anexo_nf_path: anexoPath,
        plano_conta_tipo_id: avulso ? avTipoId : null,
        plano_conta_subtipo_id: avulso ? avSubtipoId : null,
        rateio: rateioDaNota,
        itens,
        // A parcela 1 é o recebido antes da NF, quando houver.
        parcelas: [...(temAntes ? [{ valor: antesTotal, data_vencimento: antesData }] : []), ...parcelas].map(
          (p, i) => ({ numero: i + 1, valor: p.valor, data_vencimento: p.data_vencimento }),
        ),
        cnpj_tomador: ehBv || exterior ? null : cnpjTomador,
        tomador_exterior: !ehBv && exterior,
        job_referencia_id: jobRef?.id ?? null,
      });

      if (!res.ok) {
        setErro(res.message);
        return;
      }

      const parciais = itensAtivos.filter((l) => (valores[l.envio_parcela_id ?? l.origem_id] ?? 0) < l.saldo - 0.01);
      const detalhe = avulso
        ? ` · avulso para ${clienteNome}${jobRef ? ` · ${jobRef.codigo}` : ""}`
        : jobsAtivos > 1
          ? ` cobrindo ${jobsAtivos} jobs de ${primeira?.contraparte_nome}`
          : ` · ${primeira?.codigo ?? ""}`;
      const sobra = parciais.length > 0 ? ` · ${parciais.length} saldo(s) remanescente(s) de volta em Faturamento` : "";
      const resumo = `${formatMoney(totalNf)}${detalhe}${sobra}`;
      router.refresh();
      if (res.avisoFiscal) {
        setEmitidaComAviso({ aviso: res.avisoFiscal, mensagem: `NF ${numeroNf.trim()} faturada · ${resumo}` });
        return;
      }
      onEmitida(
        `NF ${numeroNf.trim()} faturada · ${estabEscolhido.nome} · ${resumo}`,
        res.apuracao && estabDoCalculo
          ? avisoDaApuracao({
              emissao: dataEmissao,
              presumido: estabDoCalculo.regime === "lucro_presumido",
              apuracao: res.apuracao,
            })
          : null,
      );
    });
  }

  // ---- Textos -----------------------------------------------------------------
  const titulo = avulso
    ? "Faturamento avulso"
    : loteDaNota
      ? loteDaNota.total > 1
        ? `Faturar a nota ${loteDaNota.ordem} de ${loteDaNota.total} do lote`
        : "Faturar a nota do lote"
      : notasAtivas > 1
        ? "Faturamento agrupado"
        : `Faturar ${primeira?.codigo ?? primeira?.descricao ?? ""}`;
  const subtitulo = avulso
    ? "Nota fiscal que não consome saldo de faturamento de job."
    : loteDaNota
      ? "A nota que a produção montou no envio em lote, com a parte de cada job; o valor por job pode ser total ou parcial."
      : "Uma única nota fiscal; o valor por job pode ser total ou parcial.";
  const rodape = avulso
    ? `Ao faturar, as parcelas desta NF entram em Títulos a Receber como faturamento avulso${
        jobRef ? `, sem consumir o saldo do ${jobRef.codigo}` : ", sem consumir saldo de nenhum job"
      }.`
    : `Ao faturar, cada job recebe a baixa do valor faturado — o que sobrar do saldo permanece aguardando faturamento — e as parcelas entram em Títulos a Receber vinculadas à mesma nota.${
        temAntes
          ? recebidosDaNf.length === 1
            ? ` A parcela 1 já entra recebida, com a data de ${formatarData(antesData)}; nada entra de novo na conta.`
            : " A parcela 1 já entra recebida, com uma baixa para cada recebimento; nada entra de novo na conta."
          : ""
      }`;

  // ---------------------------------------------------------------------------
  // Blocos
  // ---------------------------------------------------------------------------

  const conhecidos = avulso && clienteId ? (cnpjsPorCliente[clienteId]?.usados ?? []) : [];
  const campoCnpjTomador = (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Label htmlFor="cnpj-tomador">
          CNPJ do tomador <span className="text-california-red">*</span>
        </Label>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
          <Checkbox
            id="tomador-exterior"
            checked={exterior}
            onCheckedChange={(v) => {
              setExterior(v === true);
              setErro(null);
            }}
          />
          Tomador no exterior, sem CNPJ
        </label>
      </div>
      {exterior ? (
        <div className="flex h-11 items-center rounded-lg border border-dashed border-border bg-muted/50 px-3 text-[13px] text-muted-foreground">
          A nota sai sem CNPJ do tomador.
        </div>
      ) : (
        <MaskedInput
          id="cnpj-tomador"
          key={`${clienteId}-${cnpjVersao}`}
          mask="cnpj"
          defaultValue={cnpjTomador}
          onDigitsChange={(d) => setCnpjTomador(d)}
          className={cn("font-mono", cnpjTomador && !isValidCnpj(cnpjTomador) && "border-california-red")}
        />
      )}
      {!exterior && (
        <p className="text-[11.5px] text-muted-foreground text-pretty">
          {avulso ? (
            conhecidos.length > 1 ? (
              <>
                Já usados:{" "}
                {conhecidos.map((c, i) => (
                  <React.Fragment key={c}>
                    {i > 0 && " · "}
                    <button
                      type="button"
                      onClick={() => usarCnpj(c)}
                      className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-california-red"
                    >
                      {formatCnpj(c)}
                    </button>
                  </React.Fragment>
                ))}
              </>
            ) : (
              "Vem do cadastro do cliente. Troque se a nota sai para uma filial ou subsidiária."
            )
          ) : cnpjDoEnvio && cnpjTomador && cnpjTomador !== cnpjDoEnvio ? (
            <span className="font-medium text-amber-800">
              Diferente do CNPJ do envio ({formatCnpj(cnpjDoEnvio)}).{" "}
              <button
                type="button"
                onClick={() => usarCnpj(cnpjDoEnvio)}
                className="underline underline-offset-2 hover:text-california-red"
              >
                Voltar ao do envio
              </button>
            </span>
          ) : loteDaNota ? (
            <>
              Tomador: <strong className="font-semibold text-foreground">{loteDaNota.tomador_nome}</strong> · veio do envio
              em lote{autorDoDescritivo ? ` de ${autorDoDescritivo}` : ""}.
            </>
          ) : (
            `Veio do envio${autorDoDescritivo ? ` de ${autorDoDescritivo}` : ""}. Troque se a nota sai para outra empresa do cliente.`
          )}
        </p>
      )}
    </div>
  );

  const blocoClienteEJob = avulso ? (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmentado<"job" | "sem_job">
          valor={vinculo}
          opcoes={[
            ["job", "Referente a um job"],
            ["sem_job", "Sem job"],
          ]}
          onChange={(v) => {
            setVinculo(v);
            setErro(null);
          }}
        />
        <span className="text-[11.5px] text-muted-foreground">
          {vinculo === "job" ? "Cliente, empresa e regional vêm do job." : "Receita que não é de job."}
        </span>
      </div>

      {vinculo === "job" ? (
        <>
          <Campo rotulo="Job" obrigatorio>
            <Combobox
              items={jobs.map((j) => ({
                value: j.id,
                label: `${j.codigo} · ${j.nome}`,
                descricao: `${nomeDoCliente(j.cliente_id)} · ${nomeDaEmpresa(j.empresa_id)} · ${nomeDaRegional(j.regional_id)}${
                  j.encerrado ? " · encerrado" : ""
                }`,
                busca: `${j.codigo} ${j.nome} ${nomeDoCliente(j.cliente_id)}`,
              }))}
              value={jobRefId || null}
              onChange={(v) => {
                setJobRefId(v ?? "");
                setErro(null);
              }}
              placeholder="Selecione o job a que a nota se refere"
              buscaPlaceholder="Escreva o código, o nome ou o cliente"
              className={COMBOBOX_COMO_SELECT}
            />
          </Campo>
          {jobRef && (
            <FaixaDoJob
              itens={[
                { rotulo: "Cliente", valor: nomeDoCliente(jobRef.cliente_id) },
                { rotulo: "Empresa (gerencial)", valor: nomeDaEmpresa(jobRef.empresa_id) },
                { rotulo: "Regional", valor: nomeDaRegional(jobRef.regional_id) },
              ]}
            />
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3.5">
            <Campo rotulo="Cliente" obrigatorio>
              <Combobox
                items={clientes.map((c) => ({ value: c.id, label: c.nome }))}
                value={clienteSemJob || null}
                onChange={(v) => setClienteSemJob(v ?? "")}
                placeholder="Selecione o cliente"
                buscaPlaceholder="Escreva o nome do cliente"
                className={COMBOBOX_COMO_SELECT}
              />
            </Campo>
            <Campo rotulo="Empresa (gerencial)" obrigatorio>
              <Select value={empresaSemJob} onValueChange={setEmpresaSemJob}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          </div>
          {empresaSemJob ? (
            <RateioRegionalEditor linhas={rateio} onChange={setRateio} regionais={regionaisDaEmpresa} disabled={pending} />
          ) : (
            <div className="space-y-1.5">
              <Label>
                Rateio de regional <span className="text-california-red">*</span>
              </Label>
              <p className="rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2.5 text-[12.5px] text-muted-foreground">
                Escolha a empresa (gerencial) para ver as regionais dela.
              </p>
            </div>
          )}
        </>
      )}

      {clienteId && campoCnpjTomador}
    </div>
  ) : (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto">
          <Segmentado<"total" | "parcial">
            valor={modoValor}
            opcoes={[
              ["total", "Valor integral"],
              ["parcial", "Faturamento parcial"],
            ]}
            onChange={(m) => {
              setModoValor(m);
              setErro(null);
              if (m === "total") {
                setValores(Object.fromEntries(linhas.map((l) => [l.envio_parcela_id ?? l.origem_id, l.saldo])));
              }
            }}
          />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        {itensAtivos.map((l, idx) => {
          const k = l.envio_parcela_id ?? l.origem_id;
          const valor = valores[k] ?? 0;
          const excede = valor > l.saldo + 0.01;
          const parcial = !excede && valor > 0 && valor < l.saldo - 0.01;
          // A parcela pode carregar saldo em save, e aí a nota sai com dois
          // itens. Quem fatura precisa ver isso antes (decisão 028).
          const quebra = repartirEmJobESave(valor, l.saldo_proprio);
          const rotuloQuebra = rotuloDaQuebra(quebra);
          return (
            <div key={k} className={cn("flex items-center gap-3 px-3.5 py-3", idx > 0 && "border-t border-border")}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-semibold">{l.descricao}</span>
                  {parcial && (
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-800">
                      Parcial
                    </span>
                  )}
                  {rotuloQuebra && (
                    <span className="shrink-0 rounded-full border border-[#c9c6bf] bg-[#f3f2ee] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#5f5d57]">
                      Save
                    </span>
                  )}
                </div>
                {rotuloQuebra && (
                  <span className="text-[11px] text-[#5f5d57]">
                    {quebra.job > 0.004 ? (
                      <>
                        {formatMoney(quebra.job)} do job · <strong>{formatMoney(quebra.save)}</strong> em saldo de save
                      </>
                    ) : (
                      <>
                        <strong>{formatMoney(quebra.save)}</strong> inteiros em saldo de save
                      </>
                    )}
                  </span>
                )}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {l.codigo}
                  {/* Na nota do lote a numeração da nota do job confunde: a
                      nota é a do lote, que está no título. */}
                  {!loteDaNota && l.nota_ordem && l.nota_total ? ` · NF ${l.nota_ordem}/${l.nota_total}` : ""}
                  {l.data_prevista ? ` · vence ${formatarData(l.data_prevista)}` : ""} · valor {formatMoney(l.saldo)}
                </span>
                {parcial && (
                  <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold text-blue-700">
                    <CornerDownLeft className="h-3 w-3" />
                    {formatMoney(l.saldo - valor)} volta para a aba Faturamento
                  </span>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {modoValor === "parcial" ? (
                  <>
                    <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                      Faturar agora
                    </span>
                    <div className="w-[148px]">
                      <MoneyInput
                        value={valor}
                        onValueChange={(v) => {
                          setValores((a) => ({ ...a, [k]: v }));
                          setErro(null);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setValores((a) => ({ ...a, [k]: Math.round(l.saldo * 50) / 100 }));
                        setErro(null);
                      }}
                      className="rounded-md border border-border bg-white px-2 py-1 text-[10.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-foreground"
                    >
                      50% do valor
                    </button>
                  </>
                ) : (
                  <span className="whitespace-nowrap font-mono text-sm font-bold">{formatMoney(l.saldo)}</span>
                )}
              </div>
              <BotaoInfo
                className="shrink-0"
                onClick={() =>
                  setInfo(
                    montarInfo(
                      // Job mensal (decisão 078): a PO e a instrução são as do mês da linha.
                      l.job_id ? chaveInfoDoEnvio(l.job_id, l.mes_referencia) : null,
                      `${l.codigo ?? l.descricao}${l.mes_referencia ? ` · ${rotuloMes(l.mes_referencia)}` : ""}${
                        l.nota_ordem && l.nota_total ? ` · NF ${l.nota_ordem}/${l.nota_total}` : ""
                      }`,
                      {
                        quebra: quebra.save > 0.004 ? quebra : null,
                        codigoJob: l.codigo,
                        ehBv: l.origem_tipo === "bv",
                        descritivoNota: l.descritivo_nota,
                        cnpj: l.cnpj_tomador,
                        cnaeSugerido: l.cnae_sugerido,
                      },
                    ),
                  )
                }
              />
              <button
                type="button"
                title="Remover job desta NF"
                disabled={itensAtivos.length === 1}
                onClick={() => setRemovidos((s) => new Set(s).add(k))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:text-california-red disabled:opacity-30 disabled:hover:text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-3.5 py-3">
          <span className="text-xs font-semibold text-muted-foreground">Valor total da NF</span>
          <span className="ml-auto font-mono text-[17px] font-bold tabular-nums">{formatMoney(totalNf)}</span>
        </div>
      </div>
      {diverge && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Faturando {formatMoney(totalNf)} de {formatMoney(saldoTotal)} — o saldo remanescente de{" "}
            <strong className="font-bold">{formatMoney(volta)}</strong> volta para a aba{" "}
            <strong className="font-bold">Faturamento</strong> e pode ser faturado depois em outra NF.
          </span>
        </div>
      )}
      <FaixaDoJob
        itens={[
          { rotulo: ehBv ? "Fornecedor" : "Cliente", valor: primeira?.contraparte_nome ?? "—" },
          { rotulo: "Empresa (gerencial)", valor: nomeDaEmpresa(empresaId || null) },
          { rotulo: "Regional", valor: nomeDaRegional(jobDaOrigem?.regional_id ?? null) },
        ]}
      />
      {!ehBv && campoCnpjTomador}
    </div>
  );

  const blocoValor = avulso ? (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] gap-3.5">
      <Campo rotulo="Valor total da NF" obrigatorio htmlFor="av-valor">
        <MoneyInput
          id="av-valor"
          value={avValor}
          onValueChange={(v) => {
            setAvValor(v);
            setErro(null);
          }}
        />
      </Campo>
      <Campo rotulo="Centro de custo" obrigatorio>
        <div className="grid grid-cols-2 gap-2">
          <Combobox
            items={tipos.filter((t) => t.ativo).map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nome}` }))}
            value={avTipoId || null}
            onChange={(v) => {
              const novo = v ?? "";
              setAvTipoId(novo);
              setAvSubtipoId((atual) => (subtipos.find((s) => s.id === atual)?.tipo_id === novo ? atual : ""));
            }}
            placeholder="Tipo..."
            buscaPlaceholder="Escreva o código ou o nome"
            className={COMBOBOX_COMO_SELECT}
          />
          <Combobox
            items={subtiposDoTipo.map((s) => ({ value: s.id, label: s.nome }))}
            value={avSubtipoId || null}
            onChange={(v) => setAvSubtipoId(v ?? "")}
            disabled={!avTipoId}
            placeholder={avTipoId ? "Subtipo..." : "Escolha o tipo"}
            buscaPlaceholder="Escreva o nome do subtipo"
            className={COMBOBOX_COMO_SELECT}
          />
        </div>
      </Campo>
    </div>
  ) : null;

  const blocoNota = (
    <div className="space-y-3.5">
      <Campo rotulo="CNPJ emissor" obrigatorio ajuda={!estabTocado ? sugestao.ajuda : null}>
        <Select
          value={estabEscolhido?.id ?? ""}
          // O Radix devolve "" quando o valor e a opção se desencontram: não
          // é escolha, e apagaria o Nº NF sugerido.
          onValueChange={(v) => {
            if (v) trocarCnpj(v);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o CNPJ que emite a nota" />
          </SelectTrigger>
          <SelectContent>
            {estabsAtivos.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {rotuloDoEstabelecimento(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>
      <div className="grid grid-cols-2 gap-3.5">
        <Campo rotulo="Nº NF" obrigatorio htmlFor="numero-nf" ajuda="Numeração de cada CNPJ.">
          <Input
            id="numero-nf"
            value={numeroNf}
            onChange={(e) => setNumeroNf(e.target.value)}
            placeholder="Ex: 12345"
            className="font-mono"
          />
        </Campo>
        <Campo rotulo="Emissão" obrigatorio>
          <DatePicker
            name="data_emissao"
            defaultValue={dataEmissao}
            onDateChange={(d) => setDataEmissao(d ? format(d, "yyyy-MM-dd") : "")}
          />
        </Campo>
      </div>
      <Campo
        rotulo="CNAE a ser utilizado"
        obrigatorio
        htmlFor="cnae-nf"
        ajuda={
          estabEscolhido && cnaeSugerido && sugeridos.size === 0 ? (
            <span className="font-medium text-amber-800">O CNAE sugerido não está cadastrado neste CNPJ.</span>
          ) : null
        }
      >
        <Combobox
          id="cnae-nf"
          items={itensCnae}
          value={cnaeEscolhido?.id ?? null}
          onChange={(v) => {
            setCnaeId(v ?? "");
            setErro(null);
          }}
          disabled={!estabEscolhido}
          // D3 (decisão 123): a sugestão do GP vem de FUNDO, sem preencher.
          placeholder={
            !estabEscolhido
              ? "Escolha o CNPJ emissor primeiro"
              : cnaeSugerido
                ? `Sugerido pelo GP: ${cnaeSugerido}`
                : "Selecione o CNAE"
          }
          buscaPlaceholder="Escreva o código ou a atividade"
          className={COMBOBOX_COMO_SELECT}
        />
      </Campo>
      <Campo
        rotulo="Descrição da NF"
        obrigatorio
        htmlFor="descricao-nf"
        ajuda={
          avulso
            ? null
            : loteDaNota
              ? primeira?.descritivo_nota?.trim()
                ? `Vem do descritivo que ${autorDoDescritivo ?? "o gerente de projetos"} escreveu nesta nota do lote.`
                : "O envio em lote não trouxe descritivo para esta nota."
              : !umaNotaSo
                ? "Cada job traz a instrução do seu gerente de projetos — leia uma a uma no botão de informações da linha."
                : `Vem do descritivo que ${autorDoDescritivo ?? "o gerente de projetos"} mandou no envio.`
        }
      >
        <textarea
          id="descricao-nf"
          rows={2}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={2000}
          placeholder="Ex: Serviços prestados em agosto/2026"
          className="w-full resize-none rounded-lg border border-border px-3 py-2.5 text-[13px] focus:border-california-red/40 focus:outline-none"
        />
      </Campo>
    </div>
  );

  // Os impostos que esta nota gera, só leitura. Aparecem com CNPJ, CNAE,
  // valor e data preenchidos; antes disso, a caixa que diz onde vão estar.
  const blocoImpostos =
    estabEscolhido && estabDoCalculo && cnaeEscolhido && totalNf > 0 && dataEmissao ? (
      <ImpostosDestaNota
        estab={estabDoCalculo}
        nomeDaPJ={fiscal.nomeDaPJ[estabEscolhido.empresa_contabil_id] || estabEscolhido.nome}
        cnae={cnaeEscolhido}
        valor={centavos(totalNf)}
        emissao={dataEmissao}
        feriados={feriadosDoCalculo(cad)}
        diaPisCofins={diaDoPisCofins(cad, dataEmissao)}
      />
    ) : (
      <ImpostosDestaNotaVazio />
    );

  // O anexo é uma área de arrastar dentro do formulário; anexada, a nota
  // abre à esquerda e o drawer vira o lado a lado.
  const campoAnexo = (
    <Campo rotulo="Anexo da NF (PDF)" obrigatorio>
      <input
        ref={inputArquivo}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(e) => {
          void anexar(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {anexoNome ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[12.5px]">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="min-w-0 flex-1 truncate">{anexoNome}</span>
          <span className="shrink-0 text-[11.5px] text-muted-foreground">aberta ao lado</span>
          <button
            type="button"
            onClick={tirarAnexo}
            aria-label="Remover anexo"
            title="Remover anexo"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputArquivo.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            void anexar(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors disabled:cursor-wait",
            arrastando
              ? "border-california-red bg-california-red/5"
              : "border-border bg-muted/30 hover:border-california-red/50 hover:bg-california-red/[0.03]",
          )}
        >
          <Upload className="h-5 w-5 text-california-red" />
          <span className="text-[13px] font-semibold text-foreground">
            {uploading ? "Enviando..." : "Arraste o PDF da nota ou clique para anexar"}
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            A nota abre ao lado para conferir · apenas PDF, até 10 MB
          </span>
        </button>
      )}
    </Campo>
  );

  const blocoParcelas = (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-muted-foreground">Cada parcela vira um título em Títulos a Receber.</span>
        {restoNf > 0.004 && (
          <div className="ml-auto flex gap-1.5">
            {[2, 3, 6].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => aplicarParcelamento(n)}
                className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
              >
                {n}×
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-[22px_1fr_1fr_30px] gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span />
        <span className="text-right">Valor</span>
        <span>Vencimento</span>
        <span />
      </div>
      <div className="space-y-2">
        {temAntes && (
          <div>
            <div className="grid grid-cols-[22px_1fr_1fr_30px] items-center gap-2">
              <span className="text-center font-mono text-[11.5px] text-muted-foreground">1</span>
              <div className="flex h-9 items-center justify-end rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 font-mono text-[12.5px] font-semibold text-emerald-800">
                {formatMoney(antesTotal)}
              </div>
              <div className="flex h-9 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 font-mono text-[12.5px] text-emerald-800">
                {formatarData(antesData)}
              </div>
              <span className="flex items-center justify-center text-emerald-700" title="Já recebida">
                <Lock className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="ml-[30px] mt-1 text-[11px] text-emerald-800 text-pretty">
              {recebidosDaNf.length === 1
                ? `Recebida antes da NF, em ${formatarData(antesData)} (${recebidosDaNf[0].contaNome}). Nasce quitada.`
                : `Recebida antes da NF em ${recebidosDaNf.length} recebimentos, ${
                    antesData === recebidosDaNf[recebidosDaNf.length - 1].data
                      ? `todos em ${formatarData(antesData)}`
                      : `de ${formatarData(antesData)} a ${formatarData(recebidosDaNf[recebidosDaNf.length - 1].data)}`
                  }. Nasce quitada, com uma baixa para cada.`}
            </p>
          </div>
        )}
        {parcelas.map((p, i) => (
          <div key={i} className="grid grid-cols-[22px_1fr_1fr_30px] items-center gap-2">
            <span className="text-center font-mono text-[11.5px] text-muted-foreground">{i + 1 + (temAntes ? 1 : 0)}</span>
            <MoneyInput
              value={p.valor}
              onValueChange={(v) => {
                setParcelas((a) => a.map((x, j) => (j === i ? { ...x, valor: v } : x)));
                setErro(null);
              }}
            />
            <DatePicker
              // O DatePicker guarda a data dele: sem a chave, o "2×"/"3×"
              // trocava o vencimento e a tela mostrava o antigo.
              key={p.data_vencimento}
              name={`venc-${i}`}
              defaultValue={p.data_vencimento}
              onDateChange={(d) =>
                setParcelas((a) =>
                  a.map((x, j) => (j === i ? { ...x, data_vencimento: d ? format(d, "yyyy-MM-dd") : "" } : x)),
                )
              }
            />
            <button
              type="button"
              // Com a parcela 1 travada, a última editável pode sair.
              disabled={parcelas.length === 1 && !temAntes}
              onClick={() => setParcelas((a) => a.filter((_, j) => j !== i))}
              aria-label="Remover parcela"
              className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:text-california-red disabled:opacity-30 disabled:hover:text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5 border-t border-border pt-3">
        <button
          type="button"
          onClick={() =>
            setParcelas((a) => [
              ...a,
              { valor: 0, data_vencimento: format(addDays(new Date(), 30 * (a.length + 1)), "yyyy-MM-dd") },
            ])
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
        >
          <Plus className="h-3 w-3" /> Nova parcela
        </button>
        <span className={cn("ml-auto text-[11.5px] font-semibold", somaOk ? "text-emerald-700" : "text-california-red")}>
          Soma {formatMoney(somaParcelas)} / NF {formatMoney(totalNf)}
        </span>
      </div>
    </div>
  );

  const n = (() => {
    let i = 0;
    return { cliente: ++i, valor: avulso ? ++i : 0, nota: ++i, recebimento: ++i };
  })();
  const comNota = Boolean(anexoUrl);

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) fechar();
        }}
      >
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex h-full max-w-full outline-none",
              "transition-[width,padding,background-color] duration-300 ease-out",
              "data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-300",
              comNota ? "w-full gap-3 bg-[#181818]/[0.94] p-5" : "w-[700px]",
            )}
          >
            {comNota && anexoUrl && (
              <div className="grid min-h-0 min-w-0 flex-1 duration-300 animate-in fade-in-0 slide-in-from-left-4">
                <PainelDocumento
                  icone={<Paperclip className="h-4 w-4 text-violet-700" />}
                  titulo="Nota fiscal (PDF)"
                  legenda={anexoNome ?? ""}
                  extra={
                    <button
                      type="button"
                      onClick={tirarAnexo}
                      className="ml-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-california-red"
                    >
                      Trocar arquivo
                    </button>
                  }
                  oculto={false}
                  url={anexoUrl}
                  nomeArquivo={anexoNome ?? "nf.pdf"}
                  expandido={soANota}
                  onExpandir={() => setSoANota((v) => !v)}
                  onErro={setErro}
                  semBaixar
                >
                  <iframe
                    src={enderecoParaVisualizar(anexoUrl)}
                    title="PDF da nota fiscal"
                    className="h-full w-full border-0"
                  />
                </PainelDocumento>
              </div>
            )}
            <div
              className={cn(
                "flex min-h-0 w-[700px] max-w-full shrink-0 flex-col bg-card",
                comNota ? "overflow-hidden rounded-2xl" : "border-l border-border shadow-elevated",
                comNota && soANota && "hidden",
              )}
            >
              <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
                <DialogTitle className="flex flex-wrap items-center gap-2.5">
                  <FileText className="h-4.5 w-4.5 shrink-0 text-california-red" />
                  {titulo}
                  {jobsAtivos > 1 && (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                      <Layers className="h-3 w-3" />
                      Uma NF · {jobsAtivos} jobs
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">{subtitulo}</DialogDescription>
                {autores.length > 0 && (
                  <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-california-red/15 bg-california-red/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed">
                    <Send className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
                    <div className="min-w-0">
                      {autores.map((a) => (
                        <div key={`${a.bv}:${a.codigo}:${a.nome}`}>
                          {autores.length > 1 && a.codigo && (
                            <span className="font-mono text-[11.5px] text-muted-foreground">{a.codigo} · </span>
                          )}
                          <span className="text-muted-foreground">
                            {a.bv
                              ? "BV confirmado por"
                              : loteDaNota
                                ? "Enviado em lote para faturamento por"
                                : "Enviado para faturamento por"}
                          </span>{" "}
                          <strong className="font-semibold text-foreground">{a.nome}</strong>
                          {a.em && <span className="text-muted-foreground"> em {formatDataAsHoraBr(a.em)}</span>}
                        </div>
                      ))}
                      {/* A observação do envio em lote (decisão 188): para o
                          financeiro, não sai na nota. */}
                      {loteDaNota?.observacao && (
                        <p className="mt-1 whitespace-pre-line text-foreground text-pretty">
                          <span className="font-semibold">Observação:</span> {loteDaNota.observacao}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </DialogHeader>
              <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-6 [&>*]:py-5">
                <Secao n={n.cliente} titulo={avulso ? "Cliente e job" : "Jobs nesta NF"}>
                  {blocoClienteEJob}
                </Secao>
                {avulso && (
                  <Secao n={n.valor} titulo="Valor e classificação">
                    {blocoValor}
                  </Secao>
                )}
                <Secao n={n.nota} titulo="Nota fiscal">
                  {blocoNota}
                  {blocoImpostos}
                  {campoAnexo}
                </Secao>
                <Secao n={n.recebimento} titulo="Parcelas do recebimento">
                  {blocoParcelas}
                </Secao>
              </div>
              <div className="flex flex-col gap-2.5 border-t border-border px-6 py-3.5">
                {erro && (
                  <div className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{erro}</span>
                  </div>
                )}
                {emitidaComAviso && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{emitidaComAviso.aviso}</span>
                  </div>
                )}
                <p className="text-[11.5px] text-muted-foreground text-pretty">{rodape}</p>
                <div className="flex items-center justify-end gap-2.5">
                  {emitidaComAviso ? (
                    <button
                      type="button"
                      onClick={fechar}
                      className="rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted"
                    >
                      Fechar
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={fechar}
                        className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleFaturar}
                        disabled={pending || uploading}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
                      >
                        <FileCheck2 className="h-4 w-4" />
                        {pending ? "Faturando..." : "Faturar"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      {/* Fora do <Dialog> do drawer, como o ConfirmDialog de Contas a Pagar:
          o modal abre POR CIMA do drawer sem fechá-lo — quem escreve a
          descrição não pode perder o formulário para ler a instrução do GP. */}
      <InfoFaturamentoModal
        info={info}
        onOpenChange={(aberto) => {
          if (!aberto) setInfo(null);
        }}
      />
    </>
  );
}
