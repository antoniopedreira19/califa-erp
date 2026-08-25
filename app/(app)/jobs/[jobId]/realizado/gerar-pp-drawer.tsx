"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X, Upload, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  type PPAnexoMimetype,
} from "@/lib/types";
import {
  valorDaPP,
  dividirEmParcelas,
  parcelasFecham,
  passaDoSaldo,
  proximoVencimento,
} from "@/lib/calculos/pps-item";
import {
  reservarPedidoCompra,
  finalizarPedidoCompra,
} from "./actions-pp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemRealizadoId: string | null;
  jobId: string;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null }>;
  empresas: Array<{ id: string; razao_social: string; principal: boolean }>;
  defaultEmpresaId: string;
  itemDescricao: string;
  /** ORÇADO do item — a base da fatia. Era o realizado até 21/08/2026;
   *  agora o realizado é justamente o que estas PPs vão construir. */
  valorOrcado: number;
  quantidadeOrcada: number;
  /** Quanto do orçado ainda não está em PP. É o teto desta PP. */
  saldoDisponivel: number;
  onSuccess?: (codigo: string) => void;
}

/** Uma linha do parcelamento no formulário. */
interface ParcelaLocal {
  data_vencimento: string;
  /** Texto cru: o usuário pode estar no meio da digitação. */
  valor: string;
}

interface AnexoLocal {
  anexo_id: string;
  file: File;
  path: string;
  status: "selecionado" | "uploading" | "ok" | "erro" | "rejeitado";
  mensagem?: string;
}

const BUCKET = "pedidos-compra";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function iconePorMime(mime: string): typeof FileText {
  if (mime.startsWith("image/")) return ImageIcon;
  return FileText;
}

function defaultPrazoPagamento(): string {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return format(d, "yyyy-MM-dd");
}

function dateToIso(date: Date | null): string {
  return date ? format(date, "yyyy-MM-dd") : "";
}

