"use client";

/**
 * O tipo da verba e quem recebe a verba de alimentação ou de transporte
 * (decisão 164, desenho aprovado em 09/10/2026).
 *
 * - O switch de sempre passa a se chamar "Verba"; ligado, ao lado, escolhe
 *   Produção, Alimentação ou Transporte (ligar cai em Produção, como antes).
 * - Na alimentação e no transporte, o "Titular da verba" sai de uma lista
 *   só: colaboradores do RH e freelas trabalhando, com a busca pelo nome, a
 *   função e o nome social. A caixa "Terceiro (fornecedor)", desmarcada por
 *   padrão, troca para o campo Fornecedor de sempre (com o pagamento do
 *   fornecedor). Para a pessoa não há campo de pagamento: o financeiro
 *   decide na aprovação, como na verba de produção.
 */

import * as React from "react";
import { Combobox, COMBOBOX_COMO_SELECT, type ComboboxItem } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { TipoVerba } from "@/lib/types";
import type { PessoaParaVerba } from "@/lib/data/pessoas-para-verba";

const SEGMENTO = "flex rounded-lg border border-border bg-white p-0.5";
const BOTAO_SEG =
  "inline-flex h-8 flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-50";

const TIPOS: Array<[TipoVerba, string]> = [
  ["producao", "Produção"],
  ["alimentacao", "Alimentação"],
  ["transporte", "Transporte"],
];

/** O switch "Verba" e, ligado, qual verba. `null` = PP de fornecedor. */
export function TipoDaVerbaField({
  tipo,
  onChange,
  disabled,
}: {
  tipo: TipoVerba | null;
  onChange: (t: TipoVerba | null) => void;
  disabled?: boolean;
}) {
  const ligado = tipo !== null;
  return (
    <div className="flex min-h-9 items-center gap-2.5">
      <label className="flex cursor-pointer items-center gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          disabled={disabled}
          onClick={() => onChange(ligado ? null : "producao")}
          className={cn(
            "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors",
            ligado ? "bg-california-red" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
              ligado ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
        <span className="text-sm font-medium">Verba</span>
      </label>
      {ligado && (
        <div role="radiogroup" aria-label="Qual verba" className={cn(SEGMENTO, "ml-auto w-[330px]")}>
          {TIPOS.map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={v === tipo}
              disabled={disabled}
              onClick={() => onChange(v)}
              className={cn(
                BOTAO_SEG,
                v === tipo ? "bg-[#282828] text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      )}
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

/** "Titular da verba *", a caixa do terceiro e a lista de pessoas. */
export function TitularDaVerbaField({
  itens,
  carregando,
  titularId,
  onTitular,
  terceiro,
  onTerceiro,
  disabled,
}: {
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
      <label className="text-xs font-medium">Titular da verba *</label>
      <CaixaTerceiro marcado={terceiro} onChange={onTerceiro} disabled={disabled} />
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
