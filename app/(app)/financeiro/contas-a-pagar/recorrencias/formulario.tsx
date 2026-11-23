"use client";
// O formulário da recorrência (decisão 272): criar e editar são o MESMO
// formulário. Quatro blocos — o que se paga, quanto e quando, como se paga,
// onde entra no resultado — e o "Ao salvar" com os títulos que vão nascer.
// A regional é um seletor simples (uma regional ou Todas, TD), sem rateio
// livre por enquanto. Na edição, a mudança pode ir também ao título já gerado
// e em aberto (opção A da decisão 272).
import * as React from "react";
import { AlertCircle, CalendarClock, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import { CampoFornecedor } from "@/app/(app)/fornecedores/campo-fornecedor";
import { DatePicker } from "@/components/ui/date-picker";
import { FormaPagamentoField, type CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { FormaPagamento, PlanoContaSubtipo, PlanoContaTipo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { criarContaRecorrente, editarContaRecorrente } from "../actions-recorrentes";
import { ANTECEDENCIA, brl, dia, proximasDatas, somarDias, type Recorrencia } from "./dados";

export interface ListasDoFormulario {
  empresas: Array<{ id: string; nome: string }>;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  fornecedores: Array<{ id: string; nome: string; cpf_cnpj?: string | null }>;
  clientes: Array<{ id: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>;
  cartoes: CartaoOption[];
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const TD = "td";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Hoje em Brasília (regra do projeto: "hoje" é de Brasília). */
export function hojeEmBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function Secao({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-california-red/10 text-[11px] font-bold text-california-red">{n}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function Erro({ msgs }: { msgs?: string[] }) {
  if (!msgs?.length) return null;
  return (
    <>
      {msgs.map((m, i) => (
        <p key={i} className="text-xs text-california-red">
          {m}
        </p>
      ))}
    </>
  );
}

export function FormularioDaRecorrencia({
  modo,
  rec,
  listas,
  hoje,
  onCancelar,
  onSalvo,
}: {
  modo: "criar" | "editar";
  rec?: Recorrencia | null;
  listas: ListasDoFormulario;
  hoje: string;
  onCancelar: () => void;
  onSalvo: (id: string, mensagem: string) => void;
}) {
  const editar = modo === "editar" && rec ? rec : null;
  const [pendente, startTransition] = React.useTransition();
  const [empresaId, setEmpresaId] = React.useState(rec?.empresa_id ?? (listas.empresas.length === 1 ? listas.empresas[0].id : ""));
  const [descricao, setDescricao] = React.useState(rec?.descricao ?? "");
  const [valor, setValor] = React.useState(rec ? String(rec.valor) : "");
  const [fornecedorId, setFornecedorId] = React.useState<string | null>(rec?.fornecedor_id ?? null);
  const [clienteId, setClienteId] = React.useState<string>(rec?.cliente_id ?? "__none__");
  const [tipoId, setTipoId] = React.useState(rec?.tipo_id ?? "");
  const [subtipoId, setSubtipoId] = React.useState(rec?.subtipo_id ?? "");
  const [regionalSel, setRegionalSel] = React.useState<string>(() =>
    !rec ? "" : rec.rateio.length > 1 ? TD : (rec.rateio[0]?.regional_id ?? ""),
  );
  const [frequencia, setFrequencia] = React.useState<"mensal" | "quinzenal" | "anual">(rec?.frequencia ?? "mensal");
  const [diaDoMes, setDiaDoMes] = React.useState<number | null>(rec?.dia_do_mes ?? null);
  const [q1, setQ1] = React.useState<number | null>(rec?.dia_quinzena_1 ?? null);
  const [q2, setQ2] = React.useState<number | null>(rec?.dia_quinzena_2 ?? null);
  const [anoDia, setAnoDia] = React.useState<number | null>(rec?.dia_do_ano_dia ?? null);
  const [anoMes, setAnoMes] = React.useState<number | null>(rec?.dia_do_ano_mes ?? null);
  const [dataFim, setDataFim] = React.useState<string | null>(rec?.data_fim ?? null);
  const [forma, setForma] = React.useState<FormaPagamento | null>(rec?.forma_pagamento ?? null);
  const [cartaoId, setCartaoId] = React.useState<string | null>(rec?.cartao_credito_id ?? null);
  const [variavel, setVariavel] = React.useState(Boolean(rec?.valor_variavel));
  const [textoExtrato, setTextoExtrato] = React.useState(rec?.texto_no_extrato ?? "");
  const [verCliente, setVerCliente] = React.useState(Boolean(rec?.cliente_id));
  const [erro, setErro] = React.useState<string | null>(null);
  const [erros, setErros] = React.useState<Record<string, string[]>>({});
  // Opção A da decisão 272: o título já gerado e em aberto acompanha a edição.
  const abertos = editar ? editar.titulos.filter((t) => !t.travado) : [];
  const [aplicarNoTitulo, setAplicarNoTitulo] = React.useState(true);

  const subtiposDoTipo = listas.subtipos.filter((s) => s.tipo_id === tipoId && s.ativo);
  const regionaisDaEmpresa = listas.regionais.filter((r) => r.empresa_id === empresaId && r.ativo);

  // O resumo: quando nasce o primeiro título e os próximos.
  const calendario = { frequencia, dia_do_mes: diaDoMes, dia_quinzena_1: q1, dia_quinzena_2: q2, dia_do_ano_dia: anoDia, dia_do_ano_mes: anoMes };
  const ehDia = (d: number | null) => d != null && Number.isInteger(d) && d >= 1 && d <= 31;
  const diaOk =
    (frequencia === "mensal" && ehDia(diaDoMes)) ||
    (frequencia === "quinzenal" && ehDia(q1) && ehDia(q2) && q1! < q2!) ||
    (frequencia === "anual" && ehDia(anoDia) && !!anoMes);
  const proximas = diaOk ? proximasDatas(calendario, hoje, 6, dataFim) : [];
  const limite = somarDias(hoje, ANTECEDENCIA);
  const jaNascem = proximas.filter((d) => d <= limite);
  // Na edição, o que vem depois do último título já gerado (a mesma regra da
  // Server Action: no mensal, o novo dia vale do mês seguinte ao do último título).
  const ultimoGerado = editar ? editar.titulos.map((t) => t.vencimento).sort().pop() ?? null : null;
  const depoisDe = !ultimoGerado
    ? null
    : frequencia === "mensal"
      ? new Date(Date.UTC(Number(ultimoGerado.slice(0, 4)), Number(ultimoGerado.slice(5, 7)), 0)).toISOString().slice(0, 10)
      : ultimoGerado;
  const naoGeradas = editar ? proximas.filter((d) => !depoisDe || d > depoisDe) : proximas;

  function trocarEmpresa(nova: string) {
    if (nova === empresaId) return;
    setEmpresaId(nova);
    setRegionalSel("");
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setErro(null);
    setErros({});
    const dados = {
      empresa_id: empresaId,
      descricao: descricao.trim(),
      valor: String(valor).replace(",", "."),
      fornecedor_id: fornecedorId,
      cliente_id: clienteId === "__none__" ? null : clienteId,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
      frequencia,
      dia_do_mes: frequencia === "mensal" ? diaDoMes : null,
      dia_quinzena_1: frequencia === "quinzenal" ? q1 : null,
      dia_quinzena_2: frequencia === "quinzenal" ? q2 : null,
      dia_do_ano_dia: frequencia === "anual" ? anoDia : null,
      dia_do_ano_mes: frequencia === "anual" ? anoMes : null,
      data_fim: dataFim,
      forma_pagamento: forma,
      cartao_credito_id: forma === "cartao_credito" ? cartaoId : null,
      regional: regionalSel,
      valor_variavel: variavel,
      texto_no_extrato: forma === "debito_automatico" && textoExtrato.trim() ? textoExtrato.trim().toUpperCase() : null,
    };
    startTransition(async () => {
      if (editar) {
        const r = await editarContaRecorrente(editar.id, { ...dados, aplicar_no_titulo_em_aberto: abertos.length > 0 && aplicarNoTitulo });
        if (!r.ok) {
          setErro(r.message);
          setErros(r.fieldErrors ?? {});
          return;
        }
        onSalvo(editar.id, "Recorrência salva.");
      } else {
        const r = await criarContaRecorrente(dados);
        if (!r.ok) {
          setErro(r.message);
          setErros(r.fieldErrors ?? {});
          return;
        }
        const nascem = jaNascem.length;
        onSalvo(
          r.id ?? "",
          nascem
            ? `Recorrência criada. ${nascem === 1 ? `O título de ${dia(jaNascem[0])} já nasceu` : `${nascem} títulos já nasceram`} no Contas a Pagar.`
            : "Recorrência criada.",
        );
      }
    });
  }

  const campoNumero = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  const s1 = (
    <Secao n={1} titulo="O que se paga">
      <div className="space-y-1.5">
        <Label htmlFor="rec-descricao">Descrição *</Label>
        <Input id="rec-descricao" value={descricao} maxLength={500} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Aluguel do escritório RJ" />
        <Erro msgs={erros.descricao} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rec-fornecedor">Fornecedor</Label>
        <CampoFornecedor
          id="rec-fornecedor"
          value={fornecedorId}
          onChange={setFornecedorId}
          fornecedores={listas.fornecedores}
          contexto="recorrente"
          placeholder="Quem recebe (opcional)"
        />
        {!fornecedorId && <p className="text-xs text-amber-700">Sem fornecedor, o título não sai pela remessa do banco.</p>}
      </div>
    </Secao>
  );

  const s2 = (
    <Secao n={2} titulo="Quanto e quando">
      <div className="grid grid-cols-[1fr_1.4fr] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rec-valor">Valor (R$) *</Label>
          <Input id="rec-valor" type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={campoNumero} />
          <Erro msgs={erros.valor} />
        </div>
        <div className="space-y-1.5">
          <Label>Frequência *</Label>
          <div className="flex gap-2">
            {(["mensal", "quinzenal", "anual"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequencia(f)}
                className={cn(
                  "h-11 flex-1 rounded-lg border px-3 text-sm font-medium transition-colors",
                  frequencia === f ? "border-california-red bg-california-red/10 text-california-red" : "border-border bg-white text-muted-foreground hover:bg-muted",
                )}
              >
                {f === "mensal" ? "Mensal" : f === "quinzenal" ? "Quinzenal" : "Anual"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {frequencia === "mensal" && (
          <div className="space-y-1.5">
            <Label htmlFor="rec-dia">Dia do vencimento *</Label>
            <Input id="rec-dia" type="number" min={1} max={31} value={diaDoMes ?? ""} onChange={(e) => setDiaDoMes(e.target.value ? Number(e.target.value) : null)} placeholder="Ex.: 8" className={campoNumero} />
            <Erro msgs={erros.dia_do_mes} />
          </div>
        )}
        {frequencia === "quinzenal" && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-q1">1º dia *</Label>
              <Input id="rec-q1" type="number" min={1} max={31} value={q1 ?? ""} onChange={(e) => setQ1(e.target.value ? Number(e.target.value) : null)} placeholder="Ex.: 5" className={campoNumero} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-q2">2º dia *</Label>
              <Input id="rec-q2" type="number" min={1} max={31} value={q2 ?? ""} onChange={(e) => setQ2(e.target.value ? Number(e.target.value) : null)} placeholder="Ex.: 20" className={campoNumero} />
              <Erro msgs={erros.dia_quinzena_2} />
            </div>
          </div>
        )}
        {frequencia === "anual" && (
          <div className="grid grid-cols-[0.7fr_1.3fr] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-ano-dia">Dia *</Label>
              <Input id="rec-ano-dia" type="number" min={1} max={31} value={anoDia ?? ""} onChange={(e) => setAnoDia(e.target.value ? Number(e.target.value) : null)} placeholder="Ex.: 15" className={campoNumero} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-ano-mes">Mês *</Label>
              <Select value={anoMes ? String(anoMes) : undefined} onValueChange={(v) => setAnoMes(Number(v))}>
                <SelectTrigger id="rec-ano-mes">
                  <SelectValue placeholder="Mês" />
                </SelectTrigger>
                <SelectContent>
                  {MESES.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="rec-fim">Último vencimento (opcional)</Label>
          <DatePicker
            key={rec?.id ?? "criar"}
            id="rec-fim"
            name="data_fim"
            defaultValue={dataFim ?? undefined}
            placeholder="Sem data para acabar"
            onDateChange={(d) => setDataFim(d ? iso(d) : null)}
          />
          <Erro msgs={erros.data_fim} />
        </div>
      </div>
      {frequencia !== "anual" && <p className="text-xs text-muted-foreground">Mês sem esse dia (31 em fevereiro) cai no último dia do mês.</p>}
      <div className="space-y-1.5">
        <Label>O valor</Label>
        <div className="flex gap-2">
          {(
            [
              [false, "É sempre o mesmo"],
              [true, "Varia todo mês"],
            ] as const
          ).map(([v, t]) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setVariavel(v)}
              className={cn(
                "h-10 flex-1 rounded-lg border px-3 text-sm font-medium transition-colors",
                variavel === v ? "border-california-red bg-california-red/10 text-california-red" : "border-border bg-white text-muted-foreground hover:bg-muted",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {variavel
            ? "Luz, água, celular: o título nasce com o valor acima como estimativa e \"Aguardando conta\" até alguém lançar a conta do mês."
            : "Aluguel, condomínio, contrato: o título nasce com este valor, pronto para pagar."}
        </p>
      </div>
    </Secao>
  );

  const s3 = (
    <Secao n={3} titulo="Como se paga">
      <FormaPagamentoField
        cartoes={listas.cartoes}
        value={{ forma_pagamento: forma, cartao_credito_id: cartaoId }}
        onChange={(v) => {
          setForma(v.forma_pagamento);
          setCartaoId(v.cartao_credito_id);
        }}
        obrigatorio={false}
      />
      <Erro msgs={erros.cartao_credito_id} />
      {forma === "debito_automatico" && (
        <div className="space-y-1.5">
          <Label htmlFor="rec-texto">Como aparece no extrato</Label>
          <Input id="rec-texto" value={textoExtrato} maxLength={120} onChange={(e) => setTextoExtrato(e.target.value)} placeholder="Ex.: DEBITO AUTOMATICO FIBRA" />
          <p className="text-xs text-muted-foreground">O começo do texto do banco. A Conciliação sugere esta recorrência para a linha com esse texto.</p>
        </div>
      )}
      {forma === "cartao_credito" && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Cada título entra na fatura do cartão aberta no dia do vencimento.
        </div>
      )}
    </Secao>
  );

  const s4 = (
    <Secao n={4} titulo="Onde entra no resultado">
      <div className="space-y-1.5">
        <Label htmlFor="rec-empresa">Empresa *</Label>
        <Select value={empresaId || undefined} onValueChange={trocarEmpresa} disabled={Boolean(editar)}>
          <SelectTrigger id="rec-empresa">
            <SelectValue placeholder="Selecione a empresa" />
          </SelectTrigger>
          <SelectContent>
            {listas.empresas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {editar && <p className="text-xs text-muted-foreground">A empresa não muda depois de criada. Se estiver errada, encerre esta e crie outra.</p>}
        <Erro msgs={erros.empresa_id} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rec-tipo">Tipo *</Label>
          <Combobox
            id="rec-tipo"
            items={listas.tipos.filter((t) => t.ativo).map((t) => ({ value: t.id, label: `${t.codigo} — ${t.nome}` }))}
            value={tipoId || null}
            onChange={(v) => {
              setTipoId(v ?? "");
              setSubtipoId("");
            }}
            placeholder="Selecione o tipo"
            buscaPlaceholder="Escreva o código ou o nome"
            className={COMBOBOX_COMO_SELECT}
          />
          <Erro msgs={erros.plano_conta_tipo_id} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rec-subtipo">Subtipo *</Label>
          <Combobox
            id="rec-subtipo"
            items={subtiposDoTipo.map((s) => ({ value: s.id, label: s.nome }))}
            value={subtipoId || null}
            onChange={(v) => setSubtipoId(v ?? "")}
            disabled={!tipoId}
            placeholder={tipoId ? "Selecione o subtipo" : "Escolha o tipo primeiro"}
            buscaPlaceholder="Escreva o nome do subtipo"
            className={COMBOBOX_COMO_SELECT}
          />
          <Erro msgs={erros.plano_conta_subtipo_id} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rec-regional">Regional *</Label>
        <Select value={regionalSel || undefined} onValueChange={setRegionalSel} disabled={!empresaId}>
          <SelectTrigger id="rec-regional">
            <SelectValue placeholder={empresaId ? "Selecione a regional" : "Escolha a empresa primeiro"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TD}>Todas (TD, pelo rateio)</SelectItem>
            {regionaisDaEmpresa.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Erro msgs={erros.regional} />
      </div>
      {verCliente ? (
        <div className="space-y-1.5">
          <Label htmlFor="rec-cliente">Cliente (opcional)</Label>
          <Combobox
            id="rec-cliente"
            value={clienteId}
            onChange={(v) => setClienteId(v ?? "__none__")}
            placeholder="Nenhum"
            items={[{ value: "__none__", label: "Nenhum" }, ...listas.clientes.map((c) => ({ value: c.id, label: c.nome }))]}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setVerCliente(true)} className="text-xs font-medium text-muted-foreground hover:text-california-red hover:underline">
          + Ligar a um cliente (opcional)
        </button>
      )}
    </Secao>
  );

  const resumo = (
    <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarClock className="h-4 w-4" /> Ao salvar
      </div>
      {!diaOk || !(Number(valor) > 0) ? (
        <p className="text-muted-foreground">Preencha o valor e o vencimento para ver os títulos que vão nascer.</p>
      ) : naoGeradas.length === 0 ? (
        <p className="text-muted-foreground">Nenhum vencimento novo até a data de fim.</p>
      ) : (
        <ul className="space-y-1.5">
          {naoGeradas.slice(0, 3).map((d) => (
            <li key={d} className="flex items-center justify-between gap-3">
              <span>
                <span className="font-mono">{dia(d)}</span>{" "}
                <span className="text-muted-foreground">
                  · {variavel ? "≈ " : ""}
                  {brl(Number(valor))}
                  {variavel ? " estimado" : ""}
                </span>
              </span>
              {!editar && jaNascem.includes(d) ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">Vira título agora</span>
              ) : (
                <span className="text-xs text-muted-foreground">vira título em {dia(somarDias(d, -ANTECEDENCIA))}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        O título nasce {ANTECEDENCIA} dias antes do vencimento, já aprovado. Até lá, o vencimento aparece como previsão no fluxo de caixa.
      </p>
    </div>
  );

  // Opção A: o título que já nasceu e ainda está em aberto.
  const noTitulo =
    editar && abertos.length > 0 ? (
      <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-california-red"
          checked={aplicarNoTitulo}
          onChange={(e) => setAplicarNoTitulo(e.target.checked)}
        />
        <span>
          Aplicar também {abertos.length === 1 ? "ao título já gerado" : `aos ${abertos.length} títulos já gerados`} e em aberto (
          {abertos.map((t) => dia(t.vencimento)).join(", ")}).
          <span className="mt-0.5 block text-xs text-amber-800">
            Valor, descrição, fornecedor, plano de contas, regional e forma de pagamento. O valor da conta já lançada e o vencimento não mudam.
          </span>
        </span>
      </label>
    ) : null;

  return (
    <form onSubmit={salvar} className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-8 overflow-y-auto px-6 py-5">
        <div className="space-y-6">
          {s1}
          {s2}
          {s3}
        </div>
        <div className="space-y-6">
          {s4}
          {resumo}
          {noTitulo}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-4">
        <div className="min-w-0 text-sm">
          {erro ? (
            <span className="flex items-center gap-2 text-california-red">
              <AlertCircle className="h-4 w-4 shrink-0" /> {erro}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={onCancelar} className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pendente}
            className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover disabled:opacity-60"
          >
            {pendente ? "Salvando…" : editar ? "Salvar" : "Criar recorrência"}
          </button>
        </div>
      </div>
    </form>
  );
}
