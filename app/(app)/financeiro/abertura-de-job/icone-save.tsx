import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SAVE } from "@/app/(app)/_planilha/blocos";
import type { SaveAprovacaoTipo } from "@/lib/types";

/**
 * O ícone da coluna Save, fora da planilha (decisão 099): a faixa Saves da
 * fila, o pop-up de aprovação, o bloco "Saves deste job" da conferência e
 * a faixa da revisão. É o MESMO desenho da célula (`_planilha/save-coluna`)
 * e as mesmas classes de `_planilha/blocos.ts` — quem aprova reconhece a
 * linha pelo que viu na planilha.
 *
 *   gera     ↗ grafite cheio
 *   consome  ↙ código do job de origem (+N quando são várias)
 */
export function IconeSave({
  tipo,
  origens,
}: {
  tipo: SaveAprovacaoTipo;
  /** Consome: os códigos das origens, maior primeiro. Gera: `[]`. */
  origens: string[];
}) {
  if (tipo === "gera") {
    return (
      <span className={SAVE.botaoGera} aria-hidden>
        <ArrowUpRight className="h-[11px] w-[11px]" />
      </span>
    );
  }
  const [maior, ...resto] = origens;
  return (
    <span className={SAVE.botaoCodigo} aria-hidden>
      <ArrowDownLeft className={cn("h-[9px] w-[9px] flex-none", SAVE.icone)} />
      {maior ?? "—"}
      {resto.length > 0 && <span className={SAVE.pastilhaMais}>+{resto.length}</span>}
    </span>
  );
}

/** "Gera save · Cenografia · Palco" / "Consome save · Catering · Almoço". */
export function rotuloDoSave(
  tipo: SaveAprovacaoTipo,
  grupoNome: string | null,
  item: string,
): string {
  return [tipo === "gera" ? "Gera save" : "Consome save", grupoNome, item]
    .filter(Boolean)
    .join(" · ");
}
