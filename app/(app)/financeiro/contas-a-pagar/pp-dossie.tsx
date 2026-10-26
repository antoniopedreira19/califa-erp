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
 *
 * Produção (08/10/2026): a mesma coluna, na leitura da tela da PP aberta
 * pelo "Visualizar" do job (`somenteLeitura`). As notas aparecem como a
 * produção informou no envio, ou como o financeiro registrou; o que é
 * instrução ao financeiro sai; a aba Chat só existe onde há o chat de PPs
 * do financeiro (a produção conversa pelo botão do job).
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Lock,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  documentoTipoLabel,
  nomeContraparteBRPP,
  ppStatusLabel,
  rotuloDaVerbaMinusculo,
  rotuloDeQuemRecebeAVerba,
  ROTULO_CARTAO_CORPORATIVO,
  type DocumentoDaPrestacao,
  type FiscalEstabelecimento,
} from "@/lib/types";
import { hrefDoLinkDaCompra } from "@/lib/validations/cartao-corporativo";
import {
  camposDoDocumento,
  formatarCpfCnpj,
  rotuloDoDocumento,
  somaComprovadaEmCentavos,
  tipoSomaNoComprovado,
  type CamposDoDocumento,
} from "@/lib/calculos/prestacao-da-verba";
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
import { PagamentoForaDoCadastroCartao } from "@/components/financeiro/pagamento-fora-do-cadastro";
import { ehQuarta, ppAceitaQuarta, qualJanela } from "@/lib/calculos/janelas-pagamento";
import { resumoDosDeslocamentos, rotuloDoReembolso } from "@/lib/calculos/reembolso";
import type { PPRow } from "./pedidos-compra-list";
import { useChatPPsOpcional } from "./chat/chat-pps-provider";
import { ChatPPsConversa } from "./chat/chat-pps-conversa";
import { abrirThreadPPs, marcarConversaPPsLida } from "./chat/actions";
import type { ThreadPPsDoJob } from "@/lib/data/chat-pps-conversas";
import {
  eventoPPMostraMotivo,
  pedidoForaDoCadastro,
  rotuloDoEventoPP,
} from "@/lib/data/eventos-da-pp";
import { formatDiaHoraCurtoBr } from "@/lib/formatar-data-hora";
import { formatDataEHoraBr } from "@/lib/formatar-data-hora";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** O dia saía do ISO cortado (UTC) e a hora do relógio local: às 23:54
 *  de Brasília, "09/10/2026 23:54". Os dois agora vêm de Brasília. */
const formatDateTime = formatDataEHoraBr;

function iconePorMime(nome: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(nome) ? ImageIcon : FileText;
}

export type AbaDossie = "dados" | "chat";

