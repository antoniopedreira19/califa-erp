"use client";

/**
 * Tela 3.4 — Fluxo de caixa: matriz período × natureza com drill-down.
 *
 * Design: `Fluxo de Caixa.dc.html` (projeto Claude Design `69342d83`).
 *
 * A matriz tem três colunas de passado e o horizonte à frente, e cada
 * natureza se abre em TRÊS componentes — a separação que dá sentido à
 * tela:
 *
 *   Já movimentado nas contas  → classe `movimento` (caixa efetivo)
 *   Títulos em aberto          → classe `titulo`    (documento emitido)
 *   Só previsão (abertura)     → classe `previsao`  (curva do job)
 *
 * A classe vem pronta da `vw_fluxo_caixa` (migration 20260817000006), e
 * é lá que moram as regras difíceis: o resíduo da curva de desembolso
 * abatido pelas PPs, a previsão de recebimento sobrescrita pelo envio
 * para faturamento, e a rolagem do que venceu sem virar documento. Aqui
 * não se recalcula nada disso — só se agrupa e se soma.
 *
 * DESVIOS DO PROTÓTIPO, DE PROPÓSITO:
 *
 * • O filtro DIVISÃO não existe. O conceito não existe no banco (não há
 *   tabela nem coluna de divisão em job, empresa ou lançamento) e o
 *   Tiago decidiu removê-lo em vez de inventá-lo (17/08/2026).
 * • O saldo NÃO é reconstruído a partir do saldo de hoje, como no
 *   protótipo: vem do razão, pelo saldo de partida que o servidor lê com
 *   `fc_saldos_por_conta` mais os movimentos daí em diante.
 */

