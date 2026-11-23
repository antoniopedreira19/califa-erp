"use client";

/**
 * O "Editar registro" da aba Tomadas (decisão 271, ponto 6): o financeiro
 * corrige número, emissão, valor e CNPJ tomador das notas em avaliação na
 * própria tabela. Nada grava até o rodapé; o "Salvar alterações" abre a
 * confirmação com o de → para de cada nota, quem acompanha e o motivo.
 *
 * `analisar` antecipa na tela o que a RPC `alterar_registro_das_notas`
 * confere de novo no banco: o número que já existe no mesmo emitente (6b:
 * junta), o saldo dos documentos e a troca do CNPJ da PP (revisão da 156).
 */
import * as React from "react";
import { AlertCircle, AlertTriangle, ArrowRight, Check, FilePenLine, Info, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDocumento } from "@/lib/utils";
import type { CnpjDaLista, NotaTomada } from "./dados";
import { dataBR, moeda } from "./comum";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** A mesma chave do banco (`chave_do_numero_da_nf`): sem pontuação, espaços e zeros à esquerda. */
export const chaveDoNumero = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^0+/, "");

/** O que o financeiro digitou numa linha. */
export interface EdicaoDaLinha {
  numero: string;
  emissao: string;
  valor: number | null;
  tomadorId: string | null;
}
export type Edicoes = Record<string, EdicaoDaLinha>;
export type CampoDaEdicao = "numero" | "emissao" | "valor" | "tomador";

/** Só a nota em avaliação (ainda não registrada) se altera. */
export const podeEditar = (n: NotaTomada) => n.situacao === "em_avaliacao" && !n.registrada_em;

export function edicaoInicial(n: NotaTomada): EdicaoDaLinha {
  return { numero: n.numero, emissao: n.data_emissao, valor: n.valor, tomadorId: n.tomador?.id ?? null };
}

export interface Analise {
  /** "Número: 03 → 1103", para o pop-up. */
  mudancas: string[];
  campos: Set<CampoDaEdicao>;
  erro: string | null;
  /** O que acontece junto (juntar com outra nota, a PP que muda de CNPJ). */
  avisos: string[];
  /** Os documentos que acompanham. */
  acompanham: string[];
}