/** O CNPJ tomador das notas: o que a coluna mostra do cadastro de impostos. */
export type EstabelecimentoDaNota = Pick<FiscalEstabelecimento, "id" | "nome" | "cnpj" | "ativo">;

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
  documentosDaPrestacao,
  onCorrigirDocumento,
  somenteLeitura = false,
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
  estabelecimentos: EstabelecimentoDaNota[];
  /** Decisão 189: os documentos da prestação como estão na conferência
   *  (com as correções do financeiro por cima). Null fora da verba com
   *  prestação. */
  documentosDaPrestacao: DocumentoDaPrestacao[] | null;
  /** O financeiro corrige os dados de um documento da prestação em
   *  avaliação; `salvar` = gravar agora (saiu do campo, escolheu a data ou
   *  o CNPJ). Null quando nada se corrige. */
  onCorrigirDocumento: ((id: string, campos: CamposDoDocumento, salvar: boolean) => void) | null;
  /** A produção lendo a PP pelo "Visualizar" do job: nada se edita, e
   *  nada do que é instrução ao financeiro aparece. */
  somenteLeitura?: boolean;
}) {
  // Fora do Contas a Pagar não há o chat de PPs do financeiro: sem ele,
  // a coluna fica só com "Dados".
  const chat = useChatPPsOpcional();
  const conversas = chat?.conversas ?? [];
  const zerarNaoLidas = chat?.zerarNaoLidas;
  const [thread, setThread] = React.useState<ThreadPPsDoJob | null>(null);

  const conversa = conversas.find((c) => c.jobId === pp.job_id);
  const naoLidas = conversa?.naoLidas ?? 0;
  const ultimaEm = conversa?.ultimaEm ?? null;

  // Mesmo padrão do balão do canto: carrega o fio, marca como lido, e
  // recarrega quando a última mensagem do job muda (o provider avisa pelo
  // realtime). Só quando a aba está aberta — fio fechado não consome.
  React.useEffect(() => {
    if (aba !== "chat" || !zerarNaoLidas) return;
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
  /** A quarta de exceções da PP urgente ou de verba (decisão 172): selo
   *  vermelho, da cor do "Urgente". Sem ele, a quarta cairia em "fora das
   *  janelas". */
  const quartaDeExcecoes =
    !janelaDoVencimento &&
    ppAceitaQuarta({ urgente: pp.urgente, verba: pp.verba_producao }) &&
    vencimentoOriginal !== "" &&
    ehQuarta(vencimentoOriginal);

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
        {chat && (
          <Aba ativa={aba === "chat"} onClick={() => onAba("chat")} badge={naoLidas}>
            Chat
          </Aba>
        )}
      </div>

      {aba === "dados" || !chat ? (
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

          <Estados pp={pp} somenteLeitura={somenteLeitura} />

          {/* Decisão 209: o cartão corporativo não tem fornecedor — a
              plataforma e o link de onde o financeiro faz a compra. */}
          {pp.cartao_corporativo ? (
            <Grupo rotulo={ROTULO_CARTAO_CORPORATIVO}>
              <p className="text-[13px] font-semibold leading-snug">{pp.cartao_plataforma}</p>
              {pp.cartao_link && (
                <a
                  href={hrefDoLinkDaCompra(pp.cartao_link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex max-w-full items-start gap-1 break-all text-[11.5px] leading-snug text-california-red hover:underline"
                >
                  {pp.cartao_link}
                  <ExternalLink className="mt-0.5 h-3 w-3 flex-none" />
                </a>
              )}
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Pago no cartão de crédito da empresa; as parcelas são as da fatura.
              </p>
            </Grupo>
          ) : (
          <Grupo
            rotulo={
              pp.tipo_verba
                ? pp.verba_titular_tipo === "fornecedor"
                  ? "Titular da verba (terceiro)"
                  : rotuloDeQuemRecebeAVerba(pp)
                : "Fornecedor"
            }
          >
            <p className="text-[13px] font-semibold leading-snug">
              {nomeContraparteBRPP({
                verba_producao: pp.verba_producao,
                tipo_verba: pp.tipo_verba,
                verba_titular_nome: pp.responsavel_nome,
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
          )}

          <Grupo rotulo="Origem no job">
            {/* O job na página do FINANCEIRO, não na da produção: o
                financeiro não sai do módulo (decisão 099, item 20). Na
                leitura da produção, a página do job dela. */}
            <Link
              href={somenteLeitura ? `/jobs/${pp.job_id}` : `/financeiro/jobs/${pp.job_id}`}
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

          {/* Decisão 187: o reembolso diz de quê, e o de veículo próprio
              mostra a conta — o PDF ao lado tem a tabela dos deslocamentos. */}
          {pp.reembolso_tipo && (
            <Grupo rotulo="Reembolso">
              <p className="text-[12.5px] font-semibold leading-snug">{rotuloDoReembolso(pp.reembolso_tipo)}</p>
              {pp.reembolso_tipo === "veiculo_proprio" && pp.reembolso_deslocamentos && (
                <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                  {resumoDosDeslocamentos(pp.reembolso_deslocamentos)}
                </p>
              )}
            </Grupo>
          )}

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
                {pp.cartao_corporativo
                  ? "Pedido pela produção para a compra no cartão."
                  : "Negociado pela produção com o fornecedor."}
              </p>
            </div>
            {vencimentoOriginal &&
              (janelaDoVencimento ? (
                <span className="flex-none rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                  ✓ janela do dia {janelaDoVencimento === 8 ? "08" : "20"}
                </span>
              ) : quartaDeExcecoes ? (
                <span className="flex-none rounded-md bg-california-red/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-california-red">
                  ✓ quarta de exceções
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
          <Grupo rotulo={`${pp.reembolso_tipo ? "Comprovantes" : "Anexos"} (${pp.anexos.length})`}>
            {pp.anexos.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">
                {pp.reembolso_tipo
                  ? "A produção não enviou comprovante nesta PP."
                  : pp.cartao_corporativo
                    ? "Nenhum: o cartão corporativo vai sem nota."
                    : "A produção não enviou documento nesta PP."}
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
                          {/* Decisão 187: o comprovante da despesa com o que a
                              produção informou — a soma fecha o valor da PP. */}
                          {pp.reembolso_tipo === "despesas" && a.documento_tipo && (
                            <span className="block truncate text-muted-foreground">
                              {documentoTipoLabel(a.documento_tipo)}
                              {a.documento_numero ? ` ${a.documento_numero}` : ""} ·{" "}
                              {formatDate(a.nf_data_emissao)} ·{" "}
                              <span className="font-mono font-semibold text-foreground">
                                {formatCurrency(a.nf_valor ?? 0, "BRL")}
                              </span>
                            </span>
                          )}
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
            somenteLeitura={somenteLeitura}
            onVer={(anexoId) => {
              const i = pp.anexos.findIndex((a) => a.id === anexoId);
              if (i >= 0) onAnexo(i);
            }}
          />

          {/* Decisão 189 (drawer "1 · Enxuto"): na verba, a prestação vem
              antes do histórico, e o histórico perde "Documentos na
              aprovação" — a verba é aprovada sem documento, sempre. O
              reembolso não presta contas (decisão 187). */}
          {ehVerbaComPrestacao(pp) ? (
            <>
              <Prestacao
                pp={pp}
                documentos={documentosDaPrestacao ?? []}
                anexoAtivo={anexoAtivo}
                onDocumento={onAnexo}
                onCorrigir={onCorrigirDocumento}
                estabelecimentos={estabelecimentos}
              />
              <Historico pp={pp} semDocumentosNaAprovacao />
            </>
          ) : (
            <Historico pp={pp} />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatPPsConversa
            jobId={pp.job_id}
            thread={thread}
            onThread={setThread}
            podeEnviar={chat.podeEnviar}
            onEnviou={() => void chat.recarregar()}
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
/** A verba que presta contas — o reembolso não presta (decisão 187). */
function ehVerbaComPrestacao(pp: PPRow): boolean {
  return pp.verba_producao && !pp.reembolso_tipo;
}

function Historico({
  pp,
  semDocumentosNaAprovacao = false,
}: {
  pp: PPRow;
  /** Na verba (decisão 189), o bloco "Documentos na aprovação" sai: ela é
   *  aprovada sem documento, e os documentos dela estão na prestação. */
  semDocumentosNaAprovacao?: boolean;
}) {
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
                  {/* Na NF corrigida e na troca da empresa emissora, o motivo é
                      o que mudou, escrito pelo banco: sem aspas. */}
                  {e.evento === "nf_corrigida" || e.evento === "emissora_trocada" ? e.motivo : <>“{e.motivo}”</>}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {pp.aprovada_em && !semDocumentosNaAprovacao && (
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
            pp.verba_producao && !pp.reembolso_tipo ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Aprovada sem documento — PP de {rotuloDaVerbaMinusculo(pp.tipo_verba ?? "producao")}.
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

/** Cancelamento, rejeição e pagamento — só aparecem no estado que os criou.
 *  Na leitura da produção, as linhas que dizem ao financeiro o que fazer
 *  nesta tela saem. */
function Estados({ pp, somenteLeitura }: { pp: PPRow; somenteLeitura: boolean }) {
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
          {somenteLeitura ? (
            "Aprovada pelo financeiro — já é título a pagar."
          ) : (
            <>
              Aprovada — já é título a pagar. Para devolvê-la à produção, use
              &ldquo;Reprovar PP&rdquo; no rodapé.
            </>
          )}
        </span>
      </div>
    );
  }
  if (pp.status !== "em_avaliacao" && !somenteLeitura) {
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

/**
 * A prestação de contas da verba na coluna Dados — o drawer "1 · Enxuto"
 * aprovado em 19/10/2026 (decisão 189). Sem o resumo do topo (título,
 * situação e barra: a situação já está no cabeçalho da tela): a lista dos
 * documentos, com os dados do selecionado para conferir ao lado da imagem,
 * e os totais no pé.
 *
 * Os dados abrem sozinhos no documento selecionado; a seta no fim da linha
 * fecha e reabre, e cada documento lembra o estado. O financeiro corrige
 * com a prestação em avaliação; os CNPJs vão em linha inteira, para caber
 * nos 310 px da coluna sem cortar.
 */
function Prestacao({
  pp,
  documentos,
  anexoAtivo,
  onDocumento,
  onCorrigir,
  estabelecimentos,
}: {
  pp: PPRow;
  documentos: DocumentoDaPrestacao[];
  /** Índice do documento aberto no painel do meio. */
  anexoAtivo: number;
  onDocumento: (i: number) => void;
  onCorrigir: ((id: string, campos: CamposDoDocumento, salvar: boolean) => void) | null;
  estabelecimentos: EstabelecimentoDaNota[];
}) {
  const pr = pp.prestacao;
  const brl = (n: number) => formatCurrency(n, "BRL");
  const [fechados, setFechados] = React.useState<ReadonlySet<string>>(() => new Set());
  const alternar = (id: string) =>
    setFechados((f) => {
      const n = new Set(f);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const gasto = somaComprovadaEmCentavos(documentos) / 100;
  const saldo = Math.round((pp.valor - gasto) * 100) / 100;
  const nfs = documentos.filter((d) => d.documento_tipo === "nota_fiscal");
  const nfsNoFiscal = nfs.filter((d) => d.nota_fiscal_id);
  const corrige = onCorrigir !== null && pr?.status === "em_avaliacao";

  return (
    <section>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Documentos da prestação ({documentos.length})
      </p>

      {!pr && (
        <p className="text-[11.5px] text-muted-foreground">
          {pp.status === "pago"
            ? "Verba paga. Quem presta contas é a produção, pelo PPs da planilha ou pela aba de PPs do job."
            : "A prestação chega depois que a verba for paga."}
        </p>
      )}

      {pr?.status === "reprovada" && pr.motivo_reprovacao && (
        <div className="mb-2 rounded-lg border border-california-red/30 bg-california-red/5 p-2 text-[11px]">
          <p className="font-semibold text-california-red">
            Reprovada{pr.reprovada_por_nome ? ` por ${pr.reprovada_por_nome}` : ""} ·{" "}
            {formatDateTime(pr.reprovada_em)}
          </p>
          <p className="text-foreground/80">“{pr.motivo_reprovacao}”</p>
        </div>
      )}

      {pr && documentos.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-2 text-[11px] text-muted-foreground">
          Sem gasto — a produção devolve a verba inteira, sem documento.
        </p>
      )}

      {documentos.length > 0 && (
        <ul className="space-y-1">
          {documentos.map((d, i) => {
            const sel = i === anexoAtivo;
            const temCampos = sel && corrige;
            const abertos = temCampos && !fechados.has(d.id);
            return (
              <li
                key={d.id}
                className={cn(
                  "rounded-lg border p-1.5",
                  sel ? "border-california-red bg-california-red/5" : "border-border",
                )}
              >
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onDocumento(i)}
                    aria-pressed={sel}
                    title={`Ver ${d.arquivo_nome_original} ao lado da PP`}
                    className="grid min-w-0 flex-1 grid-cols-[14px_minmax(0,1fr)_auto] items-baseline gap-1.5 text-left text-[11px]"
                  >
                    <span className="font-mono text-muted-foreground">{i + 1}</span>
                    <span className="truncate">
                      {rotuloDoDocumento(d)} · {d.emitente_nome || d.arquivo_nome_original}
                    </span>
                    <span className="font-mono font-semibold">
                      {tipoSomaNoComprovado(d.documento_tipo) ? brl(Number(d.valor ?? 0)) : "—"}
                    </span>
                  </button>
                  {temCampos && (
                    <button
                      type="button"
                      onClick={() => alternar(d.id)}
                      aria-expanded={abertos}
                      aria-label={abertos ? "Fechar os dados do documento" : "Abrir os dados do documento"}
                      title={abertos ? "Fechar os dados do documento" : "Abrir os dados do documento"}
                      className="inline-flex h-5 w-5 flex-none items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-california-red"
                    >
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", abertos && "rotate-180")} />
                    </button>
                  )}
                </div>
                {abertos && onCorrigir && (
                  <ConferirDocumento d={d} estabelecimentos={estabelecimentos} onCorrigir={onCorrigir} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* O aviso do fiscal em meia linha: a regra o financeiro aprende uma
          vez; o que muda de PP para PP são as notas. */}
      {pr?.status === "aprovada"
        ? nfsNoFiscal.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
              <FileCheck2 className="h-3 w-3 flex-none" />
              <span>
                No fiscal:{" "}
                <span className="font-mono">{nfsNoFiscal.map((d) => `NF ${d.documento_numero ?? ""}`).join(", ")}</span>
              </span>
            </p>
          )
        : pr &&
          nfs.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
              <FileCheck2 className="h-3 w-3 flex-none" />
              {nfs.length === 1 ? "1 NF entra" : `${nfs.length} NFs entram`} no fiscal na aprovação.
            </p>
          )}

      {pr && (
        <div className="mt-2 space-y-1 border-t border-border pt-2 text-[11px]">
          <div className="flex justify-between font-semibold">
            <span>Gasto comprovado</span>
            <span className="font-mono">{brl(gasto)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Verba</span>
            <span className="font-mono">{brl(pp.valor)}</span>
          </div>
          {pp.devolucao ? (
            <>
              <div className="flex justify-between rounded-md bg-teal-50 px-2 py-1 font-semibold text-teal-800">
                <span>Estorno de verba</span>
                <span className="font-mono">−{brl(pp.devolucao.valor)}</span>
              </div>
              <p className="text-muted-foreground">
                {pp.devolucao.pago_em
                  ? `Devolvido em ${formatDate(pp.devolucao.pago_em)}.`
                  : `Devolução prevista para ${formatDate(pp.devolucao.data_pagamento)}.`}
              </p>
            </>
          ) : (
            pr.status !== "aprovada" && (
              <div className="flex justify-between text-muted-foreground">
                <span>Saldo → estorno</span>
                <span className="font-mono">{brl(Math.max(0, saldo))}</span>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}

const rotuloDaConferencia = "text-[10.5px] font-medium text-muted-foreground";
const alturaDaConferencia = "h-7 px-2 text-[11px]";

/**
 * Os dados de um documento da prestação, que o financeiro confere com a
 * imagem ao lado e corrige (decisão 189). O tipo é da produção: quem
 * discordar reprova.
 */
function ConferirDocumento({
  d,
  estabelecimentos,
  onCorrigir,
}: {
  d: DocumentoDaPrestacao;
  estabelecimentos: EstabelecimentoDaNota[];
  onCorrigir: (id: string, campos: CamposDoDocumento, salvar: boolean) => void;
}) {
  const campos: CamposDoDocumento = {
    ...camposDoDocumento(d),
    emitente_documento: d.emitente_documento ?? "",
  };
  // O CNPJ digitado fica como a pessoa escreve até sair do campo.
  const [cnpjDigitado, setCnpjDigitado] = React.useState(() => formatarCpfCnpj(d.emitente_documento));
  const mudar = (c: Partial<CamposDoDocumento>, salvar: boolean) => onCorrigir(d.id, { ...campos, ...c }, salvar);
  const t = d.documento_tipo;
  const fiscal = t === "nota_fiscal" || t === "fatura" || t === "cupom_fiscal";
  const comTomador = t === "nota_fiscal" || t === "fatura";
  const idBase = `conf-${d.id.slice(0, 8)}`;
  const tomador = estabelecimentos.find((e) => e.id === d.tomador_estabelecimento_id);

  const texto = (
    campo: "documento_numero" | "emitente_nome" | "descricao",
    titulo: string,
    mono = false,
  ) => (
    <label className="block min-w-0" htmlFor={`${idBase}-${campo}`}>
      <span className={rotuloDaConferencia}>{titulo}</span>
      <Input
        id={`${idBase}-${campo}`}
        value={campos[campo]}
        onChange={(e) => mudar({ [campo]: e.target.value }, false)}
        onBlur={(e) => mudar({ [campo]: e.target.value }, true)}
        maxLength={campo === "documento_numero" ? 60 : 200}
        autoComplete="off"
        className={cn(mono && "font-mono", alturaDaConferencia)}
      />
    </label>
  );
  const data = (
    <label className="block min-w-0" htmlFor={`${idBase}-data`}>
      <span className={rotuloDaConferencia}>{fiscal ? "Emissão" : "Data"}</span>
      <DatePicker
        key={`${idBase}-data`}
        id={`${idBase}-data`}
        name={`${idBase}_data`}
        defaultValue={d.documento_data ?? undefined}
        placeholder="Selecione"
        onDateChange={(x) => mudar({ documento_data: x ? isoDoDia(x) : "" }, true)}
        className={alturaDaConferencia}
      />
    </label>
  );
  const valor = (
    <label className="block min-w-0" htmlFor={`${idBase}-valor`}>
      <span className={rotuloDaConferencia}>Valor</span>
      <MoneyInput
        id={`${idBase}-valor`}
        value={d.valor && d.valor > 0 ? d.valor : null}
        onValueChange={(v) => mudar({ valor: v > 0 ? v : null }, false)}
        onBlur={() => mudar({}, true)}
        className={alturaDaConferencia}
      />
    </label>
  );
  const emitenteDocumento = (titulo: string) => (
    <label className="block min-w-0" htmlFor={`${idBase}-emitente-doc`}>
      <span className={rotuloDaConferencia}>{titulo}</span>
      <Input
        id={`${idBase}-emitente-doc`}
        value={cnpjDigitado}
        onChange={(e) => {
          setCnpjDigitado(e.target.value);
          mudar({ emitente_documento: e.target.value }, false);
        }}
        onBlur={(e) => {
          setCnpjDigitado(formatarCpfCnpj(e.target.value));
          mudar({ emitente_documento: e.target.value }, true);
        }}
        maxLength={18}
        autoComplete="off"
        className={cn("font-mono", alturaDaConferencia)}
      />
    </label>
  );

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-border bg-muted/20 p-2">
      <p className="text-[10.5px] font-semibold text-muted-foreground">
        {t === "nota_fiscal"
          ? "Dados da NF — confira com a nota ao lado"
          : t === "fatura"
            ? "Dados da fatura — confira ao lado"
            : "Dados do documento — confira ao lado"}
      </p>
      {t === "outro" && texto("descricao", "Descrição")}
      <div className="grid grid-cols-2 gap-1.5">
        {t !== "outro" && texto("documento_numero", "Número", true)}
        {data}
        {tipoSomaNoComprovado(t) && valor}
      </div>
      {comTomador && (
        <label className="block min-w-0" htmlFor={`${idBase}-tomador`}>
          <span className={rotuloDaConferencia}>CNPJ tomador</span>
          <Select
            value={d.tomador_estabelecimento_id ?? undefined}
            onValueChange={(v) => mudar({ tomador_estabelecimento_id: v }, true)}
          >
            <SelectTrigger
              id={`${idBase}-tomador`}
              aria-label="CNPJ tomador"
              className={cn("font-mono", alturaDaConferencia)}
            >
              <SelectValue placeholder="Selecione">
                {tomador ? formatarCnpj(tomador.cnpj ?? "") : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {estabelecimentos
                .filter((e) => e.ativo || e.id === d.tomador_estabelecimento_id)
                .map((e) => (
                  <SelectItem key={e.id} value={e.id} className="text-xs">
                    {e.nome} · <span className="font-mono">{formatarCnpj(e.cnpj ?? "")}</span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </label>
      )}
      {fiscal && emitenteDocumento("Emitente · CNPJ")}
      {fiscal && texto("emitente_nome", "Emitente · razão social")}
      {t === "recibo" && texto("emitente_nome", "Quem recebeu")}
      {t === "recibo" && emitenteDocumento("CPF/CNPJ de quem recebeu")}
    </div>
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
 *
 * Na leitura da produção (08/10/2026), nada se edita, e entram também as
 * notas ainda não registradas — o que a produção informou no envio. Fica
 * de fora só a nota sem dado nenhum (anexo marcado NF antes da decisão
 * 152, que nunca recebeu data nem valor).
 */
function NotasFiscaisDoFornecedor({
  pp,
  notas,
  nfs,
  onNf,
  estabelecimentos,
  somenteLeitura,
  onVer,
}: {
  pp: PPRow;
  notas: NotasFiscaisDaLinhaPP | null;
  nfs: NfEmConferencia[] | null;
  onNf: (nf: NfEmConferencia) => void;
  estabelecimentos: EstabelecimentoDaNota[];
  somenteLeitura: boolean;
  /** Abre o arquivo da nota no painel do meio. */
  onVer: (anexoId: string) => void;
}) {
  if (!notas) return null;
  const editavel = !somenteLeitura && pp.status === "em_avaliacao" && nfs !== null;
  // Fora da avaliação: só as notas que o financeiro registrou. Na leitura
  // da produção, também as que ela informou no envio.
  const lista: Array<{ nota: NotaDaLinhaPP; nf: NfEmConferencia }> = editavel
    ? notas.notas.map((nota, i) => ({ nota, nf: nfs[i] }))
    : notas.notas
        .filter((nota) =>
          somenteLeitura
            ? nota.registrada !== null || nota.emissao !== null || nota.valor !== null
            : nota.registrada,
        )
        .map((nota) => ({ nota, nf: nfInicial(nota, null) }));
  if (lista.length === 0) return null;

  const varias = lista.length > 1;
  const soma = somaDasPartes(lista.map((x) => x.nf));
  const completas = lista.every((x) => !nfIncompleta(x.nf));
  const difereDaPP = completas && Math.abs(soma - pp.valor) > 0.004;

  // Decisão 156: o CNPJ da PP — a nota deve vir nele.
  const cnpjDaPP = estabelecimentos.find((e) => e.id === pp.estabelecimento_id) ?? null;

  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {varias ? `Notas fiscais do fornecedor (${lista.length})` : "Nota fiscal do fornecedor"}
      </p>
      {cnpjDaPP && (
        <p className="mb-1.5 text-[11px] text-muted-foreground">
          CNPJ da PP: <span className="font-medium text-foreground">{cnpjDaPP.nome}</span> ·{" "}
          <span className="font-mono">{formatarCnpj(cnpjDaPP.cnpj)}</span>
        </p>
      )}
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
            {somenteLeitura && !notas.conferidas_em
              ? "Informado pela produção no envio. O financeiro confere na aprovação."
              : "Registrado pelo financeiro na aprovação."}
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
  estabelecimentos: EstabelecimentoDaNota[];
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
      {/* Decisão 156: a nota em outro CNPJ que não o da PP — a produção
          confirmou no envio; o financeiro decide aqui. */}
      {pp.estabelecimento_id && nf.tomador && nf.tomador !== pp.estabelecimento_id && (
        <p className="mt-1.5 text-[11px] font-semibold leading-snug text-california-red">
          A nota está no CNPJ {estabelecimentos.find((e) => e.id === nf.tomador)?.nome ?? "—"}; a PP é do CNPJ{" "}
          {estabelecimentos.find((e) => e.id === pp.estabelecimento_id)?.nome ?? "—"}.
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

