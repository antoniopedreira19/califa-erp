"use client";

/**
 * O formulário de emissão da NF (Tela 3.3), em quatro modos:
 *
 * - `origem` com uma linha  → "Faturar JOB-XXXX"
 * - `origem` com N linhas   → "Faturamento agrupado" (uma NF, vários jobs)
 * - `avulso`                → NF sem vínculo com saldo de job
 * - `leitura`               → nota já emitida, tudo bloqueado
 *
 * O bloco "Jobs nesta NF" tem duas modalidades. Em **Valor integral** cada
 * job entra com o saldo cheio da sua parcela, como texto. Em
 * **Faturamento parcial** o valor vira campo: o que não for faturado agora
 * volta para a aba Faturamento e pode ser faturado depois em outra nota.
 *
 * As parcelas do rodapé são de RECEBIMENTO desta nota — cada uma vira um
 * título em Títulos a Receber, vinculado à MESMA NF. Não existe "NF
 * programada": esse modelo foi avaliado e descartado (notas de
 * implementação §4).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  CornerDownLeft,
  Eye,
  FileCheck2,
  FileText,
  Layers,
  Paperclip,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/lib/utils";
import {
  repartirEmJobESave,
  rotuloDaQuebra,
} from "@/lib/calculos/save-faturamento";
import {
  BotaoInfo,
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import type { ContatoCobranca } from "@/lib/data/contatos-cobranca";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { emitirFaturamento, uploadNfPdf, urlAnexoNf } from "./actions";
import type { FaturamentoPendenteRow, FaturadoRow } from "./faturamento-list";

export type DrawerState =
  | { modo: "origem"; linhas: FaturamentoPendenteRow[] }
  | { modo: "avulso" }
  | { modo: "leitura"; nota: FaturadoRow };

type Parcela = { valor: number; data_vencimento: string };

const SEM_JOB = "__sem_job__";

interface Props {
  state: DrawerState;
  onClose: () => void;
  onEmitida: (mensagem: string) => void;
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  jobs: Array<{ id: string; codigo: string; nome: string }>;
  proximoNf: string;
  /**
   * O que o envio para faturamento trouxe de cada job — PO, a instrução do
   * GP sobre a descrição da nota, e a quem cobrar. É o conteúdo do botão
   * `i` de cada linha (31/08/2026).
   *
   * Chave é o `job_id`. Não tem entrada para BV (que não tem envio) nem
   * para job anterior a 31/08/2026, e isso é estado legítimo — o modal
   * sabe mostrar cada vazio.
   */
  infoPorJob: Record<string, InfoJob>;
}

