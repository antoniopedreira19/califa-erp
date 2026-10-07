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
 *
 * Módulo fiscal (02/10/2026), duas coisas novas na aba Dados — o resto da
 * coluna não muda:
 *  • no grupo "Fornecedor", embaixo do nome, o regime tributário do
 *    cadastro do fornecedor;
 *  • o grupo "Nota fiscal do fornecedor", logo depois de "Anexos": o
 *    número que a produção informou no anexo, e a data de emissão, o valor
 *    e o CNPJ tomador, que o financeiro registra conferindo a nota ao lado.
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
  type FiscalEstabelecimento,
} from "@/lib/types";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatarCnpj } from "@/lib/fiscal/cadastro";
import {
  nfIncompleta,
  nfInicial,
  somaDasPartes,
  textoDoRegime,
  type NfEmConferencia,
  type NotaDaLinhaPP,
  type NotasFiscaisDaLinhaPP,
} from "@/lib/fiscal/nf-da-pp";
import { SituacaoVerbaChip } from "@/components/financeiro/situacao-verba-chip";
import { PagamentoForaDoCadastroCartao } from "@/components/financeiro/pagamento-fora-do-cadastro";
import { qualJanela } from "@/lib/calculos/janelas-pagamento";
import type { PPRow } from "./pedidos-compra-list";
import { useChatPPs } from "./chat/chat-pps-provider";
import { ChatPPsConversa } from "./chat/chat-pps-conversa";
import { abrirThreadPPs, marcarConversaPPsLida } from "./chat/actions";
import type { ThreadPPsDoJob } from "@/lib/data/chat-pps-conversas";
import {
  eventoPPMostraMotivo,
  pedidoForaDoCadastro,
  rotuloDoEventoPP,
} from "@/lib/data/eventos-da-pp";
import { formatDiaHoraCurtoBr } from "@/lib/formatar-data-hora";

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
  notas,
  nfs,
  onNf,
  estabelecimentos,
}: {
  pp: PPRow;
  aba: AbaDossie;
  onAba: (a: AbaDossie) => void;
  /** Índice do anexo aberto no painel do meio — a lista marca qual é. */
  anexoAtivo: number;
  onAnexo: (i: number) => void;
  onErro: (mensagem: string) => void;
  /** Módulo fiscal: as NFs da PP (uma por anexo do tipo NF, decisão 152)
   *  e cada uma em conferência (a tela guarda; aqui se edita), na mesma
   *  ordem. Null quando a PP não tem NF anexada. */
  notas: NotasFiscaisDaLinhaPP | null;
  nfs: NfEmConferencia[] | null;
  onNf: (nf: NfEmConferencia) => void;
  /** Os CNPJs do cadastro de impostos — o CNPJ tomador da NF. */
  estabelecimentos: FiscalEstabelecimento[];
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
            {/* Módulo fiscal: o regime tributário, como o cadastro guarda.
                Discreto — é referência para a retenção, que se decide na
                aprovação. Sem regime informado, nada. */}
            {pp.regime_do_fornecedor && (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {textoDoRegime(pp.regime_do_fornecedor)}
              </p>
            )}
            {pp.cadastro_do_fornecedor_mudou && (
              <p className="mt-1 text-[11px] text-amber-800">
                * O cadastro do fornecedor mudou depois que esta PP tirou a foto dos
                dados de pagamento.
              </p>
            )}
            {/* Decisão 127: a PP paga por outra chave ou conta. Três linhas,
                e a aprovação exige a marcação — ver `aprovar-pp-dialog`. */}
            {pp.pagamento_fora_do_cadastro && (
              <PagamentoForaDoCadastroCartao
                pagamento={pp.pagamento_fora_do_cadastro}
                pedido={pedidoForaDoCadastro(pp.eventos)}
                className="mt-1.5"
              />
            )}
          </Grupo>

          <Grupo rotulo="Origem no job">
            {/* O job na página do FINANCEIRO, não na da produção: o
                financeiro não sai do módulo (decisão 099, item 20). */}
            <Link
              href={`/financeiro/jobs/${pp.job_id}`}
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

          {/* Módulo fiscal: as NFs do fornecedor, conferidas aqui, ao lado da nota. */}
          <NotasFiscaisDoFornecedor
            pp={pp}
            notas={notas}
            nfs={nfs}
            onNf={onNf}
            estabelecimentos={estabelecimentos}
            onVer={(anexoId) => {
              const i = pp.anexos.findIndex((a) => a.id === anexoId);
              if (i >= 0) onAnexo(i);
            }}
          />

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
 *
 * Desde a decisão 136 (01/10/2026) as linhas vêm de
 * `pedidos_compra_eventos`, com a hora e um registro por evento: antes
 * eram as colunas da PP, uma por tipo, e o reenvio apagava a rejeição.
 */
function Historico({ pp }: { pp: PPRow }) {
  const conferidos = pp.anexos_na_aprovacao;

  return (
    <div className="border-t border-border pt-3">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Histórico
      </p>
      <ul className="space-y-1.5">
        {pp.eventos.map((e, i) => (
          <li key={i} className="flex gap-2 text-[11px] leading-snug">
            <span className="flex-none font-mono text-muted-foreground">
              {formatDiaHoraCurtoBr(e.em, e.so_data)}
            </span>
            <span className="min-w-0">
              <span className="font-semibold">{rotuloDoEventoPP(e.evento)}</span>
              {e.por_nome ? <span className="text-muted-foreground"> · {e.por_nome}</span> : null}
              {e.motivo && eventoPPMostraMotivo(e.evento) ? (
                <span className="mt-0.5 block break-words text-muted-foreground">
                  {/* Na NF corrigida, o motivo é o que mudou, escrito pelo
                      banco: sem aspas. */}
                  {e.evento === "nf_corrigida" ? e.motivo : <>“{e.motivo}”</>}
                </span>
              ) : null}
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

/** A data do calendário em "AAAA-MM-DD", no dia local escolhido. */
function isoDoDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Módulo fiscal: as notas fiscais do fornecedor (02/10/2026; decisão 152 —
 * 07/10/2026).
 *
 * Uma ficha por anexo do tipo NF. A produção informa os dados de cada nota
 * no envio; o financeiro confere aqui, olhando a nota no painel do meio
 * ("Ver" abre o arquivo dela), e corrige o que precisar — a correção vale
 * para todas as PPs ligadas à nota. A data de emissão decide o mês do
 * crédito de PIS/COFINS; a soma das partes desta PP é a base das retenções
 * do pop-up de aprovação. Tudo grava junto com a aprovação
 * (`aprovarPPComNotaFiscal`).
 *
 * Uma nota pode cobrir mais de uma PP: o valor é o TOTAL da nota, e "Esta
 * NF também cobre outra PP" abre o valor desta PP. Na nota que já está em
 * outra PP, o campo já vem aberto, com as outras PPs embaixo.
 *
 * Editável só em avaliação. Nos outros status, o que ficou registrado — e
 * nada na PP que saiu da avaliação sem registro (aprovada antes do módulo
 * fiscal). Grade de 2 × 2 nos 310 px da coluna: a coluna da esquerda
 * (número e valor) é a estreita; a da direita (data e CNPJ), a que precisa
 * de largura.
 */
function NotasFiscaisDoFornecedor({
  pp,
  notas,
  nfs,
  onNf,
  estabelecimentos,
  onVer,
}: {
  pp: PPRow;
  notas: NotasFiscaisDaLinhaPP | null;
  nfs: NfEmConferencia[] | null;
  onNf: (nf: NfEmConferencia) => void;
  estabelecimentos: FiscalEstabelecimento[];
  /** Abre o arquivo da nota no painel do meio. */
  onVer: (anexoId: string) => void;
}) {
  if (!notas) return null;
  const editavel = pp.status === "em_avaliacao" && nfs !== null;
  // Fora da avaliação: só as notas que o financeiro registrou.
  const lista: Array<{ nota: NotaDaLinhaPP; nf: NfEmConferencia }> = editavel
    ? notas.notas.map((nota, i) => ({ nota, nf: nfs[i] }))
    : notas.notas
        .filter((nota) => nota.registrada)
        .map((nota) => ({ nota, nf: nfInicial(nota, null) }));
  if (lista.length === 0) return null;

  const varias = lista.length > 1;
  const soma = somaDasPartes(lista.map((x) => x.nf));
  const completas = lista.every((x) => !nfIncompleta(x.nf));
  const difereDaPP = completas && Math.abs(soma - pp.valor) > 0.004;

  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {varias ? `Notas fiscais do fornecedor (${lista.length})` : "Nota fiscal do fornecedor"}
      </p>
      <div className={cn(varias && "space-y-2")}>
        {lista.map(({ nota, nf }, i) => (
          <FichaDaNota
            key={nota.anexo_id}
            pp={pp}
            nota={nota}
            nf={nf}
            indice={varias ? i + 1 : null}
            editavel={editavel}
            onNf={onNf}
            onVer={() => onVer(nota.anexo_id)}
            estabelecimentos={estabelecimentos}
          />
        ))}
      </div>

      {editavel && !completas ? (
        <p className="mt-2 text-[11px] font-semibold leading-snug text-amber-800">
          Preencha a data de emissão e o valor com os da nota ao lado.
        </p>
      ) : (
        !editavel && (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Registrado pelo financeiro na aprovação.
          </p>
        )
      )}
      {difereDaPP && (
        <p className="mt-1 text-[11px] font-semibold leading-snug text-amber-800">
          {varias ? "As notas somam" : "A NF é de"} {formatCurrency(soma, "BRL")} nesta PP; a PP,
          de {formatCurrency(pp.valor, "BRL")}.
        </p>
      )}
    </div>
  );
}

function FichaDaNota({
  pp,
  nota,
  nf,
  indice,
  editavel,
  onNf,
  onVer,
  estabelecimentos,
}: {
  pp: PPRow;
  nota: NotaDaLinhaPP;
  nf: NfEmConferencia;
  /** "1", "2"… com mais de uma nota; null com uma só. */
  indice: number | null;
  editavel: boolean;
  onNf: (nf: NfEmConferencia) => void;
  onVer: () => void;
  estabelecimentos: FiscalEstabelecimento[];
}) {
  // O CNPJ é o que se confere com a nota; o nome fica na lista.
  const cnpjDoTomador = (id: string) => {
    const e = estabelecimentos.find((x) => x.id === id);
    return e ? formatarCnpj(e.cnpj) : "—";
  };
  const ativos = estabelecimentos.filter((e) => e.ativo && e.cnpj);
  const id = `pp-nf-${nota.anexo_id}`;
  const outras = nota.outras_pps;
  // A nota que outra PP já registrou: o crédito e o ISS retido dela já
  // estão na Apuração; a correção daqui vale para as duas.
  const registradaEmOutra = nota.registrada && nota.registrada.na_pp !== pp.codigo ? nota.registrada : null;

  return (
    <div className={cn(indice !== null && "rounded-lg border border-border bg-white p-2")}>
      {indice !== null && (
        <div className="mb-1.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={nota.arquivo_nome}>
            {indice} · {nota.arquivo_nome}
          </span>
          <button
            type="button"
            onClick={onVer}
            className="flex-none text-[11px] font-semibold text-california-red underline-offset-2 hover:underline"
          >
            Ver
          </button>
        </div>
      )}

      {editavel ? (
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-2">
          <CampoDaNF rotulo="Número" htmlFor={`${id}-numero`}>
            <Input
              id={`${id}-numero`}
              value={nf.numero}
              onChange={(e) => onNf({ ...nf, numero: e.target.value })}
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              className="h-8 px-2 py-1 font-mono text-xs"
            />
          </CampoDaNF>
          <CampoDaNF rotulo="Data de emissão" htmlFor={`${id}-emissao`}>
            {/* O DatePicker só lê o valor quando monta: a aba Dados remonta
                com o que está na conferência, e a tela zera a conferência
                ao fechar. */}
            <DatePicker
              key={`${pp.id}-${nota.anexo_id}`}
              id={`${id}-emissao`}
              name={`pp_nf_emissao_${nota.anexo_id}`}
              defaultValue={nf.emissao || undefined}
              placeholder="Selecione"
              onDateChange={(d) => onNf({ ...nf, emissao: d ? isoDoDia(d) : "" })}
              className="h-8 px-2 text-xs"
            />
          </CampoDaNF>
          <CampoDaNF rotulo="Valor da NF" htmlFor={`${id}-valor`}>
            <MoneyInput
              id={`${id}-valor`}
              value={nf.valor}
              onValueChange={(v) => onNf({ ...nf, valor: v })}
              aria-label="Valor da NF"
              className="h-8 px-2 text-[11.5px]"
            />
          </CampoDaNF>
          <CampoDaNF rotulo="CNPJ tomador" htmlFor={`${id}-tomador`}>
            <Select value={nf.tomador || undefined} onValueChange={(v) => onNf({ ...nf, tomador: v })}>
              <SelectTrigger
                id={`${id}-tomador`}
                aria-label="CNPJ tomador"
                className="h-8 px-2 font-mono text-[11px]"
              >
                <SelectValue placeholder="Selecione">{cnpjDoTomador(nf.tomador)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ativos.map((e) => (
                  <SelectItem key={e.id} value={e.id} className="text-xs">
                    {e.nome} · <span className="font-mono">{formatarCnpj(e.cnpj)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CampoDaNF>
          {nf.cobre_outra && (
            <CampoDaNF rotulo="Valor nesta PP" htmlFor={`${id}-parte`}>
              <MoneyInput
                id={`${id}-parte`}
                value={nf.valor_na_pp}
                onValueChange={(v) => onNf({ ...nf, valor_na_pp: v })}
                aria-label="Valor nesta PP"
                className="h-8 px-2 text-[11.5px]"
              />
            </CampoDaNF>
          )}
        </div>
      ) : (
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-1.5">
          <LeituraDaNF rotulo="Número" valor={<span className="font-mono">{nf.numero || "—"}</span>} />
          <LeituraDaNF rotulo="Data de emissão" valor={formatDate(nf.emissao || null)} />
          <LeituraDaNF
            rotulo="Valor da NF"
            valor={<span className="font-mono">{formatCurrency(nf.valor, "BRL")}</span>}
          />
          <LeituraDaNF
            rotulo="CNPJ tomador"
            valor={<span className="font-mono">{cnpjDoTomador(nf.tomador)}</span>}
          />
          {nf.cobre_outra && (
            <LeituraDaNF
              rotulo="Valor nesta PP"
              valor={<span className="font-mono">{formatCurrency(nf.valor_na_pp, "BRL")}</span>}
            />
          )}
        </dl>
      )}

      {editavel && outras.length === 0 && (
        <button
          type="button"
          onClick={() =>
            onNf({
              ...nf,
              cobre_outra: !nf.cobre_outra,
              valor_na_pp: nf.cobre_outra ? nf.valor : nf.valor_na_pp || nf.valor,
            })
          }
          className="mt-1.5 text-[11px] font-semibold text-california-red underline-offset-2 hover:underline"
        >
          {nf.cobre_outra ? "Esta NF é só desta PP" : "Esta NF também cobre outra PP"}
        </button>
      )}
      {outras.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Também na{" "}
          {outras.map((o, i) => (
            <React.Fragment key={o.codigo}>
              {i > 0 && ", "}
              <span className="font-mono">{o.codigo}</span> ({formatCurrency(o.valor_na_pp, "BRL")})
            </React.Fragment>
          ))}
          .{registradaEmOutra ? ` Registrada na aprovação da ${registradaEmOutra.na_pp ?? "outra PP"}.` : ""}
        </p>
      )}
    </div>
  );
}

function CampoDaNF({
  rotulo,
  htmlFor,
  children,
}: {
  rotulo: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={htmlFor} className="block text-[11px] font-medium text-muted-foreground">
        {rotulo}
      </label>
      {children}
    </div>
  );
}

function LeituraDaNF({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-[12.5px] font-semibold">{valor}</dd>
    </div>
  );
}

