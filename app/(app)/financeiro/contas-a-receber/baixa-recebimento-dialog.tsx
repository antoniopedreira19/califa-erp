"use client";

/**
 * Baixa do recebimento (Tela 3.3) — o espelho da baixa de Contas a Pagar.
 *
 * Três obrigatórios, todos do protótipo:
 *
 * 1. **Data do recebimento** — a invariante da tela: título recebido
 *    SEMPRE tem data. Validada aqui, no schema da action e de novo dentro
 *    da RPC, que recusa `null`.
 * 2. **Conta bancária que recebeu** — sem padrão, escolhida a cada baixa
 *    (mesma decisão da 016 §7 do lado do pagamento). A exceção é quem abre
 *    a baixa já sabendo a conta: a aba Títulos da conciliação (pedido do
 *    Tiago em 02/10/2026) manda a conta em tela em `contaInicial`, e ela
 *    vem escolhida — e trocável.
 * 3. **Centro de custo do recebimento** — que é o par Tipo + Subtipo do
 *    plano de contas (decisão 016 §6). Desde a Tela 3.3 é AQUI que a
 *    receita é classificada: o formulário de emissão da NF não pergunta
 *    mais tipo e subtipo.
 *
 * Desde 29/09/2026 (decisão 124) serve também ao recebimento avulso e ao
 * rendimento de aplicação. Quem chama monta o resumo do topo; o
 * recebimento avulso chega com o centro de custo que foi escolhido na
 * criação, e o rendimento chega com a conta de aplicação e o centro de
 * custo travados.
 *
 * Decisão 125 (29/09/2026): o valor sai do quadro do topo e vira o bloco
 * "Valor a dar baixa" (`BlocoValorDaBaixa`), com a baixa parcial e os
 * impostos retidos pelo cliente. O formulário é um filho com `key` do
 * título, para o estado do bloco recomeçar a cada título.
 *
 * Módulo fiscal (entrega 2, 02/10/2026): na nota emitida com CNPJ emissor,
 * o bloco "No fiscal" (`components/financeiro/no-fiscal.tsx`) mostra o
 * efeito da baixa na Apuração — o que o cliente reteve abate qual imposto
 * e em qual período, e o presumido pelo caixa —, refeito pela data, pelo
 * valor e pelos retidos.
 */

import * as React from "react";
import { format } from "date-fns";
import { AlertCircle, ArrowRightLeft, Banknote } from "lucide-react";
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
import type {
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
  RetencaoDaBaixa,
} from "@/lib/types";
import {
  BlocoValorDaBaixa,
  useValorDaBaixa,
  type UltimaRetencao,
} from "@/components/financeiro/valor-da-baixa";
import { NoFiscalDoRecebimento, useFiscalDaNota } from "@/components/financeiro/no-fiscal";

export type EstiloDoResumo = "mono" | "mono_negrito" | "mono_pequeno" | "negrito";

const CLASSE_DO_ESTILO: Record<EstiloDoResumo, string> = {
  mono: "font-mono",
  mono_negrito: "font-mono font-bold",
  mono_pequeno: "font-mono text-xs",
  negrito: "font-semibold",
};

export interface BaixaRecebimentoAlvo {
  /** Identifica o título: o formulário só se reinicia quando ela muda
   *  (o objeto `alvo` é remontado a cada renderização da tela). */
  chave: string;
  /** As linhas do quadro do topo, na ordem. */
  resumo: Array<{ rotulo: string; valor: string; estilo: EstiloDoResumo }>;
  /** O valor do título inteiro. */
  valor: number;
  /** O que falta receber: o valor menos as baixas já feitas (decisão 125).
   *  É o valor a dar baixa que vem proposto. */
  aberto: number;
  /** "Parcela 1/2", embaixo do valor enquanto não há baixa. */
  parcelaRotulo: string;
  /** O fim da frase "Restam R$ X em aberto…". `null` fecha no ponto. */
  restoTexto: string | null;
  /** Rendimento só aceita o valor inteiro, sem retenção. */
  aceitaParcial: boolean;
  aceitaRetencao: boolean;
  /** A última retenção do mesmo cliente, para o "Repetir as alíquotas". */
  ultimaRetencao: UltimaRetencao | null;
  empresaId: string;
  /** Conta que vem escolhida e travada (rendimento: a conta de aplicação
   *  dele). `null` deixa a escolha livre. */
  contaTravadaId: string | null;
  /** Centro de custo que já vem escolhido (o da criação do título).
   *  `null` nos dois começa vazio, como na nota. */
  tipoInicialId: string | null;
  subtipoInicialId: string | null;
  /** O rendimento tem centro de custo fixo: não se troca na baixa. */
  centroTravado: boolean;
  /** Data do recebimento que vem sugerida: hoje, ou a data do lançamento
   *  do rendimento (o último dia do mês dele). */
  dataInicial: string;
  /**
   * Módulo fiscal (entrega 2): a nota fiscal do título (`faturamentos.id`),
   * para o bloco "No fiscal" — o efeito da baixa na Apuração. `null` no
   * recebimento avulso e no rendimento, que não têm nota. Obrigatório no
   * tipo, e não opcional: o `alvo` é montado à mão, e campo opcional some
   * em silêncio (CLAUDE.md).
   */
  notaId: string | null;
}

