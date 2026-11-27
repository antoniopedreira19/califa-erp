"use client";
// A tela do pedido de desembolso (decisão 264, versão C "sem documento"):
// tela cheia, como a da PP, com o comprovante ao lado da coluna Dados
// larga. O financeiro decide no rodapé (rejeitar, seguir para a aprovação,
// reverter a aprovação); quem pediu abre a mesma tela em leitura, com o
// "Corrigir" do rejeitado e o "Cancelar pedido" enquanto o financeiro não
// decidiu.
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, Ban, CheckCircle, CheckCircle2, ChevronLeft, ChevronRight, Lock, Paperclip, Undo2, X } from "lucide-react";
import { Dialog, FullscreenContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { PainelDocumento, VazioDoPainel, VisualizadorDeArquivo } from "@/components/documentos/painel-documento";
import { cn } from "@/lib/utils";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import { buscarNotasDoFornecedor, type NotaExistente } from "@/app/(app)/jobs/[jobId]/realizado/actions-notas-da-pp";
import type { TomadorDaNf } from "@/app/(app)/jobs/[jobId]/realizado/anexos-da-pp";
import { chaveDoNumeroDaNf } from "@/lib/fiscal/nf-da-pp";
import { ReverterAprovacaoDialog } from "@/app/(app)/financeiro/contas-a-pagar/reverter-aprovacao-dialog";
import { ROTULO_DO_STATUS, type PedidoDeDesembolso } from "./tipos";
import { cancelarDesembolso, rejeitarDesembolso } from "./actions";
import { Caixa, Grupo, NavegacaoDosAnexos, brl, dataBr, dataHoraBr, diaHoraCurto } from "./comum";
import { useEnderecoDoAnexo } from "./visualizar-anexos";
import { AprovarDesembolsoDialog } from "./aprovar-dialog";
import type { ModoDoForm } from "./formulario";

const ROTULO_DO_TIPO: Record<string, string> = {
  nota_fiscal: "NF",
  cupom_fiscal: "Cupom fiscal",
  recibo: "Recibo",
  fatura: "Fatura",
  apolice: "Apólice",
  boleto: "Boleto",
  guia: "Guia",
  contrato: "Contrato",
  orcamento: "Orçamento",
  outro: "Outro",
};
const rotuloDoTipo = (t: string | null) => (t ? ROTULO_DO_TIPO[t] ?? t : "Sem tipo");

export function TelaDoDesembolso({
  pedido: d,
  open,
  onOpenChange,
  financeiro,
  tomadores,
  cartoes = [],
  onAbrirForm,
}: {
  pedido: PedidoDeDesembolso | null;
  open: boolean;
  onOpenChange: (x: boolean) => void;
  /** Na aba do Contas a Pagar: as decisões do financeiro no rodapé. */
  financeiro: boolean;
  tomadores: TomadorDaNf[];
  cartoes?: CartaoOption[];
  /** Quem pediu: Corrigir o rejeitado, ou anexar o comprovante que faltou. */
  onAbrirForm?: (modo: ModoDoForm, d: PedidoDeDesembolso) => void;
}) {
  const router = useRouter();
  const [anexoAtivo, setAnexoAtivo] = React.useState(0);
  const [expandido, setExpandido] = React.useState(false);
  const [dossieAberto, setDossieAberto] = React.useState(true);
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [askRejeitar, setAskRejeitar] = React.useState(false);
  const [askCancelar, setAskCancelar] = React.useState(false);
  const [askReverter, setAskReverter] = React.useState(false);
  const [aprovar, setAprovar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setAnexoAtivo(0);
    setExpandido(false);
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, d?.id]);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const anexo = d?.anexos[anexoAtivo] ?? null;
  const { url, carregando, erro: erroDoAnexo } = useEnderecoDoAnexo(
    anexo ? { id: anexo.id, nome: anexo.nome, imagem: anexo.mime.startsWith("image/"), salvo: true } : null,
    open,
  );

  if (!d) return null;
  const emAvaliacao = d.status === "em_avaliacao";
  const semComprovante = d.anexos.length === 0;

  function rejeitar() {
    if (!d) return;
    startTransition(async () => {
      const r = await rejeitarDesembolso({ desembolso_id: d.id, motivo: motivo.trim() });
      if (!r.ok) return setErro(r.message);
      setAskRejeitar(false);
      setMotivo("");
      setToast(`${d.codigo} rejeitado. ${d.criador.nome} vai ver o motivo.`);
      router.refresh();
    });
  }
  function cancelar() {
    if (!d) return;
    startTransition(async () => {
      const r = await cancelarDesembolso({ desembolso_id: d.id, motivo: motivo.trim() });
      if (!r.ok) return setErro(r.message);
      setAskCancelar(false);
      setMotivo("");
      setToast(`${d.codigo} cancelado.`);
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <FullscreenContent className="bg-[#181818]/[0.82] p-5" aria-describedby="des-tela-descricao">
          <div className="flex flex-none flex-wrap items-center gap-3 pb-3">
            <DialogTitle asChild>
              <span className="font-mono text-[15px] font-bold text-white">{d.codigo}</span>
            </DialogTitle>
            <Badge className="border-white/25 bg-white/10 text-white">{ROTULO_DO_STATUS[d.status]}</Badge>
            {d.reembolso && <Badge className="border-sky-300/50 bg-sky-400/15 uppercase tracking-wider text-sky-100">Reembolso</Badge>}
            <DialogDescription asChild>
              <span id="des-tela-descricao" className="text-xs text-white/60">
                Comprovante e dados — lado a lado
              </span>
            </DialogDescription>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
            >
              <X className="h-3 w-3" />
              Fechar
            </button>
          </div>
          {erro && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-california-red/50 bg-california-red/15 p-3 text-sm text-white">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{erro}</span>
              <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div
            className={cn(
              "grid min-h-0 flex-1 gap-3",
              expandido ? "grid-cols-1" : dossieAberto ? "grid-cols-[minmax(0,1fr)_540px]" : "grid-cols-[minmax(0,1fr)_34px]",
            )}
          >
            <PainelDocumento
              icone={<Paperclip className="h-4 w-4 text-violet-700" />}
              titulo={d.anexos.length > 1 ? "Comprovantes" : "Comprovante"}
              legenda={anexo?.nome ?? "Nenhum comprovante enviado"}
              oculto={false}
              url={url}
              nomeArquivo={anexo?.nome ?? ""}
              expandido={expandido}
              onExpandir={() => setExpandido((a) => !a)}
              onErro={setErro}
              extra={
                <NavegacaoDosAnexos total={d.anexos.length} ativo={anexoAtivo} onAtivo={setAnexoAtivo} nomes={d.anexos.map((a) => a.nome)} />
              }
            >
              {!anexo ? (
                <VazioDoPainel texto="Sem comprovante. O pedido foi enviado antes de o comprovante ser obrigatório." />
              ) : url ? (
                <VisualizadorDeArquivo key={anexo.id} url={url} nome={anexo.nome} imagem={anexo.mime.startsWith("image/")} />
              ) : (
                <VazioDoPainel texto={carregando ? "Carregando o anexo..." : erroDoAnexo ?? "Anexo indisponível."} />
              )}
            </PainelDocumento>
            {!expandido &&
              (dossieAberto ? (
                <div className="relative flex min-h-0 flex-col">
                  <button
                    type="button"
                    onClick={() => setDossieAberto(false)}
                    title="Recolher os dados"
                    aria-label="Recolher os dados"
                    className="absolute -left-3 top-3 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-white text-muted-foreground shadow transition-colors hover:text-california-red"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <Dossie d={d} financeiro={financeiro} tomadores={tomadores} onVer={setAnexoAtivo} aberto={open} />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDossieAberto(true)}
                  title="Mostrar os dados do desembolso"
                  className="flex min-h-0 flex-col items-center gap-3 rounded-2xl bg-white py-3 text-muted-foreground transition-colors hover:text-california-red"
                >
                  <ChevronLeft className="h-4 w-4 flex-none" />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ writingMode: "vertical-rl" }}>
                    Dados do desembolso
                  </span>
                </button>
              ))}
          </div>

          {/* Rodapé do financeiro: as decisões, como na PP. */}
          {financeiro && emAvaliacao && (
            <div className="flex flex-none flex-wrap items-center gap-2.5 pt-3">
              <span className="mr-auto text-xs text-white/70">
                Data de pagamento pedida por {d.criador.nome}:{" "}
                <strong className="font-semibold text-white">{dataBr(d.parcelas[0]?.vencimento)}</strong>
              </span>
              <button
                type="button"
                onClick={() => setAskRejeitar(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3.5 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red/5"
              >
                <Ban className="h-3.5 w-3.5" />
                {semComprovante ? "Rejeitar para anexar" : "Rejeitar"}
              </button>
              {semComprovante ? (
                <span className="rounded-lg border border-white/20 px-3.5 py-2 text-xs font-semibold text-white/80">
                  Sem comprovante: não se aprova
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setAprovar(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Seguir para a aprovação
                </button>
              )}
            </div>
          )}
          {financeiro && d.status === "aprovada" && (
            <div className="flex flex-none flex-wrap items-center gap-2.5 pt-3">
              <span className="mr-auto text-xs text-white/70">
                Aprovado — já é título a pagar. Antes da baixa, o financeiro pode reverter.
              </span>
              <button
                type="button"
                onClick={() => setAskReverter(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3.5 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red/5"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Reverter aprovação
              </button>
            </div>
          )}
          {/* Rodapé de quem pediu: o que ele pode fazer com o próprio pedido. */}
          {!financeiro && (d.status === "rejeitada" || d.status === "em_avaliacao") && (
            <div className="flex flex-none flex-wrap items-center gap-2.5 pt-3">
              <span className="mr-auto text-xs text-white/70">
                {d.status === "rejeitada"
                  ? "Rejeitado pelo financeiro. Corrija e reenvie com o mesmo código."
                  : semComprovante
                    ? "Sem comprovante: o financeiro não aprova até você anexar."
                    : "Com o financeiro. Você pode cancelar enquanto ele não decide."}
              </span>
              <button
                type="button"
                onClick={() => setAskCancelar(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
              >
                Cancelar pedido
              </button>
              {(d.status === "rejeitada" || semComprovante) && onAbrirForm && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onAbrirForm(d.status === "rejeitada" ? "corrigir" : "anexar", d);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red/90"
                >
                  {d.status === "rejeitada" ? "Corrigir" : "Anexar comprovante"}
                </button>
              )}
            </div>
          )}
          {toast && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-elevated">
              <CheckCircle className="h-4 w-4" />
              {toast}
            </div>
          )}
        </FullscreenContent>
      </Dialog>

      {financeiro && (
        <AprovarDesembolsoDialog
          open={aprovar}
          onOpenChange={setAprovar}
          d={d}
          cartoes={cartoes}
          onAprovado={(msg) => {
            setAprovar(false);
            setToast(msg);
            router.refresh();
          }}
        />
      )}
      {financeiro && (
        <ReverterAprovacaoDialog
          origem="desembolso"
          id={d.id}
          descricao={`${d.codigo} — ${d.descricao}`}
          valor={d.valor}
          open={askReverter}
          onOpenChange={setAskReverter}
          aoReverter={() => setToast(`${d.codigo}: aprovação revertida.`)}
        />
      )}
      <ConfirmDialog
        contentClassName="z-[60]"
        overlayClassName="z-[60]"
        open={askRejeitar}
        onOpenChange={(o) => {
          setAskRejeitar(o);
          if (!o) setMotivo("");
        }}
        title={`Rejeitar ${d.codigo}?`}
        description={
          <div className="space-y-2">
            <p>{d.criador.nome} vê o motivo em Desembolsos, corrige e reenvia com o mesmo código.</p>
            <div>
              <label htmlFor="des-tela-motivo" className="text-xs font-medium">
                Motivo * (mín. 10 caracteres)
              </label>
              <textarea
                id="des-tela-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded border border-border p-2 text-sm"
                placeholder={
                  semComprovante
                    ? "Ex.: anexe a NF ou o cupom fiscal da compra."
                    : "Ex.: a NF está no CNPJ de outra empresa. Peça a nota no CNPJ certo."
                }
              />
            </div>
          </div>
        }
        confirmLabel={pending ? "Rejeitando..." : "Rejeitar"}
        variant="destructive"
        confirmDisabled={motivo.trim().length < 10 || pending}
        confirmDisabledReason={motivo.trim().length < 10 ? "Escreva o motivo (mín. 10 caracteres) para liberar a rejeição." : undefined}
        onConfirm={rejeitar}
      />
      <ConfirmDialog
        contentClassName="z-[60]"
        overlayClassName="z-[60]"
        open={askCancelar}
        onOpenChange={(o) => {
          setAskCancelar(o);
          if (!o) setMotivo("");
        }}
        title={`Cancelar ${d.codigo}?`}
        description={
          <div className="space-y-2">
            <p>O pedido sai do financeiro e fica como cancelado na sua lista.</p>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={500}
              aria-label="Motivo do cancelamento"
              className="w-full rounded border border-border p-2 text-sm"
              placeholder="Motivo (mín. 10 caracteres)"
            />
          </div>
        }
        confirmLabel={pending ? "Cancelando..." : "Cancelar pedido"}
        cancelLabel="Voltar"
        variant="destructive"
        confirmDisabled={motivo.trim().length < 10 || pending}
        confirmDisabledReason={motivo.trim().length < 10 ? "Escreva o motivo (mín. 10 caracteres)." : undefined}
        onConfirm={cancelar}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// A coluna Dados (o dossiê da PP), larga e com os grupos em pares
// ---------------------------------------------------------------------------
function Dossie({
  d,
  financeiro,
  tomadores,
  onVer,
  aberto,
}: {
  d: PedidoDeDesembolso;
  financeiro: boolean;
  tomadores: TomadorDaNf[];
  onVer: (i: number) => void;
  aberto: boolean;
}) {
  const nfs = d.reembolso ? [] : d.anexos.filter((a) => a.tipo === "nota_fiscal");
  // O saldo de cada nota no cadastro único: onde mais ela está (PPs e outros pedidos).
  const [notas, setNotas] = React.useState<Record<string, NotaExistente>>({});
  const chaves = nfs.map((a) => a.numero ?? "").join("|");
  React.useEffect(() => {
    if (!aberto || !d.fornecedor || nfs.length === 0) {
      setNotas({});
      return;
    }
    let vivo = true;
    buscarNotasDoFornecedor(
      d.fornecedor.id,
      nfs.map((a) => a.numero ?? "").filter(Boolean),
      d.id,
    ).then((r) => {
      if (vivo && r.ok) setNotas(Object.fromEntries(r.notas.map((x) => [x.numero_chave, x])));
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, d.id, d.fornecedor?.id, d.status, chaves]);
  const cnpj = (id: string | null) => (id ? tomadores.find((e) => e.id === id)?.cnpj ?? "—" : "—");
  const eventos = eventosDo(d);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white">
      <div className="flex flex-none items-center gap-1 border-b border-border px-2 pt-2">
        <span className="inline-flex items-center gap-1.5 rounded-t-lg bg-california-red/10 px-3 py-1.5 text-xs font-bold text-california-red">Dados</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5">
        {d.urgente && (
          <div className="rounded-xl border border-california-red/30 bg-california-red/[0.06] px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-california-red">
              <AlertTriangle className="h-3.5 w-3.5 flex-none" />
              Pagamento urgente
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-snug">“{d.justificativaUrgente}”</p>
          </div>
        )}
        <Estados d={d} financeiro={financeiro} />
        <Grupo rotulo="O que é">
          <p className="text-[13px] font-semibold leading-snug">{d.descricao}</p>
        </Grupo>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3.5">
          <Grupo rotulo={d.reembolso ? "Reembolso a quem pediu" : "Fornecedor"}>
            <p className="text-[13px] font-semibold leading-snug">{d.reembolso ? d.criador.nome : d.fornecedor?.nome ?? "—"}</p>
            {!d.reembolso && d.fornecedor && (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                <span className="font-mono">{d.fornecedor.documento ?? "—"}</span>
                {d.fornecedor.regime ? ` · ${d.fornecedor.regime}` : ""}
              </p>
            )}
            {d.reembolso && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">Na conta do cadastro no RH</p>}
          </Grupo>
          <Grupo rotulo="Pedido por">
            <p className="text-[12.5px] font-semibold">{d.criador.nome}</p>
            <p className="text-[11px] text-muted-foreground">
              {d.reenviadoEm ? "Reenviado" : "Enviado"} em {dataHoraBr(d.enviadoEm)}
            </p>
          </Grupo>
          <Grupo rotulo="Empresa e rateio">
            <p className="text-[12.5px] font-semibold leading-snug">{d.empresa.nome}</p>
            <ul className="mt-1 space-y-0.5">
              {d.regionais.map((r) => (
                <li key={r.id} className="flex justify-between text-[11.5px]">
                  <span>
                    {r.nome} <span className="text-muted-foreground">{r.pct.toLocaleString("pt-BR")}%</span>
                  </span>
                  <span className="font-mono">{brl((d.valor * r.pct) / 100)}</span>
                </li>
              ))}
            </ul>
          </Grupo>
          <Grupo rotulo={d.parcelas.length > 1 ? `Valor · ${d.parcelas.length} parcelas` : "Valor e pagamento"}>
            <p className="font-mono text-[15px] font-bold">{brl(d.valor)}</p>
            <ul className="mt-1 space-y-0.5">
              {d.parcelas.map((p) => (
                <li key={p.id} className="flex justify-between text-[11.5px]">
                  <span className="text-muted-foreground">
                    {p.numero}/{d.parcelas.length} · {dataBr(p.dataPagamento ?? p.vencimento)}
                    {p.dataPagamento && p.dataPagamento !== p.vencimento ? (
                      <span className="text-amber-700"> (pedido {dataBr(p.vencimento)})</span>
                    ) : null}
                    {p.pagoEm ? <span className="font-semibold text-emerald-700"> · pago</span> : null}
                  </span>
                  <span className="font-mono">{brl(p.valor)}</span>
                </li>
              ))}
            </ul>
          </Grupo>
        </div>
        <Grupo rotulo={`Comprovantes (${d.anexos.length})`}>
          {d.anexos.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-california-red">
              <AlertTriangle className="h-3.5 w-3.5" /> Nenhum comprovante anexado.
            </p>
          ) : (
            <ul className="space-y-1">
              {d.anexos.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2 text-[11.5px]">
                  <span className="rounded border border-border px-1.5 py-px text-[10px] font-semibold">{rotuloDoTipo(c.tipo)}</span>
                  <span className="min-w-0 flex-1 truncate" title={c.nome}>
                    {c.numero ? <span className="font-mono">{c.numero} · </span> : null}
                    {c.nome}
                  </span>
                  {d.reembolso && c.valorDoDoc != null && (
                    <span className="flex-none font-mono text-muted-foreground">
                      {dataBr(c.emissao)} · {brl(c.valorDoDoc)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onVer(i)}
                    className="flex-none font-semibold text-california-red underline-offset-2 hover:underline"
                  >
                    Ver
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Grupo>
        {nfs.map((c) => {
          const chave = chaveDoNumeroDaNf(c.numero ?? "");
          const nota = chave ? notas[chave] : undefined;
          const usos = nota?.pps ?? [];
          const parte = c.parte ?? c.valorDoDoc ?? 0;
          const valorDaNota = nota?.valor ?? c.valorDoDoc ?? 0;
          const sobra = Math.round((valorDaNota - usos.reduce((t, u) => t + (u.valor_na_pp ?? 0), 0)) * 100) / 100;
          const difere = c.valorDoDoc != null && Math.abs(c.valorDoDoc - d.valor) > 0.004;
          return (
            <div key={c.id}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nota fiscal do fornecedor</p>
              <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[11.5px]">
                <dt className="text-muted-foreground">Número</dt>
                <dd className="font-mono">{c.numero || "—"}</dd>
                <dt className="text-muted-foreground">Data de emissão</dt>
                <dd>{dataBr(c.emissao)}</dd>
                <dt className="text-muted-foreground">Valor da NF</dt>
                <dd className="font-mono">{c.valorDoDoc != null ? brl(c.valorDoDoc) : "—"}</dd>
                <dt className="text-muted-foreground">CNPJ tomador</dt>
                <dd className="font-mono">{cnpj(c.tomadorId)}</dd>
                {c.parte != null && (
                  <>
                    <dt className="text-muted-foreground">Neste pedido</dt>
                    <dd className="font-mono">{brl(c.parte)}</dd>
                  </>
                )}
              </dl>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                {nota?.registrada
                  ? "Registrada no controle de notas (Central Financeira › Notas Fiscais › Tomadas)."
                  : financeiro
                    ? "No cadastro de notas desde o envio. Confira com a nota ao lado: na aprovação, ela é registrada no controle de notas."
                    : "No cadastro de notas desde o envio. O financeiro confere na aprovação."}
              </p>
              {usos.length > 0 && (
                <div className="mt-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[11px] leading-snug">
                  <p className="font-semibold">Saldo da nota (cadastro de notas)</p>
                  {usos.map((u) => (
                    <p key={u.id} className="flex justify-between text-muted-foreground">
                      <span>
                        Em <span className="font-mono">{u.codigo}</span>
                      </span>
                      <span className="font-mono">{brl(u.valor_na_pp ?? 0)}</span>
                    </p>
                  ))}
                  <p className="flex justify-between">
                    <span>Neste pedido</span>
                    <span className="font-mono">{brl(parte)}</span>
                  </p>
                  <p className="flex justify-between border-t border-border pt-1 font-semibold text-emerald-700">
                    <span>Sobrava</span>
                    <span className="font-mono">{brl(Math.max(0, sobra))}</span>
                  </p>
                </div>
              )}
              {difere && c.parte == null && (
                <p className="mt-1 text-[11px] font-semibold leading-snug text-amber-800">
                  A NF é de {brl(c.valorDoDoc!)}; o pedido, de {brl(d.valor)}.
                </p>
              )}
            </div>
          );
        })}
        <div className="border-t border-border pt-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Histórico</p>
          <ul className="space-y-1.5">
            {eventos.map((e, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-snug">
                <span className="flex-none font-mono text-muted-foreground">{diaHoraCurto(e.em)}</span>
                <span className="min-w-0">
                  <span className="font-semibold">{e.rotulo}</span>
                  {e.por ? <span className="text-muted-foreground"> · {e.por}</span> : null}
                  {e.motivo ? <span className="mt-0.5 block break-words text-muted-foreground">“{e.motivo}”</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** O histórico pelo que o pedido guarda: criado, rejeitado, reenviado, aprovado, cancelado, pago. */
function eventosDo(d: PedidoDeDesembolso) {
  const ev: Array<{ em: string; rotulo: string; por: string | null; motivo?: string | null }> = [
    { em: d.criadoEm, rotulo: "Enviado ao financeiro", por: d.criador.nome },
  ];
  if (d.rejeitado) ev.push({ em: d.rejeitado.em, rotulo: "Rejeitado", por: d.rejeitado.por, motivo: d.rejeitado.motivo });
  if (d.reenviadoEm) ev.push({ em: d.reenviadoEm, rotulo: "Corrigido e reenviado", por: d.criador.nome });
  if (d.aprovado) ev.push({ em: d.aprovado.em, rotulo: "Aprovado", por: d.aprovado.por });
  if (d.cancelado) ev.push({ em: d.cancelado.em, rotulo: "Cancelado", por: d.cancelado.por, motivo: d.cancelado.motivo });
  if (d.pagoEm) ev.push({ em: d.pagoEm, rotulo: "Pago", por: null });
  for (const c of d.nfCorrigida) ev.push({ em: c.em, rotulo: "NF corrigida no controle de notas", por: c.por, motivo: c.motivo });
  return ev.sort((a, b) => a.em.localeCompare(b.em));
}

function Estados({ d, financeiro }: { d: PedidoDeDesembolso; financeiro: boolean }) {
  if (d.status === "rejeitada" && d.rejeitado)
    return (
      <Caixa tom="vermelho" titulo="Rejeitado">
        <p>
          {d.rejeitado.por ? (
            <>
              Por <span className="font-medium">{d.rejeitado.por}</span> em {dataHoraBr(d.rejeitado.em)}
            </>
          ) : (
            <>Em {dataHoraBr(d.rejeitado.em)}</>
          )}
        </p>
        <p className="mt-1.5">
          <span className="font-medium">Motivo: </span>
          {d.rejeitado.motivo}
        </p>
        <p className="mt-1.5 text-muted-foreground">
          {financeiro ? `Aguardando ${d.criador.nome} corrigir e reenviar.` : "Corrija e reenvie pelo botão do rodapé."}
        </p>
      </Caixa>
    );
  if (d.status === "cancelada" && d.cancelado)
    return (
      <Caixa tom="vermelho" titulo="Cancelado">
        <p>
          {d.cancelado.por ? <>Por <span className="font-medium">{d.cancelado.por}</span> em </> : "Em "}
          {dataHoraBr(d.cancelado.em)}
        </p>
        <p className="mt-1.5">
          <span className="font-medium">Motivo: </span>
          {d.cancelado.motivo}
        </p>
      </Caixa>
    );
  if (d.status === "pago")
    return (
      <Caixa tom="verde" titulo="Pago">
        <p>Última parcela baixada em {dataBr(d.pagoEm)}.</p>
      </Caixa>
    );
  if (d.status === "aprovada")
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
        <Lock className="h-3.5 w-3.5 flex-none" />
        <span>
          Aprovado{d.aprovado?.por ? ` por ${d.aprovado.por}` : ""} em {dataBr(d.aprovado?.em)} — já é título a pagar.
        </span>
      </div>
    );
  if (d.status === "em_avaliacao" && d.anexos.length === 0)
    return (
      <Caixa tom="ambar" titulo="Sem comprovante">
        <p>
          Enviado antes de o comprovante ser obrigatório. {financeiro ? "Rejeite para quem pediu anexar." : "Anexe pelo botão do rodapé."}
        </p>
      </Caixa>
    );
  return null;
}
