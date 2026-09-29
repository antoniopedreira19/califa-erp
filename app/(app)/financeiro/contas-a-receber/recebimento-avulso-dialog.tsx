"use client";

/**
 * O botão "Recebimento avulso" de Títulos a Receber (decisão 124).
 *
 * Três tipos, como no protótipo aprovado em 28/09/2026 (seção 1):
 *
 * - **Recebimento avulso** — dinheiro que entra sem nota fiscal (reembolso,
 *   devolução de fornecedor, juros). Empresa, descrição, valor, "Recebido
 *   de" opcional, rateio por regional e centro de custo. Sem job: a receita
 *   fica nas regionais do rateio.
 * - **Transferência entre contas** — dinheiro que só muda de conta. Sem
 *   empresa, regional nem plano (D17.2), só entre contas do mesmo CNPJ
 *   (D4 pendente), fora do DRE e do fluxo consolidado. Aqui "Criar e dar
 *   baixa" é uma chamada só: a transferência já nasce feita, na data.
 * - **Rendimento de aplicação** — o líquido do mês numa conta de aplicação
 *   (tipo Investimento). Empresa e rateio (D3 b), centro de custo fixo, um
 *   por conta e por mês.
 *
 * O rodapé segue o lançamento avulso de Títulos a Pagar (resposta do Tiago
 * de 28/09, que o protótipo v4 não mostra): **Criar** lança o título em
 * aberto, com a data prevista; **Criar e dar baixa** cria e abre a baixa em
 * seguida, onde se escolhem a data e a conta do recebimento.
 */

import * as React from "react";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  CalendarPlus,
  Info,
  Plus,
  TrendingUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { MoedaInput } from "@/components/ui/moeda-input";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RateioRegionalEditor } from "../contas-a-pagar/rateio-regional-editor";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  ContaBancaria,
  PlanoContaSubtipo,
  PlanoContaTipo,
  RateioLinhaInput,
} from "@/lib/types";
import {
  criarRecebimentoAvulso,
  criarTransferenciaEntreContas,
  saldoDaContaNoDia,
} from "./actions-recebimento-avulso";

export type TipoDoRecebimentoAvulso = "recebimento_avulso" | "transferencia" | "rendimento";

/** Um rendimento já lançado: a tela avisa antes de o banco recusar o
 *  segundo da mesma conta no mesmo mês. */
export interface RendimentoLancado {
  conta_bancaria_id: string;
  /** "2026-09" */
  competencia: string;
  valor: number;
  codigo: string | null;
}

const TIPOS: Array<{
  chave: TipoDoRecebimentoAvulso;
  icone: typeof ArrowDownLeft;
  rotulo: string;
  sub: string;
}> = [
  {
    chave: "recebimento_avulso",
    icone: ArrowDownLeft,
    rotulo: "Recebimento avulso",
    sub: "Entrou dinheiro sem nota fiscal",
  },
  {
    chave: "transferencia",
    icone: ArrowLeftRight,
    rotulo: "Transferência entre contas",
    sub: "Dinheiro que só muda de conta",
  },
  {
    chave: "rendimento",
    icone: TrendingUp,
    rotulo: "Rendimento de aplicação",
    sub: "Rendimento líquido do mês",
  },
];

const EXPLICA: Record<TipoDoRecebimentoAvulso, string> = {
  recebimento_avulso:
    "Reembolso, devolução de fornecedor, juros ou qualquer entrada que não passa por nota fiscal. Entra em Títulos a Receber sem job: a receita fica nas regionais do rateio.",
  transferencia:
    "Não é receita nem despesa: fica fora do DRE e do fluxo de caixa consolidado. Aparece no extrato das duas contas, e cancelar desfaz as duas linhas juntas. Não pede empresa: a conta já diz de qual CNPJ é o dinheiro.",
  rendimento:
    "O valor líquido (depois do IR e do IOF), que é o que de fato entrou na aplicação. Entra como Receita Financeira, um lançamento por conta e por mês.",
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Os últimos 12 meses, do atual para trás: "2026-09" → "setembro de 2026". */
function competencias(): Array<{ valor: string; rotulo: string }> {
  const hoje = new Date();
  const out: Array<{ valor: string; rotulo: string }> = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    out.push({
      valor: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      rotulo: `${MESES[d.getMonth()]} de ${d.getFullYear()}`,
    });
  }
  return out;
}

