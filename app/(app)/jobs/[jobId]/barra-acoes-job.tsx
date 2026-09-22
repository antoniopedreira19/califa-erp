"use client";

/* Client desde 27/08/2026 por uma razão só: ler `useModoErrata` e sair de
 * cena enquanto a barra da errata está no ar. Todas as props já eram dados
 * puros — os filhos (drawer de faturamento, diálogos) são client. */

import * as React from "react";
import Link from "next/link";
import { FileText, Send } from "lucide-react";
import type { ItemPlanilhaJob, JobStatus } from "@/lib/types";
import { jobStatusLabel } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EnviarFaturamentoDrawer, type PortalOption } from "./enviar-faturamento-drawer";
import { useModoErrataAtivo } from "./modo-errata";
import { BarraFaturamentoMensal } from "./barra-faturamento-mensal";
import type {
  FaturamentoDoEnvioUnico,
  MesDeFaturamento,
} from "@/lib/calculos/faturamento-por-mes";
import {
  ChipSituacao,
  VerEnvioFaturamentoDialog,
  dataBr,
  dataDoEnvio,
} from "./envio-faturamento-ui";
import { TextoTrilha, TrilhaBarra } from "./trilha-barra";
import {
  EnviarEncerramentoDialog,
  type FechamentoDoJob,
  type TotaisDoFechamento,
} from "./enviar-encerramento-dialog";
import {
  situacaoDoSave,
  type EstadoSaveDaLinha,
} from "@/app/(app)/_planilha/save-coluna";

interface Props {
  jobId: string;
  jobCodigo: string;
  status: JobStatus;
  /** Tela do orçamento de origem, na versão aprovada. É lá que o envio à
   *  abertura se revisa e se cancela (decisão 057). */
  orcamentoHref: string;
  podeEnviarFaturamento: boolean;
  /**
   * Uma errata mexeu no orçado depois da abertura e o financeiro ainda não
   * reconferiu. O job segue aberto e a produção segue trabalhando — o que
   * fecha é o envio para faturamento (27/08/2026) e, desde 02/09/2026, o
   * envio de PPs ao financeiro (decisão 040).
   */
  aberturaEmRevisao?: boolean;
  faturamentoPrevisto: number;
  /** Quanto do faturamento previsto é saldo em save. */
  faturamentoSavePrevisto?: number;
  /** Job pago inteiramente com crédito de outro job (decisão 028 §11). */
  pagoSoPorSave?: boolean;
  dataPrevistaFaturamento: string | null;
  portais: PortalOption[];
  moeda: string;
  /** Fee e Always On (modelo mensal, decisão 078): faturam mês a mês. */
  faturamentoPorMes?: boolean;
  faturamentoMensal?: MesDeFaturamento[];
  podeEnviarFaturamentoMensal?: boolean;
  /** O envio único do job normal, as notas e a situação (decisão 087). */
  faturamentoEnvioUnico: FaturamentoDoEnvioUnico | null;
  /** O fechamento: travas, o que falta faturar e quem encerrou. Nulo antes
   *  da abertura. */
  fechamento: FechamentoDoJob | null;
  /** Os dados do card de Totais do fechamento. */
  totais: TotaisDoFechamento;
  /** Papel com `jobs.encerrar`. O servidor confere de novo. */
  podeEncerrar: boolean;
  /** O save de cada linha, o mesmo da Planilha Interna (decisão 099). É
   *  dele que saem os pedidos que ainda seguram o envio para faturamento e
   *  o encerramento — a barra só explica; `enviarParaFaturamento` e
   *  `encerrarJob` refazem a conta no servidor. */
  savePorItem: Record<string, EstadoSaveDaLinha>;
}

/** Uma linha com save ou consumo nunca enviado para aprovação. `comRecusa`:
 *  ela tem pedido recusado ainda não arquivado, e o botão "Enviar saves
 *  para aprovação" não a envia até o GP retirar a recusa. */
