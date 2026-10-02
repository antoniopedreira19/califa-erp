"use client";

/**
 * Diálogos de edição do cadastro de impostos (módulo fiscal, 02/10/2026).
 * "Editar alíquotas" segue o desenho do protótipo aprovado; os demais usam
 * o mesmo molde (rótulo pequeno, Nota explicando o efeito, Cancelar/Salvar).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, CalendarDays, Percent, Plus, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { MaskedInput } from "@/components/ui/masked-input";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { dataBr } from "@/lib/fiscal/datas";
import { formatarCnpj } from "@/lib/fiscal/cadastro";
import type { FiscalCnae, FiscalEstabelecimento, FiscalFeriado, FiscalParametro, RegraDeVencimentoFiscal } from "@/lib/types";
import {
  aliquotasPisCofins,
  formatarCodigoCnae,
  percentualParaCampo,
  lerPercentual,
  primeiroDiaDoMesSeguinte,
} from "@/lib/validations/fiscal-cadastro";
import {
  atualizarEstabelecimento,
  criarCnae,
  criarFeriado,
  novaVigenciaCnae,
  novaVigenciaParametros,
  removerFeriado,
} from "./actions";
import { ultimaVersao, type ParametroNaTela } from "./montagem";

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------

export function Nota({ children, tom = "cinza" }: { children: React.ReactNode; tom?: "cinza" | "ambar" | "azul" }) {
  const cls = {
    cinza: "border-border bg-muted/40 text-muted-foreground",
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    azul: "border-sky-200 bg-sky-50 text-sky-900",
  }[tom];
  return <div className={cn("rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed", cls)}>{children}</div>;
}

function Rotulo({ htmlFor, children, obrigatorio }: { htmlFor?: string; children: React.ReactNode; obrigatorio?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-semibold">
      {children}
      {obrigatorio && <span className="text-california-red"> *</span>}
    </label>
  );
}

function Erro({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-california-red/30 bg-california-red/[0.05] px-3.5 py-2.5 text-[12.5px] text-california-red">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{mensagem}</span>
    </div>
  );
}

function Rodape({ pendente, onCancelar, rotulo = "Salvar" }: { pendente: boolean; onCancelar: () => void; rotulo?: string }) {
  return (
    <div className="flex justify-end gap-2 border-t border-border pt-4">
      <button
        type="button"
        onClick={onCancelar}
        disabled={pendente}
        className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={pendente}
        className="rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
      >
        {pendente ? "Salvando..." : rotulo}
      </button>
    </div>
  );
}

/** Data ISO de um Date do calendário (dia local, sem fuso). */
function isoDoDia(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Diálogo com envio por Server Action: fecha e recarrega a página no sucesso. */
function useEnvio(onClose: () => void) {
  const router = useRouter();
  const [emTransicao, startTransition] = React.useTransition();
  // Trava própria: o botão fica desligado do clique até a resposta chegar,
  // mesmo onde a transição não acompanha o `await`.
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  function enviar(acao: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    startTransition(async () => {
      try {
        const res = await acao();
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        onClose();
        router.refresh();
      } catch {
        setErro("Não foi possível salvar. Tente de novo.");
      } finally {
        setEnviando(false);
      }
    });
  }
  return { pendente: emTransicao || enviando, erro, setErro, enviar };
}

// ---------------------------------------------------------------------------
// CNPJ emissor
// ---------------------------------------------------------------------------

const REGRAS: Array<{ valor: RegraDeVencimentoFiscal; rotulo: string }> = [
  { valor: "prorroga", rotulo: "Prorroga para o dia útil seguinte" },
  { valor: "antecipa", rotulo: "Antecipa para o dia útil anterior" },
  { valor: "ultimo_util", rotulo: "Último dia útil do mês" },
];

export function EstabelecimentoDialog({
  estab,
  razaoSocial,
  onClose,
}: {
  estab: FiscalEstabelecimento;
  razaoSocial: string;
  onClose: () => void;
}) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  const [digitos, setDigitos] = React.useState(estab.cnpj ?? "");
  const [ativo, setAtivo] = React.useState(estab.ativo);
  const [regra, setRegra] = React.useState<RegraDeVencimentoFiscal>(estab.iss_regra);
  const [observacao, setObservacao] = React.useState(estab.observacao ?? "");
  const cnpjCompleto = digitos.length === 14;

  function aoDigitar(d: string) {
    setDigitos(d);
    if (!estab.cnpj && d.length === 14 && digitos.length !== 14) {
      // Informar o CNPJ de quem ainda não tinha já marca "Ativo" (dá para desmarcar)
      // e tira o aviso da carga inicial de que o CNPJ faltava — à vista, antes de salvar.
      setAtivo(true);
      if (observacao === (estab.observacao ?? "") && /^CNPJ da filial a informar/.test(observacao)) setObservacao("");
    }
    if (d.length !== 14) setAtivo(false);
  }

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const fd = new FormData(ev.currentTarget);
    enviar(() =>
      atualizarEstabelecimento({
        id: estab.id,
        cnpj: digitos,
        ativo: ativo && cnpjCompleto,
        iss_dia: fd.get("iss_dia")?.toString() ?? "",
        iss_retido_dia: fd.get("iss_retido_dia")?.toString() ?? "",
        iss_regra: regra,
        observacao,
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-california-red" />
            {estab.nome}
          </DialogTitle>
          <DialogDescription>
            {razaoSocial} · {estab.municipio}-{estab.uf} · {estab.papel === "matriz" ? "Matriz" : "Filial"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-cnpj">CNPJ</Rotulo>
              <MaskedInput id="fiscal-cnpj" mask="cnpj" defaultValue={estab.cnpj ?? ""} onDigitsChange={aoDigitar} autoFocus={!estab.cnpj} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold">Situação</span>
              <label
                className={cn(
                  "flex h-11 items-center gap-2.5 rounded-lg border border-border bg-white px-3.5 text-sm",
                  !cnpjCompleto && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-california-red"
                  checked={ativo && cnpjCompleto}
                  disabled={!cnpjCompleto}
                  onChange={(ev) => setAtivo(ev.target.checked)}
                />
                Ativo: aparece no Faturar e na aprovação da PP
              </label>
            </div>
          </div>
          {!cnpjCompleto && (
            <p className="-mt-2 text-[11.5px] text-muted-foreground">Sem o CNPJ completo, o estabelecimento fica inativo.</p>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-iss-dia" obrigatorio>
                Dia do ISS
              </Rotulo>
              <Input id="fiscal-iss-dia" name="iss_dia" type="number" min={1} max={31} required defaultValue={estab.iss_dia} />
            </div>
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-iss-retido-dia" obrigatorio>
                Dia do ISS retido
              </Rotulo>
              <Input id="fiscal-iss-retido-dia" name="iss_retido_dia" type="number" min={1} max={31} required defaultValue={estab.iss_retido_dia} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold">Dia não útil</span>
              <Select value={regra} onValueChange={(v) => setRegra(v as RegraDeVencimentoFiscal)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGRAS.map((r) => (
                    <SelectItem key={r.valor} value={r.valor}>
                      {r.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Rotulo htmlFor="fiscal-obs">Observação</Rotulo>
            <Textarea
              id="fiscal-obs"
              name="observacao"
              rows={2}
              maxLength={500}
              value={observacao}
              onChange={(ev) => setObservacao(ev.target.value)}
            />
          </div>
          <Nota>
            O ISS vence no dia informado do mês seguinte à emissão da nota (o retido, à emissão da NF do fornecedor). A observação aparece na aba
            Vencimentos.
          </Nota>
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CNAE: Editar alíquotas (com vigência) e Novo CNAE
// ---------------------------------------------------------------------------

/** Os três campos de alíquota: ISS editável; PIS e COFINS seguem a opção de crédito. */
function CamposDeAliquota({
  iss,
  setIss,
  pis,
  cofins,
}: {
  iss: string;
  setIss: (v: string) => void;
  pis: number;
  cofins: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="space-y-1">
        <Rotulo htmlFor="fiscal-iss">ISS (%)</Rotulo>
        <Input id="fiscal-iss" inputMode="decimal" value={iss} onChange={(ev) => setIss(ev.target.value)} placeholder="—" />
      </div>
      <div className="space-y-1">
        <Rotulo htmlFor="fiscal-pis">PIS (%)</Rotulo>
        <Input id="fiscal-pis" value={percentualParaCampo(pis)} readOnly tabIndex={-1} className="bg-muted/40" />
      </div>
      <div className="space-y-1">
        <Rotulo htmlFor="fiscal-cofins">COFINS (%)</Rotulo>
        <Input id="fiscal-cofins" value={percentualParaCampo(cofins)} readOnly tabIndex={-1} className="bg-muted/40" />
      </div>
    </div>
  );
}

function SelectDeCredito({
  valor,
  onChange,
  presumido,
}: {
  valor: "sim" | "nao";
  onChange: (v: "sim" | "nao") => void;
  presumido: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold">Crédito de PIS/COFINS</span>
      <Select value={valor} onValueChange={(v) => onChange(v as "sim" | "nao")} disabled={presumido}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="sim">Dá crédito sobre os custos</SelectItem>
          <SelectItem value="nao">Sem crédito (alíquota reduzida)</SelectItem>
        </SelectContent>
      </Select>
      {presumido && <p className="text-[11px] text-muted-foreground">Lucro Presumido: sempre cumulativo.</p>}
    </div>
  );
}

export function EditarCnaeDialog({
  cnae,
  estab,
  presumido,
  hoje,
  onClose,
}: {
  cnae: FiscalCnae;
  estab: FiscalEstabelecimento;
  presumido: boolean;
  hoje: string;
  onClose: () => void;
}) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  const [iss, setIss] = React.useState(percentualParaCampo(cnae.aliquota_iss));
  const [credito, setCredito] = React.useState<"sim" | "nao">(presumido || cnae.cumulativo ? "nao" : "sim");
  const sugestao = primeiroDiaDoMesSeguinte(hoje > cnae.vigencia_inicio ? hoje : cnae.vigencia_inicio);
  const [vigencia, setVigencia] = React.useState<string>(sugestao);
  const cumulativo = credito === "nao";
  const { aliquota_pis, aliquota_cofins } = aliquotasPisCofins(cumulativo, cnae);

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    enviar(() => novaVigenciaCnae({ cnae_id: cnae.id, vigencia_inicio: vigencia, aliquota_iss: iss, cumulativo }));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-california-red" />
            {cnae.codigo}
            {cnae.subitem && ` · ${cnae.subitem}`}
          </DialogTitle>
          <DialogDescription>
            {estab.nome} · {cnae.descricao}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <CamposDeAliquota iss={iss} setIss={setIss} pis={aliquota_pis} cofins={aliquota_cofins} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo obrigatorio>Vale a partir de</Rotulo>
              <DatePicker
                name="vigencia_inicio"
                defaultValue={sugestao}
                onDateChange={(d) => setVigencia(d ? isoDoDia(d) : "")}
                dateDisabled={(d) => isoDoDia(d) <= cnae.vigencia_inicio}
              />
            </div>
            <SelectDeCredito valor={credito} onChange={setCredito} presumido={presumido} />
          </div>
          <Nota>
            A alíquota nova vale para as notas emitidas a partir da data. A linha atual (desde {dataBr(cnae.vigencia_inicio)}) fica no histórico,
            com a vigência fechada no dia anterior.
          </Nota>
          {vigencia !== "" && vigencia < hoje && (
            <Nota tom="ambar">
              A data é anterior a hoje: a alíquota nova vale também para as notas emitidas de {dataBr(vigencia)} até hoje.
            </Nota>
          )}
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NovoCnaeDialog({
  estab,
  presumido,
  hoje,
  onClose,
}: {
  estab: FiscalEstabelecimento;
  presumido: boolean;
  hoje: string;
  onClose: () => void;
}) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  const [codigo, setCodigo] = React.useState("");
  const [iss, setIss] = React.useState("");
  const [credito, setCredito] = React.useState<"sim" | "nao">(presumido ? "nao" : "sim");
  const [vigencia, setVigencia] = React.useState<string>(hoje);
  const cumulativo = credito === "nao";
  const { aliquota_pis, aliquota_cofins } = aliquotasPisCofins(cumulativo);

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const fd = new FormData(ev.currentTarget);
    enviar(() =>
      criarCnae({
        estabelecimento_id: estab.id,
        codigo,
        subitem: fd.get("subitem")?.toString() ?? "",
        descricao: fd.get("descricao")?.toString() ?? "",
        aliquota_iss: iss,
        cumulativo,
        vigencia_inicio: vigencia,
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-california-red" />
            Novo CNAE
          </DialogTitle>
          <DialogDescription>
            {estab.nome}
            {estab.cnpj ? ` · ${formatarCnpj(estab.cnpj)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-cnae-codigo" obrigatorio>
                Código do CNAE
              </Rotulo>
              <Input
                id="fiscal-cnae-codigo"
                value={codigo}
                onChange={(ev) => setCodigo(formatarCodigoCnae(ev.target.value))}
                inputMode="numeric"
                placeholder="00.00-0-00"
                className="font-mono"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-cnae-subitem">Subitem da LC 116 (opcional)</Rotulo>
              <Input id="fiscal-cnae-subitem" name="subitem" placeholder="12.08" maxLength={5} className="font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <Rotulo htmlFor="fiscal-cnae-descricao" obrigatorio>
              Descrição
            </Rotulo>
            <Input id="fiscal-cnae-descricao" name="descricao" maxLength={300} required placeholder="Atividade, como no cartão do CNPJ" />
          </div>
          <CamposDeAliquota iss={iss} setIss={setIss} pis={aliquota_pis} cofins={aliquota_cofins} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo obrigatorio>Vale a partir de</Rotulo>
              <DatePicker name="vigencia_inicio" defaultValue={hoje} onDateChange={(d) => setVigencia(d ? isoDoDia(d) : "")} />
            </div>
            <SelectDeCredito valor={credito} onChange={setCredito} presumido={presumido} />
          </div>
          <Nota>
            O CNAE entra na lista do Faturar deste CNPJ a partir da data. O subitem só é preciso quando o mesmo CNAE tem alíquotas diferentes por
            item da LC 116 (como o 82.30-0-01 · 12.08 e · 17.10).
          </Nota>
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} rotulo="Cadastrar" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Feriados
// ---------------------------------------------------------------------------

const NACIONAL = "__nacional__";

export function NovoFeriadoDialog({ cidades, onClose }: { cidades: string[]; onClose: () => void }) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  const [data, setData] = React.useState("");
  const [onde, setOnde] = React.useState<string>(NACIONAL);

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const fd = new FormData(ev.currentTarget);
    enviar(() =>
      criarFeriado({
        data,
        nome: fd.get("nome")?.toString() ?? "",
        municipio: onde === NACIONAL ? null : onde,
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-california-red" />
            Novo feriado
          </DialogTitle>
          <DialogDescription>Feriado que muda o vencimento dos impostos.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo obrigatorio>Data</Rotulo>
              <DatePicker name="data" onDateChange={(d) => setData(d ? isoDoDia(d) : "")} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold">Onde vale</span>
              <Select value={onde} onValueChange={setOnde}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NACIONAL}>Nacional (expediente bancário)</SelectItem>
                  {cidades.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Rotulo htmlFor="fiscal-feriado-nome" obrigatorio>
              Nome
            </Rotulo>
            <Input id="fiscal-feriado-nome" name="nome" maxLength={120} required placeholder="Ex.: São João" />
          </div>
          <Nota>Os nacionais valem para todos os vencimentos; os da cidade, para o ISS dos CNPJs dela e para os DARFs da matriz que fica nela.</Nota>
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} rotulo="Cadastrar" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoverFeriadoDialog({ feriado, onClose }: { feriado: FiscalFeriado; onClose: () => void }) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !pendente && onClose()}
      title="Remover feriado?"
      description={
        <>
          {dataBr(feriado.data)} · {feriado.nome} ({feriado.municipio ?? "nacional"}). Os vencimentos deixam de contar este dia como não útil.
          {erro && <span className="mt-2 block font-semibold text-california-red">{erro}</span>}
        </>
      }
      confirmLabel="Remover"
      variant="destructive"
      pending={pendente}
      onConfirm={() => enviar(() => removerFeriado({ id: feriado.id }))}
    />
  );
}

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

export function ParametroDialog({
  item,
  parametros,
  hoje,
  onClose,
}: {
  item: ParametroNaTela;
  parametros: FiscalParametro[];
  hoje: string;
  onClose: () => void;
}) {
  const { pendente, erro, setErro, enviar } = useEnvio(onClose);
  const ultimas = item.linha.campos.map((c) => ultimaVersao(parametros, c.chave));
  const maisRecente = ultimas.reduce((m, u) => (u && u.vigencia_inicio > m ? u.vigencia_inicio : m), "");
  const sugestao = primeiroDiaDoMesSeguinte(hoje > maisRecente ? hoje : maisRecente);
  const [vigencia, setVigencia] = React.useState(sugestao);
  const [valores, setValores] = React.useState<Record<string, string | number>>(() => {
    const v: Record<string, string | number> = {};
    item.linha.campos.forEach((c, i) => {
      const valor = ultimas[i]?.valor ?? 0;
      v[c.chave] = c.formato === "pct" ? percentualParaCampo(valor) : valor;
    });
    return v;
  });

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const lidos: { chave: string; valor: number }[] = [];
    for (const c of item.linha.campos) {
      const bruto = valores[c.chave];
      const n = c.formato === "pct" ? lerPercentual(bruto) : Number(bruto);
      if (n === null || Number.isNaN(n)) {
        setErro(`${c.rotulo}: use só números, como 1,5.`);
        return;
      }
      lidos.push({ chave: c.chave, valor: n });
    }
    enviar(() => novaVigenciaParametros({ vigencia_inicio: vigencia, valores: lidos }));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-california-red" />
            {item.linha.rotulo}
          </DialogTitle>
          <DialogDescription>Hoje: {item.linha.valor(item.hoje)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className={cn("grid gap-3", item.linha.campos.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
            {item.linha.campos.map((c) => (
              <div key={c.chave} className="space-y-1">
                <Rotulo htmlFor={`fiscal-par-${c.chave}`} obrigatorio>
                  {c.rotulo}
                </Rotulo>
                {c.formato === "pct" ? (
                  <Input
                    id={`fiscal-par-${c.chave}`}
                    inputMode="decimal"
                    value={String(valores[c.chave] ?? "")}
                    onChange={(ev) => setValores((v) => ({ ...v, [c.chave]: ev.target.value }))}
                  />
                ) : (
                  <MoneyInput
                    id={`fiscal-par-${c.chave}`}
                    value={Number(valores[c.chave] ?? 0)}
                    onValueChange={(n) => setValores((v) => ({ ...v, [c.chave]: n }))}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo obrigatorio>Vale a partir de</Rotulo>
              <DatePicker
                name="vigencia_inicio"
                defaultValue={sugestao}
                onDateChange={(d) => setVigencia(d ? isoDoDia(d) : "")}
                dateDisabled={(d) => isoDoDia(d) <= maisRecente}
              />
            </div>
          </div>
          <Nota>
            O valor novo vale a partir da data; o atual fica no histórico. As apurações de antes da data continuam com o valor da época.
          </Nota>
          {vigencia !== "" && vigencia < hoje && (
            <Nota tom="ambar">A data é anterior a hoje: o valor novo vale também de {dataBr(vigencia)} até hoje.</Nota>
          )}
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

