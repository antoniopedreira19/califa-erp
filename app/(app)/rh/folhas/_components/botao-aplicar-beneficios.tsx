"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlayCircle } from "lucide-react";
import {
  aplicarBeneficios,
  previsualizarAplicacao,
} from "@/lib/actions/beneficios/fechamento";

const brl = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function formatarData(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function BotaoAplicarBeneficios(props: { ano: number; mes: number }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  async function handleClick() {
    setErro(null);
    const prev = await previsualizarAplicacao({ ano: props.ano, mes: props.mes });
    if (!prev.ok) {
      setErro(prev.message);
      return;
    }
    const p = prev.preview;
    if (p.qtdVinculos === 0) {
      setErro("Nenhum vínculo ativo nesta competência.");
      return;
    }
    const linhasOp = p.porOperadora
      .map(
        (op) =>
          `• ${op.operadora}: ${brl(op.valorIntegral)} (venceria ${formatarData(op.dataVencimento)})`,
      )
      .join("\n");
    const texto = [
      `Aplicar descontos de benefícios à competência ${String(props.mes).padStart(2, "0")}/${props.ano}?`,
      ``,
      `Isso vai:`,
      `• Reduzir ${brl(p.totalColaborador)} das linhas PJ (${p.qtdVinculos} vínculos).`,
      `• Fechar a competência de benefícios (snapshot congelado).`,
      ``,
      `As avulsas abaixo serão criadas quando a folha for enviada ao financeiro:`,
      linhasOp,
      ``,
      `Enquanto não enviar, dá pra desaplicar e refazer sem efeito no financeiro.`,
    ].join("\n");

    if (!confirm(texto)) return;
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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <PlayCircle className="h-3.5 w-3.5" />
        )}
        {pending ? "Aplicando..." : "Aplicar descontos"}
      </button>
      {erro && (
        <p className="text-xs text-red-700 max-w-[280px] text-right">{erro}</p>
      )}
    </div>
  );
}
