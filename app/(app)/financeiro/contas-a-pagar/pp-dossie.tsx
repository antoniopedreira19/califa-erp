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
  AlertTriangle,
  CalendarClock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Lock,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  documentoTipoLabel,
  nomeContraparteBRPP,
  ppStatusLabel,
  situacaoDaVerba,
} from "@/lib/types";
import { SituacaoVerbaChip } from "@/components/financeiro/situacao-verba-chip";
import { qualJanela } from "@/lib/calculos/janelas-pagamento";
import type { PPRow } from "./pedidos-compra-list";
import { useChatPPs } from "./chat/chat-pps-provider";
import { ChatPPsConversa } from "./chat/chat-pps-conversa";
import { abrirThreadPPs, marcarConversaPPsLida } from "./chat/actions";
import type { ThreadPPsDoJob } from "@/lib/data/chat-pps-conversas";

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
  onErro,
}: {
  pp: PPRow;
  aba: AbaDossie;
  onAba: (a: AbaDossie) => void;
  /** Índice do anexo aberto no painel do meio — a lista marca qual é. */
  anexoAtivo: number;
  onAnexo: (i: number) => void;
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

  const vencimentoOriginal = (
    pp.parcelas[0]?.data_vencimento ?? pp.prazo_pagamento ?? ""
  ).slice(0, 10);
  /** O selo do vencimento: janela do 08, do 20, ou nenhuma — a PP gerada
   *  antes da regra de 14/09/2026 (decisão 077). */
  const janelaDoVencimento = vencimentoOriginal ? qualJanela(vencimentoOriginal) : null;

  return (
    // `flex-1` e não altura automática: sem ele a coluna encolhia até o
    // tamanho do conteúdo, e a aba Chat abria como uma tirinha — cabeçalho,
    // "Carregando o fio…" e a caixa de mensagem — que só crescia quando as
    // mensagens chegavam. A altura agora é a da tela desde o primeiro
    // quadro, cheia ou vazia (Tiago, 11/09/2026).
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white">
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
          {/* A justificativa abre o dossiê (decisão 077) — por isso o
              vencimento perdeu o amarelo: dois alertas disputariam o olho. */}
          {pp.urgente && (
            <div className="rounded-xl border border-california-red/30 bg-california-red/[0.06] px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-california-red">
                <AlertTriangle className="h-3.5 w-3.5 flex-none" />
                Pagamento urgente
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-snug">
                “{pp.urgente_justificativa}”
              </p>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                Marcado por {pp.urgente_por_nome ?? "—"} · {formatDateTime(pp.urgente_em)}
              </p>
            </div>
          )}

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

          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
            <CalendarClock className="h-4 w-4 flex-none text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Vencimento original
              </p>
              <p className="font-mono text-[15px] font-bold leading-tight">
                {formatDate(vencimentoOriginal || null)}
              </p>
              <p className="text-[10.5px] text-muted-foreground">
                Negociado pela produção com o fornecedor.
              </p>
            </div>
            {vencimentoOriginal &&
              (janelaDoVencimento ? (
                <span className="flex-none rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                  ✓ janela do dia {janelaDoVencimento === 8 ? "08" : "20"}
                </span>
              ) : (
                <span className="flex-none rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                  fora das janelas
                </span>
              ))}
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

          {/* Verba não tem anexo próprio: os documentos dela são os da
              prestação, no bloco abaixo (decisão 081). */}
          {(!pp.verba_producao || pp.anexos.length > 0) && (
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
          )}

          <Historico pp={pp} />

          {pp.verba_producao && (
            <Prestacao pp={pp} anexoAtivo={anexoAtivo} onDocumento={onAnexo} />
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
            // Verba de produção sai sem nota — as notas vêm na prestação de
            // contas —, então nela "sem documento" é o normal e não leva o
            // vermelho de alerta (Tiago, 14/09/2026).
            pp.verba_producao ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Aprovada sem documento — PP de verba de produção.
              </p>
            ) : (
              <p className="mt-1 text-[11px] font-semibold text-california-red">
                Aprovada sem nenhum documento anexado.
              </p>
            )
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
  // Aprovada tem, sim, ação nesta tela desde a decisão 083: o financeiro
  // devolve a PP para a produção pelo rodapé. Os outros status (gerada,
  // cancelada) seguem sem nada a fazer aqui.
  if (pp.status === "aprovada") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
        <Lock className="h-3.5 w-3.5 flex-none" />
        <span>
          Aprovada — já é título a pagar. Para devolvê-la à produção, use
          &ldquo;Reprovar PP&rdquo; no rodapé.
        </span>
      </div>
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
  anexoAtivo,
  onDocumento,
}: {
  pp: PPRow;
  /** Índice do documento aberto no painel do meio. */
  anexoAtivo: number;
  onDocumento: (i: number) => void;
}) {
  const situacao = situacaoDaVerba(pp);
  const pr = pp.prestacao;
  const brl = (n: number) => formatCurrency(n, "BRL");
  return (
    <section className="rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold">Prestação de contas</p>
        {situacao && <SituacaoVerbaChip situacao={situacao} />}
      </div>

      {pp.status !== "pago" && (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          A prestação abre depois que a verba for paga.
        </p>
      )}

      {pp.status === "pago" && !pr && (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          Verba paga. Quem presta contas é a produção, na aba de PPs do job.
        </p>
      )}

      {pr && (
        <div className="mt-2 space-y-2">
          {pr.status === "reprovada" && pr.motivo_reprovacao && (
            <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-2 text-[11px]">
              <p className="font-semibold text-california-red">
                Reprovada{pr.reprovada_por_nome ? ` por ${pr.reprovada_por_nome}` : ""} ·{" "}
                {formatDateTime(pr.reprovada_em)}
              </p>
              <p className="text-foreground/80">“{pr.motivo_reprovacao}”</p>
            </div>
          )}
          {pr.documentos.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-2 text-[11px] text-muted-foreground">
              Sem gasto — a produção devolve a verba inteira, sem documento.
            </p>
          )}
          <ul className="space-y-1">
            {pr.documentos.map((d, i) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onDocumento(i)}
                  aria-pressed={i === anexoAtivo}
                  title={`Ver ${d.arquivo_nome_original} ao lado da PP`}
                  className={cn(
                    "grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-baseline gap-1.5 rounded-lg border p-1.5 text-left text-[11px] transition-colors",
                    i === anexoAtivo
                      ? "border-california-red bg-california-red/5"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <span className="font-mono text-muted-foreground">{i + 1}</span>
                  <span className="truncate">
                    {documentoTipoLabel(d.documento_tipo)}
                    {d.documento_numero ? ` ${d.documento_numero}` : ""} · {d.arquivo_nome_original}
                  </span>
                  <span className="font-mono font-semibold">{brl(d.valor)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-border pt-2 text-[11px]">
            <div className="flex justify-between font-semibold">
              <span>Gasto comprovado</span>
              <span className="font-mono">{brl(pr.valor_gasto)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Verba</span>
              <span className="font-mono">{brl(pp.valor)}</span>
            </div>
            {pr.valor_devolvido > 0 && (
              <div className="flex justify-between rounded-md bg-teal-50 px-2 py-1 font-semibold text-teal-800">
                <span>{pp.devolucao ? "Estorno de verba" : "Saldo → estorno"}</span>
                <span className="font-mono">−{brl(pr.valor_devolvido)}</span>
              </div>
            )}
            {pp.devolucao && (
              <p className="text-muted-foreground">
                {pp.devolucao.pago_em
                  ? `Devolvido em ${formatDate(pp.devolucao.pago_em)}.`
                  : `Devolução prevista para ${formatDate(pp.devolucao.data_pagamento)}.`}
              </p>
            )}
          </div>
          <p className="text-[10.5px] text-muted-foreground">
            Enviada{pr.enviada_por_nome ? ` por ${pr.enviada_por_nome}` : ""} ·{" "}
            {formatDateTime(pr.enviada_em)}
            {pr.aprovada_em
              ? ` · aprovada${pr.aprovada_por_nome ? ` por ${pr.aprovada_por_nome}` : ""} em ${formatDateTime(pr.aprovada_em)}`
              : ""}
          </p>
        </div>
      )}
    </section>
  );
}

