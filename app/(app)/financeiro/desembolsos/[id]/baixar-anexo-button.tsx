"use client";

import * as React from "react";
import { signedUrlAnexoDesembolso } from "../actions";

interface Props {
  anexoId: string;
}

export function BaixarAnexoDesembolsoButton({ anexoId }: Props) {
  const [pending, startTransition] = React.useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await signedUrlAnexoDesembolso(anexoId);
      if (!res.ok) {
        alert(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded border border-border bg-white px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
    >
      {pending ? "Abrindo..." : "Baixar"}
    </button>
  );
}