interface LinhaNaoEnviada {
  item: string;
  comRecusa: boolean;
}

/** Os saves que ainda seguram o job (decisão 099 §17), pelo nome do item. */
interface PendenciasDeSave {
  savesAguardando: string[];
  consumosAguardando: string[];
  /** Save gerado ou consumo nunca enviado: segura o encerramento. */
  naoEnviados: LinhaNaoEnviada[];
  /** Só o consumo nunca enviado: segura também o envio para faturamento. */
  consumosNaoEnviados: LinhaNaoEnviada[];
}

function pendenciasDeSave(
  itens: ItemPlanilhaJob[],
  savePorItem: Record<string, EstadoSaveDaLinha>,
): PendenciasDeSave {
  const p: PendenciasDeSave = {
    savesAguardando: [],
    consumosAguardando: [],
    naoEnviados: [],
    consumosNaoEnviados: [],
  };
  for (const it of itens) {
    const e = savePorItem[it.id];
    if (!e) continue;
    const gera = situacaoDoSave(e, "gera");
    const consome = situacaoDoSave(e, "consome");
    if (gera === "aguardando") p.savesAguardando.push(it.item);
    if (consome === "aguardando") p.consumosAguardando.push(it.item);

    // "Não enviado" por lado da linha, o mesmo recorte do servidor
    // (`encerrarJob`, `enviarJobParaFaturamento`; revisão de 22/09/2026):
    // save gerado sem pedido de gera aguardando ou aprovado, ou consumo sem
    // pedido de consumo aguardando ou aprovado. Não sai de `situacaoDoSave`,
    // que põe a recusa na frente: depois de uma edição de consumo recusada
    // a linha volta ao consumo de antes — que pode nunca ter sido aprovado
    // — e escapava da trava.
    const pedidos = e.pedidos;
    const enviado = (tipo: "gera" | "consome") =>
      pedidos?.aguardando?.tipo === tipo || pedidos?.aprovado?.tipo === tipo;
    const geraNaoEnviado = e.emSave && !enviado("gera");
    const consomeNaoEnviado = e.origens.length > 0 && !enviado("consome");
    const linha: LinhaNaoEnviada = {
      item: it.item,
      comRecusa: pedidos?.recusado != null,
    };
    if (geraNaoEnviado || consomeNaoEnviado) p.naoEnviados.push(linha);
    if (consomeNaoEnviado) p.consumosNaoEnviados.push(linha);
  }
  return p;
}

/** "; em “Item”, retire antes a recusa…" — o complemento das pendências
 *  de save nunca enviado quando alguma linha tem recusa a retirar. */
function complementoDaRecusa(linhas: LinhaNaoEnviada[]): string {
  const comRecusa = linhas.filter((l) => l.comRecusa).map((l) => `“${l.item}”`);
  return comRecusa.length > 0
    ? `; em ${comRecusa.join(", ")}, retire antes a recusa no pop-up de save da linha`
    : "";
}

/** Trilha Faturamento com consumo de save nunca enviado para aprovação —
 *  o mesmo texto de `enviarJobParaFaturamento`, sem link para o
 *  financeiro (decisão 099). */
function textoConsumosNaoEnviados(linhas: LinhaNaoEnviada[]): string {
  const n = linhas.length;
  const lista = linhas.map((l) => l.item).join(", ");
  const comRecusa = linhas.filter((l) => l.comRecusa).map((l) => `“${l.item}”`);
  const partes = [
    n === 1
      ? `1 consumo de save ainda não foi enviado para aprovação do financeiro (${lista}).`
      : `${n} consumos de save ainda não foram enviados para aprovação do financeiro (${lista}).`,
  ];
  if (comRecusa.length < n) {
    partes.push("Envie pelo botão “Enviar saves para aprovação”, acima da planilha.");
  }
  if (comRecusa.length > 0) {
    partes.push(
      `Em ${comRecusa.join(", ")}, retire antes a recusa no pop-up de save da linha: o botão “Enviar saves para aprovação” não envia linha com recusa.`,
    );
  }
  partes.push(
    "O envio para faturamento volta quando o financeiro decidir: o consumo muda o faturamento previsto.",
  );
  return partes.join(" ");
}

