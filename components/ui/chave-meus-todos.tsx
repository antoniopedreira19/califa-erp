/**
 * Chave "Meus / Todos" das listas de Projetos e de Jobs.
 *
 * Segmentado, e não checkbox, de propósito (design "Listas - Filtro Meus e
 * Colunas Produto Regional", 01/09/2026): o par explícito deixa sempre
 * visível em qual recorte a lista está, sem obrigar a caçar um checkbox
 * marcado. Mesma posição nas duas telas — primeiro item da barra.
 *
 * **Meus é o estado inicial**: quem abre a lista quer o próprio trabalho, e
 * "Todos" fica a um clique.
 *
 * Quem é "meu" muda por tela e mora em quem chama:
 * - Jobs — `jobs.responsavel_id` é o usuário.
 * - Projetos — o usuário é responsável OU produtor de algum job do projeto
 *   (decisão do Tiago, 01/09/2026). Desde a matriz de permissões (03/09/2026),
 *   entrar como Equipe do projeto também conta como "meu".
 *
 * `visivel=false` esconde a chave inteira — usado pro Freelancer, que sempre
 * fica em "Meus" forçado (ele so ve os projetos onde participa e nao faz
 * sentido oferecer "Todos"). Fonte-verdade da regra: `lib/permissoes.ts`,
 * recurso `listas.chave_meus_todos`.
 */

"use client";

import * as React from "react";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChaveMeusTodos({
  meus,
  onChange,
  className,
  visivel = true,
}: {
  meus: boolean;
  onChange: (meus: boolean) => void;
  className?: string;
  /** Se false, componente nao renderiza (Freelancer). */
  visivel?: boolean;
}) {
  if (!visivel) return null;
  return (
    <div
      role="group"
      aria-label="Recorte da lista"
      className={cn(
        "inline-flex flex-none items-center gap-0.5 rounded-full bg-[#f1f0ec] p-[3px]",
        className,
      )}
    >
      <Botao ativo={meus} onClick={() => onChange(true)}>
        <User className="h-3 w-3" aria-hidden="true" />
        Meus
      </Botao>
      <Botao ativo={!meus} onClick={() => onChange(false)}>
        Todos
      </Botao>
    </div>
  );
}

/** Mesma pastilha da chave Bruto/Líquido da planilha — duas chaves com
 *  formas diferentes no mesmo sistema seriam duas gramáticas para a mesma
 *  ideia. */
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
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-[5px] text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/30",
        ativo
          ? "bg-white font-semibold text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          : "bg-transparent font-medium text-[#8a8a8a] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
