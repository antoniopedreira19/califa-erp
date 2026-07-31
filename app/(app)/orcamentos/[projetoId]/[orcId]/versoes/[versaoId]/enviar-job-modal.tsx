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
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { OBSERVACOES_MAX } from "@/lib/validations/abertura-job";
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
  observacoes: string;
}

/** Campos que o Zod do servidor valida — as chaves batem com `fieldErrors`. */
type CampoObrigatorio =
  | "nome"
  | "produto_id"
  | "cidade_id"
  | "regional_id"
  | "data_inicio_prevista"
  | "data_fim_prevista"
  | "data_prevista_faturamento";

export function faltamCampos(d: DadosJob): Record<CampoObrigatorio, boolean> {
  return {
    nome: d.nome.trim().length < 2,
    produto_id: !d.produtoId,
    cidade_id: !d.cidade,
    regional_id: !d.regionalId,
    data_inicio_prevista: !d.dataInicio,
    data_fim_prevista: !d.dataFim,
    data_prevista_faturamento: !d.dataFaturamento,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Avança para a confirmação final. O estado vive no pai. */
  onConfirmar: () => void;
  somenteLeitura?: boolean;

  /** Controlado pelo pai — é o que preserva o preenchimento no "Voltar e revisar". */
  dados: DadosJob;
  onChange: (patch: Partial<DadosJob>) => void;

  orcamentoCodigo: string;
  projetoNome: string;
  projetoCodigo: string;
  clienteId: string;
  clienteNome: string;
  responsavelNome: string;
  codigoJob: string;
  versaoLabel: string;
  valorTotal: number;
  moeda: string;

  produtos: ProdutoOption[];
  regionais: { id: string; nome: string }[];
  cidadesIniciais: CidadeOption[];

  fieldErrors: Record<string, string[]>;
  erroGeral: string | null;
}

export function EnviarJobModal({
  open,
  onOpenChange,
  onConfirmar,
  somenteLeitura = false,
  dados,
  onChange,
  orcamentoCodigo,
  projetoNome,
  projetoCodigo,
  clienteId,
  clienteNome,
  responsavelNome,
  codigoJob,
  versaoLabel,
  valorTotal,
  moeda,
  produtos,
  regionais,
  cidadesIniciais,
  fieldErrors,
  erroGeral,
}: Props) {
  const [tentou, setTentou] = React.useState(false);

  // Cada abertura limpa só o realce de "faltou preencher" — os valores
  // ficam no pai, então voltar da confirmação preserva o formulário.
  React.useEffect(() => {
    if (open) setTentou(false);
  }, [open]);

  const faltando = faltamCampos(dados);
  const completo = !Object.values(faltando).some(Boolean);

  /** Erro visível: o que o servidor devolveu, ou o que faltou ao tentar. */
  function erroDe(campo: CampoObrigatorio): string | null {
    const doServidor = fieldErrors[campo]?.[0];
    if (doServidor) return doServidor;
    if (tentou && faltando[campo]) return "Campo obrigatório.";
    return null;
  }

  function handleConfirmar() {
    setTentou(true);
    if (!completo) return;
    onConfirmar();
  }

  const semProdutos = produtos.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-w-5xl: o handoff pede 3 colunas e a regra de larguras do
          docs/09 vale para container de PÁGINA, não para diálogo. */}
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="flex-row items-start gap-4 border-b border-border p-6 pr-14">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <Briefcase className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-xl">
              {somenteLeitura ? "Dados do job" : "Enviar job para abertura"}
            </DialogTitle>
            <DialogDescription>
              {somenteLeitura
                ? `Job já enviado para abertura. Estes são os dados gravados a partir de ${orcamentoCodigo}.`
                : `Confira as informações essenciais. Alterações em nome e datas são gravadas também no orçamento ${orcamentoCodigo}.`}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid max-h-[62vh] gap-x-5 gap-y-4 overflow-y-auto p-6 md:grid-cols-3">
          {/* Linha 1 — identificação, tudo travado. */}
          <Campo rotulo="Projeto">
            <Travado valor={projetoNome} />
          </Campo>
          <Campo rotulo="Código do projeto">
            <Travado valor={projetoCodigo} mono />
          </Campo>
          <Campo rotulo="Código do job">
            <Travado valor={codigoJob} mono />
          </Campo>

          {/* Linha 2 — nome ocupa 2 colunas, cliente fecha a linha. */}
          <Campo
            rotulo="Nome do Job"
            obrigatorio
            className="md:col-span-2"
            erro={erroDe("nome")}
            apoio="Se alterar, o orçamento é atualizado na confirmação."
          >
            <Input
              value={dados.nome}
              disabled={somenteLeitura}
              onChange={(e) => onChange({ nome: e.target.value })}
              maxLength={200}
              className={cn(
                erroDe("nome") && "border-california-red ring-2 ring-california-red/15",
              )}
              placeholder="Ex.: Bebedouros SP"
            />
          </Campo>
          <Campo rotulo="Cliente">
            <Travado valor={clienteNome} />
          </Campo>

          {/* Linha 3 — produto, cidade, regional. */}
          <Campo
            rotulo="Produto"
            obrigatorio
            erro={erroDe("produto_id")}
            apoio={
              semProdutos ? (
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
                "Opções do cadastro do cliente."
              )
            }
          >
            <Select
              value={dados.produtoId}
              onValueChange={(v) => onChange({ produtoId: v })}
              disabled={somenteLeitura || semProdutos}
            >
              <SelectTrigger
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
          </Campo>

          <Campo rotulo="Cidade" obrigatorio erro={erroDe("cidade_id")}>
            {somenteLeitura ? (
              <Travado valor={dados.cidade?.nome ?? "—"} />
            ) : (
              <CidadeCombobox
                value={dados.cidade}
                onChange={(c) => onChange({ cidade: c })}
                iniciais={cidadesIniciais}
                erro={Boolean(erroDe("cidade_id"))}
              />
            )}
          </Campo>

          <Campo rotulo="Regional" obrigatorio erro={erroDe("regional_id")}>
            <Select
              value={dados.regionalId}
              onValueChange={(v) => onChange({ regionalId: v })}
              disabled={somenteLeitura}
            >
              <SelectTrigger
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
          </Campo>

          {/* Linha 4 — as três datas. */}
          <Campo
            rotulo="Data de início"
            obrigatorio
            erro={erroDe("data_inicio_prevista")}
          >
            <DatePicker
              key={`inicio-${dados.dataInicio}`}
              name="__job_data_inicio"
              defaultValue={dados.dataInicio}
              disabled={somenteLeitura}
              onDateChange={(d) => onChange({ dataInicio: d ? toIso(d) : "" })}
              className={cn(
                erroDe("data_inicio_prevista") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
          </Campo>

          <Campo rotulo="Data de fim" obrigatorio erro={erroDe("data_fim_prevista")}>
            <DatePicker
              key={`fim-${dados.dataFim}`}
              name="__job_data_fim"
              defaultValue={dados.dataFim}
              disabled={somenteLeitura}
              onDateChange={(d) => onChange({ dataFim: d ? toIso(d) : "" })}
              className={cn(
                erroDe("data_fim_prevista") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
          </Campo>

          <Campo
            rotulo="Data prevista para faturamento"
            obrigatorio
            erro={erroDe("data_prevista_faturamento")}
          >
            <DatePicker
              key={`fat-${dados.dataFaturamento}`}
              name="__job_data_faturamento"
              defaultValue={dados.dataFaturamento}
              disabled={somenteLeitura}
              onDateChange={(d) => onChange({ dataFaturamento: d ? toIso(d) : "" })}
              className={cn(
                erroDe("data_prevista_faturamento") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
          </Campo>

          {/* Linha 5 — responsável e o valor, que fecha as 2 colunas. */}
          <Campo rotulo="Responsável">
            <Travado valor={responsavelNome} />
          </Campo>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 md:col-span-2">
            <div>
              <p className="text-sm font-semibold">Valor total do Job</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Faturamento previsto da versão {versaoLabel}
              </p>
            </div>
            <span className="whitespace-nowrap font-mono text-2xl font-bold text-california-red">
              {formatCurrency(valorTotal, moeda)}
            </span>
          </div>

          {/* Linha 6 — observações, linha inteira. */}
          <Campo
            rotulo="Observações"
            opcional
            className="md:col-span-3"
            apoio={
              dados.observacoes.length > 0
                ? `${dados.observacoes.length} / ${OBSERVACOES_MAX}`
                : undefined
            }
          >
            <Textarea
              value={dados.observacoes}
              disabled={somenteLeitura}
              onChange={(e) => onChange({ observacoes: e.target.value })}
              maxLength={OBSERVACOES_MAX}
              rows={3}
              className="min-h-[84px] resize-y leading-relaxed"
              placeholder="Contexto para quem abre o job: condições comerciais, dependências, o que combinamos com o cliente..."
            />
          </Campo>

          {erroGeral && (
            <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red md:col-span-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erroGeral}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/30 px-6 py-4">
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

/** Rótulo + campo + linha de apoio, que vira mensagem de erro quando há erro. */
function Campo({
  rotulo,
  obrigatorio,
  opcional,
  erro,
  apoio,
  className,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  opcional?: boolean;
  erro?: string | null;
  apoio?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label>
        {rotulo}
        {obrigatorio && <span className="ml-1 text-california-red">*</span>}
        {opcional && (
          <span className="ml-1.5 font-normal text-muted-foreground">
            · opcional
          </span>
        )}
      </Label>
      {children}
      {erro ? (
        <p className="text-xs text-california-red">{erro}</p>
      ) : apoio ? (
        <p className="text-xs text-muted-foreground">{apoio}</p>
      ) : null}
    </div>
  );
}

function Travado({ valor, mono }: { valor: string; mono?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-11 items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3.5 text-sm font-medium text-muted-foreground",
        mono && "font-mono",
      )}
    >
      <TruncateTooltip as="span" text={valor} className="min-w-0" />
      <Lock className="h-3.5 w-3.5 shrink-0" />
    </div>
  );
}