/** Trilha Faturamento com consumo de save aguardando (texto da spec da
 *  decisão 099, §3). */
function textoConsumosAguardando(itens: string[]): string {
  const n = itens.length;
  const lista = itens.join(", ");
  return n === 1
    ? `1 consumo de save aguarda aprovação do financeiro (${lista}). O envio para faturamento volta quando ele for decidido: o consumo muda o faturamento previsto.`
    : `${n} consumos de save aguardam aprovação do financeiro (${lista}). O envio para faturamento volta quando eles forem decididos: o consumo muda o faturamento previsto.`;
}

/** Trilha Faturamento com a revisão da abertura pendente — sem link: a
 *  produção não navega para o financeiro (decisão 099 §20). */
const TEXTO_REVISAO_PENDENTE =
  "Uma errata ou um pedido de save mexeu no job depois da abertura, e o financeiro ainda não reconferiu a abertura. O envio para faturamento volta quando a revisão for salva.";

/**
 * Barra fixa de ações do job — handoff "Job · Informações — Barra de ações"
 * (19/08/2026), no mesmo padrão da barra de aprovação do orçamento
 * (`fluxo-abertura.tsx`).
 *
 * Desde 16/09/2026 (decisão 087) a barra do job já aberto tem DUAS TRILHAS:
 * "Faturamento" e "Encerramento". As duas frentes correm separadas — o job
 * pode ser enviado para faturamento sem estar encerrado e encerrado sem ter
 * sido enviado — e fica FINALIZADO quando as duas ações foram feitas (desde
 * 20/09/2026, decisão 094, o que conta é o envio, não a nota; enquanto só
 * uma foi feita o selo é "Em faturamento" ou "Encerrado"). Cada trilha diz
 * onde está a sua
 * frente, mostra o "Ver envio" dela e carrega a própria ação.
 *
 * Antes da abertura (aguardando ou devolvido) a barra continua com uma
 * linha: não há faturamento nem encerramento a mostrar.
 *
 * "Cancelar job" NÃO mora aqui (decisão 057, 08/09/2026).
 */
