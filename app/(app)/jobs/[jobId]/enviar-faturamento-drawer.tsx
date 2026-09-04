"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink, Lock, Plus, Send, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/ui/money-input";
import { cn, formatCurrency } from "@/lib/utils";
import {
  cadastrarPortalDoClienteDoJob,
  enviarJobParaFaturamento,
} from "./actions-faturamento";

const SEM_PORTAL = "__sem_portal__";

interface ParcelaEnvio {
  valor: number;
  data_vencimento: string;
}

/** Data ISO local — `toISOString` volta em UTC e erra o dia à noite. */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function somaDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoLocal(new Date(y, m - 1, d + dias));
}

/**
 * Divide o valor em N partes iguais, em centavos, com a sobra na última.
 * A soma volta exata — o servidor confere contra o faturamento previsto.
 */
function dividirEmParcelas(total: number, n: number, primeiraData: string): ParcelaEnvio[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const sobra = cents - base * n;
  return Array.from({ length: n }, (_, i) => ({
    valor: (i === n - 1 ? base + sobra : base) / 100,
    data_vencimento: i === 0 ? primeiraData : somaDiasISO(primeiraData, 30 * i),
  }));
}

export interface PortalOption {
  id: string;
  nome: string;
  url: string;
}

interface Props {
  jobId: string;
  jobCodigo: string;
  /** Faturamento previsto atual — vai travado no formulário. */
  valorFaturado: number;
  /** Quanto desse total é saldo em save (decisão 028). Zero em job sem
   *  save, e aí a leitura nem aparece. */
  valorSave?: number;
  /** Data prevista na abertura do job; o campo nasce com ela. */
  dataPrevistaFaturamento: string | null;
  portais: PortalOption[];
  moeda: string;
}

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Enviar job para faturamento": o que a produção libera ao financeiro.
 *
 * O valor é read-only de propósito — vem do faturamento previsto do job e
 * é relido no servidor. Quem envia informa o que só a produção sabe: PO,
 * vencimento, como o cliente exige que a nota seja descrita e em qual
 * portal dele ela é lançada.
 *
 * O CNAE saiu daqui em 31/08/2026. Era o campo errado na mão errada —
 * classificação fiscal é da nota, e quem emite a nota é o financeiro, que
 * agora o informa no drawer "Faturar". No lugar entrou a descrição da NF,
 * que é justamente o que só o GP sabe: o texto que o cliente exige ver na
 * nota para aceitá-la, e que hoje viajava por fora do sistema.
 */
