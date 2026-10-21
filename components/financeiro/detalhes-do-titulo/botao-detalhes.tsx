"use client";

/**
 * O ⓘ da linha das planilhas de títulos e do Extrato (decisão 195, variante
 * A): o mesmo botão redondo e o mesmo pop-up do ⓘ do Extrato, com só o que
 * a linha não mostra — a trilha da origem, o pagamento, o retido na fonte,
 * de onde vem o dinheiro, a regional, os documentos e as ações da tela de
 * origem (as que moravam soltas na linha).
 *
 * A trilha, o pagamento e os documentos chegam do servidor quando o pop-up
 * abre (`carregarDetalhesDoTitulo`); a regional e as retenções já vêm na
 * linha. Os documentos abrem lado a lado: o interno à esquerda, o de
 * pagamento à direita.
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Eye, FileText, Info, Loader2, Paperclip, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { carregarDetalhesDoTitulo } from "@/app/(app)/financeiro/actions-detalhes-do-titulo";
import type { DetalhesDoTitulo } from "@/lib/financeiro/detalhes-do-titulo";
import { juntarRateio, type ParteDoRateio } from "@/lib/financeiro/planilha-de-titulos";
import { VisualizadorDeDocumentos } from "./visualizador";

export interface AcaoDoDetalhe {
  rotulo: string;
  icone: LucideIcon;
  onClick: () => void;
  perigo?: boolean;
}

const ROTULO = "text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground";

function Grupo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className={ROTULO}>{rotulo}</p>
      <div>{children}</div>
    </div>
  );
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** "Visualizar interno e pagamento lado a lado" só quando há os dois
 *  lados; senão, os N do mesmo lado, trocados pelos números. */
function rotuloVer(docs: DetalhesDoTitulo["documentos"]): string {
  const ambos = docs.some((d) => d.grupo === "origem") && docs.some((d) => d.grupo === "pagamento");
  return ambos ? "Visualizar interno e pagamento lado a lado" : `Visualizar os ${docs.length}`;
}

