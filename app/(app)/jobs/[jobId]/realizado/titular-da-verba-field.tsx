"use client";

/**
 * O tipo da verba e quem recebe a verba (decisão 164, desenho aprovado em
 * 09/10/2026; nas três verbas desde a decisão 171, 14/10/2026).
 *
 * - O switch de sempre passa a se chamar "Verba"; ligado, ao lado, escolhe
 *   Produção, Alimentação ou Transporte (ligar cai em Produção, como antes).
 *   Desde a decisão 187 (17/10/2026) o tipo da PP é marcado numa lista
 *   empilhada — Normal, Verba e Reembolso, com a bolinha do "Esta é a
 *   última PP deste item?" —, e ao lado da Verba ou do Reembolso aparecem
 *   as opções dele (o "Marcar · empilhado" que o Tiago escolheu).
 * - O "Titular da verba" sai de uma lista só: colaboradores do RH e freelas
 *   trabalhando, com a busca pelo nome, a função e o nome social. A caixa
 *   "Terceiro (fornecedor)", desmarcada por padrão, troca para o campo
 *   Fornecedor de sempre (com o pagamento do fornecedor). Para a pessoa não
 *   há campo de pagamento: a do colaborador sai com a conta e o PIX da
 *   ficha do RH, copiados pelo banco (decisão 171); a do freela, sem — o
 *   financeiro decide na aprovação.
 */

import * as React from "react";
import { Combobox, COMBOBOX_COMO_SELECT, type ComboboxItem } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { TipoVerba } from "@/lib/types";
import { REEMBOLSO_TIPOS, type ReembolsoTipo } from "@/lib/calculos/reembolso";
import type { PessoaParaVerba } from "@/lib/data/pessoas-para-verba";

const SEGMENTO = "flex rounded-lg border border-border bg-white p-0.5";
const BOTAO_SEG =
  "inline-flex h-8 flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-50";

const TIPOS: Array<[TipoVerba, string]> = [
  ["producao", "Produção"],
  ["alimentacao", "Alimentação"],
  ["transporte", "Transporte"],
];

/** Uma opção com a bolinha do "Esta é a última PP deste item?". */
function Bolinha({
  rotulo,
  marcada,
  onClick,
  disabled,
}: {
  rotulo: string;
  marcada: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2.5 whitespace-nowrap text-sm font-medium disabled:opacity-50"
    >
      <span
        className={cn(
          "inline-flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full border-[1.5px]",
          marcada ? "border-foreground" : "border-[#C9C4B8]",
        )}
      >
        <span className={cn("h-[7px] w-[7px] rounded-full", marcada ? "bg-foreground" : "bg-transparent")} />
      </span>
      {rotulo}
    </button>
  );
}

function Segmento<T extends string>({
  rotulo,
  opcoes,
  valor,
  onChange,
  disabled,
}: {
  rotulo: string;
  opcoes: ReadonlyArray<readonly [T, string]>;
  valor: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className={cn(SEGMENTO, "ml-auto w-[330px]")}>
      {opcoes.map(([v, nome]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === valor}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cn(
            BOTAO_SEG,
            v === valor ? "bg-[#282828] text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {nome}
        </button>
      ))}
    </div>
  );
}

/**
 * O tipo da PP (decisão 187): Normal, Verba (Produção · Alimentação ·
 * Transporte) ou Reembolso (Despesas · Veículo próprio). Marcar Verba cai em
 * Produção e marcar Reembolso cai em Despesas, como o switch de antes.
 * `tipo` null = PP normal (de fornecedor).
 */
