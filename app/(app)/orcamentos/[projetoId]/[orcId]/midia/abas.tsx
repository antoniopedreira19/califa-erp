"use client";

/**
 * As abas dos meios, o "+" que cria um meio e o lápis que o edita
 * (decisão 147, protótipo aprovado em 06/10/2026).
 *
 * O "+" fica na ponta da fileira de abas porque é ali que o meio novo
 * nasce: a aba aparece no lugar do botão, já aberta. O formulário do meio
 * é o MESMO para criar e para editar (como o cadastro e a edição de
 * fornecedor): meio, formato e, na Campanha, o mês em que o meio entra.
 *
 * O formato é texto livre com sugestões: primeiro o que a versão já usa
 * naquele meio, depois os formatos comuns do meio. Meio + formato
 * identificam o meio na versão — "Filme 30"" × "Filme 30s" viraria dois.
 */

import * as React from "react";
import { Check, Pencil, Plus, Rows3, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BOTAO_NOVO_GRUPO } from "@/app/(app)/_planilha/blocos";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MEIOS,
  exemploDeFormato,
  fraseDaForma,
  normalizarFormato,
  sugestoesDoMeio,
} from "@/lib/midia/meios";
import type { MeioDaVersao } from "@/lib/calculos/midia-off";

const LABEL = "text-[12px] font-semibold text-foreground/70";

/** Os formatos que a versão já usa em cada meio — o do meio e o das
 *  linhas —, para o campo de formato sugerir primeiro. */
export const FormatosUsados = React.createContext<(meio: string) => string[]>(() => []);

/** Campo de texto livre com a lista de sugestões embaixo. ↓ ↑ andam na
 *  lista, Enter escolhe (sem item marcado, Enter salva o pop-up), Esc fecha
 *  só a lista. */
