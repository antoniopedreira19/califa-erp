import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Eye, FileText, Info, Paperclip } from "lucide-react";
import { cn, dataBR, moeda } from "./ui";
import { acoesDoPainel, documentosDe } from "./documentos";
import { faturaPorId, regionalDe } from "./logica";
import { CARTOES } from "./data";

/**
 * O ⓘ da linha da planilha de títulos: o que a linha NÃO mostra. A linha
 * já tem data, valor, saldo, descrição, fornecedor, código do job, centro
 * de custo, trimestre e empresa; aqui entram a trilha da origem, para onde
 * vai o dinheiro, o rateio de regional, o detalhe da retenção e os
 * documentos — com "Visualizar" só quando há documento.
 *
 * Três desenhos para comparar (escolha na barra do protótipo):
 *   A · o pop-up do ⓘ do Extrato (`DetalhesPopover` de conciliacao-list),
 *       o mesmo botão redondo e os mesmos grupos — o recomendado;
 *   B · um pop-up mais compacto, em pares rótulo/valor;
 *   C · sem pop-up: a linha abre embaixo dela, como a guia de imposto e a
 *       fatura do cartão no Extrato.
 */

/** O botão de ver todos: "lado a lado" só quando há documento interno E de
 *  pagamento; senão, os N do mesmo lado, trocados pelos números. */
function rotuloVer(docs, curto) {
  const ambos = docs.some((d) => d.grupo === "origem") && docs.some((d) => d.grupo === "pagamento");
  if (ambos) return curto ? "Ver lado a lado" : "Visualizar interno e pagamento lado a lado";
  return curto ? `Ver os ${docs.length}` : `Visualizar os ${docs.length}`;
}

export const VARIANTES_DETALHES = [
  ["a", "A · Como no Extrato"],
  ["b", "B · Compacto"],
  ["c", "C · Linha aberta"],
];

