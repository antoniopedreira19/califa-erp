import { FileText } from "lucide-react";
import { CardBase, EmBreve } from "./card-base";

/**
 * Placeholder — ainda não há um módulo de documentos pessoais do
 * colaborador (contrato, aditivos, holerites). Vai consumir o bucket
 * privado quando existir.
 */
export function CardDocumentos() {
  return (
    <CardBase titulo="Documentos" icon={FileText} variante="placeholder">
      <EmBreve texto="Em breve: contrato, aditivos, holerites e recibos ficarão acessíveis aqui." />
    </CardBase>
  );
}
