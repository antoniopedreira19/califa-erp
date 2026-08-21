"use client";

/** A chave que troca a linguagem da planilha inteira.
 *
 *  Do handoff "Job - A com Repasse - BV e PP", tela 3b. O BV não é um
 *  detalhe de uma célula — é um jeito de ler a planilha. Em vez de
 *  decorar cada Total com um asterisco, a página ganha UMA chave:
 *
 *  - **Bruto** (padrão) — a tela de sempre, com o custo cheio.
 *  - **Líquido (− BV)** — o Total das linhas com BV mostra o custo SEM a
 *    comissão que volta para a California, com a dedução em sub-linha, e
 *    subtotal e Totais se recalculam junto.
 *
 *  Uma por PÁGINA, não uma por grupo: dois grupos em modos diferentes na
 *  mesma tela produziriam um Totais que não bate com nenhum deles.
 *
 *  O ORÇADO não muda nos dois modos — ele não recebe BV. E o painel
 *  Resultado também não: lá o BV virou linha própria ("+ BVs"), então o
 *  número é o mesmo nas duas vistas.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { VisaoBv } from "@/lib/calculos/bv-planilha";

export function ChaveBrutoLiquido({
  visao,
  onChange,
  className,
}: {
  visao: VisaoBv;
  onChange: (v: VisaoBv) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Como ler os valores da planilha"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-[#f1f0ec] p-[3px]",
        className,
      )}
    >
      <Botao ativo={visao === "bruto"} onClick={() => onChange("bruto")}>
        Bruto
      </Botao>
      <Botao ativo={visao === "liquido"} onClick={() => onChange("liquido")}>
        Líquido{" "}
        <span className="font-mono text-[10.5px] opacity-70">(− BV)</span>
      </Botao>
    </div>
  );
}

/** Mesma pastilha do seletor Planejada/Realizada do painel Resultado —
 *  duas chaves com formas diferentes na mesma tela seriam duas gramáticas
 *  para a mesma ideia. */
function Botao({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-full px-3.5 py-[5px] text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/30",
        ativo
          ? "bg-white font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          : "bg-transparent font-medium text-[#8a8a8a] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Sub-linha "BV −1.050,00" que acompanha o Total na vista Líquido.
 *
 *  Ela é o que torna a dedução auditável sem abrir o formulário: o Total
 *  já vem descontado, e esta linha diz de quanto foi o desconto. Vale
 *  para a célula do item E para o subtotal do grupo — no subtotal, com a
 *  soma dos BVs de todos os itens dele.
 *
 *  `pendente` cobre o caso do REALIZADO com BV ainda `a_negociar`: aí não
 *  há dedução nenhuma, e mostrar "BV −0,00" diria "não tem BV", que é
 *  outra coisa. O rótulo explica por que a linha não baixou.
 */
export function SubLinhaBv({
  deducao,
  pendente,
  formatar,
  cor,
  corRotulo,
}: {
  deducao: number;
  pendente?: boolean;
  formatar: (v: number) => string;
  /** Cor do bloco a que a sub-linha pertence — verde no PLANEJADO,
   *  laranja no REALIZADO. Vem de `blocos.ts`, nunca de hex aqui. */
  cor: string;
  corRotulo: string;
}) {
  if (pendente) {
    return (
      <span className="whitespace-nowrap text-[9.5px] font-semibold leading-[1.1] text-muted-foreground">
        BV não emitido
      </span>
    );
  }
  if (deducao <= 0) return null;

  return (
    <span className="inline-flex items-baseline gap-1 leading-[1.1]">
      <span
        className={cn(
          "text-[9.5px] font-bold tracking-[0.08em]",
          corRotulo,
        )}
      >
        BV
      </span>
      <span className={cn("font-mono text-[10.5px] font-semibold", cor)}>
        −{formatar(deducao)}
      </span>
    </span>
  );
}