export function analisar(n: NotaTomada, e: EdicaoDaLinha, notas: NotaTomada[], cnpjs: CnpjDaLista[], hoje: string): Analise {
  const mudancas: string[] = [];
  const campos = new Set<CampoDaEdicao>();
  const avisos: string[] = [];
  const valem = n.documentos.filter((d) => d.vale);
  const acompanham = valem.map((d) => d.codigo);
  let erro: string | null = null;

  const numero = e.numero.trim();
  if (numero !== n.numero) {
    mudancas.push(`Número: ${n.numero} → ${numero || "—"}`);
    campos.add("numero");
  }
  if (e.emissao !== n.data_emissao) {
    mudancas.push(`Emissão: ${dataBR(n.data_emissao)} → ${e.emissao ? dataBR(e.emissao) : "—"}`);
    campos.add("emissao");
  }
  if (e.valor !== null && Math.abs(e.valor - n.valor) > 0.004) {
    mudancas.push(`Valor: ${moeda(n.valor)} → ${moeda(e.valor)}`);
    campos.add("valor");
  }
  if (e.tomadorId !== (n.tomador?.id ?? null)) {
    const novo = cnpjs.find((c) => c.id === e.tomadorId);
    mudancas.push(`CNPJ tomador: ${n.tomador?.nome ?? "—"} → ${novo?.nome ?? "—"}`);
    campos.add("tomador");
    // A empresa da PP segue o CNPJ da nota (revisão da 156).
    if (novo) {
      for (const d of valem) {
        if (d.origem === "pp") {
          const atual = d.cnpjDaPP ?? n.tomador?.id ?? null;
          if (atual && atual !== novo.id) {
            const antes = cnpjs.find((c) => c.id === atual)?.nome ?? n.tomador?.nome ?? "outro CNPJ";
            avisos.push(`A ${d.codigo} passa de ${antes} para ${novo.nome}, e o PDF da PP é refeito.`);
          }
        } else if (d.origem === "desembolso") {
          avisos.push(`O ${d.codigo} passa para ${novo.nome}, como a PP.`);
        }
      }
    }
  }
  if (mudancas.length === 0) return { mudancas, campos, erro: null, avisos: [], acompanham };

  if (!chaveDoNumero(numero)) erro = "Informe o número da NF.";
  else if (!e.emissao) erro = "Informe a emissão.";
  else if (e.emissao > hoje) erro = "A emissão está no futuro.";
  else if (e.valor === null || e.valor <= 0) erro = "Informe o valor da NF.";
  else if (!e.tomadorId) erro = "Escolha o CNPJ tomador.";

  // 6b: o número que já existe no mesmo emitente → as duas viram uma.
  let juntou = false;
  if (!erro && campos.has("numero")) {
    const outra = notas.find((x) => x.id !== n.id && x.fornecedor.id === n.fornecedor.id && chaveDoNumero(x.numero) === chaveDoNumero(numero));
    if (outra) {
      const docs = outra.documentos.filter((d) => d.vale);
      const ondeEsta = docs.length ? docs.map((d) => d.codigo).join(", ") : "nenhum documento";
      if (outra.registrada_em) {
        erro = `A NF ${outra.numero} já foi registrada pelo financeiro (${ondeEsta}): não dá para juntar a ela.`;
      } else {
        juntou = true;
        const soma = r2(docs.reduce((s, d) => s + d.parte, 0) + valem.reduce((s, d) => s + d.parte, 0));
        if (soma > (e.valor ?? 0) + 0.004) {
          erro = `A NF ${outra.numero} já existe em ${ondeEsta}, com o valor de ${moeda(outra.valor)}. Juntas, as partes somam ${moeda(soma)}, mais que o valor desta linha (${moeda(e.valor ?? 0)}): ajuste o valor para juntar.`;
        } else {
          avisos.unshift(
            `A NF ${outra.numero} já existe em ${ondeEsta} (emissão ${dataBR(outra.data_emissao)}, ${moeda(outra.valor)}): as duas viram uma só, com os dados desta linha.`,
          );
          // Sem a série, o mesmo número pode ser de outra nota.
          if (outra.data_emissao !== e.emissao || Math.abs(outra.valor - (e.valor ?? 0)) > 0.004)
            avisos.splice(
              1,
              0,
              `Atenção: a emissão ou o valor da NF ${outra.numero} que já existe é diferente desta linha. Confira se é a mesma nota (pode ser de outra série).`,
            );
          acompanham.push(...docs.map((d) => d.codigo).filter((c) => !acompanham.includes(c)));
          // A nota que já existia fica com o CNPJ desta linha: as PPs dela seguem.
          const novo = cnpjs.find((c) => c.id === e.tomadorId);
          if (novo)
            for (const d of docs)
              if (d.origem === "pp" && (d.cnpjDaPP ?? outra.tomador?.id ?? null) !== novo.id)
                avisos.push(
                  `A ${d.codigo} passa de ${cnpjs.find((c) => c.id === (d.cnpjDaPP ?? outra.tomador?.id))?.nome ?? "outro CNPJ"} para ${novo.nome}, e o PDF da PP é refeito.`,
                );
        }
      }
    }
  }

  // O valor não fica abaixo do que os documentos já cobrem.
  if (!erro && !juntou && e.valor !== null) {
    const partes = r2(valem.reduce((s, d) => s + d.parte, 0));
    if (partes > e.valor + 0.004)
      erro = `Os documentos desta nota somam ${moeda(partes)} (${acompanham.join(", ")}): o valor da NF não pode ficar abaixo disso.`;
  }

  return { mudancas, campos, erro, avisos, acompanham };
}

/** A faixa acima da tabela enquanto o registro está aberto. */
export function FaixaDaEdicao() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-[#fffbeb] px-4 py-3 text-[12.5px] text-[#92400e]">
      <FilePenLine className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-0.5">
        <p className="font-semibold">Editando o registro das notas</p>
        <p>
          Só as notas em avaliação (ainda não registradas) se alteram, e todos os documentos de cada uma acompanham. A nota registrada volta a se
          alterar quando a aprovação do documento é revertida. É exceção: os dados vêm da leitura da NF. Nada é gravado até você salvar no rodapé
          e confirmar com o motivo.
        </p>
        <p className="text-[12px]">
          Com a PP em avaliação, quem a enviou também corrige pelo “Corrigir a NF” da própria PP (lá sem motivo: é quem enviou, antes da
          conferência).
        </p>
      </div>
    </div>
  );
}