export function EnviarFaturamentoDrawer({
  jobId,
  jobCodigo,
  valorFaturado,
  valorSave = 0,
  dataPrevistaFaturamento,
  portais,
  moeda,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmar, setConfirmar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [numeroPo, setNumeroPo] = React.useState("");
  const [dataFaturamento, setDataFaturamento] = React.useState(
    dataPrevistaFaturamento ?? hojeIso(),
  );
  const [descricaoNf, setDescricaoNf] = React.useState("");
  const [portalId, setPortalId] = React.useState(SEM_PORTAL);
  const [parcelas, setParcelas] = React.useState<ParcelaEnvio[]>(() => [
    { valor: valorFaturado, data_vencimento: dataPrevistaFaturamento ?? hojeIso() },
  ]);

  // Cadastro do portal sem sair do envio (decisão 050, 04/09/2026). A
  // lista vem do server component, então o portal que acabou de nascer
  // só chegaria nela depois de um refresh — e refresh no meio do
  // preenchimento zera o formulário (048). Enquanto isso ele mora aqui,
  // mesclado à lista e deduplicado por id.
  const [cadastrandoPortal, setCadastrandoPortal] = React.useState(false);
  const [portalNome, setPortalNome] = React.useState("");
  const [portalUrl, setPortalUrl] = React.useState("");
  const [portalErro, setPortalErro] = React.useState<string | null>(null);
  const [portalFieldErrors, setPortalFieldErrors] = React.useState<
    Record<string, string[]>
  >({});
  const [salvandoPortal, startSalvarPortal] = React.useTransition();
  const [portaisNovos, setPortaisNovos] = React.useState<PortalOption[]>([]);
  const portaisVisiveis = React.useMemo(() => {
    const extras = portaisNovos.filter(
      (n) => !portais.some((p) => p.id === n.id),
    );
    if (extras.length === 0) return portais;
    return [...portais, ...extras].sort((a, b) =>
      a.nome.localeCompare(b.nome),
    );
  }, [portais, portaisNovos]);

  // A seleção entra em dois tempos, de propósito: o Select do Radix
  // espelha o valor num <select> nativo escondido, e se o valor e a
  // <option> nova chegam na mesma renderização ele volta pra "" e dispara
  // `onValueChange("")`, apagando a escolha. Primeiro o portal entra na
  // lista; só quando já está lá o efeito seleciona.
  const [portalPendenteId, setPortalPendenteId] = React.useState<
    string | null
  >(null);
  React.useEffect(() => {
    if (!portalPendenteId) return;
    if (portaisVisiveis.some((p) => p.id === portalPendenteId)) {
      setPortalId(portalPendenteId);
      setPortalPendenteId(null);
    }
  }, [portalPendenteId, portaisVisiveis]);

  const portalEscolhido =
    portaisVisiveis.find((p) => p.id === portalId) ?? null;

  function abrirCadastroPortal() {
    setPortalNome("");
    setPortalUrl("");
    setPortalErro(null);
    setPortalFieldErrors({});
    setCadastrandoPortal(true);
  }

  function handleSalvarPortal() {
    setPortalErro(null);
    setPortalFieldErrors({});
    startSalvarPortal(async () => {
      const res = await cadastrarPortalDoClienteDoJob(jobId, {
        nome: portalNome.trim(),
        url: portalUrl.trim(),
      });
      if (!res.ok) {
        setPortalErro(res.message);
        if (res.fieldErrors) setPortalFieldErrors(res.fieldErrors);
        return;
      }
      setPortaisNovos((atuais) => [...atuais, res.portal]);
      setPortalPendenteId(res.portal.id);
      setCadastrandoPortal(false);
    });
  }

  const somaParcelas = parcelas.reduce((s, p) => s + p.valor, 0);
  const somaFecha = Math.abs(somaParcelas - valorFaturado) < 0.01;
  const parcelasCompletas = parcelas.every(
    (p) => p.valor > 0 && p.data_vencimento.length === 10,
  );

  // Com o cadastro do portal aberto o envio espera: ou a pessoa salva o
  // portal e ele entra selecionado, ou cancela — mas não manda o job com
  // um portal pela metade na tela.
  const podeEnviar =
    descricaoNf.trim().length > 0 &&
    dataFaturamento.length === 10 &&
    somaFecha &&
    parcelasCompletas &&
    !cadastrandoPortal;

  /**
   * A data de faturamento é o vencimento da 1ª parcela. Mexer nela
   * arrasta a 1ª — as demais o usuário ajusta na mão, porque o
   * espaçamento entre elas é acordo com o cliente, não regra nossa.
   */
  function handleDataFaturamento(nova: string) {
    setDataFaturamento(nova);
    setParcelas((atuais) =>
      atuais.map((p, i) => (i === 0 ? { ...p, data_vencimento: nova } : p)),
    );
  }

  function handleEnviar() {
    setErro(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await enviarJobParaFaturamento(jobId, {
        numero_po: numeroPo.trim() || null,
        data_faturamento: dataFaturamento,
        descricao_nf: descricaoNf.trim(),
        portal_id: portalId === SEM_PORTAL ? null : portalId,
        parcelas: parcelas.map((p, i) => ({
          ordem: i + 1,
          valor: p.valor,
          data_vencimento: p.data_vencimento,
        })),
      });
      if (!res.ok) {
        setErro(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        setConfirmar(false);
        return;
      }
      setConfirmar(false);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {/* Altura e raio da barra fixa do rodapé, que é onde este botão
          passou a morar em 19/08/2026. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-[10px] bg-california-red px-4 text-[13px] font-semibold text-white transition-colors hover:bg-california-red-hover"
      >
        <Send className="h-4 w-4" />
        Enviar job para faturamento
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DialogHeader className="border-b border-border p-6">
            <DialogTitle>Enviar {jobCodigo} para faturamento</DialogTitle>
            <DialogDescription>
              O job entra na fila de faturamento do financeiro com estas
              informações. O valor vem do faturamento previsto e não é
              editável aqui.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            <div className="space-y-2">
              <Label>Valor a ser faturado</Label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5">
                <span className="font-mono text-base font-bold">
                  {formatCurrency(valorFaturado, moeda)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  <Lock className="h-2.5 w-2.5" />
                  Do faturamento previsto
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Já considera as erratas registradas até agora.
                {valorSave > 0.005 && (
                  <>
                    {" "}
                    Deste total,{" "}
                    <strong className="text-[#5f5d57]">
                      {formatCurrency(valorSave, moeda)}
                    </strong>{" "}
                    é saldo em save: o cliente paga agora e gasta em outro
                    job.
                  </>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="numero-po">Número da PO</Label>
              <Input
                id="numero-po"
                value={numeroPo}
                onChange={(e) => setNumeroPo(e.target.value)}
                maxLength={60}
                placeholder="Opcional — nem todo cliente emite PO"
              />
              {fieldErrors.numero_po?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label>
                Data de faturamento (vencimento){" "}
                <span className="text-california-red">*</span>
              </Label>
              <DatePicker
                name="data_faturamento"
                defaultValue={dataFaturamento}
                onDateChange={(d) => handleDataFaturamento(d ? isoLocal(d) : "")}
              />
              <p className="text-xs text-muted-foreground">
                Nasce da data prevista na abertura do job. Ajuste se o
                acordo com o cliente for outro.
              </p>
              {fieldErrors.data_faturamento?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>

            {/* Parcelamento do faturamento — cada parcela vira uma linha
                da aba Faturamento, com o seu próprio vencimento. */}
            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-[11px] uppercase tracking-wider">
                  Em quantas notas este job será faturado
                </Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() =>
                        setParcelas(
                          dividirEmParcelas(
                            valorFaturado,
                            n,
                            dataFaturamento || hojeIso(),
                          ),
                        )
                      }
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                        parcelas.length === n
                          ? "border-california-red bg-california-red/10 text-california-red"
                          : "border-border bg-white text-muted-foreground hover:border-california-red/40 hover:text-foreground",
                      )}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {parcelas.map((p, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[28px_1fr_1fr_36px] items-center gap-2"
                  >
                    <span className="text-center font-mono text-xs text-muted-foreground">
                      {i + 1}/{parcelas.length}
                    </span>
                    <MoneyInput
                      value={p.valor}
                      onValueChange={(v) =>
                        setParcelas((atuais) =>
                          atuais.map((x, j) => (j === i ? { ...x, valor: v } : x)),
                        )
                      }
                    />
                    <DatePicker
                      name={`venc-parcela-${i}`}
                      defaultValue={p.data_vencimento}
                      onDateChange={(d) =>
                        setParcelas((atuais) =>
                          atuais.map((x, j) =>
                            j === i
                              ? { ...x, data_vencimento: d ? isoLocal(d) : "" }
                              : x,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      disabled={parcelas.length === 1}
                      onClick={() =>
                        setParcelas((atuais) => atuais.filter((_, j) => j !== i))
                      }
                      aria-label="Remover parcela"
                      className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-border/60 pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setParcelas((atuais) => [
                      ...atuais,
                      {
                        valor: 0,
                        data_vencimento: somaDiasISO(
                          atuais[atuais.length - 1]?.data_vencimento ??
                            dataFaturamento ??
                            hojeIso(),
                          30,
                        ),
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-white px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-california-red/40 hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> Nova parcela
                </button>
                <p
                  className={cn(
                    "text-xs font-medium",
                    somaFecha ? "text-emerald-700" : "text-california-red",
                  )}
                >
                  Soma {formatCurrency(somaParcelas, moeda)} /{" "}
                  {formatCurrency(valorFaturado, moeda)}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                Cada parcela vira uma linha em Contas a Receber e é faturada
                em nota própria. Deixe 1× se o job for faturado de uma vez.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="descricao-nf">
                Descrição a constar na nota fiscal{" "}
                <span className="text-california-red">*</span>
              </Label>
              <Textarea
                id="descricao-nf"
                rows={3}
                value={descricaoNf}
                onChange={(e) => setDescricaoNf(e.target.value)}
                maxLength={2000}
                placeholder="Ex.: Serviços de produção audiovisual referentes à campanha X, conforme PO 4500123456."
              />
              <p className="text-xs text-muted-foreground">
                É este texto que o financeiro vai copiar para a nota. Escreva
                como o cliente exige ver — se a nota voltar por descrição
                errada, o recebimento atrasa.
              </p>
              {fieldErrors.descricao_nf?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="portal">Portal de fornecedor do cliente</Label>
              {portaisVisiveis.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3.5 py-3">
                  <p className="text-xs text-muted-foreground">
                    Este cliente não tem portal cadastrado. Se a nota
                    precisar ser lançada em um, cadastre aqui mesmo.
                  </p>
                  {!cadastrandoPortal && (
                    <button
                      type="button"
                      onClick={abrirCadastroPortal}
                      disabled={pending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:border-california-red hover:text-california-red disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" />
                      Cadastrar portal
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Select value={portalId} onValueChange={setPortalId}>
                      <SelectTrigger id="portal">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_PORTAL}>
                          Sem portal
                        </SelectItem>
                        {portaisVisiveis.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Cadastrar outro portal sem sair do envio — o mesmo
                      "+" do fornecedor na PP (decisão 048). */}
                  <button
                    type="button"
                    onClick={abrirCadastroPortal}
                    disabled={pending || cadastrandoPortal}
                    title="Cadastrar portal"
                    aria-label="Cadastrar portal"
                    className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:border-california-red/40 hover:bg-california-red/[0.06] disabled:opacity-50"
                  >
                    <Plus className="h-[17px] w-[17px]" />
                  </button>
                </div>
              )}

              {cadastrandoPortal && (
                <div className="space-y-3 rounded-xl border border-california-red/30 bg-california-red/[0.03] p-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider">
                      Novo portal deste cliente
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Fica no cadastro do cliente e vale para os próximos
                      jobs dele. Ao salvar, já entra selecionado aqui.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="portal-nome">
                      Nome <span className="text-california-red">*</span>
                    </Label>
                    <Input
                      id="portal-nome"
                      value={portalNome}
                      onChange={(e) => setPortalNome(e.target.value)}
                      maxLength={80}
                      autoFocus
                      placeholder="Ex.: Coupa, Ariba, Portal NF"
                    />
                    {portalFieldErrors.nome?.map((m, i) => (
                      <p key={i} className="text-xs text-california-red">
                        {m}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="portal-url">
                      Link <span className="text-california-red">*</span>
                    </Label>
                    <Input
                      id="portal-url"
                      value={portalUrl}
                      onChange={(e) => setPortalUrl(e.target.value)}
                      maxLength={500}
                      placeholder="https://..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (!salvandoPortal) handleSalvarPortal();
                        }
                      }}
                    />
                    {portalFieldErrors.url?.map((m, i) => (
                      <p key={i} className="text-xs text-california-red">
                        {m}
                      </p>
                    ))}
                  </div>
                  {portalErro && (
                    <p className="rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                      {portalErro}
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCadastrandoPortal(false)}
                      disabled={salvandoPortal}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSalvarPortal}
                      disabled={
                        salvandoPortal ||
                        portalNome.trim().length === 0 ||
                        portalUrl.trim().length === 0
                      }
                      className="rounded-lg bg-california-red px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {salvandoPortal ? "Salvando..." : "Salvar e selecionar"}
                    </button>
                  </div>
                </div>
              )}

              {portalEscolhido && (
                <a
                  href={portalEscolhido.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-california-red hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {portalEscolhido.url}
                </a>
              )}
            </div>

            {erro && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => setConfirmar(true)}
              disabled={!podeEnviar || pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Enviar
            </button>
          </div>
        </DrawerContent>
      </Dialog>

      <ConfirmDialog
        open={confirmar}
        onOpenChange={(o) => !o && setConfirmar(false)}
        title={`Enviar ${jobCodigo} para faturamento?`}
        description={
          <>
            O job entra na fila de faturamento do financeiro no valor de{" "}
            <strong>{formatCurrency(valorFaturado, moeda)}</strong>
            {parcelas.length > 1 ? (
              <>
                , em <strong>{parcelas.length} parcelas</strong>, a primeira
                vencendo em{" "}
              </>
            ) : (
              <>, com vencimento em </>
            )}
            <strong>
              {dataFaturamento.split("-").reverse().join("/")}
            </strong>
            . Depois disso o job fica pronto para ser encerrado.
          </>
        }
        confirmLabel="Sim, enviar"
        pending={pending}
        onConfirm={handleEnviar}
      />
    </>
  );
}
