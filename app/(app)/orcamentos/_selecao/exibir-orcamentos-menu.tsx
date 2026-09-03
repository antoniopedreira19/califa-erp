"use client";

import * as React from "react";
import { ListFilter } from "lucide-react";
import {
  BotaoMenu,
  CaixaMenu,
  LinhaOrcamento,
  useFecharMenu,
} from "./menu-orcamentos";

export interface OrcamentoExibivel {
  id: string;
  rotulo: string;
  chip: string;
  chipClasses: string;
}

interface Props {
  orcamentos: OrcamentoExibivel[];
  exibidos: string[];
  onChange: (exibidos: string[]) => void;
}

/**
 * "Exibir" da visão agregada — filtro de tela.
 *
 * Os cards e as linhas de Totais seguem a seleção na hora; os três
 * indicadores do topo continuam sendo do projeto inteiro. Nada é salvo:
 * é só o que a tela mostra, e o que ficou escondido continua entrando no
 * "Salvar alterações" como estava.
 */
export function ExibirOrcamentosMenu({ orcamentos, exibidos, onChange }: Props) {
  const [aberto, setAberto] = React.useState(false);
  const ancoraRef = React.useRef<HTMLDivElement>(null);
  const fechar = React.useCallback(() => setAberto(false), []);
  useFecharMenu(aberto, ancoraRef, fechar);

  function alternar(id: string) {
    onChange(
      exibidos.includes(id)
        ? exibidos.filter((x) => x !== id)
        : [...exibidos, id],
    );
  }

  return (
    <div ref={ancoraRef} className="relative flex-none">
      <BotaoMenu
        icone={<ListFilter className="h-3.5 w-3.5" />}
        rotulo="Exibir"
        ativo={aberto}
        onClick={() => setAberto((v) => !v)}
      />

      {aberto && (
        <CaixaMenu titulo="Exibir orçamentos">
          <div className="p-1.5">
            {orcamentos.map((o) => (
              <LinhaOrcamento
                key={o.id}
                marcado={exibidos.includes(o.id)}
                rotulo={o.rotulo}
                chip={o.chip}
                chipClasses={o.chipClasses}
                onClick={() => alternar(o.id)}
              />
            ))}
            <p className="mx-1.5 mb-1 mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
              Só a tela. Cards e Totais seguem na hora — nada é salvo.
            </p>
          </div>
        </CaixaMenu>
      )}
    </div>
  );
}
