"use client";

/** A coluna SAVE das planilhas — o crédito que passa de um job para outro.
 *
 *  Fica à ESQUERDA de tudo, no lado oposto ao da calha de BV e PP, que é
 *  absoluta e vive fora do frame da tabela. Foi a escolha do Tiago no
 *  design `Orcamento - Versao com Save.dc.html` (projeto Claude Design
 *  `69342d83`, 26/08/2026): a marca de save é estado da linha, não ação
 *  sobre um documento, e ler estado da esquerda para a direita é o que a
 *  planilha já faz com Item e Tipo.
 *
 *  Quatro estados, e a diferença entre eles é DIREÇÃO mais TEXTURA, nunca
 *  matiz novo — a paleta de bloco é fechada (docs/09-identidade-visual-ui):
 *
 *    ┌ vazio      + tracejado vermelho   nada definido nesta linha
 *    ├ gera       ↗ grafite cheio        vira crédito, ainda sem destino
 *    ├ gera+dest  ↗ JB-0044              crédito já consumido por aquele job
 *    └ consome    ↙ JB-0031 +1           esta linha é paga por saldo de fora
 *
 *  A linha que GERA save aparece hachurada: o serviço foi vendido e não
 *  acontece aqui. A que CONSOME ganha fundo grafite claro: ela acontece
 *  aqui, o que veio de fora é o dinheiro.
 *
 *  Compartilhado entre a planilha da versão e a Planilha Interna do job —
 *  as duas mostram o mesmo estado, e é só a permissão de editar que muda.
 */

