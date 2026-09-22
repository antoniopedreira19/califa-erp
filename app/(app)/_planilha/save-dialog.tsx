"use client";

/** O formulário do SAVE de uma linha — os dois lados do crédito.
 *
 *  Do design `Orcamento - Versao com Save.dc.html` (projeto Claude Design
 *  `69342d83`), 26/08/2026. Duas abas, porque são duas coisas opostas que
 *  cabem na mesma linha e nunca ao mesmo tempo:
 *
 *   - **Gerar** — esta linha é faturada aqui e o serviço não acontece; o
 *     valor vira crédito do cliente.
 *   - **Consumir** — esta linha é paga por saldo de outros jobs, e por
 *     isso sai do faturamento e entra no valor do job.
 *
 *  O saldo é do JOB, não da linha (decisão 028, nota de 26/08/2026): cada
 *  origem desconta do saldo do job dela, e uma linha pode beber de vários.
 *  As linhas que formaram cada saldo aparecem no detalhe, mas não são
 *  escolhidas uma a uma — não é assim que a operação trata o crédito.
 *
 *  APROVAÇÃO DE SAVE (decisão 099, 22/09/2026). No JOB cada save e cada
 *  consumo passa pelo financeiro, e o pop-up ganha só o que isso pede — o
 *  formulário em si (as duas abas, a aba de consumo inteira) continua o de
 *  sempre, porque o Tiago reprova qualquer divergência do design aprovado:
 *
 *   - a situação do pedido no topo da aba (chip, texto, justificativa da
 *     recusa e histórico);
 *   - o rótulo do crédito, que diz se ele já existe;
 *   - no job ABERTO, o segundo passo "Prosseguir com envio" (a mudança é
 *     errata de save e vai para a fila); no aberto e no DEVOLVIDO, o passo
 *     de confirmação do "Remover save";
 *   - as portas: gerar save até o envio para encerramento; consumir e
 *     retirar consumo só até o envio para faturamento.
 *
 *  Tudo isso mora atrás de `contexto`. No ORÇAMENTO nada disso aparece —
 *  lá o save não passa por aprovação, e a tela não muda, exceto o texto
 *  do estado vazio da aba de consumo.
 */

import * as React from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Lock,
  Plus,
  Send,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import {
  receitaDeFaturamentoDaLinha,
  type ParametrosInternacionais,
} from "@/lib/calculos/versao-totais";
import type { JobStatus, TipoCusto } from "@/lib/types";
import type { SaldoDeSave } from "@/lib/data/saves";
import { corDoDelta } from "./blocos";
import {
  situacaoDoSave,
  type EstadoSaveDaLinha,
  type PedidoDeSave,
  type PontaDeSave,
  type SituacaoDoSave,
} from "./save-coluna";

export interface LinhaDoSave {
  id: string;
  nome: string;
  grupoNome: string;
  tipoCusto: TipoCusto;
  totalOrcado: number;
}

/** O que as ações devolvem ao pop-up. A mensagem de erro já chega em
 *  pt-BR, pronta para a caixa de erro. */
export type ResultadoDoSave = { ok: boolean; message?: string };

/** Valor do job e faturamento previsto, como a PRODUÇÃO vê — a conta dos
 *  Totais da planilha (decisão 099 §5). */
export interface NumerosDoJob {
  valorJob: number;
  faturamentoPrevisto: number;
}

/** Uma mudança nesta linha, para o pop-up mostrar os números antes e
 *  depois dela. */
export type MudancaNaLinha =
  | { tipo: "marcar"; emSave: boolean }
  | { tipo: "consumo"; totalConsumido: number };

/** Por que o consumo desta linha não muda mais (decisão 099 §14). */
export type PortaDoConsumo =
  | { motivo: "faturamento" }
  /** Modelo mensal: o mês da linha já foi enviado. `mes` é o nome do mês,
   *  em minúsculas ("julho"). */
  | { motivo: "mes"; mes: string };

/** De onde sai o save ou o consumo que o GP retira. */
export type AlvoDaRetirada = { pedidoId: string } | { jobItemOrcadoId: string };

/** O que a planilha do JOB entrega ao pop-up quando a linha é editável. */
export interface AcoesDoSaveNoJob {
  /** `pedido`: job aberto — toda mudança é errata de save e vira pedido ao
   *  financeiro, com o passo "Prosseguir com envio". `direto`: job devolvido
   *  pelo financeiro — grava direto na cópia, sem pedido e sem segundo passo
   *  (decisão 099 §11). */
  modo: "pedido" | "direto";
  /** Por que esta linha não pode virar save agora (PP ou BV ativos, decisão
   *  099 §16). `null` quando pode. */
  gerarTravadoPor: string | null;
  /** O consumo desta linha já não muda (envio para faturamento, ou o mês
   *  dela já enviado). `null` com a porta aberta. */
  portaDoConsumo: PortaDoConsumo | null;
  /** Os números do job antes e depois de uma mudança nesta linha — pela
   *  mesma função do card de Totais. */
  simular: (mudanca: MudancaNaLinha) => {
    antes: NumerosDoJob;
    depois: NumerosDoJob;
  };
  onMarcarSave: (marcar: boolean) => Promise<ResultadoDoSave>;
  onSalvarConsumo: (
    origens: { jobOrigemId: string; valor: number }[],
  ) => Promise<ResultadoDoSave>;
  onCancelarPedido: (pedidoId: string) => Promise<ResultadoDoSave>;
  onRetirar: (alvo: AlvoDaRetirada) => Promise<ResultadoDoSave>;
}

/** O job por trás da linha. `acoes` nulo = leitura: pré-abertura, job
 *  encerrado, planilha do financeiro e conferência (decisão 099 §18). */
export interface SaveNoJob {
  status: JobStatus;
  acoes: AcoesDoSaveNoJob | null;
}

interface PropsComuns {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linha: LinhaDoSave | null;
  estado: EstadoSaveDaLinha;
  saldos: SaldoDeSave[];
  moeda: string;
  percentualHonorarios: number;
  percentualImposto: number;
  /** A cadeia internacional (decisão 072), ou `null` no nacional.
   *  Obrigatória: sem ela o "Faturamento desta linha" de um internacional
   *  saía pela conta nacional, sem as int. taxes. */
  internacional: ParametrosInternacionais | null;
  /** `null` quando a tela não tem o nome — a conferência do financeiro.
   *  Os textos passam a dizer "do cliente". */
  clienteNome: string | null;
}

type Props = PropsComuns &
  (
    | {
        contexto: "orcamento";
        /** Sem estas duas o formulário abre em leitura — é como a versão
         *  aprovada mostra o save. */
        onMarcarSave?: (marcar: boolean) => Promise<ResultadoDoSave>;
        onSalvarConsumo?: (
          origens: { jobOrigemId: string; valor: number }[],
        ) => Promise<ResultadoDoSave>;
      }
    | { contexto: "job"; job: SaveNoJob }
  );

interface OrigemNaTela {
  jobOrigemId: string;
  valor: number;
}

/** Percentual como o usuário lê: vírgula decimal, sem zeros sobrando
 *  ("19,53", "12"). */
