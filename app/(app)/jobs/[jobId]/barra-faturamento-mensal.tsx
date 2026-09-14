"use client";

/**
 * Faturamento por mês na barra fixa do rodapé do job — Fee e Always On
 * (decisão 078, entrega 3; design "Planilha Fee e Always On", página Job,
 * aprovado em 14/09/2026).
 *
 * Recolhida: a situação de cada mês e o botão do mês mais antigo ainda a
 * enviar. Expandida: uma linha por mês, com o envio e as notas.
 *
 * Não existe devolução: o envio de um mês é definitivo, como o envio único
 * de hoje (Tiago, 14/09/2026). Por isso o desenho perdeu o estado
 * "Devolvido" e o "Revisar e reenviar".
 */

import * as React from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  MesDeFaturamento,
  SituacaoDoMes,
} from "@/lib/calculos/faturamento-por-mes";
import { nomeDoMes, rotuloMes } from "@/lib/calculos/meses-trimestre";
import {
  EnviarFaturamentoDrawer,
  type PortalOption,
} from "./enviar-faturamento-drawer";

const SITUACAO: Record<
  SituacaoDoMes,
  { rotulo: string; curto: string; classes: string }
> = {
  a_enviar: {
    rotulo: "A enviar",
    curto: "A enviar",
    classes: "border-border bg-muted text-muted-foreground",
  },
  na_fila: {
    rotulo: "Na fila do financeiro",
    curto: "Na fila",
    classes: "border-amber-200 bg-amber-50 text-amber-700",
  },
  faturado_parcial: {
    rotulo: "Faturado parcial",
    curto: "Parcial",
    classes: "border-blue-200 bg-blue-50 text-blue-700",
  },
  faturado: {
    rotulo: "Faturado",
    curto: "Faturado",
    classes: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  sem_faturamento: {
    rotulo: "Sem faturamento",
    curto: "Sem fatur.",
    classes: "border-dashed border-border bg-white text-muted-foreground",
  },
};

/** "2026-10-20" → "20/10/2026". */
function data(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join("/");
}

/** "2026-10-20" → "20/10". */
function diaMes(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** Instante do envio no fuso de quem olha. */
function dataDoEnvio(instante: string): string {
  return new Date(instante).toLocaleDateString("pt-BR");
}

function listaPtBr(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function Chip({ situacao, curto = false }: { situacao: SituacaoDoMes; curto?: boolean }) {
  const s = SITUACAO[situacao];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        s.classes,
      )}
    >
      {curto ? s.curto : s.rotulo}
    </span>
  );
}

function detalheDoMes(m: MesDeFaturamento, moeda: string): string {
  const envio = m.envio;
  if (!envio) {
    return m.situacao === "sem_faturamento"
      ? "Este mês não tem faturamento na planilha: não há o que enviar."
      : "Envie quando o cliente validar o mês.";
  }
  const n = envio.parcelas.length;
  const primeira = envio.parcelas[0]?.data_vencimento;
  if (m.situacao === "na_fila") {
    return `Enviado em ${dataDoEnvio(envio.enviado_em)} · ${
      n === 1
        ? `1 parcela, vencimento ${primeira ? data(primeira) : "—"}`
        : `${n} parcelas, a primeira vencendo em ${primeira ? data(primeira) : "—"}`
    }`;
  }
  if (m.situacao === "faturado_parcial") {
    return `${m.notas.length} de ${n} ${n === 1 ? "nota emitida" : "notas emitidas"} · ${formatCurrency(
      m.faturado,
      moeda,
    )} de ${formatCurrency(envio.valor_faturado, moeda)}`;
  }
  return `${m.notas.length === 1 ? "1 nota emitida" : `${m.notas.length} notas emitidas`}: ${listaPtBr(
    m.notas.map((nota) => `${formatCurrency(nota.valor, moeda)} (${diaMes(nota.dataEmissao)})`),
  )}`;
}

interface Props {
  jobId: string;
  jobCodigo: string;
  meses: MesDeFaturamento[];
  /** Permissão de enviar para faturamento, com o job aberto. */
  podeEnviar: boolean;
  /** Motivo que fecha o envio de todos os meses agora (abertura em
   *  revisão depois de errata). Nulo quando não há. */
  bloqueio: string | null;
  portais: PortalOption[];
  moeda: string;
  /** O botão de encerramento, quando ele existe. */
  acaoExtra?: React.ReactNode;
}

