"use client";

/**
 * Decisão 236 (03/11/2026): o custo pago pelo sócio na tela do job.
 *
 * Nos jobs da Ventura (empresa com sócio em `empresas_socio_de_custos`), o
 * painel "Destrinchar realizado" lança custo de duas formas: a PP, que a
 * California paga e vai ao financeiro, e o custo que a Robotech pagou, que
 * só entra no realizado do item. Este arquivo tem o que a planilha, a calha
 * e o painel compartilham:
 *
 * - o contexto com o sócio do job e os custos dele — a página o monta uma
 *   vez, e a planilha, a calha e o painel o leem sem passar prop por cinco
 *   camadas. Fora do provedor (e em job sem sócio) o contexto é vazio e
 *   nada muda na tela;
 * - o drawer de registro, do mesmo tamanho e jeito do "Novo Pedido de
 *   Produção", com o mesmo resumo do item no topo e só os campos do custo.
 */

import * as React from "react";
import { AlertTriangle, Bot, FilePlus, Loader2, Paperclip, ShieldAlert, X } from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MoedaInput } from "@/components/ui/moeda-input";
import { DatePicker } from "@/components/ui/date-picker";
import { NUMEROS_PLANILHA } from "@/app/(app)/_planilha/blocos";
import { acimaDoOrcado } from "@/lib/calculos/limites-orcamento";
import { passaDoPlanejado } from "@/lib/calculos/pps-item";
import { createClient } from "@/lib/supabase/client";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  type CustoDoSocio,
} from "@/lib/types";
import { prefixoComprovanteDoSocio, type DadosDoCustoDoSocio } from "./actions-custo-do-socio";

// ---------------------------------------------------------------------------
// O contexto
// ---------------------------------------------------------------------------

export interface CustosDoSocioDoJob {
  /** O sócio que paga custos neste job ("Robotech"); null fora da Ventura. */
  socio: string | null;
  custos: CustoDoSocio[];
  /** Job aberto: o custo do sócio não tem "a emitir" (decisão 236). */
  jobAberto: boolean;
}

const VAZIO: CustosDoSocioDoJob = { socio: null, custos: [], jobAberto: false };

const Contexto = React.createContext<CustosDoSocioDoJob>(VAZIO);

export function CustosDoSocioProvider({
  value,
  children,
}: {
  value: CustosDoSocioDoJob;
  children: React.ReactNode;
}) {
  return <Contexto.Provider value={value}>{children}</Contexto.Provider>;
}

export function useCustosDoSocio(): CustosDoSocioDoJob {
  return React.useContext(Contexto);
}

/** Os custos do sócio de uma linha de realizado. */
export function useCustosDoSocioDoItem(itemRealizadoId: string | null | undefined): CustoDoSocio[] {
  const { custos } = useCustosDoSocio();
  return React.useMemo(
    () => (itemRealizadoId ? custos.filter((c) => c.item_realizado_id === itemRealizadoId) : []),
    [custos, itemRealizadoId],
  );
}

// ---------------------------------------------------------------------------
// O drawer de registro
// ---------------------------------------------------------------------------

const BUCKET = "pedidos-compra";

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fator = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const unitario = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numeroLocal = (bruto: string) => Number(bruto.replace(/\./g, "").replace(",", ".")) || 0;
const nomeSeguro = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);

