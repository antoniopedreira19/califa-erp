"use client";

/**
 * O pop-up que fecha a errata.
 *
 * Ele é o último lugar em que dá para voltar atrás, então mostra as três
 * coisas que a errata muda — o que aconteceu com cada linha, o total do
 * orçado e o par faturamento/valor do job — e pede a **descrição**, que é
 * obrigatória: é ela que vai para o histórico, para o fio da Comunicação e
 * para a fila de abertura do financeiro.
 *
 * Do design `Planilha Interna - Alterar Orcado (Errata).dc.html` (projeto
 * Claude Design `69342d83`), 27/08/2026.
 *
 * Desde a decisão 159 (08/10/2026) o pop-up tem dois modos: quem REGISTRA
 * (GP e administrador) envia ao financeiro, com a descrição obrigatória;
 * quem PREPARA (o produtor) deixa a errata pronta para envio, com a
 * descrição opcional. Aberto a partir da errata pronta, o campo já vem com
 * a descrição que ela trouxe.
 */

import * as React from "react";
import { AlertCircle, FilePenLine, Landmark, Send, UserCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCurrency } from "@/lib/utils";
import { ERRATA } from "@/app/(app)/_planilha/blocos";
import type { MudancaErrata } from "./errata-rascunho";

interface ParDeValores {
  antes: number;
  depois: number;
}

interface Props {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  jobCodigo: string;
  jobNome: string;
  resumo: string;
  mudancas: MudancaErrata[];
  orcado: ParDeValores;
  faturamento: ParDeValores;
  valorJob: ParDeValores;
  moeda: string;
  /** Alguma linha nova ainda está sem descrição. */
  faltaNomear: boolean;
  salvando: boolean;
  erro: string | null;
  onConfirmar: (descricao: string) => void;
  /** Decisão 159: o GP e o administrador REGISTRAM (enviam ao financeiro,
   *  descrição obrigatória); o produtor PREPARA — deixa a errata pronta
   *  para envio, com a descrição opcional. */
  modo: "registra" | "prepara";
  /** A errata é uma errata pronta para envio: quem preparou, quando e a
   *  descrição que deixou (o campo já abre com ela). */
  pronta: { autorNome: string; quando: string; descricao: string | null } | null;
}

function corDoDelta(delta: number): string {
  if (delta > 0) return "text-[#c2410c]";
  if (delta < 0) return "text-[#047857]";
  return "text-muted-foreground";
}

