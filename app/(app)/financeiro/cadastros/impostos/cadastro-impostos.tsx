"use client";

/**
 * Cadastros do Financeiro › Impostos (módulo fiscal, entrega 1 — 02/10/2026),
 * como no protótipo aprovado: abas CNPJs emissores, CNAEs e alíquotas,
 * Vencimentos, Feriados e Parâmetros. As edições abrem os diálogos de
 * `dialogos.tsx` e gravam pelas Server Actions de `actions.ts`.
 */

import * as React from "react";
import { CalendarDays, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarCnpj, regimeDaPJ, type CadastroFiscal } from "@/lib/fiscal/cadastro";
import { dataBr } from "@/lib/fiscal/datas";
import type { FiscalCnae, FiscalEstabelecimento, FiscalFeriado, RegraDeVencimentoFiscal } from "@/lib/types";
import {
  dataCurta,
  diaDaSemana,
  juntarNomes,
  LINHA_DIA_PIS_COFINS,
  LINHA_DIA_RETENCOES,
  linhasDeCnae,
  moeda,
  parametroNaTela,
  parametrosNaTela,
  pct,
  valorNaData,
  type ParametroNaTela,
} from "./montagem";
import {
  EditarCnaeDialog,
  EstabelecimentoDialog,
  NovoCnaeDialog,
  Nota,
  NovoFeriadoDialog,
  ParametroDialog,
  RemoverFeriadoDialog,
} from "./dialogos";

export interface EmpresaDoCadastro {
  id: string;
  razao_social: string;
  /** Nome fantasia ou, sem ele, a razão social. */
  nome: string;
  cnpj: string;
  /** Só as ativas entram na lista do "Novo CNPJ emissor". */
  ativo: boolean;
}

type Aba = "cnpjs" | "cnaes" | "vencimentos" | "feriados" | "parametros";

interface Props {
  cadastro: CadastroFiscal;
  empresas: EmpresaDoCadastro[];
  /** Hoje no fuso da casa, vindo do servidor (a tela e o servidor concordam). */
  hoje: string;
}

/** O que a tela precisa saber de cada PJ (empresa contábil com CNPJ emissor). */
interface PJ {
  empresa: EmpresaDoCadastro;
  matriz: FiscalEstabelecimento | null;
  estabelecimentos: FiscalEstabelecimento[];
  regime: "lucro_real" | "lucro_presumido";
  regimeCaixa: boolean;
}

