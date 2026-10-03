import { Heart } from "lucide-react";
import { CardBase, EmBreve } from "./card-base";

/**
 * Placeholder — subsistema de benefícios ainda não existe. Quando
 * entrar, listar aqui: VR, VA, convênio médico, TotalPass, etc.,
 * com saldo mensal/limites quando aplicável.
 */
export function CardBeneficios() {
  return (
    <CardBase titulo="Benefícios" icon={Heart} variante="placeholder">
      <EmBreve texto="Em breve você verá aqui seus benefícios ativos: vale-refeição, vale-alimentação, convênio, TotalPass e extras." />
    </CardBase>
  );
}