import * as React from "react";
import { Info, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface FluxoItem {
  classe: "movimento" | "titulo" | "previsao";
  origem_tipo: string;
  origem_id: string;
  conta_bancaria_id: string | null;
  regional_id: string | null;
  data_evento: string;
  valor: number;
  natureza: "entrada" | "saida";
  descricao: string;
  job_id: string | null;
}

export interface ContaOpcao {
  id: string;
  nome: string;
}

interface RegionalOpcao {
  id: string;
  nome: string;
}

interface Props {
  itens: FluxoItem[];
  contas: ContaOpcao[];
  regionais: RegionalOpcao[];
  /** Saldo de cada conta na véspera da âncora — o ponto de partida. */
  saldoAncora: Record<string, number>;
  ancora: string;
  hoje: string;
}

type Nivel = "mes" | "semana" | "dia";

/** As seis células de cada período: natureza × classe. */
type Campo = "e_mov" | "e_tit" | "e_prev" | "s_mov" | "s_tit" | "s_prev";

interface Coluna {
  ini: string;
  fim: string;
  rotulo: string;
  fase: "realizado" | "curso" | "previsto";
  tag: string;
}

/** Item já somado por documento — o rateio volta a ser uma linha só. */
interface ItemAgrupado {
  chave: string;
  descricao: string;
  data_evento: string;
  valor: number;
  conta_bancaria_id: string | null;
  regionais: string[];
  coluna: number;
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

const DIA_MS = 86_400_000;

function paraMs(iso: string): number {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

function paraIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dd(iso: string) {
  return iso.slice(8, 10);
}
function mm(iso: string) {
  return iso.slice(5, 7);
}
function aaaa(iso: string) {
  return iso.slice(0, 4);
}

function formatarDataBR(iso: string): string {
  return `${dd(iso)}/${mm(iso)}/${aaaa(iso)}`;
}

/** Segunda-feira da semana da data (ISO: semana começa na segunda). */
function segunda(iso: string): string {
  const ms = paraMs(iso);
  const diff = (new Date(ms).getUTCDay() + 6) % 7;
  return paraIso(ms - diff * DIA_MS);
}

function somaMeses(iso: string, n: number, dia: number): string {
  const [a, m] = iso.slice(0, 10).split("-").map(Number);
  return paraIso(Date.UTC(a, m - 1 + n, dia));
}

const PASSADOS = 3;

function montarColunas(nivel: Nivel, horizonte: number, hoje: string): Coluna[] {
  const cruas: { ini: string; fim: string; rotulo: string }[] = [];

  for (let i = -PASSADOS; i <= horizonte; i++) {
    if (nivel === "mes") {
      const ini = somaMeses(hoje, i, 1);
      const fim = somaMeses(hoje, i + 1, 0);
      cruas.push({ ini, fim, rotulo: `${mm(ini)}/${aaaa(ini)}` });
    } else if (nivel === "semana") {
      const base = paraMs(segunda(hoje));
      const ini = paraIso(base + i * 7 * DIA_MS);
      const fim = paraIso(paraMs(ini) + 6 * DIA_MS);
      cruas.push({ ini, fim, rotulo: `${dd(ini)}–${dd(fim)}/${mm(fim)}` });
    } else {
      const ini = paraIso(paraMs(hoje) + i * DIA_MS);
      cruas.push({ ini, fim: ini, rotulo: `${dd(ini)}/${mm(ini)}` });
    }
  }

  return cruas.map((c) => {
    const fase =
      c.fim < hoje ? "realizado" : c.ini > hoje ? "previsto" : "curso";
    return {
      ...c,
      fase,
      tag:
        fase === "realizado"
          ? "Realizado"
          : fase === "curso"
            ? "Em curso"
            : "Previsto",
    } as Coluna;
  });
}

// ---------------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------------

/** Sem centavos: a matriz tem muitas colunas e o centavo só atrapalha. */
function brl0(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(v);
}

const VERDE = "#1E7A50";
const VERMELHO = "#B3323C";
const TINTA = "#282828";
const CINZA = "#6b6b6b";

const COMPONENTES: { campo: Campo; rotulo: string }[][] = [
  [
    { campo: "e_mov", rotulo: "Já movimentado nas contas" },
    { campo: "e_tit", rotulo: "Títulos em aberto (a receber)" },
    { campo: "e_prev", rotulo: "Só previsão (abertura do job)" },
  ],
  [
    { campo: "s_mov", rotulo: "Já movimentado nas contas" },
    { campo: "s_tit", rotulo: "Títulos em aberto (a pagar)" },
    { campo: "s_prev", rotulo: "Só previsão (abertura do job)" },
  ],
];

function campoDe(item: FluxoItem): Campo {
  const lado = item.natureza === "entrada" ? "e_" : "s_";
  const classe =
    item.classe === "movimento" ? "mov" : item.classe === "titulo" ? "tit" : "prev";
  return `${lado}${classe}` as Campo;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function FluxoCaixaView({
  itens,
  contas,
  regionais,
  saldoAncora,
  ancora,
  hoje,
}: Props) {
  const [nivel, setNivel] = React.useState<Nivel>("mes");
  const [horizonte, setHorizonte] = React.useState(6);
  const [conta, setConta] = React.useState<string>("todas");
  const [regional, setRegional] = React.useState<string>("todas");
  // Drill-down aberto por padrão (`detalharPadrao` ON no protótipo).
  const [abertas, setAbertas] = React.useState({ entrada: true, saida: true });
  const [detalhes, setDetalhes] = React.useState<Partial<Record<Campo, boolean>>>(
    {},
  );

  const nomeRegional = React.useMemo(
    () => new Map(regionais.map((r) => [r.id, r.nome])),
    [regionais],
  );
  const nomeConta = React.useMemo(
    () => new Map(contas.map((c) => [c.id, c.nome])),
    [contas],
  );

  const colunas = React.useMemo(
    () => montarColunas(nivel, horizonte, hoje),
    [nivel, horizonte, hoje],
  );

  const dados = React.useMemo(() => {
    const primeiraIni = colunas[0].ini;
    const ultimaFim = colunas[colunas.length - 1].fim;

    // ---- saldo de partida: fato bancário, responde SÓ ao filtro de conta.
    const contasNoEscopo =
      conta === "todas" ? contas.map((c) => c.id) : [conta];
    const saldoBase = contasNoEscopo.reduce(
      (s, id) => s + (saldoAncora[id] ?? 0),
      0,
    );

    const noEscopoDeConta = (i: FluxoItem) =>
      conta === "todas" ? true : i.conta_bancaria_id === conta;

    let saldoAbertura = saldoBase;
    let saldoHoje = saldoBase;
    for (const i of itens) {
      if (i.classe !== "movimento") continue;
      if (!noEscopoDeConta(i)) continue;
      if (i.data_evento < ancora) continue;
      const sinal = i.natureza === "entrada" ? 1 : -1;
      if (i.data_evento < primeiraIni) saldoAbertura += i.valor * sinal;
      if (i.data_evento <= hoje) saldoHoje += i.valor * sinal;
    }

    // ---- filtro da matriz
    const filtrados = itens.filter((i) => {
      if (!noEscopoDeConta(i)) return false;
      if (regional !== "todas" && i.regional_id !== regional) return false;
      return i.data_evento >= primeiraIni && i.data_evento <= ultimaFim;
    });

    // ---- rateio volta a ser uma linha por documento
    const porChave = new Map<string, ItemAgrupado & { campo: Campo }>();
    for (const i of filtrados) {
      const coluna = colunas.findIndex(
        (c) => i.data_evento >= c.ini && i.data_evento <= c.fim,
      );
      if (coluna < 0) continue;
      const campo = campoDe(i);
      const chave = `${campo}|${i.origem_tipo}|${i.origem_id}|${i.data_evento}`;
      const existente = porChave.get(chave);
      if (existente) {
        existente.valor += i.valor;
        if (i.regional_id && !existente.regionais.includes(i.regional_id)) {
          existente.regionais.push(i.regional_id);
        }
      } else {
        porChave.set(chave, {
          chave,
          campo,
          descricao: i.descricao,
          data_evento: i.data_evento,
          valor: i.valor,
          conta_bancaria_id: i.conta_bancaria_id,
          regionais: i.regional_id ? [i.regional_id] : [],
          coluna,
        });
      }
    }

    // ---- células e itens por componente
    const celulas = colunas.map(
      () =>
        ({ e_mov: 0, e_tit: 0, e_prev: 0, s_mov: 0, s_tit: 0, s_prev: 0 }) as Record<
          Campo,
          number
        >,
    );
    const porCampo = new Map<Campo, ItemAgrupado[]>();
    for (const item of porChave.values()) {
      celulas[item.coluna][item.campo] += item.valor;
      const lista = porCampo.get(item.campo) ?? [];
      lista.push(item);
      porCampo.set(item.campo, lista);
    }
    for (const lista of porCampo.values()) {
      lista.sort((a, b) => a.data_evento.localeCompare(b.data_evento));
    }

    let saldo = saldoAbertura;
    const serie = celulas.map((b) => {
      const entradas = b.e_mov + b.e_tit + b.e_prev;
      const saidas = b.s_mov + b.s_tit + b.s_prev;
      const liquido = entradas - saidas;
      saldo += liquido;
      return { ...b, entradas, saidas, liquido, saldo };
    });

    return { serie, porCampo, saldoHoje };
  }, [
    itens,
    colunas,
    conta,
    regional,
    contas,
    saldoAncora,
    ancora,
    hoje,
  ]);

  const { serie, porCampo, saldoHoje } = dados;

  // Vale e pico consideram SOMENTE a projeção — o "em curso" e o que vem
  // depois. Passado não é projeção.
  const corte = Math.max(
    colunas.findIndex((c) => c.fase !== "realizado"),
    0,
  );
  const saldos = serie.map((b) => b.saldo);
  const projecao = saldos.slice(corte);
  const vale = Math.min(...projecao);
  const pico = Math.max(...projecao);
  const idxVale = corte + projecao.indexOf(vale);
  const saldoFim = saldos[saldos.length - 1] ?? 0;

  const limpar = () => {
    setNivel("mes");
    setHorizonte(6);
    setConta("todas");
    setRegional("todas");
  };

  const unidade =
    nivel === "mes" ? "meses" : nivel === "semana" ? "semanas" : "dias";

  return (
    <div className="space-y-3.5">
      {/* ---------------- Filtros: aplicam na hora, sem botão ------------- */}
      <div className="rounded-2xl border border-border bg-card shadow-soft px-[18px] py-4 flex flex-wrap items-end gap-5">
        <CampoFiltro rotulo="Nível">
          <div className="flex gap-0.5 rounded-[9px] border border-border bg-muted/40 p-[3px]">
            {(
              [
                ["mes", "Mensal"],
                ["semana", "Semanal"],
                ["dia", "Diário"],
              ] as const
            ).map(([id, texto]) => (
              <button
                key={id}
                type="button"
                onClick={() => setNivel(id)}
                className={cn(
                  "rounded-[7px] px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                  nivel === id
                    ? "bg-california-red text-white"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {texto}
              </button>
            ))}
          </div>
        </CampoFiltro>

        <CampoFiltro rotulo="Horizonte">
          <Select
            value={String(horizonte)}
            onChange={(v) => setHorizonte(Number(v))}
          >
            {[6, 9, 12].map((n) => (
              <option key={n} value={n}>
                +{n} {unidade}
              </option>
            ))}
          </Select>
        </CampoFiltro>

        <CampoFiltro rotulo="Conta bancária" className="min-w-[200px]">
          <Select value={conta} onChange={setConta}>
            <option value="todas">Todas agregadas</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        </CampoFiltro>

        <CampoFiltro rotulo="Regional">
          <Select value={regional} onChange={setRegional}>
            <option value="todas">Todas</option>
            {regionais.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </Select>
        </CampoFiltro>

        <div className="flex-1" />

        <button
          type="button"
          onClick={limpar}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-border bg-card px-3.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Limpar filtros
        </button>
      </div>

      {/* ---------------- Indicadores ------------------------------------ */}
      <div className="flex flex-wrap gap-3">
        <Kpi
          rotulo="Saldo hoje"
          valor={brl0(saldoHoje)}
          nota={
            conta === "todas"
              ? "Todas as contas ativas agregadas"
              : (nomeConta.get(conta) ?? "Conta selecionada")
          }
        />
        <Kpi
          rotulo="Saldo no fim do horizonte"
          valor={brl0(saldoFim)}
          negativo={saldoFim < 0}
          nota={`Projeção até ${colunas[colunas.length - 1]?.rotulo ?? "—"}`}
        />
        <Kpi
          rotulo="Menor saldo projetado"
          valor={brl0(vale)}
          negativo={vale < 0}
          nota={`No período ${colunas[idxVale]?.rotulo ?? "—"}`}
        />
      </div>

      {/* ---------------- Matriz ----------------------------------------- */}
      <div className="rounded-2xl border border-border bg-card shadow-soft overflow-x-auto">
        <table className="text-[13.5px]" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-card border-b border-border text-left px-4 py-3.5 min-w-[262px] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Período
              </th>
              {colunas.map((c, i) => (
                <th
                  key={c.ini}
                  className="px-4 py-2.5 text-right min-w-[126px] border-b border-border"
                  style={{ ...fundoDaFase(c.fase), ...bordaEsquerda(colunas, i) }}
                >
                  <div className="font-mono text-xs font-bold tracking-[0.02em] text-foreground">
                    {c.rotulo}
                  </div>
                  <div
                    className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.09em]"
                    style={{
                      color:
                        c.fase === "curso"
                          ? "#E74B56"
                          : c.fase === "previsto"
                            ? "#8a8a8a"
                            : CINZA,
                    }}
                  >
                    {c.tag}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {([0, 1] as const).map((lado) => {
              const chave = lado === 0 ? "entrada" : "saida";
              const rotulo = lado === 0 ? "Entradas" : "Saídas";
              const cor = lado === 0 ? VERDE : VERMELHO;
              const aberta = abertas[chave];
              return (
                <React.Fragment key={chave}>
                  <tr>
                    <th className="sticky left-0 z-10 bg-card text-left font-medium px-4 py-3 border-t border-border">
                      <button
                        type="button"
                        onClick={() =>
                          setAbertas((s) => ({ ...s, [chave]: !s[chave] }))
                        }
                        className="mr-2.5 inline-flex h-[19px] w-[19px] items-center justify-center rounded-[5px] border border-border bg-card align-middle text-[9px] font-semibold text-muted-foreground"
                        aria-label={aberta ? "Recolher" : "Expandir"}
                      >
                        {aberta ? "▾" : "▸"}
                      </button>
                      <span className="text-[13.5px] font-bold tracking-[-0.005em]">
                        {rotulo}
                      </span>
                    </th>
                    {serie.map((b, i) => (
                      <Celula
                        key={i}
                        valor={lado === 0 ? b.entradas : b.saidas}
                        colunas={colunas}
                        i={i}
                        cor={cor}
                        peso={700}
                        classe="px-4 py-3 text-[13px] border-t border-border"
                      />
                    ))}
                  </tr>

                  {aberta &&
                    COMPONENTES[lado].map(({ campo, rotulo: texto }) => {
                      const lista = porCampo.get(campo) ?? [];
                      const detalhado = !!detalhes[campo];
                      return (
                        <React.Fragment key={campo}>
                          <tr>
                            <th
                              className={cn(
                                "sticky left-0 z-10 text-left font-medium py-2.5 pl-10 pr-4",
                                detalhado ? "bg-muted/40" : "bg-card",
                              )}
                            >
                              {lista.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDetalhes((s) => ({
                                      ...s,
                                      [campo]: !s[campo],
                                    }))
                                  }
                                  className="mr-2 inline-flex h-[17px] w-[17px] items-center justify-center rounded-[5px] border border-border bg-card align-middle text-[8px] font-semibold text-muted-foreground"
                                  aria-label={detalhado ? "Recolher" : "Expandir"}
                                >
                                  {detalhado ? "▾" : "▸"}
                                </button>
                              )}
                              <span
                                className={cn(
                                  "text-[12.5px] text-muted-foreground",
                                  detalhado ? "font-semibold" : "font-normal",
                                )}
                              >
                                {texto}
                              </span>
                              {lista.length > 0 && (
                                <span className="mt-0.5 block pl-0.5 text-[10.5px] tracking-[0.01em] text-muted-foreground/70">
                                  {lista.length}{" "}
                                  {lista.length === 1 ? "item" : "itens"} ·{" "}
                                  {detalhado
                                    ? "clique para recolher"
                                    : "clique para ver quais"}
                                </span>
                              )}
                            </th>
                            {serie.map((b, i) => (
                              <Celula
                                key={i}
                                valor={b[campo]}
                                colunas={colunas}
                                i={i}
                                cor={CINZA}
                                peso={detalhado ? 600 : 400}
                                classe={cn(
                                  "px-4 py-2.5 text-[12.5px]",
                                  detalhado && "bg-muted/40",
                                )}
                              />
                            ))}
                          </tr>

                          {detalhado &&
                            lista.map((item) => (
                              <tr key={item.chave}>
                                <th className="sticky left-0 z-10 bg-muted/40 text-left font-normal py-2 pl-[66px] pr-4">
                                  <span className="text-xs text-foreground">
                                    {item.descricao}
                                  </span>
                                  <span className="mt-0.5 block text-[10.5px] text-muted-foreground/70">
                                    {formatarDataBR(item.data_evento)} ·{" "}
                                    {rotuloRegional(item.regionais, nomeRegional)}{" "}
                                    ·{" "}
                                    {item.conta_bancaria_id
                                      ? (nomeConta.get(item.conta_bancaria_id) ??
                                        "Conta removida")
                                      : "sem conta alocada"}
                                  </span>
                                </th>
                                {colunas.map((_, i) => (
                                  <td
                                    key={i}
                                    className="px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap bg-muted/40 font-mono"
                                    style={{
                                      ...bordaEsquerda(colunas, i),
                                      color:
                                        i === item.coluna ? cor : "transparent",
                                      fontWeight: i === item.coluna ? 600 : 400,
                                    }}
                                  >
                                    {i === item.coluna ? brl0(item.valor) : ""}
                                  </td>
                                ))}
                              </tr>
                            ))}
                        </React.Fragment>
                      );
                    })}
                </React.Fragment>
              );
            })}

            <tr>
              <th className="sticky left-0 z-10 bg-card text-left px-4 py-3 border-t border-border text-[13px] font-semibold">
                Líquido do período
              </th>
              {serie.map((b, i) => (
                <Celula
                  key={i}
                  valor={b.liquido}
                  colunas={colunas}
                  i={i}
                  cor={b.liquido < 0 ? VERMELHO : b.liquido > 0 ? VERDE : CINZA}
                  peso={600}
                  classe="px-4 py-3 text-[13px] border-t border-border"
                />
              ))}
            </tr>

            <tr>
              <th className="sticky left-0 z-10 bg-muted text-left px-4 py-3.5 border-t border-border text-[13.5px] font-bold">
                Saldo projetado
              </th>
              {serie.map((b, i) => (
                <td
                  key={i}
                  className="px-4 py-3.5 text-right text-[13.5px] font-bold tabular-nums whitespace-nowrap font-mono bg-muted border-t border-border"
                  style={{
                    ...bordaEsquerda(colunas, i),
                    color: b.saldo < 0 ? VERMELHO : TINTA,
                  }}
                >
                  {brl0(b.saldo)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {conta !== "todas" && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-border bg-muted/50 px-3.5 py-3">
          <Info className="mt-px h-[15px] w-[15px] flex-none text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
            Filtrando por uma conta específica, os previstos sem conta alocada
            (PPs e avulsas aprovadas) ficam de fora — a conta bancária só é
            definida no ato da baixa. Em &ldquo;Todas agregadas&rdquo; eles
            entram no bucket temporal.
          </p>
        </div>
      )}

      {/* ---------------- Curva de saldo ---------------------------------- */}
      <Curva
        saldos={saldos}
        colunas={colunas}
        corte={corte}
        hoje={hoje}
        vale={vale}
        pico={pico}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function rotuloRegional(
  ids: string[],
  nomes: Map<string, string>,
): string {
  if (ids.length === 0) return "sem regional";
  if (ids.length === 1) return nomes.get(ids[0]) ?? "regional removida";
  return `rateada em ${ids.length} regionais`;
}

function fundoDaFase(fase: Coluna["fase"]): React.CSSProperties {
  if (fase === "realizado") return { background: "rgba(246,246,246,.55)" };
  if (fase === "curso") return { background: "rgba(231,75,86,.045)" };
  return {};
}

/** A fronteira do hoje ganha a borda grossa; as demais, o fio fino. */
function bordaEsquerda(colunas: Coluna[], i: number): React.CSSProperties {
  const abreOCurso =
    colunas[i].fase === "curso" && (i === 0 || colunas[i - 1].fase !== "curso");
  return {
    borderLeft: abreOCurso
      ? "2px solid rgba(231,75,86,.35)"
      : "1px solid #f4f2f2",
  };
}

function Celula({
  valor,
  colunas,
  i,
  cor,
  peso,
  classe,
}: {
  valor: number;
  colunas: Coluna[];
  i: number;
  cor: string;
  peso: number;
  classe?: string;
}) {
  const zero = Math.abs(valor) < 0.005;
  return (
    <td
      className={cn(
        "text-right tabular-nums whitespace-nowrap font-mono",
        classe,
      )}
      style={{
        ...fundoDaFase(colunas[i].fase),
        ...bordaEsquerda(colunas, i),
        color: zero ? "#c4c4c4" : cor,
        fontWeight: peso,
      }}
    >
      {zero ? "—" : brl0(valor)}
    </td>
  );
}

function CampoFiltro({
  rotulo,
  children,
  className,
}: {
  rotulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-[7px]", className)}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </span>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-[34px] cursor-pointer rounded-[9px] border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-california-red/30"
    >
      {children}
    </select>
  );
}

function Kpi({
  rotulo,
  valor,
  nota,
  negativo,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  negativo?: boolean;
}) {
  return (
    <div className="flex min-w-[212px] flex-1 flex-col gap-1.5 rounded-2xl border border-border bg-card px-4 py-3.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </span>
      <strong
        className="text-[22px] font-bold tracking-[-0.02em] tabular-nums"
        style={{ color: negativo ? VERMELHO : TINTA }}
      >
        {valor}
      </strong>
      <span className="text-[11.5px] text-muted-foreground">{nota}</span>
    </div>
  );
}

/**
 * Curva de saldo: linha CHEIA até o último período totalmente realizado,
 * TRACEJADA na projeção. O eixo repete os rótulos das colunas, e o
 * período do hoje aparece em vermelho.
 */
function Curva({
  saldos,
  colunas,
  corte,
  hoje,
  vale,
  pico,
}: {
  saldos: number[];
  colunas: Coluna[];
  corte: number;
  hoje: string;
  vale: number;
  pico: number;
}) {
  const min = Math.min(...saldos, 0);
  const max = Math.max(...saldos);
  const amplitude = max - min || 1;
  const folga = amplitude * 0.12;
  const y = (v: number) =>
    200 - ((v - min + folga * 0.35) / (amplitude + folga)) * 190;
  const x = (i: number) => ((i + 0.5) * 1000) / saldos.length;

  const pontos = saldos.map((v, i) => [x(i), y(v)] as const);
  const d = (arr: readonly (readonly [number, number])[]) =>
    arr.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");

  const fimSolido = Math.max(corte - 1, 0);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft px-5 pb-3.5 pt-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">
          Curva de saldo
        </h2>
        <span className="text-[11.5px] text-muted-foreground">
          Linha cheia: realizado · tracejada: projeção
        </span>
      </div>

      <div className="mt-3.5 h-[210px]">
        <svg
          viewBox="0 0 1000 210"
          preserveAspectRatio="none"
          className="block h-[210px] w-full overflow-visible"
        >
          <path
            d={`${d(pontos)} L${x(saldos.length - 1).toFixed(1)},200 L${x(0).toFixed(1)},200 Z`}
            fill="rgba(231,75,86,.07)"
          />
          {min < 0 && (
            <line
              x1="0"
              x2="1000"
              y1={y(0)}
              y2={y(0)}
              stroke={VERMELHO}
              strokeWidth="1"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <line
            x1={x(corte)}
            x2={x(corte)}
            y1="0"
            y2="210"
            stroke="#d7d7d7"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={d(pontos.slice(0, fimSolido + 1))}
            fill="none"
            stroke={TINTA}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={d(pontos.slice(fimSolido))}
            fill="none"
            stroke="#E74B56"
            strokeWidth="2"
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="mt-2 flex">
        {colunas.map((c, i) => (
          <span
            key={c.ini}
            className="flex-1 text-center font-mono text-[10px] font-semibold tracking-[0.02em]"
            style={{ color: i === corte ? "#E74B56" : "#8a8a8a" }}
          >
            {c.rotulo}
          </span>
        ))}
      </div>

      <div className="mt-2.5 flex justify-between gap-3 border-t border-border/60 pt-2.5 text-[11.5px] text-muted-foreground">
        <span>
          Hoje:{" "}
          <strong className="font-semibold text-foreground">
            {formatarDataBR(hoje)}
          </strong>
        </span>
        <span>
          Projeção — mín.:{" "}
          <strong className="font-semibold text-foreground">{brl0(vale)}</strong>{" "}
          · máx.:{" "}
          <strong className="font-semibold text-foreground">{brl0(pico)}</strong>
        </span>
      </div>
    </div>
  );
}
