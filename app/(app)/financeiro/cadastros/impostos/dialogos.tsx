"use client";

/**
 * Diálogos de edição do cadastro de impostos (módulo fiscal, 02/10/2026).
 * "Editar alíquotas" segue o desenho do protótipo aprovado; os demais usam
 * o mesmo molde (rótulo pequeno, Nota explicando o efeito, Cancelar/Salvar).
 * O do CNPJ emissor também cadastra ("Novo CNPJ emissor", 03/10/2026).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, CalendarDays, Landmark, Percent, Plus, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { MaskedInput } from "@/components/ui/masked-input";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { UFS } from "@/lib/utils/formato-fiscal";
import { dataBr } from "@/lib/fiscal/datas";
import { formatarCnpj, type CadastroFiscal } from "@/lib/fiscal/cadastro";
import type {
  FiscalCnae,
  FiscalEstabelecimento,
  FiscalFeriado,
  FiscalParametro,
  RegraDeVencimentoFiscal,
  UF,
  FiscalReceitaAnterior,
} from "@/lib/types";
import {
  aliquotasPisCofins,
  cidadeDoCadastro,
  diaDoMesValido,
  formatarCodigoCnae,
  lerDiaDoMes,
  matrizDaEmpresa,
  mensagemDoDia,
  nomeSugerido,
  novoEstabelecimentoSchema,
  percentualParaCampo,
  lerPercentual,
  primeiroDiaDoMesSeguinte,
  problemaDoNovoEstabelecimento,
  raizDoCnpjFormatada,
} from "@/lib/validations/fiscal-cadastro";
import {
  atualizarEstabelecimento,
  criarCnae,
  criarEstabelecimento,
  criarFeriado,
  novaVigenciaCnae,
  novaVigenciaParametros,
  removerFeriado,
  registrarReceitaAnterior,
} from "./actions";
import type { EmpresaDoCadastro } from "./cadastro-impostos";
import { ultimaVersao, type ParametroNaTela } from "./montagem";

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------

export function Nota({ children, tom = "cinza" }: { children: React.ReactNode; tom?: "cinza" | "ambar" | "azul" }) {
  const cls = {
    cinza: "border-border bg-muted/40 text-muted-foreground",
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    azul: "border-sky-200 bg-sky-50 text-sky-900",
  }[tom];
  return <div className={cn("rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed", cls)}>{children}</div>;
}

function Rotulo({ htmlFor, children, obrigatorio }: { htmlFor?: string; children: React.ReactNode; obrigatorio?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-semibold">
      {children}
      {obrigatorio && <span className="text-california-red"> *</span>}
    </label>
  );
}

function Erro({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-california-red/30 bg-california-red/[0.05] px-3.5 py-2.5 text-[12.5px] text-california-red">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{mensagem}</span>
    </div>
  );
}

function Rodape({ pendente, onCancelar, rotulo = "Salvar" }: { pendente: boolean; onCancelar: () => void; rotulo?: string }) {
  return (
    <div className="flex justify-end gap-2 border-t border-border pt-4">
      <button
        type="button"
        onClick={onCancelar}
        disabled={pendente}
        className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={pendente}
        className="rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
      >
        {pendente ? "Salvando..." : rotulo}
      </button>
    </div>
  );
}

/** Data ISO de um Date do calendário (dia local, sem fuso). */
function isoDoDia(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Diálogo com envio por Server Action: fecha e recarrega a página no sucesso. */
function useEnvio(onClose: () => void) {
  const router = useRouter();
  const [emTransicao, startTransition] = React.useTransition();
  // Trava própria: o botão fica desligado do clique até a resposta chegar,
  // mesmo onde a transição não acompanha o `await`.
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  function enviar(acao: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    startTransition(async () => {
      try {
        const res = await acao();
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        onClose();
        router.refresh();
      } catch {
        setErro("Não foi possível salvar. Tente de novo.");
      } finally {
        setEnviando(false);
      }
    });
  }
  return { pendente: emTransicao || enviando, erro, setErro, enviar };
}

// ---------------------------------------------------------------------------
// CNPJ emissor: o mesmo formulário edita (lápis) e cadastra ("Novo CNPJ emissor")
// ---------------------------------------------------------------------------

// Os mesmos nomes da coluna "Dia não útil" da aba Vencimentos.
const REGRAS: Array<{ valor: RegraDeVencimentoFiscal; rotulo: string }> = [
  { valor: "prorroga", rotulo: "Prorroga" },
  { valor: "antecipa", rotulo: "Antecipa" },
  { valor: "ultimo_util", rotulo: "Último dia útil" },
];

const ITENS_UF = UFS.map((u) => ({ value: u, label: u }));

type Papel = "matriz" | "filial";

/**
 * Edição (`estab` preenchido): o CNPJ, a situação, o vencimento do ISS e a
 * observação; a empresa, o município e matriz/filial ficam no cabeçalho.
 * Criação (`estab` nulo): os mesmos campos, precedidos do que o cabeçalho
 * da edição mostra — a empresa contábil, matriz ou filial, o município e a
 * UF, e o nome. Cadastro e edição são o mesmo formulário.
 */
type PropsDoEstabelecimento =
  | { estab: FiscalEstabelecimento; razaoSocial: string; onClose: () => void }
  | { estab: null; empresas: readonly EmpresaDoCadastro[]; cadastro: CadastroFiscal; onClose: () => void };

export function EstabelecimentoDialog(props: PropsDoEstabelecimento) {
  const { estab, onClose } = props;
  const criacao = props.estab === null ? props : null;
  const razaoSocial = props.estab !== null ? props.razaoSocial : "";
  const { pendente, erro, setErro, enviar } = useEnvio(onClose);
  const [digitos, setDigitos] = React.useState(estab?.cnpj ?? "");
  const [ativo, setAtivo] = React.useState(estab?.ativo ?? true);
  const [regra, setRegra] = React.useState<RegraDeVencimentoFiscal>(estab?.iss_regra ?? "prorroga");
  const [observacao, setObservacao] = React.useState(estab?.observacao ?? "");
  const cnpjCompleto = digitos.length === 14;

  // Só na criação: quem é o estabelecimento.
  const [empresaId, setEmpresaId] = React.useState("");
  const [papel, setPapel] = React.useState<Papel | "">("");
  const [municipio, setMunicipio] = React.useState("");
  const [uf, setUf] = React.useState<UF | "">("");
  // O nome acompanha a sugestão (empresa · município) até a pessoa mexer nele.
  const [nome, setNome] = React.useState("");
  const [nomeEditado, setNomeEditado] = React.useState(false);

  const empresasAtivas = (criacao?.empresas ?? [])
    .filter((x) => x.ativo)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const empresa = criacao?.empresas.find((x) => x.id === empresaId) ?? null;
  const matriz = criacao && empresa ? matrizDaEmpresa(criacao.cadastro.estabelecimentos, empresa.id) : null;
  const semRegime = criacao && empresa ? !criacao.cadastro.regimes.some((r) => r.empresa_contabil_id === empresa.id) : false;
  // As cidades do cadastro (CNPJs e feriados): "salvador" entra como "Salvador".
  const cidades = criacao
    ? Array.from(
        new Set([
          ...criacao.cadastro.estabelecimentos.map((x) => x.municipio),
          ...criacao.cadastro.feriados.flatMap((f) => (f.municipio ? [f.municipio] : [])),
        ]),
      )
    : [];
  const municipioDoCadastro = cidadeDoCadastro(municipio, cidades);
  const nomeNaTela = nomeEditado ? nome : empresa ? nomeSugerido(empresa.nome, municipioDoCadastro) : "";
  const raiz = empresa ? raizDoCnpjFormatada(empresa.cnpj) : "";

  function escolherEmpresa(id: string) {
    setEmpresaId(id);
    // A primeira da PJ é a matriz; com a matriz no cadastro, o CNPJ novo é filial.
    if (criacao) setPapel(matrizDaEmpresa(criacao.cadastro.estabelecimentos, id) ? "filial" : "matriz");
  }

  function aoDigitar(d: string) {
    setDigitos(d);
    if (estab && !estab.cnpj && d.length === 14 && digitos.length !== 14) {
      // Informar o CNPJ de quem ainda não tinha já marca "Ativo" (dá para desmarcar)
      // e tira o aviso da carga inicial de que o CNPJ faltava — à vista, antes de salvar.
      setAtivo(true);
      if (observacao === (estab.observacao ?? "") && /^CNPJ da filial a informar/.test(observacao)) setObservacao("");
    }
    // CNPJ incompleto só desliga a caixa na tela (e no envio); a escolha
    // volta sozinha quando o número fica completo de novo.
  }

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const fd = new FormData(ev.currentTarget);
    const comuns = {
      cnpj: digitos,
      ativo: ativo && cnpjCompleto,
      iss_dia: fd.get("iss_dia")?.toString() ?? "",
      iss_retido_dia: fd.get("iss_retido_dia")?.toString() ?? "",
      iss_regra: regra,
      observacao,
    };
    if (estab) {
      const id = estab.id;
      enviar(() => atualizarEstabelecimento({ id, ...comuns }));
      return;
    }
    if (!criacao) return;
    const entrada = { empresa_contabil_id: empresaId, papel, municipio: municipioDoCadastro, uf, nome: nomeNaTela, ...comuns };
    // Antes de enviar, o mesmo que o servidor confere: o formato e os campos
    // obrigatórios pelo schema, e o que o cadastro exige com o que a tela tem.
    const lido = novoEstabelecimentoSchema.safeParse(entrada);
    if (!lido.success) {
      setErro(lido.error.issues[0]?.message ?? "Confira os campos.");
      return;
    }
    if (!empresa) {
      setErro("Escolha a empresa contábil.");
      return;
    }
    const problema = problemaDoNovoEstabelecimento(lido.data, empresa, criacao.cadastro.estabelecimentos);
    if (problema) {
      setErro(problema);
      return;
    }
    enviar(() => criarEstabelecimento(entrada));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-california-red" />
            {estab ? estab.nome : "Novo CNPJ emissor"}
          </DialogTitle>
          <DialogDescription>
            {estab ? (
              <>
                {razaoSocial} · {estab.municipio}-{estab.uf} · {estab.papel === "matriz" ? "Matriz" : "Filial"}
              </>
            ) : (
              "Um CNPJ por estabelecimento que emite nota: a matriz ou uma filial."
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {criacao && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Rotulo htmlFor="fiscal-estab-empresa" obrigatorio>
                    Empresa contábil
                  </Rotulo>
                  <Select value={empresaId} onValueChange={escolherEmpresa}>
                    <SelectTrigger id="fiscal-estab-empresa">
                      <SelectValue placeholder="Selecione a empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      {empresasAtivas.map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Rotulo htmlFor="fiscal-estab-papel" obrigatorio>
                    Tipo
                  </Rotulo>
                  <Select value={papel} onValueChange={(v) => setPapel(v as Papel)} disabled={!empresa}>
                    <SelectTrigger id="fiscal-estab-papel">
                      <SelectValue placeholder="Escolha a empresa antes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="matriz" disabled={matriz !== null}>
                        Matriz
                      </SelectItem>
                      <SelectItem value="filial" disabled={matriz === null}>
                        Filial
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {empresa && (
                <p className="-mt-2 text-[11.5px] text-muted-foreground">
                  {matriz
                    ? `A matriz da ${empresa.nome} é ${matriz.nome}: o CNPJ novo entra como filial, e os impostos federais seguem pela matriz.`
                    : `Primeiro CNPJ da ${empresa.nome} no cadastro: entra como matriz, e os impostos federais da empresa se apuram por ele.`}
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <Rotulo htmlFor="fiscal-estab-municipio" obrigatorio>
                    Município
                  </Rotulo>
                  <Input
                    id="fiscal-estab-municipio"
                    value={municipio}
                    onChange={(ev) => setMunicipio(ev.target.value)}
                    onBlur={() => setMunicipio(municipioDoCadastro)}
                    maxLength={80}
                    required
                    placeholder="Ex.: Recife"
                  />
                </div>
                <div className="space-y-1">
                  <Rotulo htmlFor="fiscal-estab-uf" obrigatorio>
                    UF
                  </Rotulo>
                  <Combobox
                    id="fiscal-estab-uf"
                    ariaLabel="UF"
                    items={ITENS_UF}
                    value={uf || null}
                    onChange={(v) => setUf((v ?? "") as UF | "")}
                    placeholder="Selecione"
                    buscaPlaceholder="UF"
                    className={COMBOBOX_COMO_SELECT}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Rotulo htmlFor="fiscal-estab-nome" obrigatorio>
                  Nome do estabelecimento
                </Rotulo>
                <Input
                  id="fiscal-estab-nome"
                  value={nomeNaTela}
                  onChange={(ev) => {
                    setNome(ev.target.value);
                    setNomeEditado(true);
                  }}
                  maxLength={80}
                  required
                  placeholder="Ex.: California · Recife"
                />
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-cnpj">CNPJ</Rotulo>
              <MaskedInput
                id="fiscal-cnpj"
                mask="cnpj"
                defaultValue={estab?.cnpj ?? ""}
                onDigitsChange={aoDigitar}
                autoFocus={estab !== null && !estab.cnpj}
                // Na criação, a raiz da empresa escolhida como dica do número.
                {...(raiz ? { placeholder: `${raiz}/0000-00` } : {})}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold">Situação</span>
              <label
                className={cn(
                  "flex h-11 items-center gap-2.5 rounded-lg border border-border bg-white px-3.5 text-sm",
                  !cnpjCompleto && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-california-red"
                  checked={ativo && cnpjCompleto}
                  disabled={!cnpjCompleto}
                  onChange={(ev) => setAtivo(ev.target.checked)}
                />
                Ativo
              </label>
            </div>
          </div>
          <p className="-mt-2 text-[11.5px] text-muted-foreground">
            {cnpjCompleto
              ? "Ativo aparece na lista de CNPJs do Faturar e da aprovação da PP."
              : "Sem o CNPJ completo, o estabelecimento fica inativo."}
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-iss-dia" obrigatorio>
                Dia do ISS
              </Rotulo>
              <Input id="fiscal-iss-dia" name="iss_dia" type="number" min={1} max={31} required defaultValue={estab?.iss_dia} />
            </div>
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-iss-retido-dia" obrigatorio>
                Dia do ISS retido
              </Rotulo>
              <Input id="fiscal-iss-retido-dia" name="iss_retido_dia" type="number" min={1} max={31} required defaultValue={estab?.iss_retido_dia} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold">Dia não útil</span>
              <Select value={regra} onValueChange={(v) => setRegra(v as RegraDeVencimentoFiscal)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGRAS.map((r) => (
                    <SelectItem key={r.valor} value={r.valor}>
                      {r.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Rotulo htmlFor="fiscal-obs">Observação</Rotulo>
            <Textarea
              id="fiscal-obs"
              name="observacao"
              rows={2}
              maxLength={500}
              value={observacao}
              onChange={(ev) => setObservacao(ev.target.value)}
            />
          </div>
          <Nota>
            O ISS vence no dia informado do mês seguinte à emissão da nota (o retido, à emissão da NF do fornecedor). A observação aparece na aba
            Vencimentos.
            {criacao && " Depois de cadastrar, inclua os CNAEs do CNPJ na aba CNAEs e alíquotas."}
          </Nota>
          {empresa && semRegime && (
            <Nota tom="ambar">
              A {empresa.nome} ainda não tem regime tributário no cadastro de impostos: enquanto isso, o sistema a trata como Lucro Real.
            </Nota>
          )}
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} rotulo={criacao ? "Cadastrar" : undefined} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CNAE: Editar alíquotas (com vigência) e Novo CNAE
// ---------------------------------------------------------------------------

/** Os três campos de alíquota: ISS editável; PIS e COFINS seguem a opção de crédito. */
function CamposDeAliquota({
  iss,
  setIss,
  pis,
  cofins,
}: {
  iss: string;
  setIss: (v: string) => void;
  pis: number;
  cofins: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="space-y-1">
        <Rotulo htmlFor="fiscal-iss">ISS (%)</Rotulo>
        <Input id="fiscal-iss" inputMode="decimal" value={iss} onChange={(ev) => setIss(ev.target.value)} placeholder="—" />
      </div>
      <div className="space-y-1">
        <Rotulo htmlFor="fiscal-pis">PIS (%)</Rotulo>
        <Input id="fiscal-pis" value={percentualParaCampo(pis)} readOnly tabIndex={-1} className="bg-muted/40" />
      </div>
      <div className="space-y-1">
        <Rotulo htmlFor="fiscal-cofins">COFINS (%)</Rotulo>
        <Input id="fiscal-cofins" value={percentualParaCampo(cofins)} readOnly tabIndex={-1} className="bg-muted/40" />
      </div>
    </div>
  );
}

function SelectDeCredito({
  valor,
  onChange,
  presumido,
}: {
  valor: "sim" | "nao";
  onChange: (v: "sim" | "nao") => void;
  presumido: boolean;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold">Crédito de PIS/COFINS</span>
      <Select value={valor} onValueChange={(v) => onChange(v as "sim" | "nao")} disabled={presumido}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="sim">Dá crédito sobre os custos</SelectItem>
          <SelectItem value="nao">Sem crédito (alíquota reduzida)</SelectItem>
        </SelectContent>
      </Select>
      {presumido && <p className="text-[11px] text-muted-foreground">Lucro Presumido: sempre cumulativo.</p>}
    </div>
  );
}

export function EditarCnaeDialog({
  cnae,
  estab,
  presumido,
  hoje,
  onClose,
}: {
  cnae: FiscalCnae;
  estab: FiscalEstabelecimento;
  presumido: boolean;
  hoje: string;
  onClose: () => void;
}) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  const [iss, setIss] = React.useState(percentualParaCampo(cnae.aliquota_iss));
  const [credito, setCredito] = React.useState<"sim" | "nao">(presumido || cnae.cumulativo ? "nao" : "sim");
  const sugestao = primeiroDiaDoMesSeguinte(hoje > cnae.vigencia_inicio ? hoje : cnae.vigencia_inicio);
  const [vigencia, setVigencia] = React.useState<string>(sugestao);
  const cumulativo = credito === "nao";
  const { aliquota_pis, aliquota_cofins } = aliquotasPisCofins(cumulativo, cnae);

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    enviar(() => novaVigenciaCnae({ cnae_id: cnae.id, vigencia_inicio: vigencia, aliquota_iss: iss, cumulativo }));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-california-red" />
            {cnae.codigo}
            {cnae.subitem && ` · ${cnae.subitem}`}
          </DialogTitle>
          <DialogDescription>
            {estab.nome} · {cnae.descricao}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <CamposDeAliquota iss={iss} setIss={setIss} pis={aliquota_pis} cofins={aliquota_cofins} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo obrigatorio>Vale a partir de</Rotulo>
              <DatePicker
                name="vigencia_inicio"
                defaultValue={sugestao}
                onDateChange={(d) => setVigencia(d ? isoDoDia(d) : "")}
                dateDisabled={(d) => isoDoDia(d) <= cnae.vigencia_inicio}
              />
            </div>
            <SelectDeCredito valor={credito} onChange={setCredito} presumido={presumido} />
          </div>
          <Nota>
            A alíquota nova vale para as notas emitidas a partir da data. A linha atual (desde {dataBr(cnae.vigencia_inicio)}) fica no histórico,
            com a vigência fechada no dia anterior.
          </Nota>
          {vigencia !== "" && vigencia < hoje && (
            <Nota tom="ambar">
              A data é anterior a hoje: a alíquota nova vale desde {dataBr(vigencia)}. Confira se já há nota emitida nesse período.
            </Nota>
          )}
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NovoCnaeDialog({
  estab,
  presumido,
  hoje,
  onClose,
}: {
  estab: FiscalEstabelecimento;
  presumido: boolean;
  hoje: string;
  onClose: () => void;
}) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  const [codigo, setCodigo] = React.useState("");
  const [iss, setIss] = React.useState("");
  const [credito, setCredito] = React.useState<"sim" | "nao">(presumido ? "nao" : "sim");
  const [vigencia, setVigencia] = React.useState<string>(hoje);
  const cumulativo = credito === "nao";
  const { aliquota_pis, aliquota_cofins } = aliquotasPisCofins(cumulativo);

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const fd = new FormData(ev.currentTarget);
    enviar(() =>
      criarCnae({
        estabelecimento_id: estab.id,
        codigo,
        subitem: fd.get("subitem")?.toString() ?? "",
        descricao: fd.get("descricao")?.toString() ?? "",
        aliquota_iss: iss,
        cumulativo,
        vigencia_inicio: vigencia,
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-california-red" />
            Novo CNAE
          </DialogTitle>
          <DialogDescription>
            {estab.nome}
            {estab.cnpj ? ` · ${formatarCnpj(estab.cnpj)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-cnae-codigo" obrigatorio>
                Código do CNAE
              </Rotulo>
              <Input
                id="fiscal-cnae-codigo"
                value={codigo}
                onChange={(ev) => setCodigo(formatarCodigoCnae(ev.target.value))}
                inputMode="numeric"
                placeholder="00.00-0-00"
                className="font-mono"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1">
              <Rotulo htmlFor="fiscal-cnae-subitem">Subitem da LC 116 (opcional)</Rotulo>
              <Input id="fiscal-cnae-subitem" name="subitem" placeholder="12.08" maxLength={5} className="font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <Rotulo htmlFor="fiscal-cnae-descricao" obrigatorio>
              Descrição
            </Rotulo>
            <Input id="fiscal-cnae-descricao" name="descricao" maxLength={300} required placeholder="Atividade, como no cartão do CNPJ" />
          </div>
          <CamposDeAliquota iss={iss} setIss={setIss} pis={aliquota_pis} cofins={aliquota_cofins} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo obrigatorio>Vale a partir de</Rotulo>
              <DatePicker name="vigencia_inicio" defaultValue={hoje} onDateChange={(d) => setVigencia(d ? isoDoDia(d) : "")} />
            </div>
            <SelectDeCredito valor={credito} onChange={setCredito} presumido={presumido} />
          </div>
          <Nota>
            O CNAE entra na lista do Faturar deste CNPJ a partir da data. O subitem só é preciso quando o mesmo CNAE tem alíquotas diferentes por
            item da LC 116 (como o 82.30-0-01 · 12.08 e · 17.10).
          </Nota>
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} rotulo="Cadastrar" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Feriados
// ---------------------------------------------------------------------------

const NACIONAL = "__nacional__";

export function NovoFeriadoDialog({ cidades, onClose }: { cidades: string[]; onClose: () => void }) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  const [data, setData] = React.useState("");
  const [onde, setOnde] = React.useState<string>(NACIONAL);

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const fd = new FormData(ev.currentTarget);
    enviar(() =>
      criarFeriado({
        data,
        nome: fd.get("nome")?.toString() ?? "",
        municipio: onde === NACIONAL ? null : onde,
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-california-red" />
            Novo feriado
          </DialogTitle>
          <DialogDescription>Feriado que muda o vencimento dos impostos.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo obrigatorio>Data</Rotulo>
              <DatePicker name="data" onDateChange={(d) => setData(d ? isoDoDia(d) : "")} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold">Onde vale</span>
              <Select value={onde} onValueChange={setOnde}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NACIONAL}>Nacional (expediente bancário)</SelectItem>
                  {cidades.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Rotulo htmlFor="fiscal-feriado-nome" obrigatorio>
              Nome
            </Rotulo>
            <Input id="fiscal-feriado-nome" name="nome" maxLength={120} required placeholder="Ex.: São João" />
          </div>
          <Nota>Os nacionais valem para todos os vencimentos; os da cidade, para o ISS dos CNPJs dela e para os DARFs da matriz que fica nela.</Nota>
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} rotulo="Cadastrar" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoverFeriadoDialog({ feriado, onClose }: { feriado: FiscalFeriado; onClose: () => void }) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !pendente && onClose()}
      title="Remover feriado?"
      description={
        <>
          {dataBr(feriado.data)} · {feriado.nome} ({feriado.municipio ?? "nacional"}). Os vencimentos deixam de contar este dia como não útil.
          {erro && <span className="mt-2 block font-semibold text-california-red">{erro}</span>}
        </>
      }
      confirmLabel="Remover"
      variant="destructive"
      pending={pendente}
      onConfirm={() => enviar(() => removerFeriado({ id: feriado.id }))}
    />
  );
}

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

export function ParametroDialog({
  item,
  parametros,
  hoje,
  onClose,
  nota,
  diaNaoUtil,
}: {
  item: ParametroNaTela;
  parametros: FiscalParametro[];
  hoje: string;
  onClose: () => void;
  /** Nota no lugar da geral (os dias dos federais dizem para quem o dia vale). */
  nota?: React.ReactNode;
  /** A regra de dia não útil, só mostrada: nos federais, antecipa pela lei. */
  diaNaoUtil?: string;
}) {
  const { pendente, erro, setErro, enviar } = useEnvio(onClose);
  const ultimas = item.linha.campos.map((c) => ultimaVersao(parametros, c.chave));
  const maisRecente = ultimas.reduce((m, u) => (u && u.vigencia_inicio > m ? u.vigencia_inicio : m), "");
  const sugestao = primeiroDiaDoMesSeguinte(hoje > maisRecente ? hoje : maisRecente);
  const [vigencia, setVigencia] = React.useState(sugestao);
  const [valores, setValores] = React.useState<Record<string, string | number>>(() => {
    const v: Record<string, string | number> = {};
    item.linha.campos.forEach((c, i) => {
      const valor = ultimas[i]?.valor ?? 0;
      v[c.chave] = c.formato === "pct" ? percentualParaCampo(valor) : c.formato === "dia" ? String(valor) : valor;
    });
    return v;
  });
  const colunas = item.linha.campos.length + (diaNaoUtil ? 1 : 0);

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const lidos: { chave: string; valor: number }[] = [];
    for (const c of item.linha.campos) {
      const bruto = valores[c.chave];
      if (c.formato === "dia") {
        const d = lerDiaDoMes(bruto);
        if (!diaDoMesValido(d)) {
          setErro(mensagemDoDia(c.rotulo));
          return;
        }
        lidos.push({ chave: c.chave, valor: d });
        continue;
      }
      const n = c.formato === "pct" ? lerPercentual(bruto) : Number(bruto);
      if (n === null || Number.isNaN(n)) {
        setErro(`${c.rotulo}: use só números, como 1,5.`);
        return;
      }
      lidos.push({ chave: c.chave, valor: n });
    }
    enviar(() => novaVigenciaParametros({ vigencia_inicio: vigencia, valores: lidos }));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-california-red" />
            {item.linha.rotulo}
          </DialogTitle>
          <DialogDescription>Hoje: {item.linha.valor(item.hoje)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className={cn("grid gap-3", colunas >= 3 ? "grid-cols-3" : "grid-cols-2")}>
            {item.linha.campos.map((c) => (
              <div key={c.chave} className="space-y-1">
                <Rotulo htmlFor={`fiscal-par-${c.chave}`} obrigatorio>
                  {c.rotulo}
                </Rotulo>
                {c.formato === "pct" ? (
                  <Input
                    id={`fiscal-par-${c.chave}`}
                    inputMode="decimal"
                    value={String(valores[c.chave] ?? "")}
                    onChange={(ev) => setValores((v) => ({ ...v, [c.chave]: ev.target.value }))}
                  />
                ) : c.formato === "dia" ? (
                  <Input
                    id={`fiscal-par-${c.chave}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    step={1}
                    required
                    value={String(valores[c.chave] ?? "")}
                    onChange={(ev) => setValores((v) => ({ ...v, [c.chave]: ev.target.value }))}
                  />
                ) : (
                  <MoneyInput
                    id={`fiscal-par-${c.chave}`}
                    value={Number(valores[c.chave] ?? 0)}
                    onValueChange={(n) => setValores((v) => ({ ...v, [c.chave]: n }))}
                  />
                )}
              </div>
            ))}
            {diaNaoUtil && (
              <div className="space-y-1">
                <Rotulo htmlFor="fiscal-par-dia-nao-util">Dia não útil</Rotulo>
                <Input id="fiscal-par-dia-nao-util" value={diaNaoUtil} readOnly tabIndex={-1} className="bg-muted/40" />
                <p className="text-[11px] text-muted-foreground">Regra da lei para os federais; não muda.</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Rotulo obrigatorio>Vale a partir de</Rotulo>
              <DatePicker
                name="vigencia_inicio"
                defaultValue={sugestao}
                onDateChange={(d) => setVigencia(d ? isoDoDia(d) : "")}
                dateDisabled={(d) => isoDoDia(d) <= maisRecente}
              />
            </div>
          </div>
          <Nota>
            {nota ??
              "O valor novo vale a partir da data; o atual fica no histórico. As apurações de antes da data continuam com o valor da época."}
          </Nota>
          {vigencia !== "" && vigencia < hoje && (
            <Nota tom="ambar">A data é anterior a hoje: o valor novo vale desde {dataBr(vigencia)}.</Nota>
          )}
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// LC 224/2025: a receita recebida antes da Apuração (decisão 145, item 7)
// ---------------------------------------------------------------------------

export function ReceitaAnteriorDialog({
  empresa,
  trimestre,
  atual,
  onClose,
}: {
  empresa: { id: string; nome: string };
  /** "2026-T2". */
  trimestre: string;
  atual: FiscalReceitaAnterior | null;
  onClose: () => void;
}) {
  const { pendente, erro, enviar } = useEnvio(onClose);
  const [valor, setValor] = React.useState<number>(atual?.receita_bruta ?? 0);
  const [ano, numero] = trimestre.split("-T");

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    const fd = new FormData(ev.currentTarget);
    enviar(() =>
      registrarReceitaAnterior({
        empresa_contabil_id: empresa.id,
        trimestre,
        receita_bruta: valor,
        observacao: fd.get("observacao")?.toString().trim() || null,
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-california-red" />
            Receita do {numero}º trimestre de {ano}
          </DialogTitle>
          <DialogDescription>
            {empresa.nome}: a receita bruta recebida no trimestre, antes de a Apuração começar no sistema. Ela entra na
            sobra de limite e no ajuste do ano da LC 224/2025.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Rotulo obrigatorio>Receita bruta recebida no trimestre</Rotulo>
            <MoneyInput value={valor} onValueChange={setValor} aria-label="Receita bruta recebida no trimestre" />
          </div>
          <div className="space-y-1">
            <Rotulo htmlFor="fiscal-receita-anterior-obs">Observação</Rotulo>
            <Textarea
              id="fiscal-receita-anterior-obs"
              name="observacao"
              rows={2}
              maxLength={500}
              defaultValue={atual?.observacao ?? ""}
              placeholder="Ex.: conforme o livro Caixa enviado pela contabilidade."
            />
          </div>
          <Nota>
            Só a receita que vai à presunção (os serviços). Receitas financeiras e ganhos de capital não entram no limite.
          </Nota>
          <Erro mensagem={erro} />
          <Rodape pendente={pendente} onCancelar={onClose} rotulo={atual ? "Salvar" : "Registrar"} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

