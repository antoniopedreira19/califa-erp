"use client";

/**
 * A tela de revisão da linha da folha no financeiro (26/11/2026).
 *
 * Mesmo padrão da PP (`pp-tela.tsx`): a NF ou o recibo que o colaborador
 * anexou fica à esquerda, no `PainelDocumento`, e a decisão do financeiro
 * (valor, pagamento, alocação, aprovar/reprovar) fica à direita — assim
 * o valor é conferido contra o documento sem trocar de tela. O desenho
 * substitui a drawer antiga, que só mostrava o nome do arquivo e um
 * botão "Baixar".
 *
 * Linhas que não exigem NF (CLT importado da contabilidade) seguem com a
 * coluna da esquerda vazia, com o aviso correspondente — a tela continua
 * cheia só do lado direito, sem piscar entre dois layouts.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Paperclip,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogTitle,
  DialogDescription,
  FullscreenContent,
} from "@/components/ui/dialog";
import {
  PainelDocumento,
  VazioDoPainel,
  enderecoParaVisualizar,
} from "@/components/documentos/painel-documento";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MoedaInput } from "@/components/ui/moeda-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { baixarNfColaborador } from "@/lib/nf/anexos-actions";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";
import type { Empresa } from "@/lib/types";
import { folhaLinhaStatusLabel, tipoContratacaoLabel } from "@/lib/types";
import {
  aprovarLinhaFolha,
  baixarReciboFeriasFinanceiro,
  reprovarLinhaFolha,
  salvarPagamentoDaFolha,
  type PagamentoDaFolhaInput,
} from "./actions-folhas";
import type { FolhaLinhaFinanceiro } from "./people-list-types";
import {
  PagamentoDaFolha,
  completarNomeDoBanco,
  pagamentoInicial,
} from "./pagamento-da-folha";

type AlocEdit = {
  key: string;
  empresa_id: string;
  regional_id: string;
  percentual: string;
};

type Expandido = "nf" | "dados" | null;

function formatBRL(v: string | number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(v));
}

/** Etiqueta do painel da esquerda — recibo nas linhas em que o documento é
 *  recibo (CLT+Recibo mensal, férias CLT da contabilidade, abono CLT), NF
 *  nas demais (fluxo California). */
function tituloDoDocumento(
  linha: FolhaLinhaFinanceiro,
): { titulo: string; legendaPadrao: string } {
  const et = linha.escopo_tipo;
  if (et === "ferias_usufruto" || et === "ferias_abono") {
    const label = et === "ferias_abono" ? "Abono" : "Férias";
    if (linha.origem === "contabilidade") {
      return {
        titulo: `Recibo de ${label}`,
        legendaPadrao: "Nenhum recibo anexado",
      };
    }
    return { titulo: `NF de ${label}`, legendaPadrao: "Nenhuma NF anexada" };
  }
  if (linha.colaborador.tipo_contratacao === "clt_recibo") {
    return { titulo: "Recibo do mês", legendaPadrao: "Nenhum recibo anexado" };
  }
  return { titulo: "Nota fiscal do mês", legendaPadrao: "Nenhuma NF anexada" };
}

/** Pega só o nome do arquivo de um path salvo em storage (`tenant/colab/.../x.pdf`). */
function nomeArquivoDaUrl(u: string | null): string | null {
  if (!u) return null;
  const partes = u.split("/");
  return partes[partes.length - 1] ?? null;
}

