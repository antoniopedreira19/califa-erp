"use client";

/**
 * O CNAE do cadastro de fornecedor (decisão 166, 09/10/2026): a lista
 * inteira do IBGE — 1.332 subclasses — no Combobox do sistema, filtrando
 * pelo que se digita: o código com ou sem pontuação ("5911", "5911102",
 * "5911-1/02") ou a atividade, sem acento. Os CNAEs que a consulta do CNPJ
 * trouxe (principal e secundários) sobem para o topo da lista.
 *
 * A lista mora em `lib/fiscal/cnaes.ts` (≈90 KB) e chega sob demanda, no
 * primeiro campo que aparece: o formulário do fornecedor também abre dentro
 * da PP, e ela não precisa vir junto com o resto da tela. Enquanto não
 * chega, o campo mostra o código escolhido.
 */

import * as React from "react";
import { Combobox, COMBOBOX_COMO_SELECT, type ComboboxItem } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { formatarCnae, type ConsultaDoRegime } from "@/lib/fiscal/regime-do-fornecedor";

/** A lista montada uma vez por página, para todos os campos. */
let listaCarregada: ComboboxItem[] | null = null;
let carregando: Promise<ComboboxItem[]> | null = null;

function carregarLista(): Promise<ComboboxItem[]> {
  if (listaCarregada) return Promise.resolve(listaCarregada);
  carregando ??= import("@/lib/fiscal/cnaes").then(({ CNAES }) => {
    listaCarregada = CNAES.map(([codigo, descricao]) => ({
      value: codigo,
      label: descricao,
      descricao: formatarCnae(codigo),
      // Os 7 dígitos: "5911102" e "59111" acham, além de "5911-1/02".
      busca: codigo,
      curto: `${formatarCnae(codigo)} · ${descricao}`,
    }));
    return listaCarregada;
  });
  return carregando;
}

export function CampoCnae({
  id,
  value,
  onChange,
  consulta,
  disabled,
  invalido,
  falta,
}: {
  id?: string;
  value: string | null;
  onChange: (codigo: string | null) => void;
  /** A consulta deste CNPJ: os CNAEs dela vão para o topo. */
  consulta: ConsultaDoRegime | null;
  disabled?: boolean;
  /** Erro do servidor. */
  invalido?: boolean;
  /** Vermelho: o cadastro abriu sem CNAE. */
  falta?: boolean;
}) {
  const [lista, setLista] = React.useState<ComboboxItem[] | null>(listaCarregada);
  React.useEffect(() => {
    if (lista) return;
    let vivo = true;
    carregarLista().then((l) => {
      if (vivo) setLista(l);
    });
    return () => {
      vivo = false;
    };
  }, [lista]);

  const itens = React.useMemo(() => {
    if (!lista) {
      // Antes de a lista chegar: só o escolhido, para o campo não ficar vazio.
      return value ? [{ value, label: formatarCnae(value), curto: formatarCnae(value) }] : [];
    }
    const doCnpj = consulta
      ? [consulta.cnaePrincipal, ...(consulta.cnaesSecundarios ?? [])].filter((c): c is string => Boolean(c))
      : [];
    if (doCnpj.length === 0) return lista;
    const porCodigo = new Map(lista.map((i) => [i.value, i]));
    const topo = Array.from(new Set(doCnpj))
      .map((c) => porCodigo.get(c))
      .filter((i): i is ComboboxItem => Boolean(i))
      .map((i) => ({
        ...i,
        grupo: "Deste CNPJ na Receita",
        descricao: `${i.descricao} · ${i.value === consulta?.cnaePrincipal ? "principal" : "secundário"}`,
      }));
    const noTopo = new Set(topo.map((i) => i.value));
    return [...topo, ...lista.filter((i) => !noTopo.has(i.value)).map((i) => ({ ...i, grupo: "Todos os CNAEs" }))];
  }, [lista, consulta, value]);

  return (
    <Combobox
      id={id}
      items={itens}
      value={value}
      onChange={onChange}
      placeholder="Escolha a atividade"
      buscaPlaceholder="Escreva o código ou a atividade"
      ariaLabel="CNAE"
      limpavel
      disabled={disabled}
      larguraLista="w-[min(640px,calc(100vw-48px))]"
      className={cn(
        COMBOBOX_COMO_SELECT,
        "rounded-[10px]",
        falta && "border-california-red ring-[3px] ring-california-red/10",
        invalido && "border-california-red ring-[3px] ring-california-red/10",
      )}
    />
  );
}
