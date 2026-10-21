import * as React from "react";
import { Banknote, CreditCard, Eye, Info, Landmark, Paperclip, Pencil, Plus, Receipt, Scale, Trash2, Undo2, Wallet, XCircle } from "lucide-react";
import { HOJE } from "./data";
import { Botao, Busca, Caixa, Chip, cn, dataBR, moeda, OrigemPill, PageHeader, StatusChip, Tabs, Th, Voltar } from "./ui";
import { aberto, comSaldoPrevisto, comoRecomendada, r2 } from "./logica";
import { AbaCartao } from "./cartao";
import { BarraDeSelecao, PlanilhaDeTitulos, StatusPill, useSelecaoDoLote } from "./titulos";

function Resumos({ itens }) {
  return (
    <div className="flex flex-wrap divide-x divide-border rounded-xl border border-border bg-card">
      {itens.map(([k, v, c]) => (
        <div key={k} className="min-w-[170px] flex-1 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</p>
          <p className={cn("mt-0.5 font-mono text-base font-semibold", c)}>{v}</p>
        </div>
      ))}
    </div>
  );
}

function soma(ts) {
  return r2(ts.reduce((s, t) => s + aberto(t), 0));
}

/** O que já foi pago (o líquido), para o "Pagos este mês". */
function somaPaga(ts) {
  return r2(ts.reduce((s, t) => s + (t.entra ? -t.liquido : t.liquido), 0));
}

/** No pagar, o estorno de verba abate a despesa (decisão 081), como no
 *  total da planilha. */
function somaComSinal(ts) {
  return r2(ts.reduce((s, t) => s + (t.entra ? -aberto(t) : aberto(t)), 0));
}

const em7 = (t) => t.vencimento >= HOJE && t.vencimento <= "2026-10-27";

// ===========================================================================
// Contas a Pagar · Títulos a Pagar
// ===========================================================================

