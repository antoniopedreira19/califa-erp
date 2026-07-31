"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Briefcase, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { CidadeCombobox, type CidadeOption } from "./cidade-combobox";

export interface ProdutoOption {
  id: string;
  nome: string;
  codigo: string;
}

export interface DadosJob {
  nome: string;
  produtoId: string;
  cidade: CidadeOption | null;
  regionalId: string;
  dataInicio: string;
  dataFim: string;
  dataFaturamento: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Avança para a confirmação final com os dados preenchidos. */
  onConfirmar: (dados: DadosJob) => void;
  somenteLeitura?: boolean;

  orcamentoCodigo: string;
  clienteId: string;
  clienteNome: string;
  responsavelNome: string;
  codigoJob: string;
  valorTotal: number;
  moeda: string;

  produtos: ProdutoOption[];
  regionais: { id: string; nome: string }[];
  cidadesIniciais: CidadeOption[];

  inicial: DadosJob;
  fieldErrors: Record<string, string[]>;
  erroGeral: string | null;
}

export function EnviarJobModal({
  open,
  onOpenChange,
  onConfirmar,
  somenteLeitura = false,
  orcamentoCodigo,
  clienteId,
  clienteNome,
  responsavelNome,
  codigoJob,
  valorTotal,
  moeda,
  produtos,
  regionais,
  cidadesIniciais,
  inicial,
  fieldErrors,
  erroGeral,
}: Props) {
  const [nome, setNome] = React.useState(inicial.nome);
  const [produtoId, setProdutoId] = React.useState(inicial.produtoId);
  const [cidade, setCidade] = React.useState<CidadeOption | null>(inicial.cidade);
  const [regionalId, setRegionalId] = React.useState(inicial.regionalId);
  const [dataInicio, setDataInicio] = React.useState(inicial.dataInicio);
  const [dataFim, setDataFim] = React.useState(inicial.dataFim);
  const [dataFaturamento, setDataFaturamento] = React.useState(
    inicial.dataFaturamento,
  );
  const [tentou, setTentou] = React.useState(false);

  // Reabrir o modal recompõe os valores a partir do que veio do servidor.
  React.useEffect(() => {
    if (!open) return;
    setNome(inicial.nome);
    setProdutoId(inicial.produtoId);
    setCidade(inicial.cidade);
    setRegionalId(inicial.regionalId);
    setDataInicio(inicial.dataInicio);
    setDataFim(inicial.dataFim);
    setDataFaturamento(inicial.dataFaturamento);
    setTentou(false);
  }, [open, inicial]);

  const faltando = {
    nome: nome.trim().length < 2,
    produto_id: !produtoId,
    cidade_id: !cidade,
    regional_id: !regionalId,
    data_inicio_prevista: !dataInicio,
    data_fim_prevista: !dataFim,
    data_prevista_faturamento: !dataFaturamento,
  };
  const completo = !Object.values(faltando).some(Boolean);

  /** Erro visível: o que o servidor devolveu, ou o que faltou ao tentar. */
  function erroDe(campo: keyof typeof faltando): string | null {
    const doServidor = fieldErrors[campo]?.[0];
    if (doServidor) return doServidor;
    if (tentou && faltando[campo]) return "Campo obrigatório.";
    return null;
  }

  function handleConfirmar() {
    setTentou(true);
    if (!completo || !cidade) return;
    onConfirmar({
      nome: nome.trim(),
      produtoId,
      cidade,
      regionalId,
      dataInicio,
      dataFim,
      dataFaturamento,
    });
  }

  const semProdutos = produtos.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="flex-row items-start gap-4 border-b border-border p-6 pr-14">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <Briefcase className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-lg">
              {somenteLeitura ? "Dados do job" : "Enviar job para abertura"}
            </DialogTitle>
            <DialogDescription>
              {somenteLeitura
                ? `Job já enviado para abertura. Estes são os dados gravados a partir de ${orcamentoCodigo}.`
                : `Confira as informações essenciais. Alterações em nome e datas são gravadas também no orçamento ${orcamentoCodigo}.`}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-5 overflow-y-auto p-6 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="job_nome">
              Nome do Job <span className="text-california-red">*</span>
            </Label>
            <Input
              id="job_nome"
              value={nome}
              disabled={somenteLeitura}
              onChange={(e) => setNome(e.target.value)}
              maxLength={200}
              className={cn(
                erroDe("nome") && "border-california-red ring-2 ring-california-red/15",
              )}
              placeholder="Ex.: Carnaval Anitta 2026"
            />
            <Campo erro={erroDe("nome")}>
              Pré-preenchido com o nome do orçamento · se alterar, o orçamento é
              atualizado na confirmação.
            </Campo>
          </div>

          <div className="space-y-2">
            <Label>Cliente</Label>
            <Travado valor={clienteNome} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="job_produto">
              Produto <span className="text-california-red">*</span>
            </Label>
            <Select
              value={produtoId}
              onValueChange={setProdutoId}
              disabled={somenteLeitura || semProdutos}
            >
              <SelectTrigger
                id="job_produto"
                className={cn(
                  erroDe("produto_id") &&
                    "border-california-red ring-2 ring-california-red/15",
                )}
              >
                <SelectValue
                  placeholder={
                    semProdutos ? "Nenhum produto cadastrado" : "Selecione o produto"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {produtos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.codigo}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Campo erro={erroDe("produto_id")}>
              {semProdutos ? (
                <>
                  Nenhum produto cadastrado para este cliente.{" "}
                  <Link
                    href={`/clientes/${clienteId}`}
                    prefetch={false}
                    className="font-medium text-california-red hover:underline"
                  >
                    Cadastrar agora
                  </Link>
                </>
              ) : (
                <>
                  Opções do cadastro do cliente.{" "}
                  <Link
                    href={`/clientes/${clienteId}`}
                    prefetch={false}
                    className="font-medium text-california-red hover:underline"
                  >
                    Gerenciar produtos
                  </Link>
                </>
              )}
            </Campo>
          </div>

          <div className="space-y-2">
            <Label>
              Cidade <span className="text-california-red">*</span>
            </Label>
            {somenteLeitura ? (
              <Travado valor={cidade?.nome ?? "—"} />
            ) : (
              <CidadeCombobox
                value={cidade}
                onChange={setCidade}
                iniciais={cidadesIniciais}
                erro={Boolean(erroDe("cidade_id"))}
              />
            )}
            <Campo erro={erroDe("cidade_id")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="job_regional">
              Regional <span className="text-california-red">*</span>
            </Label>
            <Select
              value={regionalId}
              onValueChange={setRegionalId}
              disabled={somenteLeitura}
            >
              <SelectTrigger
                id="job_regional"
                className={cn(
                  erroDe("regional_id") &&
                    "border-california-red ring-2 ring-california-red/15",
                )}
              >
                <SelectValue placeholder="Selecione a regional" />
              </SelectTrigger>
              <SelectContent>
                {regionais.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Campo erro={erroDe("regional_id")} />
          </div>

          <div className="space-y-2">
            <Label>Responsável</Label>
            <Travado valor={responsavelNome} />
          </div>

          <div className="space-y-2">
            <Label>
              Data de início <span className="text-california-red">*</span>
            </Label>
            <DatePicker
              name="__job_data_inicio"
              defaultValue={dataInicio}
              disabled={somenteLeitura}
              onDateChange={(d) =>
                setDataInicio(d ? toIso(d) : "")
              }
              className={cn(
                erroDe("data_inicio_prevista") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
            <Campo erro={erroDe("data_inicio_prevista")}>
              Alteração é replicada no orçamento.
            </Campo>
          </div>

          <div className="space-y-2">
            <Label>
              Data de fim <span className="text-california-red">*</span>
            </Label>
            <DatePicker
              name="__job_data_fim"
              defaultValue={dataFim}
              disabled={somenteLeitura}
              onDateChange={(d) => setDataFim(d ? toIso(d) : "")}
              className={cn(
                erroDe("data_fim_prevista") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
            <Campo erro={erroDe("data_fim_prevista")}>
              Alteração é replicada no orçamento.
            </Campo>
          </div>

          <div className="space-y-2">
            <Label>
              Data prevista para faturamento{" "}
              <span className="text-california-red">*</span>
            </Label>
            <DatePicker
              name="__job_data_faturamento"
              defaultValue={dataFaturamento}
              disabled={somenteLeitura}
              onDateChange={(d) => setDataFaturamento(d ? toIso(d) : "")}
              className={cn(
                erroDe("data_prevista_faturamento") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
            <Campo erro={erroDe("data_prevista_faturamento")} />
          </div>

          <div className="space-y-2">
            <Label>Código do job</Label>
            <Travado valor={codigoJob} mono />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4 md:col-span-2">
            <div>
              <p className="text-sm font-semibold">Valor total do Job</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Faturamento previsto da versão · custos + honorários + impostos
              </p>
            </div>
            <span className="whitespace-nowrap font-mono text-2xl font-bold text-california-red">
              {formatCurrency(valorTotal, moeda)}
            </span>
          </div>

          {erroGeral && (
            <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red md:col-span-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erroGeral}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/30 p-4 px-6">
          <span className="text-xs text-muted-foreground">
            {somenteLeitura ? (
              "Job já enviado — os dados não podem mais ser alterados por aqui."
            ) : (
              <>
                Campos com <span className="text-california-red">*</span> são
                obrigatórios para a abertura.
              </>
            )}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              {somenteLeitura ? "Fechar" : "Cancelar"}
            </button>
            {!somenteLeitura && (
              <button
                type="button"
                onClick={handleConfirmar}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-all",
                  completo
                    ? "hover:bg-california-red-hover hover:shadow-brand"
                    : "opacity-50",
                )}
              >
                Confirmar dados
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function toIso(d: Date): string {
  const mes = `${d.getMonth() + 1}`.padStart(2, "0");
  const dia = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Linha de apoio abaixo do campo: vira mensagem de erro quando há erro. */
function Campo({
  erro,
  children,
}: {
  erro: string | null;
  children?: React.ReactNode;
}) {
  if (erro) return <p className="text-xs text-california-red">{erro}</p>;
  if (!children) return null;
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Travado({ valor, mono }: { valor: string; mono?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-11 items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3.5 text-sm font-medium text-muted-foreground",
        mono && "font-mono",
      )}
    >
      <span className="min-w-0 truncate">{valor}</span>
      <Lock className="h-3.5 w-3.5 shrink-0" />
    </div>
  );
}
