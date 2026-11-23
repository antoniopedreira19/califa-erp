"use client";

/**
 * A leitura ampliada das NFs tomadas pela IA (decisão 271), disparada pelo
 * financeiro: as notas da lista que ainda não foram lidas, de
 * `NOTAS_POR_LEITURA` em `NOTAS_POR_LEITURA`, com o progresso e o que não
 * deu certo. Cada leitura grava na nota a descrição, o CNAE, o município, a
 * competência, o código de verificação e as retenções destacadas.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTAS_POR_LEITURA } from "./dados";
import { lerNotasTomadas, type ResultadoDaLeitura } from "./actions";

type Estado =
  | { fase: "parado" }
  | { fase: "confirmando" }
  | { fase: "lendo"; feitas: number; total: number }
  | { fase: "pronto"; resultado: ResultadoDaLeitura }
  | { fase: "erro"; mensagem: string };

/** Lê as notas em lotes; devolve o resultado somado. */
export async function lerEmLotes(ids: string[], aoAvancar: (feitas: number) => void): Promise<ResultadoDaLeitura | string> {
  const soma: ResultadoDaLeitura = { lidas: 0, recusadas: [], falhas: [] };
  for (let i = 0; i < ids.length; i += NOTAS_POR_LEITURA) {
    const r = await lerNotasTomadas(ids.slice(i, i + NOTAS_POR_LEITURA));
    if (!r.ok) return r.message;
    soma.lidas += r.resultado.lidas;
    soma.recusadas.push(...r.resultado.recusadas);
    soma.falhas.push(...r.resultado.falhas);
    aoAvancar(Math.min(ids.length, i + NOTAS_POR_LEITURA));
  }
  return soma;
}

/** O botão "Ler N notas pela IA", acima da tabela das Tomadas. */
export function BotaoLerNotas({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [estado, setEstado] = React.useState<Estado>({ fase: "parado" });

  async function ler() {
    setEstado({ fase: "lendo", feitas: 0, total: ids.length });
    const r = await lerEmLotes(ids, (feitas) => setEstado({ fase: "lendo", feitas, total: ids.length }));
    if (typeof r === "string") setEstado({ fase: "erro", mensagem: r });
    else setEstado({ fase: "pronto", resultado: r });
    router.refresh();
  }

  if (estado.fase === "parado" && ids.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5 text-[12.5px]">
      <Sparkles className="h-4 w-4 shrink-0 text-amber-600" />
      {estado.fase === "parado" && (
        <>
          <span className="flex-1 text-muted-foreground">
            {ids.length === 1 ? "1 nota da lista ainda não foi lida" : `${ids.length} notas da lista ainda não foram lidas`}: sem a leitura, o CNAE é o do
            cadastro e o retido fica em branco.
          </span>
          <button
            type="button"
            onClick={() => setEstado({ fase: "confirmando" })}
            className="rounded-lg border border-border bg-white px-3 py-1.5 font-semibold transition-colors hover:border-california-red hover:text-california-red"
          >
            {ids.length === 1 ? "Ler a nota pela IA" : `Ler as ${ids.length} notas pela IA`}
          </button>
        </>
      )}
      {estado.fase === "confirmando" && (
        <>
          <span className="flex-1">
            A IA lê o arquivo de cada nota (alguns segundos por nota{ids.length > 20 ? `, uns ${Math.ceil((ids.length * 4) / 60)} minutos ao todo` : ""}).
            Deixe esta tela aberta até terminar.
          </span>
          <button type="button" onClick={() => setEstado({ fase: "parado" })} className="rounded-lg px-3 py-1.5 font-semibold text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button type="button" onClick={ler} className="rounded-lg bg-california-red px-3 py-1.5 font-semibold text-white hover:bg-california-red/90">
            Ler
          </button>
        </>
      )}
      {estado.fase === "lendo" && (
        <span className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-california-red" />
          Lendo as notas pela IA… {estado.feitas} de {estado.total}
        </span>
      )}
      {estado.fase === "erro" && (
        <span className="flex items-center gap-2 text-california-red">
          <AlertTriangle className="h-3.5 w-3.5" />
          {estado.mensagem}
        </span>
      )}
      {estado.fase === "pronto" && <ResumoDaLeitura resultado={estado.resultado} onFechar={() => setEstado({ fase: "parado" })} />}
    </div>
  );
}

function ResumoDaLeitura({ resultado, onFechar }: { resultado: ResultadoDaLeitura; onFechar: () => void }) {
  const problemas = [...resultado.recusadas, ...resultado.falhas];
  return (
    <div className="flex flex-1 flex-col gap-1">
      <span className={cn("flex items-center gap-2", resultado.lidas > 0 ? "text-emerald-700" : "text-amber-700")}>
        {resultado.lidas > 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        {resultado.lidas === 0 ? "Nenhuma nota foi lida." : resultado.lidas === 1 ? "1 nota lida." : `${resultado.lidas} notas lidas.`}
        {problemas.length > 0 && <span className="text-amber-700">{problemas.length === 1 ? " 1 não foi lida:" : ` ${problemas.length} não foram lidas:`}</span>}
        <button type="button" onClick={onFechar} className="ml-auto text-[11.5px] font-semibold text-muted-foreground hover:text-california-red">
          Fechar
        </button>
      </span>
      {problemas.slice(0, 8).map((p) => (
        <span key={p.numero + p.motivo} className="text-[12px] text-amber-800">
          NF {p.numero}: {p.motivo}
        </span>
      ))}
      {problemas.length > 8 && <span className="text-[12px] text-muted-foreground">e mais {problemas.length - 8}.</span>}
    </div>
  );
}
