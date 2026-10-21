import * as React from "react";
import {
  ArrowLeftRight,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Maximize2,
  Minimize2,
  Paperclip,
  Pencil,
  Trash2,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { centroTexto, cn, dataBR, moeda, OrigemPill } from "./ui";
import { aberto, descricaoDoLancamento, entra, faturaPorId } from "./logica";
import { StatusPill } from "./titulos";

/**
 * Os documentos de um título, lado a lado, no desenho da tela da PP no
 * financeiro (`contas-a-pagar/pp-tela.tsx`). Abre pelo pop-up do ⓘ da
 * linha, só quando o título tem documento. Os documentos aqui são
 * desenhos: no sistema são os PDFs e as imagens anexados, no visualizador
 * do navegador.
 */
/**
 * Os documentos lado a lado, como na aprovação da PP: à ESQUERDA sempre o
 * documento interno (a PP, o pedido de desembolso, a NF que a agência
 * emitiu), à DIREITA sempre o de pagamento (a NF do fornecedor, o
 * orçamento, o boleto, a guia, a fatura). Cada lado com mais de um
 * documento troca pelos números. Quando só um dos lados tem documento, ele
 * ocupa a tela. Ampliar mostra um lado só; voltar refaz o lado a lado.
 */
export function VisualizadorDeDocumentos({ t, docs, inicial, onFechar }) {
  const lados = [
    { chave: "origem", rotulo: "Interno", docs: docs.filter((d) => d.grupo === "origem") },
    { chave: "pagamento", rotulo: "Pagamento", docs: docs.filter((d) => d.grupo === "pagamento") },
  ].filter((l) => l.docs.length > 0);
  const pedido = inicial !== null && inicial !== undefined ? docs[inicial] : null;
  const [ativo, setAtivo] = React.useState(() =>
    Object.fromEntries(lados.map((l) => [l.chave, pedido && pedido.grupo === l.chave ? l.docs.indexOf(pedido) : 0])),
  );
  const [so, setSo] = React.useState(null); // a chave do lado ampliado
  React.useEffect(() => {
    const k = (e) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onFechar]);
  const visiveis = so ? lados.filter((l) => l.chave === so) : lados;
  return (
    <div className="fixed inset-0 z-[1060] flex flex-col bg-[#181818]/[0.82] p-5" role="dialog" aria-modal="true" aria-label={`Documentos de ${t.ref}`}>
      <div className="flex flex-none flex-wrap items-center gap-3 pb-3">
        <span className="font-mono text-[15px] font-bold text-white">{t.ref}</span>
        <span className="max-w-[420px] truncate text-xs text-white/70">{t.titulo}</span>
        <span className="text-xs text-white/50">
          {lados.length > 1 ? "· documento interno e de pagamento, lado a lado" : `· ${docs.length} ${docs.length === 1 ? "documento" : "documentos"}`}
        </span>
        <button
          type="button"
          onClick={onFechar}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
        >
          <X className="h-3 w-3" />
          Fechar
        </button>
      </div>
      <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${visiveis.length}, minmax(0, 1fr))` }}>
        {visiveis.map((lado) => {
          const i = ativo[lado.chave] ?? 0;
          const d = lado.docs[i];
          return (
            <div key={lado.chave} className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white">
              <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
                {lado.chave === "origem" ? <FileText className="h-4 w-4 text-california-red" /> : <Paperclip className="h-4 w-4 text-violet-700" />}
                <span
                  className={cn(
                    "rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide",
                    lado.chave === "origem" ? "bg-california-red/10 text-california-red" : "bg-violet-100 text-violet-700",
                  )}
                >
                  {lado.rotulo}
                </span>
                <span className="text-xs font-bold">{d.tipo}</span>
                {lado.docs.length > 1 && (
                  <div className="flex items-center gap-1">
                    {lado.docs.map((x, j) => (
                      <button
                        key={x.arquivo}
                        type="button"
                        onClick={() => setAtivo((a) => ({ ...a, [lado.chave]: j }))}
                        aria-pressed={j === i}
                        title={`${x.tipo} · ${x.arquivo}`}
                        className={j === i ? "rounded-md bg-california-red px-2 py-0.5 text-[11px] font-semibold text-white" : "rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"}
                      >
                        {j + 1}
                      </button>
                    ))}
                  </div>
                )}
                <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground">{d.arquivo}</span>
                <div className="flex flex-none items-center gap-0.5 border-l border-border pl-2">
                  {lados.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSo((s) => (s ? null : lado.chave))}
                      title={so ? "Voltar ao lado a lado" : "Ver só este documento"}
                      aria-label={so ? "Voltar ao lado a lado" : "Ver só este documento"}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-california-red"
                    >
                      {so ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  <span title="Baixar o arquivo" className="rounded-md p-1.5 text-muted-foreground">
                    <Download className="h-3.5 w-3.5" />
                  </span>
                  <span title="Abrir em outra aba" className="rounded-md p-1.5 text-muted-foreground">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-[#525659]">
                <Folha>{d.render(t)}</Folha>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A página do PDF, como o visualizador do navegador mostra. */
function Folha({ children }) {
  return (
    <div className="flex justify-center p-5">
      <div className="w-full max-w-[640px] bg-white p-8 text-[11px] leading-relaxed text-[#222] shadow-lg">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Os documentos de cada origem: o de origem (a PP, a nota, a guia) e os de
// pagamento (a NF do fornecedor, o boleto, a fatura). Lista vazia quando
// não há nenhum — aí não há o que visualizar.
// ---------------------------------------------------------------------------

export function documentosDe(t) {
  const o = (tipo, arquivo, render) => ({ grupo: "origem", tipo, arquivo, render });
  const p = (tipo, arquivo, render) => ({ grupo: "pagamento", tipo, arquivo, render });
  switch (t.origem) {
    case "pp":
      return [
        o("Pedido de Produção", `${t.ref}.pdf`, PapelPP),
        ...(t.nf ? [p(`NF ${t.nf} do fornecedor`, `NF-${t.nf}-${slug(t.contraparte)}.pdf`, PapelNFFornecedor)] : []),
        p("Orçamento do fornecedor", `orcamento-${slug(t.contraparte)}.pdf`, PapelOrcamento),
      ];
    case "verba":
      return [
        o("Pedido de Produção da verba", `${t.ref.replace("ESTORNO ", "")}.pdf`, PapelPP),
        p("Prestação de contas", `prestacao-${t.ref.replace("ESTORNO ", "")}.pdf`, PapelPrestacao),
      ];
    case "desembolso":
      return [o("Pedido de desembolso", `${t.ref}.pdf`, PapelPP)];
    case "nf":
      return [o(`Nota fiscal ${t.ref.replace("NF ", "")}`, `${t.ref.replace(/\s/g, "-")}.pdf`, PapelNFEmitida)];
    case "imposto":
      return [p(t.ref.startsWith("DARF") ? "Guia (DARF)" : "Guia municipal", t.guiaArquivo, PapelGuia)];
    case "fatura":
      return [p("Fatura do cartão", `${t.ref}.pdf`, PapelFatura)];
    case "avulso":
    case "recorrencia":
      return t.forma === "boleto" || t.forma === "concessionaria"
        ? [p(t.forma === "concessionaria" ? "Conta de consumo" : "Boleto", `${slug(t.titulo)}.pdf`, PapelBoleto)]
        : [];
    default:
      return [];
  }
}

function slug(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
}

// ---------------------------------------------------------------------------
// Os documentos desenhados
// ---------------------------------------------------------------------------

function Cab({ titulo, sub, direita }) {
  return (
    <div className="mb-5 flex items-start justify-between border-b-2 border-[#E74B56] pb-3">
      <div>
        <p className="text-[15px] font-bold tracking-tight">{titulo}</p>
        <p className="text-[10px] text-[#666]">{sub}</p>
      </div>
      <div className="text-right text-[10px] text-[#666]">{direita}</div>
    </div>
  );
}

function Linhas({ pares }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1.5">
      {pares.map(([k, v]) => (
        <div key={k}>
          <span className="block text-[9px] uppercase tracking-wider text-[#888]">{k}</span>
          <span className="font-semibold">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Tabela({ cab, linhas, total }) {
  return (
    <table className="mb-4 w-full text-[10.5px]">
      <thead>
        <tr className="border-b border-[#ccc] text-left text-[9px] uppercase tracking-wider text-[#888]">
          {cab.map((c, i) => (
            <th key={c} className={cn("py-1", i === cab.length - 1 && "text-right")}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={i} className="border-b border-[#eee]">
            {l.map((c, j) => (
              <td key={j} className={cn("py-1", j === l.length - 1 && "text-right font-mono")}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr className="font-bold">
            <td colSpan={cab.length - 1} className="pt-2 text-right">
              Total
            </td>
            <td className="pt-2 text-right font-mono">{total}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function PapelPP(t) {
  return (
    <>
      <Cab titulo={`Pedido de Produção ${t.ref.replace("ESTORNO ", "")}`} sub="Agência California · Financeiro" direita={<>Emitido em 02/10/2026<br />Job {t.job?.codigo ?? "—"}</>} />
      <Linhas
        pares={[
          ["Fornecedor", t.contraparte],
          ["CNPJ", "00.000.000/0001-00"],
          ["Job", t.job ? `${t.job.codigo} · ${t.job.nome}` : "—"],
          ["Vencimento", dataBR(t.vencOrig)],
          ["Forma de pagamento", t.forma === "pix" ? "PIX · chave CNPJ" : t.forma === "boleto" ? "Boleto" : "Transferência"],
          ["Parcela", `${t.parcela[0]} de ${t.parcela[1]}`],
        ]}
      />
      <Tabela cab={["Item da planilha", "Qtd.", "Valor"]} linhas={[[t.titulo, "1", moeda(t.valor)]]} total={moeda(t.valor)} />
      {t.retencao > 0 && (
        <p className="mb-3 rounded bg-[#f6f6f6] px-2 py-1.5 text-[10px]">
          Retenção na aprovação: {t.retencoes} · {moeda(t.retencao)} · líquido {moeda(t.liquido)}
        </p>
      )}
      <p className="text-[10px] text-[#666]">Aprovado pelo GP em 02/10/2026 · enviado ao financeiro em 03/10/2026.</p>
    </>
  );
}

function PapelNFFornecedor(t) {
  return (
    <>
      <Cab titulo="NFS-e · Nota Fiscal de Serviço Eletrônica" sub={`Nº ${t.nf} · série 1`} direita={<>Emissão 01/10/2026<br />Código de verificação 7K2M-9QX4</>} />
      <Linhas
        pares={[
          ["Prestador", t.contraparte],
          ["CNPJ do prestador", "00.000.000/0001-00"],
          ["Tomador", "Agência California Ltda"],
          ["CNPJ do tomador", "00.000.000/0001-00"],
        ]}
      />
      <p className="mb-2 text-[9px] uppercase tracking-wider text-[#888]">Discriminação dos serviços</p>
      <p className="mb-4">
        {t.titulo} — {t.job ? `${t.job.codigo} · ${t.job.nome}` : ""}
      </p>
      <Tabela
        cab={["Tributo", "Alíquota", "Valor"]}
        linhas={
          t.retencao > 0
            ? [
                ["IRRF retido", "1,50%", moeda(Math.round(t.valor * 1.5) / 100)],
                ["PIS/COFINS/CSLL retidos", "4,65%", moeda(t.retencao - Math.round(t.valor * 1.5) / 100)],
              ]
            : [["ISS", "5,00%", moeda(t.valor * 0.05)]]
        }
      />
      <Linhas
        pares={[
          ["Valor dos serviços", moeda(t.valor)],
          ["Valor líquido", moeda(t.liquido)],
        ]}
      />
    </>
  );
}

function PapelOrcamento(t) {
  return (
    <>
      <Cab titulo="Orçamento" sub={t.contraparte} direita={<>Validade 15 dias<br />Proposta 0927</>} />
      <p className="mb-3">À Agência California, a/c Produção.</p>
      <Tabela cab={["Descrição", "Qtd.", "Valor"]} linhas={[[t.titulo, "1", moeda(t.valor)]]} total={moeda(t.valor)} />
      <p className="text-[10px] text-[#666]">Pagamento: {t.parcela[1] > 1 ? `${t.parcela[1]} parcelas` : "à vista"}, por PIX na chave CNPJ.</p>
    </>
  );
}

function PapelNFEmitida(t) {
  return (
    <>
      <Cab titulo="NFS-e · Nota Fiscal de Serviço Eletrônica" sub={`${t.ref} · série 1`} direita={<>Emissão {dataBR(t.emitida)}<br />Prefeitura de Salvador</>} />
      <Linhas
        pares={[
          ["Prestador", `${t.empresa} Ltda`],
          ["CNPJ do prestador", "00.000.000/0001-00"],
          ["Tomador", t.contraparte],
          ["CNPJ do tomador", t.cnpj],
        ]}
      />
      <p className="mb-2 text-[9px] uppercase tracking-wider text-[#888]">Discriminação dos serviços</p>
      <p className="mb-4">{t.descricaoNf}</p>
      <Tabela
        cab={["Parcela", "Vencimento", "Valor"]}
        linhas={Array.from({ length: t.parcela[1] }, (_, i) => [`${i + 1}/${t.parcela[1]}`, i + 1 === t.parcela[0] ? dataBR(t.vencOrig) : "—", moeda(t.valor)])}
        total={moeda(t.valor * t.parcela[1])}
      />
    </>
  );
}

function PapelPO(t) {
  return (
    <>
      <Cab titulo="Pedido de Compra (PO)" sub={`${t.contraparte} · Suprimentos`} direita={<>PO 4500123<br />Emitido em 10/09/2026</>} />
      <Linhas
        pares={[
          ["Fornecedor", `${t.empresa} Ltda`],
          ["Centro de custo do cliente", "MKT-0042"],
          ["Faturar até", "30/09/2026"],
          ["Condição", "30 dias da emissão"],
        ]}
      />
      <Tabela cab={["Descrição", "Qtd.", "Valor"]} linhas={[[t.descricaoNf, "1", moeda(t.valor * t.parcela[1])]]} total={moeda(t.valor * t.parcela[1])} />
    </>
  );
}

function PapelGuia(t) {
  return (
    <>
      <Cab titulo={t.ref.startsWith("DARF") ? "Documento de Arrecadação de Receitas Federais" : "Guia de recolhimento do ISS"} sub={t.ref.startsWith("DARF") ? "Receita Federal do Brasil" : `Prefeitura de ${t.local ?? "Salvador-BA"}`} direita={<>Vencimento<br /><strong>{dataBR(t.vencOrig)}</strong></>} />
      <Linhas
        pares={[
          ["Contribuinte", t.pj],
          ["CNPJ", t.cnpjLocal],
          ["Período de apuração", t.competencia],
          ["Código da receita", t.ref.replace(/\D/g, "") || "—"],
          ["Valor principal", moeda(t.valor)],
          ["Multa e juros", "—"],
        ]}
      />
      <p className="mt-2 text-right text-[13px] font-bold">Total {moeda(t.valor)}</p>
      <p className="mt-4 font-mono text-[10px] tracking-widest text-[#444]">85810000008 8 84850328262 0 61019202610 1 00000000000 0</p>
    </>
  );
}

function PapelBoleto(t) {
  return (
    <>
      <Cab titulo={t.forma === "concessionaria" ? "Conta de consumo" : "Boleto bancário"} sub={t.contraparte} direita={<>Vencimento<br /><strong>{dataBR(t.vencOrig)}</strong></>} />
      <Linhas
        pares={[
          ["Pagador", "Agência California Ltda"],
          ["Referente a", t.titulo],
          ["Valor do documento", moeda(t.valor)],
          ["Após o vencimento", "multa 2% + juros 1% a.m."],
        ]}
      />
      <p className="mt-4 font-mono text-[10px] tracking-widest text-[#444]">03399.12345 67890.123456 78901.234567 8 {String(Math.round(t.valor * 100)).padStart(10, "0")}</p>
      <div className="mt-3 h-10 w-full bg-[repeating-linear-gradient(90deg,#222_0_2px,#fff_2px_4px,#222_4px_5px,#fff_5px_8px)]" />
    </>
  );
}

function PapelFatura(t) {
  const f = t.faturaId ? faturaPorId(t.faturaId) : null;
  const itens = f ? [...f.itens].sort((a, b) => a.data.localeCompare(b.data)) : [];
  return (
    <>
      <Cab titulo={`Fatura do cartão ${f?.codigo ?? ""}`} sub={t.contraparte} direita={<>Fechamento {f ? dataBR(f.fecha) : "—"}<br />Vencimento {dataBR(t.vencOrig)}</>} />
      <Tabela
        cab={["Data", "Estabelecimento", "Valor"]}
        linhas={itens.map((i) => [dataBR(i.data).slice(0, 5), i.tipo === "ajuste" ? i.descricao : i.fornecedor, i.valor < 0 ? `−${moeda(-i.valor)}` : moeda(i.valor)])}
        total={moeda(f?.valorCobrado ?? t.valor)}
      />
    </>
  );
}

function PapelPrestacao(t) {
  const v = t.verba;
  return (
    <>
      <Cab titulo={`Prestação de contas · ${t.ref.replace("ESTORNO ", "")}`} sub={t.contraparte} direita={<>Enviada em 14/10/2026<br />Aprovada em {v ? dataBR(v.aprovadaEm) : "—"}</>} />
      {v?.semGasto ? (
        <p className="mb-3 rounded bg-[#f6f6f6] px-2 py-1.5 text-[11px]">Não houve gasto — a verba volta inteira.</p>
      ) : (
        <Tabela cab={["Documento", "Descrição", "Valor"]} linhas={(v?.documentos ?? []).map(([d, x, val]) => [d, x, moeda(val)])} total={moeda(v?.gasto ?? 0)} />
      )}
      <Linhas
        pares={[
          ["Verba", v ? moeda(v.valor) : "—"],
          ["Gasto comprovado", v ? moeda(v.gasto) : "—"],
          ["Estorno do saldo", `−${moeda(t.valor)}`],
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// As ações que moravam no ⋯ da linha
// ---------------------------------------------------------------------------

export function acoesDoPainel(t, abrir) {
  const a = (acao, label, icone, extra = {}) => ({ label, icone, onClick: () => abrir(acao, t), ...extra });
  // Já pago (a linha do Extrato): só conferir a baixa, para estornar ou
  // cancelar — as ações de antes da baixa não valem mais.
  if (t.pagoEm) return [a("ver_baixas", "Ver a baixa registrada", Eye)];
  const lista = [];
  if (t.baixado > 0) lista.push(a("ver_baixas", "Ver as baixas", Eye));
  if (t.origem === "folha") lista.push(a("devolver_folha", "Devolver para a aprovação", Undo2));
  if (t.origem === "imposto") {
    // O valor da guia só muda na Apuração, onde ela é aprovada; aqui, na
    // baixa, só entram multa e juros (Tiago, 20/10/2026).
    lista.push(a("abrir_apuracao", "Abrir na Apuração", FileText));
    lista.push(a("cancelar_imposto", "Cancelar o imposto", XCircle, { perigo: true }));
  }
  if (["rec_avulso", "rendimento"].includes(t.origem)) lista.push(a("excluir", "Excluir este título", Trash2, { perigo: true }));
  if (t.origem === "transferencia") lista.push(a("excluir", "Excluir a transferência", Trash2, { perigo: true }));
  return lista;
}