/** "2026-09" → "2026-09-30" */
function ultimoDiaDoMes(comp: string): string {
  const [a, m] = comp.split("-").map(Number);
  return format(new Date(a, m, 0), "yyyy-MM-dd");
}

function hoje(): string {
  return format(new Date(), "yyyy-MM-dd");
}

const RATEIO_INICIAL: RateioLinhaInput[] = [{ regional_id: "", percentual: 100 }];

function rateioValido(linhas: RateioLinhaInput[]): boolean {
  if (linhas.length === 0) return false;
  if (linhas.some((l) => !l.regional_id)) return false;
  const soma = linhas.reduce((s, l) => s + l.percentual, 0);
  return Math.abs(soma - 100) < 0.01;
}

function Campo({
  rotulo,
  obrigatorio,
  ajuda,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold">
        {rotulo}
        {obrigatorio && <span className="text-california-red"> *</span>}
      </label>
      {children}
      {ajuda && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

export function RecebimentoAvulsoDialog({
  open,
  onOpenChange,
  empresas,
  regionais,
  clientes,
  fornecedores,
  tipos,
  subtipos,
  contas,
  rendimentosLancados,
  onCriado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresas: Array<{ id: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  contas: ContaBancaria[];
  rendimentosLancados: RendimentoLancado[];
  /** O título nasceu. `abrirBaixa` pede para a tela abrir a baixa dele em
   *  seguida (o "Criar e dar baixa" do recebimento avulso e do
   *  rendimento); `mensagem` é o aviso para quando não abre. */
  onCriado: (id: string, abrirBaixa: boolean, mensagem: string) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [tipo, setTipo] = React.useState<TipoDoRecebimentoAvulso>("recebimento_avulso");
  const [erro, setErro] = React.useState<string | null>(null);

  // Comuns
  const [empresaId, setEmpresaId] = React.useState("");
  const [centavos, setCentavos] = React.useState("");
  const [rateio, setRateio] = React.useState<RateioLinhaInput[]>(RATEIO_INICIAL);
  // Recebimento avulso
  const [descricao, setDescricao] = React.useState("");
  const [dataPrevista, setDataPrevista] = React.useState(hoje());
  const [recebidoDe, setRecebidoDe] = React.useState<string | null>(null);
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  // Rendimento
  const listaCompetencias = React.useMemo(competencias, []);
  const [contaAplicacao, setContaAplicacao] = React.useState("");
  const [competencia, setCompetencia] = React.useState(listaCompetencias[0].valor);
  const [dataRendimento, setDataRendimento] = React.useState(
    ultimoDiaDoMes(listaCompetencias[0].valor),
  );
  const [saldoNaData, setSaldoNaData] = React.useState<number | null>(null);
  // Transferência
  const [contaOrigem, setContaOrigem] = React.useState("");
  const [contaDestino, setContaDestino] = React.useState("");
  const [dataTransferencia, setDataTransferencia] = React.useState(hoje());
  const [saldoOrigem, setSaldoOrigem] = React.useState<number | null>(null);
  const [saldoDestino, setSaldoDestino] = React.useState<number | null>(null);
  /** Troca a chave dos campos não controlados (valor, datas) a cada
   *  abertura e a cada troca de tipo: eles montam de novo, vazios. */
  const [geracao, setGeracao] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setTipo("recebimento_avulso");
    limpar();
    setEmpresaId(empresas.length === 1 ? empresas[0].id : "");
    setRateio(RATEIO_INICIAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function limpar() {
    setErro(null);
    setCentavos("");
    setDescricao("");
    setDataPrevista(hoje());
    setRecebidoDe(null);
    setTipoId("");
    setSubtipoId("");
    setContaAplicacao("");
    setCompetencia(listaCompetencias[0].valor);
    setDataRendimento(ultimoDiaDoMes(listaCompetencias[0].valor));
    setSaldoNaData(null);
    setContaOrigem("");
    setContaDestino("");
    setDataTransferencia(hoje());
    setSaldoOrigem(null);
    setSaldoDestino(null);
    setGeracao((g) => g + 1);
  }

  function trocarTipo(t: TipoDoRecebimentoAvulso) {
    if (t === tipo) return;
    setTipo(t);
    limpar();
  }

  const contasAplicacao = contas.filter((c) => c.ativo && c.tipo === "investimento");
  const contasAtivas = contas.filter((c) => c.ativo);
  const origemObj = contasAtivas.find((c) => c.id === contaOrigem) ?? null;
  const destinoObj = contasAtivas.find((c) => c.id === contaDestino) ?? null;
  const cnpjsDiferentes =
    origemObj !== null &&
    destinoObj !== null &&
    origemObj.empresa_contabil_id !== destinoObj.empresa_contabil_id;
  const regionaisDaEmpresa = regionais.filter((r) => r.empresa_id === empresaId);
  const tiposDeEntrada = tipos.filter(
    (t) => t.ativo && (t.natureza_padrao === "entrada" || t.natureza_padrao === "ambos"),
  );
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];
  const itensRecebidoDe = [
    ...clientes.map((c) => ({ value: `c:${c.id}`, label: c.nome, descricao: "Cliente" })),
    ...fornecedores.map((f) => ({ value: `f:${f.id}`, label: f.nome, descricao: "Fornecedor" })),
  ];
  const valor = Number(centavos || "0") / 100;
  const rendimentoDoMes =
    tipo === "rendimento" && contaAplicacao
      ? rendimentosLancados.find(
          (r) => r.conta_bancaria_id === contaAplicacao && r.competencia === competencia,
        ) ?? null
      : null;

  // Saldo da aplicação no dia do lançamento: a prévia "depois do
  // rendimento" do protótipo.
  React.useEffect(() => {
    if (tipo !== "rendimento" || !contaAplicacao || !dataRendimento) {
      setSaldoNaData(null);
      return;
    }
    let vivo = true;
    saldoDaContaNoDia({ conta_bancaria_id: contaAplicacao, data: dataRendimento }).then(
      (res) => {
        if (vivo) setSaldoNaData(res.ok ? res.saldo : null);
      },
    );
    return () => {
      vivo = false;
    };
  }, [tipo, contaAplicacao, dataRendimento]);

  // Saldos das duas contas no dia: a prévia "saldo passa a" do protótipo.
  React.useEffect(() => {
    if (tipo !== "transferencia" || !dataTransferencia) {
      setSaldoOrigem(null);
      setSaldoDestino(null);
      return;
    }
    let vivo = true;
    const buscar = (id: string, set: (v: number | null) => void) => {
      if (!id) {
        set(null);
        return;
      }
      saldoDaContaNoDia({ conta_bancaria_id: id, data: dataTransferencia }).then((res) => {
        if (vivo) set(res.ok ? res.saldo : null);
      });
    };
    buscar(contaOrigem, setSaldoOrigem);
    buscar(contaDestino, setSaldoDestino);
    return () => {
      vivo = false;
    };
  }, [tipo, contaOrigem, contaDestino, dataTransferencia]);

  function trocarEmpresa(id: string) {
    setEmpresaId(id);
    // As regionais são da empresa: trocar a empresa zera o rateio.
    setRateio(RATEIO_INICIAL);
    setErro(null);
  }

  function registrarTransferencia(transferir: boolean) {
    if (!contaOrigem || !contaDestino) return setErro("Escolha a conta de origem e a de destino.");
    if (contaOrigem === contaDestino) {
      return setErro("A conta de destino precisa ser diferente da de origem.");
    }
    if (cnpjsDiferentes) {
      return setErro(
        "Transferência só entre contas do mesmo CNPJ. Entre CNPJs diferentes o dinheiro muda de dono, e esse caso ainda vai ser definido.",
      );
    }
    if (!valor) return setErro("Informe o valor da transferência.");
    if (!dataTransferencia) return setErro("Informe a data.");
    startTransition(async () => {
      const res = await criarTransferenciaEntreContas({
        conta_origem_id: contaOrigem,
        conta_destino_id: contaDestino,
        valor,
        data_prevista: dataTransferencia,
        descricao: descricao.trim() || null,
        transferir,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onCriado(
        res.id,
        false,
        transferir
          ? `Transferência de ${formatCurrency(valor, "BRL")} registrada, com as duas linhas no extrato.`
          : `Transferência de ${formatCurrency(valor, "BRL")} criada em Títulos a Receber, a transferir.`,
      );
    });
  }

  function registrar(darBaixa: boolean) {
    setErro(null);
    if (tipo === "transferencia") return registrarTransferencia(darBaixa);
    if (!empresaId) return setErro("Escolha a empresa.");
    if (!valor) {
      return setErro(
        tipo === "rendimento"
          ? "Informe o rendimento líquido do mês."
          : "Informe o valor.",
      );
    }
    if (!rateioValido(rateio)) {
      return setErro(
        "Rateio de regional: escolha a regional de cada linha, e a soma dos percentuais deve ser 100,00.",
      );
    }

    let payload: Record<string, unknown>;
    let resumo: string;
    if (tipo === "recebimento_avulso") {
      if (descricao.trim().length < 3) return setErro("Informe a descrição.");
      if (!dataPrevista) return setErro("Informe a data prevista do recebimento.");
      if (!tipoId || !subtipoId) return setErro("Selecione o centro de custo.");
      payload = {
        tipo_entrada: "recebimento_avulso",
        empresa_id: empresaId,
        valor,
        data_prevista: dataPrevista,
        descricao: descricao.trim(),
        cliente_id: recebidoDe?.startsWith("c:") ? recebidoDe.slice(2) : null,
        fornecedor_id: recebidoDe?.startsWith("f:") ? recebidoDe.slice(2) : null,
        plano_conta_tipo_id: tipoId,
        plano_conta_subtipo_id: subtipoId,
        rateio,
      };
      resumo = `Recebimento avulso de ${formatCurrency(valor, "BRL")}`;
    } else {
      if (!contaAplicacao) return setErro("Escolha a conta de aplicação.");
      if (!dataRendimento) return setErro("Informe a data do lançamento.");
      if (rendimentoDoMes) {
        return setErro(
          "Esta conta já tem o rendimento deste mês. Cancele ou exclua o que existe antes de lançar de novo.",
        );
      }
      payload = {
        tipo_entrada: "rendimento",
        empresa_id: empresaId,
        valor,
        data_prevista: dataRendimento,
        conta_bancaria_prevista_id: contaAplicacao,
        competencia: `${competencia}-01`,
        rateio,
      };
      resumo = `Rendimento de ${formatCurrency(valor, "BRL")}`;
    }

    startTransition(async () => {
      const res = await criarRecebimentoAvulso(payload);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onCriado(res.id, darBaixa, `${resumo} criado em Títulos a Receber.`);
    });
  }

  const tipoRendimento = tipos.find((t) => t.codigo === "10");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[660px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-california-red" />
            Recebimento avulso
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {TIPOS.map((t) => {
            const Icone = t.icone;
            const ativo = tipo === t.chave;
            return (
              <button
                key={t.chave}
                type="button"
                onClick={() => trocarTipo(t.chave)}
                aria-pressed={ativo}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  ativo
                    ? "border-california-red bg-california-red/[0.06]"
                    : "border-border bg-white hover:border-california-red/40",
                )}
              >
                <Icone
                  className={cn("h-4 w-4", ativo ? "text-california-red" : "text-muted-foreground")}
                />
                <span
                  className={cn(
                    "text-[12.5px] font-semibold leading-tight",
                    ativo ? "text-california-red" : "text-foreground",
                  )}
                >
                  {t.rotulo}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">{t.sub}</span>
              </button>
            );
          })}
        </div>

        {erro && (
          <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="space-y-3">
          {tipo === "recebimento_avulso" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Data prevista do recebimento" obrigatorio>
                  <DatePicker
                    key={`data-${geracao}`}
                    name="data_prevista"
                    defaultValue={dataPrevista}
                    onDateChange={(d) => {
                      setDataPrevista(d ? format(d, "yyyy-MM-dd") : "");
                      setErro(null);
                    }}
                  />
                </Campo>
                <Campo rotulo="Valor" obrigatorio>
                  <MoedaInput
                    key={`valor-${geracao}`}
                    onCentavosChange={(c) => {
                      setCentavos(c);
                      setErro(null);
                    }}
                  />
                </Campo>
              </div>
              <Campo rotulo="Empresa" obrigatorio>
                <Select value={empresaId} onValueChange={trocarEmpresa}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a empresa..." />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Descrição" obrigatorio>
                <input
                  type="text"
                  value={descricao}
                  maxLength={200}
                  onChange={(e) => {
                    setDescricao(e.target.value);
                    setErro(null);
                  }}
                  placeholder="Ex.: reembolso das passagens do evento"
                  className="flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:border-california-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/15"
                />
              </Campo>
              <Campo rotulo="Recebido de (opcional)">
                <Combobox
                  items={itensRecebidoDe}
                  value={recebidoDe}
                  onChange={setRecebidoDe}
                  placeholder="Cliente ou fornecedor..."
                  buscaPlaceholder="Escreva o nome"
                  limpavel
                  className={COMBOBOX_COMO_SELECT}
                />
              </Campo>
              <RateioDaEmpresa
                empresaId={empresaId}
                rateio={rateio}
                setRateio={setRateio}
                regionais={regionaisDaEmpresa}
                pending={pending}
              />
              <Campo rotulo="Centro de custo" obrigatorio ajuda="Define onde a receita entra no DRE.">
                <div className="grid grid-cols-2 gap-3">
                  <Combobox
                    items={tiposDeEntrada.map((t) => ({
                      value: t.id,
                      label: `${t.codigo} · ${t.nome}`,
                    }))}
                    value={tipoId || null}
                    onChange={(v) => {
                      setTipoId(v ?? "");
                      setSubtipoId("");
                      setErro(null);
                    }}
                    placeholder="Tipo..."
                    buscaPlaceholder="Escreva o código ou o nome"
                    className={COMBOBOX_COMO_SELECT}
                  />
                  <Combobox
                    items={subtiposDoTipo.map((s) => ({ value: s.id, label: s.nome }))}
                    value={subtipoId || null}
                    onChange={(v) => {
                      setSubtipoId(v ?? "");
                      setErro(null);
                    }}
                    disabled={!tipoId || subtiposDoTipo.length === 0}
                    placeholder={!tipoId ? "Escolha o tipo primeiro" : "Subtipo..."}
                    buscaPlaceholder="Escreva o nome do subtipo"
                    className={COMBOBOX_COMO_SELECT}
                  />
                </div>
              </Campo>
            </>
          )}

          {tipo === "transferencia" && (
            <>
              <div className="grid grid-cols-[1fr_28px_1fr] items-end gap-2">
                <Campo rotulo="Conta de origem" obrigatorio>
                  <Select
                    value={contaOrigem}
                    onValueChange={(v) => {
                      setContaOrigem(v);
                      if (v === contaDestino) setContaDestino("");
                      setErro(null);
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
                </Campo>
                <div className="flex h-11 items-center justify-center text-muted-foreground">
                  <ArrowRight className="h-4 w-4" />
                </div>
                <Campo rotulo="Conta de destino" obrigatorio>
                  <Select
                    value={contaDestino}
                    onValueChange={(v) => {
                      setContaDestino(v);
                      setErro(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a conta..." />
                    </SelectTrigger>
                    <SelectContent>
                      {contasAtivas.map((c) => (
                        <SelectItem key={c.id} value={c.id} disabled={c.id === contaOrigem}>
                          {c.nome} · {c.banco}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Data" obrigatorio ajuda="Em Criar e dar baixa, é a data em que as duas linhas entram no extrato.">
                  <DatePicker
                    key={`data-transf-${geracao}`}
                    name="data_transferencia"
                    defaultValue={dataTransferencia}
                    onDateChange={(d) => {
                      setDataTransferencia(d ? format(d, "yyyy-MM-dd") : "");
                      setErro(null);
                    }}
                  />
                </Campo>
                <Campo rotulo="Valor" obrigatorio>
                  <MoedaInput
                    key={`valor-transf-${geracao}`}
                    onCentavosChange={(c) => {
                      setCentavos(c);
                      setErro(null);
                    }}
                  />
                </Campo>
              </div>
              <Campo rotulo="Descrição (opcional)">
                <input
                  type="text"
                  value={descricao}
                  maxLength={200}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: aplicação do caixa do mês"
                  className="flex h-11 w-full rounded-lg border border-border bg-white px-3.5 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:border-california-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/15"
                />
              </Campo>
              {cnpjsDiferentes && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                  As contas são de CNPJs diferentes. Entre CNPJs o dinheiro muda de dono, não
                  só de conta: esse caso ainda vai ser definido, e por enquanto a
                  transferência não é aceita.
                </div>
              )}
              <div className="overflow-hidden rounded-xl border border-border text-[12.5px]">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border px-4 py-2.5">
                  <span>
                    <span className="text-muted-foreground">Sai de</span>{" "}
                    <b className="font-semibold">{origemObj?.nome ?? "—"}</b>
                  </span>
                  <span className="font-mono font-semibold text-california-red">
                    {valor ? `− ${formatCurrency(valor, "BRL")}` : "—"}
                  </span>
                  <span className="w-[190px] text-right text-muted-foreground">
                    {saldoOrigem !== null && (
                      <>
                        saldo passa a{" "}
                        <b className="font-mono font-semibold text-foreground">
                          {formatCurrency(saldoOrigem - valor, "BRL")}
                        </b>
                      </>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5">
                  <span>
                    <span className="text-muted-foreground">Entra em</span>{" "}
                    <b className="font-semibold">{destinoObj?.nome ?? "escolha o destino"}</b>
                  </span>
                  <span className="font-mono font-semibold text-emerald-700">
                    {valor ? `+ ${formatCurrency(valor, "BRL")}` : "—"}
                  </span>
                  <span className="w-[190px] text-right text-muted-foreground">
                    {saldoDestino !== null && (
                      <>
                        saldo passa a{" "}
                        <b className="font-mono font-semibold text-foreground">
                          {formatCurrency(saldoDestino + valor, "BRL")}
                        </b>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </>
          )}

          {tipo === "rendimento" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Conta de aplicação" obrigatorio>
                  <Select
                    value={contaAplicacao}
                    onValueChange={(v) => {
                      setContaAplicacao(v);
                      setErro(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a conta..." />
                    </SelectTrigger>
                    <SelectContent>
                      {contasAplicacao.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Nenhuma conta do tipo Investimento cadastrada.
                        </div>
                      ) : (
                        contasAplicacao.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome} · {c.banco}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo rotulo="Mês do rendimento" obrigatorio>
                  <Select
                    value={competencia}
                    onValueChange={(v) => {
                      setCompetencia(v);
                      setDataRendimento(ultimoDiaDoMes(v));
                      setGeracao((g) => g + 1);
                      setErro(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {listaCompetencias.map((c) => (
                        <SelectItem key={c.valor} value={c.valor}>
                          {c.rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Data do lançamento" obrigatorio ajuda="Vem no último dia do mês.">
                  <DatePicker
                    key={`data-rend-${geracao}`}
                    name="data_rendimento"
                    defaultValue={dataRendimento}
                    onDateChange={(d) => {
                      setDataRendimento(d ? format(d, "yyyy-MM-dd") : "");
                      setErro(null);
                    }}
                  />
                </Campo>
                <Campo
                  rotulo="Rendimento líquido do mês"
                  obrigatorio
                  ajuda="Depois do IR e do IOF: o que entrou na aplicação."
                >
                  <MoedaInput
                    key={`valor-rend-${geracao}`}
                    onCentavosChange={(c) => {
                      setCentavos(c);
                      setErro(null);
                    }}
                  />
                </Campo>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-[12px]">
                <span className="text-muted-foreground">
                  Saldo da aplicação depois do rendimento
                </span>
                <span className="font-mono font-semibold">
                  {saldoNaData === null ? "—" : formatCurrency(saldoNaData + valor, "BRL")}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-[12px]">
                <span className="text-muted-foreground">Centro de custo</span>
                <span className="font-medium">
                  {tipoRendimento
                    ? `${tipoRendimento.codigo} · ${tipoRendimento.nome}`
                    : "10 · Receita Financeira"}{" "}
                  · Rendimento de aplicação
                </span>
              </div>
              {rendimentoDoMes && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                  Esta conta já tem o rendimento deste mês
                  {rendimentoDoMes.codigo ? ` (${rendimentoDoMes.codigo})` : ""}:{" "}
                  <b className="font-mono">{formatCurrency(rendimentoDoMes.valor, "BRL")}</b>.
                  Para corrigir, cancele ou exclua esse lançamento e lance de novo.
                </div>
              )}
              <Campo rotulo="Empresa" obrigatorio>
                <Select value={empresaId} onValueChange={trocarEmpresa}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a empresa..." />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Campo>
              <RateioDaEmpresa
                empresaId={empresaId}
                rateio={rateio}
                setRateio={setRateio}
                regionais={regionaisDaEmpresa}
                pending={pending}
              />
            </>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span>{EXPLICA[tipo]}</span>
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-[11px] text-muted-foreground text-pretty">
            <strong className="font-semibold text-foreground">Criar</strong> lança o título
            em aberto em Títulos a Receber.{" "}
            <strong className="font-semibold text-foreground">Criar e dar baixa</strong>{" "}
            {tipo === "transferencia"
              ? "registra a transferência agora, com as duas linhas no extrato."
              : "registra o recebimento agora e envia para a conciliação."}
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => registrar(false)}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <CalendarPlus className="h-4 w-4" />
              Criar
            </button>
            <button
              type="button"
              onClick={() => registrar(true)}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <Banknote className="h-4 w-4" />
              {pending ? "Criando..." : "Criar e dar baixa"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** O rateio só aparece depois da empresa: as regionais são dela. */
function RateioDaEmpresa({
  empresaId,
  rateio,
  setRateio,
  regionais,
  pending,
}: {
  empresaId: string;
  rateio: RateioLinhaInput[];
  setRateio: (linhas: RateioLinhaInput[]) => void;
  regionais: Array<{ id: string; nome: string; ativo: boolean }>;
  pending: boolean;
}) {
  if (!empresaId) {
    return (
      <div className="space-y-1">
        <label className="text-xs font-semibold">
          Rateio de regional <span className="text-california-red">*</span>
        </label>
        <p className="rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Escolha a empresa para ver as regionais dela.
        </p>
      </div>
    );
  }
  return (
    <RateioRegionalEditor
      linhas={rateio}
      onChange={setRateio}
      regionais={regionais}
      disabled={pending}
    />
  );
}
