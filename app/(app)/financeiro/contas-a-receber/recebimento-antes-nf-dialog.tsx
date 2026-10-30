"use client";

/**
 * Recebimento antes da NF (decisão 130), pela linha da aba Faturamento.
 *
 * Dois diálogos:
 *
 * - `RecebimentoAntesNfDialog` registra: data, conta que recebeu, valor
 *   (até o saldo a faturar da linha menos o que já foi recebido antes) e o
 *   centro de custo — o mesmo que a baixa do título pediria.
 * - `RecebidosAntesNfDialog` abre pelo selo da linha: lista o que já foi
 *   recebido antes da nota, cada um com o seu cancelamento.
 *
 * Quando a NF da linha sai, o recebido vira a parcela 1 dela, já quitada
 * (o Faturar monta a parcela travada; `emitir_faturamento` confere).
 *
 * No job internacional (decisão 229) o registro é o câmbio fechado: valor
 * na moeda e cotação do dia dão o bruto em R$ (o crédito do banco), com o
 * IOF e a tarifa à parte. A diferença do bruto para o saldo é a variação
 * cambial, e a nota fecha pelo convertido. Uma vez por nota.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, AlertTriangle, HandCoins, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { MoneyInput } from "@/components/ui/money-input";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";

/** Um recebimento antes da NF que ainda espera a nota. */
export interface RecebidoAntesDaNf {
  id: string;
  data: string;
  valor: number;
  contaNome: string;
  /** O tipo do plano de contas, "01 · Receita". */
  centroNome: string;
  subtipoNome: string;
  /** O câmbio fechado do internacional (decisão 229); nulo no recebimento
   *  em reais. */
  cambio: CambioDoRecebido | null;
}

/** O câmbio de um recebimento antes da NF do internacional (decisão 229). */
export interface CambioDoRecebido {
  moeda: string;
  valorMoeda: number;
  cotacao: number;
  iof: number;
  tarifa: number;
  /** Bruto menos o saldo a faturar da nota: + ganho, − perda. */
  variacao: number;
}

/** O que o job internacional traz para o câmbio (decisão 229): a moeda e a
 *  cotação de compra da versão aprovada, que convertem o envio. */
export interface CambioDoJob {
  moeda: string;
  cotacaoDaVersao: number;
}