export function ContasAPagar({ versao, titulos, onBaixar, onLote, abrir, saldoHoje, aba = "titulos", onAba, faturas = [], onFecharFatura, onReabrirFatura, avisar }) {
  const [status, setStatus] = React.useState("a_pagar");
  const [origem, setOrigem] = React.useState("todas");
  const [busca, setBusca] = React.useState("");
  // Hoje, o título pago no cartão sai de Títulos a Pagar (fica só na fatura);
  // nas versões novas ele fica, como "No cartão", para a trilha não sumir.
  const todos = titulos.filter((t) => t.lado === "pagar" && (versao !== "atual" || !t.noCartao));
  const porStatus = todos.filter((t) => (status === "a_pagar" ? !t.pagoEm : status === "parciais" ? t.baixado > 0 && !t.pagoEm : status === "pagos" ? !!t.pagoEm : true));
  const base = porStatus.filter((t) => !busca || `${t.titulo} ${t.contraparte} ${t.job?.codigo ?? ""} ${t.ref}`.toLowerCase().includes(busca.toLowerCase()));
  const ORIGENS = [
    ["todas", "Todas as origens"],
    ["pp", "PPs"],
    ["avulso", "Avulsos"],
    ["folha", "Folhas"],
    ["recorrencia", "Recorrências"],
    ["desembolso", "Desembolsos"],
    ["verba", "Estornos de verba"],
    ["fatura", "Faturas de cartão"],
  ];
  const visiveis = (origem === "todas" ? base : base.filter((t) => t.origem === origem)).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const sel = useSelecaoDoLote(visiveis.filter((t) => !t.pagoEm), { cartaoNoLote: versao !== "atual" });
  const abertos = todos.filter((t) => !t.pagoEm);

  return (
    <div className="space-y-6">
      <Voltar />
      <PageHeader
        title="Contas a Pagar"
        icon={Wallet}
        description="Pedidos de Produção, títulos a pagar e recorrências que envolvem dinheiro a sair. Aprove e rejeite os PPs; dê baixa nos títulos para enviá-los à conciliação."
        right={
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-48 items-center rounded-lg border border-border bg-white px-3 text-sm text-muted-foreground">Todas as empresas</span>
            <Botao variante="contorno">Aplicar filtro</Botao>
          </div>
        }
      />
      <Tabs
        ativa={aba}
        onChange={(k) => (k === "titulos" || k === "cartao") && onAba?.(k)}
        abas={[
          { key: "pps", label: "Pedidos de Produção (PPs)", count: 3 },
          { key: "des", label: "Pedidos de Desembolsos", count: 1 },
          { key: "rec", label: "Recorrências", count: 6 },
          { key: "fol", label: "Folhas de Pagamento", count: 0 },
          { key: "titulos", label: "Títulos a Pagar", count: abertos.length },
          // O número da aba: faturas abertas com o dia do fechamento já passado.
          { key: "cartao", label: "Cartão", count: faturas.filter((f) => f.status === "aberta" && f.fecha <= HOJE).length || undefined },
        ]}
      />
      {aba === "cartao" ? (
        <AbaCartao versao={versao} faturas={faturas} titulos={titulos} onBaixar={onBaixar} onFechar={onFecharFatura} onReabrir={onReabrirFatura} avisar={avisar} />
      ) : (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
          {[
            ["a_pagar", "A pagar"],
            ["parciais", "Parciais"],
            ["prestacao", "Aguardando prestação"],
            ["pagos", "Pagos"],
            ["todos", "Todos"],
          ].map(([k, l]) => (
            <StatusChip key={k} ativo={status === k} onClick={() => setStatus(k)} label={l} />
          ))}
          <div className="ml-auto flex gap-2">
            <Botao variante="contornoVermelho" onClick={() => abrir("remessa")}>
              <Landmark className="h-4 w-4" />
              Exportar remessa Santander
            </Botao>
            <Botao onClick={() => abrir("novo_pagamento")}>
              <Plus className="h-4 w-4" />
              Lançamento Avulso
            </Botao>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Busca value={busca} onChange={setBusca} placeholder="Buscar por título, fornecedor ou job..." />
          {ORIGENS.map(([k, l]) => (
            <Chip key={k} ativo={origem === k} onClick={() => setOrigem(k)} label={l} count={k === "todas" ? base.length : base.filter((t) => t.origem === k).length} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <Resumos
              itens={[
                ["Em aberto", moeda(somaComSinal(abertos)), ""],
                ["Vencendo em 7 dias", moeda(somaComSinal(abertos.filter(em7))), "text-amber-700"],
                ["Pagos este mês", moeda(somaPaga(todos.filter((t) => t.pagoEm))), "text-emerald-700"],
              ]}
            />
          </div>
        </div>

        {versao === "atual" ? (
          <TabelaCPAtual titulos={visiveis} sel={sel} onBaixar={onBaixar} abrir={abrir} />
        ) : (
          <PlanilhaDeTitulos
            linhas={comSaldoPrevisto(visiveis, saldoHoje, "cs")}
            sel={sel}
            modulo="pagar"
            regra={comoRecomendada(versao) ? "banco" : "dre"}
            colunaFina={comoRecomendada(versao) ? null : "credito"}
            colunaStatus
            rotuloData="Data prevista"
            rotuloContraparte="Fornecedor"
            onBaixar={onBaixar}
            abrir={abrir}
            saldoHoje={saldoHoje}
            vazio="Nenhum título a pagar. Aprove um Pedido de Produção ou crie um lançamento avulso."
          />
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Baixa é feita aqui. A aprovação e a rejeição continuam na aba de Pedidos de Produção. Clique num título pago ou parcial para conferir as baixas e, se preciso, estornar ou cancelar.
        </p>
        <BarraDeSelecao itens={sel.itens} onLimpar={sel.limpar} onBaixar={() => onLote(sel.itens, sel.limpar)} />
      </div>
      )}
    </div>
  );
}

function TabelaCPAtual({ titulos, sel, onBaixar, abrir }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full min-w-[1200px] table-fixed text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="w-[3%] py-3 pl-4 pr-1">
              <Caixa {...sel.cabecalho} />
            </th>
            <Th className="w-[9%]" alinhar="center">Data Pgto.</Th>
            <Th className="w-[8%]" alinhar="center">Venc. Orig.</Th>
            <Th className="w-[15%]">Título</Th>
            <Th className="w-[13%]">Fornecedor</Th>
            <Th className="w-[12%]">Job</Th>
            <Th className="w-[9%]" alinhar="center">Origem</Th>
            <Th className="w-[9%]" alinhar="right">Valor</Th>
            <Th className="w-[6%]" alinhar="center">Parcela</Th>
            <Th className="w-[7%]" alinhar="center">Status</Th>
            <th className="w-[7%] px-3 py-3 font-semibold">Ação</th>
          </tr>
        </thead>
        <tbody>
          {titulos.length === 0 && (
            <tr>
              <td colSpan={11} className="px-4 py-12 text-center text-sm text-muted-foreground">
                Nenhum título a pagar. Aprove um Pedido de Produção ou crie um lançamento avulso.
              </td>
            </tr>
          )}
          {titulos.map((t) => {
            const motivo = t.pagoEm ? "Título já pago." : sel.motivo(t);
            const alterada = t.vencimento !== t.vencOrig;
            return (
              <tr key={t.id} onClick={motivo ? undefined : () => sel.alternar(t)} className={cn("border-b border-border last:border-0 hover:bg-accent/40", !motivo && "cursor-pointer", sel.marcado(t) && "bg-california-red/[0.04]")}>
                <td className="py-3 pl-4 pr-1 text-center">{!t.pagoEm && <Caixa marcado={sel.marcado(t)} onClick={() => sel.alternar(t)} desligada={!!motivo} title={motivo ?? undefined} />}</td>
                <td className="px-2 py-3 text-center">
                  <span className="inline-flex items-center gap-1">
                    {!t.pagoEm && t.origem !== "verba" && (
                      <button type="button" title="Editar data de pagamento" onClick={(e) => (e.stopPropagation(), abrir("editar_data", t))} className="rounded p-0.5 text-muted-foreground/60 hover:text-california-red">
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    <span className={cn("font-mono text-xs", alterada && "font-semibold text-california-red")}>{dataBR(t.pagoEm ?? t.vencimento)}</span>
                  </span>
                </td>
                <td className={cn("px-2 py-3 text-center font-mono text-xs", alterada ? "text-amber-700" : "text-muted-foreground")}>{dataBR(t.vencOrig)}</td>
                <td className="px-3 py-3">
                  <span className="block break-words font-semibold">{t.titulo}</span>
                  {t.nf && <span className="text-[11px] text-muted-foreground">NF {t.nf}</span>}
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  <span className="block truncate">{t.contraparte}</span>
                </td>
                <td className="px-3 py-3 text-xs">
                  {t.job && (t.origem === "pp" || t.origem === "verba") ? (
                    <>
                      <span className="block font-mono">{t.job.codigo}</span>
                      <span className="block truncate text-muted-foreground">{t.job.nome}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-3 text-center">
                  <OrigemPill t={t} />
                </td>
                <td className={cn("whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums", t.origem === "verba" && "text-teal-700")}>
                  {t.origem === "verba" ? "−" : ""}
                  {moeda(t.valor)}
                  {t.retencao > 0 && <span className="block text-[10.5px] font-medium text-muted-foreground">{moeda(t.retencao)} retidos · a recolher</span>}
                </td>
                <td className="px-2 py-3 text-center font-mono text-xs">
                  {t.parcela[0]}/{t.parcela[1]}
                </td>
                <td className="px-2 py-3 text-center">
                  <StatusPill t={t} />
                </td>
                <td className="px-3 py-3 text-center">
                  {t.pagoEm ? (
                    <Eye className="mx-auto h-4 w-4 text-muted-foreground" />
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <button type="button" onClick={(e) => (e.stopPropagation(), onBaixar(t))} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700">
                        <CreditCard className="h-3 w-3" />
                        Baixar
                      </button>
                      {t.origem === "folha" && (
                        <button type="button" title="Devolver para a aprovação — para corrigir valor ou pagamento" onClick={(e) => (e.stopPropagation(), abrir("devolver_folha", t))} className="rounded p-1 text-muted-foreground hover:bg-muted">
                          <Undo2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Contas a Receber · Títulos a Receber
// ===========================================================================

export function ContasAReceber({ versao, titulos, onBaixar, onLote, abrir, saldoHoje }) {
  const [status, setStatus] = React.useState("em_aberto");
  const todos = titulos.filter((t) => t.lado === "receber" || t.lado === "transf");
  const f = {
    todos: () => true,
    em_aberto: (t) => !t.pagoEm,
    inadimplentes: (t) => !t.pagoEm && t.origem === "nf" && t.vencimento < HOJE,
    parciais: (t) => !t.pagoEm && t.baixado > 0,
    recebidos: (t) => !!t.pagoEm,
  };
  const visiveis = todos.filter(f[status]).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const sel = useSelecaoDoLote(visiveis.filter((t) => !t.pagoEm), { cartaoNoLote: versao !== "atual" });
  return (
    <div className="space-y-6">
      <Voltar />
      <PageHeader
        title="Contas a Receber"
        icon={Receipt}
        description="Jobs e BVs aguardando nota fiscal, e os títulos já faturados. Fature um job por vez ou use o Faturamento Agrupado para emitir uma única NF cobrindo vários jobs do mesmo cliente."
      />
      <Tabs
        ativa="titulos"
        abas={[
          { key: "fat", label: "Faturamento", count: 4 },
          { key: "titulos", label: "Títulos a Receber", count: todos.filter((t) => !t.pagoEm).length },
        ]}
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["todos", "Todos"],
            ["em_aberto", "Em aberto"],
            ["inadimplentes", "Inadimplentes"],
            ["parciais", "Parciais"],
            ["recebidos", "Recebidos"],
          ].map(([k, l]) => (
            <Chip key={k} tom="suave" ativo={status === k} onClick={() => setStatus(k)} label={l} count={todos.filter(f[k]).length} />
          ))}
          <Botao className="ml-auto" onClick={() => abrir("novo_recebimento", null, "avulso")}>
            <Plus className="h-4 w-4" />
            Recebimento avulso
          </Botao>
        </div>
        {versao === "atual" ? (
          <TabelaCRAtual titulos={visiveis} sel={sel} onBaixar={onBaixar} abrir={abrir} />
        ) : (
          <PlanilhaDeTitulos
            linhas={comSaldoPrevisto(visiveis, saldoHoje, "cs")}
            sel={sel}
            modulo="receber"
            regra={comoRecomendada(versao) ? "banco" : "dre"}
            colunaStatus
            rotuloData="Data prevista"
            rotuloContraparte="Cliente"
            onBaixar={onBaixar}
            abrir={abrir}
            saldoHoje={saldoHoje}
            vazio="Nenhum título com esse status."
          />
        )}
        <BarraDeSelecao itens={sel.itens} onLimpar={sel.limpar} onBaixar={() => onLote(sel.itens, sel.limpar)} />
      </div>
    </div>
  );
}

function TabelaCRAtual({ titulos, sel, onBaixar, abrir }) {
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1250px] table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[3%] py-3 pl-4 pr-1">
                <Caixa {...sel.cabecalho} />
              </th>
              <Th className="w-[9%]">Vencimento</Th>
              <Th className="w-[10%]">Previsão de recebimento</Th>
              <Th className="w-[10%]">Nota fiscal</Th>
              <Th className="w-[14%]">Cliente</Th>
              <Th className="w-[17%]">Jobs cobertos</Th>
              <Th className="w-[9%]">Data de recebimento</Th>
              <Th className="w-[11%]" alinhar="right">Valor</Th>
              <Th className="w-[5%]" alinhar="center">Parcela</Th>
              <Th className="w-[8%]" alinhar="center">Status</Th>
              <th className="w-[8%] px-3 py-3 text-right font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {titulos.map((t) => {
              const nf = t.origem === "nf";
              const motivo = sel.motivo(t);
              const atraso = nf && !t.pagoEm && t.vencimento < HOJE ? Math.round((Date.parse(HOJE) - Date.parse(t.vencimento)) / 86400000) : 0;
              return (
                <tr key={t.id} className={cn("h-[58px] border-b border-border last:border-0 hover:bg-accent/40", sel.marcado(t) && "bg-california-red/[0.04]")}>
                  <td className="py-3 pl-4 pr-1 text-center">{!t.pagoEm && <Caixa marcado={sel.marcado(t)} onClick={() => sel.alternar(t)} desligada={!!motivo} title={motivo ?? undefined} />}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      {nf && !t.pagoEm && (
                        <button type="button" title="Editar previsão de recebimento" onClick={() => abrir("editar_previsao", t)} className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border text-muted-foreground hover:text-california-red">
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      <span className="font-mono text-xs">{dataBR(t.vencOrig)}</span>
                    </span>
                  </td>
                  <td className={cn("px-3 py-3 font-mono text-xs", t.previsao && t.previsao !== t.vencOrig && "font-bold text-amber-800")}>{dataBR(t.previsao ?? t.vencimento)}</td>
                  <td className="px-3 py-3">
                    {nf ? (
                      <>
                        <span className="block font-mono text-xs font-bold text-california-red">{t.ref}</span>
                        <span className="text-[11px] text-muted-foreground">Emitida {dataBR(t.emitida)}</span>
                      </>
                    ) : (
                      <>
                        <span className="block font-mono text-xs font-bold">{t.ref}</span>
                        <span className="text-[11px] text-muted-foreground">{t.origem === "transferencia" ? "Transferência" : t.origem === "rendimento" ? "Rendimento" : "Recebimento avulso"}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <span className="block truncate">{t.contraparte}</span>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11.5px] text-muted-foreground">
                    <span className="line-clamp-2">{nf ? (t.job ? `${t.job.codigo} ${t.job.nome}` : `Avulso · ${t.descricaoNf}`) : t.titulo}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground/50">{t.pagoEm ? <span className="font-bold text-emerald-700">{dataBR(t.pagoEm)}</span> : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">{moeda(t.valor)}</td>
                  <td className="px-2 py-3 text-center font-mono text-xs">
                    {t.parcela[0]}/{t.parcela[1]}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <StatusPill t={t} />
                    {atraso > 0 && <span className="block text-[10px] font-bold text-california-red">{atraso} dias de atraso</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {!t.pagoEm && (
                      <button type="button" onClick={() => onBaixar(t)} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700">
                        <Banknote className="h-3 w-3" />
                        Dar baixa
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="w-[38px] shrink-0 pt-[46px]">
        {titulos.map((t) => (
          <div key={t.id} className="flex h-[58px] items-center justify-center">
            {t.origem === "nf" ? (
              <button type="button" title="PO, descrição de NF e contatos de cobrança" onClick={() => abrir("info_nf", t)} className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-california-red">
                <Info className="h-3 w-3" />
              </button>
            ) : !t.pagoEm ? (
              <button type="button" title="Excluir este título (criado por engano)" onClick={() => abrir("excluir", t)} className="text-muted-foreground hover:text-california-red">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Fiscal · Impostos a Pagar
// ===========================================================================

export function ImpostosAPagar({ versao, titulos, onBaixar, onLote, abrir, saldoHoje }) {
  const [status, setStatus] = React.useState("a_pagar");
  const [busca, setBusca] = React.useState("");
  const todos = titulos.filter((t) => t.lado === "imposto");
  const abertos = todos.filter((t) => !t.pagoEm);
  const vencidos = abertos.filter((t) => t.vencimento < HOJE);
  const f = { a_pagar: (t) => !t.pagoEm, vencidos: (t) => !t.pagoEm && t.vencimento < HOJE, pagos: (t) => !!t.pagoEm, todos: () => true };
  const visiveis = todos
    .filter(f[status])
    .filter((t) => !busca || `${t.titulo} ${t.competencia} ${t.cnpjLocal}`.toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const sel = useSelecaoDoLote(visiveis.filter((t) => !t.pagoEm), { cartaoNoLote: versao !== "atual" });
  return (
    <div className="space-y-6">
      <Voltar />
      <PageHeader
        title="Fiscal"
        icon={Scale}
        description="Os impostos de cada mês e trimestre, calculados a partir das notas emitidas, dos custos dos jobs e das retenções. A guia aprovada vira imposto a pagar; a baixa vai para a conciliação."
      />
      <Tabs
        ativa="impostos"
        abas={[
          { key: "apuracao", label: "Apuração", count: 2 },
          { key: "impostos", label: "Impostos a Pagar", count: abertos.length },
        ]}
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
          {[
            ["a_pagar", "A pagar"],
            ["vencidos", vencidos.length ? `Vencidos · ${vencidos.length}` : "Vencidos"],
            ["pagos", "Pagos"],
            ["todos", "Todos"],
          ].map(([k, l]) => (
            <StatusChip key={k} ativo={status === k} onClick={() => setStatus(k)} label={l} />
          ))}
          <Botao className="ml-auto" onClick={() => abrir("novo_imposto")}>
            <Plus className="h-4 w-4" />
            Lançamento Avulso
          </Botao>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Busca value={busca} onChange={setBusca} placeholder="Buscar por imposto, CNPJ ou competência..." />
          <Chip ativo label="Todas as empresas" count={abertos.length} />
          <Chip label="Agência California" count={abertos.length} />
        </div>
        <Resumos
          itens={[
            ["Em aberto", moeda(soma(abertos)), ""],
            ["Vencendo em 7 dias", moeda(soma(abertos.filter(em7))), "text-amber-700"],
            ...(vencidos.length ? [["Vencidos", moeda(soma(vencidos)), "text-california-red"]] : []),
            ["Pagos este mês", moeda(somaPaga(todos.filter((t) => t.pagoEm))), "text-emerald-700"],
          ]}
        />
        {versao === "atual" ? (
          <TabelaImpostosAtual titulos={visiveis} sel={sel} onBaixar={onBaixar} abrir={abrir} />
        ) : (
          <PlanilhaDeTitulos
            linhas={comSaldoPrevisto(visiveis, saldoHoje, "cs")}
            sel={sel}
            modulo="pagar"
            regra={comoRecomendada(versao) ? "banco" : "dre"}
            colunaFina="credito"
            colunaStatus
            rotuloData="Data prevista"
            rotuloContraparte="Órgão"
            onBaixar={onBaixar}
            abrir={abrir}
            saldoHoje={saldoHoje}
            vazio="Nenhum imposto encontrado com esses filtros."
          />
        )}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          A baixa é feita aqui e vai para a conciliação, rateada entre as empresas e regionais. Para pagar várias guias de uma vez, selecione-as.{" "}
          {versao === "atual"
            ? "A guia que a contabilidade mandar diferente se corrige pelo lápis, com justificativa."
            : "O valor da guia só muda na Apuração, onde ela é aprovada; aqui, na baixa, entram só multa e juros."}
        </p>
        <BarraDeSelecao itens={sel.itens} onLimpar={sel.limpar} onBaixar={() => onLote(sel.itens, sel.limpar)} />
      </div>
    </div>
  );
}

function TabelaImpostosAtual({ titulos, sel, onBaixar, abrir }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full min-w-[1150px] table-fixed text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="w-[3%] py-3 pl-4 pr-1">
              <Caixa {...sel.cabecalho} />
            </th>
            <Th className="w-[9%]" alinhar="center">Vencimento</Th>
            <Th className="w-[17%]">Imposto</Th>
            <Th className="w-[15%]">CNPJ</Th>
            <Th className="w-[11%]">Competência</Th>
            <Th className="w-[9%]" alinhar="center">Origem</Th>
            <Th className="w-[11%]" alinhar="right">Valor</Th>
            <Th className="w-[11%]">Guia</Th>
            <Th className="w-[7%]" alinhar="center">Status</Th>
            <th className="w-[12%] px-3 py-3 font-semibold">Ação</th>
          </tr>
        </thead>
        <tbody>
          {titulos.map((t) => {
            const vencido = !t.pagoEm && t.vencimento < HOJE;
            return (
              <tr key={t.id} onClick={() => !t.pagoEm && sel.alternar(t)} className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-accent/40", sel.marcado(t) && "bg-california-red/[0.04]")}>
                <td className="py-3 pl-4 pr-1 text-center">{!t.pagoEm && <Caixa marcado={sel.marcado(t)} onClick={() => sel.alternar(t)} desligada={!!sel.motivo(t)} title={sel.motivo(t) ?? undefined} />}</td>
                <td className="px-2 py-3 text-center">
                  <span className={cn("font-mono text-xs", vencido && "font-semibold text-california-red")}>{dataBR(t.vencimento)}</span>
                  {t.pagoEm && <span className="block text-[10.5px] text-emerald-700">pago {dataBR(t.pagoEm)}</span>}
                </td>
                <td className="px-3 py-3">
                  <span className="font-semibold">{t.titulo}</span>
                  {t.cota && <span className="text-muted-foreground"> · cota {t.cota}</span>}
                  <span className="block text-[11px] text-muted-foreground">{t.ref === "Guia municipal" ? `Guia municipal · ${t.local}` : t.ref}</span>
                </td>
                <td className="px-3 py-3 text-xs">
                  {t.pj}
                  <span className="block font-mono text-[11px] text-muted-foreground">{t.cnpjLocal}</span>
                </td>
                <td className="px-3 py-3 text-xs">{t.competencia}</td>
                <td className="px-2 py-3 text-center">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{t.origemImposto}</span>
                </td>
                <td className="px-3 py-3 text-right font-semibold">{moeda(t.valor)}</td>
                <td className="px-3 py-3 text-xs">
                  <span className="inline-flex items-center gap-1 text-california-red">
                    <Paperclip className="h-3 w-3" />
                    <span className="truncate">{t.guiaArquivo}</span>
                  </span>
                </td>
                <td className="px-2 py-3 text-center">
                  <StatusPill t={t} />
                </td>
                <td className="px-3 py-3">
                  {!t.pagoEm && (
                    <span className="inline-flex items-center gap-1">
                      <button type="button" title="Cancelar o imposto (deixou de ser devido), com motivo" onClick={(e) => (e.stopPropagation(), abrir("cancelar_imposto", t))} className="rounded p-1 text-muted-foreground hover:bg-muted">
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="Corrigir o valor (guia da contabilidade diferente)" onClick={(e) => (e.stopPropagation(), abrir("corrigir_imposto", t))} className="rounded p-1 text-muted-foreground hover:bg-muted">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={(e) => (e.stopPropagation(), onBaixar(t))} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700">
                        <CreditCard className="h-3 w-3" />
                        Baixar
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
