# 213 — As apresentações do projeto

**Data:** 2026-10-26
**Status:** aceita e implementada em 26/10/2026.
**Quem decidiu:** Tiago, em 23/10/2026 (pedido) e 26/10/2026 (aprovação do
protótipo https://claude.ai/artifact/UxASwkRtQgA4GzFEinYTtQ, tela
"Novo projeto" e ficha do job).
**Migration:** `20261026800001_projeto_apresentacoes.sql`.

## O problema

A apresentação que o projeto mostrou ao cliente não tinha lugar no sistema.
Quem abria um job não tinha onde achar o que foi vendido.

## A regra

1. **O formulário do projeto ganha o campo "Apresentação"**, opcional, ao
   lado da Equipe — no "Novo projeto" e no "Editar projeto".
2. **Quantos arquivos forem.** Cada um entra na lista e sai pelo ✕; a área
   de envio fica embaixo ("Anexar apresentação", depois "Anexar outra").
3. **PDF, PowerPoint ou Keynote, até 50 MB cada** (`.pdf`, `.ppt`, `.pptx`,
   `.key`). Arquivo de outro tipo, grande demais ou com o mesmo nome de um
   que já está na lista é recusado com o motivo, sem barrar os outros.
4. **Escolher sobe na hora**, do navegador para o bucket privado
   `projetos-apresentacoes`, no caminho que o servidor reserva
   (`<tenant>/<uuid>-<nome>`) — o padrão da declaração do Simples (decisão
   142). O arquivo não passa pelo corpo da Server Action.
5. **O projeto grava a lista ao salvar.** O arquivo que subiu e não foi
   salvo (o formulário fechou, ou ele saiu da lista antes de salvar) sai do
   bucket. O arquivo já gravado que sai da lista deixa o projeto **e o
   bucket** ao salvar. Salvar com um arquivo ainda subindo é barrado com
   "Espere as apresentações terminarem de subir."
6. **A ficha do job mostra as apresentações** no card PROJETO da aba
   "Informações do Job", depois do período do projeto — nas três telas
   que usam a ficha (Jobs, Financeiro › Jobs e Abertura de Job). Cada nome
   abre o arquivo numa aba nova (URL assinada de 10 minutos). Sem nenhuma:
   "Nenhuma anexada".
7. **Quem anexa** é quem edita o projeto (`orcamentos.editar`:
   administrador, GP e produtor). **Quem abre** é qualquer membro do
   tenant, porque a ficha do job é vista por todos os módulos.
8. **Projeto arquivado é só leitura** (decisão 118): o banco recusa
   acrescentar ou tirar apresentação.

## O modelo

- `projeto_apresentacoes`: uma linha por arquivo — `projeto_id`,
  `nome_arquivo`, `storage_path` (único), `tamanho_bytes` (até 50 MB),
  `tipo`, `created_by`. RLS por tenant; `created_by` precisa ser quem
  insere. Sem UPDATE: trocar é tirar e anexar de novo.
- Bucket `projetos-apresentacoes`, privado, 50 MB por arquivo, sem lista de
  tipos (o Keynote chega com tipos diferentes conforme o navegador; quem
  confere é a extensão, no navegador e no servidor). As policies usam
  `tenant_do_caminho_no_storage` (decisão 190).
- O audit `projeto.criado` / `projeto.atualizado` leva a quantidade de
  apresentações.
