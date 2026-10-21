"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { exportarFolhaDecimoTerceiroXlsx } from "../actions";

interface Props {
  folhaId: string;
}

export function BotaoExportar({ folhaId }: Props) {
  const [enviando, setEnviando] = React.useState(false);

  async function handleExportar() {
    setEnviando(true);
    const res = await exportarFolhaDecimoTerceiroXlsx(folhaId);
    setEnviando(false);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    const bin = atob(res.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleExportar}
      disabled={enviando}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
    >
      {enviando ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      Exportar planilha
    </button>
  );
}
