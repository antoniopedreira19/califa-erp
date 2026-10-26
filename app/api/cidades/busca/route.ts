import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { listarCidades, buscarSugestoesHibridas } from "@/lib/data/cidades";
import type { CidadeSugestao } from "@/lib/data/cidades";

/**
 * Busca do combobox de cidade (`app/(app)/orcamentos/cidade-combobox.tsx`).
 *
 * Devolve o que ESTÁ no cadastro local do tenant + sugestões do IBGE que
 * ainda não foram cadastradas (com marcador `origem='ibge'`). Sem termo,
 * só o cadastro local (LIMITE_CIDADES).
 *
 * É rota GET, não server action, de propósito: server actions do mesmo
 * cliente rodam em fila, uma de cada vez, e não dá para cancelar a que
 * ficou velha. Com o IBGE lento, cada letra digitada entrava atrás da
 * anterior e o "Buscando…" não acabava (22/10/2026). Aqui o combobox
 * aborta a requisição velha e as buscas não se enfileiram.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);

  let opcoes: CidadeSugestao[];
  if (q.length === 0) {
    const locais = await listarCidades(session.activeTenant.id);
    opcoes = locais.map((c) => ({
      origem: "local" as const,
      id: c.id,
      nome: c.nome,
      uf: c.uf,
    }));
  } else {
    opcoes = await buscarSugestoesHibridas(session.activeTenant.id, q);
  }

  return NextResponse.json(opcoes, {
    headers: { "Cache-Control": "no-store" },
  });
}