/** O que o título tem além do que a linha mostra (dados do protótipo). */
export function extrasDe(t) {
  const v = t.verba;
  const f = t.faturaId ? faturaPorId(t.faturaId) : null;
  const cartao = CARTOES.find((c) => c.id === (t.cartao ?? t.cartaoPrevisto));
  const trilha =
    {
      pp: t.noCartao
        ? [`Pedida pela produção em 01/10/2026`, `Paga no cartão ${cartao?.nome ?? ""} em ${dataBR(t.pagoEm)}`, `Entrou na fatura ${t.noCartao.fatura}`]
        : [`Pedida pela produção em 01/10/2026`, `Aprovada pelo financeiro em 03/10/2026`],
      verba: v
        ? [
            `Verba de ${moeda(v.valor)} paga em ${dataBR(v.pagaEm)}`,
            v.semGasto ? "Prestação sem gasto: a verba volta inteira" : `Prestação: gasto de ${moeda(v.gasto)} em ${v.documentos.length} documentos`,
            `Aprovada em ${dataBR(v.aprovadaEm)} · devolve ${moeda(t.valor)}`,
          ]
        : [`Prestação de contas devolveu ${moeda(t.valor)}`],
      desembolso: [`Pedido de desembolso de 15/10/2026`, `Aprovado em 16/10/2026, com o centro de custo`],
      nf: [`Emitida em ${dataBR(t.emitida)}`],
      imposto: [`${t.origemImposto === "AVULSO" ? "Lançamento avulso" : `Apuração de ${t.competencia}`}`, `Guia aprovada com a contabilidade em 10/10/2026`],
      avulso: [`Criado no financeiro em 01/10/2026`],
      recorrencia: [`Recorrência mensal, todo dia ${String(t.vencOrig).slice(8, 10)}`, `Título gerado 30 dias antes`],
      folha: [`Folha 10/2026, aprovada em 15/10/2026`, `Paga pela remessa Santander`],
      fatura: f
        ? [
            `Fatura ${f.codigo} · fechou em ${dataBR(f.fecha)}`,
            `${f.itens.filter((i) => i.valor > 0 && i.tipo !== "ajuste").length} compras, ${f.itens.filter((i) => i.valor < 0).length} estornos e ${f.itens.filter((i) => i.tipo === "ajuste").length} ajuste do fechamento`,
          ]
        : [`Fatura fechada em 25/09/2026`],
      rec_avulso: [`Criado no financeiro em 15/10/2026`],
      rendimento: [`Rendimento líquido do mês, depois do IR e do IOF`],
      transferencia: [`Criada em 20/10/2026`, `Fica fora do DRE e do fluxo consolidado`],
    }[t.origem] ?? [];
  const pagamento =
    t.origem === "transferencia"
      ? ["Sai da California Santander", "Entra na California Investimento"]
      : t.origem === "verba"
        ? ["Volta por PIX ou TED do titular da verba", "A conta que recebe é escolhida na baixa"]
        : t.origem === "fatura"
          ? [`Débito da fatura do ${cartao?.nome ?? t.contraparte}`, cartao ? `${cartao.bandeira} ••••${cartao.final} · ${cartao.banco}` : null]
          : t.noCartao
            ? [`Pago no cartão ${cartao?.nome ?? ""} · fatura ${t.noCartao.fatura}`, cartao ? `${cartao.bandeira} ••••${cartao.final} · o dinheiro sai na baixa da fatura` : null]
            : t.formaPrevista === "cartao"
              ? [`Aprovado para o cartão ${cartao?.nome ?? ""}`, "É só a intenção: a forma se confirma na baixa"]
      : t.lado === "receber"
        ? [t.origem === "rendimento" ? "Entra na California Investimento" : "TED ou PIX na conta da empresa", t.origem === "nf" ? "PO-4500123 · cobrança: financeiro_001@exemplo.com" : null]
        : t.forma === "guia"
          ? [`${t.ref} · código de barras na guia`, `CNPJ ${t.cnpjLocal}`]
          : t.forma === "boleto"
            ? ["Boleto", "03399.12345 67890.123456 78901.234567 8"]
            : t.forma === "concessionaria"
              ? ["Débito de concessionária", "Código de barras da conta de consumo"]
              : t.foraDoCadastro
                ? ["PIX fora do cadastro", "Chave informada só na baixa da PP"]
                : ["PIX · chave CNPJ do fornecedor", "00.000.000/0001-00"];
  const regional = regionalDe(t);
  const retencao =
    t.retencao > 0
      ? [
          ["IRRF 1,5%", Math.round(t.valor * 1.5) / 100],
          ["PIS/COFINS/CSLL 4,65%", Math.round((t.retencao - Math.round(t.valor * 1.5) / 100) * 100) / 100],
        ]
      : [];
  return {
    trilha,
    job: t.job ? `${t.job.codigo} · ${t.job.nome}` : null,
    parcela: t.parcela[1] > 1 ? `${t.parcela[0]} de ${t.parcela[1]}` : null,
    vencOrig: t.vencOrig && t.vencOrig !== t.vencimento ? dataBR(t.vencOrig) : null,
    pagamento: pagamento.filter(Boolean),
    regional,
    retencao,
    docs: documentosDe(t),
    origens: t.origensDinheiro ?? [],
    historico: t.historicoDaBaixa ?? [],
  };
}

// ---------------------------------------------------------------------------
// O botão e o pop-up
// ---------------------------------------------------------------------------

/** O botão redondo do ⓘ do Extrato. Em A e B abre o pop-up; em C abre a
 *  linha embaixo (quem controla é a tabela, por `onAlternar`). */
export function BotaoDetalhes({ t, variante = "a", aberto, onAlternar, onVerDocumentos, abrirAcao, rotulo = "Ver detalhes do título" }) {
  const ref = React.useRef(null);
  const [pop, setPop] = React.useState(false);
  const linha = variante === "c";
  const ativo = linha ? aberto : pop;
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          linha ? onAlternar?.() : setPop((p) => !p);
        }}
        aria-label={rotulo}
        aria-expanded={ativo}
        title={rotulo.replace("Ver d", "D")}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
          ativo ? "border-california-red bg-california-red text-white" : "border-california-red/40 text-california-red hover:bg-california-red/5",
        )}
      >
        {linha ? <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", ativo && "rotate-180")} /> : <Info className="h-3.5 w-3.5" />}
      </button>
      {!linha && pop && (
        <PopUp ancora={ref} onFechar={() => setPop(false)} largura={variante === "b" ? 288 : 320}>
          {variante === "b" ? (
            <ConteudoB t={t} onVer={(i) => (setPop(false), onVerDocumentos(t, i))} abrirAcao={(a, x) => (setPop(false), abrirAcao(a, x))} />
          ) : (
            <ConteudoA t={t} cabecalho={rotulo.replace("Ver d", "D")} onVer={(i) => (setPop(false), onVerDocumentos(t, i))} abrirAcao={(a, x) => (setPop(false), abrirAcao(a, x))} />
          )}
        </PopUp>
      )}
    </>
  );
}