export function RevisarFolhaDrawer({
  linha,
  empresas,
  regionais,
  open,
  onOpenChange,
}: {
  linha: FolhaLinhaFinanceiro;
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  // Salvar o pagamento não é aprovar: estado próprio, para o botão de
  // aprovar não dizer "Aprovando..." enquanto grava a chave.
  const [salvandoPagamento, startSalvarPagamento] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [alocacoes, setAlocacoes] = React.useState<AlocEdit[]>([]);
  const [modoReprova, setModoReprova] = React.useState(false);
  const [motivoReprova, setMotivoReprova] = React.useState("");
  const [salarioBase, setSalarioBase] = React.useState<string>("");
  const [editandoPagamento, setEditandoPagamento] = React.useState(false);
  const [pagamento, setPagamento] = React.useState<PagamentoDaFolhaInput>(() =>
    pagamentoInicial(linha.colaborador),
  );
  const [errosPagamento, setErrosPagamento] = React.useState<
    Record<string, string[]>
  >({});
  // Documento anexo: URL assinada do PDF para o painel da esquerda.
  const [urlNf, setUrlNf] = React.useState<string | null>(null);
  const [carregandoNf, setCarregandoNf] = React.useState(false);
  const [expandido, setExpandido] = React.useState<Expandido>(null);

  // Reinicia só quando abre ou troca de linha. Depender do objeto `linha`
  // apagaria o que foi digitado a cada router.refresh() — e salvar o
  // pagamento faz refresh.
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setModoReprova(false);
    setMotivoReprova("");
    setSalarioBase(linha.salario_base);
    setAlocacoes(
      linha.alocacoes.map((a, i) => ({
        key: `${a.id}-${i}`,
        empresa_id: a.empresa_id,
        regional_id: a.regional_id,
        percentual: String(a.percentual),
      })),
    );
    setEditandoPagamento(false);
    setPagamento(pagamentoInicial(linha.colaborador));
    setErrosPagamento({});
    setExpandido(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, linha.id]);

  // Puxa a URL assinada do anexo quando a tela abre. Dois caminhos: NF
  // em colaboradores_nf_anexos (fluxo PJ/MEI/recibo mensal) ou recibo em
  // folhas_pagamento.anexo_url (fluxo CLT férias contabilidade, cada um
  // num bucket próprio). Depende do id do anexo (e não do objeto `linha`)
  // pra `router.refresh()` não refazer a URL à toa.
  const nfId = linha.nf?.id ?? null;
  const reciboFolhaUrl = linha.folha_anexo_url ?? null;
  const folhaId = linha.id;
  React.useEffect(() => {
    if (!open) {
      setUrlNf(null);
      return;
    }
    let cancelado = false;
    if (reciboFolhaUrl) {
      setCarregandoNf(true);
      setUrlNf(null);
      (async () => {
        const r = await baixarReciboFeriasFinanceiro(folhaId);
        if (cancelado) return;
        if (r.ok) setUrlNf(r.url);
        else setError(r.message);
        setCarregandoNf(false);
      })();
    } else if (nfId) {
      setCarregandoNf(true);
      setUrlNf(null);
      (async () => {
        const r = await baixarNfColaborador(nfId);
        if (cancelado) return;
        if (r.ok) setUrlNf(r.url);
        else setError(r.message);
        setCarregandoNf(false);
      })();
    } else {
      setUrlNf(null);
    }
    return () => {
      cancelado = true;
    };
  }, [open, nfId, reciboFolhaUrl, folhaId]);

  const podeAgir = linha.status === "enviada";
  const ehFerias =
    linha.escopo_tipo === "ferias_usufruto" ||
    linha.escopo_tipo === "ferias_abono";
  const exigeNfPj =
    linha.origem === "california" &&
    ["pj", "mei", "clt_recibo"].includes(
      linha.colaborador.tipo_contratacao,
    );
  const exigeReciboFeriasContabil = ehFerias && linha.origem === "contabilidade";
  const exigeDocumento = exigeNfPj || exigeReciboFeriasContabil;
  const temAnexo = linha.nf != null || linha.folha_anexo_url != null;
  const exigeDocumentoSemAnexo = exigeDocumento && !temAnexo;

  const soma = alocacoes.reduce(
    (acc, a) => acc + (Number(String(a.percentual).replace(",", ".")) || 0),
    0,
  );
  // Qualquer folha (salário, férias, 13º) agora nasce com alocação
  // replicada do pacote vigente (RPC replicar_alocacao_para_folha).
  // Linhas sem alocacoes[] só chegam como fallback defensivo (CLT
  // importado sem pacote vigente); pra essas, a validação de soma 100
  // não se aplica.
  const temAlocacoes = alocacoes.length > 0;
  const somaOk = !temAlocacoes || Math.abs(soma - 100) < 0.01;
  const valorMudou =
    salarioBase !== "" &&
    Math.round(Number(salarioBase) * 100) !==
      Math.round(Number(linha.salario_base) * 100);

  function atualizar(index: number, patch: Partial<AlocEdit>) {
    setAlocacoes((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  }
  function adicionar() {
    setAlocacoes((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        empresa_id: "",
        regional_id: "",
        percentual: "",
      },
    ]);
  }
  function remover(index: number) {
    setAlocacoes((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSalvarPagamento() {
    setError(null);
    setErrosPagamento({});
    startSalvarPagamento(async () => {
      const res = await salvarPagamentoDaFolha(
        linha.id,
        completarNomeDoBanco(pagamento),
      );
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setErrosPagamento(res.fieldErrors);
        return;
      }
      setEditandoPagamento(false);
      router.refresh();
    });
  }

  function handleAprovar() {
    setError(null);
    setErrosPagamento({});
    if (!podeAgir) return;
    if (!somaOk) {
      setError(`Soma precisa dar 100 (atual: ${soma.toFixed(2)}).`);
      return;
    }
    if (alocacoes.some((a) => !a.empresa_id || !a.regional_id)) {
      setError("Toda alocação precisa de empresa e regional.");
      return;
    }
    if (!salarioBase) {
      setError("Informe o valor a pagar.");
      return;
    }

    startTransition(async () => {
      const res = await aprovarLinhaFolha(
        linha.id,
        {
          salario_base: salarioBase,
          alocacoes: alocacoes.map((a) => ({
            empresa_id: a.empresa_id,
            regional_id: a.regional_id,
            percentual: (
              Math.round(Number(String(a.percentual).replace(",", ".")) * 100) /
              100
            ).toFixed(2),
          })),
        },
        // Pagamento aberto para edição vai junto: aprovar grava os dois.
        editandoPagamento ? completarNomeDoBanco(pagamento) : undefined,
      );
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setErrosPagamento(res.fieldErrors);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleReprovar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (motivoReprova.trim().length < 3) {
      setError("Escreva o motivo (mínimo 3 caracteres).");
      return;
    }

    startTransition(async () => {
      const res = await reprovarLinhaFolha(linha.id, motivoReprova.trim());
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  const { titulo: tituloDoc, legendaPadrao } = tituloDoDocumento(linha);
  const nomeDoAnexo =
    linha.nf?.arquivo_nome ?? nomeArquivoDaUrl(linha.folha_anexo_url);
  const legendaDoc = nomeDoAnexo ?? legendaPadrao;
  const anexoEhImagem =
    (linha.nf != null &&
      /\.(png|jpe?g|webp|gif)$/i.test(linha.nf.arquivo_nome)) ||
    (linha.folha_anexo_url != null &&
      /\.(png|jpe?g|webp|gif)$/i.test(linha.folha_anexo_url));
  // Janela de pagamento só aparece pro fluxo NF (depende do uploaded_at):
  // no recibo CLT contabilidade não há essa data.
  const janelaDoDoc = linha.nf
    ? janelaDaNf({
        uploadedAt: linha.nf.uploaded_at,
        competenciaAno: linha.competencia_ano,
        competenciaMes: linha.competencia_mes,
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FullscreenContent
        className="bg-[#181818]/[0.82] p-5"
        aria-describedby="revisar-folha-descricao"
      >
        <div className="flex flex-none flex-wrap items-center gap-3 pb-3">
          <DialogTitle asChild>
            <span className="text-[15px] font-bold text-white">
              {linha.colaborador.nome}
            </span>
          </DialogTitle>
          <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
            {tipoContratacaoLabel(linha.colaborador.tipo_contratacao)}
          </span>
          <DialogDescription asChild>
            <span id="revisar-folha-descricao" className="text-xs text-white/60">
              {linha.colaborador.funcao} · Status atual:{" "}
              <span className="font-semibold text-white">
                {folhaLinhaStatusLabel(linha.status)}
              </span>
            </span>
          </DialogDescription>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            <X className="h-3 w-3" />
            Fechar
          </button>
        </div>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-california-red/50 bg-california-red/15 p-3 text-sm text-white">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Fechar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Os painéis ficam SEMPRE montados: expandir esconde por CSS e
            não desmonta o `<iframe>`. Desmontar jogaria fora página,
            zoom e rolagem de quem só quis ampliar um instante. */}
        <div
          className={
            expandido
              ? "grid min-h-0 flex-1 gap-3 grid-cols-1"
              : "grid min-h-0 flex-1 gap-3 grid-cols-1 lg:grid-cols-[1fr_520px]"
          }
        >
          <PainelDocumento
            icone={<Paperclip className="h-4 w-4 text-violet-700" />}
            titulo={tituloDoc}
            legenda={legendaDoc}
            oculto={expandido === "dados"}
            url={urlNf}
            nomeArquivo={linha.nf?.arquivo_nome ?? ""}
            expandido={expandido === "nf"}
            onExpandir={() =>
              setExpandido((a) => (a === "nf" ? null : "nf"))
            }
            onErro={setError}
            extra={
              janelaDoDoc ? (
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  {janelaDoDoc.janela === "salarios"
                    ? `Janela de salários (${janelaDoDoc.data_prevista})`
                    : `Janela de fornecedores (${janelaDoDoc.data_prevista})`}
                </span>
              ) : null
            }
          >
            {!temAnexo ? (
              <VazioDoPainel
                texto={
                  exigeNfPj
                    ? "NF não anexada. O colaborador anexa em /perfil ou o RH em /rh/colaboradores. A aprovação fica bloqueada até isso ser feito."
                    : exigeReciboFeriasContabil
                      ? "Recibo da contabilidade ainda não foi anexado. O RH anexa em /rh/ferias. A aprovação fica bloqueada até isso ser feito."
                      : "Esta linha não exige NF nem recibo (CLT importada da contabilidade)."
                }
              />
            ) : urlNf ? (
              anexoEhImagem ? (
                <div className="flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-3">
                  {/* URL assinada: `next/image` exigiria domínio configurado
                      e não agregaria nada. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={urlNf}
                    alt={nomeDoAnexo ?? tituloDoc}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <iframe
                  key={linha.nf?.id ?? linha.folha_anexo_url ?? linha.id}
                  src={enderecoParaVisualizar(urlNf)}
                  title={nomeDoAnexo ?? tituloDoc}
                  className="h-full w-full border-0"
                />
              )
            ) : (
              <VazioDoPainel
                texto={carregandoNf ? "Carregando o anexo..." : "Anexo indisponível."}
              />
            )}
          </PainelDocumento>

          {/* Coluna da direita: o cartão branco com os dados e as ações. */}
          <div
            className={
              expandido === "nf"
                ? "hidden"
                : "flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white"
            }
          >
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {!podeAgir && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {linha.status === "pendente_correcao"
                    ? "Aguardando o RH corrigir e reenviar. Não há ação sua neste momento."
                    : `Linha em status ${folhaLinhaStatusLabel(linha.status)} — sem ação disponível.`}
                  {linha.status === "pendente_correcao" &&
                    linha.motivo_pendencia && (
                      <div className="mt-2">
                        <strong>Motivo que você registrou:</strong>{" "}
                        {linha.motivo_pendencia}
                      </div>
                    )}
                </div>
              )}

              {exigeDocumentoSemAnexo && (
                <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    {exigeReciboFeriasContabil ? (
                      <>
                        <p className="font-medium">
                          Recibo da contabilidade não anexado — aprovação bloqueada
                        </p>
                        <p className="opacity-80">
                          Peça pro RH anexar em /rh/ferias antes de aprovar.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium">
                          NF não anexada — aprovação bloqueada
                        </p>
                        <p className="opacity-80">
                          Peça pro colaborador anexar em /perfil, ou use o cadastro em
                          /rh/colaboradores.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="salario_base">Valor a pagar</Label>
                <MoedaInput
                  key={linha.id + linha.salario_base}
                  id="salario_base"
                  defaultValue={linha.salario_base}
                  disabled={!podeAgir || modoReprova}
                  onCentavosChange={(centavos) => {
                    if (!centavos) {
                      setSalarioBase("");
                      return;
                    }
                    const inteiros = centavos.slice(0, -2) || "0";
                    const dec = centavos.slice(-2).padStart(2, "0");
                    setSalarioBase(`${inteiros}.${dec}`);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {valorMudou
                    ? `Enviado pelo RH: ${formatBRL(linha.salario_base)}. `
                    : ""}
                  O salário do cadastro não muda.
                </p>
              </div>

              <PagamentoDaFolha
                colaborador={linha.colaborador}
                podeEditar={podeAgir && !modoReprova}
                editando={editandoPagamento}
                onEditandoChange={(v) => {
                  setEditandoPagamento(v);
                  if (!v) {
                    setPagamento(pagamentoInicial(linha.colaborador));
                    setErrosPagamento({});
                  }
                }}
                valores={pagamento}
                onValoresChange={setPagamento}
                fieldErrors={errosPagamento}
                salvando={salvandoPagamento}
                onSalvar={handleSalvarPagamento}
              />

              <div className="space-y-2">
                <Label>Alocação da folha</Label>
                <div className="space-y-2">
                  {alocacoes.map((a, i) => {
                    const regionaisDaEmpresa = regionais
                      .filter((r) => r.empresa_id === a.empresa_id)
                      .sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
                    return (
                      <div
                        key={a.key}
                        className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_120px_auto]"
                      >
                        <Select
                          value={a.empresa_id}
                          onValueChange={(v) =>
                            atualizar(i, { empresa_id: v, regional_id: "" })
                          }
                          disabled={!podeAgir || modoReprova}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Empresa" />
                          </SelectTrigger>
                          <SelectContent>
                            {empresas.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.nome_fantasia}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={a.regional_id}
                          onValueChange={(v) => atualizar(i, { regional_id: v })}
                          disabled={!podeAgir || modoReprova || !a.empresa_id}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Regional" />
                          </SelectTrigger>
                          <SelectContent>
                            {regionaisDaEmpresa.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="relative">
                          <Input
                            value={a.percentual}
                            onChange={(e) =>
                              atualizar(i, { percentual: e.target.value })
                            }
                            disabled={!podeAgir || modoReprova}
                            placeholder="0,00"
                            className="pr-7"
                            inputMode="decimal"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            %
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => remover(i)}
                          disabled={
                            !podeAgir || modoReprova || alocacoes.length === 1
                          }
                          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-california-red transition-colors disabled:opacity-30"
                          title="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {podeAgir && !modoReprova && (
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={adicionar}
                      className="text-xs font-medium text-california-red hover:underline"
                    >
                      + Adicionar alocação
                    </button>
                    <p
                      className={`text-xs font-medium ${
                        somaOk ? "text-emerald-600" : "text-california-red"
                      }`}
                    >
                      Soma: {soma.toFixed(2)}%
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {new Set(alocacoes.map((a) => a.regional_id).filter(Boolean)).size > 1 ? (
                    <>
                      Ao aprovar, a linha vira um título em &ldquo;Títulos a
                      Pagar&rdquo;, com o valor rateado entre as regionais — um
                      pagamento só.
                    </>
                  ) : (
                    <>Ao aprovar, a linha vira um título em &ldquo;Títulos a Pagar&rdquo;.</>
                  )}
                </p>
              </div>

              {modoReprova && podeAgir && (
                <form onSubmit={handleReprovar} className="space-y-2">
                  <Label htmlFor="motivo">Motivo da pendência</Label>
                  <Input
                    id="motivo"
                    autoFocus
                    required
                    maxLength={500}
                    value={motivoReprova}
                    onChange={(e) => setMotivoReprova(e.target.value)}
                    placeholder="Ex.: PIX errado, salário fora do combinado"
                  />
                  <p className="text-xs text-muted-foreground">
                    O RH vai receber este motivo, corrigir e reenviar.
                  </p>
                </form>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border p-4">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Fechar
              </button>

              {podeAgir && (
                <div className="flex items-center gap-2">
                  {modoReprova ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setModoReprova(false)}
                        className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                      >
                        Voltar
                      </button>
                      <button
                        type="button"
                        onClick={handleReprovar as unknown as React.MouseEventHandler<HTMLButtonElement>}
                        disabled={pending || motivoReprova.trim().length < 3}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
                      >
                        <XCircle className="h-4 w-4" />
                        Enviar reprovação
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setModoReprova(true)}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-white px-4 py-2 text-sm font-semibold text-california-red hover:bg-california-red/5 disabled:opacity-50 transition-colors"
                      >
                        <XCircle className="h-4 w-4" />
                        Reprovar
                      </button>
                      <button
                        type="button"
                        onClick={handleAprovar}
                        disabled={pending || salvandoPagamento || !somaOk || exigeDocumentoSemAnexo}
                        title={
                          exigeDocumentoSemAnexo
                            ? exigeReciboFeriasContabil
                              ? "Recibo da contabilidade não anexado — RH anexa em /rh/ferias"
                              : "NF não anexada — colaborador precisa anexar em /perfil"
                            : undefined
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {pending
                          ? "Aprovando..."
                          : salarioBase
                            ? `Aprovar ${formatBRL(salarioBase)}`
                            : "Aprovar"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </FullscreenContent>
    </Dialog>
  );
}
