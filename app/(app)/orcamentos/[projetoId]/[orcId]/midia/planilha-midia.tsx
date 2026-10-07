"use client";

/**
 * A planilha da versão de Mídia Off (decisão 147) — por mês, como o Always
 * On, com a campanha inteira.
 *
 * A régua no topo tem a Campanha e um bloco por mês, com o faturamento e o
 * resultado de cada um; a Campanha abre por padrão, e campanha de um mês
 * só abre direto no mês. O mês abre os meios dele (as abas filtram) e os
 * Totais do mês; a Campanha empilha os meses, com o Resumo por meio e mês
 * e os Totais da campanha. A régua, a Campanha empilhada e a cópia de mês
 * são os componentes do Always On.
 *
 * A tela grava célula a célula (`midia/actions.ts`). Cada escrita aparece na
 * hora — o patch fica por cima do que veio do servidor até a action
 * responder, e a resposta já traz a página atualizada (`revalidatePath`).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VersaoOrcamentoGrupo, VersaoOrcamentoItem, VersaoOrcamentoMes } from "@/lib/types";
import {
  chaveDoMeio,
  diasDoMes,
  fechar,
  linhaDoItem,
  meioDoGrupo,
  type FechamentoMidia,
  type LinhaMidia,
  type MeioDaVersao,
  type ParametrosMidia,
} from "@/lib/calculos/midia-off";
import { nomeDoMes, rotuloMes, rotuloMesCurto } from "@/lib/calculos/meses-trimestre";
import { normalizarFormato } from "@/lib/midia/meios";
import { marcarFornecedorComoVeiculo } from "@/app/(app)/fornecedores/actions";
import { ReguaMeses } from "../versoes/[versaoId]/regua-meses";
import { TrimestreEmpilhado } from "../versoes/[versaoId]/trimestre-empilhado";
import { CopiarItensDoMes } from "../versoes/[versaoId]/copiar-itens-mes";
import { ImportarPlanilhaVersao } from "../versoes/importar-planilha-versao";
import {
  atualizarLinhaMidia,
  criarMeioMidia,
  duplicarLinhaMidia,
  editarMeioMidia,
  gravarInsercoesMidia,
  novaLinhaMidia,
  removerLinhaMidia,
  removerMeioDoMesMidia,
  type PatchDaLinha,
} from "./actions";
import {
  ControleDaGrade,
  DicasDaPlanilha,
  PR_CALHA_MIDIA,
  ProvedorDaPlanilha,
  SecaoGrade,
  SecaoPeriodo,
  TotalDaMidia,
  type ApiDaPlanilha,
  type SelecaoDeDias,
  type VeiculoDaLista,
} from "./secoes";
import { AbasDosMeios, BotaoNovoMeio, FormatosUsados, type EdicaoDoMeio } from "./abas";
import { TotaisMidia } from "./totais";
import { ResumoDeInvestimentos } from "./resumo";
import { VeiculoDialog } from "./veiculo-dialog";

/** "2026-07-01" → "2026-07", a chave do mês na URL. */
const chaveDoMes = (iso: string) => iso.slice(0, 7);

