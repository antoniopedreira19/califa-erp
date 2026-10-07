"use client";

/**
 * Prazo de envio da PP (decisão 157, 07/10/2026): o financeiro recebe a PP
 * até 15 dias corridos antes da janela do vencimento — no dia útil
 * anterior, se cair em fim de semana ou feriado nacional. A conta mora em
 * `lib/calculos/janelas-pagamento.ts`; aqui ficam as peças de tela que o
 * formulário e o painel de PPs dividem.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dataLimiteDeEnvio,
  isoParaBr,
  janelasComEnvioAberto,
  ppSegueOPrazoDeEnvio,
  vencimentoAceitaEnvio,
} from "@/lib/calculos/janelas-pagamento";
import { atualizarVencimentoDaPP, feriadosNacionaisParaPP } from "./actions-pp";

/** Uma leitura por página: o formulário e o painel dividem a mesma. */
let feriadosEmCache: Promise<string[]> | null = null;

/**
 * Os feriados nacionais do cadastro do Fiscal. Começa vazia e chega logo
 * depois — até lá a conta usa só o fim de semana, que é o que vale para
 * qualquer data-limite até o fim de 2027. O servidor confere de novo.
 */
export function useFeriadosNacionais(): string[] {
  const [feriados, setFeriados] = React.useState<string[]>([]);
  React.useEffect(() => {
    let vivo = true;
    feriadosEmCache ??= feriadosNacionaisParaPP().catch(() => {
      feriadosEmCache = null;
      return [];
    });
    feriadosEmCache.then((lista) => {
      if (vivo) setFeriados(lista);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return feriados;
}

/**
 * A data-limite que esta PP gerada já perdeu, ou null quando ela ainda
 * pode ser enviada. A PP gerada antes de 08/10/2026 não segue a regra.
 */
export function prazoDeEnvioPerdido(
  pp: { prazoPagamento: string; geradaEm: string },
  hojeIso: string,
  feriados: string[],
): { limite: string | null } | null {
  if (!ppSegueOPrazoDeEnvio(pp.geradaEm)) return null;
  if (vencimentoAceitaEnvio(pp.prazoPagamento, hojeIso, feriados)) return null;
  return { limite: dataLimiteDeEnvio(pp.prazoPagamento, feriados) };
}

/** "Envio ao financeiro até 23/10/2026", embaixo do prazo do formulário. */
export function EnvioAte({ vencimento, feriados }: { vencimento: string; feriados: string[] }) {
  const limite = vencimento ? dataLimiteDeEnvio(vencimento, feriados) : null;
  if (!limite) return null;
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">
      Envio ao financeiro até {isoParaBr(limite)}.
    </p>
  );
}

/**
 * O atalho da PP gerada que perdeu o prazo de envio: escolher a janela e
 * apertar um botão (pedido do Tiago, no lugar de "Cancelar e refazer").
 * A PP continua a mesma; mudam as datas e o PDF.
 */
export function AtualizarVencimento({
  ppId,
  codigo,
  vencimento,
  limite,
  hojeIso,
  feriados,
  podeAtualizar,
  onAtualizada,
}: {
  ppId: string;
  codigo: string;
  vencimento: string;
  limite: string | null;
  hojeIso: string;
  feriados: string[];
  /** Quem só lê vê o aviso, sem o atalho. */
  podeAtualizar: boolean;
  onAtualizada: (mensagem: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const janelas = React.useMemo(
    () => janelasComEnvioAberto(hojeIso, feriados, 6),
    [hojeIso, feriados],
  );
  const [escolhida, setEscolhida] = React.useState<string>(janelas[0] ?? "");
  // Os feriados chegam depois do primeiro render: a escolha que saiu da
  // lista volta para a primeira janela aberta.
  React.useEffect(() => {
    if (!janelas.includes(escolhida)) setEscolhida(janelas[0] ?? "");
  }, [janelas, escolhida]);

  function atualizar() {
    if (!escolhida) return;
    setErro(null);
    startTransition(async () => {
      const res = await atualizarVencimentoDaPP(ppId, escolhida);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onAtualizada(`${res.codigo}: vencimento atualizado para ${isoParaBr(res.vencimento)}. Já pode enviar ao financeiro.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-900">
        <CalendarClock className="mt-0.5 h-3 w-3 flex-none" />
        <span>
          O prazo de envio do vencimento {isoParaBr(vencimento)}
          {limite ? ` terminou em ${isoParaBr(limite)}` : " já passou"}.
          {podeAtualizar ? " Escolha a nova data:" : ""}
        </span>
      </p>
      {podeAtualizar && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={escolhida} onValueChange={setEscolhida} disabled={pending}>
            <SelectTrigger
              aria-label={`Novo vencimento da ${codigo}`}
              className="h-8 w-[250px] rounded-md px-2.5 text-[12px]"
            >
              <SelectValue placeholder="Escolha a data" />
            </SelectTrigger>
            <SelectContent>
              {janelas.map((j) => (
                <SelectItem key={j} value={j} className="text-[12px]">
                  {isoParaBr(j)} · envio até {isoParaBr(dataLimiteDeEnvio(j, feriados) ?? j)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={atualizar}
            disabled={pending || !escolhida}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-foreground bg-foreground px-3 text-[11px] font-bold text-white transition-opacity hover:opacity-90",
              (pending || !escolhida) && "opacity-60",
            )}
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            Atualizar vencimento
          </button>
        </div>
      )}
      {erro && <p className="text-[11px] leading-snug text-california-red">{erro}</p>}
    </div>
  );
}
