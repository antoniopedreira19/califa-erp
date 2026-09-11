"use client";

/**
 * A coluna da direita da tela da PP (10/09/2026).
 *
 * É o antigo drawer, que deixou de ser uma etapa e virou uma coluna ao
 * lado dos documentos. O motivo é do Tiago: "estou achando difícil
 * justificar um drawer com informações presentes nas PPs e que apareceram
 * novamente no pop-up". Com uma tela só, não há o que duplicar.
 *
 * Duas abas dividem o mesmo espaço — **Dados** e **Chat** — para o fio do
 * job não pedir largura nova, que é justamente o que faltava aos
 * documentos. A coluna inteira recolhe; quem recolhe é a tela.
 */

import * as React from "react";
import Link from "next/link";
import {
  CalendarClock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Lock,
  Paperclip,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { ppStatusLabel, nomeContraparteBRPP } from "@/lib/types";
import type { PPRow } from "./pedidos-compra-list";
import { useChatPPs } from "./chat/chat-pps-provider";
import { ChatPPsConversa } from "./chat/chat-pps-conversa";
import { abrirThreadPPs, marcarConversaPPsLida } from "./chat/actions";
import type { ThreadPPsDoJob } from "@/lib/data/chat-pps-conversas";
import { signedUrlAnexoPrestacao } from "./prestacao-verba-actions";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function iconePorMime(nome: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(nome) ? ImageIcon : FileText;
}

export type AbaDossie = "dados" | "chat";

export function PPDossie({
  pp,
  aba,
  onAba,
  anexoAtivo,
  onAnexo,
  onPrestarContas,
  onErro,
}: {
  pp: PPRow;
  aba: AbaDossie;
  onAba: (a: AbaDossie) => void;
  /** Índice do anexo aberto no painel do meio — a lista marca qual é. */
  anexoAtivo: number;
  onAnexo: (i: number) => void;
  onPrestarContas: () => void;
  onErro: (mensagem: string) => void;
}) {
  const { conversas, zerarNaoLidas, recarregar, podeEnviar } = useChatPPs();
  const [thread, setThread] = React.useState<ThreadPPsDoJob | null>(null);

  const conversa = conversas.find((c) => c.jobId === pp.job_id);
  const naoLidas = conversa?.naoLidas ?? 0;
  const ultimaEm = conversa?.ultimaEm ?? null;

  // Mesmo padrão do balão do canto: carrega o fio, marca como lido, e
  // recarrega quando a última mensagem do job muda (o provider avisa pelo
  // realtime). Só quando a aba está aberta — fio fechado não consome.
  React.useEffect(() => {
    if (aba !== "chat") return;
    let ativo = true;
    zerarNaoLidas(pp.job_id);
    (async () => {
      const [t] = await Promise.all([
        abrirThreadPPs(pp.job_id),
        marcarConversaPPsLida(pp.job_id),
      ]);
      if (ativo) setThread(t);
    })();
    return () => {
      ativo = false;
    };
  }, [aba, pp.job_id, ultimaEm, zerarNaoLidas]);

  async function abrirAnexoPrestacao(anexoId: string) {
    const res = await signedUrlAnexoPrestacao(anexoId);
    if (res.ok) window.open(res.url, "_blank");
    else onErro(res.message);
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white">
      <div className="flex flex-none items-center gap-1 border-b border-border px-2 pt-2">
        <Aba ativa={aba === "dados"} onClick={() => onAba("dados")}>
          Dados
        </Aba>
        <Aba ativa={aba === "chat"} onClick={() => onAba("chat")} badge={naoLidas}>
          Chat
        </Aba>
      </div>

      {aba === "dados" ? (
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5">
          <Estados pp={pp} />

          <Grupo rotulo={pp.verba_producao ? "Responsável" : "Fornecedor"}>
            <p className="text-[13px] font-semibold leading-snug">
              {nomeContraparteBRPP({
                verba_producao: pp.verba_producao,
                fornecedor: pp.fornecedor_nome ? { nome: pp.fornecedor_nome } : null,
                responsavel: pp.responsavel_nome ? { nome: pp.responsavel_nome } : null,
              })}
            </p>
            {pp.cadastro_do_fornecedor_mudou && (
              <p className="mt-1 text-[11px] text-amber-800">
                * O cadastro do fornecedor mudou depois que esta PP tirou a foto dos
                dados de pagamento.
              </p>
            )}
          </Grupo>

          <Grupo rotulo="Origem no job">
            <Link
              href={`/jobs/${pp.job_id}`}
              prefetch={false}
              className="inline-flex items-center gap-1 text-[13px] font-semibold leading-snug text-california-red hover:underline"
            >
              <span className="font-mono text-xs">{pp.job_codigo}</span> {pp.job_nome}
              <ExternalLink className="h-3 w-3 flex-none" />
            </Link>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="font-mono">{pp.projeto_codigo ?? "—"}</span>{" "}
              {pp.projeto_nome ?? ""}
              {pp.cliente_nome ? ` · ${pp.cliente_nome}` : ""}
            </p>
          </Grupo>

          <Grupo rotulo="Serviço">
            <p className="text-[12.5px] leading-snug">{pp.servico}</p>
            {pp.especificacoes && (
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
                {pp.especificacoes}
              </p>
            )}
          </Grupo>

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <Grupo rotulo="Valor">
              <p className="font-mono text-base font-bold">
                {formatCurrency(pp.valor, "BRL")}
              </p>
            </Grupo>
            <Grupo rotulo="Quantidade">
              <p className="text-[13px] font-semibold">{pp.quantidade}</p>
            </Grupo>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <CalendarClock className="h-4 w-4 flex-none text-amber-800" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                Vencimento original
              </p>
              <p className="font-mono text-[15px] font-bold leading-tight">
                {formatDate(pp.parcelas[0]?.data_vencimento ?? pp.prazo_pagamento)}
              </p>
              <p className="text-[10.5px] text-amber-900/70">
                Negociado pela produção com o fornecedor.
              </p>
            </div>
          </div>

          {pp.parcelas.length > 1 && (
            <Grupo rotulo={`Parcelas (${pp.parcelas.length})`}>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {pp.parcelas.map((p) => (
                  <li
                    key={p.numero}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="font-mono text-muted-foreground">
                      {p.numero}/{pp.parcelas.length}
                    </span>
                    <span className="text-muted-foreground">
                      vence {formatDate(p.data_vencimento)}
                    </span>
                    <span className="ml-auto font-mono font-semibold">
                      {formatCurrency(p.valor, "BRL")}
                    </span>
                  </li>
                ))}
              </ul>
            </Grupo>
          )}

          <Grupo rotulo={`Anexos (${pp.anexos.length})`}>
            {pp.anexos.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">
                A produção não enviou documento nesta PP.
              </p>
            ) : (
              <ul className="space-y-1">
                {pp.anexos.map((a, i) => {
                  const Icon = iconePorMime(a.arquivo_nome_original);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onAnexo(i)}
                        aria-pressed={i === anexoAtivo}
                        title={`Ver ${a.arquivo_nome_original} ao lado da PP`}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border p-2 text-left text-[11px] transition-colors",
                          i === anexoAtivo
                            ? "border-california-red bg-california-red/5"
                            : "border-border hover:bg-muted",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-semibold">{i + 1}</span> ·{" "}
                          {a.arquivo_nome_original}
                        </span>
                        <span className="flex-none text-muted-foreground">
                          {(a.arquivo_tamanho_bytes / 1024).toFixed(0)} KB
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Grupo>

          <Historico pp={pp} />

          {pp.verba_producao && (
            <Prestacao
              pp={pp}
              onPrestarContas={onPrestarContas}
              onAbrirAnexo={abrirAnexoPrestacao}
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatPPsConversa
            jobId={pp.job_id}
            thread={thread}
            onThread={setThread}
            podeEnviar={podeEnviar}
            onEnviou={() => void recarregar()}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A linha do tempo da PP (11/09/2026).
 *
 * Existe para uma pergunta que o sistema não sabia responder: **com qual
 * documento** a PP foi aprovada. Quem aprovou e quando já estavam
 * gravados; o que faltava era o que estava na tela na hora da decisão.
 *
 * O caso que mais importa aqui é o vazio: "aprovada sem documento
 * anexado" é informação, e é diferente de "não registrado" — que é o que
 * as 8 PPs aprovadas antes desta data mostram, porque inventar a lista
 * atual para elas seria fabricar uma prova.
 */
function Historico({ pp }: { pp: PPRow }) {
  const linhas: Array<{ quando: string | null; o_que: string; quem: string | null }> = [
    { quando: pp.created_at, o_que: "Emitida", quem: pp.emitida_por_nome },
    {
      quando: pp.enviada_financeiro_em,
      o_que: "Enviada ao financeiro",
      quem: pp.enviada_financeiro_por_nome,
    },
    { quando: pp.rejeitada_em, o_que: "Rejeitada", quem: pp.rejeitada_por_nome },
    { quando: pp.aprovada_em, o_que: "Aprovada", quem: pp.aprovada_por_nome },
    { quando: pp.pago_em, o_que: "Paga", quem: pp.pago_por_nome },
    { quando: pp.cancelada_em, o_que: "Cancelada", quem: pp.cancelada_por_nome },
  ].filter((l) => l.quando != null);

  const conferidos = pp.anexos_na_aprovacao;

  return (
    <div className="border-t border-border pt-3">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Histórico
      </p>
      <ul className="space-y-1.5">
        {linhas.map((l) => (
          <li key={l.o_que} className="flex gap-2 text-[11px] leading-snug">
            <span className="flex-none font-mono text-muted-foreground">
              {formatDate(l.quando)}
            </span>
            <span className="min-w-0">
              <span className="font-semibold">{l.o_que}</span>
              {l.quem ? <span className="text-muted-foreground"> · {l.quem}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {pp.aprovada_em && (
        <div className="mt-2 rounded-lg border border-border bg-muted/30 p-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Documentos na aprovação
          </p>
          {conferidos == null ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Não registrado — esta PP foi aprovada antes de o sistema passar a
              guardar quais documentos estavam anexados.
            </p>
          ) : conferidos.length === 0 ? (
            <p className="mt-1 text-[11px] font-semibold text-california-red">
              Aprovada sem nenhum documento anexado.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {conferidos.map((a) => (
                <li key={a.id} className="flex gap-1.5 text-[11px] leading-snug">
                  <FileText className="mt-0.5 h-3 w-3 flex-none text-muted-foreground" />
                  <span className="min-w-0 break-words">{a.nome}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Aba({
  ativa,
  onClick,
  badge,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs font-bold transition-colors",
        ativa
          ? "bg-california-red/10 text-california-red"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-california-red px-1.5 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

function Grupo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </p>
      {children}
    </div>
  );
}

/** Cancelamento, rejeição e pagamento — só aparecem no estado que os criou. */
function Estados({ pp }: { pp: PPRow }) {
  if (pp.status === "cancelada") {
    return (
      <Caixa tom="vermelho" titulo="Cancelada">
        <p>
          Por <span className="font-medium">{pp.cancelada_por_nome ?? "—"}</span> em{" "}
          {formatDateTime(pp.cancelada_em)}
        </p>
        <p className="mt-1.5">
          <span className="font-medium">Motivo: </span>
          {pp.motivo_cancelamento ?? "Sem motivo registrado (cancelado pelo GP)."}
        </p>
      </Caixa>
    );
  }
  if (pp.status === "rejeitada") {
    return (
      <Caixa tom="vermelho" titulo="Rejeitada">
        <p>
          Por <span className="font-medium">{pp.rejeitada_por_nome ?? "—"}</span> em{" "}
          {formatDateTime(pp.rejeitada_em)}
        </p>
        <p className="mt-1.5">
          <span className="font-medium">Motivo: </span>
          {pp.motivo_rejeicao ?? "—"}
        </p>
        <p className="mt-1.5 text-muted-foreground">
          Aguardando o gerente do job corrigir e reenviar.
        </p>
      </Caixa>
    );
  }
  if (pp.status === "pago") {
    return (
      <Caixa tom="verde" titulo="Paga">
        <p>
          Última parcela baixada em {formatDate(pp.pago_em)}
          {pp.pago_por_nome ? (
            <>
              , por <span className="font-medium">{pp.pago_por_nome}</span>
            </>
          ) : null}
        </p>
      </Caixa>
    );
  }
  if (pp.status !== "em_avaliacao") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
        <Lock className="h-3.5 w-3.5 flex-none" />
        <span>{ppStatusLabel(pp.status)} — sem ação do financeiro nesta tela.</span>
      </div>
    );
  }
  return null;
}

function Caixa({
  tom,
  titulo,
  children,
}: {
  tom: "vermelho" | "verde";
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 text-[11.5px] leading-relaxed",
        tom === "vermelho"
          ? "border-red-200 bg-red-50"
          : "border-emerald-200 bg-emerald-50",
      )}
    >
      <p
        className={cn(
          "mb-1 text-[10px] font-bold uppercase tracking-wider",
          tom === "vermelho" ? "text-red-700" : "text-emerald-700",
        )}
      >
        {titulo}
      </p>
      {children}
    </div>
  );
}

/** Verba de produção: o dinheiro sai antes da nota, e volta aqui. */
function Prestacao({
  pp,
  onPrestarContas,
  onAbrirAnexo,
}: {
  pp: PPRow;
  onPrestarContas: () => void;
  onAbrirAnexo: (anexoId: string) => void;
}) {
  return (
    <section className="rounded-xl border border-border p-3">
      <p className="text-xs font-bold">Prestação de contas</p>

      {pp.status !== "pago" && !pp.prestacao && (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          A prestação abre depois que a verba for paga.
        </p>
      )}

      {pp.status === "pago" && !pp.prestacao && (
        <div className="mt-2">
          <p className="mb-2 text-[11.5px] text-muted-foreground">
            Verba paga e ainda sem prestação.
          </p>
          <button
            type="button"
            onClick={onPrestarContas}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Prestar contas
          </button>
        </div>
      )}

      {pp.prestacao && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Fechada em {formatDate(pp.prestacao.fechada_em)}
            {pp.prestacao.fechada_por_profile?.nome
              ? ` por ${pp.prestacao.fechada_por_profile.nome}`
              : ""}
            .
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <Numero rotulo="Valor da PP" valor={formatCurrency(pp.valor, "BRL")} />
            <Numero
              rotulo="Gasto"
              valor={formatCurrency(Number(pp.prestacao.valor_gasto), "BRL")}
            />
            <Numero
              rotulo="Devolvido"
              valor={formatCurrency(Number(pp.prestacao.valor_devolvido), "BRL")}
              destaque
            />
          </div>
          {pp.prestacao.anexos.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Notas anexadas
              </p>
              <ul className="space-y-1">
                {pp.prestacao.anexos.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 rounded border border-border p-1.5 text-[11px]"
                  >
                    <FileText className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => onAbrirAnexo(a.id)}
                      className="min-w-0 flex-1 truncate text-left text-california-red underline hover:opacity-80"
                    >
                      {a.arquivo_nome_original}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Numero({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-muted/20 p-1.5 text-center">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-[11px] font-semibold",
          destaque && "text-emerald-700",
        )}
      >
        {valor}
      </p>
    </div>
  );
}
