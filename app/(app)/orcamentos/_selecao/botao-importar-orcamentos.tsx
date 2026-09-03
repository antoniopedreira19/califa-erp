import { Upload } from "lucide-react";

/**
 * "Importar" da página do projeto e da visão agregada.
 *
 * O botão já está no lugar que o design `Exportar e Exibir - Projeto e
 * Visao Agregada` reservou para ele, mas a importação — a planilha
 * exportada do projeto voltando como versão nova de cada orçamento, com o
 * orçado atualizado e o planejado preservado — ainda está em definição
 * com o Tiago (03/09/2026). Até lá ele fica desabilitado, com o motivo no
 * tooltip, em vez de abrir um fluxo pela metade.
 */
export function BotaoImportarOrcamentos() {
  return (
    <button
      type="button"
      disabled
      title="A importação da planilha do projeto ainda está em definição."
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground opacity-50"
    >
      <Upload className="h-3.5 w-3.5" />
      Importar
    </button>
  );
}
