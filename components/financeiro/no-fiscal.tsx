"use client";

/**
 * O bloco "No fiscal" das baixas (módulo fiscal, entrega 2 — 02/10/2026;
 * protótipo aprovado pelo Tiago): o efeito de cada baixa na Apuração, refeito
 * a cada mudança de data, valor e retidos do formulário.
 *
 * Três variantes:
 * - `NoFiscalDoPagamento` — a baixa de uma parcela de PP com a NF do
 *   fornecedor registrada: as guias de retenção que ela faz nascer;
 * - `NoFiscalDoRecebimento` — a baixa de um título de nota com CNPJ emissor:
 *   o que o cliente reteve abate qual imposto e quando, e o presumido pelo
 *   caixa;
 * - `NoFiscalDoLote` — a linha da baixa em lote.
 *
 * Os dados chegam por Server Action (`actions-no-fiscal.ts`), à parte da
 * abertura do diálogo. As Server Actions vão uma de cada vez: na baixa da
 * PP, `useFiscalDaParcela` é chamado DEPOIS de `useRetencaoDaAprovacao`, que
 * é a leitura que trava o Confirmar. Sem efeito fiscal (sem NF registrada,
 * nota de antes do módulo, avulso), o bloco não aparece.
 */

import * as React from "react";
import { Info, Landmark, Scale } from "lucide-react";
import type { ImpostoRetido } from "@/lib/types";
import {
  lerFiscalDaNota,
  lerFiscalDaParcela,
  lerFiscalDoLote,
} from "@/app/(app)/financeiro/actions-no-fiscal";
import { dataBr, nomeDoMes, type Vencimento } from "@/lib/fiscal/datas";
import { textoDoRegime } from "@/lib/fiscal/faturar";
import {
  efeitoDoLote,
  efeitoDoPagamento,
  efeitoDoRecebimento,
  type FiscalDoLote,
  type FiscalDoPagamento,
  type FiscalDoRecebimento,
  type LinhaDoRecebimento,
  type PagamentoNoLote,
} from "@/lib/fiscal/no-fiscal";

const ERRO_DA_BUSCA = "Não foi possível buscar o efeito desta baixa no fiscal.";

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
/** "03/11". */
const diaMes = (iso: string) => dataBr(iso).slice(0, 5);

type Retidos = Partial<Record<ImpostoRetido, number>>;

// ---------------------------------------------------------------------------
// A leitura (uma por diálogo aberto)
// ---------------------------------------------------------------------------

export type LeituraFiscal<T> =
  /** Não há o que buscar: o título não é parcela de PP nem nota. */
  | { estado: "sem" }
  | { estado: "buscando" }
  /** `fiscal: null` = a baixa não tem efeito na Apuração. */
  | { estado: "pronto"; fiscal: T | null }
  | { estado: "erro"; mensagem: string };

type RespostaDaLeitura<T> = { ok: true; fiscal: T | null } | { ok: false; message: string };

function useLeituraFiscal<T>(
  chave: string | null,
  ler: () => Promise<RespostaDaLeitura<T>>,
  /** Espera o fim da rodada de efeitos para disparar: a leitura do pai que
   *  trava a confirmação vai antes (as Server Actions vão uma de cada vez). */
  depoisDoPai = false,
): LeituraFiscal<T> {
  const [resultado, setResultado] = React.useState<{ chave: string; leitura: LeituraFiscal<T> } | null>(null);
  const lerAgora = React.useRef(ler);
  lerAgora.current = ler;

  React.useEffect(() => {
    if (!chave) return;
    let vivo = true;
    const buscar = () =>
      lerAgora
        .current()
        .then((res) => {
          if (!vivo) return;
          setResultado({
            chave,
            leitura: res.ok ? { estado: "pronto", fiscal: res.fiscal } : { estado: "erro", mensagem: res.message },
          });
        })
        .catch(() => {
          if (vivo) setResultado({ chave, leitura: { estado: "erro", mensagem: ERRO_DA_BUSCA } });
        });
    const espera = depoisDoPai ? setTimeout(buscar, 0) : null;
    if (!espera) buscar();
    return () => {
      vivo = false;
      if (espera) clearTimeout(espera);
    };
  }, [chave, depoisDoPai]);

  if (!chave) return { estado: "sem" };
  if (!resultado || resultado.chave !== chave) return { estado: "buscando" };
  return resultado.leitura;
}

/** A NF da PP de uma parcela (`pedidos_compra_parcelas.id`); `null` = não é parcela de PP. */
export function useFiscalDaParcela(parcelaId: string | null): LeituraFiscal<FiscalDoPagamento> {
  return useLeituraFiscal(parcelaId, () => lerFiscalDaParcela(parcelaId));
}

