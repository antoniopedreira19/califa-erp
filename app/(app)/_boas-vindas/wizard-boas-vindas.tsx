"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ColaboradorDocumento,
  ColaboradorDocumentoTipo,
  TipoContratacao,
} from "@/lib/types";
import {
  colaboradorDocumentoTipoLabel,
  estadoCivilLabel,
  etniaLabel,
  generoIdentidadeLabel,
  orientacaoSexualLabel,
  pcdOpcaoLabel,
  pjNaturezaLabel,
  tamanhoCamisetaLabel,
} from "@/lib/types";
import { documentosObrigatorios } from "@/lib/perfil/documentos-obrigatorios";
import { uploadDocumentoDoMeuPerfil } from "@/lib/perfil/upload-documento-cliente";
import {
  completarMeuPerfil,
  removerDocumentoDoMeuPerfil,
  salvarRascunhoDoMeuPerfil,
  type MeuPerfilPayload,
} from "./actions";

// ---- shape do form ---------------------------------------------------

type FormState = {
  nome_preferido: string;
  cidade_origem: string;
  data_nascimento: string;
  estado_civil: string;
  possui_filhos: "" | "true" | "false";
  tamanho_camiseta: string;
  telefone: string;
  email_pessoal: string;
  rg: string;
  cpf: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cnpj: string;
  razao_social: string;
  pj_natureza: string;
  banco_codigo: string;
  banco_nome: string;
  agencia: string;
  agencia_dv: string;
  conta: string;
  conta_dv: string;
  tipo_conta: string;
  pix_tipo: string;
  pix_chave: string;
  vegetariano: "" | "true" | "false";
  restricao_alimentar: string;
  etnia: string;
  genero_identidade: string;
  orientacao_sexual: string;
  pcd: string;
  pcd_descricao: string;
  observacao_saude: string;
  emergencia_nome: string;
  emergencia_parentesco: string;
  emergencia_telefone: string;
  hobbies: string;
  curiosidade: string;
  foto_path: string;
};

function toStr(v: unknown): string {
  return v == null ? "" : String(v);
}

function stateInicial(payload: MeuPerfilPayload): FormState {
  const c = payload.colaborador;
  return {
    nome_preferido: toStr(c.nome_preferido),
    cidade_origem: toStr(c.cidade_origem),
    data_nascimento: toStr(c.data_nascimento),
    estado_civil: toStr(c.estado_civil),
    possui_filhos:
      c.possui_filhos === null || c.possui_filhos === undefined
        ? ""
        : c.possui_filhos
          ? "true"
          : "false",
    tamanho_camiseta: toStr(c.tamanho_camiseta),
    telefone: toStr(c.telefone),
    email_pessoal: toStr(c.email_pessoal),
    rg: toStr(c.rg),
    cpf: toStr(c.cpf),
    cep: toStr(c.cep),
    logradouro: toStr(c.logradouro),
    numero: toStr(c.numero),
    complemento: toStr(c.complemento),
    bairro: toStr(c.bairro),
    cidade: toStr(c.cidade),
    uf: toStr(c.uf),
    cnpj: toStr(c.cnpj),
    razao_social: toStr(c.razao_social),
    pj_natureza: toStr(c.pj_natureza),
    banco_codigo: toStr(c.banco_codigo),
    banco_nome: toStr(c.banco_nome),
    agencia: toStr(c.agencia),
    agencia_dv: toStr(c.agencia_dv),
    conta: toStr(c.conta),
    conta_dv: toStr(c.conta_dv),
    tipo_conta: toStr(c.tipo_conta),
    pix_tipo: toStr(c.pix_tipo),
    pix_chave: toStr(c.pix_chave),
    vegetariano:
      c.vegetariano === null || c.vegetariano === undefined
        ? ""
        : c.vegetariano
          ? "true"
          : "false",
    restricao_alimentar: toStr(c.restricao_alimentar),
    etnia: toStr(c.etnia),
    genero_identidade: toStr(c.genero_identidade),
    orientacao_sexual: toStr(c.orientacao_sexual),
    pcd: toStr(c.pcd),
    pcd_descricao: toStr(c.pcd_descricao),
    observacao_saude: toStr(c.observacao_saude),
    emergencia_nome: toStr(c.emergencia_nome),
    emergencia_parentesco: toStr(c.emergencia_parentesco),
    emergencia_telefone: toStr(c.emergencia_telefone),
    hobbies: toStr(c.hobbies),
    curiosidade: toStr(c.curiosidade),
    foto_path: toStr(c.foto_path),
  };
}

