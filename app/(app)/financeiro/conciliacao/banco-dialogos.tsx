"use client";

/**
 * Os diálogos da aba Conciliação automática (decisão 200), portados do
 * protótipo aprovado (`banco.jsx`): corrigir a baixa feita à mão pela linha
 * do banco, escolher o título de uma linha (a lupa), cancelar a baixa que o
 * banco não mostra e lembrar o histórico como regra.
 */

import * as React from "react";
import { CheckCheck, Layers, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dataBR, TOM_DA_ETIQUETA } from "@/components/financeiro/planilha-de-titulos/planilha";
import { correcaoDaBaixa, formaDoHistorico, retencaoQueExplica, type TituloDoMotor } from "@/lib/conciliacao/motor";
import { normalizar } from "@/lib/conciliacao/ofx";
import type { PlanoContaSubtipo, PlanoContaTipo } from "@/lib/types";
import type { LancamentoSemLinha } from "./banco-dados";
import type { Linha } from "./linhas-da-aba";
import type { ResultadoDaLinha } from "./motor-da-conta";

const moeda = formatBRL;
const r2 = (n: number) => Math.round(n * 100) / 100;

function Botao({
  children,
  onClick,
  variante = "contorno",
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variante?: "verde" | "contorno" | "vermelho";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const v = {
    verde: "bg-emerald-600 text-white hover:bg-emerald-700",
    contorno: "border border-border bg-white text-foreground hover:bg-muted/50",
    vermelho: "bg-california-red text-white hover:bg-california-red-hover",
  }[variante];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        v,
      )}
    >
      {children}
    </button>
  );
}