/** Aceita "1.234,56" e "1234.56", como o resto das grades do sistema. */
function parseNumeroLocal(bruto: string): number {
  const s = bruto.trim();
  if (s === "") return 0;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

export function GerarPPDrawer({
  open,
  onOpenChange,
  itemRealizadoId,
  jobId,
  fornecedores,
  empresas,
  defaultEmpresaId,
  itemDescricao,
  valorOrcado,
  quantidadeOrcada,
  saldoDisponivel,
  onSuccess,
}: Props) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [pending, startTransition] = React.useTransition();

  const [ppId, setPpId] = React.useState<string | null>(null);
  const [uploadPrefix, setUploadPrefix] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const [fornecedorId, setFornecedorId] = React.useState<string>("");
  const [empresaId, setEmpresaId] = React.useState<string>(defaultEmpresaId);
  const [prazoPagamento, setPrazoPagamento] = React.useState<string>(defaultPrazoPagamento());
  // Descrição e quantidade abrem VAZIAS desde 17/08/2026: com PPs
  // parciais, herdar o nome e a quantidade do item induzia a pedir o item
  // inteiro para um fornecedor só, que é o oposto do que a tela faz.
  const [servico, setServico] = React.useState<string>("");
  const [quantidade, setQuantidade] = React.useState<string>("");
  const [especificacoes, setEspecificacoes] = React.useState<string>("");
  // Parcelas: sempre ao menos uma, e a primeira acompanha o "Prazo de
  // pagamento" — ela É o prazo, não uma linha extra.
  const [parcelas, setParcelas] = React.useState<ParcelaLocal[]>([]);

  const [anexos, setAnexos] = React.useState<AnexoLocal[]>([]);
  const abortedRef = React.useRef(false);
  // Lock sincrono contra double-submit: `pending` do useTransition ativa
  // 1 render depois, então dois cliques rápidos passam pelo disabled=pending.
  // Ref é setado ANTES do await → segundo click no mesmo tick é bloqueado.
  const submittingRef = React.useRef(false);

  // Chave para forcar remontagem do DatePicker ao reabrir o drawer
  const [drawerKey, setDrawerKey] = React.useState(0);

  // Reset ao abrir
  React.useEffect(() => {
    if (!open || !itemRealizadoId) return;
    abortedRef.current = false;
    setErro(null);
    setPpId(null);
    setUploadPrefix(null);
    setFornecedorId("");
    setEmpresaId(defaultEmpresaId);
    setPrazoPagamento(defaultPrazoPagamento());
    setServico("");
    setQuantidade("");
    setEspecificacoes("");
    setParcelas([]);
    setAnexos([]);
    setDrawerKey((k) => k + 1);

    // Reserva pp_id + upload_prefix
    (async () => {
      const res = await reservarPedidoCompra(itemRealizadoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setPpId(res.pp_id);
      setUploadPrefix(res.upload_prefix);
    })();
  }, [open, itemRealizadoId, defaultEmpresaId, itemDescricao, quantidadeOrcada]);

  // DESABILITADO — o cleanup automatico estava disparando entre upload e
  // finalizar (quando ppId mudava por qualquer re-render), apagando os
  // anexos que o user acabou de subir. Arquivos orfaos ficam no bucket ate
  // cancelamento explicito. Aceitavel no MVP; job de limpeza noturno futuro.
  //
  // React.useEffect(() => {
  //   return () => {
  //     if (!ppId || abortedRef.current) return;
  //     abortarReserva(ppId, jobId).catch(() => {});
  //   };
  // }, [ppId, jobId]);

  async function onFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;

    if (!uploadPrefix) {
      setErro(
        "Aguarde: a preparação da PP ainda não terminou. Tente novamente em 2 segundos.",
      );
      return;
    }

    const somaAtual = anexos.reduce((s, a) => s + a.file.size, 0);
    let somaAcumulada = somaAtual;
    // Cada arquivo vira uma linha imediatamente — mesmo rejeitados.
    // User sempre vê feedback do que aconteceu com cada arquivo escolhido.
    const novos: AnexoLocal[] = [];

    for (const file of Array.from(files)) {
      const anexo_id = crypto.randomUUID();
      const base = { anexo_id, file, path: "" };

      if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as PPAnexoMimetype)) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: `Tipo não aceito (${file.type || "sem mimetype"}).`,
        });
        continue;
      }
      if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: `Excede 8 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        });
        continue;
      }
      if (somaAcumulada + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: "Total de anexos excederia 25 MB.",
        });
        continue;
      }
      somaAcumulada += file.size;
      const path = `${uploadPrefix}${anexo_id}-${sanitizeName(file.name)}`;
      novos.push({ ...base, path, status: "selecionado" });
    }

    // Mostra TODOS (aceitos + rejeitados) na lista imediatamente
    setAnexos((prev) => [...prev, ...novos]);

    const aceitos = novos.filter((n) => n.status === "selecionado");
    if (aceitos.length === 0) return;

    // Marca aceitos como "uploading" e sobe
    setAnexos((prev) =>
      prev.map((p) =>
        aceitos.some((a) => a.anexo_id === p.anexo_id)
          ? { ...p, status: "uploading" }
          : p,
      ),
    );

    await Promise.all(
      aceitos.map(async (a) => {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(a.path, a.file, {
            contentType: a.file.type,
            upsert: false,
          });
        setAnexos((prev) =>
          prev.map((p) =>
            p.anexo_id === a.anexo_id
              ? {
                  ...p,
                  status: error ? "erro" : "ok",
                  mensagem: error?.message,
                }
              : p,
          ),
        );
      }),
    );
  }

  async function removerAnexo(anexo_id: string) {
    const alvo = anexos.find((a) => a.anexo_id === anexo_id);
    if (!alvo) return;
    setAnexos((prev) => prev.filter((p) => p.anexo_id !== anexo_id));
    // Só remove do bucket se o upload chegou lá — "selecionado" e "rejeitado"
    // ainda não subiram nada; "uploading" tá em voo e pode não ter finalizado.
    if (alvo.status === "ok") {
      await supabase.storage.from(BUCKET).remove([alvo.path]);
    }
  }

  // ---- Valor da PP: quantidade × R$/un do orçado ----
  // Não existe campo de valor. A PP é uma fatia do orçado do item, e
  // é a quantidade que diz o tamanho da fatia (design "PPs Parciais").
  const qtdNum = parseNumeroLocal(quantidade);
  const valorPP =
    qtdNum > 0 ? valorDaPP(qtdNum, valorOrcado, quantidadeOrcada) : 0;

  /** Refaz as parcelas mantendo as datas que já existem. */
  const montarParcelas = React.useCallback(
    (n: number, primeiraData: string, valor: number, atuais: ParcelaLocal[]) => {
      const valores = dividirEmParcelas(valor, n);
      const datas: string[] = [];
      let corrente = primeiraData;
      for (let i = 0; i < n; i++) {
        // A 1ª é sempre o "Prazo de pagamento". Da 2ª em diante mantém o
        // que o usuário já tinha ajustado; só as novas nascem de +1 mês.
        datas.push(i === 0 ? primeiraData : (atuais[i]?.data_vencimento ?? corrente));
        corrente = proximoVencimento(datas[i]);
      }
      return datas.map((data, i) => ({
        data_vencimento: data,
        valor: valores[i].toFixed(2).replace(".", ","),
      }));
    },
    [],
  );

  function mudarNumeroDeParcelas(bruto: string) {
    const n = Math.max(1, Math.min(36, Math.floor(Number(bruto) || 1)));
    if (n === 1) {
      setParcelas([]);
      return;
    }
    setParcelas(montarParcelas(n, prazoPagamento, valorPP, parcelas));
  }

  function mudarPrazo(iso: string) {
    setPrazoPagamento(iso);
    if (parcelas.length > 0) {
      // Mover a 1ª data reconstrói a escada: as seguintes acompanham.
      setParcelas(montarParcelas(parcelas.length, iso, valorPP, []));
    }
  }

  function mudarQuantidade(bruto: string) {
    setQuantidade(bruto);
    if (parcelas.length > 0) {
      const novo = parseNumeroLocal(bruto);
      const valor =
        novo > 0 ? valorDaPP(novo, valorOrcado, quantidadeOrcada) : 0;
      // Valor da PP mudou: redivide os valores, preservando as datas
      // (cartão ou mês a mês conforme configuração atual).
      const valores = dividirEmParcelas(valor, parcelas.length);
      setParcelas((prev) =>
        prev.map((p, i) => ({
          ...p,
          valor: valores[i].toFixed(2).replace(".", ","),
        })),
      );
    }
  }

  /** O que vai para a action: PP sem parcelamento manda 1 parcela. */
  function parcelasParaEnvio(): Array<{ data_vencimento: string; valor: number }> {
    if (parcelas.length === 0) {
      return [{ data_vencimento: prazoPagamento, valor: valorPP }];
    }
    return parcelas.map((p) => ({
      data_vencimento: p.data_vencimento,
      valor: parseNumeroLocal(p.valor),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!ppId || !itemRealizadoId) return;
    if (!fornecedorId) {
      setErro("Escolha um fornecedor.");
      return;
    }
    if (!empresaId) {
      setErro("Escolha uma empresa emissora.");
      return;
    }
    if (!prazoPagamento) {
      setErro("Prazo de pagamento é obrigatório.");
      return;
    }
    if (!servico.trim()) {
      setErro("Serviço é obrigatório.");
      return;
    }
    if (qtdNum <= 0) {
      setErro("Quantidade deve ser um número positivo.");
      return;
    }
    if (valorPP <= 0) {
      setErro("O valor desta PP ficaria zerado. Confira a quantidade.");
      return;
    }
    if (passaDoSaldo(valorPP, saldoDisponivel)) {
      setErro(
        `Esta PP (${formatCurrency(valorPP, "BRL")}) passa do saldo do item. Máximo aceito: ${formatCurrency(saldoDisponivel, "BRL")}.`,
      );
      return;
    }
    const parcelasEnvio = parcelasParaEnvio();
    if (parcelasEnvio.some((p) => !p.data_vencimento)) {
      setErro("Toda parcela precisa de uma data de vencimento.");
      return;
    }
    if (!parcelasFecham(parcelasEnvio.map((p) => p.valor), valorPP)) {
      setErro(
        `A soma das parcelas precisa fechar com o valor da PP (${formatCurrency(valorPP, "BRL")}).`,
      );
      return;
    }
    const anexosOk = anexos.filter((a) => a.status === "ok");
    if (anexosOk.length === 0) {
      setErro("Pelo menos um anexo com upload concluído é obrigatório.");
      return;
    }
    if (anexos.some((a) => a.status === "uploading" || a.status === "selecionado")) {
      setErro("Aguarde os uploads terminarem antes de gerar a PP.");
      return;
    }

    // Lock síncrono contra double-submit (pending do useTransition ativa 1
    // render depois — clique duplo rápido passa pelo disabled=pending).
    if (submittingRef.current) return;
    submittingRef.current = true;

    startTransition(async () => {
      try {
        const res = await finalizarPedidoCompra(
          ppId,
          {
            fornecedor_id: fornecedorId,
            empresa_id: empresaId,
            prazo_pagamento: prazoPagamento,
            servico: servico.trim(),
            quantidade: qtdNum,
            especificacoes: especificacoes.trim() || null,
            parcelas: parcelasEnvio,
          },
          anexosOk.map((a) => ({
            anexo_id: a.anexo_id,
            path: a.path,
            nome_original: a.file.name,
            tamanho_bytes: a.file.size,
            mimetype: a.file.type as PPAnexoMimetype,
          })),
          itemRealizadoId,
        );

        if (!res.ok) {
          setErro(res.message);
          return;
        }

        // Sucesso: fecha drawer + toast + refresh imediato
        // router.refresh() PRECISA ficar fora do startTransition atual pra
        // ser priorizado corretamente pelo React scheduler — dentro dele o
        // re-render dos server components fica low-priority e demora.
        abortedRef.current = true;
        onSuccess?.(res.codigo);
        onOpenChange(false);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  // Detecta sucesso e dispara refresh FORA do startTransition principal
  // (via ref pra evitar dep instável no useEffect).
  React.useEffect(() => {
    if (!open) {
      // Se drawer fechou por sucesso (abortedRef=true), refresh a página
      // pra pegar a nova PP e os ícones Ver/Cancelar aparecerem na trilha.
      if (abortedRef.current) {
        router.refresh();
      }
    }
  }, [open, router]);

  if (!open || !itemRealizadoId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>Gerar Pedido de Produção</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 space-y-4 p-6 overflow-y-auto">
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span>{erro}</span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Item</p>
              <p className="font-medium">{itemDescricao}</p>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Orçado do item</p>
                  <p className="font-mono font-semibold">
                    {formatCurrency(valorOrcado, "BRL")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Máximo aceito</p>
                  <p className="font-mono font-semibold">
                    {formatCurrency(saldoDisponivel, "BRL")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Valor desta PP</p>
                  <p
                    className={cn(
                      "font-mono font-semibold",
                      passaDoSaldo(valorPP, saldoDisponivel) &&
                        "text-california-red",
                    )}
                  >
                    {valorPP > 0 ? formatCurrency(valorPP, "BRL") : "—"}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                O valor sai da quantidade:{" "}
                {quantidadeOrcada > 0
                  ? `${formatCurrency(valorOrcado / quantidadeOrcada, "BRL")} por unidade do orçado`
                  : "o item não tem quantidade orçada"}
                .
              </p>
            </div>

            {/* Fornecedor & Empresa */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fornecedor & Empresa
              </h3>

              <div>
                <label className="text-xs font-medium">Fornecedor *</label>
                <Select value={fornecedorId} onValueChange={setFornecedorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o fornecedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.razao_social ?? f.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium">Empresa emissora *</label>
                <Select value={empresaId} onValueChange={setEmpresaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.razao_social}
                        {e.principal ? " (principal)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Prazo e Parcelas dividem a linha: o prazo é o vencimento
                  da 1ª parcela, e o número ao lado diz em quantas vezes
                  o fornecedor recebe. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Prazo de pagamento *</label>
                  <DatePicker
                    key={`prazo-${drawerKey}`}
                    name="prazo_pagamento"
                    defaultValue={prazoPagamento}
                    onDateChange={(date) => mudarPrazo(dateToIso(date))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Parcelas</label>
                  <Input
                    value={String(Math.max(parcelas.length, 1))}
                    onChange={(e) => mudarNumeroDeParcelas(e.target.value)}
                    className="no-spinner"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {parcelas.length > 1 && (
                <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground">
                    Vencimentos sugeridos de mês em mês e valores divididos
                    igualmente — os dois são editáveis. A soma tem que fechar
                    com o valor da PP.
                  </p>
                  {parcelas.map((p, i) => (
                    <div key={i} className="grid grid-cols-[28px_1fr_1fr] items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {i + 1}/{parcelas.length}
                      </span>
                      <DatePicker
                        key={`parcela-${drawerKey}-${i}`}
                        name={`parcela_${i}_vencimento`}
                        defaultValue={p.data_vencimento}
                        // A 1ª acompanha o Prazo de pagamento acima: mudar
                        // nos dois lugares deixaria os dois campos brigando.
                        disabled={i === 0}
                        onDateChange={(date) =>
                          setParcelas((prev) =>
                            prev.map((q, j) =>
                              j === i
                                ? { ...q, data_vencimento: dateToIso(date) }
                                : q,
                            ),
                          )
                        }
                      />
                      <Input
                        value={p.valor}
                        onChange={(e) =>
                          setParcelas((prev) =>
                            prev.map((q, j) =>
                              j === i ? { ...q, valor: e.target.value } : q,
                            ),
                          )
                        }
                        className="no-spinner text-right font-mono"
                        inputMode="decimal"
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-border pt-2 text-[11px]">
                    <span className="text-muted-foreground">Soma das parcelas</span>
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        !parcelasFecham(
                          parcelas.map((p) => parseNumeroLocal(p.valor)),
                          valorPP,
                        ) && "text-california-red",
                      )}
                    >
                      {formatCurrency(
                        parcelas.reduce((s, p) => s + parseNumeroLocal(p.valor), 0),
                        "BRL",
                      )}{" "}
                      / {formatCurrency(valorPP, "BRL")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Servico */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Serviço
              </h3>

              <div>
                <label className="text-xs font-medium">Descrição do serviço *</label>
                <Input
                  value={servico}
                  onChange={(e) => setServico(e.target.value)}
                  maxLength={500}
                />
              </div>

              <div>
                <label className="text-xs font-medium">Quantidade *</label>
                <Input
                  value={quantidade}
                  onChange={(e) => mudarQuantidade(e.target.value)}
                  className="no-spinner"
                  inputMode="decimal"
                  placeholder={
                    quantidadeOrcada > 0
                      ? `Até ${quantidadeOrcada} do orçado`
                      : ""
                  }
                />
              </div>

              <div>
                <label className="text-xs font-medium">Especificações (opcional)</label>
                <textarea
                  value={especificacoes}
                  onChange={(e) => setEspecificacoes(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full rounded border border-border p-2 text-sm"
                />
              </div>
            </div>

            {/* Anexos */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Anexos * (min 1, max 8MB/arquivo, 25MB total)
              </h3>

              {uploadPrefix ? (
                <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border p-3 text-sm hover:border-california-red/40">
                  <Upload className="h-4 w-4" />
                  <span>Selecionar arquivos (PDF ou imagem)</span>
                  <input
                    type="file"
                    multiple
                    accept={PP_ANEXO_MIMETYPES_ACEITOS.join(",")}
                    onChange={(e) => onFileSelect(e.target.files)}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex items-center gap-2 rounded border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground cursor-not-allowed">
                  <Upload className="h-4 w-4" />
                  <span>Preparando... aguarde um instante</span>
                </div>
              )}

              {anexos.length > 0 && (
                <ul className="space-y-1">
                  {anexos.map((a) => {
                    const Icon = iconePorMime(a.file.type);
                    const cor =
                      a.status === "erro" || a.status === "rejeitado"
                        ? "border-california-red/40 bg-california-red/5"
                        : a.status === "ok"
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-border bg-muted/30";
                    const label =
                      a.status === "selecionado"
                        ? "aguardando..."
                        : a.status === "uploading"
                          ? "enviando..."
                          : a.status === "ok"
                            ? "ok"
                            : a.status === "rejeitado"
                              ? `rejeitado: ${a.mensagem ?? "motivo desconhecido"}`
                              : (a.mensagem ?? "falha");
                    return (
                      <li
                        key={a.anexo_id}
                        className={cn(
                          "flex items-center gap-2 rounded border p-2 text-xs",
                          cor,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1 truncate">{a.file.name}</span>
                        <span className="text-muted-foreground">
                          {(a.file.size / 1024).toFixed(0)} KB
                        </span>
                        <span
                          className={cn(
                            "text-xs",
                            a.status === "erro" || a.status === "rejeitado"
                              ? "text-california-red"
                              : "text-muted-foreground",
                          )}
                        >
                          {label}
                        </span>
                        <button
                          type="button"
                          onClick={() => removerAnexo(a.anexo_id)}
                          className="text-california-red hover:opacity-70"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || !ppId || anexos.some((a) => a.status === "uploading")}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
            >
              {pending ? "Gerando..." : "Gerar PP"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