/** O que o botão `i` mostra sobre um job. */
export interface InfoJob {
  po: string | null;
  descricaoNf: string | null;
  contatos: ContatoCobranca[];
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function FaturarDrawer({
  state,
  onClose,
  onEmitida,
  tipos,
  subtipos,
  empresas,
  clientes,
  fornecedores,
  jobs,
  proximoNf,
  infoPorJob,
}: Props) {
  const router = useRouter();

  const leitura = state.modo === "leitura";
  const avulso = state.modo === "avulso";
  const linhas = state.modo === "origem" ? state.linhas : [];
  const nota = state.modo === "leitura" ? state.nota : null;
  const comVinculo = state.modo === "origem" || leitura;

  const primeira = linhas[0] ?? null;
  const origemTipo: "job" | "bv" | "avulso" = primeira?.origem_tipo ?? "avulso";
  const ehBv = origemTipo === "bv";

  const [pending, startTransition] = React.useTransition();
  const [uploading, setUploading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  // O `i` de cada job da nota. Fica aqui, e não na tabela, porque a
  // instrução do GP precisa poder ser lida NA HORA de escrever a
  // descrição da nota — inclusive na agrupada, job a job (31/08/2026).
  const [info, setInfo] = React.useState<InfoFaturamento | null>(null);

  /**
   * Monta o conteúdo do modal `i` para um job desta nota.
   *
   * Job sem entrada no mapa é estado legítimo — BV não tem envio para
   * faturamento, e job anterior a 31/08/2026 foi enviado antes de o campo
   * de descrição existir. O modal mostra cada vazio com a frase certa, em
   * vez de esconder o bloco.
   */
  function montarInfo(
    jobId: string | null,
    referencia: string,
    opcoes: {
      quebra?: { job: number; save: number } | null;
      codigoJob?: string | null;
      ehBv?: boolean;
    } = {},
  ): InfoFaturamento {
    const dados = jobId ? infoPorJob[jobId] : undefined;
    // No BV nada disso é dele: PO, instrução do GP e contato de cobrança são
    // do job, e o BV é cobrado do fornecedor. O modal explica cada vazio
    // (decisão do Tiago, 31/08/2026).
    if (opcoes.ehBv) {
      return {
        referencia,
        pos: [],
        descricaoNf: null,
        contatos: [],
        quebra: opcoes.quebra ?? null,
        ehBv: true,
      };
    }
    return {
      referencia,
      pos: [{ job: opcoes.codigoJob ?? "", po: dados?.po ?? null }],
      descricaoNf: dados?.descricaoNf ?? null,
      contatos: dados?.contatos ?? [],
      quebra: opcoes.quebra ?? null,
    };
  }

  // Jobs desta NF: o usuário pode tirar um do grupo antes de emitir.
  const [removidos, setRemovidos] = React.useState<Set<string>>(new Set());
  const itensAtivos = linhas.filter(
    (l) => !removidos.has(l.envio_parcela_id ?? l.origem_id),
  );

  const [modoValor, setModoValor] = React.useState<"total" | "parcial">("total");
  const [valores, setValores] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(
      linhas.map((l) => [l.envio_parcela_id ?? l.origem_id, l.saldo]),
    ),
  );

  const [empresaId, setEmpresaId] = React.useState(
    nota?.empresa_id ?? primeira?.empresa_id ?? "",
  );
  const [numeroNf, setNumeroNf] = React.useState(nota?.numero_nf ?? proximoNf);
  const [dataEmissao, setDataEmissao] = React.useState(
    nota?.data_emissao ?? format(new Date(), "yyyy-MM-dd"),
  );
  // Classificação fiscal da nota. Saiu do envio para faturamento em
  // 31/08/2026 — lá era pedida ao GP, que não tem como saber. Quem emite a
  // nota é quem responde por ela.
  const [cnae, setCnae] = React.useState(nota?.cnae ?? "");

  const [descricao, setDescricao] = React.useState(() => {
    if (nota) return nota.descricao;
    // NF agrupada nasce em BRANCO de propósito (decisão do Tiago,
    // 31/08/2026): cada job tem a sua instrução do GP, e emendar as três
    // produziria um texto que nenhum dos clientes pediu. Quem emite lê uma
    // a uma pelo botão `i` da linha do job e escreve a descrição da nota.
    if (linhas.length > 1) return "";
    // Job único: nasce com o que o GP mandou. Sem instrução — envio
    // anterior a 31/08/2026 ou BV, que não tem envio — cai no nome do job,
    // que é o que a tela sugeria antes.
    const info = primeira ? infoPorJob[primeira.origem_id] : undefined;
    return info?.descricaoNf?.trim() || primeira?.descricao || "";
  });
  const [anexoPath, setAnexoPath] = React.useState<string | null>(
    nota?.anexo_nf_path ?? null,
  );
  const [anexoNome, setAnexoNome] = React.useState<string | null>(
    nota ? `NF-${nota.numero_nf}.pdf` : null,
  );
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);

  // Campos do avulso
  const [avClienteId, setAvClienteId] = React.useState("");
  const [avValor, setAvValor] = React.useState(0);
  const [avJobId, setAvJobId] = React.useState(SEM_JOB);
  const [avTipoId, setAvTipoId] = React.useState("");
  const [avSubtipoId, setAvSubtipoId] = React.useState("");

  const totalNf = avulso
    ? avValor
    : leitura
      ? (nota?.valor_total ?? 0)
      : itensAtivos.reduce(
          (s, l) => s + (valores[l.envio_parcela_id ?? l.origem_id] ?? 0),
          0,
        );

