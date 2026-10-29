"use client";

// A PP enviada ao Comitê, em consulta (decisão 223, protótipo aprovado): no
// lugar do formulário de gerar/editar PP, o mesmo drawer com só o que a
// aprovação precisa ler, em texto — o item com o realizado acima do
// orçado, o motivo de quem enviou, o valor (R$ Unit. × QT × D/M),
// fornecedor e pagamento, urgência só quando é, o serviço e os anexos, que
// abrem para ver. A decisão é a da barra embaixo.
import * as React from "react";
import { AlertTriangle, Eye, FileText, Lock, ShieldAlert, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DrawerContent } from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { formatDataAsHoraBr } from "@/lib/formatar-data-hora";
import type { PPAEmitir } from "@/lib/types";
import { signedUrlAnexoAEmitir } from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";

const brl = (n: number) => formatCurrency(n, "BRL");
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
      {children}
    </div>
  );
}

function Campo({ rotulo, children, className }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <div className="text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

function VerAnexo({ nome, url, erro, onFechar }: { nome: string; url: string | null; erro: string | null; onFechar: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="flex h-[88vh] max-h-none w-[min(1100px,94vw)] max-w-none flex-col gap-3 p-5">
        <DialogHeader>
          <DialogTitle className="text-base">{nome}</DialogTitle>
        </DialogHeader>
        {url ? (
          <iframe title={nome} src={url} className="min-h-0 flex-1 rounded-lg border border-border bg-white" />
        ) : (
          <p className="text-sm text-muted-foreground">{erro ?? "Abrindo o documento…"}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface ItemDaConsulta {
  nome: string;
  linhaVermelha: boolean;
  orcado: number;
  planejado: number;
  /** O realizado do item sem esta PP. */
  jaEmPPs: number;
}

export function ConsultaDaPP({
  open,
  onOpenChange,
  aEmitir,
  item,
  enviadoPor,
  enviadoEm,
  motivo,
  fornecedor,
  empresaEmissora,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aEmitir: PPAEmitir;
  item: ItemDaConsulta;
  enviadoPor: string;
  enviadoEm: string;
  motivo: string;
  fornecedor: string;
  empresaEmissora: string;
}) {
  const [vendo, setVendo] = React.useState<{ nome: string; url: string | null; erro: string | null } | null>(null);
  const d = aEmitir.dados;
  const parcelas = d.parcelas ?? [];
  const urgente = d.urgente === true;
  const comAPP = Math.round((item.jaEmPPs + aEmitir.valor) * 100) / 100;
  const excesso = Math.round((comAPP - item.orcado) * 100) / 100;
  const fora = d.pagamento_fora_do_cadastro;
  const pagamento = aEmitir.cartao_corporativo
    ? "Cartão corporativo"
    : fora
      ? fora.meio === "boleto"
        ? "Boleto"
        : fora.meio === "guia"
          ? "Guia"
          : "Fora do cadastro"
      : aEmitir.verba_producao
        ? "Verba de produção"
        : "Cadastro do fornecedor";

  async function abrir(anexoId: string, nome: string) {
    setVendo({ nome, url: null, erro: null });
    const r = await signedUrlAnexoAEmitir(anexoId);
    setVendo({ nome, url: r.ok ? r.url : null, erro: r.ok ? null : r.message });
  }

  return (
    <>
      {/* Não modal e acima da barra de decisão: Devolver e Aprovar ficam à
          vista e clicáveis com a PP aberta (protótipo aprovado). */}
      <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
        <DrawerContent
          className="bottom-16 h-auto sm:max-w-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // A barra de decisão fica fora do drawer e precisa do clique.
          onInteractOutside={(e) => {
            if ((e.target as HTMLElement | null)?.closest?.("[data-barra-do-comite]")) e.preventDefault();
          }}
        >
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
            <DialogTitle>PP para o Comitê · {item.nome}</DialogTitle>
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Lock className="h-3 w-3" />
              Apenas leitura — enviada ao Comitê por {enviadoPor} em {formatDataAsHoraBr(enviadoEm)}
            </p>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-6 pb-24">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Item</p>
              <p className="flex items-center gap-2 font-medium">
                {item.nome}
                {item.linhaVermelha && (
                  <span className="rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-red-700">
                    Linha vermelha
                  </span>
                )}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <Campo rotulo="Orçado do item">
                  <span className="font-mono font-semibold">{brl(item.orcado)}</span>
                </Campo>
                <Campo rotulo="Planejado do item">
                  <span className="font-mono font-semibold">{brl(item.planejado)}</span>
                </Campo>
                <Campo rotulo="Em PPs emitidas">
                  <span className="flex items-center gap-1.5 font-mono font-semibold text-california-red">
                    {brl(comAPP)}
                    <ShieldAlert aria-label="Acima do orçado" className="h-3.5 w-3.5" />
                  </span>
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    com esta PP · já em PPs {brl(item.jaEmPPs)}
                  </span>
                </Campo>
              </div>
            </div>

            <div className="rounded-xl border border-california-red/30 bg-california-red/5 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-california-red">
                Acima do orçado em {brl(excesso)} — motivo de {enviadoPor}
              </p>
              <p className="mt-1 whitespace-pre-line text-[13px] leading-snug text-foreground">{motivo}</p>
            </div>

            {urgente && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <Zap className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
                <div>
                  <p className="text-[13px] font-semibold text-amber-900">Pagamento urgente</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-amber-900/90">
                    {d.urgente_justificativa || "— sem justificativa"}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-xl border border-border p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Valor desta PP</h3>
              <div className="grid grid-cols-[1fr_9rem_9rem] gap-2">
                {(
                  [
                    ["R$ Unit.", brl(d.valor_unitario)],
                    ["QT", num(d.quantidade)],
                    ["D/M", num(d.dias_meses)],
                  ] as const
                ).map(([rotulo, valor]) => (
                  <div key={rotulo}>
                    <p className="mb-1 text-xs font-medium text-foreground">{rotulo}</p>
                    <p className="flex h-11 items-center justify-end rounded-lg border border-border bg-muted/30 px-3 font-mono text-sm font-semibold">
                      {valor}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex items-end justify-between border-t border-border pt-3">
                <p className="font-mono text-[11px] text-muted-foreground">
                  {d.valor_unitario.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ×{" "}
                  {num(d.quantidade)} × {num(d.dias_meses)}
                </p>
                <p className="font-mono text-2xl font-bold">{brl(aEmitir.valor)}</p>
              </div>
            </div>

            <Secao titulo="Fornecedor e pagamento">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border px-4 py-3">
                <Campo rotulo={aEmitir.verba_producao ? "Titular" : "Fornecedor"}>{fornecedor}</Campo>
                <Campo rotulo="Empresa emissora">{empresaEmissora}</Campo>
                <Campo rotulo="Pagamento">{pagamento}</Campo>
                <Campo rotulo="Prazo de pagamento">
                  {dataBr(d.prazo_pagamento)}
                  {parcelas.length > 1 && (
                    <span className="font-normal text-muted-foreground"> · {parcelas.length} parcelas</span>
                  )}
                </Campo>
              </div>
            </Secao>

            <Secao titulo="Serviço">
              <div className="space-y-3 rounded-lg border border-border px-4 py-3">
                <Campo rotulo="Descrição do serviço">{d.servico}</Campo>
                {d.especificacoes && <Campo rotulo="Especificações">{d.especificacoes}</Campo>}
              </div>
            </Secao>

            <Secao titulo={`Anexos${aEmitir.anexos.length ? ` · ${aEmitir.anexos.length}` : ""}`}>
              {aEmitir.anexos.length === 0 ? (
                <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Sem anexos.
                </p>
              ) : (
                <ul className="space-y-2">
                  {aEmitir.anexos.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                      <FileText className="h-5 w-5 flex-none text-california-red/80" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{a.arquivo_nome_original}</span>
                        <span className="block text-[11.5px] text-muted-foreground">
                          {a.documento_tipo === "nota_fiscal" ? "Nota fiscal" : "Outro"}
                          {a.documento_numero ? ` · nº ${a.documento_numero}` : ""} ·{" "}
                          {Math.max(1, Math.round(Number(a.arquivo_tamanho_bytes) / 1024))} KB
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => abrir(a.id, a.arquivo_nome_original)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold hover:border-california-red/40 hover:text-california-red"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Abrir
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </div>
        </DrawerContent>
      </Dialog>
      {vendo && <VerAnexo nome={vendo.nome} url={vendo.url} erro={vendo.erro} onFechar={() => setVendo(null)} />}
    </>
  );
}
