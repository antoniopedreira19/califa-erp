"use client";

import { Plus, Table2 } from "lucide-react";
import {
  CalhaAcoes,
  LARGURA_CALHA,
  PILULA_CALHA,
  type AcaoCalha,
} from "@/app/(app)/_planilha/calha-acoes";

/** Largura da calha que recebe o botão.
 *
 *  Mora em `_planilha/calha-acoes` desde 13/08/2026: a calha deixou de
 *  ser "a calha do BV" quando o A · Repasse passou a dividi-la com a PP.
 *  O nome antigo continua exportado porque é ele que as telas importam e
 *  é ele que os comentários de `pr-` na página citam. */
export const LARGURA_CALHA_BV = LARGURA_CALHA;

/** Classes da pílula de ação única. Idem: a forma é a mesma para BV e
 *  para PP, então vive num lugar só. */
export const PILULA_BV = PILULA_CALHA;

/** Descreve a ação de BV de uma linha, para a calha montar a pílula.
 *
 *  Separado do componente porque a planilha do job precisa da DESCRIÇÃO
 *  para juntá-la à da PP na mesma moldura — em A · Repasse a linha tem as
 *  duas ações. Quem tem só o BV usa o `BvActionButton` logo abaixo.
 *
 *  "Abrir BV" usa o ícone de planilha (o BV é um documento interno) e
 *  "Ver PP" segue com o olho: ações parecidas, objetos diferentes. */
export function acaoBv({
  temBv,
  itemNome,
  somenteLeitura,
  onClick,
}: {
  temBv: boolean;
  itemNome: string;
  /** BV já enviado ao financeiro (ou tela congelada): abre em consulta.
   *  O rótulo não muda — "Abrir BV" já cobre ver e editar. */
  somenteLeitura?: boolean;
  onClick: () => void;
}): AcaoCalha {
  return {
    chave: "bv",
    rotulo: temBv ? "Abrir BV" : "Adicionar BV",
    sigla: "BV",
    titulo: temBv
      ? somenteLeitura
        ? `Ver BV de ${itemNome}`
        : `Editar BV de ${itemNome}`
      : `Lançar BV em ${itemNome}`,
    icone: temBv ? Table2 : Plus,
    criar: !temBv,
    onClick,
  };
}

/** Pílula do BV na calha da linha, quando o BV é a única ação dela.
 *
 *  Em A · Direto e D o cliente paga o fornecedor diretamente: não há PP a
 *  emitir, e a linha tem só esta pílula, com o rótulo por extenso. */
export function BvActionButton(props: {
  temBv: boolean;
  itemNome: string;
  somenteLeitura?: boolean;
  onClick: () => void;
}) {
  return <CalhaAcoes acoes={[acaoBv(props)]} />;
}