/** A nota de saída (`faturamentos.id`); `null` = o título não tem nota. */
export function useFiscalDaNota(notaId: string | null): LeituraFiscal<FiscalDoRecebimento> {
  return useLeituraFiscal(notaId, () => lerFiscalDaNota(notaId));
}

/** Com a leitura falhando, o bloco diz que não deu, sem travar a baixa. */
function ErroDaLeitura({ mensagem }: { mensagem: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <Scale className="h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-semibold">No fiscal:</span> {mensagem}
      </span>
    </p>
  );
}

/** O motivo do vencimento ajustado, entre parênteses e mais claro. */
function Motivo({ v }: { v: Vencimento }) {
  return v.motivo ? <span className="text-sky-900/70"> ({v.motivo})</span> : null;
}

// ---------------------------------------------------------------------------
// Pagamento de PP
// ---------------------------------------------------------------------------

/**
 * As guias de retenção que a baixa de uma parcela de PP faz nascer na
 * Apuração: a CSRF (DARF 5952) e o IRRF (DARF 1708) pelo mês do pagamento,
 * pela matriz da PJ tomadora; o ISS retido pelo mês da emissão da NF, no
 * município do tomador. `retidos`: os valores do formulário, ou `null` com
 * a retenção desligada.
 */
export function NoFiscalDoPagamento({
  leitura,
  pagoEm,
  retidos,
}: {
  leitura: LeituraFiscal<FiscalDoPagamento>;
  pagoEm: string;
  retidos: Retidos | null;
}) {
  if (leitura.estado === "erro") return <ErroDaLeitura mensagem={leitura.mensagem} />;
  if (leitura.estado !== "pronto" || !leitura.fiscal) return null;
  const f = leitura.fiscal;
  const e = efeitoDoPagamento(f, pagoEm, retidos);
  const { darfs, iss } = e;

  return (
    <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-sky-900">
      <span className="mt-0.5 shrink-0">
        <Scale className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="font-semibold">No fiscal</p>
        {darfs.length === 0 && !iss ? (
          <p>Esta baixa não gera guia de retenção.</p>
        ) : (
          <>
            {darfs.length > 0 &&
              (e.darfsForaDaApuracao && e.competencia ? (
                <p>
                  Pagamento de <b className="font-semibold">{nomeDoMes(e.competencia)}</b>: a Apuração começa
                  em {nomeDoMes(f.primeira_competencia)}, e as retenções desta baixa (
                  {darfs.map((d, i) => (
                    <React.Fragment key={d.codigo}>
                      {i > 0 && " e "}DARF {d.codigo} <b className="font-mono font-semibold">{moeda(d.valor)}</b>
                    </React.Fragment>
                  ))}
                  ) ficam fora dela.
                </p>
              ) : (
                <p>
                  Esta baixa gera, na Apuração{" "}
                  {e.competencia ? (
                    <>
                      de <b className="font-semibold">{nomeDoMes(e.competencia)}</b>
                    </>
                  ) : (
                    <>
                      do <b className="font-semibold">mês do pagamento (informe a data)</b>
                    </>
                  )}
                  :{" "}
                  {darfs.map((d, i) => (
                    <React.Fragment key={d.codigo}>
                      {i > 0 && " e "}DARF {d.codigo} ({d.rotulo}){" "}
                      <b className="font-mono font-semibold">{moeda(d.valor)}</b>
                    </React.Fragment>
                  ))}
                  {e.vencimento && (
                    <>
                      , vencendo em <b className="font-semibold">{dataBr(e.vencimento.data)}</b>
                      <Motivo v={e.vencimento} />
                    </>
                  )}{" "}
                  — guias da {f.pj.nome} pela matriz.
                </p>
              ))}
            {iss &&
              (iss.foraDaApuracao ? (
                <p>
                  O ISS retido <b className="font-mono font-semibold">{moeda(iss.valor)}</b> é de{" "}
                  <b className="font-semibold">{nomeDoMes(iss.competencia)}</b> (mês da NF), antes do início da
                  Apuração: fica fora dela.
                </p>
              ) : (
                <p>
                  {darfs.length > 0 ? "E o" : "Esta baixa gera o"} ISS retido{" "}
                  <b className="font-mono font-semibold">{moeda(iss.valor)}</b>, na Apuração de{" "}
                  <b className="font-semibold">{nomeDoMes(iss.competencia)}</b> (mês da NF), no município do
                  tomador ({f.tomador.municipio}-{f.tomador.uf}), vencendo em{" "}
                  <b className="font-semibold">{dataBr(iss.vencimento.data)}</b>
                  <Motivo v={iss.vencimento} />.
                </p>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recebimento de NF
// ---------------------------------------------------------------------------

function TextoDaLinha({ l, f }: { l: LinhaDoRecebimento; f: FiscalDoRecebimento }) {
  switch (l.tipo) {
    case "sem_data":
      return <>Informe a data do recebimento para ver o efeito na apuração.</>;
    case "antes_do_modulo":
      return (
        <>
          Recebimento de {nomeDoMes(l.competencia)}: a Apuração começa em {nomeDoMes(l.primeira)}, e este
          recebimento fica fora dela.
        </>
      );
    case "caixa":
      return (
        <>
          <b className="font-semibold">Regime de caixa:</b> este recebimento gera PIS {moeda(l.pis)} (
          {pct(l.aliquota_pis)}) e COFINS {moeda(l.cofins)} ({pct(l.aliquota_cofins)}), que vencem em{" "}
          {dataBr(l.vencimento.data)}, e entra na base do IRPJ e da CSLL do {l.trimestre}.
          {l.vencimento.motivo && (
            <span className="mt-0.5 block text-[11.5px] text-sky-800/80">
              Vencimento ajustado: {l.vencimento.motivo}.
            </span>
          )}
        </>
      );
    case "iss_a_recuperar": {
      const quando = `aprovada em ${diaMes(l.aprovada_em)}${l.paga_em ? `, paga em ${diaMes(l.paga_em)}` : ""}`;
      return (
        <>
          O ISS desta nota já está na guia de {nomeDoMes(l.competencia_nota)} ({quando}). O valor retido vira{" "}
          <b className="font-semibold">ISS a recuperar</b>:{" "}
          {l.compensa
            ? `${f.emissor.municipio} permite compensar na próxima guia de ISS da ${f.emissor.nome}.`
            : `${f.emissor.municipio} pede restituição na prefeitura; fica listado na Apuração até a contabilidade concluir.`}
        </>
      );
    }
    case "iss_do_cliente":
      return (
        <>
          O <b className="font-semibold">ISS</b> desta nota sai da apuração de {nomeDoMes(l.competencia_nota)}: quem
          recolhe é o cliente.
        </>
      );
    case "iss_antes_do_modulo":
      return (
        <>
          O <b className="font-semibold">ISS retido</b> desta nota é de {nomeDoMes(l.competencia_nota)} (mês da NF),
          antes do início da Apuração ({nomeDoMes(l.primeira)}): fica fora dela.
        </>
      );
    case "pis_cofins_retidos": {
      const mes = nomeDoMes(l.competencia);
      if (l.pis && l.cofins)
        return (
          <>
            <b className="font-semibold">PIS e COFINS retidos</b> abatem o PIS e a COFINS de {mes} da {f.pj.nome}.
          </>
        );
      if (l.pis)
        return (
          <>
            O <b className="font-semibold">PIS retido</b> abate o PIS de {mes} da {f.pj.nome}.
          </>
        );
      return (
        <>
          A <b className="font-semibold">COFINS retida</b> abate a COFINS de {mes} da {f.pj.nome}.
        </>
      );
    }
    case "csll_irrf_retidos":
      if (l.csll && l.irrf)
        return (
          <>
            <b className="font-semibold">CSLL e IRRF retidos</b> abatem a CSLL e o IRPJ do {l.trimestre}. O IRRF
            abate só os 15%, nunca o adicional.
          </>
        );
      if (l.irrf)
        return (
          <>
            O <b className="font-semibold">IRRF retido</b> abate o IRPJ do {l.trimestre}: só os 15%, nunca o
            adicional.
          </>
        );
      return (
        <>
          A <b className="font-semibold">CSLL retida</b> abate a CSLL do {l.trimestre}.
        </>
      );
    case "nada_muda":
      return l.antes_do_modulo ? (
        <>
          <b className="font-semibold">Nada muda na apuração:</b> a nota é de {nomeDoMes(l.competencia_nota)}, antes do
          início da Apuração.
        </>
      ) : (
        <>
          <b className="font-semibold">Nada muda na apuração:</b> a nota já entrou em {nomeDoMes(l.competencia_nota)}.
        </>
      );
  }
}

/**
 * O efeito da baixa de um título de nota na Apuração. `valor`: o valor a dar
 * baixa (o bruto); `retidos`: o que o cliente reteve, ou `null` com a
 * retenção desligada.
 */
export function NoFiscalDoRecebimento({
  leitura,
  data,
  valor,
  retidos,
}: {
  leitura: LeituraFiscal<FiscalDoRecebimento>;
  data: string;
  valor: number;
  retidos: Retidos | null;
}) {
  if (leitura.estado === "erro") return <ErroDaLeitura mensagem={leitura.mensagem} />;
  if (leitura.estado !== "pronto" || !leitura.fiscal) return null;
  const f = leitura.fiscal;
  const e = efeitoDoRecebimento(f, data, valor, retidos);

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold">
        No fiscal
        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
          NF {f.nota.numero} · {f.emissor.nome} · {textoDoRegime(e.regime, e.regime_caixa)}
        </span>
      </p>
      <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-sky-900">
        <span className="mt-0.5 shrink-0">
          <Landmark className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 space-y-1.5">
          {e.linhas.map((l, i) => (
            <p key={i}>
              <TextoDaLinha l={l} f={f} />
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Baixa em lote
// ---------------------------------------------------------------------------

/** "a Hitlab" / "a Hitlab e a GoCrazy". */
const comArtigo = (nomes: string[]) => nomes.map((n) => `a ${n}`).join(" e ");

function vencimentosDoLote(v: Array<{ pj: string; vencimento: Vencimento }>): string | null {
  if (v.length === 0) return null;
  const datas = new Set(v.map((x) => x.vencimento.data));
  if (datas.size === 1) return dataBr(v[0].vencimento.data);
  return v.map((x) => `${dataBr(x.vencimento.data)} (${x.pj})`).join(" e ");
}

/**
 * A linha "No fiscal" da baixa em lote: o que as retenções dos pagamentos
 * geram na Apuração do mês da data do lote, e o aviso do lucro presumido
 * pelo caixa nos recebimentos. Busca o que precisa sozinha (uma leitura,
 * depois das retenções da aprovação que o lote já lê).
 *
 * - `data`: a data do movimento do lote ("AAAA-MM-DD"; vazia sem data).
 * - `pagamentos`: as parcelas de PP do lote, cada uma com o que a baixa dela
 *   vai reter (`retencoesPelaAprovacao(aberto, alíquotas).retencoes`).
 * - `titulosDeNota`: os títulos a receber de nota fiscal do lote
 *   (`titulos_receber.id`, o `alvo.id` da origem "nf").
 */
export function NoFiscalDoLote({
  data,
  pagamentos,
  titulosDeNota,
}: {
  data: string;
  pagamentos: PagamentoNoLote[];
  titulosDeNota: string[];
}) {
  const parcelas = pagamentos.map((p) => p.parcelaId);
  const chave =
    parcelas.length > 0 || titulosDeNota.length > 0 ? `${parcelas.join(",")}|${titulosDeNota.join(",")}` : null;
  const leitura = useLeituraFiscal<FiscalDoLote>(
    chave,
    () => lerFiscalDoLote({ parcelas, titulos: titulosDeNota }),
    true,
  );
  if (leitura.estado === "erro") return <ErroDaLeitura mensagem={leitura.mensagem} />;
  if (leitura.estado !== "pronto" || !leitura.fiscal) return null;
  const e = efeitoDoLote(leitura.fiscal, data, pagamentos, titulosDeNota);
  if (!e.retencoes && !e.caixa) return null;
  const caixa = "flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-[12px] text-sky-950";

  if (e.foraDaApuracao && e.competencia) {
    return (
      <div className={caixa}>
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-sky-700" />
        <span>
          <strong className="font-semibold">No fiscal:</strong> {nomeDoMes(e.competencia)} é antes do início da
          Apuração ({nomeDoMes(leitura.fiscal.primeira_competencia)}): o efeito fiscal destas baixas fica fora dela.
        </span>
      </div>
    );
  }

  const r = e.retencoes;
  const vence = r && (r.csrf > 0 || r.irrf > 0) ? vencimentosDoLote(r.vencimentos) : null;
  return (
    <>
      {e.caixa && (
        <div className={caixa}>
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-sky-700" />
          <span>
            <strong className="font-semibold">No fiscal:</strong> {comArtigo(e.caixa.pjs)}{" "}
            {e.caixa.pjs.length > 1 ? "estão" : "está"} no lucro presumido, pelo caixa: os recebimentos{" "}
            {e.caixa.pjs.length > 1 ? "delas" : "dela"} entram no PIS e na COFINS de{" "}
            {e.competencia ? nomeDoMes(e.competencia) : "—"} e na base do IRPJ e da CSLL do {e.caixa.trimestre}.
          </span>
        </div>
      )}
      {r && (
        <div className={caixa}>
          <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-sky-700" />
          <span>
            <strong className="font-semibold">No fiscal:</strong> as retenções destes pagamentos entram na Apuração de{" "}
            {e.competencia ? nomeDoMes(e.competencia) : "—"}
            {r.csrf > 0 && <> · DARF 5952 (PIS/COFINS/CSLL) {moeda(r.csrf)}</>}
            {r.irrf > 0 && <> · DARF 1708 (IRRF) {moeda(r.irrf)}</>}
            {vence && <>, vencendo em {vence}</>}
            {r.iss > 0 && <> · ISS retido {moeda(r.iss)}, na guia municipal do mês da nota</>}.
          </span>
        </div>
      )}
    </>
  );
}
