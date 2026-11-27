"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlayCircle, AlertCircle } from "lucide-react";
import { aplicarBeneficios } from "@/lib/actions/beneficios/fechamento";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export interface BotaoAplicarBeneficiosPJProps {
  ano: number;
  mes: number;
  /** Soma de valor_colaborador do preview. Null quando preview falhou ou ausente. */
  previewDescontoBeneficios: number | null;
  /** Qtd de vínculos ativos no preview. Null idem; 0 significa "sem vínculos". */
  previewQtdVinculos: number | null;
  disabled?: boolean;
}

export function BotaoAplicarBeneficiosPJ(
  props: BotaoAplicarBeneficiosPJProps,
): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  const competenciaLabel = `${NOMES_MES[props.mes - 1]}/${props.ano}`;

  function handleClick() {
    const temVinculos =
      props.previewQtdVinculos !== null && props.previewQtdVinculos > 0;
    const temDesconto =
      props.previewDescontoBeneficios !== null &&
      props.previewDescontoBeneficios > 0;

    const mensagemConfirmacao =
      temVinculos && temDesconto
        ? `Aplicar benefícios de ${competenciaLabel}?\n\n` +
          `Isso vai descontar ${brl.format(
            props.previewDescontoBeneficios!,
          )} do salário de ${props.previewQtdVinculos} colaboradores PJ. ` +
          `A tabela abaixo passa a mostrar os valores pós-desconto.\n\n` +
          `Se precisar corrigir, você pode Desaplicar enquanto a folha ainda não foi enviada.`
        : `Aplicar benefícios de ${competenciaLabel}?\n\n` +
          `Nenhum vínculo ativo nesta competência — o snapshot será criado vazio e você poderá enviar normalmente.`;

    if (!confirm(mensagemConfirmacao)) return;

    setErro(null);
    startTransition(async () => {
      const r = await aplicarBeneficios({ ano: props.ano, mes: props.mes });
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={props.disabled || pending}
        className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PlayCircle className="h-4 w-4" />
        )}
        {pending ? "Aplicando..." : "Aplicar benefícios"}
      </button>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 max-w-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
    </div>
  );
}