export function CadastroImpostos({ cadastro, empresas, hoje }: Props) {
  const [aba, setAba] = React.useState<Aba>("cnpjs");

  const empresaPorId = React.useMemo(() => new Map(empresas.map((e) => [e.id, e])), [empresas]);

  const pjs = React.useMemo<PJ[]>(() => {
    const out: PJ[] = [];
    for (const e of cadastro.estabelecimentos) {
      let pj = out.find((p) => p.empresa.id === e.empresa_contabil_id);
      if (!pj) {
        const empresa = empresaPorId.get(e.empresa_contabil_id) ?? {
          id: e.empresa_contabil_id,
          razao_social: e.nome,
          nome: e.nome,
          cnpj: "",
          ativo: false,
        };
        const { regime, regime_caixa } = regimeDaPJ(cadastro, e.empresa_contabil_id, hoje);
        pj = { empresa, matriz: null, estabelecimentos: [], regime, regimeCaixa: regime_caixa };
        out.push(pj);
      }
      pj.estabelecimentos.push(e);
      if (e.papel === "matriz" && !pj.matriz) pj.matriz = e;
    }
    return out;
  }, [cadastro, empresaPorId, hoje]);

  const pjDoEstab = React.useCallback(
    (e: FiscalEstabelecimento) => pjs.find((p) => p.empresa.id === e.empresa_contabil_id)!,
    [pjs],
  );

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex items-center gap-1 border-b border-border">
        <TabButton active={aba === "cnpjs"} onClick={() => setAba("cnpjs")}>CNPJs emissores</TabButton>
        <TabButton active={aba === "cnaes"} onClick={() => setAba("cnaes")}>CNAEs e alíquotas</TabButton>
        <TabButton active={aba === "vencimentos"} onClick={() => setAba("vencimentos")}>Vencimentos</TabButton>
        <TabButton active={aba === "feriados"} onClick={() => setAba("feriados")}>Feriados</TabButton>
        <TabButton active={aba === "parametros"} onClick={() => setAba("parametros")}>Parâmetros</TabButton>
      </div>
      {aba === "cnpjs" && <Cnpjs cadastro={cadastro} empresas={empresas} hoje={hoje} pjDoEstab={pjDoEstab} />}
      {aba === "cnaes" && <Cnaes cadastro={cadastro} hoje={hoje} pjDoEstab={pjDoEstab} />}
      {aba === "vencimentos" && <Vencimentos cadastro={cadastro} hoje={hoje} pjs={pjs} pjDoEstab={pjDoEstab} />}
      {aba === "feriados" && <Feriados cadastro={cadastro} pjs={pjs} />}
      {aba === "parametros" && <Parametros cadastro={cadastro} hoje={hoje} pjs={pjs} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças de tela (as mesmas classes das telas do financeiro)
// ---------------------------------------------------------------------------

const th = "px-3 py-3 font-semibold";

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:text-california-red",
        active ? "border-california-red text-california-red" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Chip({ ativo, onClick, label, count }: { ativo: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo ? "border-california-red bg-california-red text-white" : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
      {count !== undefined && <span className={cn("tabular-nums", ativo ? "text-white/85" : "text-muted-foreground/70")}>{count}</span>}
    </button>
  );
}

type Tom = "ambar" | "verde" | "cinza" | "azul" | "rosa" | "grafite";

function Pilula({ tom, children, className }: { tom: Tom; children: React.ReactNode; className?: string }) {
  const cls = {
    ambar: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
    verde: "border-emerald-200 bg-emerald-50 text-emerald-700",
    cinza: "border-border bg-muted text-muted-foreground",
    azul: "border-sky-200 bg-sky-50 text-sky-700",
    rosa: "border-rose-200 bg-rose-50 text-rose-700",
    grafite: "border-slate-300 bg-slate-100 text-slate-700",
  }[tom];
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", cls, className)}>
      {children}
    </span>
  );
}

function BotaoNovo({ rotulo, onClick }: { rotulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
    >
      <Plus className="h-4 w-4" />
      {rotulo}
    </button>
  );
}

function BotaoLapis({ rotulo, onClick }: { rotulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-california-red hover:text-california-red"
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}

const ROTULO_REGRA: Record<RegraDeVencimentoFiscal, string> = {
  antecipa: "Antecipa",
  prorroga: "Prorroga",
  ultimo_util: "Último dia útil",
};
const TOM_REGRA: Record<RegraDeVencimentoFiscal, Tom> = { antecipa: "rosa", prorroga: "azul", ultimo_util: "grafite" };

function textoDoRegime(pj: PJ) {
  if (pj.regime === "lucro_presumido") return pj.regimeCaixa ? "Lucro Presumido · regime de caixa" : "Lucro Presumido";
  return "Lucro Real trimestral";
}

/** O parâmetro de hoje, com o padrão da carga quando faltar. */
function parametro(cadastro: CadastroFiscal, chave: string, hoje: string, padrao: number) {
  return valorNaData(cadastro.parametros, chave, hoje) ?? padrao;
}

// ---------------------------------------------------------------------------
// Aba CNPJs emissores
// ---------------------------------------------------------------------------

function Cnpjs({
  cadastro,
  empresas,
  hoje,
  pjDoEstab,
}: {
  cadastro: CadastroFiscal;
  empresas: EmpresaDoCadastro[];
  hoje: string;
  pjDoEstab: (e: FiscalEstabelecimento) => PJ;
}) {
  const [editando, setEditando] = React.useState<FiscalEstabelecimento | null>(null);
  const [criando, setCriando] = React.useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Um CNPJ por estabelecimento que emite nota. A filial fica ligada à empresa contábil da matriz e usa as contas bancárias dela.
        </p>
        <BotaoNovo rotulo="Novo CNPJ emissor" onClick={() => setCriando(true)} />
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className={cn(th, "w-[20%]")}>Estabelecimento</th>
              <th className={cn(th, "w-[14%]")}>CNPJ</th>
              <th className={cn(th, "w-[14%]")}>Empresa contábil</th>
              <th className={cn(th, "w-[12%]")}>Município</th>
              <th className={cn(th, "w-[15%]")}>Regime</th>
              <th className={cn(th, "w-[16%]")}>Impostos federais</th>
              <th className={cn(th, "w-[5%] text-center")}>CNAEs</th>
              <th className={cn(th, "w-[4%]")} />
            </tr>
          </thead>
          <tbody>
            {cadastro.estabelecimentos.map((e) => {
              const pj = pjDoEstab(e);
              const temFiliais = pj.estabelecimentos.some((x) => x.papel === "filial");
              const federais =
                e.papel === "filial"
                  ? `Pela matriz (${pj.matriz?.municipio ?? "—"}), numa guia só`
                  : temFiliais
                    ? "Pela matriz, somando as filiais"
                    : "Pela matriz";
              return (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                  <td className="px-3 py-3">
                    <span className="font-semibold">{e.nome}</span>{" "}
                    <Pilula tom={e.papel === "matriz" ? "grafite" : "cinza"} className="ml-1">
                      {e.papel === "matriz" ? "Matriz" : "Filial"}
                    </Pilula>
                    {!e.ativo && (
                      <Pilula tom="ambar" className="ml-1">
                        Inativo
                      </Pilula>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">
                    {e.cnpj ? formatarCnpj(e.cnpj) : <span className="font-sans font-semibold text-amber-700">CNPJ a informar</span>}
                  </td>
                  <td className="px-3 py-3 text-xs">{pj.empresa.razao_social}</td>
                  <td className="px-3 py-3 text-xs">
                    {e.municipio}-{e.uf}
                  </td>
                  <td className="px-3 py-3 text-xs">{textoDoRegime(pj)}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{federais}</td>
                  <td className="px-3 py-3 text-center font-mono text-xs">{linhasDeCnae(cadastro.cnaes, e.id, hoje).length}</td>
                  <td className="px-2 py-3 text-center">
                    <BotaoLapis rotulo="Editar CNPJ emissor" onClick={() => setEditando(e)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editando && (
        <EstabelecimentoDialog
          estab={editando}
          razaoSocial={pjDoEstab(editando).empresa.razao_social}
          onClose={() => setEditando(null)}
        />
      )}
      {criando && <EstabelecimentoDialog estab={null} empresas={empresas} cadastro={cadastro} onClose={() => setCriando(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba CNAEs e alíquotas
// ---------------------------------------------------------------------------

function Cnaes({
  cadastro,
  hoje,
  pjDoEstab,
}: {
  cadastro: CadastroFiscal;
  hoje: string;
  pjDoEstab: (e: FiscalEstabelecimento) => PJ;
}) {
  const [sel, setSel] = React.useState<string | null>(cadastro.estabelecimentos[0]?.id ?? null);
  const [editando, setEditando] = React.useState<FiscalCnae | null>(null);
  const [criando, setCriando] = React.useState(false);
  const e = cadastro.estabelecimentos.find((x) => x.id === sel) ?? null;
  if (!e) {
    return <p className="text-sm text-muted-foreground">Nenhum CNPJ emissor cadastrado.</p>;
  }
  const pj = pjDoEstab(e);
  const presumido = pj.regime === "lucro_presumido";
  const linhas = linhasDeCnae(cadastro.cnaes, e.id, hoje);
  const csll = parametro(cadastro, "csll", hoje, 9);
  const irpj = parametro(cadastro, "irpj", hoje, 15);
  const base = presumido ? "s/ base" : "s/ lucro";

  const presuncao = parametro(cadastro, "presuncao_servicos", hoje, 32);
  const presuncaoLc224 = parametro(cadastro, "presuncao_lc224", hoje, 35.2);
  const limiteLc224 = parametro(cadastro, "lc224_limite_trimestre", hoje, 1250000);
  const adicional = parametro(cadastro, "irpj_adicional", hoje, 10);
  const limiteTrimestre = parametro(cadastro, "irpj_adicional_limite_mes", hoje, 20000) * 3;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">CNPJ</span>
          {cadastro.estabelecimentos.map((x) => (
            <Chip key={x.id} ativo={sel === x.id} onClick={() => setSel(x.id)} label={x.nome} count={linhasDeCnae(cadastro.cnaes, x.id, hoje).length} />
          ))}
        </div>
        <BotaoNovo rotulo="Novo CNAE" onClick={() => setCriando(true)} />
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className={cn(th, "w-[13%] text-left")}>CNAE</th>
              <th className={cn(th, "w-[33%] text-left")}>Descrição</th>
              <th className={cn(th, "w-[6%]")}>ISS</th>
              <th className={cn(th, "w-[6%]")}>PIS</th>
              <th className={cn(th, "w-[7%]")}>COFINS</th>
              <th className={cn(th, "w-[9%]")}>CSLL</th>
              <th className={cn(th, "w-[9%]")}>IRPJ</th>
              <th className={cn(th, "w-[8%]")}>Crédito</th>
              <th className={cn(th, "w-[6%]")}>Desde</th>
              <th className={cn(th, "w-[3%]")} />
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nenhum CNAE cadastrado neste CNPJ.
                </td>
              </tr>
            )}
            {linhas.flatMap((l) =>
              [...(l.vigente ? [l.vigente] : []), ...l.programadas].map((c) => {
                const programada = c.vigencia_inicio > hoje;
                return (
                  <tr
                    key={c.id}
                    className={cn(
                      "border-b border-border last:border-0 hover:bg-accent/40",
                      !presumido && c.cumulativo && "bg-amber-50/40",
                      programada && "bg-sky-50/40",
                    )}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold">
                      {c.codigo}
                      {c.subitem && <span className="block font-sans text-[10.5px] font-semibold text-muted-foreground">subitem {c.subitem}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{c.descricao}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">
                      {c.aliquota_iss === null ? <span className="text-muted-foreground">—</span> : pct(c.aliquota_iss)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">{pct(c.aliquota_pis)}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">{pct(c.aliquota_cofins)}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">
                      {pct(csll)} {base}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-xs">
                      {pct(irpj)} {base}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {presumido ? (
                        <Pilula tom="cinza">Cumulativo</Pilula>
                      ) : c.cumulativo ? (
                        <Pilula tom="ambar">Sem crédito</Pilula>
                      ) : (
                        <Pilula tom="verde">Dá crédito</Pilula>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-[11px] text-muted-foreground">
                      {dataCurta(c.vigencia_inicio)}
                      {programada && <span className="block font-sans text-[10px] font-semibold text-sky-700">programada</span>}
                      {!programada && c.vigencia_fim && <span className="block font-sans text-[10px]">até {dataCurta(c.vigencia_fim)}</span>}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {c.vigencia_fim === null && <BotaoLapis rotulo="Editar alíquotas" onClick={() => setEditando(c)} />}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {presumido ? (
        <Nota tom="azul">
          {pj.empresa.nome} · Lucro Presumido pelo regime de caixa: CSLL e IRPJ incidem sobre a base presumida de {pct(presuncao)} do que foi
          recebido no trimestre ({pct(presuncaoLc224)} sobre o que passar de {moeda(limiteLc224)} no trimestre, pela LC 224/2025), com o adicional
          de {pct(adicional)} só sobre o que passar de {moeda(limiteTrimestre)} de base. A planilha aplicava o adicional sobre a base inteira.
        </Nota>
      ) : (
        <Nota tom="azul">
          Lucro Real: CSLL e IRPJ incidem sobre o lucro bruto do trimestre (receita líquida − custo líquido dos créditos), com o adicional de{" "}
          {pct(adicional)} sobre o que passar de {moeda(limiteTrimestre)} no trimestre. O subitem 12.08 do 82.30-0-01 tem PIS e COFINS reduzidos e
          não dá crédito sobre os custos do job.
        </Nota>
      )}
      {editando && (
        <EditarCnaeDialog cnae={editando} estab={e} presumido={presumido} hoje={hoje} onClose={() => setEditando(null)} />
      )}
      {criando && <NovoCnaeDialog estab={e} presumido={presumido} hoje={hoje} onClose={() => setCriando(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Vencimentos
// ---------------------------------------------------------------------------

/** O que o lápis de uma linha abre: o CNPJ emissor (ISS) ou o dia de um federal. */
type EdicaoDoVencimento = { tipo: "cnpj"; estab: FiscalEstabelecimento } | { tipo: "dia"; dia: DiaFederal };

type DiaFederal = "pis_cofins" | "retencoes";

interface LinhaDeVencimento {
  chave: string;
  tributo: string;
  quem: string;
  dia: string;
  /** Dias novos com vigência futura (só os federais têm; nas outras linhas, vazio). */
  programados: Array<{ data: string; dia: number }>;
  base: string;
  regra: RegraDeVencimentoFiscal;
  obs?: string | null;
  /** Nulo no IRPJ e na CSLL: o último dia útil é da lei. */
  edicao: EdicaoDoVencimento | null;
}

/** Sem CNPJ, a linha só avisa que falta informar; com CNPJ, vale a observação do cadastro. */
function observacaoDoVencimento(e: FiscalEstabelecimento) {
  if (!e.cnpj) return "CNPJ a informar";
  return e.observacao;
}

function Vencimentos({
  cadastro,
  hoje,
  pjs,
  pjDoEstab,
}: {
  cadastro: CadastroFiscal;
  hoje: string;
  pjs: PJ[];
  pjDoEstab: (e: FiscalEstabelecimento) => PJ;
}) {
  const [editando, setEditando] = React.useState<EdicaoDoVencimento | null>(null);
  const diaPisCofins = parametro(cadastro, "pis_cofins_dia", hoje, 25);
  const diaRetencoes = parametro(cadastro, "retencoes_dia", hoje, 20);
  const matrizes = juntarNomes(pjs.map((p) => p.empresa.nome));
  const deTodas = matrizes ? `de todas as matrizes (${matrizes})` : "de todas as matrizes";
  const historico = "O dia novo vale a partir da data; o atual fica no histórico, e as apurações de antes da data continuam com o dia da época.";

  // Os dois dias são parâmetros com vigência, um só para o grupo (não por PJ):
  // o lápis abre a mesma edição da aba Parâmetros. Sem a linha no banco, sem lápis.
  const diasFederais: Record<DiaFederal, { item: ParametroNaTela | null; nota: string }> = {
    pis_cofins: {
      item: parametroNaTela(cadastro.parametros, hoje, LINHA_DIA_PIS_COFINS),
      nota: `O mesmo dia vale para o PIS e a COFINS ${deTodas}. ${historico}`,
    },
    retencoes: {
      item: parametroNaTela(cadastro.parametros, hoje, LINHA_DIA_RETENCOES),
      nota: `O mesmo dia vale para as duas guias de retenção (DARF 5952, de PIS/COFINS/CSLL, e DARF 1708, de IRRF) ${deTodas}. ${historico}`,
    },
  };
  const programados = (dia: DiaFederal) => {
    const item = diasFederais[dia].item;
    if (!item) return [];
    const chave = item.linha.campos[0].chave;
    return item.programados.map((p) => ({ data: p.data, dia: p.valores[chave] }));
  };
  const edicaoDoDia = (dia: DiaFederal): EdicaoDoVencimento | null => (diasFederais[dia].item ? { tipo: "dia", dia } : null);

  const linhas: LinhaDeVencimento[] = [
    ...cadastro.estabelecimentos.map((e) => ({
      chave: `iss-${e.id}`,
      tributo: "ISS próprio",
      quem: e.nome,
      dia: String(e.iss_dia),
      programados: [],
      base: "mês seguinte à emissão da nota",
      regra: e.iss_regra,
      obs: observacaoDoVencimento(e),
      edicao: { tipo: "cnpj" as const, estab: e },
    })),
    ...cadastro.estabelecimentos.map((e) => ({
      chave: `iss-retido-${e.id}`,
      tributo: "ISS retido de fornecedores",
      quem: e.nome,
      dia: String(e.iss_retido_dia),
      programados: [],
      base: "mês seguinte à emissão da NF do fornecedor",
      regra: e.iss_regra,
      obs: observacaoDoVencimento(e),
      edicao: { tipo: "cnpj" as const, estab: e },
    })),
    ...pjs.map((p) => ({
      chave: `pis-cofins-${p.empresa.id}`,
      tributo: "PIS e COFINS",
      quem: `${p.empresa.nome} (matriz)`,
      dia: String(diaPisCofins),
      programados: programados("pis_cofins"),
      base: p.regimeCaixa ? "mês seguinte ao recebimento" : "mês seguinte à emissão da nota",
      regra: "antecipa" as const,
      edicao: edicaoDoDia("pis_cofins"),
    })),
    ...pjs.map((p) => ({
      chave: `irpj-csll-${p.empresa.id}`,
      tributo: "IRPJ e CSLL (3 cotas)",
      quem: `${p.empresa.nome} (matriz)`,
      dia: "último dia útil",
      programados: [],
      base: p.regimeCaixa ? "cada mês do trimestre seguinte ao recebimento" : "cada mês do trimestre seguinte",
      regra: "ultimo_util" as const,
      edicao: null,
    })),
    {
      chave: "csrf",
      tributo: "PIS/COFINS/CSLL retidos (DARF 5952)",
      quem: `${matrizes} (matriz)`,
      dia: String(diaRetencoes),
      programados: programados("retencoes"),
      base: "mês seguinte ao pagamento do fornecedor",
      regra: "antecipa",
      edicao: edicaoDoDia("retencoes"),
    },
    {
      chave: "irrf",
      tributo: "IRRF retido (DARF 1708)",
      quem: `${matrizes} (matriz)`,
      dia: String(diaRetencoes),
      programados: programados("retencoes"),
      base: "mês seguinte ao pagamento do fornecedor",
      regra: "antecipa",
      edicao: edicaoDoDia("retencoes"),
    },
  ];
  const diaEmEdicao = editando?.tipo === "dia" ? diasFederais[editando.dia] : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className={cn(th, "w-[24%]")}>Imposto</th>
              <th className={cn(th, "w-[20%]")}>Quem paga</th>
              <th className={cn(th, "w-[10%] text-center")}>Dia</th>
              <th className={cn(th, "w-[21%]")}>A partir de</th>
              <th className={cn(th, "w-[11%] text-center")}>Dia não útil</th>
              <th className={cn(th, "w-[11%]")}>Observação</th>
              <th className={cn(th, "w-[3%]")} />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className="border-b border-border last:border-0 hover:bg-accent/40">
                <td className="px-3 py-2.5 font-semibold">{l.tributo}</td>
                <td className="px-3 py-2.5 text-xs">{l.quem}</td>
                <td className="px-3 py-2.5 text-center font-mono text-xs">
                  {l.dia}
                  {l.programados.map((p) => (
                    <span key={p.data} className="mt-0.5 block font-sans text-[10.5px] font-semibold text-sky-700">
                      a partir de {dataBr(p.data)}: {p.dia}
                    </span>
                  ))}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.base}</td>
                <td className="px-3 py-2.5 text-center">
                  <Pilula tom={TOM_REGRA[l.regra]}>{ROTULO_REGRA[l.regra]}</Pilula>
                </td>
                <td className="px-3 py-2.5 text-[11.5px] text-amber-700">{l.obs ?? ""}</td>
                <td className="px-2 py-2.5 text-center">
                  {l.edicao && (
                    <BotaoLapis
                      rotulo={l.edicao.tipo === "cnpj" ? "Editar CNPJ emissor" : "Alterar dia do vencimento"}
                      onClick={() => setEditando(l.edicao)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Nota tom="ambar">
        Em dia não útil, os impostos federais <b>antecipam</b> para o dia útil anterior (PIS/COFINS no dia {diaPisCofins}, retenções no dia{" "}
        {diaRetencoes}); pagar no dia seguinte gera multa de 0,33% ao dia. O ISS de Salvador, São Paulo e Fortaleza <b>prorroga</b> para o dia útil
        seguinte. IRPJ e CSLL vencem no último dia útil de cada mês. Dá para trocar o dia pelo lápis da linha, se a contabilidade orientar
        diferente: no ISS, o dia e a regra ficam no CNPJ emissor; no PIS/COFINS e nas retenções, o dia novo vale a partir de uma data, e a
        antecipação, que é da lei, não muda.
      </Nota>
      {editando?.tipo === "cnpj" && (
        <EstabelecimentoDialog
          estab={editando.estab}
          razaoSocial={pjDoEstab(editando.estab).empresa.razao_social}
          onClose={() => setEditando(null)}
        />
      )}
      {diaEmEdicao?.item && (
        <ParametroDialog
          item={diaEmEdicao.item}
          parametros={cadastro.parametros}
          hoje={hoje}
          nota={diaEmEdicao.nota}
          diaNaoUtil={ROTULO_REGRA.antecipa}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Feriados
// ---------------------------------------------------------------------------

function Feriados({ cadastro, pjs }: { cadastro: CadastroFiscal; pjs: PJ[] }) {
  const [criando, setCriando] = React.useState(false);
  const [removendo, setRemovendo] = React.useState<FiscalFeriado | null>(null);

  const nacionais = cadastro.feriados.filter((f) => f.municipio === null);
  // As cidades dos CNPJs emissores, na ordem do cadastro, e as que só têm feriado.
  const cidades: string[] = [];
  for (const e of cadastro.estabelecimentos) if (!cidades.includes(e.municipio)) cidades.push(e.municipio);
  for (const f of cadastro.feriados) if (f.municipio && !cidades.includes(f.municipio)) cidades.push(f.municipio);
  const cidadesDosCnpjs = Array.from(new Set(cadastro.estabelecimentos.map((e) => e.municipio)));

  // "Salvador para California e Hitlab, Santo André para GoCrazy".
  const porCidadeDaMatriz = new Map<string, string[]>();
  for (const p of pjs) {
    const cidade = p.matriz?.municipio;
    if (!cidade) continue;
    porCidadeDaMatriz.set(cidade, [...(porCidadeDaMatriz.get(cidade) ?? []), p.empresa.nome]);
  }
  const calendarioDosDarfs = Array.from(porCidadeDaMatriz.entries())
    .map(([cidade, nomes]) => `${cidade} para ${juntarNomes(nomes)}`)
    .join(", ");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <BotaoNovo rotulo="Novo feriado" onClick={() => setCriando(true)} />
      </div>
      <div className="grid grid-cols-[1.1fr_1fr] items-start gap-5">
        <div className="rounded-2xl border border-border bg-card shadow-soft">
          <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
              <CalendarDays className="h-4 w-4 text-california-red" />
              Nacionais (expediente bancário)
            </h3>
            <span className="text-[11px] text-muted-foreground">Res. CMN 4.880/2020</span>
          </header>
          <TabelaDeFeriados feriados={nacionais} onRemover={setRemovendo} />
        </div>
        <div className="space-y-4">
          {cidades.map((c) => (
            <div key={c} className="rounded-2xl border border-border bg-card shadow-soft">
              <header className="flex items-center justify-between border-b border-border px-5 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
                  <Landmark className="h-4 w-4 text-muted-foreground" />
                  {c}
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {cadastro.estabelecimentos
                    .filter((e) => e.municipio === c)
                    .map((e) => e.nome)
                    .join(", ")}
                </span>
              </header>
              <TabelaDeFeriados feriados={cadastro.feriados.filter((f) => f.municipio === c)} onRemover={setRemovendo} />
            </div>
          ))}
          <Nota>
            Os DARFs seguem o calendário da cidade da matriz ({calendarioDosDarfs}). O ISS segue o da cidade de cada estabelecimento.
          </Nota>
        </div>
      </div>
      {criando && <NovoFeriadoDialog cidades={cidadesDosCnpjs} onClose={() => setCriando(false)} />}
      {removendo && <RemoverFeriadoDialog feriado={removendo} onClose={() => setRemovendo(null)} />}
    </div>
  );
}

function TabelaDeFeriados({ feriados, onRemover }: { feriados: FiscalFeriado[]; onRemover: (f: FiscalFeriado) => void }) {
  if (feriados.length === 0) {
    return <p className="px-5 py-3 text-[12.5px] text-muted-foreground">Nenhum feriado cadastrado.</p>;
  }
  return (
    <table className="w-full text-[12.5px]">
      <tbody>
        {feriados.map((f) => (
          <tr key={f.id} className="group border-b border-border/70 last:border-0">
            <td className="px-5 py-1.5 font-mono">{dataBr(f.data)}</td>
            <td className="px-3 py-1.5 text-muted-foreground">{diaDaSemana(f.data)}</td>
            <td className="px-3 py-1.5">{f.nome}</td>
            <td className="w-10 px-3 py-1 text-right">
              <button
                type="button"
                onClick={() => onRemover(f)}
                aria-label={`Remover o feriado ${f.nome} de ${dataBr(f.data)}`}
                title="Remover feriado"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-california-red group-hover:text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Aba Parâmetros
// ---------------------------------------------------------------------------

function Parametros({ cadastro, hoje, pjs }: { cadastro: CadastroFiscal; hoje: string; pjs: PJ[] }) {
  const [editando, setEditando] = React.useState<ParametroNaTela | null>(null);
  const nomesNoPresumido = juntarNomes(pjs.filter((p) => p.regime === "lucro_presumido").map((p) => p.empresa.nome));
  const itens = parametrosNaTela(cadastro.parametros, hoje, nomesNoPresumido);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className={cn(th, "w-[24%]")}>Parâmetro</th>
              <th className={cn(th, "w-[26%]")}>Valor</th>
              <th className={cn(th, "w-[47%]")}>Observação</th>
              <th className={cn(th, "w-[3%]")} />
            </tr>
          </thead>
          <tbody>
            {itens.map((it) => (
              <tr key={it.linha.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5 font-semibold">{it.linha.rotulo}</td>
                <td className="px-3 py-2.5 font-mono text-xs">
                  {it.linha.valor(it.hoje)}
                  {it.programados.map((p) => (
                    <span key={p.data} className="mt-0.5 block font-sans text-[10.5px] font-semibold text-sky-700">
                      a partir de {dataBr(p.data)}: {it.linha.valor(p.valores)}
                    </span>
                  ))}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{it.linha.observacao(it.hoje)}</td>
                <td className="px-2 py-2.5 text-center">
                  <BotaoLapis rotulo="Alterar valor" onClick={() => setEditando(it)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <ParametroDialog item={editando} parametros={cadastro.parametros} hoje={hoje} onClose={() => setEditando(null)} />}
    </div>
  );
}