export function BarraAcoesJob({
  jobId,
  jobCodigo,
  status,
  orcamentoHref,
  podeEnviarFaturamento,
  aberturaEmRevisao = false,
  faturamentoPrevisto,
  faturamentoSavePrevisto = 0,
  pagoSoPorSave = false,
  dataPrevistaFaturamento,
  portais,
  moeda,
  faturamentoPorMes = false,
  faturamentoMensal = [],
  podeEnviarFaturamentoMensal = false,
  faturamentoEnvioUnico,
  fechamento,
  totais,
  podeEncerrar,
  savePorItem,
}: Props) {
  // Enquanto a errata está aberta quem fala no rodapé é a barra dela: o
  // design tem UMA barra com três estados, não duas empilhadas.
  const errataAberta = useModoErrataAtivo();
  if (errataAberta) return null;

  const duasTrilhas =
    fechamento !== null &&
    (status === "aberto" ||
      status === "em_producao" ||
      status === "encerrado" ||
      status === "finalizado");

  if (!duasTrilhas) {
    return (
      <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-4 rounded-t-2xl border border-b-0 border-border bg-white/95 px-5 py-2 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {linhasAntesDaAbertura(status, orcamentoHref).map((linha, i) => (
            <span key={i} className="text-xs text-muted-foreground">
              {linha}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const saves = pendenciasDeSave(totais.itens, savePorItem);

  const trilhaEncerramento = (
    <TrilhaEncerramento
      jobId={jobId}
      jobCodigo={jobCodigo}
      status={status}
      fechamento={fechamento}
      totais={totais}
      podeEncerrar={podeEncerrar}
      saves={saves}
      aberturaEmRevisao={aberturaEmRevisao}
    />
  );

  // O que fecha o envio para faturamento agora. O consumo aguardando fala
  // primeiro, como no servidor: é o motivo mais específico, e a decisão do
  // financeiro (que registra a revisão) destrava os dois (decisão 099 §17).
  // No mensal ele fecha todos os meses — o lado conservador, o mesmo de
  // `enviarParaFaturamento`. Depois dele, o consumo nunca enviado para
  // aprovação, na mesma ordem do servidor.
  const bloqueioFaturamento: string | null =
    saves.consumosAguardando.length > 0
      ? textoConsumosAguardando(saves.consumosAguardando)
      : saves.consumosNaoEnviados.length > 0
        ? textoConsumosNaoEnviados(saves.consumosNaoEnviados)
        : aberturaEmRevisao
          ? TEXTO_REVISAO_PENDENTE
          : null;

  // Modelo mensal: a barra de faturamento por mês (design aprovado em
  // 14/09/2026) é a trilha de faturamento, com a de encerramento abaixo.
  if (faturamentoPorMes && faturamentoMensal.length > 0) {
    return (
      <BarraFaturamentoMensal
        jobId={jobId}
        jobCodigo={jobCodigo}
        meses={faturamentoMensal}
        podeEnviar={podeEnviarFaturamentoMensal}
        bloqueio={bloqueioFaturamento}
        portais={portais}
        moeda={moeda}
        trilhaEncerramento={trilhaEncerramento}
        jobEncerrado={status === "encerrado"}
      />
    );
  }

  return (
    <div className="sticky bottom-0 z-20 -mx-1 rounded-t-2xl border border-b-0 border-border bg-white/95 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur">
      <TrilhaFaturamentoUnico
        jobId={jobId}
        jobCodigo={jobCodigo}
        faturamento={faturamentoEnvioUnico}
        podeEnviarFaturamento={podeEnviarFaturamento && bloqueioFaturamento === null}
        bloqueio={bloqueioFaturamento}
        faturamentoPrevisto={faturamentoPrevisto}
        faturamentoSavePrevisto={faturamentoSavePrevisto}
        pagoSoPorSave={pagoSoPorSave}
        dataPrevistaFaturamento={dataPrevistaFaturamento}
        portais={portais}
        moeda={moeda}
      />
      {trilhaEncerramento}
    </div>
  );
}

const FORTE = "font-semibold text-foreground";
const MONO = "font-mono font-semibold text-foreground";

function BotaoVerEnvio({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-border bg-white px-3 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
    >
      <FileText className="h-3.5 w-3.5" />
      Ver envio
    </button>
  );
}

/** A trilha "Faturamento" do job que não é mensal: um envio só. */
function TrilhaFaturamentoUnico({
  jobId,
  jobCodigo,
  faturamento,
  podeEnviarFaturamento,
  bloqueio,
  faturamentoPrevisto,
  faturamentoSavePrevisto,
  pagoSoPorSave,
  dataPrevistaFaturamento,
  portais,
  moeda,
}: {
  jobId: string;
  jobCodigo: string;
  faturamento: FaturamentoDoEnvioUnico | null;
  podeEnviarFaturamento: boolean;
  /** Consumo de save aguardando ou revisão da abertura pendente. */
  bloqueio: string | null;
  faturamentoPrevisto: number;
  faturamentoSavePrevisto: number;
  pagoSoPorSave: boolean;
  dataPrevistaFaturamento: string | null;
  portais: PortalOption[];
  moeda: string;
}) {
  const [verEnvio, setVerEnvio] = React.useState(false);
  const situacao = faturamento?.situacao ?? "a_enviar";
  const envio = faturamento?.envio ?? null;

  let texto: React.ReactNode;
  let acoes: React.ReactNode = null;

  if (!envio) {
    if (situacao === "sem_faturamento") {
      texto = pagoSoPorSave
        ? "Pago com saldo em save de outro job: a nota já saiu lá, e não há o que enviar."
        : "Este job não tem faturamento previsto: não há nota a emitir.";
    } else if (bloqueio) {
      texto = bloqueio;
    } else {
      texto = (
        <>
          Faturamento previsto{" "}
          <strong className={MONO}>{formatCurrency(faturamentoPrevisto, moeda)}</strong>.
          Enviar para faturamento libera o financeiro a emitir a nota.
        </>
      );
      if (podeEnviarFaturamento) {
        acoes = (
          <EnviarFaturamentoDrawer
            jobId={jobId}
            jobCodigo={jobCodigo}
            valorFaturado={faturamentoPrevisto}
            valorSave={faturamentoSavePrevisto}
            dataPrevistaFaturamento={dataPrevistaFaturamento}
            portais={portais}
            moeda={moeda}
          />
        );
      }
    }
  } else {
    const n = envio.parcelas.length;
    const primeira = envio.parcelas[0]?.data_vencimento ?? null;
    const ultimaNota =
      faturamento && faturamento.notas.length > 0
        ? faturamento.notas[faturamento.notas.length - 1].dataEmissao
        : null;
    texto = (
      <>
        Enviado em <strong className={MONO}>{dataDoEnvio(envio.enviado_em)}</strong> ·{" "}
        {n === 1 ? (
          <>
            1 parcela, vencimento{" "}
            <strong className={MONO}>{primeira ? dataBr(primeira) : "—"}</strong>
          </>
        ) : (
          <>
            {n} parcelas, a primeira vencendo em{" "}
            <strong className={MONO}>{primeira ? dataBr(primeira) : "—"}</strong>
          </>
        )}{" "}
        ·{" "}
        {situacao === "na_fila" ? (
          <>
            <strong className={FORTE}>
              {formatCurrency(envio.valor_faturado, moeda)}
            </strong>{" "}
            ainda sem nota.
          </>
        ) : situacao === "faturado_parcial" ? (
          <>
            <strong className={FORTE}>
              {formatCurrency(faturamento?.faturado ?? 0, moeda)}
            </strong>{" "}
            de{" "}
            <strong className={FORTE}>
              {formatCurrency(envio.valor_faturado, moeda)}
            </strong>{" "}
            em nota emitida.
          </>
        ) : (
          <>
            <strong className={FORTE}>
              {formatCurrency(envio.valor_faturado, moeda)}
            </strong>{" "}
            em nota emitida
            {ultimaNota ? (
              <>
                {" "}
                · última nota em <strong className={MONO}>{dataBr(ultimaNota)}</strong>
              </>
            ) : null}
            .
          </>
        )}
      </>
    );
    acoes = <BotaoVerEnvio onClick={() => setVerEnvio(true)} />;
  }

  return (
    <>
      <TrilhaBarra rotulo="Faturamento" acoes={acoes}>
        <ChipSituacao situacao={situacao} />
        <TextoTrilha>{texto}</TextoTrilha>
      </TrilhaBarra>
      <VerEnvioFaturamentoDialog
        aberto={verEnvio}
        onOpenChange={setVerEnvio}
        titulo={`Envio para faturamento · ${jobCodigo}`}
        descricao={
          envio
            ? `Enviado para faturamento em ${dataDoEnvio(envio.enviado_em)}. O envio é definitivo: não há mais errata nem consumo de save neste job.`
            : ""
        }
        envio={envio}
        situacao={situacao}
        notas={faturamento?.notas ?? []}
        moeda={moeda}
      />
    </>
  );
}

/** Só a frase abre com maiúscula: "revisão da abertura pendente…" pode ser
 *  a primeira pendência. */
function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Até 3 códigos por extenso; o resto vira "e mais N". */
function codigos(lista: string[]): string {
  if (lista.length <= 3) return lista.join(", ");
  return `${lista.slice(0, 3).join(", ")} e mais ${lista.length - 3}`;
}

/** A trilha "Encerramento" — igual no job normal e no mensal. */
function TrilhaEncerramento({
  jobId,
  jobCodigo,
  status,
  fechamento,
  totais,
  podeEncerrar,
  saves,
  aberturaEmRevisao,
}: {
  jobId: string;
  jobCodigo: string;
  status: JobStatus;
  fechamento: FechamentoDoJob;
  totais: TotaisDoFechamento;
  podeEncerrar: boolean;
  /** Pedidos de save que o financeiro ainda não decidiu e linhas nunca
   *  enviadas (decisão 099 §17). */
  saves: PendenciasDeSave;
  aberturaEmRevisao: boolean;
}) {
  const [aberto, setAberto] = React.useState(false);
  const encerrado = status === "encerrado" || status === "finalizado";

  if (encerrado) {
    return (
      <>
        <TrilhaBarra
          rotulo="Encerramento"
          separada
          acoes={<BotaoVerEnvio onClick={() => setAberto(true)} />}
        >
          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
            {jobStatusLabel("encerrado")}
          </span>
          <TextoTrilha>
            {fechamento.encerradoEm ? (
              <>
                Enviado para encerramento em{" "}
                <strong className={MONO}>
                  {new Date(fechamento.encerradoEm).toLocaleDateString("pt-BR")}
                </strong>
                {fechamento.encerradoPorNome ? ` por ${fechamento.encerradoPorNome}` : ""}.
                Não aceita edição, PP nem BV.
              </>
            ) : (
              "Job encerrado — é histórico. Não aceita edição, PP nem BV."
            )}
          </TextoTrilha>
        </TrilhaBarra>
        <EnviarEncerramentoDialog
          jobId={jobId}
          jobCodigo={jobCodigo}
          modo="ver"
          fechamento={fechamento}
          totais={totais}
          open={aberto}
          onOpenChange={setAberto}
        />
      </>
    );
  }

  const { ppsEmAberto, verbasEmAberto, bvsEmAberto, itensSemMarcacao } = fechamento;
  const partes: string[] = [];
  if (ppsEmAberto.length > 0) {
    partes.push(
      `${ppsEmAberto.length === 1 ? "1 PP em aberto" : `${ppsEmAberto.length} PPs em aberto`} (${codigos(ppsEmAberto.map((p) => p.codigo))})`,
    );
  }
  if (verbasEmAberto.length > 0) {
    partes.push(
      `${verbasEmAberto.length === 1 ? "1 verba de produção não concluída" : `${verbasEmAberto.length} verbas de produção não concluídas`} (${codigos(verbasEmAberto.map((v) => v.codigo))})`,
    );
  }
  if (bvsEmAberto.length > 0) {
    partes.push(
      `${bvsEmAberto.length === 1 ? "1 BV não recebido" : `${bvsEmAberto.length} BVs não recebidos`} (${codigos(bvsEmAberto.map((b) => b.item))})`,
    );
  }
  if (itensSemMarcacao.length > 0) {
    partes.push(
      itensSemMarcacao.length === 1
        ? "1 item de custo ainda não disse se sai mais PP"
        : `${itensSemMarcacao.length} itens de custo ainda não disseram se sai mais PP`,
    );
  }
  // Decisão 099 §17: depois do encerramento o save não muda mais, e um
  // pedido sem decisão ficaria assim para sempre. Textos da spec, sem link
  // para o financeiro.
  if (saves.savesAguardando.length > 0) {
    const n = saves.savesAguardando.length;
    partes.push(
      `${n === 1 ? "1 save aguardando" : `${n} saves aguardando`} aprovação do financeiro (${codigos(saves.savesAguardando)})`,
    );
  }
  if (saves.consumosAguardando.length > 0) {
    const n = saves.consumosAguardando.length;
    partes.push(
      `${n === 1 ? "1 consumo de save aguardando" : `${n} consumos de save aguardando`} aprovação do financeiro (${codigos(saves.consumosAguardando)})`,
    );
  }
  if (saves.naoEnviados.length > 0) {
    const n = saves.naoEnviados.length;
    partes.push(
      `${n === 1 ? "1 save ainda não enviado" : `${n} saves ainda não enviados`} para aprovação (${codigos(saves.naoEnviados.map((l) => l.item))})${complementoDaRecusa(saves.naoEnviados)}`,
    );
  }
  if (aberturaEmRevisao) {
    partes.push("revisão da abertura pendente no financeiro");
  }
  const liberado = partes.length === 0;

  const botao = (
    <button
      type="button"
      onClick={() => setAberto(true)}
      disabled={!liberado}
      className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[10px] bg-california-red px-4 text-[13px] font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Send className="h-4 w-4" />
      Enviar job para encerramento
    </button>
  );

  return (
    <>
      <TrilhaBarra
        rotulo="Encerramento"
        separada
        acoes={
          !podeEncerrar ? null : liberado ? (
            botao
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{botao}</span>
              </TooltipTrigger>
              <TooltipContent>
                Resolva as pendências ao lado antes de enviar
              </TooltipContent>
            </Tooltip>
          )
        }
      >
        {liberado ? (
          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            Liberado
          </span>
        ) : (
          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-california-red/25 bg-california-red/5 px-2 py-0.5 text-[11px] font-semibold text-california-red">
            {partes.length === 1 ? "1 pendência" : `${partes.length} pendências`}
          </span>
        )}
        <TextoTrilha>
          {liberado
            ? "Nenhuma PP em aberto, nenhum BV a receber, todos os itens marcados."
            : `${maiuscula(partes.join(" · "))}.`}
        </TextoTrilha>
      </TrilhaBarra>
      {liberado && (
        <EnviarEncerramentoDialog
          jobId={jobId}
          jobCodigo={jobCodigo}
          modo="enviar"
          fechamento={fechamento}
          totais={totais}
          open={aberto}
          onOpenChange={setAberto}
        />
      )}
    </>
  );
}

/** A barra de uma linha, antes da abertura e no job cancelado. */
function linhasAntesDaAbertura(
  status: JobStatus,
  orcamentoHref: string,
): React.ReactNode[] {
  if (status === "aguardando_abertura") {
    return [
      "Aguardando abertura pelo financeiro.",
      <>
        {/* Sem link: a produção não navega para o financeiro (decisão 099
            §20). O link para o orçamento fica. */}
        A conferência e a abertura acontecem na Central Financeira, em{" "}
        <strong className="font-medium text-foreground">Abertura de Job</strong>
        . Para cancelar o envio, use o{" "}
        <Link
          href={orcamentoHref}
          prefetch={false}
          className="font-medium text-california-red hover:underline"
        >
          orçamento
        </Link>
        . Gerar PP já está liberado; o envio de PPs ao financeiro é que
        volta com a abertura.
      </>,
    ];
  }

  if (status === "rejeitado_financeiro") {
    return [
      "Job devolvido pelo financeiro.",
      <>
        Revise a abertura pelo{" "}
        <Link
          href={orcamentoHref}
          prefetch={false}
          className="font-medium text-california-red hover:underline"
        >
          orçamento
        </Link>
        , com o motivo acima, e reenvie. Gerar PP segue liberado; o envio
        ao financeiro volta com a abertura.
      </>,
    ];
  }

  return [
    `Job ${jobStatusLabel(status).toLowerCase()} — é histórico. Não aceita edição, PP nem BV.`,
  ];
}
