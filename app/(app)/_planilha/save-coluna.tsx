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
import type {
  SaveAprovacaoMomento,
  SaveAprovacaoSituacao,
  SaveAprovacaoTipo,
} from "@/lib/types";

/** Uma ponta do crédito: de qual job veio, ou para qual job foi. */
export interface PontaDeSave {
  jobId: string;
  codigo: string;
  valor: number;
}

/** Um pedido de aprovação de save, como o pop-up o mostra (decisão 099).
 *  Os nomes já vêm resolvidos: `saves_aprovacoes` tem várias FKs para
 *  `profiles`, e embutir sem dica dá embed ambíguo. */
export interface PedidoDeSave {
  id: string;
  tipo: SaveAprovacaoTipo;
  situacao: SaveAprovacaoSituacao;
  momento: SaveAprovacaoMomento;
  /** Gera: o crédito pedido. Consome: a soma das origens. */
  valor: number;
  origens: PontaDeSave[];
  /** Consumo de logo antes do pedido: é a ele que a recusa volta. */
  origensAntes: PontaDeSave[];
  /** Edição de consumo aprovado: o pedido aprovado que esta substitui. */
  substituiId: string | null;
  enviadoEm: string;
  enviadoPor: string | null;
  decididoEm: string | null;
  decididoPor: string | null;
  justificativa: string | null;
  retiradoEm: string | null;
  retiradoPor: string | null;
  valorJobAntes: number | null;
  valorJobDepois: number | null;
  faturamentoPrevistoAntes: number | null;
  faturamentoPrevistoDepois: number | null;
}

/** Os pedidos de UMA linha do job. No máximo um de cada situação ativa
 *  (o banco garante); o histórico tem todos, do mais antigo ao mais novo. */
export interface PedidosDaLinha {
  aguardando: PedidoDeSave | null;
  aprovado: PedidoDeSave | null;
  /** Recusado e ainda não arquivado pelo GP ("Retirar"). */
  recusado: PedidoDeSave | null;
  historico: PedidoDeSave[];
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
  /** Pedidos de aprovação da linha (decisão 099). `null` no orçamento, onde
   *  o save não passa por aprovação; no job, sempre um objeto (vazio quando
   *  a linha nunca foi enviada). */
  pedidos: PedidosDaLinha | null;
  /** Quem marcou o save desta linha, e quando. `null` sem save, ou no save
   *  marcado antes de 22/09/2026. */
  marcadoPor: string | null;
  marcadoEm: string | null;
}

export const SAVE_VAZIO: EstadoSaveDaLinha = {
  emSave: false,
  saveConsumido: 0,
  origens: [],
  destinos: [],
  pedidos: null,
  marcadoPor: null,
  marcadoEm: null,
};

/** Situação de um dos lados do save numa linha do JOB (decisão 099).
 *  "nao_enviado" é a linha com save ou consumo e sem pedido — o job aberto
 *  antes do fluxo, ou a pré-abertura (o pedido nasce na abertura). */
export type SituacaoDoSave =
  | "sem_save"
  | "nao_enviado"
  | "aguardando"
  | "aprovado"
  | "recusado";

export function situacaoDoSave(
  estado: EstadoSaveDaLinha,
  tipo: SaveAprovacaoTipo,
): SituacaoDoSave {
  const p = estado.pedidos;
  if (tipo === "gera") {
    if (p?.recusado?.tipo === "gera") return "recusado";
    if (!estado.emSave) return "sem_save";
    if (p?.aguardando?.tipo === "gera") return "aguardando";
    if (p?.aprovado?.tipo === "gera") return "aprovado";
    return "nao_enviado";
  }
  if (p?.aguardando?.tipo === "consome") return "aguardando";
  if (p?.recusado?.tipo === "consome") return "recusado";
  if (estado.origens.length === 0) return "sem_save";
  if (p?.aprovado?.tipo === "consome") return "aprovado";
  return "nao_enviado";
}

/** Classes que o `<tr>` ganha por causa do save. Devolve string vazia na
 *  linha comum, para não pesar o `cn` de todas as outras.
 *
 *  A linha RECUSADA (decisão 099 §9) cai aqui na linha comum de propósito:
 *  os números já voltaram e o serviço volta a acontecer nela, então a
 *  hachura sai. Quem lembra do save é só o ícone da coluna. */
export function classesDaLinhaComSave(estado: EstadoSaveDaLinha): string {
  if (estado.emSave) return SAVE.hachura;
  if (estado.origens.length > 0) return SAVE.linhaConsome;
  return "";
}

