"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { recalcularFolhaDecimoTerceiro } from "../actions";

export function BotaoRecalcular({ folhaId }: { folhaId: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);

  async function handleClick() {
    setEnviando(true);
    const res = await recalcularFolhaDecimoTerceiro(folhaId);
    setEnviando(false);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={enviando}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-wait"
    >
      {enviando ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Recalculando…
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4" />
          Recalcular folha
        </>
      )}
    </button>
  );
}
