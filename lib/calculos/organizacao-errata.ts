/**
 * A organização da Planilha Interna do job na errata — decisão 162
 * (09/10/2026).
 *
 * Na errata o item muda de lugar (e de agrupamento), o agrupamento se
 * renomeia e nasce, e o que ficar vazio sai na confirmação. Nada disso mexe
 * em valor. Esta é a regra num lugar só: o rascunho da tela a usa para
 * mostrar o resultado e o que vai mudar; a server action, para conferir o
 * pedido contra o banco e montar o que a função `registrar_errata_do_job`
 * grava.
 *
 * O movimento de um item é o mesmo da planilha do orçamento
 * (`ordem-itens.ts`, decisão 104).
 */

import type { MudancaDeEstrutura } from "@/lib/types";

export type { MudancaDeEstrutura };

/** Um agrupamento do job, antes ou depois da errata. */
export interface GrupoDaOrganizacao {
  id: string;
  nome: string;
  /** O mês do modelo mensal (decisão 078); `null` fora dele. */
  mesId: string | null;
}

/** Uma linha da planilha, na ordem da tela. */
export interface LinhaDaOrganizacao {
  id: string;
  grupoId: string;
  item: string;
}

/** A planilha inteira: os agrupamentos na ordem e as linhas na ordem. */
export interface Organizacao {
  grupos: GrupoDaOrganizacao[];
  linhas: LinhaDaOrganizacao[];
}


export const MAX_NOME_DO_GRUPO = 120;

/** "TOOLKIT" e "toolkit " são o mesmo nome. */
export function chaveDoNome(nome: string): string {
  return nome.trim().toLocaleLowerCase("pt-BR");
}

/**
 * O erro do nome, ou `null` quando ele serve. O nome é único entre os
 * agrupamentos de pé do mesmo mês (no mensal) ou do job inteiro.
 */
export function erroDoNomeDoGrupo(
  nome: string,
  mesId: string | null,
  grupos: GrupoDaOrganizacao[],
  ignorar: string | null,
): string | null {
  const n = nome.trim();
  if (n === "") return "Informe o nome do grupo.";
  if (n.length > MAX_NOME_DO_GRUPO) return "Máximo 120 caracteres.";
  const repetido = grupos.some(
    (g) => g.id !== ignorar && g.mesId === mesId && chaveDoNome(g.nome) === chaveDoNome(n),
  );
  if (repetido) {
    return mesId
      ? "Já existe um grupo com esse nome neste mês."
      : "Já existe um grupo com esse nome neste job.";
  }
  return null;
}

/**
 * Os agrupamentos que saem na confirmação: os que ficaram vazios nesta
 * errata. "Ficou vazio" é ter linha antes e nenhuma depois — o agrupamento
 * que já estava vazio fica como estava. O agrupamento criado nesta errata e
 * deixado vazio também sai (ele não chega a nascer).
 */
export function gruposQueSaem(antes: Organizacao, depois: Organizacao): string[] {
  const tinhaLinha = new Set(antes.linhas.map((l) => l.grupoId));
  const temLinha = new Set(depois.linhas.map((l) => l.grupoId));
  const existia = new Set(antes.grupos.map((g) => g.id));
  return depois.grupos
    .filter((g) => !temLinha.has(g.id) && (tinhaLinha.has(g.id) || !existia.has(g.id)))
    .map((g) => g.id);
}

/**
 * O que a errata muda na organização, na ordem em que o pop-up lista:
 * agrupamentos novos, renomeados e que saem; itens que mudaram de
 * agrupamento; e os agrupamentos cujos itens ficaram em outra ordem.
 *
 * - O agrupamento novo que fica vazio não aparece: ele não chega a nascer.
 * - "Ordem" compara, dentro de cada agrupamento que já existia, só as
 *   linhas que já eram dele: quem chegou de outro já aparece como movido.
 *   A linha nova da errata conta como "dele" no agrupamento onde nasceu.
 *
 * `novasNoGrupo` diz onde cada linha nova nasceu (chave → agrupamento), e
 * a ordem em que foram criadas é a das chaves.
 */