/** Pop-up ao lado do botão (à esquerda, alinhado embaixo, como o Popover
 *  do Extrato), fora da tabela — a tabela rola de lado e cortaria. */
export function PopUp({ ancora, onFechar, largura, children }) {
  const painel = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  React.useLayoutEffect(() => {
    const r = ancora.current.getBoundingClientRect();
    const h = painel.current?.offsetHeight ?? 300;
    const right = Math.max(8, window.innerWidth - r.left + 8);
    let top = r.bottom - h;
    top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
    setPos({ right, top: Math.max(8, top) });
  }, []);
  React.useEffect(() => {
    const fora = (e) => {
      if (painel.current?.contains(e.target) || ancora.current?.contains(e.target)) return;
      onFechar();
    };
    const esc = (e) => e.key === "Escape" && onFechar();
    const rolou = (e) => !painel.current?.contains(e.target) && onFechar();
    document.addEventListener("mousedown", fora);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", rolou, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", rolou, true);
    };
  }, [onFechar]);
  return createPortal(
    <div
      ref={painel}
      role="dialog"
      style={{ width: largura, right: pos?.right ?? -9999, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-[1050] max-h-[80vh] overflow-y-auto rounded-xl border border-border bg-white p-4 text-left text-xs shadow-elevated"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// A · o pop-up do Extrato
// ---------------------------------------------------------------------------

const ROTULO = "text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground";

function Grupo({ label, children }) {
  return (
    <div className="space-y-1">
      <p className={ROTULO}>{label}</p>
      <div>{children}</div>
    </div>
  );
}

function ConteudoA({ t, cabecalho = "Detalhes do título", onVer, abrirAcao }) {
  const x = extrasDe(t);
  const acoes = acoesDoPainel(t, abrirAcao);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <p className={ROTULO}>{cabecalho}</p>
        <span className="font-mono text-[10px] font-semibold text-muted-foreground">{t.ref}</span>
      </div>
      <Grupo label="Origem">
        <div className="space-y-0.5">
          {x.trilha.map((l) => (
            <p key={l}>{l}</p>
          ))}
          {x.job && <p className="text-muted-foreground">Job {x.job}</p>}
          {(x.parcela || x.vencOrig) && (
            <p className="text-muted-foreground">
              {x.parcela && `Parcela ${x.parcela}`}
              {x.parcela && x.vencOrig && " · "}
              {x.vencOrig && `vencimento ${x.vencOrig}`}
            </p>
          )}
        </div>
      </Grupo>
      <Grupo label={t.lado === "receber" ? "Recebimento" : "Pagamento"}>
        <div className="space-y-0.5">
          <p>{x.pagamento[0]}</p>
          {x.pagamento[1] && <p className="break-all font-mono text-[10.5px] text-muted-foreground">{x.pagamento[1]}</p>}
        </div>
      </Grupo>
      {x.historico.length > 0 && <HistoricoDaBaixa historico={x.historico} />}
      {x.retencao.length > 0 && (
        <Grupo label="Retido na fonte">
          <div className="flex flex-col gap-0.5">
            {x.retencao.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4">
                <span>{k}</span>
                <span className="font-mono text-muted-foreground">{moeda(v)}</span>
              </div>
            ))}
          </div>
        </Grupo>
      )}
      {x.origens.length > 1 && (
        <Grupo label="De onde vem este dinheiro">
          <div className="flex flex-col gap-1">
            {x.origens.map((o, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono font-semibold">{o.codigo}</span>
                  <span className={o.save ? "text-[#5f5d57]" : undefined}>{o.save ? "saldo em save — crédito do cliente" : o.nome}</span>
                </span>
                <span className="whitespace-nowrap font-mono font-semibold">{moeda(o.valor)}</span>
              </div>
            ))}
          </div>
        </Grupo>
      )}
      {x.regional.length > 0 && (
        <Grupo label="Regional">
          <div className="flex flex-col gap-0.5">
            {x.regional.map(([r, p]) => (
              <div key={r} className="flex items-baseline justify-between gap-4">
                <span>{r}</span>
                <span className="font-mono text-muted-foreground">{p.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </Grupo>
      )}
      <Grupo label={x.docs.length ? `Documentos (${x.docs.length})` : "Documentos"}>
        {x.docs.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="space-y-1">
            {x.docs.map((d, i) => (
              <button key={d.arquivo} type="button" onClick={() => onVer(i)} className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-muted">
                {d.grupo === "origem" ? <FileText className="h-3.5 w-3.5 shrink-0 text-california-red" /> : <Paperclip className="h-3.5 w-3.5 shrink-0 text-violet-700" />}
                <span className="min-w-0 flex-1 truncate">{d.tipo}</span>
                <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {x.docs.length > 1 && (
              <button
                type="button"
                onClick={() => onVer(null)}
                className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-california-red/40 py-1.5 text-[11px] font-semibold text-california-red hover:bg-california-red/5"
              >
                <Eye className="h-3.5 w-3.5" />
                {rotuloVer(x.docs)}
              </button>
            )}
          </div>
        )}
      </Grupo>
      {acoes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
          {acoes.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold", a.perigo ? "border-california-red/30 text-california-red hover:bg-california-red/5" : "border-border hover:bg-muted")}
            >
              <a.icone className="h-3 w-3" />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** As correções da baixa feitas pela conciliação, com o motivo. */
function HistoricoDaBaixa({ historico }) {
  return (
    <Grupo label="Histórico da baixa">
      <div className="space-y-1.5">
        {historico.map((h, i) =>
          h.tipo === "desfeita" ? (
            <p key={i}>
              Correção desfeita em {dataBR(h.em)} por {h.por}
            </p>
          ) : (
            <div key={i}>
              <p>
                Corrigida pela conciliação em {dataBR(h.em)} por {h.por}
              </p>
              <p className="font-mono text-[10.5px] text-muted-foreground">
                {moeda(h.antes.total)} → {moeda(h.depois.total)}
                {h.antes.juros !== h.depois.juros && ` · juros ${moeda(h.antes.juros)} → ${moeda(h.depois.juros)}`}
                {h.antes.data !== h.depois.data && ` · data ${dataBR(h.antes.data)} → ${dataBR(h.depois.data)}`}
              </p>
              <p className="italic text-muted-foreground">“{h.motivo}”</p>
            </div>
          ),
        )}
      </div>
    </Grupo>
  );
}

// ---------------------------------------------------------------------------
// B · compacto, em pares rótulo/valor
// ---------------------------------------------------------------------------

function ConteudoB({ t, onVer, abrirAcao }) {
  const x = extrasDe(t);
  const acoes = acoesDoPainel(t, abrirAcao);
  const pares = [
    ["Origem", x.trilha[0]],
    ...(x.trilha[1] ? [["", x.trilha[1]]] : []),
    ...(x.job ? [["Job", x.job]] : []),
    ...(x.parcela ? [["Parcela", x.parcela]] : []),
    ...(x.vencOrig ? [["Vencimento", x.vencOrig]] : []),
    [t.lado === "receber" ? "Recebe" : "Paga", x.pagamento.join(" · ")],
    ...(x.retencao.length ? [["Retenção", x.retencao.map(([k, v]) => `${k} ${moeda(v)}`).join(" · ")]] : []),
    ...(x.regional.length ? [["Regional", x.regional.map(([r, p]) => `${r} ${p}%`).join(" · ")]] : []),
    ...(x.origens.length > 1 ? [["De onde vem", x.origens.map((o) => `${o.codigo} ${o.save ? "(save)" : ""} ${moeda(o.valor)}`).join(" · ")]] : []),
  ];
  return (
    <div className="space-y-2.5">
      <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        {pares.map(([k, v], i) => (
          <React.Fragment key={i}>
            <dt className="text-[10.5px] text-muted-foreground">{k}</dt>
            <dd className="break-words">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        {x.docs.length === 0 ? (
          <span className="text-muted-foreground">Sem documento anexado.</span>
        ) : (
          <>
            {x.docs.map((d, i) => (
              <button key={d.arquivo} type="button" onClick={() => onVer(i)} title={d.arquivo} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10.5px] hover:border-california-red/40 hover:text-california-red">
                <Paperclip className="h-3 w-3" />
                {d.tipo}
              </button>
            ))}
            {x.docs.length > 1 && (
              <button type="button" onClick={() => onVer(null)} className="ml-auto text-[11px] font-semibold text-california-red hover:underline">
                {rotuloVer(x.docs, true)}
              </button>
            )}
          </>
        )}
      </div>
      {acoes.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2">
          {acoes.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick} className={cn("text-[11px] font-semibold hover:underline", a.perigo ? "text-california-red" : "text-foreground")}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C · a linha aberta embaixo
// ---------------------------------------------------------------------------

/** A sublinha do título, com os grupos lado a lado, no recuo da Descrição —
 *  como as linhas que a guia de imposto e a fatura abrem no Extrato. */
export function LinhaAberta({ t, colunas, inicioDescricao, onVerDocumentos, abrirAcao }) {
  const x = extrasDe(t);
  const acoes = acoesDoPainel(t, abrirAcao);
  return (
    <tr className="border-b border-border bg-muted/20 text-xs">
      <td colSpan={inicioDescricao} />
      <td colSpan={colunas - inicioDescricao} className="px-3 py-3">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Grupo label="Origem">
            {x.trilha.map((l) => (
              <p key={l}>{l}</p>
            ))}
            {x.job && <p className="text-muted-foreground">Job {x.job}</p>}
            {x.parcela && <p className="text-muted-foreground">Parcela {x.parcela}</p>}
            {x.origens.length > 1 &&
              x.origens.map((o, i) => (
                <p key={i} className="text-muted-foreground">
                  {o.codigo} {o.save ? "· saldo em save" : `· ${o.nome}`} · {moeda(o.valor)}
                </p>
              ))}
          </Grupo>
          <Grupo label={t.lado === "receber" ? "Recebimento" : "Pagamento"}>
            <p>{x.pagamento[0]}</p>
            {x.pagamento[1] && <p className="break-all font-mono text-[10.5px] text-muted-foreground">{x.pagamento[1]}</p>}
            {x.retencao.map(([k, v]) => (
              <p key={k} className="text-muted-foreground">
                {k} · {moeda(v)}
              </p>
            ))}
          </Grupo>
          <Grupo label="Regional">
            {x.regional.length ? x.regional.map(([r, p]) => <p key={r}>{`${r} · ${p}%`}</p>) : <p className="text-muted-foreground">—</p>}
          </Grupo>
          <Grupo label="Documentos">
            {x.docs.length === 0 ? (
              <p className="text-muted-foreground">Sem documento anexado.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {x.docs.map((d, i) => (
                  <button key={d.arquivo} type="button" onClick={() => onVerDocumentos(t, i)} title={d.arquivo} className="inline-flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-[10.5px] hover:border-california-red/40 hover:text-california-red">
                    <Paperclip className="h-3 w-3" />
                    {d.tipo}
                  </button>
                ))}
                {x.docs.length > 1 && (
                  <button type="button" onClick={() => onVerDocumentos(t, null)} className="text-[11px] font-semibold text-california-red hover:underline">
                    {rotuloVer(x.docs, true)}
                  </button>
                )}
              </div>
            )}
            {acoes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-x-3">
                {acoes.map((a) => (
                  <button key={a.label} type="button" onClick={a.onClick} className={cn("text-[11px] font-semibold hover:underline", a.perigo ? "text-california-red" : "")}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </Grupo>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// O título por trás de uma linha do Extrato. O lançamento de uma baixa
// aponta para o título que ela pagou; os lançamentos de antes do protótipo
// trazem o título deles em `l.titulo`; o que não tem título nenhum (tarifa
// pela regra, remessa da folha) vira um título lido do próprio lançamento.
// ---------------------------------------------------------------------------

export function tituloDoLancamento(l, titulos) {
  const achado = l.tituloId && titulos.find((x) => x.id === l.tituloId);
  const d = l.detalhe ?? {};
  if (achado) return { ...achado, pagoEm: achado.pagoEm ?? (l.conciliado ? l.data : achado.pagoEm), origensDinheiro: d.origens, historicoDaBaixa: l.historico };
  if (l.titulo) return { ...l.titulo, pagoEm: l.data, origensDinheiro: d.origens, historicoDaBaixa: l.historico };
  const v = Math.abs(l.valor);
  return {
    id: l.id,
    lado: l.valor > 0 ? "receber" : "pagar",
    origem: d.codigo?.startsWith("Folha") ? "folha" : "avulso",
    ref: d.codigo ?? "—",
    titulo: l.descricao,
    contraparte: l.fornecedor ?? "—",
    empresa: l.empresa ?? "—",
    job: l.job ? { codigo: l.job, nome: "" } : null,
    vencimento: l.data,
    vencOrig: l.data,
    valor: v,
    retencao: 0,
    liquido: v,
    baixado: v,
    parcela: [1, 1],
    centro: l.centro,
    forma: "debito",
    entra: l.valor > 0,
    pagoEm: l.data,
    origensDinheiro: d.origens,
    historicoDaBaixa: l.historico,
  };
}
