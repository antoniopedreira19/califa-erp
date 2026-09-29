"use client";

import * as React from "react";
import { FileText, ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Um arquivo da PO anexado no envio para faturamento (decisão 123). */
export interface AnexoDaPo {
  id: string;
  nome_arquivo: string;
  path: string;
  mime_type: string;
  tamanho_bytes: number;
}

const BUCKET = "envios-faturamento";

function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Os anexos da PO como links que abrem numa aba nova.
 *
 * Os links assinados são gerados de uma vez, quando a lista aparece — e
 * não no clique: abrir aba depois de um `await` é bloqueado pelo Safari
 * como pop-up. A leitura passa pela RLS do bucket (membro do tenant).
 */
export function AnexosDaPo({
  anexos,
  className,
}: {
  anexos: AnexoDaPo[];
  className?: string;
}) {
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  const [falhou, setFalhou] = React.useState(false);
  const chave = anexos.map((a) => a.path).join("|");

  React.useEffect(() => {
    if (anexos.length === 0) return;
    let vivo = true;
    const supabase = createClient();
    supabase.storage
      .from(BUCKET)
      .createSignedUrls(
        anexos.map((a) => a.path),
        60 * 60,
      )
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error || !data) {
          setFalhou(true);
          return;
        }
        const mapa: Record<string, string> = {};
        for (const item of data) {
          if (item.path && item.signedUrl) mapa[item.path] = item.signedUrl;
        }
        setUrls(mapa);
      });
    return () => {
      vivo = false;
    };
    // `chave` resume a lista: só refaz quando os arquivos mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  if (anexos.length === 0) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      {anexos.map((a) => {
        const Icone = a.mime_type === "application/pdf" ? FileText : ImageIcon;
        const href = urls[a.path];
        return (
          <a
            key={a.id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!href}
            onClick={(e) => {
              if (!href) e.preventDefault();
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border border-border bg-white px-3 py-2 text-[12.5px] transition-colors",
              href ? "hover:border-california-red/40 hover:text-california-red" : "cursor-wait opacity-70",
            )}
          >
            <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={a.nome_arquivo}>
              {a.nome_arquivo}
            </span>
            <span className="flex-none text-[11px] text-muted-foreground">
              {tamanhoLegivel(a.tamanho_bytes)}
            </span>
          </a>
        );
      })}
      {falhou && (
        <p className="text-[11px] text-california-red">
          Não foi possível abrir os anexos agora. Recarregue a página e tente de novo.
        </p>
      )}
    </div>
  );
}
