# 117 — O status só muda pelo sistema

**Data:** 2026-09-28
**Decidido por:** Tiago
**Migrations:** `20260928400001_travas_de_escrita_direta_em_jobs_envios_e_notas.sql` (job) e `20260928400003_status_do_orcamento_so_pelo_sistema.sql` (orçamento).
**Conferência:** `scripts/conferir-travas-escrita-direta.sql`.

---

## 1. A regra

Nas palavras do Tiago, em 28/09/2026:

> O status não pode ser modificado manualmente.

Vale para o job e para o orçamento. Cada mudança de status tem a sua ação no
sistema, com as travas dela, e nenhum usuário grava status por fora — nem
pela tela, nem pela API do Supabase com o próprio login.

## 2. Job, envio para faturamento e notas (no ar em 28/09/2026)

A RLS de `jobs` só olha tenant, empresa e regional, e o `authenticated`
tinha INSERT/UPDATE nas tabelas. Por isso qualquer usuário conseguia, com o
próprio login e pela API, encerrar job pulando as travas, gravar
`finalizado`, cancelar job aberto, fechar a revisão da abertura, alterar
envio para faturamento e criar nota. Isso foi confirmado por simulação em
22/09.

A guarda foi preparada em 22/09 na branch `feat/travas-escrita-direta`,
nunca aplicada, e revista em 28/09:

| Mudança de status do job | Quem |
|---|---|
| nasce `aguardando_abertura` | administrador, GP |
| aguardando abertura → aberto ou devolvido | administrador, financeiro |
| devolvido → aguardando abertura (reenvio) | administrador, GP |
| aguardando abertura ou devolvido → cancelado ("Cancelar envio") | administrador, GP, produtor |
| aberto → encerrado (sem revisão da abertura pendente) | administrador, GP |
| qualquer outra | ninguém — `finalizado` só pelo banco; job aberto não se cancela (revisão da 020); encerrado, finalizado e cancelado não mudam mais |

As outras travas:

- **Fechar a revisão da abertura:** só administrador e financeiro.
- **Envio para faturamento:**
  - só nasce para job aberto ou encerrado, sem revisão da abertura pendente;
  - a parcela só nasce junto do envio;
  - alterar envio ou parcela é do administrador e do financeiro. A
    edição do orçado pelo financeiro (115) corrige esses valores pela
    função `registrar_alteracao_do_financeiro`.
- **Notas:** o INSERT/UPDATE direto sai. Nota só nasce e cancela por
  `emitir_faturamento` e `cancelar_faturamento`.

Função do banco com `security definer` passa, porque a regra é dela: o
gatilho do envio e o do encerramento gravam `finalizado`, e as RPCs de save
(099) abrem e fecham a revisão.

**O que mudou em relação à versão de 22/09:**

- saiu `aberto → cancelado`;
- o UPDATE do envio deixou de ser revogado e virou guarda de papel, por
  causa da 115;
- o papel de quem cria o envio já era conferido por
  `envio_faturamento_autor` (24/09).

**Conferência antes de aplicar:** 34 casos numa transação desfeita, contra
o banco de produção.

- **14 escritas do app passaram.** A L12 parou numa coluna obrigatória,
  depois da guarda.
- **20 ataques foram recusados,** entre eles produtor, GP e financeiro
  cancelando job aberto.

## 3. Orçamento (no ar em 28/09/2026)

- **O campo Status do "Editar orçamento" saiu.** Também saíram do schema e
  da action. O orçamento nasce rascunho pelo default do banco.
- **O antigo "Cancelado" virou o Arquivar** (decisão 118).
- **Guarda no banco:** a mesma escrita feita pela API é recusada.

| Mudança de status do orçamento | Ação | Quem |
|---|---|---|
| nasce `rascunho` | criar | quem cria orçamento |
| rascunho, em revisão, enviado ao cliente ou recusado → aprovado | aprovar a versão | administrador, GP |
| aprovado → em revisão | desfazer a aprovação | administrador, GP |
| aprovado → job criado | enviar para abertura | administrador, GP |
| job criado → aprovado | cancelar o envio | administrador, GP, produtor |
| enviado ao cliente, recusado ou cancelado → rascunho | só junto do Reativar | administrador, GP, produtor |
| qualquer outra | — | ninguém |

**Os três status manuais antigos** (enviado ao cliente, recusado,
cancelado) continuam no enum do banco. Nenhum orçamento está neles hoje fora
do HIT-P001/26-02, que virou arquivado.

**Conferência antes de aplicar:** numa transação desfeita, as 6 escritas
que tinham de passar passaram, e os 7 ataques foram recusados.