export interface BaixaRecebimentoPayload {
  pago_em: string;
  conta_bancaria_id: string;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  /** O valor a dar baixa: líquido + retidos. */
  valor_baixa: number;
  retencoes: RetencaoDaBaixa[];
}

export function BaixaRecebimentoDialog({
  open,
  onOpenChange,
  alvo,
  contas,
  tipos,
  subtipos,
  pending,
  erro,
  onConfirm,
  contaInicial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alvo: BaixaRecebimentoAlvo | null;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  pending: boolean;
  erro: string | null;
  onConfirm: (payload: BaixaRecebimentoPayload) => void;
  /**
   * A conta que já vem escolhida (o `id`): a aba Títulos da conciliação
   * manda a conta em tela. A conta travada do rendimento vale antes dela.
   * Sem ela — ou com uma conta que não está entre as ativas de `contas` —,
   * a conta abre em branco, como sempre.
   */
  contaInicial?: string;
}) {
  if (!alvo) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-emerald-700" />
            Dar baixa no recebimento
          </DialogTitle>
        </DialogHeader>
        {/* A chave do título recomeça o formulário (e o bloco de valores)
            a cada título; o objeto `alvo` é remontado a cada renderização
            da tela e não serve de chave. */}
        <FormularioDaBaixa
          key={alvo.chave}
          alvo={alvo}
          contas={contas}
          tipos={tipos}
          subtipos={subtipos}
          pending={pending}
          erro={erro}
          onCancelar={() => onOpenChange(false)}
          onConfirm={onConfirm}
          contaInicial={contaInicial ?? null}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormularioDaBaixa({
  alvo,
  contas,
  tipos,
  subtipos,
  pending,
  erro,
  onCancelar,
  onConfirm,
  contaInicial,
}: {
  alvo: BaixaRecebimentoAlvo;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  pending: boolean;
  erro: string | null;
  onCancelar: () => void;
  onConfirm: (payload: BaixaRecebimentoPayload) => void;
  /** A conta que abre escolhida; `null` abre em branco. */
  contaInicial: string | null;
}) {
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const [pagoEm, setPagoEm] = React.useState(alvo.dataInicial);
  // A conta travada (rendimento) vence; depois, a de quem abriu a baixa já
  // sabendo a conta, se ela for ativa; senão, em branco.
  const [contaId, setContaId] = React.useState(
    () =>
      alvo.contaTravadaId ??
      (contaInicial && contas.some((c) => c.id === contaInicial && c.ativo)
        ? contaInicial
        : ""),
  );
  const [tipoId, setTipoId] = React.useState(alvo.tipoInicialId ?? "");
  const [subtipoId, setSubtipoId] = React.useState(alvo.subtipoInicialId ?? "");
  const v = useValorDaBaixa(alvo.aberto, alvo.ultimaRetencao);
  // Módulo fiscal (entrega 2): a nota do título, para o bloco "No fiscal",
  // lida ao abrir (à parte: o diálogo não espera por ela).
  const fiscal = useFiscalDaNota(alvo.notaId);

  /**
   * Toda conta ativa entra, de qualquer empresa (decisão de 29/08/2026):
   * "as contas em si não são específicas de uma empresa". A empresa é do
   * DOCUMENTO — vem do título e é ela que vai para o lançamento. O banco
   * já era assim desde a migration
   * `20260829100001_a_trava_de_empresa_sai_das_seis_ultimas`; aqui a
   * trava tinha ficado para trás (09/09/2026).
   */
  const contasAtivas = contas.filter((c) => c.ativo);
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];

  function handleTipo(next: string) {
    setTipoId(next);
    // Trocar o tipo invalida o subtipo — o banco recusa o par incoerente.
    setSubtipoId((atual) =>
      subtipos.find((s) => s.id === atual)?.tipo_id === next ? atual : "",
    );
  }

  function handleSubmit() {
    setErroLocal(null);
    if (!pagoEm || !contaId || !tipoId || !subtipoId) {
      setErroLocal(
        "Informe a data do recebimento, a conta bancária que recebeu e o centro de custo.",
      );
      return;
    }
    const erroDoValor = v.erro();
    if (erroDoValor) {
      setErroLocal(erroDoValor);
      return;
    }
    onConfirm({
      pago_em: pagoEm,
      conta_bancaria_id: contaId,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
      valor_baixa: v.valor,
      retencoes: v.retencoes(),
    });
  }

  const mensagemErro = erro ?? erroLocal;
  const baixaParcial = v.parcial && v.resta > 0.004;

  return (
    <>
      <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/50 p-4 text-[13px]">
        {alvo.resumo.map((linha) => (
          <React.Fragment key={linha.rotulo}>
            <span className="text-muted-foreground">{linha.rotulo}</span>
            <span className={CLASSE_DO_ESTILO[linha.estilo]}>{linha.valor}</span>
          </React.Fragment>
        ))}
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
              name="pago_em"
              defaultValue={alvo.dataInicial}
              onDateChange={(d) => {
                setPagoEm(d ? format(d, "yyyy-MM-dd") : "");
                setErroLocal(null);
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Conta bancária que recebeu{" "}
              <span className="text-california-red">*</span>
            </label>
            <Select
              value={contaId}
              disabled={alvo.contaTravadaId !== null}
              onValueChange={(valor) => {
                setContaId(valor);
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

        <BlocoValorDaBaixa
          v={v}
          lado="receber"
          valorDoTitulo={alvo.valor}
          parcelaRotulo={alvo.parcelaRotulo}
          restoTexto={alvo.restoTexto}
          parcial={
            alvo.aceitaParcial
              ? { aceita: true }
              : { aceita: false, motivo: "Rendimento só aceita a baixa do valor inteiro." }
          }
          retencao={alvo.aceitaRetencao ? { mostra: true, motivo: null } : { mostra: false }}
        />

        {/* Módulo fiscal (entrega 2): o efeito desta baixa na Apuração. Lê a
            data, o valor a dar baixa e os retidos do bloco acima, e se refaz
            a cada mudança. Some na nota de antes do módulo (sem CNPJ
            emissor), no avulso e no rendimento. */}
        <NoFiscalDoRecebimento
          leitura={fiscal}
          data={pagoEm}
          valor={v.valor}
          retidos={v.retem ? v.valores : null}
        />

        <div className="space-y-1">
          <label className="text-xs font-semibold">
            Centro de custo do recebimento{" "}
            <span className="text-california-red">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Combobox
              items={tiposAtivos.map((t) => ({
                value: t.id,
                label: `${t.codigo} · ${t.nome}`,
              }))}
              value={tipoId || null}
              onChange={(valor) => handleTipo(valor ?? "")}
              placeholder={
                tiposAtivos.length === 0 ? "Nenhum tipo cadastrado" : "Tipo..."
              }
              buscaPlaceholder="Escreva o código ou o nome"
              disabled={alvo.centroTravado || tiposAtivos.length === 0}
              className={COMBOBOX_COMO_SELECT}
            />
            <Combobox
              items={subtiposDoTipo.map((s) => ({ value: s.id, label: s.nome }))}
              value={subtipoId || null}
              onChange={(valor) => {
                setSubtipoId(valor ?? "");
                setErroLocal(null);
              }}
              disabled={alvo.centroTravado || !tipoId || subtiposDoTipo.length === 0}
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
            Define onde a receita entra no DRE.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
          <span>
            Ao confirmar, o recebimento é registrado e enviado para a{" "}
            <strong className="font-semibold text-foreground">Conciliação</strong> com
            a conta e o centro de custo escolhidos.
            {v.retem && v.retido > 0 && (
              <>
                {" "}
                Os impostos retidos ficam registrados na baixa, imposto por imposto,
                para o módulo fiscal abater.
              </>
            )}
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
          <Banknote className="h-4 w-4" />
          {pending
            ? "Confirmando..."
            : baixaParcial
              ? "Confirmar baixa parcial"
              : "Confirmar baixa"}
        </button>
      </div>
    </>
  );
}