export function TipoDaPPField({
  tipo,
  reembolsoTipo,
  onChange,
  disabled,
}: {
  tipo: TipoVerba | null;
  reembolsoTipo: ReembolsoTipo | null;
  onChange: (tipo: TipoVerba | null, reembolsoTipo: ReembolsoTipo | null) => void;
  disabled?: boolean;
}) {
  const reembolso = tipo === "reembolso";
  const verba = tipo !== null && !reembolso;
  const atual = reembolso ? "reembolso" : verba ? "verba" : "normal";
  const opcoes: Array<["normal" | "verba" | "reembolso", string]> = [
    ["normal", "Normal"],
    ["verba", "Verba"],
    ["reembolso", "Reembolso"],
  ];
  return (
    <div role="radiogroup" aria-label="Tipo da PP" className="flex flex-col gap-1">
      {opcoes.map(([v, rotulo]) => (
        <div key={v} className="flex min-h-9 items-center gap-2.5">
          <Bolinha
            rotulo={rotulo}
            marcada={v === atual}
            disabled={disabled}
            onClick={() => {
              if (v === atual) return;
              if (v === "normal") onChange(null, null);
              else if (v === "verba") onChange("producao", null);
              else onChange("reembolso", "despesas");
            }}
          />
          {v === "verba" && verba && (
            <Segmento
              rotulo="Qual verba"
              opcoes={TIPOS}
              valor={tipo}
              onChange={(t) => onChange(t, null)}
              disabled={disabled}
            />
          )}
          {v === "reembolso" && reembolso && (
            <Segmento
              rotulo="Qual reembolso"
              opcoes={REEMBOLSO_TIPOS}
              valor={reembolsoTipo ?? "despesas"}
              onChange={(r) => onChange("reembolso", r)}
              disabled={disabled}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A caixa "Terceiro (fornecedor)" no canto do rótulo. Fica por fora da
 * linha do rótulo (absoluta): numa linha em flex o rótulo perdia a altura de
 * linha de sempre e o campo subia para perto dele (comentário do Tiago no
 * protótipo, 09/10/2026). O pai precisa ser `relative`.
 */
export function CaixaTerceiro({
  marcado,
  onChange,
  disabled,
}: {
  marcado: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="absolute right-0 top-[4px] inline-flex h-[18px] cursor-pointer items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
      <input
        type="checkbox"
        className="h-4 w-4 accent-california-red"
        checked={marcado}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      Terceiro (fornecedor)
    </label>
  );
}

/** As opções da lista: colaboradores primeiro, depois os freelas. */
export function itensDasPessoas(
  pessoas: PessoaParaVerba[] | null,
  escolhido: { id: string; nome: string | null } | null,
): ComboboxItem[] {
  const itens: ComboboxItem[] = (pessoas ?? []).map((p) => ({
    value: p.id,
    label: p.nome,
    descricao: [p.funcao, p.detalhe].filter(Boolean).join(" · ") || undefined,
    busca: p.busca ?? undefined,
    grupo: p.origem === "colaborador" ? "Colaboradores (RH)" : "Freelas",
  }));
  // A PP a emitir salva com alguém que saiu da lista: o nome continua no
  // campo, e o servidor pede outra escolha ao salvar.
  if (pessoas && escolhido?.id && escolhido.nome && !itens.some((i) => i.value === escolhido.id)) {
    itens.push({ value: escolhido.id, label: escolhido.nome, descricao: "Fora da lista", grupo: "Fora da lista" });
  }
  return itens;
}

/** "Titular da verba *", a caixa do terceiro e a lista de pessoas. No
 *  reembolso (decisão 187), "Titular do reembolso *", sem terceiro. */
export function TitularDaVerbaField({
  rotulo = "Titular da verba *",
  semTerceiro = false,
  itens,
  carregando,
  titularId,
  onTitular,
  terceiro,
  onTerceiro,
  disabled,
}: {
  rotulo?: string;
  /** Decisão 187: o reembolso vai só para colaborador ou freela. */
  semTerceiro?: boolean;
  itens: ComboboxItem[];
  carregando: boolean;
  titularId: string;
  onTitular: (id: string) => void;
  terceiro: boolean;
  onTerceiro: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <label className="text-xs font-medium">{rotulo}</label>
      {!semTerceiro && <CaixaTerceiro marcado={terceiro} onChange={onTerceiro} disabled={disabled} />}
      <Combobox
        items={itens}
        value={titularId || null}
        onChange={(v) => onTitular(v ?? "")}
        placeholder={carregando ? "Carregando a lista…" : "Escolha um colaborador ou freela"}
        buscaPlaceholder="Escreva o nome ou a função"
        limpavel
        disabled={disabled || carregando}
        className={COMBOBOX_COMO_SELECT}
      />
    </div>
  );
}