export function mudancasDeEstrutura(
  antes: Organizacao,
  depois: Organizacao,
  novasNoGrupo: Map<string, string>,
): MudancaDeEstrutura[] {
  const lista: MudancaDeEstrutura[] = [];
  const nomeAntes = new Map(antes.grupos.map((g) => [g.id, g.nome]));
  const nomeDepois = new Map(depois.grupos.map((g) => [g.id, g.nome]));
  const saem = new Set(gruposQueSaem(antes, depois));

  for (const g of depois.grupos) {
    const anterior = nomeAntes.get(g.id);
    if (anterior === undefined) {
      if (!saem.has(g.id)) lista.push({ tipo: "grupo_novo", chave: g.id, nome: g.nome.trim() });
    } else if (anterior.trim() !== g.nome.trim()) {
      lista.push({ tipo: "grupo_renomeado", chave: g.id, de: anterior, para: g.nome.trim() });
    }
  }
  for (const g of antes.grupos) {
    const sumiu = !nomeDepois.has(g.id);
    if (saem.has(g.id) || sumiu) {
      lista.push({ tipo: "grupo_removido", chave: g.id, nome: g.nome });
    }
  }

  const grupoAntes = new Map(antes.linhas.map((l) => [l.id, l.grupoId]));
  for (const l of depois.linhas) {
    const de = grupoAntes.get(l.id);
    if (de === undefined || de === l.grupoId) continue;
    lista.push({
      tipo: "item_movido",
      chave: l.id,
      item: l.item,
      de: nomeAntes.get(de) ?? "—",
      para: (nomeDepois.get(l.grupoId) ?? "—").trim(),
    });
  }

  const posAntes = new Map(antes.linhas.map((l, k) => [l.id, k]));
  const chavesDasNovas = [...novasNoGrupo.keys()];
  const posNatural = (id: string) =>
    posAntes.get(id) ?? antes.linhas.length + chavesDasNovas.indexOf(id);
  for (const g of depois.grupos) {
    if (!nomeAntes.has(g.id)) continue;
    const daqui = depois.linhas.filter(
      (l) =>
        l.grupoId === g.id &&
        (grupoAntes.has(l.id) ? grupoAntes.get(l.id) === g.id : novasNoGrupo.get(l.id) === g.id),
    );
    const natural = [...daqui].sort((a, b) => posNatural(a.id) - posNatural(b.id));
    if (daqui.some((l, k) => l.id !== natural[k].id)) {
      lista.push({ tipo: "ordem", chave: `ordem:${g.id}`, grupo: g.nome.trim() });
    }
  }
  return lista;
}

/** "2 itens movidos · ordem alterada · 1 grupo renomeado" — a parte da
 *  organização no resumo da errata. */
export function resumoDaEstrutura(mudancas: MudancaDeEstrutura[]): string[] {
  const de = (t: MudancaDeEstrutura["tipo"]) => mudancas.filter((m) => m.tipo === t).length;
  const partes: string[] = [];
  const mov = de("item_movido");
  const ren = de("grupo_renomeado");
  const gno = de("grupo_novo");
  const grm = de("grupo_removido");
  if (mov) partes.push(`${mov} ${mov === 1 ? "item movido" : "itens movidos"}`);
  if (de("ordem")) partes.push("ordem alterada");
  if (ren) partes.push(`${ren} ${ren === 1 ? "grupo renomeado" : "grupos renomeados"}`);
  if (gno) partes.push(`${gno} ${gno === 1 ? "grupo novo" : "grupos novos"}`);
  if (grm) partes.push(`${grm} ${grm === 1 ? "grupo removido" : "grupos removidos"}`);
  return partes;
}
