"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2 } from "lucide-react";
import {
  fecharPrimeiraParcelaDecimoTerceiro,
  fecharSegundaParcelaDecimoTerceiro,
} from "../actions";

export function BotaoFecharParcela({
  folhaId,
  numero,
}: {
  folhaId: string;
  numero: 1 | 2;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);

  async function handleClick() {
    const label = numero === 1 ? "1ª parcela" : "2ª parcela";
    if (
      !confirm(
        `Fechar ${label} e enviar ao financeiro? Após isso, as linhas desta folha vão ficar em modo somente leitura e aparecerão em /financeiro/contas-a-pagar na aba Folhas de Pagamento.`,
      )
    ) {
      return;
    }
    setEnviando(true);
    const res =
      numero === 1
        ? await fecharPrimeiraParcelaDecimoTerceiro(folhaId)
        : await fecharSegundaParcelaDecimoTerceiro(folhaId);
    setEnviando(false);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    router.refresh();
  }

  const label = numero === 1 ? "1ª parcela" : "2ª parcela";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={enviando}
      className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 transition-colors disabled:opacity-60 disabled:cursor-wait"
    >
      {enviando ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Enviando ao financeiro…
        </>
      ) : (
        <>
          <Send className="h-4 w-4" />
          Fechar {label}
        </>
      )}
    </button>
  );
}
