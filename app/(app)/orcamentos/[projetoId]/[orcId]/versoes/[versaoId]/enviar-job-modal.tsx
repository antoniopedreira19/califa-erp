"use client";

import * as React from "react";
import { AlertCircle, ArrowRight, Briefcase, Lock, Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { SAVE } from "@/app/(app)/_planilha/blocos";
import { OBSERVACOES_MAX } from "@/lib/validations/abertura-job";
import {
  CidadeCombobox,
  type CidadeOption,
} from "@/app/(app)/orcamentos/cidade-combobox";

/** Uma linha da seção "Contato de cobrança". Strings sempre — o estado do
 *  formulário nunca carrega `null`; quem converte "" em null é o Zod. */
export interface ContatoCobranca {
  nome: string;
  numero: string;
  email: string;
}

export function contatoVazio(): ContatoCobranca {
  return { nome: "", numero: "", email: "" };
}

export interface DadosJob {
  nome: string;
  /** Pré-preenchidos com o orçamento; se mudarem, o orçamento acompanha. */
  cidadeId: string;
  cidadeNome: string;
  regionalId: string;
  dataInicio: string;
  dataFim: string;
  /** Data do evento. Só do job — o orçamento não tem o campo. */
  dataEvento: string;
  /** Coluna `data_prevista_faturamento`; na tela é "Data prevista para
   *  recebimento" desde 27/08/2026. */
  dataFaturamento: string;
  observacoes: string;
  /** Quem recebe a cobrança no cliente. Ao menos um é obrigatório para
   *  enviar; vira linha em `jobs_contatos` (docs/decisions/012). */
  contatos: ContatoCobranca[];
}

/**
 * Dados que a abertura só EXIBE: produto vem do projeto, GP e produtor
 * vêm do orçamento. O servidor relê os três do banco na hora de gravar —
 * o modal não pode alterá-los.
 *
 * `cidadeNome` e `regionalNome` continuam aqui, mas não são lidos por
 * este modal: quem os usa é o resumo da conferência, que com o job já
 * enviado precisa mostrar o que o JOB congelou — e não o que está no
 * orçamento hoje. Ver `resumoEnvio` em `fluxo-abertura.tsx`.
 */
export interface HerdadosJob {
  produtoNome: string | null;
  cidadeNome: string | null;
  regionalNome: string | null;
  gpNome: string | null;
  produtorNome: string | null;
  /** Categoria do job, herdada do orçamento (categorias_dominio, escopo
   *  'orcamento'). É a mesma que o financeiro vê na abertura. */
  categoriaNome: string | null;
}

/** Campos que o Zod do servidor valida — as chaves batem com `fieldErrors`. */
type CampoObrigatorio =
  | "nome"
  | "cidade_id"
  | "regional_id"
  | "data_inicio_prevista"
  | "data_fim_prevista"
  | "data_evento"
  | "data_prevista_faturamento"
  | "contatos_cobranca";

/** Versão curta da regra do servidor: só evita que o usuário descubra o
 *  e-mail torto no envio. O Zod da action é quem tem a palavra final. */
const EMAIL_PLAUSIVEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function nomeContatoInvalido(c: ContatoCobranca): boolean {
  return c.nome.trim().length < 2;
}

export function emailContatoInvalido(c: ContatoCobranca): boolean {
  return !EMAIL_PLAUSIVEL.test(c.email.trim());
}

export function faltamCampos(d: DadosJob): Record<CampoObrigatorio, boolean> {
  return {
    nome: d.nome.trim().length < 2,
    cidade_id: !d.cidadeId,
    regional_id: !d.regionalId,
    data_inicio_prevista: !d.dataInicio,
    data_fim_prevista: !d.dataFim,
    data_evento: !d.dataEvento,
    data_prevista_faturamento: !d.dataFaturamento,
    // Espelha o schema do servidor: ao menos uma linha, e TODA linha com
    // nome e e-mail. Número em branco não conta como pendência.
    contatos_cobranca:
      d.contatos.length === 0 ||
      d.contatos.some((c) => nomeContatoInvalido(c) || emailContatoInvalido(c)),
  };
}

/** Falta algo herdado? Então o projeto/orçamento está incompleto e a
 *  abertura não tem como gravar o job. Cidade e regional não entram: são
 *  campos do formulário desde 12/08/2026 e o usuário resolve na hora. */
export function herdadosIncompletos(h: HerdadosJob): string[] {
  const faltando: string[] = [];
  if (!h.produtoNome) faltando.push("Marca (no projeto)");
  if (!h.gpNome) faltando.push("GP responsável (no orçamento)");
  if (!h.produtorNome) faltando.push("Produtor responsável (no orçamento)");
  return faltando;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Avança para a confirmação final. O estado vive no pai. */
  onConfirmar: () => void;

  /** Controlado pelo pai — é o que preserva o preenchimento no "Voltar e revisar". */
  dados: DadosJob;
  onChange: (patch: Partial<DadosJob>) => void;

  orcamentoCodigo: string;
  projetoNome: string;
  projetoCodigo: string;
  clienteNome: string;
  codigoJob: string;
  versaoLabel: string;
  /** Valor do Job — o que vai para `jobs.valor_total`. */
  valorTotal: number;
  /** O que a California emite nota nesta versão. */
  faturamentoPrevisto: number;
  /** Crédito que as linhas em save geram para o cliente. Zero esconde a
   *  linha — versão sem save não ganha uma linha a explicar. */
  totalGeradoEmSave: number;
  moeda: string;

  herdados: HerdadosJob;

  /** Mesma regra do formulário do orçamento: só as regionais do projeto. */
  regionaisDoProjeto: { id: string; nome: string }[];
  /** Primeiras cidades do cadastro — o combobox busca o resto no servidor. */
  cidadesIniciais: CidadeOption[];

  fieldErrors: Record<string, string[]>;
  erroGeral: string | null;
}

export function EnviarJobModal({
  open,
  onOpenChange,
  onConfirmar,
  dados,
  onChange,
  orcamentoCodigo,
  projetoNome,
  projetoCodigo,
  clienteNome,
  codigoJob,
  versaoLabel,
  valorTotal,
  faturamentoPrevisto,
  totalGeradoEmSave,
  moeda,
  herdados,
  regionaisDoProjeto,
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

  const faltandoHerdados = herdadosIncompletos(herdados);

  /** Contatos não usam o "Campo obrigatório." genérico: a pendência pode
   *  ser "não tem nenhum" ou "tem, mas incompleto" — e são conversas
   *  diferentes com o usuário. */
  const erroContatos = (() => {
    const doServidor = fieldErrors.contatos_cobranca?.[0];
    if (doServidor) return doServidor;
    if (!tentou) return null;
    if (dados.contatos.length === 0) {
      return "Informe ao menos um contato de cobrança.";
    }
    if (faltando.contatos_cobranca) {
      return "Preencha nome e e-mail de todos os contatos de cobrança.";
    }
    return null;
  })();

  function alterarContato(i: number, patch: Partial<ContatoCobranca>) {
    onChange({
      contatos: dados.contatos.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c,
      ),
    });
  }

  function handleConfirmar() {
    setTentou(true);
    if (!completo || faltandoHerdados.length > 0) return;
    onConfirmar();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-w-5xl: o handoff pede 3 colunas e a regra de larguras do
          docs/09 vale para container de PÁGINA, não para diálogo.

          flex-col + `flex-1` no miolo (em vez de uma altura fixa nele):
          o formulário ocupa toda a altura que sobra do diálogo, então em
          tela cheia ele aparece inteiro sem rolagem. Onde não couber, só
          o miolo rola — cabeçalho e rodapé ficam.

          As medidas apertadas daqui pra baixo (97vh, gap-y-3, py-5) são
          o que fecha a conta num notebook de ~970px de altura: com as
          folgas antigas o formulário abria cortado. */}
      <DialogContent className="flex max-h-[97vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 flex-row items-start gap-4 border-b border-border px-6 py-5 pr-14">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
            <Briefcase className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-xl">Enviar job para abertura</DialogTitle>
            <DialogDescription>
              {`Confira as informações essenciais. Alterações em nome, cidade, regional e datas são gravadas também no orçamento ${orcamentoCodigo}.`}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-x-5 gap-y-3 overflow-y-auto px-6 py-4 md:grid-cols-3 md:content-start">
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

          {/* Linhas 3 e 4 — as três colunas ficam sempre cheias. Até
              26/08/2026 Produto e Categoria vinham sozinhos, cada um com
              dois espaçadores, e Cidade/Regional dividiam a linha
              seguinte; o design "Enviar Job - Ajustes de Campos" fechou
              os buracos e separou o par.

              Separar Cidade de Regional é seguro: as opções de regional
              saem do PROJETO (`regionaisDoProjeto`), não da cidade
              escolhida — uma nunca dependeu da outra. */}
          <Campo rotulo="Marca" apoio="Cadastrada no projeto.">
            <Travado valor={herdados.produtoNome ?? "— não informado"} />
          </Campo>

          <Campo
            rotulo="Regional"
            obrigatorio
            erro={erroDe("regional_id")}
            apoio={
              regionaisDoProjeto.length === 0
                ? "O projeto não tem regional cadastrada. Edite o projeto."
                : "Opções vindas das regionais do projeto."
            }
          >
            <Select
              value={dados.regionalId}
              onValueChange={(v) => onChange({ regionalId: v })}
              disabled={regionaisDoProjeto.length === 0}
            >
              <SelectTrigger
                className={cn(
                  erroDe("regional_id") &&
                    "border-california-red ring-2 ring-california-red/15",
                )}
              >
                <SelectValue
                  placeholder={
                    regionaisDoProjeto.length === 0
                      ? "Projeto sem regional cadastrada"
                      : "Selecione a regional"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {regionaisDoProjeto.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>

          <Campo rotulo="GP Responsável">
            <Travado valor={herdados.gpNome ?? "— não informado"} />
          </Campo>

          <Campo rotulo="Categoria" apoio="Cadastrada no orçamento.">
            <Travado valor={herdados.categoriaNome ?? "— não informada"} />
          </Campo>

          <Campo
            rotulo="Cidade"
            obrigatorio
            erro={erroDe("cidade_id")}
            apoio="Se alterar, o orçamento é atualizado na confirmação."
          >
            <CidadeCombobox
              value={
                dados.cidadeId
                  ? { id: dados.cidadeId, nome: dados.cidadeNome }
                  : null
              }
              onChange={(c) => onChange({ cidadeId: c.id, cidadeNome: c.nome })}
              iniciais={cidadesIniciais}
              erro={Boolean(erroDe("cidade_id"))}
            />
          </Campo>

          <Campo rotulo="Produtor Responsável">
            <Travado valor={herdados.produtorNome ?? "— não informado"} />
          </Campo>

          {/* Linha 5 — início, fim e o evento. */}
          <Campo
            rotulo="Data de início"
            obrigatorio
            erro={erroDe("data_inicio_prevista")}
          >
            <DatePicker
              key={`inicio-${dados.dataInicio}`}
              name="__job_data_inicio"
              defaultValue={dados.dataInicio}
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
              onDateChange={(d) => onChange({ dataFim: d ? toIso(d) : "" })}
              className={cn(
                erroDe("data_fim_prevista") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
          </Campo>

          <Campo
            rotulo="Data Evento"
            obrigatorio
            erro={erroDe("data_evento")}
          >
            <DatePicker
              key={`evento-${dados.dataEvento}`}
              name="__job_data_evento"
              defaultValue={dados.dataEvento}
              onDateChange={(d) => onChange({ dataEvento: d ? toIso(d) : "" })}
              className={cn(
                erroDe("data_evento") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
          </Campo>

          {/* Linha 6 — o recebimento desce sozinho, no lugar que era do
              faturamento. O espaçador segura as duas colunas que sobram
              para o contato de cobrança começar em linha própria. */}
          <Campo
            rotulo="Data prevista para recebimento"
            obrigatorio
            erro={erroDe("data_prevista_faturamento")}
          >
            <DatePicker
              key={`fat-${dados.dataFaturamento}`}
              name="__job_data_faturamento"
              defaultValue={dados.dataFaturamento}
              onDateChange={(d) => onChange({ dataFaturamento: d ? toIso(d) : "" })}
              className={cn(
                erroDe("data_prevista_faturamento") &&
                  "border-california-red ring-2 ring-california-red/15",
              )}
            />
          </Campo>

          <div className="hidden md:col-span-2 md:block" aria-hidden />


          {/* Linha 7 — contato de cobrança. Uma linha por pessoa: é o que
              o financeiro usa para cobrar, e muda de job para job. */}
          <Campo
            rotulo="Contato de cobrança"
            obrigatorio
            className="md:col-span-3"
            erro={erroContatos}
            apoio="Quem recebe a cobrança no cliente. Número é opcional."
          >
            <div className="space-y-2">
              {dados.contatos.map((c, i) => (
                <div
                  // Índice como chave: as linhas não têm id antes de
                  // gravar, e remover sempre refaz o array inteiro.
                  key={i}
                  className="grid items-center gap-2 md:grid-cols-[1fr_1fr_1fr_36px]"
                >
                  <Input
                    value={c.nome}
                    onChange={(e) => alterarContato(i, { nome: e.target.value })}
                    maxLength={120}
                    placeholder="Nome"
                    aria-label={`Nome do contato ${i + 1}`}
                    className={cn(
                      tentou &&
                        nomeContatoInvalido(c) &&
                        "border-california-red ring-2 ring-california-red/15",
                    )}
                  />
                  <Input
                    value={c.numero}
                    onChange={(e) => alterarContato(i, { numero: e.target.value })}
                    maxLength={40}
                    placeholder="Número · opcional"
                    aria-label={`Número do contato ${i + 1}`}
                  />
                  <Input
                    type="email"
                    value={c.email}
                    onChange={(e) => alterarContato(i, { email: e.target.value })}
                    maxLength={200}
                    placeholder="E-mail"
                    aria-label={`E-mail do contato ${i + 1}`}
                    className={cn(
                      tentou &&
                        emailContatoInvalido(c) &&
                        "border-california-red ring-2 ring-california-red/15",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        contatos: dados.contatos.filter((_, idx) => idx !== i),
                      })
                    }
                    disabled={dados.contatos.length === 1}
                    aria-label={`Remover contato ${i + 1}`}
                    className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-california-red transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() =>
                  onChange({ contatos: [...dados.contatos, contatoVazio()] })
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-white px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-california-red/40 hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                Adicionar contato
              </button>
            </div>
          </Campo>

          <div className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 md:col-span-3">
            <p className="text-xs text-muted-foreground">
              Fechamento da versão {versaoLabel}
            </p>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">Faturamento previsto</p>
              <span className="whitespace-nowrap font-mono text-lg font-bold text-california-red">
                {formatCurrency(faturamentoPrevisto, moeda)}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-2">
              <p className="text-sm font-semibold">Valor total do Job</p>
              <span className="whitespace-nowrap font-mono text-2xl font-bold text-foreground">
                {formatCurrency(valorTotal, moeda)}
              </span>
            </div>
            {/* Save zerado não vira linha: o card só ganha a explicação
                quando há crédito a explicar (design de 27/08/2026). */}
            {totalGeradoEmSave > 0 && (
              <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-2">
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">
                    Total gerado em save
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Crédito gerado pelos itens desta versão.
                  </span>
                </span>
                {/* Grafite do SAVE, de `blocos.ts` — a mesma cor da linha
                    "Saldo em save" do card de Totais. O design desenhou
                    esta linha em azul (#1e4fa3), mas foi antes de o save
                    entrar no produto com identidade própria; seguir o
                    desenho aqui deixaria o mesmo número em duas cores. */}
                <span
                  className={cn(
                    "whitespace-nowrap font-mono text-lg font-bold",
                    SAVE.textoApagado,
                  )}
                >
                  {formatCurrency(totalGeradoEmSave, moeda)}
                </span>
              </div>
            )}
          </div>

          {/* Linha 9 — descritivo, linha inteira. Rótulo renomeado em
              17/08/2026; o campo e a coluna seguem `observacoes`. */}
          <Campo
            rotulo="Descritivo"
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
              onChange={(e) => onChange({ observacoes: e.target.value })}
              maxLength={OBSERVACOES_MAX}
              rows={2}
              // Duas linhas de partida (era três) pelo mesmo motivo das
              // medidas do diálogo: é o último campo e continua resize-y
              // para quem precisa escrever mais.
              className="min-h-[68px] resize-y leading-relaxed"
              placeholder="Contexto para quem abre o job: condições comerciais, dependências, o que combinamos com o cliente..."
            />
          </Campo>

          {faltandoHerdados.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 md:col-span-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Complete antes de abrir o job: {faltandoHerdados.join(", ")}.
              </span>
            </div>
          )}

          {erroGeral && (
            <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red md:col-span-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erroGeral}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/30 px-6 py-3">
          <span className="text-xs text-muted-foreground">
            Campos com <span className="text-california-red">*</span> são
            obrigatórios para a abertura.
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-all",
                completo && faltandoHerdados.length === 0
                  ? "hover:bg-california-red-hover hover:shadow-brand"
                  : "opacity-50",
              )}
            >
              Confirmar dados
              <ArrowRight className="h-4 w-4" />
            </button>
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
    <div className={cn("space-y-1.5", className)}>
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
