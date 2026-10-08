# Leitura automática de NF por IA no anexo da PP

Data: 2026-10-08
Status: Aprovado em brainstorm (8/10). Pronto para plano de implementação.

## Problema

Ao anexar uma NF ao Pedido de Produção, o usuário hoje preenche à mão os 4 campos do anexo tipo NF: `documento_numero`, `nf_data_emissao`, `nf_valor` e `nf_tomador_estabelecimento_id`. Isso acontece em dois pontos do fluxo — na criação do PP (drawer "Novo Pedido de Produção") e no modal "Enviar PP ao financeiro" — e repete trabalho que já está no próprio PDF da nota.

Como a California raramente recebe o XML da NFe, só o PDF (DANFE ou NFSe), parsing estruturado offline não resolve. Precisamos de leitura por IA multimodal.

## Escopo

Um botão **"Ler NF automaticamente"** no card do anexo, visível só quando o tipo marcado é `nota_fiscal`. Ao clicar, o PDF é enviado pra OpenAI (`gpt-5-mini`) via Responses API com Structured Outputs; a resposta pré-preenche os 4 campos do anexo + sugere match de empresa (via CNPJ tomador) e avisa se o fornecedor da NF diverge do da PP.

**Fora de escopo** desta entrega:
- OCR de imagem (JPG/PNG). Só PDF nesta versão — DANFE escaneada vem majoritariamente como PDF; se vier imagem, botão fica desabilitado com tooltip "Só PDF por enquanto".
- Preenchimento automático de `servico` do PP (campo que o planejado já definiu antes da NF existir).
- Preenchimento automático de `nf_valor_na_pp` (parte da nota que é desta PP — decisão específica do usuário que a IA não tem contexto pra tomar).
- Rate limit por usuário/tenant (fica pra v2 se virar dor).
- Dashboard de consumo de tokens.

## Decisões de design

### D1 — Botão nos dois pontos de uso

O componente `ZonaDeAnexos`/`NfDoAnexo` é reutilizado em dois lugares (drawer "Novo PP" e modal "Enviar ao financeiro"). O botão nasce dentro de `NfDoAnexo`, então aparece naturalmente nos dois lugares com o mesmo código. Nada muda no comportamento de upload — o arquivo já está no Storage antes do botão aparecer.

### D2 — IA só pré-preenche; usuário confirma

Nenhum dado da IA é salvo automaticamente. Os 4 campos do anexo são preenchidos no estado do formulário (`NfDigitada`), com um badge amarelo **"preenchido por IA — confira"** ao lado dos campos. O badge some assim que o usuário edita qualquer campo manualmente. Se a leitura falhar (API fora, PDF ilegível, timeout), aparece toast de erro e o formulário continua editável como antes.

### D3 — Modelo: `gpt-5-mini` via Responses API com Structured Outputs

Escolhido por:
- Aceita PDF nativo via content block `input_file` (não precisa converter pra imagem).
- Structured Outputs com `response_format: { type: "json_schema", strict: true }` garante schema conformance no decoder — zero risco de JSON malformado.
- Custo esperado: ~R$ 0,005–0,01 por NF (DANFE de 1–2 páginas, ~3k tokens input + ~400 output).
- Latência: 2–4s na média.

Alternativas descartadas:
- `gpt-5-nano`: mais barato, mas erra mais em DANFE escaneada ruim.
- `gpt-5` completo: 10x o custo sem ganho real pra extração estruturada.
- Claude Haiku 4.5 via Anthropic: usuário tem crédito OpenAI, prefere usar.
- Google Document AI: setup chato (service account, projeto GCP) sem ganho relevante no volume esperado.

### D4 — Schema estruturado, com `null` para o que não for certo

A IA é instruída a retornar `null` (não string vazia, não "não identificado") quando qualquer campo não puder ser extraído com segurança. Campos:

```ts
{
  numero_nf: string | null,
  data_emissao: string | null,      // ISO YYYY-MM-DD
  razao_social_emissor: string | null,
  cnpj_emissor: string | null,       // 14 dígitos só
  razao_social_tomador: string | null,
  cnpj_tomador: string | null,       // 14 dígitos só
  valor_total: number | null,
  descricao_servico: string | null,  // 1 linha, resumo
  confianca_baixa: boolean           // true se doc borrado/incompleto
}
```