/** `true` quando a linha tem alguma relação com save — o que decide se ela
 *  entra na contagem "N linhas com save" do cabeçalho e do grupo, e se o
 *  pop-up abre nas telas de leitura (decisão 099 §18).
 *
 *  A recusa ainda não arquivada conta: a linha segue com o ícone de save e
 *  travada até o GP retirá-la. */
export function linhaTocaSave(estado: EstadoSaveDaLinha): boolean {
  return (
    estado.emSave ||
    estado.origens.length > 0 ||
    estado.pedidos?.recusado != null ||
    estado.pedidos?.aguardando != null
  );
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

/** A célula da coluna Save numa linha de item.
 *
 *  No JOB (decisão 099, 22/09/2026) a célula diz também em que pé está o
 *  pedido de aprovação — pelo tooltip, sem cor nova: a paleta da coluna é
 *  fechada. A linha recusada mantém o ícone do lado que foi recusado, sem a
 *  hachura e sem a borda do consumo, até o GP retirar a recusa. No
 *  orçamento (`pedidos` nulo) nada muda. */
export function CelulaSave({
  estado,
  moeda,
  totalOrcado,
  onAbrir,
  disabled,
}: CelulaProps) {
  const consome = !estado.emSave && estado.origens.length > 0;

  const { conteudo, titulo } = React.useMemo(() => {
    const noJob = estado.pedidos !== null;
    const sitGera = noJob ? situacaoDoSave(estado, "gera") : null;
    const sitConsumo = noJob ? situacaoDoSave(estado, "consome") : null;
    const valorDaLinha = formatCurrency(totalOrcado, moeda);

    // O começo do tooltip de quem gera, pela situação do pedido. O save
    // aprovado (e o do orçamento) fica com o texto de sempre.
    const inicioGera =
      sitGera === "aguardando"
        ? `Save aguardando aprovação do financeiro · ${valorDaLinha}`
        : sitGera === "nao_enviado"
          ? `Save marcado, ainda não enviado para aprovação do financeiro · ${valorDaLinha}`
          : null;

    if (estado.emSave && estado.destinos.length > 0) {
      const [maior, ...resto] = [...estado.destinos].sort(
        (a, b) => b.valor - a.valor,
      );
      return {
        // "o saldo deste job", e não "esta linha": o crédito é do job, e
        // não existe vínculo entre uma linha em save e quem gastou o
        // dinheiro (decisão 028, nota de 26/08/2026).
        titulo: `${inicioGera ?? `Save gerado · ${valorDaLinha}`}. O saldo deste job já foi consumido por ${resumoDasPontas(estado.destinos, moeda)}`,
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
        titulo:
          inicioGera ??
          `Save gerado · ${valorDaLinha} de crédito, ainda sem destino`,
        conteudo: (
          <span className={SAVE.botaoGera}>
            <ArrowUpRight className="h-[11px] w-[11px]" />
          </span>
        ),
      };
    }

    // Save recusado: os números já voltaram, mas a linha fica marcada até
    // o GP retirar a recusa (decisão 099 §9).
    if (sitGera === "recusado") {
      return {
        titulo: `Save recusado pelo financeiro · ${valorDaLinha}. A linha voltou ao valor do job; abra para ver a justificativa`,
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
      const pontas = resumoDasPontas(estado.origens, moeda);
      return {
        titulo:
          sitConsumo === "aguardando"
            ? `Consumo aguardando aprovação do financeiro · ${pontas}`
            : sitConsumo === "nao_enviado"
              ? `Consumo definido, ainda não enviado para aprovação do financeiro · ${pontas}`
              : sitConsumo === "recusado"
                ? `Edição do consumo recusada pelo financeiro · segue o consumo aprovado: ${pontas}`
                : estado.origens.length > 1
                  ? `Consome saldo de ${estado.origens.length} jobs · ${pontas}`
                  : `Pago pelo saldo de save do ${pontas}`,
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

    // Consumo recusado sem consumo aprovado por baixo: a linha voltou ao
    // faturamento, e o ícone mostra de onde o consumo recusado viria.
    const recusado = estado.pedidos?.recusado;
    if (sitConsumo === "recusado" && recusado) {
      const [maior, ...resto] = [...recusado.origens].sort(
        (a, b) => b.valor - a.valor,
      );
      return {
        titulo: `Consumo recusado pelo financeiro${
          recusado.origens.length > 0
            ? ` · ${resumoDasPontas(recusado.origens, moeda)}`
            : ""
        }. A linha voltou ao faturamento; abra para ver a justificativa`,
        conteudo: (
          <span className={SAVE.botaoCodigo}>
            <ArrowDownLeft
              className={cn("h-[9px] w-[9px] flex-none", SAVE.icone)}
            />
            {maior?.codigo ?? "—"}
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
