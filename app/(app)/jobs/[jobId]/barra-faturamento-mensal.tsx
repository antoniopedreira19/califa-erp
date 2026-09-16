"use client";

/**
 * Faturamento por mês na barra fixa do rodapé do job — Fee e Always On
 * (decisão 078, entrega 3; design "Planilha Fee e Always On", página Job,
 * aprovado em 14/09/2026).
 *
 * Recolhida: a situação de cada mês e o botão do mês mais antigo ainda a
 * enviar. Expandida: uma linha por mês, com o envio e as notas.
 *
 * Desde 16/09/2026 (decisão 087) é a trilha "Faturamento" da barra, com a
 * trilha "Encerramento" logo abaixo: o encerramento não espera os meses,
 * e o envio dos meses continua depois do job encerrado.
 *
 * Não existe devolução: o envio de um mês é definitivo, como o envio único
 * de hoje (Tiago, 14/09/2026). Por isso o desenho perdeu o estado
 * "Devolvido" e o "Revisar e reenviar".
 */

import * as React from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { MesDeFaturamento } from "@/lib/calculos/faturamento-por-mes";
import { nomeDoMes, rotuloMes } from "@/lib/calculos/meses-trimestre";
import {
  EnviarFaturamentoDrawer,
  type PortalOption,
} from "./enviar-faturamento-drawer";
import {
  ChipSituacao,
  VerEnvioFaturamentoDialog,
  dataBr,
  dataDoEnvio,
  diaMes,
  listaPtBr,
} from "./envio-faturamento-ui";
import { TextoTrilha, TrilhaBarra } from "./trilha-barra";

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
        ? `1 parcela, vencimento ${primeira ? dataBr(primeira) : "—"}`
        : `${n} parcelas, a primeira vencendo em ${primeira ? dataBr(primeira) : "—"}`
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
  /** Permissão de enviar para faturamento, com o job aberto ou encerrado. */
  podeEnviar: boolean;
  /** Motivo que fecha o envio de todos os meses agora (abertura em
   *  revisão depois de errata). Nulo quando não há. */
  bloqueio: string | null;
  portais: PortalOption[];
  moeda: string;
  /** A trilha "Encerramento", abaixo da de faturamento (decisão 087). */
  trilhaEncerramento?: React.ReactNode;
  /** Job já encerrado: os meses ainda se enviam, mas nada mais se edita. */
  jobEncerrado?: boolean;
}

export function BarraFaturamentoMensal({
  jobId,
  jobCodigo,
  meses,
  podeEnviar,
  bloqueio,
  portais,
  moeda,
  trilhaEncerramento,
  jobEncerrado = false,
}: Props) {
  const [aberta, setAberta] = React.useState(false);
  const [envioAberto, setEnvioAberto] = React.useState<MesDeFaturamento | null>(
    null,
  );

  const enviados = meses.filter((m) => m.envio !== null);
  const total = meses.reduce((s, m) => s + m.faturamento, 0);
  const somaEnviada = enviados.reduce(
    (s, m) => s + (m.envio?.valor_faturado ?? 0),
    0,
  );
  // O botão da barra recolhida é sempre o do mês mais antigo ainda a
  // enviar (design aprovado em 14/09/2026).
  const proximo = meses.find((m) => m.situacao === "a_enviar") ?? null;
  const podeEnviarMes = (m: MesDeFaturamento) =>
    podeEnviar && !bloqueio && m.situacao === "a_enviar" && m.faturamento > 0;

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
        jobEncerrado={jobEncerrado}
      />
    );
  }

  const resumo =
    enviados.length === 0
      ? "Envie cada mês quando o cliente validar."
      : `${enviados.length} de ${meses.length} ${
          meses.length === 1 ? "mês enviado" : "meses enviados"
        } · ${formatCurrency(somaEnviada, moeda)} de ${formatCurrency(total, moeda)} na fila.`;

  return (
    <div className="sticky bottom-0 z-20 -mx-1 rounded-t-2xl border border-b-0 border-border bg-white/95 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.12)] backdrop-blur">
      {aberta && (
        <div className="max-h-[50vh] overflow-y-auto border-b border-border px-5 pb-2 pt-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Faturamento por mês</strong> ·{" "}
              {enviados.length} de {meses.length}{" "}
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
                <ChipSituacao situacao={m.situacao} />
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

      <TrilhaBarra
        rotulo="Faturamento"
        acoes={
          <>
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
          </>
        }
      >
        {meses.map((m) => (
          <span key={m.mesId} className="inline-flex items-center gap-1 text-[11px]">
            <span className="font-semibold text-muted-foreground">
              {nomeDoMes(m.mes).slice(0, 1).toUpperCase() + nomeDoMes(m.mes).slice(1, 3)}
            </span>
            <ChipSituacao situacao={m.situacao} curto />
          </span>
        ))}
        <TextoTrilha>{bloqueio ?? resumo}</TextoTrilha>
      </TrilhaBarra>

      {trilhaEncerramento}

      <VerEnvioFaturamentoDialog
        aberto={envioAberto !== null}
        onOpenChange={(o) => !o && setEnvioAberto(null)}
        titulo={
          envioAberto ? `Envio de ${nomeDoMes(envioAberto.mes)} · ${jobCodigo}` : ""
        }
        descricao={
          envioAberto?.envio
            ? `Enviado para faturamento em ${dataDoEnvio(envioAberto.envio.enviado_em)}. O envio é definitivo: não há errata nem save neste mês.`
            : ""
        }
        envio={envioAberto?.envio ?? null}
        situacao={envioAberto?.situacao ?? "a_enviar"}
        notas={envioAberto?.notas ?? []}
        moeda={moeda}
      />
    </div>
  );
}