function CampoFormato({
  id,
  meio,
  valor,
  onChange,
  onEnter,
  escRef,
}: {
  id: string;
  meio: string;
  valor: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  /** O Esc do pop-up pergunta aqui antes: com a lista aberta, só ela fecha. */
  escRef?: React.MutableRefObject<(() => boolean) | null>;
}) {
  const usadosDe = React.useContext(FormatosUsados);
  const [aberta, setAberta] = React.useState(false);
  const [marcado, setMarcado] = React.useState(-1);
  // A lista só filtra depois que a pessoa digita: ao abrir com o formato
  // já preenchido, mostra todas as sugestões (com o atual marcado).
  const [digitou, setDigitou] = React.useState(false);
  const usados = meio ? usadosDe(meio) : [];
  const comuns = sugestoesDoMeio(meio).filter((x) => !usados.some((u) => normalizarFormato(u) === normalizarFormato(x)));
  const q = normalizarFormato(valor);
  const filtra = (xs: string[]) => (digitou && q ? xs.filter((x) => normalizarFormato(x).includes(q)) : xs);
  const grupos = [
    { titulo: "Já usados nesta versão", itens: filtra(usados) },
    { titulo: `Comuns em ${meio}`, itens: filtra(comuns) },
  ].filter((g) => g.itens.length > 0);
  const lista = grupos.flatMap((g) => g.itens);
  const exato = lista.some((x) => normalizarFormato(x) === q);
  const mostrar = aberta && (lista.length > 0 || (digitou && q !== "" && !!meio));

  if (escRef)
    escRef.current = () => {
      if (!mostrar) return false;
      setAberta(false);
      return true;
    };

  function escolher(v: string) {
    onChange(v);
    setAberta(false);
    setMarcado(-1);
    setDigitou(false);
  }

  let i = -1;
  return (
    <div className="relative">
      <input
        id={id}
        value={valor}
        autoComplete="off"
        onFocus={() => {
          setAberta(true);
          setDigitou(false);
        }}
        onBlur={() => setAberta(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setAberta(true);
          setMarcado(-1);
          setDigitou(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAberta(true);
            setMarcado((m) => Math.min(lista.length - 1, m + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setMarcado((m) => Math.max(-1, m - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (mostrar && marcado >= 0 && lista[marcado]) escolher(lista[marcado]);
            else onEnter();
          } else if (e.key === "Tab") {
            setAberta(false);
          }
        }}
        placeholder={meio ? "Escolha ou digite" : exemploDeFormato(meio)}
        className="h-9 w-full rounded-md border border-border bg-white px-2.5 text-sm text-foreground outline-none focus:border-california-red/50"
      />
      {mostrar && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-60 overflow-y-auto rounded-lg border border-border bg-white py-1 shadow-elevated"
        >
          {digitou && q !== "" && !exato && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setAberta(false)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-accent"
            >
              <Check className="h-3.5 w-3.5 flex-none text-muted-foreground" />
              <span className="min-w-0 truncate">Usar “{valor.trim()}”</span>
            </button>
          )}
          {grupos.map((g) => (
            <div key={g.titulo}>
              <p className="px-3 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{g.titulo}</p>
              {g.itens.map((x) => {
                i += 1;
                const idx = i;
                return (
                  <button
                    key={x}
                    type="button"
                    role="option"
                    aria-selected={idx === marcado}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setMarcado(idx)}
                    onClick={() => escolher(x)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground",
                      idx === marcado && "bg-accent",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 flex-none", normalizarFormato(x) === q ? "text-california-red" : "opacity-0")} />
                    <span className="min-w-0 truncate">{x}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <p className="mt-1 border-t border-border px-3 pb-1 pt-1.5 text-[11px] text-muted-foreground">
            A lista só sugere: qualquer texto vale.
          </p>
        </div>
      )}
    </div>
  );
}

/** O formulário do meio — o MESMO para criar e para editar. */
function FormularioDoMeio({
  titulo,
  inicial,
  meses,
  rotuloSalvar,
  iconeSalvar,
  nota,
  validar,
  pendente,
  erroDeFora,
  onSalvar,
  onCancelar,
  escRef,
}: {
  escRef?: React.MutableRefObject<(() => boolean) | null>;
  titulo: string;
  inicial: { meio: string; formato: string; mes?: string };
  /** Na Campanha: em que mês o meio entra. */
  meses?: Array<{ mes: string; nome: string }>;
  rotuloSalvar: string;
  iconeSalvar: React.ReactNode;
  /** A frase de rodapé, conforme o que está escolhido. */
  nota: (meio: string, formato: string) => React.ReactNode;
  /** Erro de regra (meio repetido), ou null. */
  validar?: (meio: string, formato: string) => string | null;
  pendente?: boolean;
  /** A recusa do servidor. */
  erroDeFora?: string | null;
  onSalvar: (meio: string, formato: string, mes?: string) => void;
  onCancelar: () => void;
}) {
  const [meio, setMeio] = React.useState(inicial.meio);
  const [formato, setFormato] = React.useState(inicial.formato);
  const [mes, setMes] = React.useState(inicial.mes ?? meses?.[0]?.mes ?? "");
  const [erro, setErro] = React.useState<string | null>(null);
  const escolhido = MEIOS.find((m) => m.nome === meio);
  const erroVisivel = erro ?? erroDeFora ?? null;

  function salvar() {
    if (pendente) return;
    if (!escolhido) {
      setErro("Escolha o meio na lista.");
      return;
    }
    const f = formato.trim() || "—";
    const problema = validar?.(escolhido.nome, f) ?? null;
    if (problema) {
      setErro(problema);
      return;
    }
    onSalvar(escolhido.nome, f, meses ? mes : undefined);
  }

  return (
    <>
      <p className="px-4 pb-1 pt-3.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{titulo}</p>
      <div className="space-y-3 px-4 pb-4 pt-1.5">
        <div className="space-y-1.5">
          <label className={LABEL}>Meio</label>
          <Select
            value={meio}
            onValueChange={(v) => {
              setMeio(v);
              setErro(null);
            }}
          >
            <SelectTrigger className={cn("h-9 w-full bg-white text-sm", erro && !escolhido && "border-california-red")}>
              <SelectValue placeholder="Escolha o meio" />
            </SelectTrigger>
            <SelectContent>
              {MEIOS.map((m) => (
                <SelectItem key={m.nome} value={m.nome}>
                  {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          {/* Só "Formato": a peça (A, B…) é de cada linha, e só na TV e no
              rádio. */}
          <label htmlFor="meio-formato" className={LABEL}>
            Formato
          </label>
          <CampoFormato
            id="meio-formato"
            meio={meio}
            valor={formato}
            onChange={(v) => {
              setFormato(v);
              setErro(null);
            }}
            onEnter={salvar}
            escRef={escRef}
          />
        </div>
        {meses && meses.length > 0 && (
          <div className="space-y-1.5">
            <label className={LABEL}>Mês</label>
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger className="h-9 w-full bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m.mes} value={m.mes}>
                    {m.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {erroVisivel && <p className="text-[12px] text-california-red">{erroVisivel}</p>}
        {!erroVisivel && <div className="text-[11.5px] leading-snug text-muted-foreground">{nota(meio, formato.trim())}</div>}
        <div className="flex justify-end gap-2 pt-0.5">
          <button
            type="button"
            onClick={onCancelar}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={pendente}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {iconeSalvar}
            {rotuloSalvar}
          </button>
        </div>
      </div>
    </>
  );
}

export function BotaoNovoMeio({
  onCriar,
  rotulo = "Novo meio",
  destino,
  compacto,
  meses,
}: {
  /** Devolve a recusa do servidor, ou null quando criou. */
  onCriar: (meio: string, formato: string, mes?: string) => Promise<string | null>;
  /** Texto do botão — "Novo meio em julho". No compacto, vira a dica do "+". */
  rotulo?: string;
  /** A frase final do pop-up: onde o meio novo aparece. */
  destino: string;
  /** Só o "+", ao lado da última aba (pedido do Tiago, 05/10/2026). */
  compacto?: boolean;
  /** Na Campanha: o pop-up pergunta o mês. */
  meses?: Array<{ mes: string; nome: string }>;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [pendente, setPendente] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const escRef = React.useRef<(() => boolean) | null>(null);
  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (!o) setErro(null);
      }}
    >
      <PopoverTrigger asChild>
        {compacto ? (
          <button
            type="button"
            title={rotulo}
            aria-label={rotulo}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white hover:text-california-red data-[state=open]:bg-white data-[state=open]:text-california-red"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" className={BOTAO_NOVO_GRUPO}>
            <Plus className="h-3.5 w-3.5" />
            {rotulo}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[360px] p-0"
        onEscapeKeyDown={(e) => {
          if (escRef.current?.()) e.preventDefault();
        }}
      >
        <FormularioDoMeio
          escRef={escRef}
          titulo={compacto ? rotulo : "Novo meio"}
          inicial={{ meio: "", formato: "" }}
          meses={meses}
          rotuloSalvar="Criar meio"
          iconeSalvar={<Plus className="h-3 w-3" />}
          pendente={pendente}
          erroDeFora={erro}
          nota={(meio) => (
            <>
              {fraseDaForma(meio)} {destino}
            </>
          )}
          onSalvar={async (meio, formato, mes) => {
            setPendente(true);
            setErro(null);
            const recusa = await onCriar(meio, formato, mes);
            setPendente(false);
            if (recusa) setErro(recusa);
            else setAberto(false);
          }}
          onCancelar={() => setAberto(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/** O lápis do título do meio (pedido do Tiago, 05/10/2026): o mesmo
 *  formulário da criação, preenchido. Trocar só o formato não apaga nada —
 *  as linhas que usavam o formato antigo acompanham. Trocar o MEIO apaga as
 *  linhas dele, em todos os meses, depois do "tem certeza". */
export interface EdicaoDoMeio {
  /** Quantas linhas o meio tem, em todos os meses, e quantas delas usam o
   *  formato do meio. */
  qtdLinhas: number;
  qtdComOFormato: number;
  /** Os meses em que o meio está ("julho", "agosto"). */
  meses: string[];
  validar: (meio: string, formato: string) => string | null;
  /** Devolve a recusa do servidor, ou null quando gravou. */
  onSalvar: (meio: string, formato: string) => Promise<string | null>;
}

export function EditarMeio({ meio: atual, edicao }: { meio: MeioDaVersao; edicao: EdicaoDoMeio }) {
  const [aberto, setAberto] = React.useState(false);
  const [pendente, setPendente] = React.useState<{ meio: string; formato: string } | null>(null);
  const [gravando, setGravando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const escRef = React.useRef<(() => boolean) | null>(null);
  const n = edicao.qtdLinhas;
  const nLinhas = `${n === 1 ? "a linha" : `as ${n} linhas`}`;
  const ondeMeses = edicao.meses.length > 1 ? ` (${juntar(edicao.meses)})` : edicao.meses[0] ? ` em ${edicao.meses[0]}` : "";
  const comFormato = edicao.qtdComOFormato;

  async function gravar(meio: string, formato: string): Promise<boolean> {
    setGravando(true);
    setErro(null);
    const recusa = await edicao.onSalvar(meio, formato);
    setGravando(false);
    if (recusa) {
      setErro(recusa);
      return false;
    }
    return true;
  }

  return (
    <>
      <Popover
        open={aberto}
        onOpenChange={(o) => {
          setAberto(o);
          if (!o) setErro(null);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Editar meio e formato"
            aria-label={`Editar ${atual.meio}`}
            className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-california-red data-[state=open]:bg-muted data-[state=open]:text-california-red"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[360px] p-0"
          onEscapeKeyDown={(e) => {
            if (escRef.current?.()) e.preventDefault();
          }}
        >
          <FormularioDoMeio
            escRef={escRef}
            titulo="Editar meio"
            inicial={{ meio: atual.meio, formato: atual.formato === "—" ? "" : atual.formato }}
            rotuloSalvar="Salvar"
            iconeSalvar={<Check className="h-3 w-3" />}
            pendente={gravando}
            erroDeFora={erro}
            validar={(meio, formato) =>
              meio === atual.meio && formato.trim().toLowerCase() === atual.formato.trim().toLowerCase()
                ? null
                : edicao.validar(meio, formato)
            }
            nota={(meio, formato) =>
              meio && meio !== atual.meio ? (
                n > 0 ? (
                  <span className="text-california-red">
                    Trocar o meio apaga {nLinhas} de {atual.meio}
                    {ondeMeses}. Você confirma no próximo passo.
                  </span>
                ) : (
                  fraseDaForma(meio)
                )
              ) : formato && formato.toLowerCase() !== atual.formato.trim().toLowerCase() && comFormato > 0 ? (
                <>
                  {comFormato === 1 ? "A linha" : `As ${comFormato} linhas`} com {atual.formato}{" "}
                  {comFormato === 1 ? "passa" : "passam"} para o formato novo; nenhuma linha é apagada.
                </>
              ) : edicao.meses.length > 1 ? (
                <>A mudança vale para o meio em todos os meses: {juntar(edicao.meses)}.</>
              ) : (
                fraseDaForma(meio)
              )
            }
            onSalvar={async (meio, formato) => {
              if (meio === atual.meio && formato === atual.formato) {
                setAberto(false);
                return;
              }
              if (meio !== atual.meio && n > 0) {
                setAberto(false);
                setPendente({ meio, formato });
                return;
              }
              if (await gravar(meio, formato)) setAberto(false);
            }}
            onCancelar={() => setAberto(false)}
          />
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={pendente !== null}
        onOpenChange={(v) => {
          if (!v) {
            setPendente(null);
            setErro(null);
          }
        }}
        title="Trocar o meio?"
        description={
          pendente && (
            <>
              <strong className="text-foreground">{atual.meio}</strong> passa a ser{" "}
              <strong className="text-foreground">{pendente.meio}</strong>
              {pendente.formato !== atual.formato && <> ({pendente.formato})</>}, e {nLinhas} de {atual.meio}
              {ondeMeses} {n === 1 ? "será apagada" : "serão apagadas"}. O meio volta com uma linha em branco
              {edicao.meses.length > 1 ? " em cada mês" : ""}. Essa ação não pode ser desfeita.
              {erro && <span className="mt-3 block text-xs text-california-red">{erro}</span>}
            </>
          )
        }
        confirmLabel={`Trocar e apagar ${n} ${n === 1 ? "linha" : "linhas"}`}
        cancelLabel="Voltar"
        variant="destructive"
        pending={gravando}
        onConfirm={async () => {
          const p = pendente;
          if (!p) return;
          if (await gravar(p.meio, p.formato)) setPendente(null);
        }}
      />
    </>
  );
}

function juntar(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
}

function Contador({ n }: { n: number }) {
  return <span className="rounded-full bg-muted px-1.5 font-mono text-[10.5px] font-semibold text-muted-foreground">{n}</span>;
}

/** A fileira de abas: "Resumo" (só na Campanha), "Todos os meios" e um meio
 *  por aba, com o "+" na ponta. */
export function AbasDosMeios({
  valor,
  onChange,
  meios,
  contagem,
  total,
  semResumo,
  rotuloNovoMeio,
  destinoNovoMeio,
  semNovoMeio,
  mesesNovoMeio,
  onCriar,
}: {
  valor: string;
  onChange: (v: string) => void;
  meios: MeioDaVersao[];
  /** Linhas por meio (a chave do meio). */
  contagem: Record<string, number>;
  total: number;
  /** Dentro do mês não há aba Resumo — o resumo mora na Campanha. */
  semResumo?: boolean;
  rotuloNovoMeio: string;
  destinoNovoMeio: string;
  /** Sem o "+" na barra (versão só leitura). */
  semNovoMeio?: boolean;
  /** Na Campanha: o "+" pergunta em que mês o meio entra. */
  mesesNovoMeio?: Array<{ mes: string; nome: string }>;
  onCriar: (meio: string, formato: string, mes?: string) => Promise<string | null>;
}) {
  // Dois meios com o mesmo nome (Rádio · Spot 30" e Rádio · Spot 15"): a
  // aba mostra o formato para separar um do outro.
  const repetidos = new Set(meios.map((s) => s.meio).filter((m, i, a) => a.indexOf(m) !== i));
  return (
    <div className="flex flex-wrap items-center gap-2.5 scroll-mt-6">
      <Tabs value={valor} onValueChange={onChange}>
        <TabsList className="h-auto flex-wrap justify-start gap-0.5">
          {!semResumo && <TabsTrigger value="resumo">Resumo</TabsTrigger>}
          {/* "Todos os meios" é a aba padrão e se destaca das outras. */}
          <TabsTrigger
            value="todos"
            className="gap-1.5 font-semibold text-foreground data-[state=inactive]:bg-white/70 data-[state=inactive]:ring-1 data-[state=inactive]:ring-border"
          >
            <Rows3 className="h-3.5 w-3.5 text-california-red" />
            Todos os meios
            <span className="rounded-full bg-california-red/10 px-1.5 font-mono text-[10.5px] font-semibold text-california-red">
              {total}
            </span>
          </TabsTrigger>
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          {meios.map((s) => (
            <TabsTrigger key={s.chave} value={s.chave} className="gap-1.5">
              {s.meio}
              {repetidos.has(s.meio) && <span className="-ml-0.5 font-normal text-muted-foreground">· {s.formato}</span>}
              <Contador n={contagem[s.chave] ?? 0} />
            </TabsTrigger>
          ))}
          {/* O "+" ao lado do último meio: o meio novo vira a aba seguinte
              e abre na hora. */}
          {!semNovoMeio && (
            <BotaoNovoMeio compacto onCriar={onCriar} rotulo={rotuloNovoMeio} destino={destinoNovoMeio} meses={mesesNovoMeio} />
          )}
        </TabsList>
      </Tabs>
    </div>
  );
}
