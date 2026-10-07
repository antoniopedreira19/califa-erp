"use client";

/**
 * Os anexos da PP e as NFs do fornecedor, como a produção os preenche
 * (decisões 152 e 153 — 07/10/2026). Iguais no formulário da PP a emitir e
 * no envio ao financeiro; o desenho é o do protótipo aprovado pelo Tiago
 * ("Etapa antes da PP", v17).
 *
 *  • Área de arrastar, igual à do "Importar planilha" dos orçamentos.
 *  • Cada arquivo é um cartão branco; o mais novo fica em cima.
 *  • O tipo é obrigatório e nasce vazio ("Escolha o tipo").
 *  • No arquivo do tipo NF, os dados da nota logo abaixo: número, data de
 *    emissão, valor (o TOTAL da nota) e CNPJ tomador. "Esta NF também cobre
 *    outra PP" abre o valor desta PP. A nota que já existe (mesmo
 *    fornecedor + número) vem preenchida e travada: só o financeiro corrige.
 *  • Nos outros tipos, o número do documento.
 *
 * Todo campo é obrigatório no ENVIO ao financeiro; salvar e gerar não pedem.
 */

import * as React from "react";
import {
  AlertTriangle,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Lock,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import {
  DOCUMENTO_TIPOS,
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  documentoTipoLabel,
  type DocumentoTipo,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { chaveDoNumeroDaNf } from "@/lib/fiscal/nf-da-pp";
import { buscarNotasDoFornecedor, type NotaExistente } from "./actions-notas-da-pp";

// ---------------------------------------------------------------------------
// A NF digitada
// ---------------------------------------------------------------------------

export interface NfDigitada {
  numero: string;
  /** "AAAA-MM-DD" ou "". */
  emissao: string;
  /** O valor TOTAL da nota. */
  valor: number;
  /** `fiscal_estabelecimentos.id`, ou "". */
  tomador: string;
  /** A parte da nota nesta PP — só vale com `cobreOutra`. */
  valorNaPP: number;
  /** "Esta NF também cobre outra PP". */
  cobreOutra: boolean;
}

export const NF_VAZIA: NfDigitada = {
  numero: "",
  emissao: "",
  valor: 0,
  tomador: "",
  valorNaPP: 0,
  cobreOutra: false,
};

export type CampoNf = "numero" | "emissao" | "valor" | "tomador" | "valorNaPP";

/** A parte da nota que é desta PP: a nota inteira, salvo quando cobre outra. */
export function parteDaNf(nf: NfDigitada): number {
  return nf.cobreOutra ? nf.valorNaPP : nf.valor;
}

export function faltasDaNf(nf: NfDigitada): CampoNf[] {
  const f: CampoNf[] = [];
  if (!nf.numero.trim()) f.push("numero");
  if (!nf.emissao) f.push("emissao");
  if (!(nf.valor > 0)) f.push("valor");
  if (!nf.tomador) f.push("tomador");
  if (nf.cobreOutra && (!(nf.valorNaPP > 0) || nf.valorNaPP > nf.valor + 0.004)) f.push("valorNaPP");
  return f;
}

/** Um CNPJ tomador do cadastro de impostos (ativo e com CNPJ). */
export interface TomadorDaNf {
  id: string;
  nome: string;
  /** Já formatado ("19.437.976/0001-54"). */
  cnpj: string;
}

export type { NotaExistente };

/**
 * As notas do fornecedor que já estão no cadastro, para os números
 * digitados (pela chave sem zeros à esquerda). Busca de novo quando o
 * fornecedor ou os números mudam, com uma pausa para não ir ao servidor a
 * cada tecla.
 */
export function useNotasExistentes(
  fornecedorId: string | null,
  numeros: string[],
  excluirPPId: string | null,
): Record<string, NotaExistente> {
  const [porChave, setPorChave] = React.useState<Record<string, NotaExistente>>({});
  const chaves = React.useMemo(
    () =>
      [...new Set(numeros.map((n) => chaveDoNumeroDaNf(n)).filter((c): c is string => c !== null))].sort(),
    [numeros],
  );
  const assinatura = `${fornecedorId ?? ""}|${chaves.join(",")}|${excluirPPId ?? ""}`;
  React.useEffect(() => {
    if (!fornecedorId || chaves.length === 0) {
      setPorChave({});
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      buscarNotasDoFornecedor(fornecedorId, chaves, excluirPPId).then((res) => {
        if (!vivo || !res.ok) return;
        setPorChave(Object.fromEntries(res.notas.map((n) => [n.numero_chave, n])));
      });
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // A assinatura resume fornecedor, números e PP.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
  return porChave;
}

/** A nota do cadastro que este número é (null = nota nova). */
export function notaExistenteDe(
  porChave: Record<string, NotaExistente>,
  numero: string,
): NotaExistente | null {
  const chave = chaveDoNumeroDaNf(numero);
  return chave ? (porChave[chave] ?? null) : null;
}

function isoDoDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const VERMELHO = "border-california-red ring-2 ring-california-red/15";

// ---------------------------------------------------------------------------
// A área de anexar
// ---------------------------------------------------------------------------

export function ZonaDeAnexos({
  pronto,
  onArquivos,
  id,
  compacta = false,
}: {
  /** Falso enquanto a PP reserva o lugar dos arquivos. */
  pronto: boolean;
  onArquivos: (arquivos: File[]) => void;
  id: string;
  /** Coluna estreita (tela lado a lado): texto curto, sem o "Procurar". */
  compacta?: boolean;
}) {
  const [arrastando, setArrastando] = React.useState(false);
  if (!pronto) {
    return (
      <div className="flex cursor-not-allowed items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-muted/20 px-5 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-6 w-6 flex-none animate-spin" />
        Preparando… aguarde um instante
      </div>
    );
  }
  return (
    <>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          // A lista do arrasto é viva: copiar antes de qualquer espera.
          if (e.dataTransfer.files?.length) onArquivos(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer items-center rounded-2xl border-2 border-dashed transition-colors",
          compacta ? "gap-3 px-3 py-2.5" : "gap-4 px-5 py-4",
          arrastando
            ? "border-california-red/60 bg-california-red/5"
            : "border-border bg-muted/20 hover:border-california-red/40 hover:bg-california-red/5",
        )}
      >
        <UploadCloud className={cn("flex-none text-california-red/70", compacta ? "h-6 w-6" : "h-8 w-8")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Anexar arquivos</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {compacta
              ? "ou arraste para cá · PDF ou imagem, até 8 MB"
              : "ou arraste para cá · PDF ou imagem · até 8 MB por arquivo, 25 MB no total"}
          </span>
        </span>
        {!compacta && (
          <span className="flex-none rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground">
            Procurar
          </span>
        )}
      </label>
      <input
        id={id}
        type="file"
        multiple
        accept={PP_ANEXO_MIMETYPES_ACEITOS.join(",")}
        className="sr-only"
        onChange={(e) => {
          // A lista do campo é viva: copiar antes de limpar o campo.
          const escolhidos = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (escolhidos.length) onArquivos(escolhidos);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Os cartões dos arquivos
// ---------------------------------------------------------------------------

export interface ItemDeAnexo {
  id: string;
  nome: string;
  tamanhoBytes: number;
  mime: string;
  status: "selecionado" | "uploading" | "ok" | "erro" | "rejeitado";
  mensagem?: string;
  tipo: DocumentoTipo | null;
  numero: string | null;
}

/** O tipo obrigatório, sem opção em branco: nasce em "Escolha o tipo". */
export function TipoObrigatorio({
  valor,
  onChange,
  descricaoArquivo,
  invalido,
  disabled,
}: {
  valor: DocumentoTipo | null;
  onChange: (t: DocumentoTipo) => void;
  descricaoArquivo: string;
  invalido?: boolean;
  disabled?: boolean;
}) {
  return (
    <Select value={valor ?? undefined} onValueChange={(v) => onChange(v as DocumentoTipo)} disabled={disabled}>
      <SelectTrigger
        aria-label={`Tipo do documento de ${descricaoArquivo}`}
        className={cn("h-8 w-[136px] flex-none px-2 text-xs", invalido && VERMELHO)}
      >
        <SelectValue placeholder="Escolha o tipo" />
      </SelectTrigger>
      <SelectContent>
        {DOCUMENTO_TIPOS.map((t) => (
          <SelectItem key={t} value={t}>
            {documentoTipoLabel(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ListaDeAnexos({
  itens,
  onTipo,
  onNumero,
  onRemover,
  tipoInvalido,
  renderNf,
  obrigatorio = false,
  numeroInvalido,
  onVer,
  disabled,
}: {
  /** Na ordem de exibição: o mais novo em cima. */
  itens: ItemDeAnexo[];
  onTipo: (id: string, t: DocumentoTipo) => void;
  onNumero: (id: string, numero: string) => void;
  onRemover: (id: string) => void;
  tipoInvalido: (id: string) => boolean;
  /** Os campos da NF, para o arquivo do tipo NF. */
  renderNf: (id: string) => React.ReactNode;
  /** No envio, todo campo é obrigatório (com *). */
  obrigatorio?: boolean;
  numeroInvalido?: (id: string) => boolean;
  /** Abre o documento na tela lado a lado. */
  onVer?: (id: string) => void;
  disabled?: boolean;
}) {
  if (itens.length === 0) return null;
  return (
    <ul className="space-y-2">
      {itens.map((a) => {
        const Icone = a.mime.startsWith("image/") ? ImageIcon : FileText;
        const falhou = a.status === "erro" || a.status === "rejeitado";
        const situacao =
          a.status === "ok"
            ? "enviado"
            : a.status === "uploading"
              ? "enviando…"
              : a.status === "selecionado"
                ? "aguardando…"
                : a.status === "rejeitado"
                  ? `recusado: ${a.mensagem ?? "motivo desconhecido"}`
                  : (a.mensagem ?? "falha no envio");
        return (
          <li
            key={a.id}
            className={cn(
              "overflow-hidden rounded-xl border bg-white",
              falhou ? "border-california-red/40" : "border-border",
            )}
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-muted/60">
                <Icone className="h-4 w-4 text-california-red" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground" title={a.nome}>
                  {a.nome}
                </p>
                <p className={cn("truncate text-[11.5px]", falhou ? "text-california-red" : "text-muted-foreground")}>
                  {(a.tamanhoBytes / 1024).toFixed(0)} KB · {situacao}
                </p>
              </div>
              {a.status === "ok" && (
                <TipoObrigatorio
                  valor={a.tipo}
                  descricaoArquivo={a.nome}
                  invalido={tipoInvalido(a.id)}
                  onChange={(t) => onTipo(a.id, t)}
                  disabled={disabled}
                />
              )}
              {onVer && a.status === "ok" && (
                <button
                  type="button"
                  onClick={() => onVer(a.id)}
                  aria-label={`Ver ${a.nome}`}
                  title="Ver o documento"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-california-red"
                >
                  <Eye className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemover(a.id)}
                disabled={disabled || a.status === "uploading"}
                aria-label={`Remover ${a.nome}`}
                title="Remover"
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-california-red disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {a.status === "ok" && a.tipo === "nota_fiscal" && (
              <div className="border-t border-border px-3 pb-3 pt-2.5">{renderNf(a.id)}</div>
            )}
            {a.status === "ok" && a.tipo !== null && a.tipo !== "nota_fiscal" && (
              <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                <label htmlFor={`num-${a.id}`} className="text-[11px] font-medium text-muted-foreground">
                  Número do documento{obrigatorio ? " *" : ""}
                </label>
                <input
                  id={`num-${a.id}`}
                  value={a.numero ?? ""}
                  maxLength={60}
                  disabled={disabled}
                  onChange={(e) => onNumero(a.id, e.target.value)}
                  className={cn(
                    "h-8 w-44 rounded-lg border border-border bg-white px-2 font-mono text-xs text-foreground outline-none focus:border-california-red",
                    numeroInvalido?.(a.id) && VERMELHO,
                  )}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Os dados da NF, embaixo do arquivo
// ---------------------------------------------------------------------------

/**
 * Os campos da nota na linha do arquivo do tipo NF, e a parte desta PP.
 * Com a nota já no cadastro, os dados vêm de lá e ficam travados — o
 * número continua livre, para quem digitou o número errado.
 */
export function NfDoAnexo({
  nf,
  onMudar,
  faltas,
  idBase,
  tomadores,
  tomadorEsperado,
  empresaNome,
  existente,
  obrigatorio = false,
  compacta = false,
  disabled,
}: {
  nf: NfDigitada;
  /** Só o que mudou: quem guarda junta com o estado mais novo (o DatePicker
   *  guarda a função da primeira renderização). */
  onMudar: (parte: Partial<NfDigitada>) => void;
  /** Campos a pintar de vermelho (só depois de uma tentativa de enviar). */
  faltas: CampoNf[];
  idBase: string;
  tomadores: TomadorDaNf[];
  /** O CNPJ tomador da empresa emissora da PP — o aviso compara. */
  tomadorEsperado: string | null;
  empresaNome: string;
  /** A nota do cadastro com este número (null = nota nova). */
  existente: NotaExistente | null;
  obrigatorio?: boolean;
  /** Coluna estreita (tela lado a lado): dois campos por linha. */
  compacta?: boolean;
  disabled?: boolean;
}) {
  const ast = obrigatorio ? " *" : "";
  const hoje = hojeEmSaoPauloIso();
  const t = tomadores.find((x) => x.id === nf.tomador);
  const rotulo = "text-[11px] font-medium text-muted-foreground";
  const altura = "h-8 px-2 text-xs";
  const travada = existente !== null;
  const outras = existente?.pps ?? [];
  const jaNasOutras = outras.reduce((s, o) => s + (o.valor_na_pp ?? 0), 0);

  // A nota que já existe manda nos dados: data, valor e tomador vêm dela, e
  // a parte desta PP começa no que falta da nota (decisão 152).
  const chaveDaExistente = existente?.nota_id ?? null;
  React.useEffect(() => {
    if (!existente) return;
    const falta = Math.max(0, Math.round((existente.valor - jaNasOutras) * 100) / 100);
    onMudar({
      emissao: existente.emissao,
      valor: existente.valor,
      tomador: existente.tomador,
      cobreOutra: outras.length > 0 || nf.cobreOutra,
      valorNaPP: nf.cobreOutra && nf.valorNaPP > 0 ? nf.valorNaPP : falta,
    });
    // Só quando a nota encontrada muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDaExistente]);

  const aviso =
    t && tomadorEsperado && t.id !== tomadorEsperado
      ? `A nota está no CNPJ ${t.nome}, mas a PP sai pela ${empresaNome}. Se a nota veio no CNPJ errado, peça outra ao fornecedor antes de enviar.`
      : null;

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "grid gap-x-2 gap-y-2",
          compacta ? "grid-cols-2" : "grid-cols-[100px_148px_132px_minmax(0,1fr)]",
        )}
      >
        <div className="min-w-0">
          <label htmlFor={`${idBase}-numero`} className={rotulo}>
            Número da NF{ast}
          </label>
          <Input
            id={`${idBase}-numero`}
            value={nf.numero}
            onChange={(e) => onMudar({ numero: e.target.value })}
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            disabled={disabled}
            className={cn("font-mono", altura, faltas.includes("numero") && VERMELHO)}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${idBase}-emissao`} className={rotulo}>
            Data de emissão{ast}
          </label>
          {/* O DatePicker só lê o valor quando monta: a chave muda com a
              nota encontrada, para a data dela aparecer. */}
          <DatePicker
            key={`${idBase}-emissao-${chaveDaExistente ?? "nova"}`}
            id={`${idBase}-emissao`}
            name={`${idBase}_emissao`}
            defaultValue={(existente?.emissao ?? nf.emissao) || undefined}
            placeholder="Selecione"
            onDateChange={(d) => onMudar({ emissao: d ? isoDoDia(d) : "" })}
            dateDisabled={(d) => isoDoDia(d) > hoje}
            disabled={disabled || travada}
            className={cn(altura, faltas.includes("emissao") && VERMELHO)}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${idBase}-valor`} className={rotulo}>
            Valor da NF{ast}
          </label>
          <MoneyInput
            id={`${idBase}-valor`}
            value={nf.valor > 0 ? nf.valor : null}
            onValueChange={(v) => onMudar({ valor: v })}
            aria-label="Valor da NF"
            disabled={disabled || travada}
            className={cn(altura, faltas.includes("valor") && VERMELHO)}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${idBase}-tomador`} className={rotulo}>
            CNPJ tomador{ast}
          </label>
          <Select
            value={nf.tomador || undefined}
            onValueChange={(v) => onMudar({ tomador: v })}
            disabled={disabled || travada}
          >
            <SelectTrigger
              id={`${idBase}-tomador`}
              aria-label="CNPJ tomador"
              className={cn("font-mono text-[11px]", altura, faltas.includes("tomador") && VERMELHO)}
            >
              <SelectValue placeholder="Selecione">{t ? t.cnpj : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {tomadores.map((x) => (
                <SelectItem key={x.id} value={x.id} className="text-xs">
                  {x.nome} · <span className="font-mono">{x.cnpj}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {nf.cobreOutra && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${idBase}-parte`} className={rotulo}>
            Valor nesta PP{ast}
          </label>
          <MoneyInput
            id={`${idBase}-parte`}
            value={nf.valorNaPP > 0 ? nf.valorNaPP : null}
            onValueChange={(v) => onMudar({ valorNaPP: v })}
            aria-label="Valor nesta PP"
            disabled={disabled}
            className={cn("w-[132px]", altura, faltas.includes("valorNaPP") && VERMELHO)}
          />
          {nf.valor > 0 && (
            <span className="text-[11px] text-muted-foreground">
              de {formatCurrency(nf.valor, "BRL")} da nota
            </span>
          )}
        </div>
      )}

      {travada ? (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 flex-none" />
          <span>
            {outras.length > 0 ? (
              <>
                Esta NF já está na{" "}
                {outras.map((o, i) => (
                  <React.Fragment key={o.codigo}>
                    {i > 0 && ", "}
                    <span className="font-mono">{o.codigo}</span> ({formatCurrency(o.valor_na_pp ?? 0, "BRL")})
                  </React.Fragment>
                ))}
                . Os dados vêm de lá; só o financeiro corrige.
              </>
            ) : (
              "Esta NF já está no sistema. Os dados vêm de lá; só o financeiro corrige."
            )}
          </span>
        </p>
      ) : (
        !disabled && (
          <button
            type="button"
            onClick={() =>
              onMudar(
                nf.cobreOutra
                  ? { cobreOutra: false }
                  : { cobreOutra: true, valorNaPP: nf.valorNaPP > 0 ? nf.valorNaPP : nf.valor },
              )
            }
            className="text-[11px] font-semibold text-california-red underline-offset-2 hover:underline"
          >
            {nf.cobreOutra ? "Esta NF é só desta PP" : "Esta NF também cobre outra PP"}
          </button>
        )
      )}

      {aviso && (
        <p className="flex items-start gap-1.5 text-[11.5px] font-semibold leading-snug text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>{aviso}</span>
        </p>
      )}
    </div>
  );
}

/** Embaixo da lista: a parte das notas nesta PP conferida com o valor da
 *  PP. Com uma nota, só o aviso quando não bate; com várias, a soma. */
export function ResumoDasNfs({ valores, valorPP }: { valores: number[]; valorPP: number }) {
  if (valores.length === 0) return null;
  const soma = Math.round(valores.reduce((t, v) => t + (v || 0), 0) * 100) / 100;
  const difere = soma > 0 && valorPP > 0 && Math.abs(soma - valorPP) > 0.004;
  if (valores.length === 1) {
    if (!difere) return null;
    return (
      <p className="flex items-start gap-1.5 text-[11.5px] font-semibold leading-snug text-amber-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
        A NF nesta PP é de {formatCurrency(soma, "BRL")}; a PP, de {formatCurrency(valorPP, "BRL")}. Confira o valor.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-baseline justify-end gap-x-3 text-[11.5px] text-muted-foreground">
        <span>
          Soma das {valores.length} notas nesta PP{" "}
          <b className={cn("font-mono text-foreground", difere && "text-amber-800")}>{formatCurrency(soma, "BRL")}</b>
        </span>
        <span>
          Valor da PP <b className="font-mono text-foreground">{formatCurrency(valorPP, "BRL")}</b>
        </span>
      </p>
      {difere && (
        <p className="flex items-start justify-end gap-1.5 text-[11.5px] font-semibold leading-snug text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          A soma das notas não bate com o valor da PP. Confira os valores.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Os anexos em edição: os já salvos e os que sobem agora
// ---------------------------------------------------------------------------

const BUCKET = "pedidos-compra";

function nomeSeguro(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

/** Um arquivo da lista, salvo ou recém-anexado. */
export interface AnexoEmEdicao {
  id: string;
  nome: string;
  tamanhoBytes: number;
  mime: string;
  /** Onde o arquivo está no bucket ("" até subir). */
  path: string;
  status: ItemDeAnexo["status"];
  mensagem?: string;
  tipo: DocumentoTipo | null;
  /** O número do documento, fora da NF (na NF, o número fica em `nf`). */
  numero: string | null;
  nf: NfDigitada;
  /** Já gravado (na PP a emitir ou na PP): sai do bucket só ao salvar. */
  salvo: boolean;
  /** O arquivo, nos que subiram agora — a tela lado a lado mostra por ele. */
  file?: File;
  /** A ordem da lista (a mais nova fica em cima). */
  criadoEm: string;
}

/** Um anexo gravado, como a PP a emitir e a PP o guardam. */
export interface AnexoGravado {
  id: string;
  arquivo_path?: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
  arquivo_mimetype: string;
  documento_tipo: DocumentoTipo | null;
  documento_numero: string | null;
  nf_data_emissao: string | null;
  nf_valor: number | null;
  nf_tomador_estabelecimento_id: string | null;
  nf_valor_na_pp: number | null;
  created_at: string;
}

/** O anexo gravado, no formato da lista em edição. */
export function anexoEmEdicao(a: AnexoGravado, tomadorPadrao: string | null): AnexoEmEdicao {
  const nf = a.documento_tipo === "nota_fiscal";
  const valor = a.nf_valor ?? 0;
  const parte = a.nf_valor_na_pp;
  return {
    id: a.id,
    nome: a.arquivo_nome_original,
    tamanhoBytes: a.arquivo_tamanho_bytes,
    mime: a.arquivo_mimetype,
    path: a.arquivo_path ?? "",
    status: "ok",
    tipo: a.documento_tipo,
    numero: nf ? null : a.documento_numero,
    nf: nf
      ? {
          numero: a.documento_numero ?? "",
          emissao: a.nf_data_emissao ?? "",
          valor,
          tomador: a.nf_tomador_estabelecimento_id ?? tomadorPadrao ?? "",
          valorNaPP: parte ?? valor,
          cobreOutra: parte !== null && valor > 0 && Math.abs(parte - valor) > 0.004,
        }
      : { ...NF_VAZIA, tomador: tomadorPadrao ?? "" },
    salvo: true,
    criadoEm: a.created_at,
  };
}

/** No formato que as Server Actions recebem (`anexoUploadedSchema`). */
export function anexoParaEnvio(a: AnexoEmEdicao) {
  const ehNf = a.tipo === "nota_fiscal";
  return {
    anexo_id: a.id,
    documento_tipo: a.tipo,
    documento_numero: a.tipo ? ((ehNf ? a.nf.numero : (a.numero ?? "")).trim() || null) : null,
    path: a.path,
    nome_original: a.nome,
    tamanho_bytes: a.tamanhoBytes,
    mimetype: a.mime as (typeof PP_ANEXO_MIMETYPES_ACEITOS)[number],
    nf_data_emissao: ehNf ? a.nf.emissao || null : null,
    nf_valor: ehNf && a.nf.valor > 0 ? a.nf.valor : null,
    nf_tomador_estabelecimento_id: ehNf ? a.nf.tomador || null : null,
    nf_valor_na_pp: ehNf && a.nf.cobreOutra && a.nf.valorNaPP > 0 ? a.nf.valorNaPP : null,
  };
}

/**
 * O que falta nos anexos para ENVIAR ao financeiro (decisão 152): pelo
 * menos um arquivo; o tipo de cada um; o número dos documentos; e, em
 * cada NF, os quatro dados e a parte desta PP. Null = nada.
 */
export function faltaNosAnexosParaEnviar(anexos: AnexoEmEdicao[]): string | null {
  const ok = anexos.filter((a) => a.status === "ok");
  if (anexos.some((a) => a.status === "uploading" || a.status === "selecionado")) {
    return "Aguarde os arquivos terminarem de subir.";
  }
  if (ok.length === 0) return "Anexe a nota fiscal do fornecedor.";
  const semTipo = ok.find((a) => !a.tipo);
  if (semTipo) return `Escolha o tipo de “${semTipo.nome}”.`;
  const semNumero = ok.find((a) => a.tipo !== "nota_fiscal" && !(a.numero ?? "").trim());
  if (semNumero) return `Preencha o número do documento de “${semNumero.nome}”.`;
  const nfIncompleta = ok.find((a) => a.tipo === "nota_fiscal" && faltasDaNf(a.nf).length > 0);
  if (nfIncompleta) {
    return faltasDaNf(nfIncompleta.nf).every((c) => c === "valorNaPP")
      ? `Informe o valor da NF “${nfIncompleta.nome}” nesta PP (até o valor da nota).`
      : `Preencha a nota “${nfIncompleta.nome}”: número, data de emissão, valor e CNPJ tomador.`;
  }
  const chaves = ok
    .filter((a) => a.tipo === "nota_fiscal")
    .map((a) => chaveDoNumeroDaNf(a.nf.numero));
  if (chaves.some((c, i) => c !== null && chaves.indexOf(c) !== i)) {
    return "A mesma NF aparece duas vezes nesta PP.";
  }
  return null;
}

/**
 * A lista de anexos em edição e a subida dos arquivos para o bucket, no
 * lugar da PP (`prefixo`). Remover um arquivo que acabou de subir tira do
 * bucket na hora; o já gravado só sai quando a tela salva.
 */
export function useAnexosEmEdicao(prefixo: string | null, tomadorPadrao: string | null) {
  const supabase = React.useMemo(() => createClient(), []);
  const [anexos, setAnexos] = React.useState<AnexoEmEdicao[]>([]);
  const [aviso, setAviso] = React.useState<string | null>(null);

  async function subir(arquivos: File[]) {
    if (arquivos.length === 0) return;
    if (!prefixo) {
      setAviso("Aguarde: a preparação ainda não terminou. Tente de novo em 2 segundos.");
      return;
    }
    let soma = anexos.reduce((s, a) => s + (a.status === "rejeitado" ? 0 : a.tamanhoBytes), 0);
    const novos: AnexoEmEdicao[] = [];
    for (const file of arquivos) {
      const id = crypto.randomUUID();
      const base: AnexoEmEdicao = {
        id,
        nome: file.name,
        tamanhoBytes: file.size,
        mime: file.type,
        path: "",
        status: "selecionado",
        // O tipo nasce vazio: quem anexa escolhe (Tiago, 06/10/2026).
        tipo: null,
        numero: null,
        nf: { ...NF_VAZIA, tomador: tomadorPadrao ?? "" },
        salvo: false,
        file,
        // Um horário por arquivo: soltos juntos, ainda ficam em ordem.
        criadoEm: new Date(Date.now() + novos.length).toISOString(),
      };
      if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as (typeof PP_ANEXO_MIMETYPES_ACEITOS)[number])) {
        novos.push({ ...base, status: "rejeitado", mensagem: `tipo não aceito (${file.type || "sem tipo"})` });
        continue;
      }
      if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: `passa de 8 MB (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
        });
        continue;
      }
      if (soma + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        novos.push({ ...base, status: "rejeitado", mensagem: "o total passaria de 25 MB" });
        continue;
      }
      soma += file.size;
      novos.push({ ...base, path: `${prefixo}${id}-${nomeSeguro(file.name)}`, status: "uploading" });
    }
    setAviso(null);
    setAnexos((prev) => [...prev, ...novos]);
    await Promise.all(
      novos
        .filter((n) => n.status === "uploading")
        .map(async (n) => {
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(n.path, n.file!, { contentType: n.file!.type, upsert: false });
          setAnexos((prev) =>
            prev.map((p) =>
              p.id === n.id ? { ...p, status: error ? "erro" : "ok", mensagem: error?.message } : p,
            ),
          );
        }),
    );
  }

  async function remover(id: string) {
    const alvo = anexos.find((a) => a.id === id);
    if (!alvo) return;
    setAnexos((prev) => prev.filter((p) => p.id !== id));
    // O que acabou de subir sai do bucket já; o gravado, só ao salvar.
    if (!alvo.salvo && alvo.status === "ok") {
      await supabase.storage.from(BUCKET).remove([alvo.path]);
    }
  }

  const mudar = (id: string, parte: Partial<AnexoEmEdicao>) =>
    setAnexos((prev) => prev.map((p) => (p.id === id ? { ...p, ...parte } : p)));
  const mudarNf = (id: string, parte: Partial<NfDigitada>) =>
    setAnexos((prev) => prev.map((p) => (p.id === id ? { ...p, nf: { ...p.nf, ...parte } } : p)));

  return { anexos, setAnexos, subir, remover, mudar, mudarNf, aviso, setAviso };
}

/** A lista na ordem da tela: o anexo mais novo em cima (Tiago, 06/10/2026). */
export function itensDaLista(anexos: AnexoEmEdicao[]): ItemDeAnexo[] {
  return anexos
    .slice()
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .map((a) => ({
      id: a.id,
      nome: a.nome,
      tamanhoBytes: a.tamanhoBytes,
      mime: a.mime,
      status: a.status,
      mensagem: a.mensagem,
      tipo: a.tipo,
      numero: a.numero,
    }));
}