function Erro({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <p className="mr-auto text-xs font-semibold text-california-red">{texto}</p>;
}

// ---------------------------------------------------------------------------
// Corrigir a baixa
// ---------------------------------------------------------------------------

/**
 * A baixa feita à mão que não bate com o banco: mostra o que muda, pede o
 * motivo e só então corrige e concilia (protótipo: `CorrigirBaixaDialog`).
 * A diferença vira juros só no boleto; no resto muda o valor pago, e o
 * título fica com a diferença em aberto (Tiago, 21/10/2026).
 */
export function CorrigirBaixaDialog({
  r,
  lancamento,
  pending,
  erro,
  onFechar,
  onConfirmar,
}: {
  r: ResultadoDaLinha;
  lancamento: LancamentoSemLinha;
  pending: boolean;
  erro: string | null;
  onFechar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const l = lancamento;
  const juros = l.juros ?? 0;
  const boleto = l.forma === "boleto" && (l.origem === "pp_baixa" || l.origem === "avulsa_baixa");
  const { antes, depois } = correcaoDaBaixa(l, r.mov, {
    liquido: r2(Math.abs(l.valor) - juros),
    forma: boleto ? "boleto" : l.forma,
    origem: l.origem,
  });
  const bancoMaior = !boleto && Math.abs(r.mov.valor) > antes.principal + 0.004;
  const ficaEmAberto = r2(antes.principal - depois.principal);
  const linhas: Array<[string, string, string, boolean]> = [
    ["Data do pagamento", dataBR(antes.data), dataBR(depois.data), antes.data !== depois.data],
    ["Valor do título", moeda(antes.principal), moeda(depois.principal), antes.principal !== depois.principal],
    ["Juros e multa", moeda(antes.juros), moeda(depois.juros), antes.juros !== depois.juros],
    [l.valor < 0 ? "Total que saiu da conta" : "Total que entrou na conta", moeda(antes.total), moeda(depois.total), antes.total !== depois.total],
  ];
  const sugestoes = [
    depois.juros < antes.juros && "O banco não cobrou os juros lançados na baixa",
    depois.juros > antes.juros && "O banco cobrou juros e multa que não estavam na baixa",
    depois.principal !== antes.principal && "O valor foi digitado errado na baixa",
    antes.data !== depois.data && "A data da baixa não era a do pagamento",
  ].filter((s): s is string => !!s);

  function confirmar() {
    if (motivo.trim().length < 10) {
      setErroLocal("Registre o motivo da correção (pelo menos 10 caracteres).");
      return;
    }
    onConfirmar(motivo.trim());
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCheck className="h-5 w-5 text-emerald-600" />
            Corrigir a baixa
          </DialogTitle>
          <DialogDescription>
            {l.descricao}
            {l.fornecedor ? ` · ${l.fornecedor}` : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="text-[12.5px] text-muted-foreground">
          No extrato do banco:{" "}
          <span className="font-mono">
            {dataBR(r.mov.data)} · {r.mov.historico.replace(/\s{2,}.*$/, "")} · {moeda(Math.abs(r.mov.valor))}
          </span>
        </p>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full table-fixed text-[12.5px]">
            <colgroup>
              <col />
              <col className="w-[150px]" />
              <col className="w-[170px]" />
            </colgroup>
            <thead className="bg-muted/60 text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold" />
                <th className="px-3 py-2 text-right font-semibold">Baixa registrada</th>
                <th className="px-3 py-2 text-right font-semibold">Fica (como no banco)</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(([rotulo, de, para, muda]) => (
                <tr key={rotulo} className="border-t border-border">
                  <td className="px-3 py-2">{rotulo}</td>
                  <td className={cn("px-3 py-2 text-right font-mono", muda && "text-muted-foreground line-through")}>{de}</td>
                  <td className={cn("px-3 py-2 text-right", muda ? "font-mono font-bold text-foreground" : "text-[11.5px] text-muted-foreground")}>
                    {muda ? para : "sem mudança"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bancoMaior ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900">
            O banco {l.valor < 0 ? "debitou" : "creditou"} {moeda(r2(Math.abs(r.mov.valor) - antes.principal))} a mais que a
            baixa e, fora do boleto, a diferença não vira juros: se era outro pagamento, procure o título pela lupa.
          </p>
        ) : (
          <div className="space-y-0.5 text-[11.5px] text-muted-foreground">
            {antes.juros !== depois.juros && (
              <p>
                {depois.juros < antes.juros
                  ? `Saem ${moeda(r2(antes.juros - depois.juros))} de 11 · Despesa com Juros.`
                  : `Entram ${moeda(r2(depois.juros - antes.juros))} em 11 · Despesa com Juros.`}
              </p>
            )}
            {ficaEmAberto > 0.004 && (
              <p>
                O título fica com {moeda(ficaEmAberto)} {l.valor < 0 ? "a pagar" : "a receber"}: a baixa vira parcial.
              </p>
            )}
          </div>
        )}
        {!bancoMaior && (
          <div className="space-y-1">
            <label htmlFor="corrigir-motivo" className="text-xs font-semibold">
              Motivo da correção <span className="text-california-red">*</span>
            </label>
            <textarea
              id="corrigir-motivo"
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                setErroLocal(null);
              }}
              rows={2}
              placeholder="Ex.: o banco não cobrou os juros lançados na baixa"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
            />
            <p className="text-[11px] text-muted-foreground">
              Fica no histórico da baixa e na auditoria, com a data e quem corrigiu.
            </p>
          </div>
        )}
        {!bancoMaior && sugestoes.length > 0 && (
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {sugestoes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setMotivo(s);
                  setErroLocal(null);
                }}
                className="rounded-full border border-border bg-white px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-california-red hover:text-california-red"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {!bancoMaior && (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            Ao confirmar, a baixa é refeita com o valor e a data do banco e fica conciliada. Dá para desfazer em Conciliados
            até fechar a conciliação; a correção e o desfazer ficam no histórico da baixa.
          </p>
        )}
        <DialogFooter className="items-center gap-2">
          <Erro texto={erro ?? erroLocal} />
          <Botao onClick={onFechar}>Cancelar</Botao>
          <Botao variante="verde" disabled={pending || bancoMaior} onClick={confirmar}>
            <CheckCheck className="h-4 w-4" />
            {pending ? "Corrigindo…" : "Corrigir e conciliar"}
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A lupa: escolher o título desta linha
// ---------------------------------------------------------------------------

/**
 * Os títulos em aberto no sentido da linha, pela proximidade do valor, com
 * a diferença ao lado e o que ela vira (protótipo: `ProcurarTitulo`). Dá
 * para marcar mais de um; com vários, a soma tem de bater centavo a
 * centavo. O valor da baixa vem sempre do banco.
 */
export function ProcurarTituloDialog({
  r,
  titulos,
  linhaPorChave,
  marcadosIniciais = [],
  onFechar,
  onEscolher,
}: {
  r: ResultadoDaLinha;
  titulos: TituloDoMotor[];
  linhaPorChave: Map<string, Linha>;
  marcadosIniciais?: string[];
  onFechar: () => void;
  /** Um título: abre a baixa dele; vários: baixa e concilia todos. */
  onEscolher: (escolhidos: TituloDoMotor[]) => void;
}) {
  const [busca, setBusca] = React.useState("");
  const [marcados, setMarcados] = React.useState<string[]>(marcadosIniciais);
  const alvo = r2(Math.abs(r.mov.valor));
  const paga = r.mov.valor < 0;
  const formaBanco = formaDoHistorico(r.mov.historico);
  const base = titulos.filter((t) => (paga ? !t.entra && t.lado !== "receber" : t.entra || t.lado === "receber"));
  const dist = (t: TituloDoMotor) => Math.abs(Date.parse(t.vencimento) - Date.parse(r.mov.data));
  const q = normalizar(busca);
  const texto = (t: TituloDoMotor) => normalizar(`${linhaPorChave.get(t.id)?.descricao ?? ""} ${t.contraparte} ${t.ref}`);
  const lista = base
    .filter((t) => !q || texto(t).includes(q))
    .sort((a, b) => Math.abs(a.liquido - alvo) - Math.abs(b.liquido - alvo) || dist(a) - dist(b))
    .slice(0, 15);
  const escolhidos = base.filter((t) => marcados.includes(t.id));
  const visiveis = [...escolhidos.filter((t) => !lista.includes(t)), ...lista];
  const soma = r2(escolhidos.reduce((s, t) => s + t.liquido, 0));

  const sozinho = (t: TituloDoMotor): { ok: boolean; tom: string; texto: string } => {
    const d = r2(t.liquido - alvo);
    if (d === 0) return { ok: true, tom: "text-emerald-700", texto: "valor exato" };
    if (d > 0) {
      const ret = retencaoQueExplica(t, alvo);
      if (ret) return { ok: true, tom: "text-amber-700", texto: `retenção na fonte: ${ret.nome}` };
      return { ok: true, tom: "text-amber-700", texto: `baixa parcial · ficam ${moeda(d)} ${paga ? "a pagar" : "a receber"}` };
    }
    const aMais = -d;
    const juros =
      paga &&
      formaBanco === "boleto" &&
      ((t.lado === "imposto" && aMais <= t.liquido * 0.25) || (t.forma === "boleto" && t.origem !== "fatura" && aMais <= t.liquido * 0.03));
    if (juros) return { ok: true, tom: "text-amber-700", texto: "juros e multa" };
    return { ok: false, tom: "text-muted-foreground", texto: "sozinho não fecha: some com outro" };
  };
  const alternar = (id: string) => setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  let rodape: React.ReactNode;
  let pode = false;
  if (escolhidos.length === 0) {
    rodape = <span className="text-muted-foreground">Marque o título desta linha, ou mais de um que some {moeda(alvo)}.</span>;
  } else if (escolhidos.length === 1) {
    const s = sozinho(escolhidos[0]);
    pode = s.ok;
    rodape = s.ok ? (
      <span className="text-muted-foreground">
        {escolhidos[0].ref}: {s.texto}.
      </span>
    ) : (
      <span className="font-semibold text-california-red">
        O banco {paga ? "pagou" : "recebeu"} {moeda(r2(alvo - escolhidos[0].liquido))} a mais que {escolhidos[0].ref}, e a
        diferença não é juros de boleto ou de guia: não é este título, ou a linha {paga ? "paga" : "recebe"} mais de um.
        Marque os outros.
      </span>
    );
  } else {
    const d = r2(alvo - soma);
    pode = d === 0;
    rodape = pode ? (
      <span className="text-muted-foreground">A soma dos {escolhidos.length} bate com a linha do banco.</span>
    ) : (
      <span className="font-semibold text-amber-800">
        Soma {moeda(soma)} de {moeda(alvo)}: {d > 0 ? `faltam ${moeda(d)}` : `passa ${moeda(-d)}`}. Com mais de um título, a
        soma tem de bater centavo a centavo.
      </span>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle>Escolher o título desta linha</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {dataBR(r.mov.data)} · {r.mov.historico.replace(/\s{2,}.*$/, "")} · {moeda(alvo)}
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por título, fornecedor ou PP..."
          className="h-9 w-full rounded-lg border border-border px-3 text-sm focus:border-california-red focus:outline-none"
        />
        <p className="text-[11.5px] text-muted-foreground">
          O valor mais perto do da linha primeiro, com a diferença ao lado. Dá para marcar mais de um título, quando a linha
          paga vários.
        </p>
        {visiveis.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum título em aberto com essa busca.
          </p>
        ) : (
          <div className="max-h-[46vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {visiveis.map((t) => {
              const marcado = marcados.includes(t.id);
              const s = sozinho(t);
              const d = r2(t.liquido - alvo);
              const l = linhaPorChave.get(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => alternar(t.id)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50", marcado && "bg-california-red/[0.04]")}
                >
                  <span
                    role="checkbox"
                    aria-checked={marcado}
                    className={cn(
                      "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      marcado ? "border-california-red bg-california-red text-white" : "border-gray-300 bg-white",
                    )}
                  >
                    {marcado && <CheckCheck className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  {l && (
                    <span
                      className={cn(
                        "inline-block shrink-0 whitespace-nowrap rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide",
                        TOM_DA_ETIQUETA[l.etiqueta.tom],
                      )}
                    >
                      {l.etiqueta.texto}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{l?.descricao ?? t.ref}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {t.contraparte} · vence {dataBR(t.vencimento)}
                    </span>
                  </span>
                  <span className="w-[104px] text-right font-mono text-xs">{moeda(t.liquido)}</span>
                  <span className="flex w-[190px] flex-col items-end gap-0.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-mono text-[11px] font-bold",
                        d === 0 ? "bg-emerald-100 text-emerald-800" : s.ok ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-700",
                      )}
                    >
                      {d === 0 ? "= linha" : `${d > 0 ? "+" : "−"} ${moeda(Math.abs(d))}`}
                    </span>
                    <span className={cn("text-right text-[10.5px] leading-tight", s.tom)}>{s.texto}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <DialogFooter className="items-center gap-3 text-[12px]">
          <span className="mr-auto min-w-[260px] flex-1">{rodape}</span>
          <Botao onClick={onFechar}>Cancelar</Botao>
          <Botao variante="verde" disabled={!pode} onClick={() => onEscolher(escolhidos)}>
            {escolhidos.length > 1 ? `Baixar e conciliar os ${escolhidos.length}` : "Abrir a baixa"}
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Conciliar em conjunto
// ---------------------------------------------------------------------------

/** A distância, em dias, que o conjunto procura em volta da baixa. */
const DIAS_DO_CONJUNTO = 7;

/**
 * Várias linhas do banco com várias baixas, quando a soma só bate no
 * conjunto: o fornecedor que recebeu as PPs em PIX de outros valores
 * (decisão 211, 28/10/2026). Cada linha do banco precisa de ao menos uma
 * baixa, e a soma tem de bater centavo a centavo.
 */
export function ConjuntoDialog({
  inicial,
  linhas,
  lancamentos,
  pending,
  erro,
  onFechar,
  onConfirmar,
}: {
  inicial: LancamentoSemLinha;
  /** As linhas do banco ainda pendentes da conta. */
  linhas: ReadonlyArray<{ id: string; data: string; valor: number; historico: string }>;
  /** As baixas que o banco não mostra. */
  lancamentos: LancamentoSemLinha[];
  pending: boolean;
  erro: string | null;
  onFechar: () => void;
  onConfirmar: (linhaIds: string[], lancamentoIds: string[]) => void;
}) {
  const [linhasMarcadas, setLinhasMarcadas] = React.useState<string[]>([]);
  const [baixasMarcadas, setBaixasMarcadas] = React.useState<string[]>([inicial.id]);
  const perto = (data: string) => Math.abs(Date.parse(data) - Date.parse(inicial.data)) <= DIAS_DO_CONJUNTO * 86_400_000;
  const mesmoSinal = (v: number) => Math.sign(v) === Math.sign(inicial.valor);
  const porData = <T extends { data: string; valor: number }>(a: T, b: T) =>
    a.data.localeCompare(b.data) || Math.abs(b.valor) - Math.abs(a.valor);
  const candidatasDoBanco = linhas.filter((l) => perto(l.data) && mesmoSinal(l.valor)).sort(porData);
  const candidatasBaixas = lancamentos.filter((l) => perto(l.data) && mesmoSinal(l.valor)).sort(porData);
  const doBanco = candidatasDoBanco.filter((l) => linhasMarcadas.includes(l.id));
  const baixas = candidatasBaixas.filter((l) => baixasMarcadas.includes(l.id));
  const somaBanco = r2(doBanco.reduce((s, l) => s + l.valor, 0));
  const somaBaixas = r2(baixas.reduce((s, l) => s + l.valor, 0));
  const diferenca = r2(somaBanco - somaBaixas);
  const alternar = (setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) =>
    setter((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  let rodape: React.ReactNode;
  let pode = false;
  if (doBanco.length === 0) {
    rodape = <span className="text-muted-foreground">Marque as linhas do banco que pagaram estas baixas.</span>;
  } else if (baixas.length < doBanco.length) {
    rodape = (
      <span className="font-semibold text-amber-800">
        Cada linha do banco precisa de ao menos uma baixa: são {doBanco.length} linhas e {baixas.length}{" "}
        {baixas.length === 1 ? "baixa" : "baixas"}.
      </span>
    );
  } else if (diferenca !== 0) {
    rodape = (
      <span className="font-semibold text-amber-800">
        Banco {moeda(Math.abs(somaBanco))} · baixas {moeda(Math.abs(somaBaixas))}:{" "}
        {Math.abs(somaBanco) > Math.abs(somaBaixas) ? `faltam ${moeda(Math.abs(diferenca))} de baixa` : `sobram ${moeda(Math.abs(diferenca))} de baixa`}. O conjunto tem de bater centavo a centavo.
      </span>
    );
  } else {
    pode = true;
    rodape = (
      <span className="text-muted-foreground">
        {doBanco.length} {doBanco.length === 1 ? "linha do banco" : "linhas do banco"} e {baixas.length}{" "}
        {baixas.length === 1 ? "baixa" : "baixas"} somam {moeda(Math.abs(somaBanco))}: batem.
      </span>
    );
  }

  const caixa = (marcado: boolean) => (
    <span
      role="checkbox"
      aria-checked={marcado}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        marcado ? "border-california-red bg-california-red text-white" : "border-gray-300 bg-white",
      )}
    >
      {marcado && <CheckCheck className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
  const vazio = (texto: string) => (
    <p className="rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted-foreground">{texto}</p>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-california-red" />
            Conciliar em conjunto
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Quando o banco pagou as baixas em linhas de outros valores, que não batem uma a uma. Marque as linhas do banco e
            as baixas do mesmo pagamento, até {DIAS_DO_CONJUNTO} dias da baixa: a soma tem de bater centavo a centavo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Linhas do banco</p>
          {candidatasDoBanco.length === 0 ? (
            vazio("Nenhuma linha do banco pendente perto desta data.")
          ) : (
            <div className="max-h-[28vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {candidatasDoBanco.map((l) => {
                const marcado = linhasMarcadas.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => alternar(setLinhasMarcadas, l.id)}
                    className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50", marcado && "bg-california-red/[0.04]")}
                  >
                    {caixa(marcado)}
                    <span className="w-[72px] shrink-0 font-mono text-xs">{dataBR(l.data)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs" title={l.historico}>
                      {l.historico.replace(/\s{2,}.*$/, "")}
                    </span>
                    <span className="w-[120px] text-right font-mono text-xs">{moeda(Math.abs(l.valor))}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Baixas que o banco não mostra</p>
          {candidatasBaixas.length === 0 ? (
            vazio("Nenhuma baixa sem linha perto desta data.")
          ) : (
            <div className="max-h-[28vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {candidatasBaixas.map((l) => {
                const marcado = baixasMarcadas.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => alternar(setBaixasMarcadas, l.id)}
                    className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50", marcado && "bg-california-red/[0.04]")}
                  >
                    {caixa(marcado)}
                    <span className="w-[72px] shrink-0 font-mono text-xs">{dataBR(l.data)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold" title={l.descricao}>
                        {l.descricao}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">{l.fornecedor ?? "—"}</span>
                    </span>
                    <span className="w-[120px] text-right font-mono text-xs">{moeda(Math.abs(l.valor))}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter className="items-center gap-3 text-[12px]">
          <span className="mr-auto min-w-[260px] flex-1">{erro ? <Erro texto={erro} /> : rodape}</span>
          <Botao onClick={onFechar}>Cancelar</Botao>
          <Botao
            variante="verde"
            disabled={!pode || pending}
            onClick={() => onConfirmar(doBanco.map((l) => l.id), baixas.flatMap((l) => l.ids))}
          >
            {pending ? "Conciliando…" : "Conciliar o conjunto"}
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cancelar a baixa que o banco não mostra
// ---------------------------------------------------------------------------

export function CancelarBaixaDialog({
  lancamento,
  pending,
  erro,
  onFechar,
  onConfirmar,
}: {
  lancamento: LancamentoSemLinha;
  pending: boolean;
  erro: string | null;
  onFechar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Cancelar a baixa</DialogTitle>
          <DialogDescription>
            {lancamento.descricao} · {dataBR(lancamento.data)} · {moeda(Math.abs(lancamento.valor))}
          </DialogDescription>
        </DialogHeader>
        <p className="text-[12.5px] text-muted-foreground">
          O banco não tem esta baixa entre as linhas importadas. Cancelar tira o lançamento do Extrato
          {lancamento.juros ? ", com os juros dele," : ""} e o título volta a aberto.
        </p>
        <div className="space-y-1">
          <label htmlFor="cancelar-motivo" className="text-xs font-semibold">
            Motivo <span className="text-california-red">*</span>
          </label>
          <textarea
            id="cancelar-motivo"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              setErroLocal(null);
            }}
            rows={2}
            placeholder="Ex.: a baixa foi feita na conta errada"
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        <DialogFooter className="items-center gap-2">
          <Erro texto={erro ?? erroLocal} />
          <Botao onClick={onFechar}>Voltar</Botao>
          <Botao
            variante="vermelho"
            disabled={pending}
            onClick={() => {
              if (motivo.trim().length < 10) {
                setErroLocal("Explique o motivo em pelo menos 10 caracteres.");
                return;
              }
              onConfirmar(motivo.trim());
            }}
          >
            {pending ? "Cancelando…" : "Cancelar a baixa"}
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Lembrar como regra
// ---------------------------------------------------------------------------

/** O começo do histórico que vira o padrão: as três primeiras palavras, sem
 *  os números (o protótipo: `padrao` em `lancarAvulso`). */
export function padraoDoHistorico(historico: string): string {
  return normalizar(historico.replace(/\s{2,}.*$/, ""))
    .split(" ")
    .filter((p) => !/\d{3,}/.test(p))
    .slice(0, 3)
    .join(" ");
}

/** O que a regra faz: lança no centro de custo, ou transfere para outra conta. */
export type RegraEscolhida =
  | {
      modo: "lancamento";
      padrao: string;
      tipoId: string;
      subtipoId: string;
      empresaId: string;
      /** `null`: todas as regionais da empresa (o "TD" da planilha, rateado). */
      regionalId: string | null;
      todasAsContas: boolean;
    }
  | { modo: "transferencia"; padrao: string; contaDestinoId: string };

export function RegraDialog({
  historico,
  tipos,
  subtipos,
  empresas,
  regionais,
  contasDeDestino,
  inicial,
  pending,
  erro,
  onFechar,
  onConfirmar,
}: {
  historico: string;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** Empresa → nome curto. */
  empresas: Record<string, string>;
  /** As regionais ativas, de todas as empresas. */
  regionais: ReadonlyArray<{ id: string; nome: string; empresaId: string }>;
  /** As contas do mesmo CNPJ para a regra de transferência (decisão 211, A5). */
  contasDeDestino: Array<{ id: string; nome: string }>;
  inicial: { tipoId: string | null; subtipoId: string | null; empresaId: string | null };
  pending: boolean;
  erro: string | null;
  onFechar: () => void;
  onConfirmar: (regra: RegraEscolhida) => void;
}) {
  const [padrao, setPadrao] = React.useState(() => padraoDoHistorico(historico));
  const [modo, setModo] = React.useState<RegraEscolhida["modo"]>("lancamento");
  const [contaDestinoId, setContaDestinoId] = React.useState("");
  const [tipoId, setTipoId] = React.useState(inicial.tipoId ?? "");
  const [subtipoId, setSubtipoId] = React.useState(inicial.subtipoId ?? "");
  const [empresaId, setEmpresaId] = React.useState(inicial.empresaId ?? "");
  const [regionalId, setRegionalId] = React.useState("");
  const [todas, setTodas] = React.useState(false);
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const subtiposDoTipo = subtipos.filter((s) => s.tipo_id === tipoId && s.ativo);
  const regionaisDaEmpresa = regionais.filter((r) => r.empresaId === empresaId);
  const casa = normalizar(historico).startsWith(normalizar(padrao));
  const select = "h-9 w-full rounded-lg border border-border bg-white px-2 text-sm focus:border-california-red focus:outline-none";
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" />
            Lembrar como regra
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{historico}</DialogDescription>
        </DialogHeader>
        <p className="text-[12.5px] text-muted-foreground">
          As próximas linhas do banco cujo histórico começa assim vão para “Pelas regras do histórico”:{" "}
          {modo === "lancamento"
            ? "lançadas com o centro de custo e a empresa escolhidos aqui."
            : "cada uma vira transferência entre esta conta e a de destino, no sentido do banco — a saída vai para a outra conta, a entrada vem dela."}
        </p>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="regra-modo" checked={modo === "lancamento"} onChange={() => setModo("lancamento")} className="accent-california-red" />
            Lança no centro de custo
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="regra-modo" checked={modo === "transferencia"} onChange={() => setModo("transferencia")} className="accent-california-red" />
            Transfere para outra conta
          </label>
        </div>
        <div className="space-y-1">
          <label htmlFor="regra-padrao" className="text-xs font-semibold">
            O histórico começa por <span className="text-california-red">*</span>
          </label>
          <input
            id="regra-padrao"
            value={padrao}
            onChange={(e) => {
              setPadrao(e.target.value);
              setErroLocal(null);
            }}
            className="h-9 w-full rounded-lg border border-border px-3 font-mono text-sm uppercase focus:border-california-red focus:outline-none"
          />
          {!casa && <p className="text-[11px] text-california-red">O histórico desta linha não começa assim.</p>}
        </div>
        {modo === "transferencia" ? (
          <div className="space-y-1">
            <label htmlFor="regra-destino" className="text-xs font-semibold">
              Conta de destino <span className="text-california-red">*</span>
            </label>
            <select id="regra-destino" value={contaDestinoId} onChange={(e) => setContaDestinoId(e.target.value)} className={select}>
              <option value="">Escolha…</option>
              {contasDeDestino.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">A aplicação e o resgate automáticos: a conta de investimento do mesmo CNPJ.</p>
          </div>
        ) : (
          <>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="regra-tipo" className="text-xs font-semibold">
              Centro de custo <span className="text-california-red">*</span>
            </label>
            <select
              id="regra-tipo"
              value={tipoId}
              onChange={(e) => {
                setTipoId(e.target.value);
                setSubtipoId("");
              }}
              className={select}
            >
              <option value="">Escolha…</option>
              {tipos
                .filter((t) => t.ativo)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.codigo} · {t.nome}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="regra-subtipo" className="text-xs font-semibold">
              Subtipo <span className="text-california-red">*</span>
            </label>
            <select id="regra-subtipo" value={subtipoId} onChange={(e) => setSubtipoId(e.target.value)} className={select} disabled={!tipoId}>
              <option value="">Escolha…</option>
              {subtiposDoTipo.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="regra-empresa" className="text-xs font-semibold">
            Empresa <span className="text-california-red">*</span>
          </label>
          <select
            id="regra-empresa"
            value={empresaId}
            onChange={(e) => {
              setEmpresaId(e.target.value);
              setRegionalId("");
            }}
            className={select}
          >
            <option value="">Escolha…</option>
            {Object.entries(empresas)
              .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
              .map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="regra-regional" className="text-xs font-semibold">
            Regional
          </label>
          <select
            id="regra-regional"
            value={regionalId}
            onChange={(e) => setRegionalId(e.target.value)}
            className={select}
            disabled={!empresaId}
          >
            <option value="">Todas (TD, pelo rateio)</option>
            {regionaisDaEmpresa.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} className="h-4 w-4 accent-california-red" />
          Vale para todas as contas
        </label>
          </>
        )}
        <DialogFooter className="items-center gap-2">
          <Erro texto={erro ?? erroLocal} />
          <Botao onClick={onFechar}>Agora não</Botao>
          <Botao
            variante="verde"
            disabled={pending}
            onClick={() => {
              if (normalizar(padrao).length < 3) return setErroLocal("O começo do histórico precisa ter pelo menos 3 letras.");
              if (!casa) return setErroLocal("O histórico desta linha não começa assim.");
              if (modo === "transferencia") {
                if (!contaDestinoId) return setErroLocal("Escolha a conta de destino.");
                return onConfirmar({ modo, padrao: normalizar(padrao), contaDestinoId });
              }
              if (!tipoId || !subtipoId || !empresaId) return setErroLocal("Escolha o centro de custo, o subtipo e a empresa.");
              onConfirmar({
                modo,
                padrao: normalizar(padrao),
                tipoId,
                subtipoId,
                empresaId,
                regionalId: regionalId || null,
                todasAsContas: todas,
              });
            }}
          >
            <Wand2 className="h-4 w-4" />
            {pending ? "Criando…" : "Criar a regra"}
          </Botao>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