function comSinal(v: number, moeda: string): string {
  const s = formatCurrency(Math.abs(v), moeda);
  if (v === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

function tagDaMudanca(m: MudancaErrata): { classe: string; texto: string } {
  // Decisão 151: a linha não é mais removida, é cancelada — fica na
  // planilha com o orçado zerado. Mesmo selo cinza da antiga "Removida".
  if (m.acao === "cancelada") return { classe: ERRATA.tagRemovida, texto: "Cancelada" };
  if (m.acao === "nova") {
    return m.vermelha
      ? { classe: ERRATA.tagVermelha, texto: "Vermelha" }
      : { classe: ERRATA.tagNova, texto: "Nova" };
  }
  return { classe: ERRATA.tagAlterada, texto: "Alterada" };
}

function LinhaDeValor({
  rotulo,
  par,
  moeda,
  forte,
}: {
  rotulo: string;
  par: ParDeValores;
  moeda: string;
  forte?: boolean;
}) {
  // O delta é a diferença entre os DOIS VALORES QUE O JOB PASSA A TER, e
  // não entre os intermediários da conta: `jobs.faturamento_previsto` e
  // `jobs.valor_total` são gravados com duas casas, e é sobre eles que a
  // errata fica registrada. Subtrair os números crus fazia a barra mostrar
  // "R$ 20.504,54 → R$ 24.605,44 +R$ 4.100,91" — um delta que não fecha
  // com os dois valores ao lado dele, porque o gross-up caiu em meio
  // centavo. Arredondar antes de subtrair faz os três números sempre
  // fecharem, e é o mesmo que o card de Erratas já faz ao ler as colunas
  // gravadas (31/08/2026).
  const centavos = (n: number) => Math.round(n * 100);
  const delta = (centavos(par.depois) - centavos(par.antes)) / 100;
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
          {formatCurrency(par.antes, moeda)}
        </span>
        <span
          className={cn(
            "font-mono font-bold text-foreground",
            forte ? "text-[13.5px]" : "text-[12.5px]",
          )}
        >
          {formatCurrency(par.depois, moeda)}
        </span>
        <span className={cn("font-mono text-[11.5px] font-bold", corDoDelta(delta))}>
          {comSinal(delta, moeda)}
        </span>
      </div>
    </div>
  );
}

export function ErrataConfirmarDialog({
  open,
  onOpenChange,
  jobCodigo,
  jobNome,
  resumo,
  mudancas,
  orcado,
  faturamento,
  valorJob,
  moeda,
  faltaNomear,
  salvando,
  erro,
  onConfirmar,
  modo,
  pronta,
}: Props) {
  const prepara = modo === "prepara";
  const [descricao, setDescricao] = React.useState("");

  // Zera a cada abertura: o texto de uma errata não pode vazar para a
  // seguinte, e reabrir depois de um erro tem que ser um recomeço limpo.
  // A errata pronta é a exceção: o campo abre com a descrição que ela
  // trouxe, para o GP corrigir em vez de reescrever (decisão 159).
  React.useEffect(() => {
    if (open) setDescricao(pronta?.descricao ?? "");
  }, [open, pronta]);

  // Para quem prepara a descrição é opcional: o GP escreve no envio.
  const descricaoOk = prepara || descricao.trim().length >= 5;
  const podeConfirmar =
    descricaoOk && !faltaNomear && !salvando && mudancas.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[620px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
              <FilePenLine className="h-4.5 w-4.5 text-california-red" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[19px]">
                {prepara
                  ? pronta
                    ? "Salvar errata pronta"
                    : "Deixar errata pronta para envio"
                  : "Confirmar errata"}
              </DialogTitle>
              <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                {jobCodigo} · {jobNome} · {resumo}
              </DialogDescription>
              {pronta && (
                <p className="pt-1 text-[12px] text-muted-foreground">
                  Preparada por{" "}
                  <strong className="font-semibold text-foreground">{pronta.autorNome}</strong>{" "}
                  em {pronta.quando}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* O que muda no orçado */}
          <section className="rounded-xl border border-border">
            <h3 className="border-b border-border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              O que muda no orçado
            </h3>
            <ul className="divide-y divide-border">
              {mudancas.map((m) => {
                const tag = tagDaMudanca(m);
                // A errata não muda o planejado desde a decisão 151; a
                // sublinha só aparece no Interno, onde ele acompanha o
                // orçado (decisão 105).
                const planejadoMudou = m.planejadoDe !== m.planejadoPara;
                return (
                  <li
                    key={m.chave}
                    className="flex flex-col gap-0.5 px-3.5 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={tag.classe}>{tag.texto}</span>
                        <span className="truncate text-[12.5px] text-foreground">
                          {m.item}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11.5px]">
                        <span className="text-muted-foreground">
                          {m.acao === "nova" ? "—" : formatCurrency(m.totalDe, moeda)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground">
                          {formatCurrency(m.totalPara, moeda)}
                        </span>
                        <span className={cn("font-bold", corDoDelta(m.delta))}>
                          {comSinal(m.delta, moeda)}
                        </span>
                      </div>
                    </div>
                    {planejadoMudou && (
                      <div className="flex items-baseline justify-end gap-2 whitespace-nowrap font-mono text-[10.5px]">
                        <span className="text-[#3f8a70]">planejado</span>
                        <span className="text-muted-foreground">
                          {m.acao === "nova" ? "—" : formatCurrency(m.planejadoDe, moeda)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-[#047857]">
                          {formatCurrency(m.planejadoPara, moeda)}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Os números */}
          <section className="rounded-xl border border-border px-3.5 py-2">
            <LinhaDeValor rotulo="Total do orçado" par={orcado} moeda={moeda} />
            <LinhaDeValor
              rotulo="Faturamento previsto"
              par={faturamento}
              moeda={moeda}
            />
            <LinhaDeValor
              rotulo="Valor do job"
              par={valorJob}
              moeda={moeda}
              forte
            />
          </section>

          {/* A consequência que não está nos números. Para quem prepara, a
              consequência é outra: nada muda no job até um GP enviar. */}
          {prepara ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
              <UserCheck className="mt-0.5 h-4 w-4 flex-none text-california-red" />
              <div className="space-y-1">
                <p className="text-[12.5px] font-semibold text-foreground">
                  Um GP revisa e envia ao financeiro
                </p>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  A errata fica salva no job, pronta para envio. Só quando um GP
                  confirmar é que o faturamento previsto muda e o job volta ao
                  mural de abertura. Até lá, você pode editá-la ou descartá-la.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
              <Landmark className="mt-0.5 h-4 w-4 flex-none text-california-red" />
              <div className="space-y-1">
                <p className="text-[12.5px] font-semibold text-foreground">
                  Confirmar devolve o job ao mural de abertura
                </p>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  O financeiro revisa a abertura com os números novos — previsão
                  de recebimento ({formatCurrency(faturamento.depois, moeda)}),
                  curva de desembolso do custo planejado e competência. O envio
                  para faturamento fica bloqueado até essa revisão ser salva.
                </p>
              </div>
            </div>
          )}

          {/* Descrição */}
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <label
                htmlFor="descricao-errata"
                className="text-[12.5px] font-semibold text-foreground"
              >
                Descrição da errata
              </label>
              {prepara ? (
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  opcional
                </span>
              ) : (
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-california-red">
                  obrigatória
                </span>
              )}
            </div>
            <Textarea
              id="descricao-errata"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              maxLength={500}
              autoFocus
              placeholder="Ex.: Iluminação renegociada com o fornecedor depois da visita técnica ao espaço."
            />
            {prepara ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Se ficar em branco, o GP escreve no envio. Ele também pode
                corrigir o que você deixar aqui.
              </p>
            ) : (
              <>
                {pronta && (
                  <p className="text-[11px] font-medium leading-relaxed text-foreground">
                    {pronta.descricao
                      ? `Escrita por ${pronta.autorNome}. Você pode corrigir antes de confirmar.`
                      : `${pronta.autorNome} deixou a errata sem descrição. Escreva antes de confirmar.`}
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Vai para o histórico de erratas, para o fio da Comunicação e para
                  a fila de abertura do financeiro — com autor, data e hora. O
                  orçado aprovado da versão não muda: a errata fica registrada
                  sobre ele.
                </p>
              </>
            )}
          </div>

          {faltaNomear && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-700" />
              <span className="text-[12px] text-amber-900">
                Uma das linhas novas está sem descrição. Preencha o nome dela na
                planilha antes de confirmar.
              </span>
            </div>
          )}

          {erro && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-california-red" />
              <span className="text-[12px] text-foreground">{erro}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
              className="inline-flex items-center rounded-lg border border-border bg-white px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:opacity-50"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => onConfirmar(descricao.trim())}
              disabled={!podeConfirmar}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              {prepara ? <Send className="h-3.5 w-3.5" /> : <FilePenLine className="h-3.5 w-3.5" />}
              {prepara
                ? salvando
                  ? "Salvando…"
                  : pronta
                    ? "Salvar errata pronta"
                    : "Deixar pronta para envio"
                : salvando
                  ? "Registrando…"
                  : "Confirmar errata"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
