export const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const formatarData = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