export function BotaoDetalhes({
  chave,
  titulo,
  rotulo = "Ver detalhes do título",
  recebimento,
  job,
  vencimentoDiferente,
  retencoes,
  rateio,
  acoes,
}: {
  /** A chave do título (`pagar|pp|<id>`, `imposto|<id>`…). */
  chave: string;
  /** A descrição da linha, para o cabeçalho do visualizador. */
  titulo: string;
  rotulo?: string;
  /** O dinheiro entra: o grupo se chama "Recebimento". */
  recebimento: boolean;
  job: { codigo: string; nome: string } | null;
  /** O vencimento do documento, quando difere da data prevista. */
  vencimentoDiferente: string | null;
  retencoes: Array<{ rotulo: string; valor: number }>;
  rateio: ParteDoRateio[];
  acoes: AcaoDoDetalhe[];
}) {
  const [aberto, setAberto] = React.useState(false);
  const [detalhes, setDetalhes] = React.useState<DetalhesDoTitulo | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [vendo, setVendo] = React.useState<{ inicial: number | null } | null>(null);
  const cabecalho = rotulo.replace("Ver d", "D");

  const abrir = (proximo: boolean) => {
    setAberto(proximo);
    if (!proximo || detalhes || carregando) return;
    setCarregando(true);
    setErro(null);
    carregarDetalhesDoTitulo(chave)
      .then((r) => (r.ok ? setDetalhes(r.detalhes) : setErro(r.message)))
      .catch(() => setErro("Não foi possível ler os detalhes do título."))
      .finally(() => setCarregando(false));
  };

  const partes = juntarRateio(rateio);
  const docs = detalhes?.documentos ?? [];
  // A linha do título traz a retenção dela; a do Extrato, a que a baixa fez.
  const retidas = retencoes.length > 0 ? retencoes : (detalhes?.retido ?? []);

  return (
    <>
      <PopoverPrimitive.Root open={aberto} onOpenChange={abrir}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={rotulo}
            title={cabecalho}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border transition-colors",
              aberto
                ? "border-california-red bg-california-red text-white"
                : "border-california-red/40 text-california-red hover:bg-california-red/5",
            )}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="left"
            align="end"
            sideOffset={8}
            collisionPadding={8}
            onClick={(e) => e.stopPropagation()}
            className="z-[70] max-h-[80vh] w-[320px] overflow-y-auto rounded-xl border border-border bg-white p-4 text-left text-xs shadow-elevated outline-none"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2">
                <p className={ROTULO}>{cabecalho}</p>
                {detalhes && (
                  <span className="font-mono text-[10px] font-semibold text-muted-foreground">{detalhes.referencia}</span>
                )}
              </div>
              {carregando && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Carregando…
                </p>
              )}
              {erro && <p className="text-california-red">{erro}</p>}
              {detalhes && (
                <>
                  <Grupo rotulo="Origem">
                    <div className="space-y-0.5">
                      {detalhes.trilha.map((l) => (
                        <p key={l}>{l}</p>
                      ))}
                      {job && (
                        <p className="text-muted-foreground">
                          Job {job.codigo}
                          {job.nome ? ` · ${job.nome}` : ""}
                        </p>
                      )}
                      {(detalhes.parcela || vencimentoDiferente) && (
                        <p className="text-muted-foreground">
                          {detalhes.parcela && `Parcela ${detalhes.parcela}`}
                          {detalhes.parcela && vencimentoDiferente && " · "}
                          {vencimentoDiferente && `vencimento ${dataBR(vencimentoDiferente)}`}
                        </p>
                      )}
                    </div>
                  </Grupo>
                  <Grupo rotulo={recebimento ? "Recebimento" : "Pagamento"}>
                    <div className="space-y-0.5">
                      <p>{detalhes.pagamento.linha}</p>
                      {detalhes.pagamento.detalhe && (
                        <p className="break-all font-mono text-[10.5px] text-muted-foreground">{detalhes.pagamento.detalhe}</p>
                      )}
                    </div>
                  </Grupo>
                </>
              )}
              {retidas.length > 0 && (
                <Grupo rotulo="Retido na fonte">
                  <div className="flex flex-col gap-0.5">
                    {retidas.map((r) => (
                      <div key={r.rotulo} className="flex items-baseline justify-between gap-4">
                        <span>{r.rotulo}</span>
                        <span className="font-mono text-muted-foreground">{formatBRL(r.valor)}</span>
                      </div>
                    ))}
                  </div>
                </Grupo>
              )}
              {detalhes?.saidaDaBaixa && (
                // A baixa com juros e multa (decisão 196): a linha do Extrato
                // mostra a soma; aqui, o que quita o título e o que é juros.
                <Grupo rotulo="Saiu da conta">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-4">
                      <span>Principal · quita o título</span>
                      <span className="font-mono text-muted-foreground">{formatBRL(detalhes.saidaDaBaixa.principal)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <span>Juros e multa · 11 · Despesa com Juros</span>
                      <span className="font-mono text-muted-foreground">{formatBRL(detalhes.saidaDaBaixa.juros)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 border-t border-border pt-0.5 font-semibold">
                      <span>Total</span>
                      <span className="font-mono">
                        {formatBRL(Math.round((detalhes.saidaDaBaixa.principal + detalhes.saidaDaBaixa.juros) * 100) / 100)}
                      </span>
                    </div>
                  </div>
                </Grupo>
              )}
              {detalhes && detalhes.origensDoDinheiro.length > 1 && (
                <Grupo rotulo="De onde vem este dinheiro">
                  <div className="flex flex-col gap-1">
                    {detalhes.origensDoDinheiro.map((o) => (
                      <div key={`${o.codigo}-${o.nome}`} className="flex items-baseline justify-between gap-4">
                        <span className="flex items-baseline gap-2">
                          <span className="font-mono font-semibold">{o.codigo}</span>
                          <span className="text-[#5f5d57]">{o.nome}</span>
                        </span>
                        <span className="whitespace-nowrap font-mono font-semibold">{formatBRL(o.valor)}</span>
                      </div>
                    ))}
                  </div>
                </Grupo>
              )}
              {partes.length > 0 && (
                <Grupo rotulo="Regional">
                  <div className="flex flex-col gap-0.5">
                    {partes.map((p) => (
                      <div key={p.regional} className="flex items-baseline justify-between gap-4">
                        <span>{p.regional}</span>
                        <span className="font-mono text-muted-foreground">
                          {p.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                        </span>
                      </div>
                    ))}
                  </div>
                </Grupo>
              )}
              {detalhes && (
                <Grupo rotulo={docs.length ? `Documentos (${docs.length})` : "Documentos"}>
                  {docs.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="space-y-1">
                      {docs.map((d, i) => (
                        <button
                          key={`${d.arquivo}-${i}`}
                          type="button"
                          onClick={() => {
                            setAberto(false);
                            setVendo({ inicial: i });
                          }}
                          className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-muted"
                        >
                          {d.grupo === "origem" ? (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-california-red" />
                          ) : (
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-violet-700" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{d.tipo}</span>
                          <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                      {docs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAberto(false);
                            setVendo({ inicial: null });
                          }}
                          className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-california-red/40 py-1.5 text-[11px] font-semibold text-california-red hover:bg-california-red/5"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {rotuloVer(docs)}
                        </button>
                      )}
                    </div>
                  )}
                </Grupo>
              )}
              {acoes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                  {acoes.map((a) => (
                    <button
                      key={a.rotulo}
                      type="button"
                      onClick={() => {
                        setAberto(false);
                        a.onClick();
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold",
                        a.perigo
                          ? "border-california-red/30 text-california-red hover:bg-california-red/5"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      <a.icone className="h-3 w-3" />
                      {a.rotulo}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {detalhes && docs.length > 0 && (
        <VisualizadorDeDocumentos
          aberto={vendo !== null}
          onFechar={() => setVendo(null)}
          referencia={detalhes.referencia}
          titulo={titulo}
          documentos={docs}
          inicial={vendo?.inicial ?? null}
        />
      )}
    </>
  );
}