/** "Hoje" é de Brasília (o ERP inteiro conta assim). */
function hojeEmBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function FormCustoDoSocio({
  socio,
  itemNome,
  itemRealizadoId,
  moeda,
  editando,
  sugestao,
  valorOrcado,
  valorPlanejado,
  realizadoSemEste,
  linhaVermelha,
  onCancelar,
  onSalvar,
}: {
  socio: string;
  itemNome: string;
  itemRealizadoId: string;
  moeda: string;
  editando: CustoDoSocio | null;
  /** O trio do planejado, para o custo novo já nascer com ele. */
  sugestao: { valorUnitario: number; quantidade: number; diasMeses: number };
  valorOrcado: number;
  valorPlanejado: number;
  /** PPs + custos do sócio do item, sem o custo que está sendo editado. */
  realizadoSemEste: number;
  linhaVermelha: boolean;
  onCancelar: () => void;
  /** Grava; devolve a mensagem de erro, ou null quando deu certo. */
  onSalvar: (dados: DadosDoCustoDoSocio) => Promise<string | null>;
}) {
  const [descricao, setDescricao] = React.useState(editando?.descricao ?? "");
  const [fornecedor, setFornecedor] = React.useState(editando?.fornecedor_nome ?? "");
  const [centavos, setCentavos] = React.useState(
    String(Math.round((editando?.valor_unitario ?? sugestao.valorUnitario) * 100)),
  );
  const [qt, setQt] = React.useState(fator(editando?.quantidade ?? sugestao.quantidade));
  const [dm, setDm] = React.useState(fator(editando?.dias_meses ?? sugestao.diasMeses));
  const [data, setData] = React.useState(editando?.data_gasto ?? hojeEmBrasilia());
  const [comprovante, setComprovante] = React.useState<{ path: string; nome: string } | null>(
    editando?.comprovante_path && editando.comprovante_nome
      ? { path: editando.comprovante_path, nome: editando.comprovante_nome }
      : null,
  );
  /** O arquivo que subiu nesta abertura: sai do bucket se ninguém salvar. */
  const subidoAgora = React.useRef<string | null>(null);
  const [subindo, setSubindo] = React.useState(false);
  const [observacao, setObservacao] = React.useState(editando?.observacao ?? "");
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const arquivo = React.useRef<HTMLInputElement>(null);

  const unit = Number(centavos || "0") / 100;
  const q = numeroLocal(qt);
  const d = numeroLocal(dm);
  const total = Math.round(unit * q * d * 100) / 100;
  const realizadoCom = Math.round((realizadoSemEste + total) * 100) / 100;
  const passaPlanejado = passaDoPlanejado(realizadoCom, valorPlanejado);
  const passaOrcado = !linhaVermelha && acimaDoOrcado(realizadoCom, valorOrcado);

  function descartarUpload() {
    const path = subidoAgora.current;
    subidoAgora.current = null;
    if (path) void createClient().storage.from(BUCKET).remove([path]);
  }

  function cancelar() {
    if (salvando) return;
    descartarUpload();
    onCancelar();
  }

  async function anexar(file: File | undefined) {
    if (!file) return;
    setErro(null);
    if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as (typeof PP_ANEXO_MIMETYPES_ACEITOS)[number])) {
      setErro("O comprovante precisa ser PDF, JPG, PNG ou WEBP.");
      return;
    }
    if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
      setErro("O comprovante passa de 8 MB.");
      return;
    }
    setSubindo(true);
    const pre = await prefixoComprovanteDoSocio(itemRealizadoId);
    if (!pre.ok) {
      setSubindo(false);
      setErro(pre.message);
      return;
    }
    const path = `${pre.prefixo}${crypto.randomUUID()}-${nomeSeguro(file.name)}`;
    const { error } = await createClient()
      .storage.from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    setSubindo(false);
    if (error) {
      setErro(`O comprovante não subiu: ${error.message}`);
      return;
    }
    descartarUpload();
    subidoAgora.current = path;
    setComprovante({ path, nome: file.name.slice(0, 200) });
  }

  function tirarComprovante() {
    if (comprovante && comprovante.path === subidoAgora.current) descartarUpload();
    setComprovante(null);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    // O submit do drawer não pode subir até o formulário de fora.
    e.stopPropagation();
    setErro(null);
    if (!descricao.trim()) return setErro("Descreva o custo.");
    if (total <= 0) return setErro("Preencha R$ Unit., QT e D/M: o total não pode ser zero.");
    if (!data) return setErro("Informe a data do gasto.");
    if (subindo) return setErro("Espere o comprovante terminar de subir.");
    setSalvando(true);
    const falha = await onSalvar({
      descricao: descricao.trim(),
      fornecedor_nome: fornecedor.trim() || null,
      valor_unitario: unit,
      quantidade: q,
      dias_meses: d,
      data_gasto: data,
      comprovante_path: comprovante?.path ?? null,
      comprovante_nome: comprovante?.nome ?? null,
      observacao: observacao.trim() || null,
    });
    setSalvando(false);
    if (falha) {
      setErro(falha);
      return;
    }
    // Salvo: o arquivo agora é do custo.
    subidoAgora.current = null;
  }

  const titulo = editando ? `Editar custo ${socio}` : `Registrar custo ${socio}`;

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && cancelar()}>
      <DrawerContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        <form onSubmit={salvar} className="flex min-h-0 flex-col flex-1 overflow-hidden" aria-busy={salvando}>
          <div className="flex-1 space-y-4 p-6 overflow-y-auto">
            {/* O mesmo resumo do "Novo Pedido de Produção". */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Item</p>
              <p className="font-medium">{itemNome}</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Orçado do item</p>
                  <p className="font-mono font-semibold">{formatCurrency(valorOrcado, moeda)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Planejado do item</p>
                  <p
                    className={cn(
                      "font-mono font-semibold",
                      acimaDoOrcado(valorPlanejado, valorOrcado) && NUMEROS_PLANILHA.excedente,
                    )}
                  >
                    {formatCurrency(valorPlanejado, moeda)}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {unitario(sugestao.valorUnitario)} × {fator(sugestao.quantidade)} × {fator(sugestao.diasMeses)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Realizado do item</p>
                  <p
                    className={cn(
                      "flex items-center gap-1.5 font-mono font-semibold",
                      (passaPlanejado || passaOrcado) && "text-california-red",
                    )}
                  >
                    {formatCurrency(realizadoCom, moeda)}
                    {passaOrcado ? (
                      <span title="Acima do orçado">
                        <ShieldAlert aria-label="Acima do orçado" className="h-3.5 w-3.5 text-california-red" />
                      </span>
                    ) : passaPlanejado ? (
                      <span title="Acima do planejado">
                        <AlertTriangle aria-label="Acima do planejado" className="h-3.5 w-3.5 text-amber-700" />
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">PPs + {socio}, com este custo</p>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-[12px] leading-snug text-muted-foreground">
              <Bot className="mt-0.5 h-3.5 w-3.5 flex-none text-california-red" />
              <span>
                Custo pago pela <b className="font-semibold text-foreground">{socio}</b>. Entra no realizado do item,
                mas não gera PP e não vai ao financeiro.
              </span>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Custo</h3>
              <div>
                <label htmlFor="socio-descricao" className="text-xs font-medium">
                  Descrição do custo *
                </label>
                <Input
                  id="socio-descricao"
                  value={descricao}
                  maxLength={300}
                  autoFocus
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: Locação de 2 robôs de demonstração"
                />
              </div>
              <div>
                <label htmlFor="socio-fornecedor" className="text-xs font-medium">
                  Quem a {socio} pagou <span className="font-normal text-muted-foreground">(opcional)</span>
                </label>
                <Input
                  id="socio-fornecedor"
                  value={fornecedor}
                  maxLength={200}
                  onChange={(e) => setFornecedor(e.target.value)}
                  placeholder="Fornecedor ou prestador, se houver"
                />
              </div>
              <div>
                <label htmlFor="socio-data" className="text-xs font-medium">
                  Data do gasto *
                </label>
                <DatePicker
                  id="socio-data"
                  name="socio-data"
                  value={data}
                  onDateChange={(dt) => setData(dt ? isoLocal(dt) : "")}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Valor deste custo
                </h4>
                <span className="text-[11px] text-muted-foreground">mesmas colunas do item na planilha</span>
              </div>
              <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] gap-2.5">
                <div>
                  <label htmlFor="socio-unit" className="text-xs font-medium">
                    R$ Unit. *
                  </label>
                  <MoedaInput
                    id="socio-unit"
                    className="text-right font-mono font-semibold"
                    defaultValue={(Number(centavos) / 100).toFixed(2)}
                    onCentavosChange={setCentavos}
                  />
                </div>
                <div>
                  <label htmlFor="socio-qt" className="text-xs font-medium">
                    QT *
                  </label>
                  <Input
                    id="socio-qt"
                    inputMode="decimal"
                    className="no-spinner text-right font-mono font-semibold"
                    value={qt}
                    onChange={(e) => setQt(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="socio-dm" className="text-xs font-medium">
                    D/M *
                  </label>
                  <Input
                    id="socio-dm"
                    inputMode="decimal"
                    className="no-spinner text-right font-mono font-semibold"
                    value={dm}
                    onChange={(e) => setDm(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-end justify-between gap-4 border-t border-border pt-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Valor deste custo</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {total > 0 ? `${unitario(unit)} × ${fator(q)} × ${fator(d)}` : "preencha os três campos"}
                  </p>
                </div>
                <span className="font-mono text-[22px] font-bold leading-none">
                  {total > 0 ? formatCurrency(total, moeda) : "—"}
                </span>
              </div>
              {(passaOrcado || passaPlanejado) && (
                <div
                  role="status"
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2.5",
                    passaOrcado
                      ? "border-california-red/30 bg-california-red/5 text-california-red"
                      : "border-amber-300/70 bg-amber-50 text-amber-900",
                  )}
                >
                  {passaOrcado ? (
                    <ShieldAlert className="h-3.5 w-3.5 flex-none" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 flex-none text-amber-700" />
                  )}
                  <span className="text-[11px] font-semibold leading-relaxed">
                    {passaOrcado
                      ? "O acumulado deste item ultrapassa o orçado"
                      : "O acumulado está acima do planejado"}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Comprovante e observação
              </h3>
              <input
                ref={arquivo}
                type="file"
                className="hidden"
                accept={PP_ANEXO_MIMETYPES_ACEITOS.join(",")}
                onChange={(e) => {
                  void anexar(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {comprovante ? (
                <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-[12.5px]">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{comprovante.nome}</span>
                  <button
                    type="button"
                    onClick={tirarComprovante}
                    aria-label="Tirar o comprovante"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => arquivo.current?.click()}
                  disabled={subindo}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {subindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus className="h-3.5 w-3.5" />}
                  {subindo ? "Subindo o comprovante…" : "Anexar nota ou recibo (opcional)"}
                </button>
              )}
              <div>
                <label htmlFor="socio-obs" className="text-xs font-medium">
                  Observação <span className="font-normal text-muted-foreground">(opcional)</span>
                </label>
                <Textarea
                  id="socio-obs"
                  rows={2}
                  maxLength={1000}
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
            {erro && <p className="text-right text-[12px] font-semibold text-california-red">{erro}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelar}
                disabled={salvando}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={salvando || subindo}
                className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
              >
                {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Registrar custo"}
              </button>
            </div>
            <p className="text-right text-[11px] leading-snug text-muted-foreground">
              Fica no realizado do item. Não gera PP nem título no financeiro.
            </p>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