/** Converte o FormState pro payload JSON da RPC. */
function paraPayload(
  s: FormState,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...extra };
  for (const [k, v] of Object.entries(s)) {
    if (v === "") {
      out[k] = null;
    } else if (k === "possui_filhos" || k === "vegetariano") {
      out[k] = v === "true";
    } else {
      out[k] = v;
    }
  }
  return out;
}

const PASSO_TOTAL = 7;

const PASSO_LABEL: Record<number, string> = {
  1: "Como gosta de ser chamado(a)",
  2: "Dados pessoais",
  3: "Documentos e contato",
  4: "Dados profissionais",
  5: "Bancário e Pix",
  6: "Diversidade e saúde",
  7: "Um pouco sobre você",
};

// ---- Componente principal --------------------------------------------

type Props = {
  payload: MeuPerfilPayload;
  onCompletado: () => void;
  onFecharSemCompletar: () => void;
  /** Em modo edição (perfil já completo), o botão final é "Salvar" e
   *  grava sem reexecutar a validação de "perfil completo". Pra entrar
   *  aqui, a pessoa clicou em "Editar meus dados" no perfil. */
  modoEdicao?: boolean;
};

export function WizardBoasVindas({
  payload,
  onCompletado,
  onFecharSemCompletar,
  modoEdicao = false,
}: Props) {
  const colab = payload.colaborador;
  const [passo, setPasso] = React.useState(1);
  const [dados, setDados] = React.useState<FormState>(() =>
    stateInicial(payload),
  );
  const [documentos, setDocumentos] = React.useState<ColaboradorDocumento[]>(
    payload.documentos,
  );
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pendentes, setPendentes] = React.useState<{
    campos: string[];
    documentos: ColaboradorDocumentoTipo[];
  } | null>(null);

  function atualizar<K extends keyof FormState>(campo: K, valor: FormState[K]) {
    setDados((prev) => ({ ...prev, [campo]: valor }));
  }

  async function avancar() {
    setErro(null);
    setSalvando(true);
    const res = await salvarRascunhoDoMeuPerfil(paraPayload(dados));
    setSalvando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    if (passo < PASSO_TOTAL) {
      setPasso(passo + 1);
    }
  }

  async function enviar() {
    setErro(null);
    setPendentes(null);
    setSalvando(true);
    // Salva o passo atual.
    const s = await salvarRascunhoDoMeuPerfil(paraPayload(dados));
    if (!s.ok) {
      setErro(s.message);
      setSalvando(false);
      return;
    }
    // Em modo edição (perfil já completo), não precisa chamar completar.
    if (modoEdicao) {
      setSalvando(false);
      onCompletado();
      return;
    }
    // Completa.
    const r = await completarMeuPerfil();
    setSalvando(false);
    if (!r.ok) {
      if (r.camposPendentes || r.documentosPendentes) {
        setPendentes({
          campos: r.camposPendentes ?? [],
          documentos: r.documentosPendentes ?? [],
        });
        setErro(r.message);
        return;
      }
      setErro(r.message);
      return;
    }
    onCompletado();
  }

  function voltar() {
    if (passo > 1) setPasso(passo - 1);
  }

  async function uploadDoc(tipo: ColaboradorDocumentoTipo, file: File) {
    setErro(null);
    const r = await uploadDocumentoDoMeuPerfil({
      tenant_id: colab.tenant_id,
      colaborador_id: colab.id,
      tipo,
      arquivo: file,
    });
    if (!r.ok) {
      setErro(r.message ?? "Falha no upload.");
      return;
    }
    // Monta a linha otimista (o server já inseriu).
    if (r.id && r.path) {
      const novo: ColaboradorDocumento = {
        id: r.id,
        tenant_id: colab.tenant_id,
        colaborador_id: colab.id,
        tipo,
        arquivo_path: r.path,
        arquivo_nome: file.name,
        arquivo_tamanho_bytes: file.size,
        mime_type: file.type,
        uploaded_by: null,
        uploaded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setDocumentos((prev) => [novo, ...prev]);
    }
    // Se é a foto, grava no state local pra ir no próximo rascunho.
    if (tipo === "foto" && r.path) {
      atualizar("foto_path", r.path);
    }
  }

  async function removerDoc(id: string) {
    setErro(null);
    const r = await removerDocumentoDoMeuPerfil(id);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    setDocumentos((prev) => prev.filter((d) => d.id !== id));
  }

  const ehUltimo = passo === PASSO_TOTAL;

  return (
    <div className="flex flex-col">
      {/* Progress ------------------------------------------------- */}
      <div className="px-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>
            Passo {passo} de {PASSO_TOTAL} — {PASSO_LABEL[passo]}
          </span>
          <span>{Math.round((passo / PASSO_TOTAL) * 100)}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-california-red transition-all"
            style={{ width: `${(passo / PASSO_TOTAL) * 100}%` }}
          />
        </div>
      </div>

      {/* Corpo ---------------------------------------------------- */}
      <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
        {passo === 1 && (
          <Passo1Apresentacao
            dados={dados}
            atualizar={atualizar}
            documentos={documentos}
            uploadDoc={uploadDoc}
            removerDoc={removerDoc}
          />
        )}
        {passo === 2 && (
          <Passo2Pessoais dados={dados} atualizar={atualizar} />
        )}
        {passo === 3 && (
          <Passo3DocsContato
            dados={dados}
            atualizar={atualizar}
            documentos={documentos}
            uploadDoc={uploadDoc}
            removerDoc={removerDoc}
          />
        )}
        {passo === 4 && (
          <Passo4Profissional
            tipo={colab.tipo_contratacao}
            dados={dados}
            atualizar={atualizar}
            documentos={documentos}
            uploadDoc={uploadDoc}
            removerDoc={removerDoc}
          />
        )}
        {passo === 5 && (
          <Passo5Bancario dados={dados} atualizar={atualizar} />
        )}
        {passo === 6 && (
          <Passo6Diversidade dados={dados} atualizar={atualizar} />
        )}
        {passo === 7 && (
          <Passo7Sobre
            dados={dados}
            atualizar={atualizar}
            pendentes={pendentes}
          />
        )}

        {erro && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{erro}</span>
          </div>
        )}
      </div>

      {/* Footer --------------------------------------------------- */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-3 bg-muted/20">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onFecharSemCompletar}
          disabled={salvando}
        >
          Agora não
        </Button>
        <div className="flex gap-2">
          {passo > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={voltar}
              disabled={salvando}
            >
              Voltar
            </Button>
          )}
          {ehUltimo ? (
            <Button
              type="button"
              size="sm"
              onClick={enviar}
              disabled={salvando}
            >
              {salvando && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              {modoEdicao ? "Salvar" : "Enviar"}
              <CheckCircle2 className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={avancar}
              disabled={salvando}
            >
              {salvando && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Avançar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Passos ----------------------------------------------------------

type PassoProps = {
  dados: FormState;
  atualizar: <K extends keyof FormState>(c: K, v: FormState[K]) => void;
};

type PassoDocProps = PassoProps & {
  documentos: ColaboradorDocumento[];
  uploadDoc: (tipo: ColaboradorDocumentoTipo, file: File) => Promise<void>;
  removerDoc: (id: string) => Promise<void>;
};

function Passo1Apresentacao({
  dados,
  atualizar,
  documentos,
  uploadDoc,
  removerDoc,
}: PassoDocProps) {
  return (
    <div className="space-y-4">
      <Campo label="Como gosta de ser chamado(a)?">
        <Input
          value={dados.nome_preferido}
          onChange={(e) => atualizar("nome_preferido", e.target.value)}
          placeholder="Apelido ou nome social"
          maxLength={120}
        />
      </Campo>
      <Campo
        label="Foto do perfil (opcional)"
        descricao="Uma foto sua de rosto. Fica no seu perfil interno."
      >
        <UploadFolder
          tipo="foto"
          documentos={documentos}
          uploadDoc={uploadDoc}
          removerDoc={removerDoc}
        />
      </Campo>
    </div>
  );
}

function Passo2Pessoais({ dados, atualizar }: PassoProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Campo label="Data de nascimento">
        <Input
          type="date"
          value={dados.data_nascimento}
          onChange={(e) => atualizar("data_nascimento", e.target.value)}
        />
      </Campo>
      <Campo label="Cidade de origem">
        <Input
          value={dados.cidade_origem}
          onChange={(e) => atualizar("cidade_origem", e.target.value)}
          placeholder="De onde você é?"
        />
      </Campo>
      <Campo label="Estado civil">
        <SelectEnum
          valor={dados.estado_civil}
          onChange={(v) => atualizar("estado_civil", v)}
          opcoes={
            [
              "solteiro",
              "casado",
              "uniao_estavel",
              "divorciado",
              "viuvo",
              "separado",
            ] as const
          }
          label={(o) => estadoCivilLabel(o as any)}
        />
      </Campo>
      <Campo label="Tem filhos?">
        <SelectEnum
          valor={dados.possui_filhos}
          onChange={(v) => atualizar("possui_filhos", v as any)}
          opcoes={["true", "false"] as const}
          label={(o) => (o === "true" ? "Sim" : "Não")}
        />
      </Campo>
      <Campo label="Tamanho de camiseta">
        <SelectEnum
          valor={dados.tamanho_camiseta}
          onChange={(v) => atualizar("tamanho_camiseta", v)}
          opcoes={["pp", "p", "m", "g", "gg", "xg", "xxg"] as const}
          label={(o) => tamanhoCamisetaLabel(o as any)}
        />
      </Campo>
    </div>
  );
}

function Passo3DocsContato({
  dados,
  atualizar,
  documentos,
  uploadDoc,
  removerDoc,
}: PassoDocProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Telefone com DDD">
          <Input
            value={dados.telefone}
            onChange={(e) => atualizar("telefone", e.target.value)}
            placeholder="(11) 99999-9999"
          />
        </Campo>
        <Campo label="Email pessoal (opcional)">
          <Input
            type="email"
            value={dados.email_pessoal}
            onChange={(e) => atualizar("email_pessoal", e.target.value)}
            placeholder="voce@provedor.com"
          />
        </Campo>
        <Campo label="CPF">
          <Input
            value={dados.cpf}
            onChange={(e) => atualizar("cpf", e.target.value)}
            placeholder="000.000.000-00"
          />
        </Campo>
        <Campo label="RG">
          <Input
            value={dados.rg}
            onChange={(e) => atualizar("rg", e.target.value)}
          />
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <Campo label="CEP">
            <Input
              value={dados.cep}
              onChange={(e) => atualizar("cep", e.target.value)}
              placeholder="00000-000"
            />
          </Campo>
        </div>
        <div className="sm:col-span-4">
          <Campo label="Logradouro">
            <Input
              value={dados.logradouro}
              onChange={(e) => atualizar("logradouro", e.target.value)}
            />
          </Campo>
        </div>
        <div className="sm:col-span-1">
          <Campo label="Número">
            <Input
              value={dados.numero}
              onChange={(e) => atualizar("numero", e.target.value)}
            />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo label="Complemento">
            <Input
              value={dados.complemento}
              onChange={(e) => atualizar("complemento", e.target.value)}
            />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo label="Bairro">
            <Input
              value={dados.bairro}
              onChange={(e) => atualizar("bairro", e.target.value)}
            />
          </Campo>
        </div>
        <div className="sm:col-span-1">
          <Campo label="UF">
            <Input
              value={dados.uf}
              onChange={(e) => atualizar("uf", e.target.value.toUpperCase())}
              maxLength={2}
            />
          </Campo>
        </div>
        <div className="sm:col-span-5">
          <Campo label="Cidade">
            <Input
              value={dados.cidade}
              onChange={(e) => atualizar("cidade", e.target.value)}
            />
          </Campo>
        </div>
      </div>

      <Campo
        label="Anexo: documento de identificação (RG, CNH ou CPF)"
        descricao="Basta um deles. PDF, JPG, PNG ou HEIC — até 10 MB. Frente e verso podem ir em arquivos separados."
      >
        <UploadFolder
          tipo="rg_cnh"
          documentos={documentos}
          uploadDoc={uploadDoc}
          removerDoc={removerDoc}
        />
      </Campo>
    </div>
  );
}

function Passo4Profissional({
  tipo,
  dados,
  atualizar,
  documentos,
  uploadDoc,
  removerDoc,
}: PassoDocProps & { tipo: TipoContratacao }) {
  const obrigs = documentosObrigatorios(tipo);
  const ehPjLike = tipo === "pj" || tipo === "mei" || tipo === "clt_recibo";
  const ehClt = tipo === "clt" || tipo === "clt_recibo";
  const ehEstagio = tipo === "estagio";

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Documentos obrigatórios pro seu tipo de contratação (
        <span className="font-medium">{tipo.toUpperCase()}</span>
        ):{" "}
        {obrigs.map((t) => colaboradorDocumentoTipoLabel(t)).join(", ") ||
          "nenhum"}
        .
      </div>

      {ehPjLike && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="CNPJ">
            <Input
              value={dados.cnpj}
              onChange={(e) => atualizar("cnpj", e.target.value)}
              placeholder="00.000.000/0000-00"
            />
          </Campo>
          <Campo label="Razão social">
            <Input
              value={dados.razao_social}
              onChange={(e) => atualizar("razao_social", e.target.value)}
            />
          </Campo>
          <Campo label="Natureza jurídica">
            <SelectEnum
              valor={dados.pj_natureza}
              onChange={(v) => atualizar("pj_natureza", v)}
              opcoes={["mei", "me", "ltda", "eireli", "slu"] as const}
              label={(o) => pjNaturezaLabel(o as any)}
            />
          </Campo>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {obrigs.includes("cnpj") && (
          <Campo label="Anexo: Cartão CNPJ">
            <UploadFolder
              tipo="cnpj"
              documentos={documentos}
              uploadDoc={uploadDoc}
              removerDoc={removerDoc}
            />
          </Campo>
        )}
        {obrigs.includes("ccmei") && (
          <Campo label="Anexo: CCMEI">
            <UploadFolder
              tipo="ccmei"
              documentos={documentos}
              uploadDoc={uploadDoc}
              removerDoc={removerDoc}
            />
          </Campo>
        )}
        {(ehClt || ehEstagio) && (
          <>
            <Campo label="Anexo: Comprovante de residência" descricao="Emitido nos últimos 90 dias.">
              <UploadFolder
                tipo="comprovante_residencia"
                documentos={documentos}
                uploadDoc={uploadDoc}
                removerDoc={removerDoc}
              />
            </Campo>
            <Campo label="Anexo: Carteira de Trabalho (CTPS)">
              <UploadFolder
                tipo="ctps"
                documentos={documentos}
                uploadDoc={uploadDoc}
                removerDoc={removerDoc}
              />
            </Campo>
          </>
        )}
        {ehClt && (
          <>
            <Campo label="Anexo: PIS">
              <UploadFolder
                tipo="pis"
                documentos={documentos}
                uploadDoc={uploadDoc}
                removerDoc={removerDoc}
              />
            </Campo>
            <Campo label="Anexo: Título de eleitor">
              <UploadFolder
                tipo="titulo_eleitor"
                documentos={documentos}
                uploadDoc={uploadDoc}
                removerDoc={removerDoc}
              />
            </Campo>
          </>
        )}
      </div>
    </div>
  );
}

function Passo5Bancario({ dados, atualizar }: PassoProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <Campo label="Código do banco">
            <Input
              value={dados.banco_codigo}
              onChange={(e) => atualizar("banco_codigo", e.target.value)}
              onBlur={(e) => {
                // Normaliza pra 3 dígitos: "0260" -> "260", "1" -> "001".
                // A constraint `colaboradores_banco_formato` exige ^[0-9]{3}$.
                const so_digitos = e.target.value.replace(/\D/g, "");
                if (!so_digitos) return;
                const normalizado =
                  so_digitos.length > 3
                    ? so_digitos.slice(-3)
                    : so_digitos.padStart(3, "0");
                if (normalizado !== dados.banco_codigo) {
                  atualizar("banco_codigo", normalizado);
                }
              }}
              placeholder="260"
              maxLength={4}
            />
          </Campo>
        </div>
        <div className="sm:col-span-4">
          <Campo label="Nome do banco">
            <Input
              value={dados.banco_nome}
              onChange={(e) => atualizar("banco_nome", e.target.value)}
              placeholder="Banco do Brasil"
            />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo label="Agência">
            <Input
              value={dados.agencia}
              onChange={(e) => atualizar("agencia", e.target.value)}
            />
          </Campo>
        </div>
        <div className="sm:col-span-1">
          <Campo label="DV ag.">
            <Input
              value={dados.agencia_dv}
              onChange={(e) => atualizar("agencia_dv", e.target.value)}
              maxLength={1}
              placeholder="—"
            />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo label="Conta">
            <Input
              value={dados.conta}
              onChange={(e) => atualizar("conta", e.target.value)}
            />
          </Campo>
        </div>
        <div className="sm:col-span-1">
          <Campo label="DV conta">
            <Input
              value={dados.conta_dv}
              onChange={(e) => atualizar("conta_dv", e.target.value)}
              maxLength={1}
            />
          </Campo>
        </div>
        <div className="sm:col-span-3">
          <Campo label="Tipo de conta">
            <SelectEnum
              valor={dados.tipo_conta}
              onChange={(v) => atualizar("tipo_conta", v)}
              opcoes={["corrente", "poupanca", "pagamento"] as const}
              label={(o) =>
                o === "corrente"
                  ? "Corrente"
                  : o === "poupanca"
                    ? "Poupança"
                    : "Pagamento"
              }
            />
          </Campo>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <Campo label="Tipo de chave Pix">
            <SelectEnum
              valor={dados.pix_tipo}
              onChange={(v) => atualizar("pix_tipo", v)}
              opcoes={
                ["cpf", "cnpj", "email", "telefone", "aleatoria"] as const
              }
              label={(o) =>
                o === "cpf"
                  ? "CPF"
                  : o === "cnpj"
                    ? "CNPJ"
                    : o === "email"
                      ? "Email"
                      : o === "telefone"
                        ? "Telefone"
                        : "Chave aleatória"
              }
            />
          </Campo>
        </div>
        <div className="sm:col-span-4">
          <Campo label="Chave Pix">
            <Input
              value={dados.pix_chave}
              onChange={(e) => atualizar("pix_chave", e.target.value)}
            />
          </Campo>
        </div>
      </div>
    </div>
  );
}

function Passo6Diversidade({ dados, atualizar }: PassoProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Essas informações ajudam a California a construir uma empresa mais
        acolhedora. Só o RH e o administrador têm acesso. Se preferir não
        dizer, escolha &ldquo;Prefiro não informar&rdquo;.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Como se declara (etnia)">
          <SelectEnum
            valor={dados.etnia}
            onChange={(v) => atualizar("etnia", v)}
            opcoes={
              [
                "branca",
                "preta",
                "parda",
                "amarela",
                "indigena",
                "prefiro_nao_informar",
              ] as const
            }
            label={(o) => etniaLabel(o as any)}
          />
        </Campo>
        <Campo label="Identidade de gênero">
          <SelectEnum
            valor={dados.genero_identidade}
            onChange={(v) => atualizar("genero_identidade", v)}
            opcoes={
              [
                "mulher_cis",
                "mulher_trans",
                "homem_cis",
                "homem_trans",
                "nao_binario",
                "outro",
                "prefiro_nao_informar",
              ] as const
            }
            label={(o) => generoIdentidadeLabel(o as any)}
          />
        </Campo>
        <Campo label="Orientação sexual/afetiva">
          <SelectEnum
            valor={dados.orientacao_sexual}
            onChange={(v) => atualizar("orientacao_sexual", v)}
            opcoes={
              [
                "heterossexual",
                "homossexual",
                "bissexual",
                "assexual",
                "pansexual",
                "outro",
                "prefiro_nao_informar",
              ] as const
            }
            label={(o) => orientacaoSexualLabel(o as any)}
          />
        </Campo>
        <Campo label="Pessoa com deficiência (PCD)">
          <SelectEnum
            valor={dados.pcd}
            onChange={(v) => atualizar("pcd", v)}
            opcoes={["nao", "sim", "prefiro_nao_informar"] as const}
            label={(o) => pcdOpcaoLabel(o as any)}
          />
        </Campo>
      </div>

      {dados.pcd === "sim" && (
        <Campo label="Qual deficiência?">
          <Textarea
            value={dados.pcd_descricao}
            onChange={(e) => atualizar("pcd_descricao", e.target.value)}
            maxLength={500}
            rows={2}
          />
        </Campo>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Você é vegetariano(a)?">
          <SelectEnum
            valor={dados.vegetariano}
            onChange={(v) => atualizar("vegetariano", v as any)}
            opcoes={["true", "false"] as const}
            label={(o) => (o === "true" ? "Sim" : "Não")}
          />
        </Campo>
        <Campo label="Restrição alimentar (opcional)">
          <Input
            value={dados.restricao_alimentar}
            onChange={(e) => atualizar("restricao_alimentar", e.target.value)}
            placeholder="Alergia a frutos do mar, por exemplo"
          />
        </Campo>
      </div>

      <Campo label="Observações de saúde (opcional)">
        <Textarea
          value={dados.observacao_saude}
          onChange={(e) => atualizar("observacao_saude", e.target.value)}
          rows={2}
          placeholder="Algo que a gente precise saber?"
        />
      </Campo>
    </div>
  );
}

function Passo7Sobre({
  dados,
  atualizar,
  pendentes,
}: PassoProps & {
  pendentes: {
    campos: string[];
    documentos: ColaboradorDocumentoTipo[];
  } | null;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo label="Nome do contato de emergência">
          <Input
            value={dados.emergencia_nome}
            onChange={(e) => atualizar("emergencia_nome", e.target.value)}
          />
        </Campo>
        <Campo label="Parentesco">
          <Input
            value={dados.emergencia_parentesco}
            onChange={(e) =>
              atualizar("emergencia_parentesco", e.target.value)
            }
            placeholder="Mãe, pai, irmão..."
          />
        </Campo>
        <Campo label="Telefone">
          <Input
            value={dados.emergencia_telefone}
            onChange={(e) => atualizar("emergencia_telefone", e.target.value)}
            placeholder="(11) 99999-9999"
          />
        </Campo>
      </div>

      <Campo label="O que você gosta de fazer nas horas vagas?">
        <Textarea
          value={dados.hobbies}
          onChange={(e) => atualizar("hobbies", e.target.value)}
          rows={2}
        />
      </Campo>
      <Campo label="Nos conte uma curiosidade sua">
        <Textarea
          value={dados.curiosidade}
          onChange={(e) => atualizar("curiosidade", e.target.value)}
          rows={2}
        />
      </Campo>

      {pendentes &&
        (pendentes.campos.length > 0 || pendentes.documentos.length > 0) && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <p className="font-medium mb-1">Ainda falta:</p>
            {pendentes.campos.length > 0 && (
              <p>Campos: {pendentes.campos.join(", ")}</p>
            )}
            {pendentes.documentos.length > 0 && (
              <p>
                Anexos:{" "}
                {pendentes.documentos
                  .map((t) => colaboradorDocumentoTipoLabel(t))
                  .join(", ")}
              </p>
            )}
          </div>
        )}
    </div>
  );
}

// ---- helpers visuais --------------------------------------------------

function Campo({
  label,
  descricao,
  children,
}: {
  label: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      {children}
      {descricao && (
        <p className="text-[11px] text-muted-foreground">{descricao}</p>
      )}
    </div>
  );
}

function SelectEnum<T extends string>({
  valor,
  onChange,
  opcoes,
  label,
}: {
  valor: string;
  onChange: (v: string) => void;
  opcoes: readonly T[];
  label: (o: T) => string;
}) {
  // Sentinela porque SelectItem value="" quebra o Radix.
  const V_VAZIO = "__vazio__";
  return (
    <Select
      value={valor === "" ? V_VAZIO : valor}
      onValueChange={(v) => onChange(v === V_VAZIO ? "" : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder="Selecione..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={V_VAZIO}>—</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o} value={o}>
            {label(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function UploadFolder({
  tipo,
  documentos,
  uploadDoc,
  removerDoc,
}: {
  tipo: ColaboradorDocumentoTipo;
  documentos: ColaboradorDocumento[];
  uploadDoc: (tipo: ColaboradorDocumentoTipo, file: File) => Promise<void>;
  removerDoc: (id: string) => Promise<void>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = React.useState(false);
  const meus = documentos.filter((d) => d.tipo === tipo);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setSubindo(true);
    for (const f of files) {
      await uploadDoc(tipo, f);
    }
    setSubindo(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
        multiple
        onChange={onFile}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={subindo}
        className="w-full justify-start"
      >
        {subindo ? (
          <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5 mr-2" />
        )}
        {meus.length === 0
          ? "Escolher arquivo"
          : `Adicionar outro (${meus.length} enviado${meus.length === 1 ? "" : "s"})`}
      </Button>
      {meus.length > 0 && (
        <ul className="space-y-1">
          {meus.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1 text-xs"
            >
              <span className="truncate" title={d.arquivo_nome}>
                {d.arquivo_nome}
              </span>
              <button
                type="button"
                onClick={() => removerDoc(d.id)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label="Remover"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
