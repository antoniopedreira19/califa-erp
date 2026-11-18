import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Decisão 266: o projeto do job de pagamentos não tem página em
 * Orçamentos. Ele existe só para ancorar a planilha do job (o orçamento
 * aprovado e vazio), e o orçamento dele não se edita, não se duplica e
 * não ganha irmão. Quem chegar por link vai para a visão agregada dos
 * jobs, que reúne os jobs de pagamentos daquele projeto unificado.
 *
 * Uma consulta pela chave primária, em paralelo com a página.
 */
export default async function ProjetoDeOrcamentosLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { projetoId: string };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("projetos")
    .select("de_pagamentos")
    .eq("id", params.projetoId)
    .maybeSingle<{ de_pagamentos: boolean }>();
  if (data?.de_pagamentos) redirect(`/jobs/projeto/${params.projetoId}`);
  return <>{children}</>;
}
