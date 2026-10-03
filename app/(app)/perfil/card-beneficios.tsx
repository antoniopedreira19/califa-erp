import { Heart } from "lucide-react";
import { CardBase } from "./card-base";

/**
 * Placeholder — subsistema de benefícios ainda não existe. Quando
 * entrar, listar aqui: VR, VA, convênio médico, TotalPass, etc.,
 * mostrando apenas nome do benefício + status (ativo/inativo).
 * Formato lista compacta pra caber na coluna lateral.
 */
export function CardBeneficios() {
  return (
    <CardBase titulo="Benefícios" icon={Heart} variante="placeholder">
      <div className="space-y-2.5">
        <p className="text-xs text-muted-foreground">
          Em breve você verá aqui os benefícios ativos no seu vínculo.
        </p>
        <ul className="space-y-1.5 text-sm">
          <ItemPlaceholder nome="Vale-refeição" />
          <ItemPlaceholder nome="Vale-alimentação" />
          <ItemPlaceholder nome="Convênio médico" />
          <ItemPlaceholder nome="TotalPass" />
        </ul>
      </div>
    </CardBase>
  );
}

function ItemPlaceholder({ nome }: { nome: string }) {
  return (
    <li className="flex items-center justify-between gap-2 text-muted-foreground">
      <span>{nome}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
        —
      </span>
    </li>
  );
}