  const [parcelas, setParcelas] = React.useState<Parcela[]>(() => {
    if (nota) {
      // As parcelas REAIS da nota, na ordem em que foram geradas. A
      // versão anterior montava uma parcela sintética com o total, e uma
      // NF emitida em 2× reabria dizendo 1× (corrigido em 18/08/2026).
      // O fallback só existe para nota antiga sem título vinculado.
      if (nota.parcelas.length > 0) {
        return nota.parcelas.map((p) => ({
          valor: p.valor,
          data_vencimento: p.data_vencimento,
        }));
      }
      return [
        {
          valor: nota.valor_total,
          data_vencimento: nota.primeiro_vencimento ?? nota.data_emissao,
        },
      ];
    }
    return [
      {
        valor: primeira?.saldo ?? 0,
        data_vencimento:
          primeira?.data_prevista ?? format(addDays(new Date(), 30), "yyyy-MM-dd"),
      },
    ];
  });

  // Enquanto houver UMA parcela, ela espelha o total — o usuário não
  // precisa redigitar o valor a cada ajuste. Com duas ou mais, ele mandou
  // repartir e o espelho pararia por cima do que ele escreveu.
  React.useEffect(() => {
    if (leitura) return;
    setParcelas((atuais) =>
      atuais.length === 1 ? [{ ...atuais[0], valor: totalNf }] : atuais,
    );
  }, [totalNf, leitura]);

  const somaParcelas = parcelas.reduce((s, p) => s + p.valor, 0);
  const somaOk = Math.abs(somaParcelas - totalNf) < 0.01;

  const saldoTotal = itensAtivos.reduce((s, l) => s + l.saldo, 0);
  const volta = Math.max(saldoTotal - totalNf, 0);
  const diverge = state.modo === "origem" && volta > 0.01;

  const subtiposDoTipo = avTipoId
    ? subtipos.filter((s) => s.tipo_id === avTipoId && s.ativo)
    : [];
  const tiposAtivos = tipos.filter((t) => t.ativo);

  const clienteLabel = avulso
    ? (clientes.find((c) => c.id === avClienteId)?.nome ?? "Definido no bloco acima")
    : leitura
      ? (nota?.contraparte_nome ?? "—")
      : (primeira?.contraparte_nome ?? "—");

  const titulo = leitura
    ? `NF ${nota?.numero_nf} emitida`
    : avulso
      ? "Faturamento avulso"
      : itensAtivos.length > 1
        ? "Faturamento agrupado"
        : `Faturar ${primeira?.codigo ?? primeira?.descricao ?? ""}`;