export function BarraFaturamentoMensal({
  jobId,
  jobCodigo,
  meses,
  podeEnviar,
  bloqueio,
  portais,
  moeda,
  acaoExtra,
}: Props) {
  const [aberta, setAberta] = React.useState(false);
  const [envioAberto, setEnvioAberto] = React.useState<MesDeFaturamento | null>(
    null,
  );

  const enviados = meses.filter((m) => m.envio !== null).length;
  const total = meses.reduce((s, m) => s + m.faturamento, 0);
  // O botão da barra recolhida é sempre o do mês mais antigo ainda a
  // enviar (design aprovado em 14/09/2026).
  const proximo = meses.find((m) => m.situacao === "a_enviar") ?? null;
  const podeEnviarMes = (m: MesDeFaturamento) =>
    podeEnviar && !bloqueio && m.situacao === "a_enviar" && m.faturamento > 0;

  const quemFatura =
    meses.length === 3
      ? "os três meses estiverem faturados"
      : meses.length === 2
        ? "os dois meses estiverem faturados"
        : "o mês estiver faturado";

  function botaoEnviar(m: MesDeFaturamento, contorno: boolean) {
    const nome = nomeDoMes(m.mes);
    return (
      <EnviarFaturamentoDrawer
        key={`enviar-${m.mesId}-${contorno ? "linha" : "barra"}`}
        jobId={jobId}
        jobCodigo={jobCodigo}
        valorFaturado={m.faturamento}
        valorSave={m.save}
        dataPrevistaFaturamento={null}
        portais={portais}
        moeda={moeda}
        mes={{ iso: m.mes, nome }}
        rotuloBotao={contorno ? "Enviar faturamento" : `Enviar faturamento de ${nome}`}
        botaoContorno={contorno}
      />
    );
  }

  const envio = envioAberto?.envio ?? null;

  return (
    <div className="sticky bottom-0 z-20 -mx-1 rounded-t-2xl border border-b-0 border-border bg-white/95 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur">
      {aberta && (
        <div className="max-h-[50vh] overflow-y-auto border-b border-border px-5 pb-2 pt-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Faturamento por mês</strong> ·{" "}
              {enviados} de {meses.length}{" "}
              {meses.length === 1 ? "mês enviado" : "meses enviados"} · faturamento
              previsto{" "}
              <span className="font-mono font-semibold text-foreground">
                {formatCurrency(total, moeda)}
              </span>
            </p>
          </div>
          <ul className="divide-y divide-border">
            {meses.map((m) => (
              <li
                key={m.mesId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5"
              >
                <span className="w-[150px] text-sm font-semibold">
                  {rotuloMes(m.mes)}
                </span>
                <span className="w-[140px] whitespace-nowrap font-mono text-sm font-semibold">
                  {formatCurrency(m.envio?.valor_faturado ?? m.faturamento, moeda)}
                </span>
                <Chip situacao={m.situacao} />
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {detalheDoMes(m, moeda)}
                </span>
                {m.envio ? (
                  <button
                    type="button"
                    onClick={() => setEnvioAberto(m)}
                    className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-border bg-white px-3 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Ver envio
                  </button>
                ) : podeEnviarMes(m) ? (
                  botaoEnviar(m, true)
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              Faturamento por mês
            </span>
            {meses.map((m) => (
              <span key={m.mesId} className="inline-flex items-center gap-1 text-[11px]">
                <span className="font-semibold text-muted-foreground">
                  {nomeDoMes(m.mes).slice(0, 1).toUpperCase() + nomeDoMes(m.mes).slice(1, 3)}
                </span>
                <Chip situacao={m.situacao} curto />
              </span>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {bloqueio ??
              `Envie cada mês quando o cliente validar. O encerramento fica disponível quando ${quemFatura}.`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAberta((v) => !v)}
            aria-expanded={aberta}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-border bg-white px-3.5 text-[13px] font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
          >
            {aberta ? (
              <>
                <ChevronDown className="h-4 w-4" /> Recolher
              </>
            ) : (
              <>
                <ChevronUp className="h-4 w-4" /> Ver todos os meses
              </>
            )}
          </button>
          {proximo && podeEnviarMes(proximo) && botaoEnviar(proximo, false)}
          {acaoExtra}
        </div>
      </div>

      <Dialog open={envioAberto !== null} onOpenChange={(o) => !o && setEnvioAberto(null)}>
        <DialogContent className="sm:max-w-lg">
          {envioAberto && envio && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Envio de {nomeDoMes(envioAberto.mes)} · {jobCodigo}
                </DialogTitle>
                <DialogDescription>
                  Enviado para faturamento em {dataDoEnvio(envio.enviado_em)}. O envio
                  é definitivo: não há errata nem save neste mês.
                </DialogDescription>
              </DialogHeader>
              <dl className="space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Valor enviado</dt>
                  <dd className="font-mono font-semibold">
                    {formatCurrency(envio.valor_faturado, moeda)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Situação</dt>
                  <dd>
                    <Chip situacao={envioAberto.situacao} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Número da PO</dt>
                  <dd>{envio.numero_po ?? "—"}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Portal</dt>
                  <dd className="truncate">{envio.portal_url ?? "Sem portal"}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-muted-foreground">Descrição da nota fiscal</dt>
                  <dd className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                    {envio.descricao_nf ?? "—"}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-muted-foreground">Parcelas</dt>
                  <dd className="divide-y divide-border rounded-lg border border-border">
                    {envio.parcelas.map((par) => (
                      <div
                        key={par.id}
                        className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
                      >
                        <span className="font-mono text-muted-foreground">
                          {par.ordem}/{envio.parcelas.length}
                        </span>
                        <span className="font-mono font-semibold">
                          {formatCurrency(par.valor, moeda)}
                        </span>
                        <span>vence {data(par.data_vencimento)}</span>
                      </div>
                    ))}
                  </dd>
                </div>
                {envioAberto.notas.length > 0 && (
                  <div className="space-y-1">
                    <dt className="text-muted-foreground">Notas emitidas</dt>
                    <dd className="text-xs">
                      {listaPtBr(
                        envioAberto.notas.map(
                          (nota) =>
                            `NF ${nota.numero ?? "—"} · ${formatCurrency(nota.valor, moeda)} (${diaMes(nota.dataEmissao)})`,
                        ),
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