/** O rodapé da edição: o que mudou e os botões. */
export function RodapeDaEdicao({
  alteradas,
  comErro,
  onCancelar,
  onSalvar,
}: {
  alteradas: number;
  comErro: number;
  onCancelar: () => void;
  onSalvar: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-white/95 px-5 py-3.5 shadow-soft backdrop-blur">
      <span
        className={cn(
          "inline-flex items-center gap-2 text-[12.5px] font-medium",
          comErro ? "text-california-red" : alteradas ? "text-emerald-700" : "text-muted-foreground",
        )}
      >
        {comErro ? <AlertCircle className="h-3.5 w-3.5" /> : alteradas ? <Check className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
        {comErro
          ? comErro === 1
            ? "Uma nota tem problema: corrija antes de salvar."
            : `${comErro} notas têm problema: corrija antes de salvar.`
          : alteradas === 0
            ? "Nenhuma alteração ainda."
            : alteradas === 1
              ? "1 nota alterada."
              : `${alteradas} notas alteradas.`}
      </span>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSalvar}
          disabled={alteradas === 0 || comErro > 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red/90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Check className="h-4 w-4" />
          Salvar alterações
        </button>
      </div>
    </div>
  );
}

/** O pop-up que fecha a edição: o de → para de cada nota e o motivo. */
export function ConfirmarEdicaoDialog({
  itens,
  erro,
  gravando,
  onVoltar,
  onConfirmar,
}: {
  itens: Array<{ n: NotaTomada; a: Analise }>;
  erro: string | null;
  gravando: boolean;
  onVoltar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [tentou, setTentou] = React.useState(false);
  const curto = motivo.trim().length < 10;
  return (
    <Dialog open onOpenChange={(o) => !o && !gravando && onVoltar()}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePenLine className="h-4.5 w-4.5 text-california-red" />
            Confirmar a alteração do registro
          </DialogTitle>
          <DialogDescription>
            Vale na hora, para todos os documentos de cada nota. Fica registrado quem alterou, quando e o motivo, na nota e no histórico de cada
            documento.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
          {itens.map(({ n, a }) => (
            <div key={n.id} className="space-y-2 rounded-xl border border-border px-4 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-mono font-bold">NF {n.numero}</span>
                <span className="text-muted-foreground">
                  {n.fornecedor.razao_social ?? n.fornecedor.nome}
                  {n.fornecedor.documento ? ` · ${formatDocumento(n.fornecedor.documento)}` : ""}
                </span>
              </p>
              <ul className="space-y-1">
                {a.mudancas.map((m) => {
                  const [campo, resto] = m.split(": ");
                  const [de, para] = resto.split(" → ");
                  return (
                    <li key={m} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      <span className="w-[92px] shrink-0 text-muted-foreground">{campo}</span>
                      <span className="font-mono text-muted-foreground line-through">{de}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono font-semibold">{para}</span>
                    </li>
                  );
                })}
              </ul>
              {a.avisos.map((t) => (
                <p key={t} className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-[#fffbeb] px-2.5 py-1.5 text-[12px] text-[#92400e]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t}
                </p>
              ))}
              <p className="text-[12px] text-muted-foreground">
                {a.acompanham.length === 0
                  ? "Nenhum documento ativo traz esta nota."
                  : a.acompanham.length === 1
                    ? `Acompanha: ${a.acompanham[0]}.`
                    : `Acompanham: ${a.acompanham.join(", ")}.`}
              </p>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="motivo-edicao-nf" className="text-[13px] font-semibold">
            Motivo da alteração <span className="text-california-red">*</span>
          </label>
          <Textarea
            id="motivo-edicao-nf"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
            placeholder="Ex.: o número foi digitado errado na PP; conferido no PDF da nota."
            rows={3}
            disabled={gravando}
          />
          {tentou && curto && <p className="text-[12px] text-california-red">Escreva o motivo (pelo menos 10 caracteres).</p>}
        </div>
        {erro && (
          <p className="flex items-start gap-1.5 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2 text-[12.5px] text-california-red">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {erro}
          </p>
        )}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onVoltar}
            disabled={gravando}
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={gravando}
            onClick={() => {
              setTentou(true);
              if (!curto) onConfirmar(motivo.trim());
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-california-red/90 disabled:opacity-60"
          >
            {gravando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {gravando ? "Gravando…" : "Confirmar alteração"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
