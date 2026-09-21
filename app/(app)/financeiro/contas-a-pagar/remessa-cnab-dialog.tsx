"use client";

/**
 * Dialog de geração de remessa CNAB Santander.
 *
 * Fluxo pro usuário:
 *   1. Escolhe a conta bancária de débito (só Santander com convênio configurado).
 *   2. Escolhe a data de pagamento (aplica pra todos os itens do arquivo).
 *   3. Marca os títulos que quer incluir (multi-select).
 *   4. Confirma → server action monta o arquivo, grava rastreio.
 *   5. Browser baixa o `.REM` automaticamente.
 *
 * Itens rejeitados (destinatário sem PIX/banco, valor zero, etc) aparecem
 * numa lista separada depois da geração.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Download,
  Landmark,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import {
  gerarRemessaCnab,
  type CnabOrigemTipo,
  type CnabItemRejeitado,
  type CnabFormaEscolhida,
} from "./actions-cnab";

// ---------------------------------------------------------------------
// Tipos (dados vindos do server component)
// ---------------------------------------------------------------------

export interface ContaSantanderElegivel {
  id: string;
  nome: string;
  agencia: string;
  numero_conta: string;
  numero_conta_dv: string;
}

export interface TituloElegivelParaRemessa {
  origemTipo: CnabOrigemTipo;
  origemId: string;
  descricao: string;
  valor: number;
  destinatarioNome: string;
  destinatarioTipo: "fornecedor" | "colaborador" | "cliente";
  /** Indicação visual — o gerador vai revalidar. */
  temPix: boolean;
  temBanco: boolean;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function baixarBase64ComoArquivo(base64: string, nome: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "text/plain;charset=us-ascii" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------

interface Props {
  contasSantander: ContaSantanderElegivel[];
  titulos: TituloElegivelParaRemessa[];
  /** True se o usuário pode gerar remessa (permissão). */
  canGerar: boolean;
}

export function ExportarRemessaCnabDialog({
  contasSantander,
  titulos,
  canGerar,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [rejeitados, setRejeitados] = React.useState<CnabItemRejeitado[]>([]);
  const [sucesso, setSucesso] = React.useState<{
    sequencial: number;
    qtd: number;
    valorTotal: number;
    nomeArquivo: string;
  } | null>(null);

  const [contaId, setContaId] = React.useState<string>("");
  const [dataPagamento, setDataPagamento] = React.useState<string>(hoje());
  const [selecionados, setSelecionados] = React.useState<Set<string>>(new Set());
  /** Forma escolhida por título (chave = "origemTipo:origemId"). Vazio =
   *  usa a preferência automática do gerador (PIX se cadastrado, senão banco). */
  const [formaPorTitulo, setFormaPorTitulo] = React.useState<
    Map<string, CnabFormaEscolhida>
  >(new Map());

  const podeAbrir = canGerar && contasSantander.length > 0;

  function reset() {
    setError(null);
    setRejeitados([]);
    setSucesso(null);
    setContaId(contasSantander[0]?.id ?? "");
    setDataPagamento(hoje());
    setSelecionados(new Set());
    setFormaPorTitulo(new Map());
  }

  function handleOpenChange(next: boolean) {
    if (next) reset();
    setOpen(next);
  }

  function toggleTitulo(chave: string) {
    setSelecionados((prev) => {
      const s = new Set(prev);
      if (s.has(chave)) s.delete(chave);
      else s.add(chave);
      return s;
    });
  }

  function marcarTodos() {
    setSelecionados(
      new Set(titulos.map((t) => `${t.origemTipo}:${t.origemId}`)),
    );
  }
  function desmarcarTodos() {
    setSelecionados(new Set());
  }

  const totalSelecionado = titulos
    .filter((t) => selecionados.has(`${t.origemTipo}:${t.origemId}`))
    .reduce((acc, t) => acc + t.valor, 0);

  function handleGerar() {
    setError(null);
    setRejeitados([]);
    setSucesso(null);

    if (!contaId) {
      setError("Selecione a conta bancária de débito.");
      return;
    }
    if (selecionados.size === 0) {
      setError("Marque ao menos um título.");
      return;
    }

    const itens = titulos
      .filter((t) => selecionados.has(`${t.origemTipo}:${t.origemId}`))
      .map((t) => {
        const chave = `${t.origemTipo}:${t.origemId}`;
        return {
          origemTipo: t.origemTipo,
          origemId: t.origemId,
          formaEscolhida: formaPorTitulo.get(chave),
        };
      });

    startTransition(async () => {
      const res = await gerarRemessaCnab({
        contaBancariaId: contaId,
        itens,
        dataPagamento,
      });

      if (!res.ok) {
        setError(res.message);
        if (res.itensRejeitados) setRejeitados(res.itensRejeitados);
        return;
      }

      baixarBase64ComoArquivo(res.conteudoBase64, res.nomeArquivo);
      setSucesso({
        sequencial: res.sequencial,
        qtd: res.qtdItens,
        valorTotal: res.valorTotal,
        nomeArquivo: res.nomeArquivo,
      });
      setRejeitados(res.itensRejeitados);
      router.refresh();
    });
  }

  const semTitulos = titulos.length === 0;
  const habilitado = podeAbrir && !semTitulos;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={!habilitado}
          title={
            !canGerar
              ? "Sem permissão"
              : contasSantander.length === 0
                ? "Nenhuma conta Santander configurada"
                : semTitulos
                  ? "Nenhum título a pagar disponível"
                  : "Exportar remessa Santander"
          }
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-california-red bg-white px-4 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red hover:text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-california-red"
        >
          <Landmark className="h-4 w-4" />
          Exportar remessa Santander
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl p-0 gap-0">
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-california-red" />
            Exportar remessa CNAB Santander
          </DialogTitle>
          <DialogDescription>
            Selecione a conta de débito, a data de pagamento e os títulos que
            devem entrar no arquivo. O `.REM` é baixado no navegador e o
            registro fica gravado no histórico de remessas.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col">
          {sucesso ? (
            <div className="p-6 space-y-5">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-800">
                  Arquivo gerado com sucesso.
                </p>
                <dl className="mt-3 grid gap-2 text-xs text-emerald-900 sm:grid-cols-2">
                  <div>
                    <dt className="text-emerald-700">Nome do arquivo</dt>
                    <dd className="font-mono">{sucesso.nomeArquivo}</dd>
                  </div>
                  <div>
                    <dt className="text-emerald-700">Sequencial</dt>
                    <dd className="font-mono">
                      {String(sucesso.sequencial).padStart(6, "0")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-emerald-700">Títulos incluídos</dt>
                    <dd>{sucesso.qtd}</dd>
                  </div>
                  <div>
                    <dt className="text-emerald-700">Valor total</dt>
                    <dd>{formatBRL(sucesso.valorTotal)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-emerald-800">
                  Faça login no internet banking do Santander e importe o
                  arquivo `{sucesso.nomeArquivo}`.
                </p>
              </div>
              {rejeitados.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">
                    {rejeitados.length} título(s) ficou(aram) de fora
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-amber-900">
                    {rejeitados.map((r, i) => (
                      <li key={i}>
                        <span className="font-mono text-[10px] text-amber-700">
                          {r.origemTipo}:{r.origemId.slice(0, 8)}…
                        </span>{" "}
                        {r.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="conta_bancaria">Conta de débito</Label>
                  <Select value={contaId} onValueChange={setContaId}>
                    <SelectTrigger id="conta_bancaria">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {contasSantander.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome} — Ag. {c.agencia} / Cc.{" "}
                          {c.numero_conta}-{c.numero_conta_dv}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Data de pagamento</Label>
                  <DatePicker
                    name="data_pagamento_visual"
                    defaultValue={dataPagamento}
                    onDateChange={(d) =>
                      setDataPagamento(
                        d ? d.toISOString().slice(0, 10) : hoje(),
                      )
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Títulos disponíveis ({titulos.length})</Label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={marcarTodos}
                      className="text-california-red hover:underline"
                    >
                      Marcar todos
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      onClick={desmarcarTodos}
                      className="text-muted-foreground hover:underline"
                    >
                      Desmarcar
                    </button>
                  </div>
                </div>

                {titulos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                    Nenhum título a pagar disponível pra remessa nesta conta.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-muted/40 text-xs">
                        <tr>
                          <th className="w-10 px-3 py-2"></th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Destinatário
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                            Descrição
                          </th>
                          <th className="w-40 px-3 py-2 text-left font-medium text-muted-foreground">
                            Forma
                          </th>
                          <th className="w-32 px-3 py-2 text-right font-medium text-muted-foreground">
                            Valor
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {titulos.map((t) => {
                          const chave = `${t.origemTipo}:${t.origemId}`;
                          const marcado = selecionados.has(chave);
                          const disponivel = t.temPix || t.temBanco;
                          return (
                            <tr
                              key={chave}
                              onClick={() => disponivel && toggleTitulo(chave)}
                              className={
                                "border-b border-border last:border-0 transition-colors " +
                                (disponivel
                                  ? "cursor-pointer hover:bg-muted/40"
                                  : "opacity-50 cursor-not-allowed")
                              }
                            >
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={marcado}
                                  disabled={!disponivel}
                                  onChange={() => toggleTitulo(chave)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-4 w-4 accent-california-red"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <div className="text-sm font-medium">
                                  {t.destinatarioNome}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {t.destinatarioTipo}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">
                                {t.descricao}
                              </td>
                              <td
                                className="px-3 py-2 text-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {t.temPix && t.temBanco ? (
                                  <select
                                    value={formaPorTitulo.get(chave) ?? "pix"}
                                    onChange={(e) => {
                                      const novaForma = e.target.value as CnabFormaEscolhida;
                                      setFormaPorTitulo((prev) => {
                                        const m = new Map(prev);
                                        m.set(chave, novaForma);
                                        return m;
                                      });
                                    }}
                                    className="rounded border border-border bg-white px-2 py-1 text-xs focus:border-california-red focus:outline-none"
                                  >
                                    <option value="pix">PIX</option>
                                    <option value="banco">TED/Crédito</option>
                                  </select>
                                ) : t.temPix ? (
                                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                                    PIX
                                  </span>
                                ) : t.temBanco ? (
                                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                                    TED/Crédito
                                  </span>
                                ) : (
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                                    Sem dados
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatBRL(t.valor)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {selecionados.size > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      {selecionados.size} título(s) selecionado(s)
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatBRL(totalSelecionado)}
                    </span>
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              {sucesso ? "Fechar" : "Cancelar"}
            </button>
            {!sucesso && (
              <button
                type="button"
                onClick={handleGerar}
                disabled={pending || selecionados.size === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
              >
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Gerar e baixar
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