import * as React from "react";
import { ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { SAVE } from "./blocos";

/** Uma ponta do crédito: de qual job veio, ou para qual job foi. */
export interface PontaDeSave {
  jobId: string;
  codigo: string;
  valor: number;
}

/** O que a coluna precisa saber sobre UMA linha. */
export interface EstadoSaveDaLinha {
  /** A linha gera crédito: é faturada aqui e o serviço não acontece. */
  emSave: boolean;
  /** Quanto desta linha é pago por saldo de outros jobs. */
  saveConsumido: number;
  /** De onde vem o dinheiro que paga esta linha. Vazio quando ela não
   *  consome. Pode ter mais de um: uma linha bebe de vários jobs. */
  origens: PontaDeSave[];
  /** Quem já consumiu o crédito que esta linha gerou. Só faz sentido
   *  quando `emSave`. */
  destinos: PontaDeSave[];
}

export const SAVE_VAZIO: EstadoSaveDaLinha = {
  emSave: false,
  saveConsumido: 0,
  origens: [],
  destinos: [],
};

/** Classes que o `<tr>` ganha por causa do save. Devolve string vazia na
 *  linha comum, para não pesar o `cn` de todas as outras. */
export function classesDaLinhaComSave(estado: EstadoSaveDaLinha): string {
  if (estado.emSave) return SAVE.hachura;
  if (estado.origens.length > 0) return SAVE.linhaConsome;
  return "";
}

/** `true` quando a linha tem alguma relação com save — o que decide se ela
 *  entra na contagem "N linhas com save" do cabeçalho e do grupo. */
export function linhaTocaSave(estado: EstadoSaveDaLinha): boolean {
  return estado.emSave || estado.origens.length > 0;
}

/** Célula da coluna na FAIXA dos blocos — vazia de propósito.
 *
 *  A coluna Save não é um bloco: ela não ganha rótulo na faixa colorida,
 *  fica branca como a célula do agrupamento ao lado e só segura o lugar
 *  para a grade não escorregar uma casa. É o design que manda assim
 *  (`Orcamento - Versao com Save.dc.html`), e havia sido implementado ao
 *  contrário — "SAVE" na faixa e o sub-cabeçalho vazio (31/08/2026). */
export function CabecalhoSaveFaixa() {
  return <th className={SAVE.faixaVazia} aria-hidden />;
}

/** Sub-cabeçalho da coluna: é AQUI que "Save" aparece escrito, na mesma
 *  linha de "Grupo · Item" e "Tipo". */
export function CabecalhoSaveColuna() {
  return (
    <th className={SAVE.cabecalho} title="Save — crédito entre jobs">
      Save
    </th>
  );
}

function resumoDasPontas(pontas: PontaDeSave[], moeda: string): string {
  return pontas
    .map((p) => `${p.codigo} ${formatCurrency(p.valor, moeda)}`)
    .join(" · ");
}

interface CelulaProps {
  estado: EstadoSaveDaLinha;
  moeda: string;
  /** Total orçado da linha — entra no texto do estado "gera save". */
  totalOrcado: number;
  /** Sem isso a célula continua mostrando o estado, mas não abre nada:
   *  é assim que o financeiro e a versão aprovada leem sem editar. */
  onAbrir?: () => void;
  disabled?: boolean;
}

/** A célula da coluna Save numa linha de item. */
export function CelulaSave({
  estado,
  moeda,
  totalOrcado,
  onAbrir,
  disabled,
}: CelulaProps) {
  const consome = !estado.emSave && estado.origens.length > 0;

  const { conteudo, titulo } = React.useMemo(() => {
    if (estado.emSave && estado.destinos.length > 0) {
      const [maior, ...resto] = [...estado.destinos].sort(
        (a, b) => b.valor - a.valor,
      );
      return {
        // "o saldo deste job", e não "esta linha": o crédito é do job, e
        // não existe vínculo entre uma linha em save e quem gastou o
        // dinheiro (decisão 028, nota de 26/08/2026).
        titulo: `Save gerado · ${formatCurrency(totalOrcado, moeda)}. O saldo deste job já foi consumido por ${resumoDasPontas(estado.destinos, moeda)}`,
        conteudo: (
          <span className={SAVE.botaoCodigo}>
            <ArrowUpRight className={cn("h-[9px] w-[9px] flex-none", SAVE.icone)} />
            {maior.codigo}
            {resto.length > 0 && (
              <span className={SAVE.pastilhaMais}>+{resto.length}</span>
            )}
          </span>
        ),
      };
    }

    if (estado.emSave) {
      return {
        titulo: `Save gerado · ${formatCurrency(totalOrcado, moeda)} de crédito, ainda sem destino`,
        conteudo: (
          <span className={SAVE.botaoGera}>
            <ArrowUpRight className="h-[11px] w-[11px]" />
          </span>
        ),
      };
    }

    if (consome) {
      const [maior, ...resto] = [...estado.origens].sort(
        (a, b) => b.valor - a.valor,
      );
      return {
        titulo:
          estado.origens.length > 1
            ? `Consome saldo de ${estado.origens.length} jobs · ${resumoDasPontas(estado.origens, moeda)}`
            : `Pago pelo saldo de save do ${resumoDasPontas(estado.origens, moeda)}`,
        conteudo: (
          <span className={SAVE.botaoCodigo}>
            <ArrowDownLeft
              className={cn("h-[9px] w-[9px] flex-none", SAVE.icone)}
            />
            {maior.codigo}
            {resto.length > 0 && (
              <span className={SAVE.pastilhaMais}>+{resto.length}</span>
            )}
          </span>
        ),
      };
    }

    return {
      titulo: "Definir save desta linha",
      conteudo: (
        <span className={SAVE.botaoVazio}>
          <Plus className="h-[11px] w-[11px]" />
        </span>
      ),
    };
  }, [estado, moeda, totalOrcado, consome]);

  return (
    <td
      className={cn(
        SAVE.celula,
        estado.emSave && SAVE.hachura,
        consome && SAVE.bordaConsome,
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          {onAbrir ? (
            <button
              type="button"
              onClick={onAbrir}
              disabled={disabled}
              aria-label={titulo}
              className="disabled:opacity-50"
            >
              {conteudo}
            </button>
          ) : (
            <span aria-label={titulo}>{conteudo}</span>
          )}
        </TooltipTrigger>
        <TooltipContent>{titulo}</TooltipContent>
      </Tooltip>
    </td>
  );
}