### D5 — Validação pós-resposta vira filtro: campo inválido vira `null`

Antes de devolver os dados pro frontend, a server action valida cada campo. Falhou? Vira `null`. Nunca inventa.

- **CNPJ (emissor e tomador)**: regex 14 dígitos + dígito verificador (módulo 11). Inválido → `null`.
- **Data emissão**: parse ISO; se `> hoje em SP` ou `< 2015-01-01` → `null`.
- **Valor total**: `> 0` e `< 10.000.000` → senão `null`.
- **Número NF**: trim; `""` → `null`.
- **Descrição**: trim; `""` → `null`; limite 500 chars.

### D6 — Match de CNPJ tomador vira seleção automática

Com `cnpj_tomador` válido, a server action compara (normalizado) com os `tomadores` disponíveis (que já vêm no form, derivados das `empresas` do tenant). Match? Retorna o `estabelecimento_id` pra pré-selecionar o dropdown. Sem match? Devolve o CNPJ formatado pra mostrar aviso "CNPJ tomador da NF (XX.XXX…) não bate com nenhuma empresa cadastrada — selecione manualmente".

### D7 — Match de CNPJ emissor avisa divergência de fornecedor

Com `cnpj_emissor` válido, compara (normalizado) com `fornecedores[].cpf_cnpj`. Dois casos a avisar na UI:

- Match encontrado **e** é fornecedor diferente do selecionado no PP → aviso vermelho "esta NF foi emitida por FORNECEDOR X, mas a PP é do FORNECEDOR Y".
- Sem match → aviso amarelo "fornecedor da NF (XX.XXX…) não está cadastrado".

Match igual ao fornecedor da PP: silêncio (tudo certo, nada a dizer).

### D8 — Descrição do serviço vira info, não autofill

A IA extrai `descricao_servico` da NF, mas o campo `servico` do PP já é definido antes (no Planejado). Mostramos a descrição extraída como info visual embaixo dos campos ("A NF menciona: X"), com botão discreto **"Usar como descrição do PP"** só se o campo `servico` estiver vazio. Nunca sobrescreve.

### D9 — Cache por hash SHA-256 do arquivo

Mesmo PDF reanexado = zero chamadas à IA. Nova tabela `nf_extracao_cache (tenant_id, hash_sha256, dados jsonb, modelo, extraido_em)` guarda o resultado. Hit no cache = retorna direto, sem bater na OpenAI. Unique por `(tenant_id, hash_sha256)`.

Motivo: durante o desenvolvimento do PP, é comum anexar/remover/anexar o mesmo PDF algumas vezes. Também protege de duplo-clique acidental e de bugs onde o botão dispara 2x.

### D10 — Botão desabilita após extração bem-sucedida

Depois que o botão rodou com sucesso, ele desaparece do card. Reaparece só se o usuário trocar o arquivo (anexar outro PDF). Isso evita re-extração acidental e deixa claro visualmente que já rolou.

### D11 — Audit log em toda chamada à IA

Toda chamada (hit ou miss no cache) grava `logAuditEvent({ acao: "pp.anexo.nf_lida_por_ia", metadata: { arquivo_hash, cache_hit, modelo, tokens_in, tokens_out, custo_usd_estimado, confianca_baixa } })`. Permite auditoria de uso e análise de custo depois.

## Modelo de dados

### Migration — tabela `nf_extracao_cache`

```sql
create table public.nf_extracao_cache (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  hash_sha256 text not null check (char_length(hash_sha256) = 64),
  dados       jsonb not null,
  modelo      text not null,
  extraido_em timestamptz not null default now(),
  unique (tenant_id, hash_sha256)
);

create index nf_extracao_cache_tenant_hash_idx
  on public.nf_extracao_cache (tenant_id, hash_sha256);

alter table public.nf_extracao_cache enable row level security;

create policy nf_extracao_cache_tenant_select
  on public.nf_extracao_cache for select
  to authenticated
  using (tenant_id = (select current_tenant_id()));

create policy nf_extracao_cache_tenant_insert
  on public.nf_extracao_cache for insert
  to authenticated
  with check (tenant_id = (select current_tenant_id()));

grant select, insert on public.nf_extracao_cache to authenticated;
```

Sem UPDATE/DELETE — cache é imutável. Se precisar invalidar, DROP e recria (schema evolui? bump de versão vira coluna `modelo` já diferente, cache novo sobe).