function somarMeses(m: string, n: number): string {
  const [a, mm] = m.split("-").map(Number);
  const t = a * 12 + (mm - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function resumoMeiosLinhas(meios: number, linhas: number): string {
  return `${meios} ${meios === 1 ? "meio" : "meios"} · ${linhas} ${linhas === 1 ? "linha" : "linhas"}`;
}

interface Props {
  projetoId: string;
  orcamentoId: string;
  versaoId: string;
  numeroVersao: number;
  meses: VersaoOrcamentoMes[];
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  veiculos: VeiculoDaLista[];
  params: ParametrosMidia;
  /** `?mes=` da URL: `campanha`, `2026-07` ou ausente. */
  mesPedido: string | undefined;
  readOnly: boolean;
}

/** Um patch que ainda não voltou do servidor. */
interface Pendente {
  seq: number;
  id: string;
  patch: Partial<LinhaMidia>;
}

export function PlanilhaMidiaOff({
  projetoId,
  orcamentoId,
  versaoId,
  numeroVersao,
  meses,
  grupos,
  itens,
  veiculos: veiculosDoServidor,
  params,
  mesPedido,
  readOnly,
}: Props) {
  const router = useRouter();
  const base = `/orcamentos/${projetoId}/${orcamentoId}?v=${versaoId}`;

  // ---- O que veio do servidor, no formato da planilha ----------------------
  const mesDoId = React.useMemo(() => new Map(meses.map((m) => [m.id, chaveDoMes(m.mes)])), [meses]);
  const gruposDeMidia = React.useMemo(
    () => grupos.filter((g) => g.forma_compra && g.mes_id && mesDoId.has(g.mes_id)),
    [grupos, mesDoId],
  );
  const infoDoGrupo = React.useMemo(
    () =>
      new Map(
        gruposDeMidia.map((g) => [
          g.id,
          { grupo: g, meio: meioDoGrupo(g), mes: mesDoId.get(g.mes_id!)!, mesId: g.mes_id! },
        ]),
      ),
    [gruposDeMidia, mesDoId],
  );
  const linhasDoServidor = React.useMemo(
    () =>
      itens
        .filter((it) => infoDoGrupo.has(it.grupo_id))
        .map((it) => linhaDoItem(it, infoDoGrupo.get(it.grupo_id)!.meio.forma)),
    [itens, infoDoGrupo],
  );

  // ---- O que ainda não voltou do servidor ----------------------------------
  const [pendentes, setPendentes] = React.useState<Pendente[]>([]);
  const [removidas, setRemovidas] = React.useState<Set<string>>(new Set());
  const seq = React.useRef(0);
  const linhas = React.useMemo(() => {
    const porId = new Map<string, Partial<LinhaMidia>>();
    for (const p of pendentes) porId.set(p.id, { ...(porId.get(p.id) ?? {}), ...p.patch });
    return linhasDoServidor
      .filter((l) => !removidas.has(l.id))
      .map((l) => (porId.has(l.id) ? { ...l, ...porId.get(l.id) } : l));
  }, [linhasDoServidor, pendentes, removidas]);
  const linhasRef = React.useRef(linhas);
  linhasRef.current = linhas;

  const [erro, setErro] = React.useState<string | null>(null);
  const [veiculosNovos, setVeiculosNovos] = React.useState<VeiculoDaLista[]>([]);
  const veiculos = React.useMemo(() => {
    const ids = new Set(veiculosDoServidor.map((v) => v.id));
    return [...veiculosDoServidor, ...veiculosNovos.filter((v) => !ids.has(v.id))].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR"),
    );
  }, [veiculosDoServidor, veiculosNovos]);

  // ---- Os meios da versão (meio + formato), na ordem da planilha -----------
  const meiosDaVersao = React.useMemo(() => {
    const vistos = new Map<string, MeioDaVersao>();
    for (const g of [...gruposDeMidia].sort((a, b) => a.ordem - b.ordem)) {
      const m = meioDoGrupo(g);
      if (!vistos.has(m.chave)) vistos.set(m.chave, m);
    }
    return [...vistos.values()];
  }, [gruposDeMidia]);

  const chaveDe = React.useCallback((l: LinhaMidia) => infoDoGrupo.get(l.grupoId)?.meio.chave ?? "", [infoDoGrupo]);
  const mesDe = React.useCallback((l: LinhaMidia) => infoDoGrupo.get(l.grupoId)?.mes ?? "", [infoDoGrupo]);

  // Os meses, cada um com os grupos (meios) e as linhas dele.
  const dados = meses.map((m) => {
    const mes = chaveDoMes(m.mes);
    const gruposDoMes = gruposDeMidia
      .filter((g) => g.mes_id === m.id)
      .sort((a, b) => a.ordem - b.ordem);
    const ids = new Set(gruposDoMes.map((g) => g.id));
    const linhasDoMes = linhas.filter((l) => ids.has(l.grupoId));
    const meiosDoMes = gruposDoMes.map((g) => meioDoGrupo(g));
    return {
      mesId: m.id,
      mes,
      iso: m.mes,
      grupos: gruposDoMes,
      linhas: linhasDoMes,
      f: fechar(meiosDoMes, linhasDoMes, chaveDe, params),
    };
  });
  const fCampanha: FechamentoMidia = fechar(meiosDaVersao, linhas, chaveDe, params);

  // A Campanha abre por padrão; campanha de um mês só abre direto no mês.
  const chaves = dados.map((d) => d.mes);
  const selecionado =
    mesPedido === "campanha"
      ? "campanha"
      : mesPedido && chaves.includes(mesPedido)
        ? mesPedido
        : chaves.length === 1
          ? chaves[0]
          : "campanha";
  const dSel = dados.find((d) => d.mes === selecionado) ?? null;

  // ---- Estado da tela ------------------------------------------------------
  const [aba, setAba] = React.useState<string>("todos");
  const [recolhidas, setRecolhidas] = React.useState<Set<string>>(new Set());
  // Larga por padrão: as colunas folgadas (Tiago, 05/10/2026).
  const [gradeLarga, setGradeLarga] = React.useState(true);
  const [editando, setEditandoBruto] = React.useState<string | null>(null);
  const editandoRef = React.useRef(editando);
  editandoRef.current = editando;
  const setEditando = React.useCallback((v: string | null) => {
    editandoRef.current = v;
    setEditandoBruto(v);
  }, []);
  const atual = React.useCallback(() => editandoRef.current, []);
  const [semente, setSemente] = React.useState<{ chave: string; texto: string } | null>(null);
  // A linha criada agora: quando ela chega do servidor, a praça abre. Pela
  // linha (Nova linha) ou pelo meio (Novo meio: a linha nova é a do grupo
  // que a tela ainda não tinha).
  const [focarLinha, setFocarLinha] = React.useState<
    { id: string } | { grupoId: string; antes: Set<string> } | null
  >(null);
  React.useEffect(() => {
    if (!focarLinha) return;
    const alvo =
      "id" in focarLinha
        ? linhas.find((l) => l.id === focarLinha.id)
        : linhas.find((l) => l.grupoId === focarLinha.grupoId && !focarLinha.antes.has(l.id));
    if (!alvo) return;
    setSemente(null);
    setEditando(`${alvo.id}:praca`);
    setFocarLinha(null);
  }, [focarLinha, linhas, setEditando]);

  // ---- Escrita ---------------------------------------------------------------
  const avisarErro = React.useCallback((message: string) => {
    setErro(message);
  }, []);

  const atualizarLinha = React.useCallback(
    (id: string, patch: Partial<LinhaMidia>) => {
      if (readOnly) return;
      const n = ++seq.current;
      setPendentes((ps) => [...ps, { seq: n, id, patch }]);
      const envio: PatchDaLinha = {};
      for (const [k, v] of Object.entries(patch)) (envio as Record<string, unknown>)[k] = v;
      void atualizarLinhaMidia(id, envio)
        .then((r) => {
          if (!r.ok) avisarErro(r.message);
        })
        .catch(() => avisarErro("Não foi possível salvar a alteração."))
        .finally(() => setPendentes((ps) => ps.filter((p) => p.seq !== n)));
    },
    [readOnly, avisarErro],
  );

  const removerLinha = React.useCallback(
    (id: string) => {
      setEditando(null);
      setRemovidas((s) => new Set(s).add(id));
      void removerLinhaMidia(id)
        .then((r) => {
          if (!r.ok) avisarErro(r.message);
        })
        .catch(() => avisarErro("Não foi possível remover a linha."))
        .finally(() =>
          setRemovidas((s) => {
            const novo = new Set(s);
            novo.delete(id);
            return novo;
          }),
        );
    },
    [avisarErro, setEditando],
  );

  const duplicarLinha = React.useCallback(
    (id: string) => {
      void duplicarLinhaMidia(id)
        .then((r) => {
          if (!r.ok) avisarErro(r.message);
        })
        .catch(() => avisarErro("Não foi possível duplicar a linha."));
    },
    [avisarErro],
  );

  function novaLinha(grupoId: string) {
    void novaLinhaMidia(grupoId)
      .then((r) => {
        if (!r.ok) avisarErro(r.message);
        else if (r.id) setFocarLinha({ id: r.id });
      })
      .catch(() => avisarErro("Não foi possível criar a linha."));
  }

  /** "Novo meio": o meio que já existe no mês com o mesmo formato ganha uma
   *  linha; senão nasce. A aba dele abre, e a praça da linha nova também. */
  async function criarMeioNoMes(meio: string, formato: string, mes: string): Promise<string | null> {
    const d = dados.find((x) => x.mes === mes);
    if (!d) return "Mês não encontrado.";
    const antes = new Set(linhasRef.current.map((l) => l.id));
    const r = await criarMeioMidia(versaoId, d.mesId, meio, formato);
    if (!r.ok) return r.message;
    setAba(chaveDoMeio(meio, formato));
    if (r.id) setFocarLinha({ grupoId: r.id, antes });
    return null;
  }

  // ---- SELEÇÃO de vários dias e preenchimento ------------------------------
  const [selecao, setSelecaoBruta] = React.useState<SelecaoDeDias | null>(null);
  const [preenchendo, setPreenchendoBruto] = React.useState<string | null>(null);
  const selecaoRef = React.useRef<SelecaoDeDias | null>(null);
  const preenchendoRef = React.useRef<string | null>(null);
  const arrastando = React.useRef(false);
  const setSelecao = React.useCallback((v: SelecaoDeDias | null) => {
    selecaoRef.current = v;
    setSelecaoBruta(v);
  }, []);
  const setPreenchendo = React.useCallback((v: string | null) => {
    preenchendoRef.current = v;
    setPreenchendoBruto(v);
  }, []);
  const iniciarSelecao = React.useCallback(
    (s: SelecaoDeDias) => {
      arrastando.current = true;
      setPreenchendo(null);
      setSelecao(s);
    },
    [setSelecao, setPreenchendo],
  );
  const estenderSelecao = React.useCallback(
    (linhaIdx: number, dia: number) => {
      const s = selecaoRef.current;
      if (!arrastando.current || !s) return;
      if (s.l1 === linhaIdx && s.d1 === dia) return;
      setSelecao({ ...s, l1: linhaIdx, d1: dia });
    },
    [setSelecao],
  );
  const preencher = React.useCallback(
    (n: number) => {
      const s = selecaoRef.current;
      if (!s) return;
      const [l0, l1] = [Math.min(s.l0, s.l1), Math.max(s.l0, s.l1)];
      const [d0, d1] = [Math.min(s.d0, s.d1), Math.max(s.d0, s.d1)];
      const ultimo = diasDoMes(s.mes).length;
      const alvo = new Set(s.linhaIds.slice(l0, l1 + 1));
      const mudancas: Array<{ id: string; dias: Record<number, number> }> = [];
      for (const l of linhasRef.current) {
        if (!alvo.has(l.id)) continue;
        const dias = { ...l.dias };
        for (let d = d0; d <= Math.min(d1, ultimo); d++) {
          if (n > 0) dias[d] = n;
          else delete dias[d];
        }
        mudancas.push({ id: l.id, dias });
      }
      setPreenchendo(null);
      setSelecao(null);
      if (mudancas.length === 0 || readOnly) return;
      const lote = mudancas.map((m) => ({ seq: ++seq.current, id: m.id, patch: { dias: m.dias } }));
      const seqs = new Set(lote.map((p) => p.seq));
      setPendentes((ps) => [...ps, ...lote]);
      void gravarInsercoesMidia(versaoId, mudancas)
        .then((r) => {
          if (!r.ok) avisarErro(r.message);
        })
        .catch(() => avisarErro("Não foi possível gravar as inserções."))
        .finally(() => setPendentes((ps) => ps.filter((p) => !seqs.has(p.seq))));
    },
    [setSelecao, setPreenchendo, readOnly, versaoId, avisarErro],
  );

  // Soltar o botão: arrastou → a seleção fica; não arrastou → é um clique
  // numa célula só, que a seleção da célula (decisão 046) trata.
  React.useEffect(() => {
    const soltar = () => {
      if (!arrastando.current) return;
      arrastando.current = false;
      const s = selecaoRef.current;
      if (s && s.l0 === s.l1 && s.d0 === s.d1) setSelecao(null);
    };
    // Clique fora dos dias desmarca — menos enquanto o campo de preencher
    // está aberto: aí quem decide é o blur dele, que grava.
    const apertar = (e: PointerEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo.closest?.('[data-dia="1"]')) return;
      if (preenchendoRef.current !== null) return;
      if (selecaoRef.current) setSelecao(null);
    };
    const teclar = (e: KeyboardEvent) => {
      const s = selecaoRef.current;
      if (!s || preenchendoRef.current !== null) return;
      const foco = document.activeElement as HTMLElement | null;
      if (foco && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName)) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setPreenchendo(e.key);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        preencher(0);
      } else if (e.key === "Escape") {
        setSelecao(null);
      }
    };
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointerdown", apertar, true);
    window.addEventListener("keydown", teclar);
    return () => {
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointerdown", apertar, true);
      window.removeEventListener("keydown", teclar);
    };
  }, [setSelecao, setPreenchendo, preencher]);

  // ---- O veículo -------------------------------------------------------------
  const [dialogVeiculo, setDialogVeiculo] = React.useState<{
    linhaId: string;
    nomeInicial?: string;
    veiculo?: VeiculoDaLista;
  } | null>(null);

  function abrirVeiculo(linhaId: string, nomeInicial?: string) {
    const linha = linhasRef.current.find((l) => l.id === linhaId);
    const veiculo = !nomeInicial && linha?.veiculoId ? veiculos.find((v) => v.id === linha.veiculoId) : undefined;
    setDialogVeiculo({ linhaId, nomeInicial, veiculo });
  }

  /** O veículo recém-cadastrado (ou o fornecedor que virou veículo) entra na
   *  lista na hora, já usado no meio da linha; o servidor confirma o uso no
   *  próximo carregamento (decisão 150). */
  function escolherVeiculoNaLinha(f: { id: string; nome: string }) {
    if (!dialogVeiculo) return;
    const linha = linhasRef.current.find((l) => l.id === dialogVeiculo.linhaId);
    const meio = linha ? infoDoGrupo.get(linha.grupoId)?.meio.meio : undefined;
    const antes = veiculos.find((v) => v.id === f.id)?.meios ?? [];
    const meios = Array.from(new Set([...antes, ...(meio ? [meio] : [])]));
    setVeiculosNovos((vs) => [...vs.filter((x) => x.id !== f.id), { id: f.id, nome: f.nome, meios }]);
    atualizarLinha(dialogVeiculo.linhaId, { veiculoId: f.id });
    setDialogVeiculo(null);
  }

  // ---- O que a planilha lê -------------------------------------------------
  const api: ApiDaPlanilha = {
    params,
    readOnly,
    editando,
    atual,
    setEditando,
    atualizarLinha,
    removerLinha,
    duplicarLinha,
    gradeLarga,
    alternarGradeLarga: () => setGradeLarga((a) => !a),
    meioDoGrupo: (grupoId) => infoDoGrupo.get(grupoId)?.meio.meio ?? "",
    mesDoGrupo: (grupoId) => infoDoGrupo.get(grupoId)?.mes ?? "",
    semente,
    abrirCampo: (chave, texto) => {
      setSemente(texto ? { chave, texto } : null);
      setEditando(chave);
    },
    selecao,
    iniciarSelecao,
    estenderSelecao,
    preenchendo,
    preencher,
    fecharPreenchimento: () => setPreenchendo(null),
    veiculos,
    abrirVeiculo,
  };

  /** Os formatos que a versão já usa no meio: o do meio e o das linhas. */
  const formatosUsados = React.useCallback(
    (meio: string) => {
      const ids = new Set(gruposDeMidia.filter((g) => g.meio === meio).map((g) => g.id));
      const todos = [
        ...gruposDeMidia.filter((g) => ids.has(g.id)).map((g) => g.formato ?? ""),
        ...linhas.filter((l) => ids.has(l.grupoId)).map((l) => l.formato),
      ].filter((f) => f && f.trim() !== "—");
      return todos.filter((f, i) => todos.findIndex((g) => normalizarFormato(g) === normalizarFormato(f)) === i);
    },
    [gruposDeMidia, linhas],
  );

  /** O lápis do meio vale para todos os meses dele. */
  function edicaoDe(meio: MeioDaVersao): EdicaoDoMeio {
    const doMeio = linhas.filter((l) => chaveDe(l) === meio.chave);
    const formatoDoMeio = meio.formato.trim().toLowerCase();
    return {
      qtdLinhas: doMeio.length,
      qtdComOFormato: doMeio.filter((l) => l.formato.trim().toLowerCase() === formatoDoMeio).length,
      meses: dados.filter((d) => d.grupos.some((g) => meioDoGrupo(g).chave === meio.chave)).map((d) => nomeDoMes(d.iso)),
      validar: (novoMeio, formato) => {
        const igual = meiosDaVersao.find(
          (x) => x.chave !== meio.chave && x.meio === novoMeio && x.formato.trim().toLowerCase() === formato.trim().toLowerCase(),
        );
        return igual ? `Já existe ${novoMeio} · ${igual.formato} nesta versão: use o meio que já existe.` : null;
      },
      onSalvar: async (novoMeio, formato) => {
        setEditando(null);
        const r = await editarMeioMidia(versaoId, { meio: meio.meio, formato: meio.formato }, { meio: novoMeio, formato });
        if (!r.ok) return r.message;
        if (aba === meio.chave) setAba(chaveDoMeio(novoMeio, formato));
        return null;
      },
    };
  }

  function removerMeioDoMes(grupoId: string) {
    setEditando(null);
    void removerMeioDoMesMidia(grupoId)
      .then((r) => {
        if (!r.ok) avisarErro(r.message);
      })
      .catch(() => avisarErro("Não foi possível remover o meio."));
  }

  const alternar = (chave: string) =>
    setRecolhidas((s) => {
      const n = new Set(s);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });

  // ---- A régua ---------------------------------------------------------------
  const descricao = (() => {
    if (dados.length === 0) return "A campanha ainda não tem meses";
    const primeiro = dados[0].iso;
    const ultimo = dados[dados.length - 1].iso;
    if (primeiro === ultimo) return rotuloMes(primeiro);
    const inicio = primeiro.slice(0, 4) === ultimo.slice(0, 4) ? rotuloMesCurto(primeiro) : rotuloMes(primeiro);
    return `${inicio} a ${nomeDoMes(ultimo)} de ${ultimo.slice(0, 4)}`;
  })();
  const disponiveis = (() => {
    if (dados.length === 0) return [];
    const fora: string[] = [];
    const ate = somarMeses(chaves[chaves.length - 1], 3);
    for (let m = somarMeses(chaves[0], -2); m <= ate; m = somarMeses(m, 1)) if (!chaves.includes(m)) fora.push(m);
    return fora;
  })();

  const temGrade = (gs: VersaoOrcamentoGrupo[]) => gs.some((g) => g.forma_compra === "grade");
  const meiosDaCampanha = meiosDaVersao;
  const contagemPorMeio = (ls: LinhaMidia[]) => {
    const c: Record<string, number> = {};
    for (const l of ls) c[chaveDe(l)] = (c[chaveDe(l)] ?? 0) + 1;
    return c;
  };

  const conteudoDoMes = (
    d: (typeof dados)[number],
    opcoes: { semTotais?: boolean; aba: string; comNovoMeio?: boolean },
  ) => {
    const nome = nomeDoMes(d.iso);
    const vazio = d.grupos.length === 0;
    const gruposDaTela = opcoes.aba === "todos" ? d.grupos : d.grupos.filter((g) => meioDoGrupo(g).chave === opcoes.aba);
    const meioDaAba = opcoes.aba === "todos" ? null : meiosDaVersao.find((m) => m.chave === opcoes.aba);
    return (
      <div className="space-y-6">
        {vazio && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
            <p className="text-sm font-semibold text-foreground">{rotuloMes(d.iso)} ainda não tem linhas</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {readOnly ? "Nada a mostrar." : `Use “Copiar linhas de outro mês”, acima, ou crie os meios de ${nome}.`}
            </p>
          </div>
        )}
        {!vazio && meioDaAba && gruposDaTela.length === 0 && (
          <p className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-4 text-[13px] text-muted-foreground">
            {meioDaAba.meio} não tem linhas em {nome}.
          </p>
        )}
        {gruposDaTela.map((g) => {
          const meio = meioDoGrupo(g);
          const chave = `${d.mes}|${g.id}`;
          const props = {
            meio,
            grupoId: g.id,
            mes: d.mes,
            linhas: d.linhas.filter((l) => l.grupoId === g.id),
            aberta: !recolhidas.has(chave),
            onAlternar: () => alternar(chave),
            onNovaLinha: () => novaLinha(g.id),
            onRemover: readOnly ? undefined : () => removerMeioDoMes(g.id),
            edicao: readOnly ? undefined : edicaoDe(meio),
          };
          return meio.forma === "grade" ? <SecaoGrade key={chave} {...props} /> : <SecaoPeriodo key={chave} {...props} />;
        })}
        {/* As teclas da planilha, uma vez embaixo dos meios (decisão 046). */}
        {!vazio && !opcoes.semTotais && <DicasDaPlanilha />}
        {opcoes.comNovoMeio && !readOnly && (
          <div>
            <BotaoNovoMeio
              rotulo={`Novo meio em ${nome}`}
              destino={`O meio entra em ${nome}.`}
              onCriar={(meio, formato) => criarMeioNoMes(meio, formato, d.mes)}
            />
          </div>
        )}
        {!vazio && <TotalDaMidia conta={d.f.geral} qtdMeios={d.grupos.length} qtdLinhas={d.linhas.length} rotulo={`Total · ${nome}`} />}
        {!vazio && !opcoes.semTotais && <TotaisMidia f={d.f} p={params} titulo={`Totais de ${nome}`} />}
      </div>
    );
  };

  const abaDoMes = dSel && dSel.grupos.some((g) => meioDoGrupo(g).chave === aba) ? aba : "todos";
  const abaDaCampanha = aba === "resumo" ? "resumo" : meiosDaCampanha.some((m) => m.chave === aba) ? aba : "todos";

  return (
    <ProvedorDaPlanilha valor={api}>
      <FormatosUsados.Provider value={formatosUsados}>
        <div className="space-y-6">
          <ReguaMeses
            moeda="BRL"
            descricao={`${descricao}, a campanha inteira`}
            vocabulario="linhas"
            trimestre={{
              chave: "campanha",
              rotulo: "Campanha",
              faturamento: fCampanha.faturamentoPrevisto,
              resultadoGeral: linhas.length ? fCampanha.resultadoGeral : null,
              href: `${base}&mes=campanha`,
            }}
            meses={dados.map((d) => ({
              chave: d.mes,
              rotulo: rotuloMesCurto(d.iso),
              faturamento: d.f.faturamentoPrevisto,
              resultadoGeral: d.linhas.length ? d.f.resultadoGeral : null,
              detalhe: d.linhas.length ? undefined : "Sem linhas",
              href: `${base}&mes=${d.mes}`,
            }))}
            selecionado={selecionado}
            editar={
              readOnly
                ? null
                : {
                    versaoId,
                    trimestreRotulo: `Campanha: ${descricao.charAt(0).toLowerCase()}${descricao.slice(1)}`,
                    meses: dados.map((d) => ({ id: d.mesId, rotulo: rotuloMes(d.iso), qtdItens: d.linhas.length })),
                    disponiveis: disponiveis.map((m) => ({ mes: `${m}-01`, rotulo: rotuloMes(`${m}-01`) })),
                  }
            }
            acao={
              readOnly ? null : (
                // Exportar e importar a planilha da Mídia Off ficam para
                // depois do desenho (decisão 147, entrega 1).
                <ImportarPlanilhaVersao
                  projetoId={projetoId}
                  orcamentoId={orcamentoId}
                  modeloPlanilha="midia_off"
                  interno={false}
                  modo="sobrescrever"
                  versaoId={versaoId}
                  numeroVersao={numeroVersao}
                  conteudoAtual={{ grupos: gruposDeMidia.length, itens: linhas.length, bvs: 0 }}
                  disabled
                  disabledReason="A importação de planilha da Mídia Off ainda não está disponível."
                />
              )
            }
          />

          {erro && (
            <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{erro}</span>
              <button
                type="button"
                onClick={() => {
                  setErro(null);
                  router.refresh();
                }}
                aria-label="Fechar o aviso"
                className="rounded-md p-0.5 text-california-red/70 transition-colors hover:bg-california-red/10 hover:text-california-red"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {dados.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
              <p className="text-sm font-semibold text-foreground">Esta versão ainda não tem meses</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {readOnly ? "Nada a mostrar." : "Ajuste o período do orçamento, em “Editar”, para criar os meses da campanha."}
              </p>
            </div>
          ) : selecionado === "campanha" ? (
            <>
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-xl font-semibold tracking-tight">Campanha</h2>
                <span className="text-[13px] text-muted-foreground">{dados.length === 1 ? "1 mês" : `${dados.length} meses`}</span>
              </div>
              <div className={cn("space-y-6", PR_CALHA_MIDIA)}>
                {/* A barra de abas por meio também na Campanha: com um meio
                    escolhido, os meses empilhados mostram só ele, e a escolha
                    vale ao trocar de mês na régua. */}
                <AbasDosMeios
                  valor={abaDaCampanha}
                  onChange={setAba}
                  meios={meiosDaCampanha}
                  contagem={contagemPorMeio(linhas)}
                  total={linhas.length}
                  rotuloNovoMeio="Novo meio"
                  destinoNovoMeio="A tela vai para o mês escolhido, na aba do meio novo."
                  semNovoMeio={readOnly}
                  mesesNovoMeio={dados.map((d) => ({ mes: d.mes, nome: rotuloMes(d.iso) }))}
                  onCriar={async (meio, formato, mes) => {
                    // A Campanha abre só o 1º mês do empilhado: o meio criado
                    // em outro mês ficaria fora da vista. A tela vai para ele.
                    const destino = mes ?? dados[0].mes;
                    const recusa = await criarMeioNoMes(meio, formato, destino);
                    if (!recusa) router.push(`${base}&mes=${destino}`, { scroll: false });
                    return recusa;
                  }}
                />
                {abaDaCampanha === "resumo" ? (
                  <ResumoDeInvestimentos
                    meios={meiosDaCampanha}
                    linhas={linhas}
                    meses={chaves}
                    chaveDe={chaveDe}
                    mesDe={mesDe}
                    params={params}
                  />
                ) : (
                  <TrimestreEmpilhado
                    moeda="BRL"
                    acoes={temGrade(gruposDeMidia) ? <ControleDaGrade /> : null}
                    meses={dados.map((d) => ({
                      id: d.mesId,
                      titulo: rotuloMes(d.iso),
                      nome: nomeDoMes(d.iso),
                      resumo: resumoMeiosLinhas(d.grupos.length, d.linhas.length),
                      faturamento: d.f.faturamentoPrevisto,
                      custoPlanejado: d.f.custoPlanejado,
                      resultadoOperacional: d.linhas.length ? d.f.resultadoOperacional : null,
                      resultadoGeral: d.linhas.length ? d.f.resultadoGeral : null,
                      href: `${base}&mes=${d.mes}`,
                      conteudo: conteudoDoMes(d, { semTotais: true, comNovoMeio: true, aba: abaDaCampanha }),
                    }))}
                  />
                )}
                <TotaisMidia f={fCampanha} p={params} titulo="Totais da campanha" />
              </div>
            </>
          ) : dSel ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-2.5">
                  <h2 className="text-xl font-semibold tracking-tight">{rotuloMes(dSel.iso)}</h2>
                  <span className="text-[13px] text-muted-foreground">{resumoMeiosLinhas(dSel.grupos.length, dSel.linhas.length)}</span>
                </div>
                {!readOnly && (
                  <CopiarItensDoMes
                    destinoId={dSel.mesId}
                    destinoNome={nomeDoMes(dSel.iso)}
                    vocabulario="linhas"
                    origens={dados
                      .filter((d) => d.mesId !== dSel.mesId)
                      .map((d) => ({
                        id: d.mesId,
                        rotulo: rotuloMes(d.iso),
                        qtdGrupos: d.grupos.length,
                        qtdItens: d.linhas.length,
                      }))}
                    bloqueio={dSel.grupos.length > 0 ? "Só é possível copiar para um mês vazio." : undefined}
                  />
                )}
              </div>
              <div className={cn("space-y-6", PR_CALHA_MIDIA)}>
                {/* As abas dentro do mês: a régua escolhe o mês; as abas
                    filtram os meios dele. Sem "Resumo": ele mora na
                    Campanha. */}
                <AbasDosMeios
                  valor={abaDoMes}
                  onChange={setAba}
                  meios={dSel.grupos.map((g) => meioDoGrupo(g))}
                  contagem={contagemPorMeio(dSel.linhas)}
                  total={dSel.linhas.length}
                  semResumo
                  rotuloNovoMeio={`Novo meio em ${nomeDoMes(dSel.iso)}`}
                  destinoNovoMeio={`O meio entra em ${nomeDoMes(dSel.iso)} e abre na aba dele.`}
                  semNovoMeio={readOnly}
                  onCriar={(meio, formato) => criarMeioNoMes(meio, formato, dSel.mes)}
                />
                {/* No mês não há "Recolher todos": o botão da largura fica no
                    mesmo lugar em que estaria na Campanha. */}
                {temGrade(dSel.grupos) && (
                  <div className="flex items-center">
                    <ControleDaGrade />
                  </div>
                )}
                {conteudoDoMes(dSel, { aba: abaDoMes })}
              </div>
            </>
          ) : null}
        </div>

        <VeiculoDialog
          open={dialogVeiculo !== null}
          onOpenChange={(o) => {
            if (!o) setDialogVeiculo(null);
          }}
          veiculo={dialogVeiculo?.veiculo}
          nomeInicial={dialogVeiculo?.nomeInicial}
          onCriado={escolherVeiculoNaLinha}
          onSelecionarExistente={async (f) => {
            const r = await marcarFornecedorComoVeiculo(f.id);
            if (!r.ok) {
              avisarErro(r.message);
              setDialogVeiculo(null);
              return;
            }
            escolherVeiculoNaLinha(f);
          }}
          onSalvo={() => {
            setDialogVeiculo(null);
            router.refresh();
          }}
        />
      </FormatosUsados.Provider>
    </ProvedorDaPlanilha>
  );
}