  const subtitulo = leitura
    ? `Somente leitura · emitida em ${formatarData(nota?.data_emissao ?? "")} para ${nota?.contraparte_nome}.`
    : avulso
      ? "Nota fiscal sem vínculo com saldo de job — informe cliente, valor e centro de custo."
      : `Cliente ${primeira?.contraparte_nome ?? "—"} · uma única nota fiscal; o valor por job pode ser total ou parcial.`;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadNfPdf(fd);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAnexoPath(res.path);
      setAnexoNome(file.name);
    } finally {
      setUploading(false);
    }
  }

  async function alternarPdf() {
    if (pdfUrl) {
      setPdfUrl(null);
      return;
    }
    if (!anexoPath) return;
    const res = await urlAnexoNf(anexoPath);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setPdfUrl(res.url);
  }

  function trocarModo(modo: "total" | "parcial") {
    setModoValor(modo);
    setErro(null);
    if (modo === "total") {
      setValores(
        Object.fromEntries(linhas.map((l) => [l.envio_parcela_id ?? l.origem_id, l.saldo])),
      );
    }
  }

  function aplicarParcelamento(n: number) {
    const cents = Math.round(totalNf * 100);
    const base = Math.floor(cents / n);
    const sobra = cents - base * n;
    setParcelas(
      Array.from({ length: n }, (_, i) => ({
        valor: (i === n - 1 ? base + sobra : base) / 100,
        data_vencimento: format(addDays(new Date(), 30 * (i + 1)), "yyyy-MM-dd"),
      })),
    );
    setErro(null);
  }

  function handleEmitir() {
    setErro(null);

    if (!empresaId || !numeroNf.trim() || !dataEmissao) {
      setErro("Informe a empresa emissora, o número da NF e a data de emissão.");
      return;
    }
    if (avulso && (!avClienteId || !avTipoId || !avSubtipoId)) {
      setErro("No faturamento avulso, informe o cliente e o centro de custo.");
      return;
    }
    if (!avulso) {
      const excedidos = itensAtivos.filter(
        (l) => (valores[l.envio_parcela_id ?? l.origem_id] ?? 0) > l.saldo + 0.01,
      );
      if (excedidos.length > 0) {
        setErro(
          `${excedidos.map((l) => l.codigo ?? l.descricao).join(", ")}: o valor a ` +
            "faturar não pode ser maior que o saldo a faturar do job.",
        );
        return;
      }
    }
    if (descricao.trim().length < 3) {
      setErro("Escreva a descrição que vai na nota fiscal.");
      return;
    }
    if (cnae.trim().length === 0) {
      setErro("Informe o CNAE a ser utilizado na nota.");
      return;
    }
    if (!anexoPath) {
      setErro("Anexe o PDF da nota fiscal antes de emitir.");
      return;
    }
    if (totalNf <= 0) {
      setErro("O valor total da NF precisa ser maior que zero.");
      return;
    }
    if (!somaOk) {
      setErro(
        `A soma das parcelas (${formatMoney(somaParcelas)}) não fecha com o total ` +
          `da NF (${formatMoney(totalNf)}).`,
      );
      return;
    }

    const itens = avulso
      ? [
          {
            origem_tipo: "avulso" as const,
            origem_id: null,
            envio_parcela_id: null,
            valor: totalNf,
          },
        ]
      : itensAtivos.flatMap((l) => {
          const valor = valores[l.envio_parcela_id ?? l.origem_id] ?? 0;
          // A parcela do envio vale o faturamento previsto inteiro, save
          // incluído — e na nota isso sai em DOIS itens, porque cada um
          // tem destino diferente no fluxo de caixa. Job primeiro: o save
          // só começa depois que a parte do job está coberta, então
          // faturar parcial não toca no save.
          const parte = repartirEmJobESave(valor, l.saldo_proprio);
          const itensDaLinha: Array<{
            origem_tipo: "job" | "bv" | "save";
            origem_id: string | null;
            envio_parcela_id: string | null;
            valor: number;
          }> = [];
          if (parte.job > 0.004) {
            itensDaLinha.push({
              origem_tipo: l.origem_tipo,
              origem_id: l.origem_id,
              envio_parcela_id: l.envio_parcela_id,
              valor: parte.job,
            });
          }
          if (parte.save > 0.004) {
            itensDaLinha.push({
              // O save sai na nota do job que o GEROU, e é ele que o
              // `origem_id` aponta — o que separa os dois itens é o tipo.
              origem_tipo: "save",
              origem_id: l.origem_id,
              envio_parcela_id: l.envio_parcela_id,
              valor: parte.save,
            });
          }
          return itensDaLinha;
        });

    startTransition(async () => {
      const res = await emitirFaturamento({
        empresa_id: empresaId,
        origem_tipo: avulso ? "avulso" : origemTipo,
        origem_id: avulso ? null : (itensAtivos[0]?.origem_id ?? null),
        cliente_id: avulso ? avClienteId : ehBv ? null : (primeira?.cliente_id ?? null),
        fornecedor_id: ehBv ? (primeira?.fornecedor_id ?? null) : null,
        numero_nf: numeroNf.trim(),
        data_emissao: dataEmissao,
        valor_total: totalNf,
        descricao: descricao.trim(),
        cnae: cnae.trim(),
        anexo_nf_path: anexoPath,
        plano_conta_tipo_id: avulso ? avTipoId : null,
        plano_conta_subtipo_id: avulso ? avSubtipoId : null,
        itens,
        parcelas: parcelas.map((p, i) => ({
          numero: i + 1,
          valor: p.valor,
          data_vencimento: p.data_vencimento,
        })),
      });

      if (!res.ok) {
        setErro(res.message);
        return;
      }

      const parciais = itensAtivos.filter(
        (l) => (valores[l.envio_parcela_id ?? l.origem_id] ?? 0) < l.saldo - 0.01,
      );
      const detalhe = avulso
        ? ` · avulso para ${clientes.find((c) => c.id === avClienteId)?.nome ?? ""}`
        : itensAtivos.length > 1
          ? ` cobrindo ${itensAtivos.length} jobs de ${primeira?.contraparte_nome}`
          : ` · ${primeira?.codigo ?? ""}`;
      const sobra =
        parciais.length > 0
          ? ` · ${parciais.length} saldo(s) remanescente(s) de volta em Faturamento`
          : "";

      router.refresh();
      onEmitida(
        `NF ${numeroNf.trim()} emitida · ${formatMoney(totalNf)}${detalhe}${sobra}`,
      );
    });
  }

  const obrigatorio = leitura ? null : <span className="text-california-red">*</span>;

  return (
    <>
      <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent className="sm:max-w-[620px]">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="flex flex-wrap items-center gap-2.5">
            <FileText className="h-4.5 w-4.5 shrink-0 text-california-red" />
            {titulo}
            {itensAtivos.length > 1 && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                <Layers className="h-3 w-3" />
                Uma NF · {itensAtivos.length} jobs
              </span>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {/* Jobs nesta NF */}
          {comVinculo && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Jobs nesta NF
                </span>
                {!leitura && (
                  <div className="ml-auto flex items-center rounded-lg border border-border bg-muted p-0.5">
                    <BotaoModo
                      ativo={modoValor === "total"}
                      onClick={() => trocarModo("total")}
                      label="Valor integral"
                    />
                    <BotaoModo
                      ativo={modoValor === "parcial"}
                      onClick={() => trocarModo("parcial")}
                      label="Faturamento parcial"
                    />
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                {leitura
                  ? nota!.itens.map((i, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "flex items-center gap-3 px-3.5 py-3",
                          idx > 0 && "border-t border-border",
                        )}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-[13px] font-semibold">
                            {i.descricao}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {i.codigo}
                          </span>
                        </div>
                        <span className="whitespace-nowrap font-mono text-sm font-bold">
                          {formatMoney(i.valor)}
                        </span>
                        {/* O item de save aponta para o MESMO job do item
                            próprio: dois botões abririam o mesmo modal. */}
                        {i.origem_tipo !== "save" && i.origem_id && (
                          <BotaoInfo
                            className="shrink-0"
                            onClick={() =>
                              setInfo(
                                montarInfo(
                                  i.origem_id,
                                  `${i.codigo} · ${i.descricao}`,
                                  { codigoJob: i.codigo },
                                ),
                              )
                            }
                          />
                        )}
                      </div>
                    ))
                  : itensAtivos.map((l, idx) => {
                      const k = l.envio_parcela_id ?? l.origem_id;
                      const valor = valores[k] ?? 0;
                      const excede = valor > l.saldo + 0.01;
                      const parcial = !excede && valor > 0 && valor < l.saldo - 0.01;
                      // A parcela pode carregar saldo em save, e aí a nota
                      // sai com dois itens. Quem emite precisa ver isso
                      // antes de assinar (docs/decisions/028).
                      const quebra = repartirEmJobESave(valor, l.saldo_proprio);
                      const rotuloQuebra = rotuloDaQuebra(quebra);
                      return (
                        <div
                          key={k}
                          className={cn(
                            "flex items-center gap-3 px-3.5 py-3",
                            idx > 0 && "border-t border-border",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-[13px] font-semibold">
                                {l.descricao}
                              </span>
                              {parcial && (
                                <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-800">
                                  Parcial
                                </span>
                              )}
                              {rotuloQuebra && (
                                <span className="shrink-0 rounded-full border border-[#c9c6bf] bg-[#f3f2ee] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#5f5d57]">
                                  Save
                                </span>
                              )}
                            </div>
                            {rotuloQuebra && (
                              <span className="text-[11px] text-[#5f5d57]">
                                {quebra.job > 0.004 ? (
                                  <>
                                    {formatMoney(quebra.job)} do job ·{" "}
                                    <strong>{formatMoney(quebra.save)}</strong>{" "}
                                    em saldo de save
                                  </>
                                ) : (
                                  <>
                                    <strong>{formatMoney(quebra.save)}</strong>{" "}
                                    inteiros em saldo de save
                                  </>
                                )}
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {l.codigo} · parcela {l.parcela_numero}/{l.parcela_total} ·
                              valor {formatMoney(l.saldo)}
                            </span>
                            {parcial && (
                              <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold text-blue-700">
                                <CornerDownLeft className="h-3 w-3" />
                                {formatMoney(l.saldo - valor)} volta para a aba
                                Faturamento
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            {modoValor === "parcial" ? (
                              <>
                                <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Faturar agora
                                </span>
                                <div className="w-[148px]">
                                  <MoneyInput
                                    value={valor}
                                    onValueChange={(v) => {
                                      setValores((a) => ({ ...a, [k]: v }));
                                      setErro(null);
                                    }}
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setValores((a) => ({
                                      ...a,
                                      [k]: Math.round(l.saldo * 50) / 100,
                                    }));
                                    setErro(null);
                                  }}
                                  className="rounded-md border border-border bg-white px-2 py-1 text-[10.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-foreground"
                                >
                                  50% do valor
                                </button>
                              </>
                            ) : (
                              <span className="whitespace-nowrap font-mono text-sm font-bold">
                                {formatMoney(l.saldo)}
                              </span>
                            )}
                          </div>

                          <BotaoInfo
                            className="shrink-0"
                            onClick={() =>
                              setInfo(
                                montarInfo(
                                  l.job_id,
                                  `${l.codigo ?? l.descricao} · parcela ${l.parcela_numero}/${l.parcela_total}`,
                                  {
                                    quebra: quebra.save > 0.004 ? quebra : null,
                                    codigoJob: l.codigo,
                                    ehBv: l.origem_tipo === "bv",
                                  },
                                ),
                              )
                            }
                          />

                          <button
                            type="button"
                            title="Remover job desta NF"
                            disabled={itensAtivos.length === 1}
                            onClick={() =>
                              setRemovidos((s) => new Set(s).add(k))
                            }
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-white text-muted-foreground transition-colors hover:text-california-red disabled:opacity-30 disabled:hover:text-muted-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}

                <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-3.5 py-3">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Valor total da NF
                  </span>
                  <span className="ml-auto font-mono text-[17px] font-bold tabular-nums">
                    {formatMoney(totalNf)}
                  </span>
                </div>
              </div>

              {diverge && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
                  <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Faturando {formatMoney(totalNf)} de {formatMoney(saldoTotal)} — o
                    saldo remanescente de{" "}
                    <strong className="font-bold">{formatMoney(volta)}</strong> volta
                    para a aba <strong className="font-bold">Faturamento</strong> e pode
                    ser faturado depois em outra NF.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Bloco do avulso */}
          {avulso && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label>Cliente {obrigatorio}</Label>
                  <Select value={avClienteId} onValueChange={setAvClienteId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {clientes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="av-valor">Valor total da NF {obrigatorio}</Label>
                  <MoneyInput
                    id="av-valor"
                    value={avValor}
                    onValueChange={(v) => {
                      setAvValor(v);
                      setErro(null);
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <Label>Job de referência</Label>
                  <Select value={avJobId} onValueChange={setAvJobId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_JOB}>Nenhum (opcional)</SelectItem>
                      {jobs.map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.codigo} — {j.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Só para rastreio no DRE — não consome saldo a faturar do job.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Centro de custo {obrigatorio}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={avTipoId}
                      onValueChange={(v) => {
                        setAvTipoId(v);
                        setAvSubtipoId((atual) =>
                          subtipos.find((s) => s.id === atual)?.tipo_id === v ? atual : "",
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Tipo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {tiposAtivos.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.codigo} · {t.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={avSubtipoId}
                      onValueChange={setAvSubtipoId}
                      disabled={!avTipoId}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={avTipoId ? "Subtipo..." : "Escolha o tipo"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {subtiposDoTipo.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Empresa e contraparte */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label>Empresa emissora {obrigatorio}</Label>
              <Select value={empresaId} onValueChange={setEmpresaId} disabled={leitura}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{ehBv ? "Fornecedor" : "Cliente"}</Label>
              {ehBv && !leitura ? (
                <Select
                  value={primeira?.fornecedor_id ?? ""}
                  onValueChange={() => undefined}
                  disabled
                >
                  <SelectTrigger>
                    <SelectValue placeholder={clienteLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 text-[13px] text-muted-foreground">
                  <span className="truncate">{clienteLabel}</span>
                </div>
              )}
            </div>
          </div>

          {/* NF e emissão */}
          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="numero-nf">Nº NF {obrigatorio}</Label>
              <Input
                id="numero-nf"
                type="text"
                value={numeroNf}
                readOnly={leitura}
                onChange={(e) => setNumeroNf(e.target.value)}
                placeholder="Ex: 12345"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Emissão {obrigatorio}</Label>
              {leitura ? (
                <div className="flex h-9 items-center rounded-lg border border-border px-3 font-mono text-[13px]">
                  {formatarData(dataEmissao)}
                </div>
              ) : (
                <DatePicker
                  name="data_emissao"
                  defaultValue={dataEmissao}
                  onDateChange={(d) =>
                    setDataEmissao(d ? format(d, "yyyy-MM-dd") : "")
                  }
                />
              )}
            </div>
          </div>

          {/* CNAE — entre o número da nota e a descrição, a pedido do
              Tiago (31/08/2026). Antes era pedido à produção no envio; é
              classificação fiscal da nota, então é de quem a emite. */}
          <div className="space-y-1.5">
            <Label htmlFor="cnae-nf">CNAE a ser utilizado {obrigatorio}</Label>
            <Input
              id="cnae-nf"
              type="text"
              value={cnae}
              readOnly={leitura}
              onChange={(e) => setCnae(e.target.value)}
              maxLength={120}
              placeholder="Ex: 7311-4/00 — Agências de publicidade"
            />
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="descricao-nf">Descrição da NF {obrigatorio}</Label>
            <textarea
              id="descricao-nf"
              rows={2}
              value={descricao}
              readOnly={leitura}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={2000}
              placeholder="Ex: Serviços prestados em agosto/2026"
              className="w-full resize-none rounded-lg border border-border px-3 py-2.5 text-[13px] focus:border-california-red/40 focus:outline-none"
            />
            <p className="text-[11.5px] text-muted-foreground text-pretty">
              {linhas.length > 1
                ? "Cada job traz a instrução do seu gerente de projetos — leia uma a uma no botão de informações da linha e escreva aqui o texto da nota."
                : "Texto que vai na nota fiscal. Vem sugerido pela instrução que o gerente de projetos mandou no envio."}
            </p>
          </div>

          {/* Anexo */}
          <div className="space-y-1.5">
            <Label>Anexo da NF (PDF) {obrigatorio}</Label>

            {anexoNome ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[12.5px]">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate">{anexoNome}</span>
                {leitura ? (
                  <button
                    type="button"
                    onClick={alternarPdf}
                    className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors hover:border-california-red hover:text-california-red"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {pdfUrl ? "Ocultar NF" : "Visualizar NF"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAnexoPath(null);
                      setAnexoNome(null);
                    }}
                    aria-label="Remover anexo"
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  {uploading ? "Enviando..." : "Anexar PDF"}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    onChange={handleFile}
                    disabled={uploading}
                  />
                </label>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Apenas PDF · máx. 10 MB
                </p>
              </div>
            )}

            {pdfUrl && (
              <iframe
                src={pdfUrl}
                title="PDF da nota fiscal"
                className="h-[260px] w-full rounded-xl border border-border"
              />
            )}
          </div>

          {/* Parcelas do recebimento */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Parcelas do recebimento desta NF
              </span>
              {!leitura && (
                <div className="ml-auto flex gap-1.5">
                  {[2, 3, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => aplicarParcelamento(n)}
                      className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-[22px_1fr_1fr_30px] gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <span />
              <span className="text-right">Valor</span>
              <span>Vencimento</span>
              <span />
            </div>

            <div className="space-y-2">
              {parcelas.map((p, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[22px_1fr_1fr_30px] items-center gap-2"
                >
                  <span className="text-center font-mono text-[11.5px] text-muted-foreground">
                    {i + 1}
                  </span>
                  {leitura ? (
                    <div className="flex h-9 items-center justify-end rounded-lg border border-border bg-white px-2.5 font-mono text-[12.5px] font-semibold">
                      {formatMoney(p.valor)}
                    </div>
                  ) : (
                    <MoneyInput
                      value={p.valor}
                      onValueChange={(v) => {
                        setParcelas((a) =>
                          a.map((x, j) => (j === i ? { ...x, valor: v } : x)),
                        );
                        setErro(null);
                      }}
                    />
                  )}
                  {leitura ? (
                    <div className="flex h-9 items-center rounded-lg border border-border bg-white px-2.5 font-mono text-[12.5px]">
                      {formatarData(p.data_vencimento)}
                    </div>
                  ) : (
                    <DatePicker
                      name={`venc-${i}`}
                      defaultValue={p.data_vencimento}
                      onDateChange={(d) =>
                        setParcelas((a) =>
                          a.map((x, j) =>
                            j === i
                              ? { ...x, data_vencimento: d ? format(d, "yyyy-MM-dd") : "" }
                              : x,
                          ),
                        )
                      }
                    />
                  )}
                  {!leitura && (
                    <button
                      type="button"
                      disabled={parcelas.length === 1}
                      onClick={() =>
                        setParcelas((a) => a.filter((_, j) => j !== i))
                      }
                      aria-label="Remover parcela"
                      className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:text-california-red disabled:opacity-30 disabled:hover:text-muted-foreground"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2.5 border-t border-border pt-3">
              {!leitura && (
                <button
                  type="button"
                  onClick={() =>
                    setParcelas((a) => [
                      ...a,
                      {
                        valor: 0,
                        data_vencimento: format(
                          addDays(new Date(), 30 * (a.length + 1)),
                          "yyyy-MM-dd",
                        ),
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                >
                  <Plus className="h-3 w-3" /> Nova parcela
                </button>
              )}
              <span
                className={cn(
                  "ml-auto text-[11.5px] font-semibold",
                  somaOk ? "text-emerald-700" : "text-california-red",
                )}
              >
                Soma {formatMoney(somaParcelas)} / NF {formatMoney(totalNf)}
              </span>
            </div>
          </div>

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border px-6 py-3.5">
          <p className="text-[11.5px] text-muted-foreground text-pretty">
            {leitura
              ? "NF já emitida — os jobs receberam a baixa do valor faturado e as parcelas estão em Títulos a Receber."
              : avulso
                ? "Ao emitir, as parcelas desta NF entram em Títulos a Receber como faturamento avulso, sem consumir saldo de nenhum job."
                : "Ao emitir, cada job recebe a baixa do valor faturado — o que sobrar do saldo permanece aguardando faturamento — e as parcelas entram em Títulos a Receber vinculadas à mesma nota."}
          </p>
          <div className="flex items-center justify-end gap-2.5">
            {leitura ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted"
              >
                Fechar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleEmitir}
                  disabled={pending || uploading}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50"
                >
                  <FileCheck2 className="h-4 w-4" />
                  {pending ? "Emitindo..." : "Emitir NF"}
                </button>
              </>
            )}
          </div>
        </div>
      </DrawerContent>
      </Dialog>

      {/* Fora do <Dialog> do drawer, como o ConfirmDialog de Contas a Pagar:
          Radix aninha mal quando o segundo Root fica dentro do primeiro. O
          modal abre POR CIMA do drawer sem fechá-lo — quem está escrevendo a
          descrição não pode perder o formulário para consultar a instrução
          do GP. */}
      <InfoFaturamentoModal
        info={info}
        onOpenChange={(aberto) => {
          if (!aberto) setInfo(null);
        }}
      />
    </>
  );
}

function BotaoModo({
  ativo,
  onClick,
  label,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        ativo ? "bg-white text-california-red shadow-sm" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}

function formatarData(iso: string): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