function pct(n: number): string {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function paraNumero(raw: string): number {
  const limpo = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

// ---- datas e nomes dos textos da situação (decisão 099) ------------------
// O pop-up só renderiza aberto, no navegador: "há 2 dias" calculado aqui não
// passa pelo HTML do servidor e não diverge na hidratação.

const FUSO_BR = "America/Sao_Paulo";

/** dd/mm/aaaa, no horário de Brasília. */
function dataBr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BR,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** "20/09 · 16:40" — a coluna de datas do histórico. */
function dataHoraCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BR,
    day: "2-digit",
    month: "2-digit",
  }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BR,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${data} · ${hora}`;
}

/** "há 3 dias", "há 2 horas", "agora mesmo". */
function haQuanto(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const minutos = Math.floor((Date.now() - d.getTime()) / 60000);
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/** "por Tiago Mendonça", ou "pelo financeiro" quando o nome não veio. */
function porQuem(nome: string | null): string {
  return nome ? `por ${nome}` : "pelo financeiro";
}

/** "do JOB-0390", "do JOB-0390 e do JOB-0401". */
function doJobs(pontas: PontaDeSave[]): string {
  const codigos = [...new Set(pontas.map((p) => p.codigo))].map((c) => `do ${c}`);
  if (codigos.length === 0) return "do job de origem";
  if (codigos.length === 1) return codigos[0];
  return `${codigos.slice(0, -1).join(", ")} e ${codigos[codigos.length - 1]}`;
}

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** O texto da porta fechada do consumo (decisão 099 §14). `comConsumo`
 *  distingue a linha que já consome da que ainda não consome. */
function textoDaPorta(porta: PortaDoConsumo, comConsumo: boolean): string {
  if (porta.motivo === "faturamento") {
    return comConsumo
      ? "O job já foi enviado para faturamento: o consumo desta linha não muda mais."
      : "O job já foi enviado para faturamento: nenhuma linha dele passa a consumir save.";
  }
  const mes = maiuscula(porta.mes);
  return comConsumo
    ? `${mes} já foi enviado para faturamento: o consumo desta linha não muda mais.`
    : `${mes} já foi enviado para faturamento: nenhuma linha desse mês passa a consumir save.`;
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (v === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

/** Texto da situação de um lado da linha, na forma aprovada (spec da
 *  decisão 099, §3). */
function textoDaSituacao(
  situacao: SituacaoDoSave,
  tipo: "gera" | "consome",
  estado: EstadoSaveDaLinha,
  status: JobStatus,
  deCliente: string,
): string {
  const p = estado.pedidos;
  if (situacao === "nao_enviado") {
    if (status === "aberto" || status === "em_producao") {
      return "Marcado antes de existir a aprovação de save e nunca enviado ao financeiro. Envie pelo botão “Enviar saves para aprovação”, acima da planilha.";
    }
    if (status === "aguardando_abertura" || status === "rejeitado_financeiro") {
      return "Segue para a aprovação do financeiro quando o job for aberto.";
    }
    // Job cancelado (22/09/2026): o banco retira da fila o pedido que
    // aguardava (`save_job_cancelado_retira_pedidos`), e a linha, que segue
    // com o save ou o consumo, cai aqui sem pedido ativo. "Nunca foi
    // enviado" seria falso com o pedido no histórico logo abaixo.
    if (status === "cancelado") {
      const tevePedido = (p?.historico ?? []).some((h) => h.tipo === tipo);
      return tevePedido
        ? "O job foi cancelado e o pedido saiu da fila de aprovação do financeiro."
        : `O job foi cancelado sem que ${tipo === "gera" ? "este save" : "este consumo"} fosse enviado para a aprovação do financeiro.`;
    }
    // Job encerrado sem pedido: a migração aprovou o legado encerrado, e o
    // encerramento recusa save não enviado. Não deve aparecer.
    return "Nunca foi enviado para a aprovação do financeiro.";
  }
  if (tipo === "gera") {
    if (situacao === "aguardando" && p?.aguardando) {
      return `Enviado para aprovação do financeiro ${haQuanto(p.aguardando.enviadoEm)}. A linha já saiu do valor do job; o crédito só fica disponível depois da aprovação. Se o financeiro recusar, a linha volta ao valor do job.`;
    }
    if (situacao === "aprovado" && p?.aprovado) {
      const a = p.aprovado;
      // Job cancelado sai da lista de saldos (`vw_saves_por_job`): dizer
      // que o crédito está no saldo do cliente seria falso (22/09/2026).
      const ondeEsta =
        status === "cancelado"
          ? "O job foi cancelado, e o crédito saiu do saldo do cliente."
          : `O crédito está no saldo ${deCliente}.`;
      if (a.momento === "legado_migracao") {
        return `Aprovado na migração, em ${dataBr(a.decididoEm ?? a.enviadoEm)}: o job já estava encerrado ou enviado ao faturamento quando a aprovação de save entrou no sistema. ${ondeEsta}`;
      }
      return `Aprovado ${porQuem(a.decididoPor)} em ${dataBr(a.decididoEm)}. ${ondeEsta}`;
    }
    if (situacao === "recusado" && p?.recusado) {
      const r = p.recusado;
      return `Recusado ${porQuem(r.decididoPor)} em ${dataBr(r.decididoEm)}. A linha voltou ao valor do job, sem crédito. Para pedir de novo, retire o save e marque a linha outra vez.`;
    }
    return "";
  }
  if (situacao === "aguardando" && p?.aguardando) {
    return `Enviado para aprovação do financeiro ${haQuanto(p.aguardando.enviadoEm)}. A linha já saiu do faturamento e o valor está reservado no saldo ${doJobs(p.aguardando.origens)}. Se o financeiro recusar, a linha volta ao faturamento e a reserva é liberada.`;
  }
  if (situacao === "aprovado" && p?.aprovado) {
    const a = p.aprovado;
    const origens = estado.origens.length > 0 ? estado.origens : a.origens;
    if (a.momento === "legado_migracao") {
      // A spec só traz o texto da migração para o save gerado; o do
      // consumo segue a mesma forma (decisão tomada na implementação).
      return `Aprovado na migração, em ${dataBr(a.decididoEm ?? a.enviadoEm)}: o job já estava encerrado ou enviado ao faturamento quando a aprovação de save entrou no sistema. A linha é paga pelo saldo ${doJobs(origens)}.`;
    }
    return `Aprovado ${porQuem(a.decididoPor)} em ${dataBr(a.decididoEm)}. A linha é paga pelo saldo ${doJobs(origens)}.`;
  }
  if (situacao === "recusado" && p?.recusado) {
    const r = p.recusado;
    return r.substituiId
      ? `Recusado ${porQuem(r.decididoPor)} em ${dataBr(r.decididoEm)}. A linha voltou ao consumo aprovado anterior.`
      : `Recusado ${porQuem(r.decididoPor)} em ${dataBr(r.decididoEm)}. A linha voltou ao faturamento e a reserva foi liberada.`;
  }
  return "";
}

/** Uma entrada do histórico: quando e o quê. */
interface EntradaDoHistorico {
  em: string;
  texto: string;
}

/** O histórico de um lado da linha, montado dos pedidos e da marca de quem
 *  marcou o save. Do mais antigo ao mais novo. */
function historicoDoLado(
  estado: EstadoSaveDaLinha,
  tipo: "gera" | "consome",
  moeda: string,
): EntradaDoHistorico[] {
  const lista: EntradaDoHistorico[] = [];
  const pedidos = (estado.pedidos?.historico ?? []).filter((p) => p.tipo === tipo);

  if (tipo === "gera" && estado.marcadoEm) {
    lista.push({
      em: estado.marcadoEm,
      texto: estado.marcadoPor
        ? `Marcado como save por ${estado.marcadoPor}`
        : "Marcado como save",
    });
  }

  for (const p of pedidos) {
    const quem = p.enviadoPor ? ` por ${p.enviadoPor}` : "";
    if (p.momento === "legado_migracao") {
      lista.push({
        em: p.decididoEm ?? p.enviadoEm,
        texto:
          "Aprovado na migração: o job já estava encerrado ou enviado ao faturamento quando a aprovação de save entrou no sistema",
      });
    } else if (tipo === "consome") {
      const oque = `Consumo de ${formatCurrency(p.valor, moeda)} do saldo ${doJobs(p.origens)}`;
      if (p.momento === "job_aberto") {
        lista.push({ em: p.enviadoEm, texto: `${oque} definido${quem}` });
        lista.push({ em: p.enviadoEm, texto: "Enviado para aprovação do financeiro" });
      } else {
        lista.push({ em: p.enviadoEm, texto: `${oque} ${textoDoEnvio(p, quem, true)}` });
      }
    } else {
      // Com a marca da linha já no histórico, o "por" do envio repetiria o
      // mesmo nome logo abaixo.
      lista.push({
        em: p.enviadoEm,
        texto: maiuscula(
          textoDoEnvio(p, p.momento === "job_aberto" && estado.marcadoEm ? "" : quem, false),
        ),
      });
    }

    // A recusa exige justificativa (decisão 099 §8); a aprovação, não. É o
    // que separa as duas também no pedido já arquivado.
    const recusou = p.justificativa !== null;
    if (p.decididoEm && p.momento !== "legado_migracao") {
      lista.push({
        em: p.decididoEm,
        texto: `${recusou ? "Recusado" : "Aprovado"} ${porQuem(p.decididoPor)}`,
      });
    }
    if (p.retiradoEm) {
      const por = p.retiradoPor ? ` por ${p.retiradoPor}` : "";
      lista.push({
        em: p.retiradoEm,
        texto: !p.decididoEm
          ? `Pedido cancelado${por}`
          : recusou
            ? `Recusa arquivada${por}`
            : tipo === "gera"
              ? `Save retirado${por}`
              : `Consumo retirado${por}`,
      });
    }
  }

  return lista.sort((a, b) => a.em.localeCompare(b.em));
}

function textoDoEnvio(p: PedidoDeSave, quem: string, minusculo: boolean): string {
  const texto =
    p.momento === "abertura"
      ? "enviado para aprovação com a abertura do job"
      : p.momento === "reenvio"
        ? "enviado para aprovação com o reenvio do job"
        : `enviado para aprovação do financeiro${quem}`;
  return minusculo ? texto : maiuscula(texto);
}

export function SaveDialog(props: Props) {
  const {
    open,
    onOpenChange,
    linha,
    estado,
    saldos,
    moeda,
    percentualHonorarios,
    percentualImposto,
    internacional,
    clienteNome,
  } = props;
  const noJob = props.contexto === "job" ? props.job : null;
  const acoesJob = noJob?.acoes ?? null;
  const porPedido = acoesJob?.modo === "pedido";
  const marcarSave =
    acoesJob?.onMarcarSave ??
    (props.contexto === "orcamento" ? props.onMarcarSave : undefined);
  const salvarConsumo =
    acoesJob?.onSalvarConsumo ??
    (props.contexto === "orcamento" ? props.onSalvarConsumo : undefined);
  const editavel = Boolean(marcarSave && salvarConsumo);
  // Abre em "Gerar save": é o gesto mais comum e o que dá nome à coluna.
  // Quem já tem consumo gravado cai em "Consumir" pelo efeito abaixo
  // (31/08/2026, decisão do Tiago).
  const [modo, setModo] = React.useState<"gerar" | "consumir">("gerar");
  const [origens, setOrigens] = React.useState<OrigemNaTela[]>([]);
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  // O passo do pop-up no job aberto (decisão 099): o formulário, a
  // confirmação do envio da errata de save, ou a confirmação da retirada.
  const [passo, setPasso] = React.useState<"form" | "envio" | "remocao">("form");

  // Reabrir o formulário tem que mostrar o que está gravado, não o que
  // sobrou da última edição abandonada.
  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setPasso("form");
    // A linha diz em que aba ela abre: quem gera cai em "Gerar", quem já
    // consome cai em "Consumir", e a linha em branco abre em "Gerar". No
    // job, o consumo recusado (que já não tem origens) também abre no lado
    // dele (decisão 099).
    const consumoNaLinha =
      estado.origens.length > 0 ||
      estado.pedidos?.recusado?.tipo === "consome" ||
      estado.pedidos?.aguardando?.tipo === "consome";
    setModo(consumoNaLinha && !estado.emSave ? "consumir" : "gerar");
    // Consumo recusado sem consumo por baixo (decisão 099): a linha já
    // voltou ao faturamento e não tem origem gravada, mas a aba mostra o
    // que foi pedido, travado — como o protótipo mostra o consumo recusado.
    const recusado = estado.pedidos?.recusado;
    const pontas =
      estado.origens.length === 0 && recusado?.tipo === "consome"
        ? recusado.origens
        : estado.origens;
    setOrigens(pontas.map((o) => ({ jobOrigemId: o.jobId, valor: o.valor })));
  }, [open, estado]);

  if (!linha) return null;

  const deCliente = clienteNome ? `de ${clienteNome}` : "do cliente";
  const fmt = (v: number) => formatCurrency(v, moeda);
  const orcado = linha.totalOrcado;
  const faturamentoDaLinha = receitaDeFaturamentoDaLinha(
    orcado,
    linha.tipoCusto,
    percentualHonorarios,
    percentualImposto,
    internacional,
  );
  const totalConsumido = origens.reduce((s, o) => s + o.valor, 0);
  const sobra = orcado - totalConsumido;
  const passouDoOrcado = totalConsumido > orcado + 0.005;

  const saldoDe = (jobId: string) => saldos.find((s) => s.jobId === jobId);
  // Quanto ESTA linha já consome de cada job, como está gravado. O
  // `disponivel` que vem do banco já desconta este consumo — sem devolvê-lo
  // aqui, reabrir a linha mostrava "livre R$ 0,00 · sobra −R$ 30.000,00"
  // para um consumo que está perfeitamente dentro do saldo, e pintava a
  // linha de vermelho (31/08/2026).
  // Sem `useMemo`: este trecho roda depois do `if (!linha) return null`
  // acima, e um hook aqui muda a contagem de hooks entre renders
  // ("Rendered fewer hooks than expected"). O laço é sobre uma lista de
  // no máximo um punhado de origens.
  const jaGravadoPorOrigem = new Map<string, number>();
  for (const o of estado.origens) {
    jaGravadoPorOrigem.set(
      o.jobId,
      (jaGravadoPorOrigem.get(o.jobId) ?? 0) + Number(o.valor ?? 0),
    );
  }
  const livreDe = (jobId: string) =>
    (saldoDe(jobId)?.disponivel ?? 0) + (jaGravadoPorOrigem.get(jobId) ?? 0);
  const naoEscolhidos = saldos.filter(
    (s) => !origens.some((o) => o.jobOrigemId === s.jobId) && s.disponivel > 0,
  );

  // ---- decisão 099: situação e portas da linha no JOB --------------------
  // No orçamento `noJob` é nulo e tudo aqui fica neutro: nenhuma trava, e
  // os botões se comportam como sempre.
  const pedidos = estado.pedidos;
  const sitGera: SituacaoDoSave = noJob ? situacaoDoSave(estado, "gera") : "sem_save";
  const sitConsumo: SituacaoDoSave = noJob
    ? situacaoDoSave(estado, "consome")
    : "sem_save";
  const porta = acoesJob?.portaDoConsumo ?? null;
  const consumoNaLinha = estado.origens.length > 0 || sitConsumo !== "sem_save";
  // Leitura no job (pré-abertura, encerrado, cancelado, planilha do
  // financeiro, conferência): a tela não entrega a lista de saldos, e o
  // "livre · sobra" de cada origem sairia inventado (R$ 0,00). A aba mostra
  // só o que se sabe: o código gravado e o valor.
  const leituraNoJob = noJob !== null && acoesJob === null;
  // O consumo recusado sem consumo por baixo: a aba mostra as origens do
  // pedido recusado, travadas. Elas não reservam nada — a recusa liberou
  // a reserva —, então também sem "livre · sobra".
  const recusadoNaAba =
    estado.origens.length === 0 && pedidos?.recusado?.tipo === "consome"
      ? pedidos.recusado
      : null;

  // Por que esta linha não vira save agora. O banco recusa gerar save em
  // linha com consumo (decisão 099, travas no banco) — e o aviso vermelho do
  // orçamento, que promete desfazer o consumo, não vale no job.
  const travaGerar: string | null =
    !noJob || !acoesJob || estado.emSave || sitGera === "recusado"
      ? null
      : sitConsumo === "aguardando"
        ? "Esta linha tem um consumo de save aguardando o financeiro e por isso não vira save. Para marcá-la como save, cancele o pedido antes, na aba “Consumir save de outro job”."
        : sitConsumo === "recusado"
          ? "O financeiro recusou o consumo desta linha. Para marcá-la como save, retire antes o consumo recusado, na aba “Consumir save de outro job”."
          : consumoNaLinha
            ? `Esta linha é paga com saldo de save de outro job e por isso não vira save. ${
                porta
                  ? textoDaPorta(porta, true)
                  : "Para marcá-la como save, desfaça o consumo antes, na aba “Consumir save de outro job”."
              }`
            : acoesJob.gerarTravadoPor;
  const podeAplicarGerar =
    editavel && !estado.emSave && (!noJob || (travaGerar === null && sitGera !== "recusado"));

  // Por que o consumo desta linha não muda agora.
  const travaConsumo: string | null =
    !noJob || !acoesJob
      ? null
      : estado.emSave
        ? sitGera === "aguardando"
          ? "Esta linha tem um save aguardando o financeiro e por isso não consome saldo de outro job. Para consumir, cancele o pedido antes, na aba “Gerar save nesta linha”."
          : "Esta linha gera save e por isso não consome saldo de outro job. Para consumir, retire o save antes, na aba “Gerar save nesta linha”."
        : sitGera === "recusado"
          ? "O financeiro recusou o save desta linha. Para consumir saldo nela, retire antes o save recusado, na aba “Gerar save nesta linha”."
          : porta
            ? textoDaPorta(porta, consumoNaLinha)
            : null;
  // Consumo aguardando não se edita (cancele o pedido antes); o recusado
  // fica travado até ser retirado (decisão 099 §9 e §12).
  const consumoParado =
    noJob !== null && (sitConsumo === "aguardando" || sitConsumo === "recusado");
  const consumoEditavel = editavel && travaConsumo === null && !consumoParado;
  const notaConsumo =
    acoesJob && sitConsumo === "aguardando" && travaConsumo === null
      ? "Enquanto o pedido aguarda o financeiro, o consumo não muda. Para mudar, cancele o pedido: a linha volta ao que era antes dele."
      : null;

  // O "Remover save" do job age sobre o lado que a linha tem, não sobre a
  // aba aberta. Save gerado sai até o envio para encerramento; consumo, só
  // até o envio para faturamento — menos o recusado, cuja retirada só
  // arquiva a recusa e não mexe em número nenhum (decisão 099 §13).
  const ladoDaRemocao: "gera" | "consome" | null = !noJob
    ? null
    : estado.emSave || sitGera === "recusado"
      ? "gera"
      : sitConsumo !== "sem_save"
        ? "consome"
        : null;
  const temAlgumSave = estado.emSave || estado.origens.length > 0;
  const mostraRemover = noJob
    ? editavel &&
      ladoDaRemocao !== null &&
      (ladoDaRemocao === "gera" || sitConsumo === "recusado" || porta === null)
    : editavel && temAlgumSave;
  const rotuloRemover =
    ladoDaRemocao === "consome" && sitConsumo === "aguardando"
      ? "Cancelar pedido"
      : "Remover save";

  async function gravar(fazer: () => Promise<ResultadoDoSave>, falha: string) {
    setSalvando(true);
    setErro(null);
    const r = await fazer();
    setSalvando(false);
    if (!r.ok) {
      setErro(r.message ?? falha);
      return;
    }
    onOpenChange(false);
  }

  function gravarFormulario() {
    return gravar(
      () =>
        modo === "gerar"
          ? marcarSave!(true)
          : salvarConsumo!(origens.filter((o) => o.valor > 0)),
      "Não foi possível gravar.",
    );
  }

  function aplicar() {
    if (!editavel) return;
    // Job aberto: a mudança é errata de save e vai para a fila — o passo
    // seguinte mostra isso antes de gravar (decisão 099 §12).
    if (porPedido) {
      setErro(null);
      setPasso("envio");
      return;
    }
    void gravarFormulario();
  }

  function remover() {
    if (!editavel) return;
    // Retirar no job é sempre com aviso (decisão 099 §13): no aberto, que
    // vira errata ou cancelamento de pedido, e no devolvido, que grava
    // direto na cópia. No orçamento, direto, como sempre foi.
    if (acoesJob) {
      setErro(null);
      setPasso("remocao");
      return;
    }
    void gravar(
      () => (estado.emSave ? marcarSave!(false) : salvarConsumo!([])),
      "Não foi possível remover.",
    );
  }

  const cabecalho = (
    <div className="border-b border-border px-5 py-4">
      <DialogTitle className="text-[15px] font-bold">
        Save · {linha.nome}
      </DialogTitle>
      <DialogDescription className="sr-only">
        {noJob
          ? "O save desta linha do job e a situação dele na aprovação do financeiro."
          : "Definir o save desta linha do orçamento."}
      </DialogDescription>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Pastilha>{linha.grupoNome}</Pastilha>
        <Pastilha>Tipo {linha.tipoCusto}</Pastilha>
        <Pastilha destaque>
          {formatCurrency(orcado, moeda)} orçados
        </Pastilha>
        <Pastilha>
          {estado.emSave
            ? "Gera crédito"
            : estado.origens.length > 0
              ? `Paga por ${estado.origens.length} job${estado.origens.length > 1 ? "s" : ""}`
              : "Sem save definido"}
        </Pastilha>
      </div>
    </div>
  );

  const caixaDeErro = erro && (
    <p className="mx-5 mb-1 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
      {erro}
    </p>
  );

  const rodape = (esquerda: React.ReactNode, direita: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5">
      <div>{esquerda}</div>
      <div className="flex items-center gap-2">{direita}</div>
    </div>
  );

  const botaoVoltar = (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        setErro(null);
        setPasso("form");
      }}
      disabled={salvando}
    >
      Voltar
    </Button>
  );

  // ---- passo: a errata de save vai para aprovação (decisão 099) ----------
  if (passo === "envio" && acoesJob) {
    const gerar = modo === "gerar";
    const numeros = acoesJob.simular(
      gerar ? { tipo: "marcar", emSave: true } : { tipo: "consumo", totalConsumido },
    );
    const antes = gerar ? numeros.antes.valorJob : numeros.antes.faturamentoPrevisto;
    const depois = gerar ? numeros.depois.valorJob : numeros.depois.faturamentoPrevisto;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
          {cabecalho}
          <div className="max-h-[52vh] space-y-4 overflow-auto px-5 pb-4 pt-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
              <div className="space-y-1">
                <p className="text-[12.5px] font-semibold text-amber-900">
                  Esta mudança é uma errata de save e vai para aprovação
                </p>
                <p className="text-[11.5px] leading-relaxed text-amber-900">
                  Esta mudança é uma errata de save:{" "}
                  {gerar ? "o valor do job muda agora" : "o faturamento previsto muda agora"}{" "}
                  ({fmt(antes)} → {fmt(depois)}), o job vai para a revisão da
                  abertura e o save entra na fila de aprovação. Se o financeiro
                  recusar, os números voltam ao que eram antes deste pedido.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-border px-3.5 py-2">
              {gerar ? (
                <>
                  <Par rotulo="Valor do job" antes={antes} depois={depois} moeda={moeda} forte />
                  <div className="flex items-center justify-between gap-4 py-1.5">
                    <span className="text-[12.5px] text-muted-foreground">
                      Crédito a ser gerado
                    </span>
                    <span className="font-mono text-[12.5px] font-bold">
                      {fmt(orcado)}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <Par
                    rotulo="Faturamento previsto"
                    antes={antes}
                    depois={depois}
                    moeda={moeda}
                    forte
                  />
                  {origens
                    .filter((o) => o.valor > 0)
                    .map((o) => (
                      <div
                        key={o.jobOrigemId}
                        className="flex items-center justify-between gap-4 py-1.5"
                      >
                        <span className="text-[12.5px] text-muted-foreground">
                          Reservado no saldo do{" "}
                          {saldoDe(o.jobOrigemId)?.codigo ??
                            estado.origens.find((p) => p.jobId === o.jobOrigemId)?.codigo ??
                            "—"}
                        </span>
                        <span className="font-mono text-[12.5px] font-bold">
                          {fmt(o.valor)}
                        </span>
                      </div>
                    ))}
                </>
              )}
            </div>
          </div>
          {caixaDeErro}
          {rodape(
            null,
            <>
              {botaoVoltar}
              <Button
                type="button"
                onClick={() => void gravarFormulario()}
                disabled={salvando}
              >
                <Send className="h-4 w-4" />
                {salvando ? "Gravando…" : "Prosseguir com envio"}
              </Button>
            </>,
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // ---- passo: retirar o save ou o consumo (decisão 099 §13) ---------------
  if (passo === "remocao" && acoesJob && ladoDaRemocao) {
    const r = descreverRemocao({
      lado: ladoDaRemocao,
      situacao: ladoDaRemocao === "gera" ? sitGera : sitConsumo,
      estado,
      linha,
      orcado,
      deCliente,
      moeda,
      acoes: acoesJob,
    });
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
          {cabecalho}
          <div className="max-h-[52vh] space-y-4 overflow-auto px-5 pb-4 pt-4">
            {r.bloqueio ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-california-red/30 bg-california-red/5 px-3.5 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-california-red" />
                <p className="text-xs leading-relaxed text-foreground">{r.bloqueio}</p>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
                  <div className="space-y-1">
                    <p className="text-[12.5px] font-semibold text-amber-900">
                      {r.titulo}
                    </p>
                    <p className="text-[11.5px] leading-relaxed text-amber-900">
                      {r.texto}
                    </p>
                  </div>
                </div>
                {r.par && (
                  <div className="rounded-xl border border-border px-3.5 py-2">
                    <Par
                      rotulo={r.par.rotulo}
                      antes={r.par.antes}
                      depois={r.par.depois}
                      moeda={moeda}
                      forte
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {caixaDeErro}
          {rodape(
            null,
            <>
              {botaoVoltar}
              {!r.bloqueio && (
                <Button
                  type="button"
                  onClick={() => void gravar(r.executar, "Não foi possível retirar.")}
                  disabled={salvando}
                >
                  {r.enviaParaRevisao && <Send className="h-4 w-4" />}
                  {salvando ? "Gravando…" : r.rotuloConfirmar}
                </Button>
              )}
            </>,
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // ---- o formulário ----------------------------------------------------
  const situacaoGera =
    noJob && sitGera !== "sem_save" ? (
      <SituacaoBloco
        tipo="gera"
        situacao={sitGera}
        jobCancelado={noJob.status === "cancelado"}
        texto={textoDaSituacao(sitGera, "gera", estado, noJob.status, deCliente)}
        justificativa={sitGera === "recusado" ? (pedidos?.recusado?.justificativa ?? null) : null}
        historico={historicoDoLado(estado, "gera", moeda)}
      />
    ) : null;
  const situacaoConsumo =
    noJob && sitConsumo !== "sem_save" ? (
      <SituacaoBloco
        tipo="consome"
        situacao={sitConsumo}
        jobCancelado={noJob.status === "cancelado"}
        texto={textoDaSituacao(sitConsumo, "consome", estado, noJob.status, deCliente)}
        justificativa={
          sitConsumo === "recusado" ? (pedidos?.recusado?.justificativa ?? null) : null
        }
        historico={historicoDoLado(estado, "consome", moeda)}
      />
    ) : null;

  // O crédito só existe depois da aprovação (decisão 099 §12).
  const rotuloCredito = !noJob
    ? "Crédito gerado"
    : sitGera === "aprovado"
      ? "Crédito gerado"
      : sitGera === "recusado"
        ? "Crédito não gerado"
        : "Crédito a ser gerado";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        {cabecalho}

        {/* Abas */}
        <div className="px-5 pt-3.5">
          <div className="inline-flex rounded-[10px] border border-border bg-muted/60 p-[3px]">
            {(["gerar", "consumir"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                disabled={!editavel}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
                  modo === m
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "gerar"
                  ? "Gerar save nesta linha"
                  : "Consumir save de outro job"}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[52vh] overflow-auto px-5 pb-1 pt-4">
          {modo === "gerar" ? (
            <ModoGerar
              orcado={orcado}
              faturamento={faturamentoDaLinha}
              moeda={moeda}
              percentualHonorarios={percentualHonorarios}
              percentualImposto={percentualImposto}
              internacional={internacional}
              estado={estado}
              deCliente={deCliente}
              contextoJob={noJob !== null}
              situacao={situacaoGera}
              rotuloCredito={rotuloCredito}
              // No job o destino do crédito só se mostra no save aprovado:
              // antes disso o crédito não está no saldo de ninguém.
              mostraDestino={noJob ? sitGera === "aprovado" : estado.emSave}
              trava={travaGerar}
            />
          ) : (
            <ModoConsumir
              origens={origens}
              setOrigens={setOrigens}
              saldos={saldos}
              saldoDe={saldoDe}
              livreDe={livreDe}
              naoEscolhidos={naoEscolhidos}
              moeda={moeda}
              orcado={orcado}
              totalConsumido={totalConsumido}
              sobra={sobra}
              passouDoOrcado={passouDoOrcado}
              editavel={noJob ? consumoEditavel : editavel}
              pontasConhecidas={
                recusadoNaAba ? [...estado.origens, ...recusadoNaAba.origens] : estado.origens
              }
              mostraLivre={!leituraNoJob && recusadoNaAba === null}
              consumoRecusado={recusadoNaAba !== null}
              contextoJob={noJob !== null}
              situacao={situacaoConsumo}
              trava={travaConsumo}
              nota={notaConsumo}
            />
          )}
        </div>

        {caixaDeErro}

        {rodape(
          mostraRemover && (
            <button
              type="button"
              onClick={remover}
              disabled={salvando}
              className="text-xs font-semibold text-california-red hover:underline disabled:opacity-50"
            >
              {rotuloRemover}
            </button>
          ),
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              {editavel ? "Cancelar" : "Fechar"}
            </Button>
            {editavel && (
              <Button
                type="button"
                onClick={aplicar}
                disabled={
                  salvando ||
                  (modo === "consumir" &&
                    (passouDoOrcado ||
                      origens.length === 0 ||
                      (noJob !== null && !consumoEditavel))) ||
                  (modo === "gerar" && !podeAplicarGerar)
                }
              >
                {salvando ? "Gravando…" : "Aplicar"}
              </Button>
            )}
          </>,
        )}
      </DialogContent>
    </Dialog>
  );
}

/** O que o passo de retirada mostra e faz, caso a caso (decisão 099 §13). */
function descreverRemocao({
  lado,
  situacao,
  estado,
  linha,
  orcado,
  deCliente,
  moeda,
  acoes,
}: {
  lado: "gera" | "consome";
  situacao: SituacaoDoSave;
  estado: EstadoSaveDaLinha;
  linha: LinhaDoSave;
  orcado: number;
  deCliente: string;
  moeda: string;
  acoes: AcoesDoSaveNoJob;
}): {
  titulo: string;
  texto: React.ReactNode;
  par: { rotulo: string; antes: number; depois: number } | null;
  bloqueio: React.ReactNode | null;
  rotuloConfirmar: string;
  /** A retirada é errata e devolve o job à revisão da abertura. */
  enviaParaRevisao: boolean;
  executar: () => Promise<ResultadoDoSave>;
} {
  const fmt = (v: number) => formatCurrency(v, moeda);
  const p = estado.pedidos;
  const soma = (pontas: PontaDeSave[]) => pontas.reduce((s, o) => s + o.valor, 0);
  const parValorJob = (): { rotulo: string; antes: number; depois: number } => {
    const n = acoes.simular({ tipo: "marcar", emSave: false });
    return { rotulo: "Valor do job", antes: n.antes.valorJob, depois: n.depois.valorJob };
  };
  const parFaturamento = (total: number) => {
    const n = acoes.simular({ tipo: "consumo", totalConsumido: total });
    return {
      rotulo: "Faturamento previsto",
      antes: n.antes.faturamentoPrevisto,
      depois: n.depois.faturamentoPrevisto,
    };
  };
  // Pedido de outro momento que não o job aberto (abertura, reenvio, legado)
  // o financeiro já conta desde a abertura: cancelá-lo é errata de save.
  const jaContava = (pedido: PedidoDeSave) => pedido.momento !== "job_aberto";
  const fraseDaRevisao =
    " Como o financeiro já conta este pedido desde a abertura, cancelar é uma errata: o job volta para a revisão da abertura.";

  // Job DEVOLVIDO (decisão 099 §11 e §13): a retirada grava direto na
  // cópia, sem pedido e sem errata — mas também com aviso. Os espelhos do
  // financeiro são refeitos pela cópia no reenvio.
  if (acoes.modo === "direto") {
    const gera = lado === "gera";
    return {
      titulo: gera ? "Retirar o save desta linha?" : "Desfazer o consumo desta linha?",
      texto: gera
        ? "O job foi devolvido pelo financeiro, e retirar o save grava direto na planilha do job: a linha volta ao valor do job. Nada vai para o financeiro agora; os números do job são recalculados quando ele for reenviado para abertura."
        : "O job foi devolvido pelo financeiro, e desfazer o consumo grava direto na planilha do job: a linha volta ao faturamento e o valor volta ao saldo de origem. Nada vai para o financeiro agora; os números do job são recalculados quando ele for reenviado para abertura.",
      par: null,
      bloqueio: null,
      rotuloConfirmar: gera ? "Retirar save" : "Desfazer consumo",
      enviaParaRevisao: false,
      executar: () => (gera ? acoes.onMarcarSave(false) : acoes.onSalvarConsumo([])),
    };
  }

  if (lado === "gera") {
    if (situacao === "aprovado" && p?.aprovado) {
      const aprovado = p.aprovado;
      // "Qualquer uso" do saldo do job trava a retirada (decisão 099 §13):
      // o banco recusa, e a tela explica antes do clique.
      if (estado.destinos.length > 0) {
        return {
          titulo: "",
          texto: null,
          par: null,
          bloqueio: (
            <>
              Não dá para retirar este save: o saldo deste job já começou a ser
              usado (
              {estado.destinos.map((d) => `${d.codigo} ${fmt(d.valor)}`).join(" · ")}
              ). Enquanto houver consumo sobre o saldo deste job, o save aprovado
              não sai.
            </>
          ),
          rotuloConfirmar: "",
          enviaParaRevisao: false,
          executar: async () => ({ ok: false }),
        };
      }
      return {
        titulo: "Retirar o save desta linha?",
        texto: (
          <>
            “{linha.nome}” tem <strong>{fmt(orcado)} de crédito aprovado</strong>{" "}
            em {dataBr(aprovado.decididoEm ?? aprovado.enviadoEm)}. Retirar o save
            é uma errata: a linha volta ao valor do job, o crédito sai do saldo{" "}
            {deCliente} e o job volta para a revisão da abertura.
          </>
        ),
        par: parValorJob(),
        bloqueio: null,
        rotuloConfirmar: "Prosseguir com envio",
        enviaParaRevisao: true,
        executar: () => acoes.onRetirar({ pedidoId: aprovado.id }),
      };
    }
    if (situacao === "aguardando" && p?.aguardando) {
      const aguardando = p.aguardando;
      return {
        titulo: "Cancelar o pedido de save?",
        texto: `O save sai da fila de aprovação do financeiro e a linha volta ao valor do job.${
          jaContava(aguardando) ? fraseDaRevisao : ""
        }`,
        par: parValorJob(),
        bloqueio: null,
        rotuloConfirmar: "Cancelar pedido",
        enviaParaRevisao: false,
        executar: () => acoes.onCancelarPedido(aguardando.id),
      };
    }
    if (situacao === "recusado" && p?.recusado) {
      const recusado = p.recusado;
      return {
        titulo: "Retirar o save recusado?",
        texto:
          "A linha já voltou ao valor do job. Retirar só arquiva a recusa: ela continua no histórico da linha, e a linha volta a aceitar errata, PP e BV.",
        par: null,
        bloqueio: null,
        rotuloConfirmar: "Retirar save",
        enviaParaRevisao: false,
        executar: () => acoes.onRetirar({ pedidoId: recusado.id }),
      };
    }
    return {
      titulo: "Retirar o save desta linha?",
      texto:
        "Retirar o save é uma errata: a linha volta ao valor do job e o job volta para a revisão da abertura.",
      par: parValorJob(),
      bloqueio: null,
      rotuloConfirmar: "Retirar save",
      enviaParaRevisao: false,
      executar: () => acoes.onRetirar({ jobItemOrcadoId: linha.id }),
    };
  }

  if (situacao === "aprovado" && p?.aprovado) {
    const aprovado = p.aprovado;
    return {
      titulo: "Desfazer o consumo desta linha?",
      texto: (
        <>
          O consumo de <strong>{fmt(soma(estado.origens))}</strong> foi aprovado em{" "}
          {dataBr(aprovado.decididoEm ?? aprovado.enviadoEm)}. Desfazer é uma
          errata: a linha volta ao faturamento, o valor volta ao saldo de origem
          e o job volta para a revisão da abertura.
        </>
      ),
      par: parFaturamento(0),
      bloqueio: null,
      rotuloConfirmar: "Prosseguir com envio",
      enviaParaRevisao: true,
      executar: () => acoes.onRetirar({ pedidoId: aprovado.id }),
    };
  }
  if (situacao === "aguardando" && p?.aguardando) {
    const aguardando = p.aguardando;
    return {
      titulo: "Cancelar o pedido de consumo?",
      texto: `${
        aguardando.substituiId
          ? "O pedido sai da fila de aprovação do financeiro e a linha volta ao consumo aprovado anterior."
          : "O consumo sai da fila de aprovação do financeiro, a reserva no saldo de origem é liberada e a linha volta ao faturamento."
      }${jaContava(aguardando) ? fraseDaRevisao : ""}`,
      // A recusa e o cancelamento voltam ao consumo de logo antes do pedido.
      par: parFaturamento(soma(aguardando.origensAntes)),
      bloqueio: null,
      rotuloConfirmar: "Cancelar pedido",
      enviaParaRevisao: false,
      executar: () => acoes.onCancelarPedido(aguardando.id),
    };
  }
  if (situacao === "recusado" && p?.recusado) {
    const recusado = p.recusado;
    return {
      titulo: "Retirar o consumo recusado?",
      texto: p.aprovado
        ? "A linha já voltou ao consumo aprovado anterior. Retirar só arquiva a recusa: ela continua no histórico da linha, e o consumo aprovado segue valendo."
        : "A linha já voltou ao faturamento. Retirar só arquiva a recusa: ela continua no histórico da linha, e a linha volta a aceitar errata e um novo consumo.",
      par: null,
      bloqueio: null,
      rotuloConfirmar: "Retirar consumo",
      enviaParaRevisao: false,
      executar: () => acoes.onRetirar({ pedidoId: recusado.id }),
    };
  }
  return {
    titulo: "Desfazer o consumo desta linha?",
    texto:
      "Desfazer o consumo é uma errata: a linha volta ao faturamento, o valor volta ao saldo de origem e o job volta para a revisão da abertura.",
    par: parFaturamento(0),
    bloqueio: null,
    rotuloConfirmar: "Desfazer consumo",
    enviaParaRevisao: false,
    executar: () => acoes.onRetirar({ jobItemOrcadoId: linha.id }),
  };
}

function Pastilha({
  children,
  destaque,
}: {
  children: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px]",
        destaque
          ? "border-[#c9c6bf] bg-[#f3f2ee] font-mono font-semibold text-foreground"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** A situação do pedido, no mesmo formato do `ChipSituacao` do rodapé do
 *  job (protótipo aprovado da decisão 099). */
const CHIP_DO_SAVE: Record<Exclude<SituacaoDoSave, "sem_save">, [string, string]> = {
  aguardando: ["border-amber-200 bg-amber-50 text-amber-700", "Aguardando aprovação"],
  aprovado: ["border-emerald-200 bg-emerald-50 text-emerald-700", "Aprovado"],
  recusado: [
    "border-california-red/25 bg-california-red/5 text-california-red",
    "Recusado",
  ],
  nao_enviado: ["border-border bg-muted text-muted-foreground", "Ainda não enviado"],
};

function ChipDoSave({
  situacao,
  jobCancelado,
}: {
  situacao: Exclude<SituacaoDoSave, "sem_save">;
  /** No job cancelado a linha sem pedido ativo não vai mais para a fila:
   *  o chip diz isso, e não "Ainda não enviado" (22/09/2026). */
  jobCancelado: boolean;
}) {
  const [classes, rotuloDaSituacao] = CHIP_DO_SAVE[situacao];
  const rotulo =
    jobCancelado && situacao === "nao_enviado" ? "Job cancelado" : rotuloDaSituacao;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        classes,
      )}
    >
      {rotulo}
    </span>
  );
}

/** A porta fechada — o mesmo aviso âmbar dos meses já enviados. */
function AvisoTrava({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
      <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" />
      <span>{children}</span>
    </div>
  );
}

/** "Situação do save" / "Situação do consumo", no topo da aba. */
function SituacaoBloco({
  tipo,
  situacao,
  jobCancelado,
  texto,
  justificativa,
  historico,
}: {
  tipo: "gera" | "consome";
  situacao: Exclude<SituacaoDoSave, "sem_save">;
  jobCancelado: boolean;
  texto: string;
  justificativa: string | null;
  historico: EntradaDoHistorico[];
}) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-xs leading-relaxed">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          Situação {tipo === "gera" ? "do save" : "do consumo"}
        </p>
        <ChipDoSave situacao={situacao} jobCancelado={jobCancelado} />
      </div>
      <p className="mt-1 text-muted-foreground">{texto}</p>
      {justificativa && (
        <div className="mt-2 rounded-lg border border-california-red/20 bg-white px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-california-red">
            Justificativa do financeiro
          </p>
          <p className="mt-0.5 italic text-foreground">“{justificativa}”</p>
        </div>
      )}
      {historico.length > 0 && (
        <ol className="mt-2.5 space-y-1 border-t border-border pt-2.5">
          {historico.map((h, i) => (
            <li key={`${h.em}-${i}`} className="flex gap-3">
              <span className="w-[92px] flex-none font-mono text-[11px] text-muted-foreground">
                {dataHoraCurta(h.em)}
              </span>
              <span className="text-foreground">{h.texto}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Antes → depois, com o delta — a mesma forma da barra da errata. */
function Par({
  rotulo,
  antes,
  depois,
  moeda,
  forte,
}: {
  rotulo: string;
  antes: number;
  depois: number;
  moeda: string;
  forte?: boolean;
}) {
  // Arredonda antes de subtrair, como a barra da errata: o delta fecha com
  // os dois valores ao lado dele.
  const centavos = (n: number) => Math.round(n * 100);
  const delta = (centavos(depois) - centavos(antes)) / 100;
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span
        className={cn(
          "text-[12.5px]",
          forte ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {rotulo}
      </span>
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-mono text-[11.5px] text-muted-foreground line-through">
          {formatCurrency(antes, moeda)}
        </span>
        <span
          className={cn(
            "font-mono font-bold text-foreground",
            forte ? "text-[13.5px]" : "text-[12.5px]",
          )}
        >
          {formatCurrency(depois, moeda)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
          {comSinal(delta, moeda)}
        </span>
      </div>
    </div>
  );
}

function ModoGerar({
  orcado,
  faturamento,
  moeda,
  percentualHonorarios,
  percentualImposto,
  internacional,
  estado,
  deCliente,
  contextoJob,
  situacao,
  rotuloCredito,
  mostraDestino,
  trava,
}: {
  orcado: number;
  faturamento: number;
  moeda: string;
  percentualHonorarios: number;
  percentualImposto: number;
  internacional: ParametrosInternacionais | null;
  estado: EstadoSaveDaLinha;
  /** "de Aurora Bebidas", ou "do cliente" sem o nome. */
  deCliente: string;
  /** O pop-up está no job (decisão 099): texto e avisos do job. */
  contextoJob: boolean;
  situacao: React.ReactNode;
  rotuloCredito: string;
  mostraDestino: boolean;
  /** Por que a linha não vira save agora. `null` sem trava. */
  trava: string | null;
}) {
  return (
    <div className="space-y-4">
      {situacao}
      <div className="flex items-start gap-2.5">
        <ArrowUpRight className="mt-0.5 h-4 w-4 flex-none text-[#5f5d57]" />
        <div>
          <p className="text-sm font-semibold">Esta linha vira save</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            O cliente paga o valor nesta nota, o serviço não acontece neste
            projeto, e o valor vira crédito {deCliente} para um projeto
            seguinte. A linha sai do valor do job e continua no faturamento.
            {contextoJob &&
              " O crédito só fica disponível para outros jobs depois que o financeiro aprovar."}
          </p>
        </div>
      </div>

      {/* No job, gerar save em linha com consumo é recusado (decisão 099):
          quem fala é a trava, lá embaixo, e não este aviso. */}
      {!contextoJob && estado.origens.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-california-red/30 bg-california-red/5 px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-california-red" />
          <p className="text-xs leading-relaxed text-foreground">
            Esta linha hoje é paga com saldo de{" "}
            {estado.origens.length === 1 ? "um job" : `${estado.origens.length} jobs`}.
            Marcá-la como save desfaz esses consumos e devolve{" "}
            <strong>{formatCurrency(estado.saveConsumido, moeda)}</strong> aos
            saldos de origem.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Numero rotulo={rotuloCredito} valor={orcado} moeda={moeda} forte />
        <Numero
          rotulo="Faturamento desta linha"
          valor={faturamento}
          moeda={moeda}
          nota={
            internacional
              ? `orçado + fee ${pct(percentualHonorarios)}% + int. taxes ${pct(internacional.percentualIntTaxes)}% + impostos BR ${pct(percentualImposto)}%`
              : `orçado + honorários ${pct(percentualHonorarios)}% + impostos ${pct(percentualImposto)}%`
          }
        />
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        São dois números, e os dois são verdadeiros: o{" "}
        <strong>crédito</strong> é o que o cliente tem a gastar depois; o{" "}
        <strong>faturamento</strong> é o que esta nota cobra por causa desta
        linha.
      </p>

      {mostraDestino && (
        <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-xs leading-relaxed">
          {estado.destinos.length > 0 ? (
            <>
              <p className="font-semibold">
                O saldo deste job já foi consumido
              </p>
              <p className="mt-1 text-muted-foreground">
                O consumo é feito na planilha do job que gasta, sobre o saldo{" "}
                {deCliente}:{" "}
                {estado.destinos
                  .map((d) => `${d.codigo} ${formatCurrency(d.valor, moeda)}`)
                  .join(" · ")}
                .
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">
                Crédito ainda no saldo {deCliente}
              </p>
              <p className="mt-1 text-muted-foreground">
                Fica disponível como saldo do cliente. Quem consome é o
                próximo job, na planilha dele.
              </p>
            </>
          )}
        </div>
      )}

      {trava && (
        <div className="pb-3">
          <AvisoTrava>{trava}</AvisoTrava>
        </div>
      )}
    </div>
  );
}

function ModoConsumir({
  origens,
  setOrigens,
  saldos,
  saldoDe,
  livreDe,
  naoEscolhidos,
  moeda,
  orcado,
  totalConsumido,
  sobra,
  passouDoOrcado,
  editavel,
  pontasConhecidas,
  mostraLivre,
  consumoRecusado,
  contextoJob,
  situacao,
  trava,
  nota,
}: {
  origens: OrigemNaTela[];
  setOrigens: React.Dispatch<React.SetStateAction<OrigemNaTela[]>>;
  saldos: SaldoDeSave[];
  saldoDe: (id: string) => SaldoDeSave | undefined;
  /** Saldo do job de origem COM o consumo desta linha devolvido. */
  livreDe: (id: string) => number;
  naoEscolhidos: SaldoDeSave[];
  moeda: string;
  orcado: number;
  totalConsumido: number;
  sobra: number;
  passouDoOrcado: boolean;
  editavel: boolean;
  /** O consumo gravado e, no consumo recusado, as origens do pedido — dão
   *  o código da origem quando a lista de saldos não a traz (leitura, ou
   *  saldo de origem já todo usado). */
  pontasConhecidas: PontaDeSave[];
  /** "livre · sobra" de cada origem. Desligado na leitura do job, que não
   *  tem a lista de saldos, e no consumo recusado, que não reserva nada
   *  (decisão 099, 22/09/2026). */
  mostraLivre: boolean;
  /** A aba mostra o consumo de um pedido RECUSADO, travado: a linha voltou
   *  ao faturamento, então nada aqui é "consumido" (decisão 099). */
  consumoRecusado: boolean;
  /** O pop-up está no job (decisão 099). */
  contextoJob: boolean;
  situacao: React.ReactNode;
  /** Por que o consumo não muda agora. `null` sem trava. */
  trava: string | null;
  /** Explicação curta abaixo do total (consumo aguardando). */
  nota: string | null;
}) {
  const [adicionando, setAdicionando] = React.useState(false);

  // Sem consumo a mostrar e com a porta fechada, o aviso é a aba inteira.
  if (trava && origens.length === 0) {
    return (
      <div>
        {situacao}
        <div className="pb-4">
          <AvisoTrava>{trava}</AvisoTrava>
        </div>
      </div>
    );
  }

  // No job, a linha que já consome mostra o consumo mesmo sem saldo novo
  // a oferecer (decisão 099): o saldo de origem pode ter acabado.
  if (saldos.length === 0 && (!contextoJob || origens.length === 0)) {
    return (
      <div>
        {situacao}
        <p className="py-6 text-center text-sm text-muted-foreground">
          Este cliente ainda não tem saldo de save aprovado. O crédito nasce
          quando o financeiro aprova um save de outro job dele.
        </p>
      </div>
    );
  }

  return (
    <div>
      {situacao}
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {consumoRecusado ? "Saldos do consumo recusado" : "Saldos usados nesta linha"}
      </p>

      <div className="flex flex-col gap-2">
        {origens.map((o, i) => {
          const s = saldoDe(o.jobOrigemId);
          const conhecida = pontasConhecidas.find((p) => p.jobId === o.jobOrigemId);
          const livre = livreDe(o.jobOrigemId);
          const sobraDoJob = livre - o.valor;
          return (
            <div
              key={o.jobOrigemId}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3.5 rounded-xl border border-[#d7d5cf] bg-muted/20 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-mono text-xs font-bold">
                  {s?.codigo ?? conhecida?.codigo ?? "—"}
                </span>
                {/* Sem a lista de saldos o nome não vem: fica só o código. */}
                {s?.nome && <span className="text-[13px]">{s.nome}</span>}
                {mostraLivre && (
                  <span
                    className={cn(
                      "text-[11.5px]",
                      sobraDoJob < -0.005
                        ? "font-semibold text-california-red"
                        : "text-muted-foreground",
                    )}
                  >
                    livre {formatCurrency(livre, moeda)} · sobra{" "}
                    {formatCurrency(sobraDoJob, moeda)}
                  </span>
                )}
              </div>
              <input
                inputMode="decimal"
                defaultValue={o.valor.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                })}
                disabled={!editavel}
                onBlur={(e) => {
                  const v = paraNumero(e.target.value);
                  setOrigens((prev) =>
                    prev.map((p, j) => (j === i ? { ...p, valor: v } : p)),
                  );
                  e.target.value = v.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  });
                }}
                className="h-[34px] w-[150px] rounded-lg border border-[#c9c6bf] px-2.5 text-right font-mono text-[13.5px] font-bold outline-none focus:border-california-red disabled:opacity-60"
              />
              {editavel && (
                <button
                  type="button"
                  title="Remover esta origem"
                  onClick={() =>
                    setOrigens((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="ml-1 rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}

        {/* Sem nenhum saldo escolhido, o gatilho é um convite — "Selecionar
            job", sem o "+", porque não há a que ACRESCENTAR. Com um saldo
            já em uso ele vira "+ Selecionar outro job". O rótulo anterior
            ("+ Adicionar outro job") dizia "outro" para uma lista vazia
            (31/08/2026). */}
        {editavel && naoEscolhidos.length > 0 && !adicionando && (
          <button
            type="button"
            onClick={() => setAdicionando(true)}
            className="inline-flex items-center gap-1.5 self-start rounded-[10px] border border-dashed border-[#c9c6bf] bg-card px-3 py-2 text-xs font-semibold text-[#5f5d57] hover:border-[#5f5d57]"
          >
            {origens.length > 0 && <Plus className="h-3 w-3" />}
            {origens.length === 0
              ? "Selecionar job"
              : "Selecionar outro job"}
          </button>
        )}

        {adicionando && (
          <div className="rounded-xl border border-dashed border-[#c9c6bf] p-2">
            <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Saldos disponíveis deste cliente
            </p>
            <div className="flex flex-col">
              {naoEscolhidos.map((s) => (
                <button
                  key={s.jobId}
                  type="button"
                  onClick={() => {
                    // Entra já com o que falta para cobrir a linha, limitado
                    // ao que o job tem: é o preenchimento que quase sempre
                    // está certo, e ainda dá para editar.
                    const falta = Math.max(orcado - totalConsumido, 0);
                    setOrigens((prev) => [
                      ...prev,
                      {
                        jobOrigemId: s.jobId,
                        valor: Math.min(falta, s.disponivel),
                      },
                    ]);
                    setAdicionando(false);
                  }}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-bold">
                      {s.codigo}
                    </span>
                    <span className="text-[13px]">{s.nome}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatCurrency(s.disponivel, moeda)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3.5 grid grid-cols-[1fr_auto] items-baseline gap-x-4">
        <span className="border-t border-border py-2.5 text-sm font-bold">
          {consumoRecusado ? "Total do consumo recusado" : "Total consumido"}
        </span>
        <span
          className={cn(
            "whitespace-nowrap border-t border-border py-2.5 text-right font-mono text-[17px] font-bold",
            passouDoOrcado && "text-california-red",
          )}
        >
          {formatCurrency(totalConsumido, moeda)}
        </span>
        {/* Recusado, a linha inteira voltou ao faturamento: as duas notas
            abaixo falariam de um consumo que não existe mais. */}
        <span className="pb-2.5 text-[12.5px] text-muted-foreground">
          {/* O design pedia que fechasse exato com o orçado; o Tiago manteve
              o consumo parcial da decisão 028 §6 — o que sobra é faturado
              normalmente. */}
          {consumoRecusado
            ? "o financeiro recusou este consumo: a linha segue faturada"
            : passouDoOrcado
              ? "não pode passar do orçado da linha"
              : sobra > 0.005
                ? "o que sobrar do orçado segue faturado normalmente"
                : "cobre o orçado inteiro da linha"}
        </span>
        {consumoRecusado ? (
          <span />
        ) : (
          <span
            className={cn(
              "flex items-center justify-end gap-1.5 pb-2.5 text-[11.5px] font-semibold",
              passouDoOrcado ? "text-california-red" : "text-muted-foreground",
            )}
          >
            <ArrowDownLeft className="h-3 w-3" />
            {passouDoOrcado
              ? `excede em ${formatCurrency(totalConsumido - orcado, moeda)}`
              : `faturado: ${formatCurrency(Math.max(sobra, 0), moeda)}`}
          </span>
        )}
      </div>

      {trava && (
        <div className="pb-4">
          <AvisoTrava>{trava}</AvisoTrava>
        </div>
      )}
      {nota && (
        <p className="pb-3 text-[11.5px] text-muted-foreground">{nota}</p>
      )}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  moeda,
  nota,
  forte,
}: {
  rotulo: string;
  valor: number;
  moeda: string;
  nota?: string;
  forte?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-3.5 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-1 font-mono font-bold",
          forte ? "text-[19px]" : "text-[17px]",
        )}
      >
        {formatCurrency(valor, moeda)}
      </p>
      {nota && (
        <p className="mt-0.5 text-[10.5px] text-muted-foreground">{nota}</p>
      )}
    </div>
  );
}