/** A linha da aba Faturamento em que o recebimento entra. */
export interface AlvoDoRecebidoAntes {
  /** `nota:<id>` ou `bv:<id>` — recomeça o formulário a cada linha. */
  chave: string;
  envioNotaId: string | null;
  itemBvId: string | null;
  /** "TES-1013/26 · Nome do job". */
  titulo: string;
  /** O cliente, ou o fornecedor no BV. */
  contraparte: string;
  ehBv: boolean;
  /** "NF 2/2 · 2 vencimentos" no job; nulo no BV. */
  notaRotulo: string | null;
  /** Saldo a faturar da linha (a nota inteira, ou o BV). */
  saldo: number;
  recebidos: RecebidoAntesDaNf[];
  /** Job internacional: o registro é o câmbio fechado (decisão 229). Nulo
   *  no job nacional e no BV. */
  cambio: CambioDoJob | null;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function somaDosRecebidos(recebidos: RecebidoAntesDaNf[]): number {
  return recebidos.reduce((s, r) => s + Math.round(r.valor * 100), 0) / 100;
}

// ---------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------

export interface RecebidoAntesPayload {
  data: string;
  conta_bancaria_id: string;
  valor: number;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
}

/** O câmbio que o formulário do internacional manda junto (decisão 229);
 *  `valor` do payload é o bruto em R$. */
export interface CambioPayload {
  valor_moeda: number;
  cotacao: number;
  iof: number;
  tarifa: number;
}

/** O IOF do câmbio no banco: 0,38% do crédito (o extrato real do BB). Só a
 *  sugestão do campo, que se edita. */
const IOF_DO_CAMBIO = 0.0038;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** "US$" para USD; o código nas outras moedas. */
function simboloDaMoeda(moeda: string): string {
  return ({ USD: "US$", EUR: "€", GBP: "£" } as Record<string, string>)[moeda] ?? moeda;
}

/** "5,05" ou "5.05" → 5.05; inválido → 0. */
function lerCotacao(t: string): number {
  const limpo = t.trim().replace(/\s/g, "");
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatarCotacao(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export function RecebimentoAntesNfDialog({
  alvo,
  onOpenChange,
  contas,
  tipos,
  subtipos,
  pending,
  erro,
  onConfirm,
}: {
  alvo: AlvoDoRecebidoAntes | null;
  onOpenChange: (open: boolean) => void;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  pending: boolean;
  erro: string | null;
  /** `cambio` vem só do formulário do internacional (decisão 229). */
  onConfirm: (payload: RecebidoAntesPayload, cambio: CambioPayload | null) => void;
}) {
  return (
    <Dialog open={alvo !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-amber-700" />
            Recebimento antes da NF
          </DialogTitle>
        </DialogHeader>
        {alvo && alvo.cambio ? (
          <FormularioDoCambio
            key={alvo.chave}
            alvo={alvo}
            cambio={alvo.cambio}
            contas={contas}
            tipos={tipos}
            subtipos={subtipos}
            pending={pending}
            erro={erro}
            onCancelar={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : alvo ? (
          <FormularioDoRecebido
            key={alvo.chave}
            alvo={alvo}
            contas={contas}
            tipos={tipos}
            subtipos={subtipos}
            pending={pending}
            erro={erro}
            onCancelar={() => onOpenChange(false)}
            onConfirm={(payload) => onConfirm(payload, null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormularioDoRecebido({
  alvo,
  contas,
  tipos,
  subtipos,
  pending,
  erro,
  onCancelar,
  onConfirm,
}: {
  alvo: AlvoDoRecebidoAntes;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  pending: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirm: (payload: RecebidoAntesPayload) => void;
}) {
  const hoje = format(new Date(), "yyyy-MM-dd");
  const [data, setData] = React.useState(hoje);
  const [contaId, setContaId] = React.useState("");
  const [valor, setValor] = React.useState(0);
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);

  const jaRecebido = somaDosRecebidos(alvo.recebidos);
  const limite = Math.max(0, Math.round((alvo.saldo - jaRecebido) * 100) / 100);

  // Toda conta ativa, de qualquer empresa (decisão de 29/08/2026), como na
  // baixa do título.
  const contasAtivas = contas.filter((c) => c.ativo);
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];

  function handleSubmit() {
    setErroLocal(null);
    if (!data || !contaId || valor <= 0) {
      setErroLocal("Informe a data, a conta que recebeu e o valor.");
      return;
    }
    if (valor > limite + 0.004) {
      setErroLocal(
        `O valor passa do saldo a faturar ${alvo.ehBv ? "do BV" : "da nota"} (${formatMoney(limite)}).`,
      );
      return;
    }
    if (!tipoId || !subtipoId) {
      setErroLocal("Selecione o centro de custo do recebimento.");
      return;
    }
    onConfirm({
      data,
      conta_bancaria_id: contaId,
      valor,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
    });
  }

  const mensagemErro = erro ?? erroLocal;

  return (
    <>
      <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
        <span className="text-muted-foreground">{alvo.ehBv ? "BV" : "Job"}</span>
        <span className="font-semibold">{alvo.titulo}</span>
        <span className="text-muted-foreground">{alvo.ehBv ? "Fornecedor" : "Cliente"}</span>
        <span>{alvo.contraparte}</span>
        {alvo.notaRotulo && (
          <>
            <span className="text-muted-foreground">Nota do envio</span>
            <span className="font-mono">{alvo.notaRotulo}</span>
          </>
        )}
        <span className="text-muted-foreground">Saldo a faturar</span>
        <span className="font-mono font-bold">{formatMoney(alvo.saldo)}</span>
        {jaRecebido > 0 && (
          <>
            <span className="text-muted-foreground">Já recebido antes da NF</span>
            <span className="font-mono">{formatMoney(jaRecebido)}</span>
          </>
        )}
      </div>

      {mensagemErro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{mensagemErro}</span>
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Data do recebimento <span className="text-california-red">*</span>
            </label>
            <DatePicker
              name="data_recebimento_antes_nf"
              defaultValue={hoje}
              onDateChange={(d) => {
                setData(d ? format(d, "yyyy-MM-dd") : "");
                setErroLocal(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Conta que recebeu <span className="text-california-red">*</span>
            </label>
            <Select
              value={contaId}
              onValueChange={(v) => {
                setContaId(v);
                setErroLocal(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta..." />
              </SelectTrigger>
              <SelectContent>
                {contasAtivas.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma conta bancária ativa. Cadastre em
                    /financeiro/cadastros/contas-bancarias.
                  </div>
                ) : (
                  contasAtivas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} · {c.banco}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Valor recebido <span className="text-california-red">*</span>
          </label>
          <MoneyInput
            value={valor}
            onValueChange={(v) => {
              setValor(v);
              setErroLocal(null);
            }}
          />
          <p className="text-[11.5px] text-muted-foreground">
            Até {formatMoney(limite)}, o que falta faturar {alvo.ehBv ? "do BV" : "da nota"}
            {jaRecebido > 0 ? " menos o que já foi recebido antes" : ""}.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Centro de custo do recebimento <span className="text-california-red">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Combobox
              items={tiposAtivos.map((t) => ({
                value: t.id,
                label: `${t.codigo} · ${t.nome}`,
              }))}
              value={tipoId || null}
              onChange={(v) => {
                const novo = v ?? "";
                setTipoId(novo);
                // Trocar o tipo invalida o subtipo — o banco recusa o par.
                setSubtipoId((atual) =>
                  subtipos.find((s) => s.id === atual)?.tipo_id === novo ? atual : "",
                );
                setErroLocal(null);
              }}
              placeholder={tiposAtivos.length === 0 ? "Nenhum tipo cadastrado" : "Tipo..."}
              buscaPlaceholder="Escreva o código ou o nome"
              disabled={tiposAtivos.length === 0}
              className={COMBOBOX_COMO_SELECT}
            />
            <Combobox
              items={subtiposDoTipo.map((s) => ({ value: s.id, label: s.nome }))}
              value={subtipoId || null}
              onChange={(v) => {
                setSubtipoId(v ?? "");
                setErroLocal(null);
              }}
              disabled={!tipoId || subtiposDoTipo.length === 0}
              placeholder={
                !tipoId
                  ? "Escolha o tipo primeiro"
                  : subtiposDoTipo.length === 0
                    ? "Nenhum subtipo cadastrado"
                    : "Subtipo..."
              }
              buscaPlaceholder="Escreva o nome do subtipo"
              className={COMBOBOX_COMO_SELECT}
            />
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            O mesmo da baixa do título: define onde a receita entra no DRE.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <HandCoins className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span>
            O dinheiro entra no extrato agora, e {alvo.ehBv ? "o BV" : "a nota"} continua
            na aba Faturamento com o valor recebido marcado na linha. Quando a NF for
            emitida, este valor entra como a{" "}
            <strong className="font-semibold text-foreground">parcela 1, já recebida</strong>,
            com esta data. Nada entra de novo na conta.
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          <HandCoins className="h-4 w-4" />
          {pending ? "Registrando..." : "Registrar recebimento"}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// O câmbio fechado do internacional (decisão 229)
// ---------------------------------------------------------------------------

/**
 * O formulário nasce com o job, para só conferir (pedido do Tiago,
 * 29/10/2026): o que falta receber na moeda, pela cotação de compra da
 * versão, essa cotação e o centro de custo da receita. Com os dois intactos
 * o bruto é o próprio saldo (o envio já é essa conversão) e a variação é
 * zero; trocar a cotação pela do dia dá o bruto que o banco creditou.
 */
function FormularioDoCambio({
  alvo,
  cambio,
  contas,
  tipos,
  subtipos,
  pending,
  erro,
  onCancelar,
  onConfirm,
}: {
  alvo: AlvoDoRecebidoAntes;
  cambio: CambioDoJob;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  pending: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirm: (payload: RecebidoAntesPayload, cambio: CambioPayload) => void;
}) {
  const hoje = format(new Date(), "yyyy-MM-dd");
  const simbolo = simboloDaMoeda(cambio.moeda);
  const resta = r2(alvo.saldo - somaDosRecebidos(alvo.recebidos));
  const moedaInicial = r2(resta / cambio.cotacaoDaVersao);

  // O centro de custo da receita: o tipo 01 e, se ele tiver um subtipo só,
  // esse subtipo.
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const tipoReceita = tiposAtivos.find((t) => t.codigo === "01") ?? null;
  const subtiposDaReceita = tipoReceita
    ? subtipos.filter((x) => x.tipo_id === tipoReceita.id && x.ativo)
    : [];

  const [data, setData] = React.useState(hoje);
  const [contaId, setContaId] = React.useState("");
  const [valorMoeda, setValorMoeda] = React.useState(moedaInicial);
  const [cotacaoTxt, setCotacaoTxt] = React.useState(formatarCotacao(cambio.cotacaoDaVersao));
  // O IOF acompanha o bruto até ser editado à mão.
  const [iofManual, setIofManual] = React.useState<number | null>(null);
  const [tarifa, setTarifa] = React.useState(0);
  const [tipoId, setTipoId] = React.useState(tipoReceita?.id ?? "");
  const [subtipoId, setSubtipoId] = React.useState(
    subtiposDaReceita.length === 1 ? subtiposDaReceita[0].id : "",
  );
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);

  const cotacao = lerCotacao(cotacaoTxt);
  const intacto = valorMoeda === moedaInicial && cotacao === cambio.cotacaoDaVersao;
  const bruto = intacto ? resta : r2(valorMoeda * cotacao);
  const iof = iofManual ?? r2(bruto * IOF_DO_CAMBIO);
  const liquido = r2(bruto - iof - tarifa);
  const variacao = r2(bruto - resta);

  const contasAtivas = contas.filter((c) => c.ativo);
  const subtiposDoTipo = tipoId ? subtipos.filter((x) => x.tipo_id === tipoId && x.ativo) : [];

  function handleSubmit() {
    setErroLocal(null);
    if (!data || !contaId || valorMoeda <= 0 || cotacao <= 0) {
      setErroLocal(`Informe a data, a conta que recebeu, o valor em ${simbolo} e a cotação do dia.`);
      return;
    }
    if (iof + tarifa >= bruto) {
      setErroLocal("O IOF e a tarifa passam do bruto recebido.");
      return;
    }
    if (!tipoId || !subtipoId) {
      setErroLocal("Selecione o centro de custo do recebimento.");
      return;
    }
    onConfirm(
      {
        data,
        conta_bancaria_id: contaId,
        valor: bruto,
        plano_conta_tipo_id: tipoId,
        plano_conta_subtipo_id: subtipoId,
      },
      { valor_moeda: valorMoeda, cotacao, iof, tarifa },
    );
  }

  const mensagemErro = erro ?? erroLocal;

  return (
    <>
      <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
        <span className="text-muted-foreground">Job</span>
        <span className="font-semibold">{alvo.titulo}</span>
        <span className="text-muted-foreground">Cliente</span>
        <span>{alvo.contraparte}</span>
        {alvo.notaRotulo && (
          <>
            <span className="text-muted-foreground">Nota do envio</span>
            <span className="font-mono">{alvo.notaRotulo}</span>
          </>
        )}
        <span className="text-muted-foreground">Saldo a faturar</span>
        <span className="font-mono font-bold">{formatMoney(alvo.saldo)}</span>
      </div>

      {mensagemErro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{mensagemErro}</span>
        </div>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Data do recebimento <span className="text-california-red">*</span>
            </label>
            <DatePicker
              name="data_recebimento_antes_nf"
              defaultValue={hoje}
              onDateChange={(d) => {
                setData(d ? format(d, "yyyy-MM-dd") : "");
                setErroLocal(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Conta que recebeu <span className="text-california-red">*</span>
            </label>
            <Select
              value={contaId}
              onValueChange={(v) => {
                setContaId(v);
                setErroLocal(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta..." />
              </SelectTrigger>
              <SelectContent>
                {contasAtivas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} · {c.banco}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Valor em {simbolo} <span className="text-california-red">*</span>
            </label>
            <MoneyInput
              symbol={simbolo}
              value={valorMoeda}
              onValueChange={(v) => {
                setValorMoeda(v);
                setIofManual(null);
                setErroLocal(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Cotação do dia <span className="text-california-red">*</span>
            </label>
            <Input
              value={cotacaoTxt}
              inputMode="decimal"
              placeholder="0,0000"
              aria-label="Cotação do dia"
              className="font-mono"
              onChange={(e) => {
                setCotacaoTxt(e.target.value);
                setIofManual(null);
                setErroLocal(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">Bruto em R$</label>
            <div className="flex h-11 items-center rounded-lg border border-border bg-muted/50 px-3.5 font-mono text-sm font-semibold">
              {formatMoney(bruto)}
            </div>
          </div>
        </div>
        <p className="-mt-1.5 text-[11.5px] text-muted-foreground">
          Preenchidos com o job, pela cotação da versão: confira com o contrato de câmbio. O bruto é o crédito
          do banco (“ORPAG ORIGEM EXTERIOR”).
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              IOF <span className="text-california-red">*</span>
            </label>
            <MoneyInput value={iof} onValueChange={(v) => setIofManual(v)} />
            <p className="text-[11.5px] text-muted-foreground">0,38% do bruto; edite se o banco cobrou outro valor.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">Tarifa de câmbio</label>
            <MoneyInput value={tarifa} onValueChange={setTarifa} />
            <p className="text-[11.5px] text-muted-foreground">Só se o banco cobrou.</p>
          </div>
        </div>

        {bruto > 0 && (
          <div className="grid grid-cols-[1fr_max-content] gap-x-4 gap-y-1 rounded-xl border border-border bg-muted/50 p-3 text-[13px]">
            <span className="text-muted-foreground">Líquido na conta</span>
            <span className="text-right font-mono font-semibold">{formatMoney(liquido)}</span>
            <span className="text-muted-foreground">Variação cambial do job</span>
            <span
              className={cn(
                "text-right font-mono font-semibold",
                variacao < -0.004 ? "text-california-red" : variacao > 0.004 ? "text-emerald-700" : "",
              )}
            >
              {variacao > 0.004 ? "+" : ""}
              {formatMoney(variacao)}
            </span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Centro de custo do recebimento <span className="text-california-red">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Combobox
              items={tiposAtivos.map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nome}` }))}
              value={tipoId || null}
              onChange={(v) => {
                const novo = v ?? "";
                setTipoId(novo);
                setSubtipoId((atual) => (subtipos.find((x) => x.id === atual)?.tipo_id === novo ? atual : ""));
                setErroLocal(null);
              }}
              placeholder={tiposAtivos.length === 0 ? "Nenhum tipo cadastrado" : "Tipo..."}
              buscaPlaceholder="Escreva o código ou o nome"
              disabled={tiposAtivos.length === 0}
              className={COMBOBOX_COMO_SELECT}
            />
            <Combobox
              items={subtiposDoTipo.map((x) => ({ value: x.id, label: x.nome }))}
              value={subtipoId || null}
              onChange={(v) => {
                setSubtipoId(v ?? "");
                setErroLocal(null);
              }}
              disabled={!tipoId || subtiposDoTipo.length === 0}
              placeholder={
                !tipoId ? "Escolha o tipo primeiro" : subtiposDoTipo.length === 0 ? "Nenhum subtipo cadastrado" : "Subtipo..."
              }
              buscaPlaceholder="Escreva o nome do subtipo"
              className={COMBOBOX_COMO_SELECT}
            />
          </div>
          <p className="text-[11.5px] text-muted-foreground">O mesmo da baixa do título: define onde a receita entra no DRE.</p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <HandCoins className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span>
            Entram no extrato o bruto, o IOF e a tarifa, cada um ligado ao job. A nota sai pelo bruto, como a{" "}
            <strong className="font-semibold text-foreground">parcela 1, já recebida</strong>; a variação cambial
            fecha o envio.
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          <HandCoins className="h-4 w-4" />
          {pending ? "Registrando..." : "Registrar recebimento"}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ver e cancelar
// ---------------------------------------------------------------------------

const MOTIVO_MINIMO = 10;
const MOTIVO_MAXIMO = 500;

export function RecebidosAntesNfDialog({
  alvo,
  onOpenChange,
  pending,
  erro,
  onCancelar,
}: {
  alvo: AlvoDoRecebidoAntes | null;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  erro: string | null;
  onCancelar: (recebido: RecebidoAntesDaNf, motivo: string) => void;
}) {
  return (
    <Dialog open={alvo !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-amber-700" />
            Recebido antes da NF
          </DialogTitle>
        </DialogHeader>
        {alvo && (
          // A lista recomeça quando muda o que ela mostra: depois de um
          // cancelamento, o item que estava em confirmação já não existe.
          <ListaDosRecebidos
            key={`${alvo.chave}|${alvo.recebidos.map((r) => r.id).join(",")}`}
            alvo={alvo}
            pending={pending}
            erro={erro}
            onFechar={() => onOpenChange(false)}
            onCancelar={onCancelar}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListaDosRecebidos({
  alvo,
  pending,
  erro,
  onFechar,
  onCancelar,
}: {
  alvo: AlvoDoRecebidoAntes;
  pending: boolean;
  erro: string | null;
  onFechar: () => void;
  onCancelar: (recebido: RecebidoAntesDaNf, motivo: string) => void;
}) {
  const [cancelando, setCancelando] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const total = somaDosRecebidos(alvo.recebidos);
  const varios = alvo.recebidos.length > 1;

  return (
    <>
      <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
        <span className="text-muted-foreground">{alvo.ehBv ? "BV" : "Job"}</span>
        <span className="font-semibold">{alvo.titulo}</span>
        <span className="text-muted-foreground">{alvo.ehBv ? "Fornecedor" : "Cliente"}</span>
        <span>{alvo.contraparte}</span>
        <span className="text-muted-foreground">Recebido antes da NF</span>
        <span className="font-mono font-bold">{formatMoney(total)}</span>
        <span className="text-muted-foreground">Situação</span>
        <span className="font-semibold text-amber-800">Aguardando a emissão da NF</span>
      </div>

      <div className="max-h-[46vh] space-y-2.5 overflow-y-auto">
        {alvo.recebidos.map((r, i) => {
          const emCancelamento = cancelando === r.id;
          return (
            <div
              key={r.id}
              className={
                emCancelamento
                  ? "rounded-xl border border-california-red/30 bg-california-red/[0.03] p-4"
                  : "rounded-xl border border-amber-200 bg-amber-50/50 p-4"
              }
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                  {varios ? `Recebimento ${i + 1} · ` : ""}Recebido em {formatarData(r.data)}
                </p>
                {cancelando === null && (
                  <button
                    type="button"
                    onClick={() => {
                      setCancelando(r.id);
                      setMotivo("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-california-red transition-colors hover:bg-california-red/5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Cancelar este recebimento
                  </button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]">
                <span className="text-muted-foreground">Entrou na conta</span>
                <span>
                  <b className="font-mono">{formatMoney(r.valor)}</b>{" "}
                  <span className="text-muted-foreground">· {r.contaNome}</span>
                </span>
                <span className="text-muted-foreground">Centro de custo</span>
                <span>
                  {r.centroNome}
                  <span className="text-muted-foreground"> · {r.subtipoNome}</span>
                </span>
                {r.cambio && (
                  <>
                    <span className="text-muted-foreground">Câmbio</span>
                    <span className="font-mono">
                      {simboloDaMoeda(r.cambio.moeda)}{" "}
                      {r.cambio.valorMoeda.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                      × {formatarCotacao(r.cambio.cotacao)}
                    </span>
                    <span className="text-muted-foreground">IOF e tarifa</span>
                    <span className="font-mono">
                      {formatMoney(r.cambio.iof)} · {formatMoney(r.cambio.tarifa)}
                    </span>
                    <span className="text-muted-foreground">Variação cambial</span>
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        r.cambio.variacao < -0.004 ? "text-california-red" : r.cambio.variacao > 0.004 ? "text-emerald-700" : "",
                      )}
                    >
                      {r.cambio.variacao > 0.004 ? "+" : ""}
                      {formatMoney(r.cambio.variacao)}
                    </span>
                  </>
                )}
              </div>

              {emCancelamento && (
                <div className="mt-3 space-y-2 border-t border-california-red/20 pt-3">
                  <p className="flex items-start gap-2 text-[13px]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-california-red" />
                    <span>
                      O recebimento é desfeito: o lançamento de{" "}
                      <b className="font-mono">{formatMoney(r.valor)}</b>
                      {r.cambio ? ", o IOF e a tarifa saem" : " sai"} do extrato,
                      sem linha nova, e o valor sai do selo da linha. Fica no log de
                      auditoria quem cancelou, quando e por quê.
                    </span>
                  </p>
                  <label className="text-xs font-semibold">
                    Motivo do cancelamento <span className="text-california-red">*</span>
                  </label>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    maxLength={MOTIVO_MAXIMO}
                    rows={2}
                    autoFocus
                    className="w-full rounded-lg border border-border bg-white p-2 text-sm"
                    placeholder="Ex.: recebimento lançado na linha errada; conta errada."
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {motivo.trim().length}/{MOTIVO_MAXIMO} caracteres · mínimo{" "}
                      {MOTIVO_MINIMO}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCancelando(null)}
                        disabled={pending}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                      >
                        Voltar
                      </button>
                      <button
                        type="button"
                        onClick={() => onCancelar(r, motivo.trim())}
                        disabled={pending || motivo.trim().length < MOTIVO_MINIMO}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {pending ? "Cancelando..." : "Confirmar cancelamento"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[12.5px] text-muted-foreground text-pretty">
        Quando a NF {alvo.ehBv ? "do BV" : "desta nota"} for emitida,{" "}
        {varios ? "estes valores entram" : "este valor entra"} como a parcela 1, já
        recebida{varios ? " (uma baixa para cada recebimento)" : ", com esta data"}.
      </p>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="flex items-center justify-end border-t border-border pt-4">
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Fechar
        </button>
      </div>
    </>
  );
}