## Interface da server action

```ts
// app/(app)/jobs/[jobId]/realizado/actions-ler-nf.ts
"use server";

export async function lerDadosDaNFPorIA(input: {
  anexo_path: string;         // path no bucket pedidos-compra
  mimetype: string;           // precisa ser "application/pdf"
}): Promise<
  | {
      ok: true;
      dados: {
        numero_nf: string | null;
        data_emissao: string | null;
        valor_total: number | null;
        descricao_servico: string | null;
        tomador: {
          cnpj: string | null;             // 14 dígitos
          razao_social: string | null;
          estabelecimento_id_match: string | null; // match em tomadores do tenant
        };
        emissor: {
          cnpj: string | null;             // 14 dígitos
          razao_social: string | null;
          fornecedor_id_match: string | null;      // match em fornecedores
        };
        confianca_baixa: boolean;
      };
      cache_hit: boolean;
    }
  | { ok: false; message: string }
>;
```

Validações da action, antes de qualquer I/O:
- `mimetype === "application/pdf"` → senão `{ ok: false, message: "Só PDF por enquanto" }`.
- `anexo_path` começa com `{tenant_id}/` do usuário autenticado → senão rejeita (defesa em profundidade — RLS do bucket já faria).

## Mudanças de UI

### No `NfDoAnexo` (componente que renderiza os campos da NF)

Antes dos campos `número / emissão / valor / tomador`:
- Botão **"Ler NF automaticamente"** (ícone de varinha, cor `california-red`). Desabilitado se mimetype não é PDF (tooltip "Só PDF por enquanto").
- Durante a chamada: botão vira spinner "Lendo…" e os campos ficam disabled.
- Sucesso: botão some. Campos preenchidos ganham badge inline amarelo **"IA"**. Badge some ao editar o campo.
- Erro: toast vermelho com mensagem; botão volta ao estado inicial; campos continuam editáveis vazios.

Depois dos campos (quando houver `descricao_servico` da IA):
- Linha em cinza "**A NF menciona:** <descrição>".
- Se `servico` do PP está vazio: botão discreto "Usar como descrição do PP" ao lado.

### Avisos de match (depois dos campos)

- `estabelecimento_id_match === null`: aviso amarelo "CNPJ tomador da NF ({cnpj formatado}) não bate com nenhuma empresa cadastrada".
- `fornecedor_id_match !== null && fornecedor_id_match !== fornecedorAtualDoPP`: aviso vermelho "esta NF foi emitida por {razao_social_emissor}, mas a PP é do {nome do fornecedor atual}".
- `cnpj_emissor !== null && fornecedor_id_match === null`: aviso amarelo "fornecedor da NF ({cnpj formatado}) não está cadastrado".
- Divergência de valor NF vs valor da PP (>1 centavo): aviso cinza "valor da NF ({v1}) não bate com valor da PP ({v2}) — pode ser NF que cobre múltiplas PPs".

Avisos somem assim que o usuário edita o campo relacionado.

## Chaves de ambiente

Nova variável:
```
OPENAI_API_KEY=sk-...
```

Precisa:
- `.env.local` (dev).
- Vercel → Settings → Environment Variables (Production + Preview).

Nunca commitada. Só server-side.

## Critérios de aceite

1. Anexar PDF no card da PP → marcar tipo "NF" → botão "Ler NF automaticamente" aparece.
2. Clicar → spinner 2–4s → campos preenchidos com badge "IA".
3. CNPJ tomador bate com empresa cadastrada → dropdown pré-selecionado.
4. CNPJ emissor diferente do fornecedor do PP → aviso vermelho visível.
5. Editar qualquer campo com badge "IA" → badge some.
6. Trocar o PDF → botão reaparece.
7. Anexar o mesmo PDF novamente → chamada vem do cache, sem latência de API.
8. Mimetype não-PDF (JPG/PNG) → botão desabilitado com tooltip.
9. Imagem (JPG) marcada como NF → botão não aparece.
10. OpenAI fora do ar → toast de erro; formulário continua editável.
11. Audit log `pp.anexo.nf_lida_por_ia` em toda chamada (hit ou miss).
12. Nada é salvo no banco automaticamente — usuário continua precisando clicar em "Salvar" ou "Enviar".
