# 216 — Mídia System: o job auditado pelo cliente, PP sem NF até o financeiro liberar as notas

**Data:** 2026-10-26
**Status:** aceita e implementada em 26/10/2026.
**Quem decidiu:** Tiago — pedido, protótipo aprovado e respostas em 26/10
(https://claude.ai/artifact/CHhA3XKa2cNymyChtFTUXp, botão na aba
"Abertura do Job" ★).
**Migrations:** `20261027700001_midia_system.sql` e
`20261027700002_midia_system_prestacao_depois_da_pp.sql`.

## O problema

Alguns clientes mandam o job para uma auditoria meticulosa (a Mídia
System). Enquanto ela corre, o fornecedor ainda não emite a NF, mas precisa
receber. O sistema exigia a NF no envio da PP ao financeiro, então essas
PPs paravam.

## A regra

1. **O financeiro marca o job como Mídia System** na abertura (caixa no fim
   do "Registro no financeiro") ou no "Editar registro". Sempre o
   financeiro (ou o administrador). A marca aparece nos dois resumos da
   abertura e como selo no cabeçalho do job, para o financeiro e para a
   produção: "Mídia System · em auditoria" ou "· NFs liberadas".
2. **Durante a auditoria, a PP normal vai ao financeiro sem anexo.** O
   envio mostra "Anexos · opcionais na auditoria". A PP que foi sem nenhum
   anexo ganha a marca `sem_nf_na_auditoria` e "Sem NF" embaixo do status.
   O financeiro aprova e paga como qualquer PP. Verba, reembolso e cartão
   corporativo não mudam.
3. **"Liberar NFs"** fica no campo Mídia System da aba "Abertura do Job"
   (só o financeiro a vê). A confirmação lista as PPs que foram sem NF. A
   liberação **não volta atrás**.
4. **Depois da liberação**, as PPs sem NF ficam "Aguardando prestação" e a
   produção manda a NF pela **mesma prestação de contas da verba**
   (decisão 189): o mesmo botão "Prestar contas", na aba PPs e no painel
   "PPs" do item na Planilha Interna, e a mesma gaveta, com "Valor da PP",
   o fornecedor como emitente e sem "Não houve gasto". As próximas PPs
   voltam a exigir a NF no envio.
5. **A conferência é a da verba** (resposta do Tiago): a PP entra no chip
   "Prestação de Contas" do Contas a Pagar, com aprovar e reprovar. **Não há
   saldo nem estorno**: a PP foi paga cheia ao fornecedor, a prestação
   grava `valor_devolvido = 0` e o realizado do item não cai.
6. **Primeiro a PP, depois a prestação.** A NF pode chegar com a PP ainda
   em avaliação (enviada na véspera da liberação). A tela mostra "Aprove a
   PP antes da prestação" no lugar do botão, e o banco recusa a ordem
   inversa — senão a NF entraria no cadastro de notas de uma PP que o
   financeiro ainda pode rejeitar.
7. **A NF entra no cadastro de notas na aprovação da prestação, como a da
   verba** (resposta do Tiago): crédito de PIS/COFINS no mês da emissão,
   sem retenção.
8. **O encerramento trava até a prestação aprovada**, durante a auditoria
   também (resposta do Tiago): "1 PP sem NF da Mídia System: PP-…".
9. **A caixa trava** no "Editar registro" quando as NFs já foram liberadas,
   ou quando já há PP sem NF (a saída é liberar).

## Banco

- `jobs.midia_system`, `midia_system_liberado_em`, `midia_system_liberado_por`
  (FK `profiles`), com check de coerência.
- `pedidos_compra.sem_nf_na_auditoria` (índice parcial).
- Gatilho `jobs_guarda_midia_system`: nasce desmarcado, só administrador ou
  financeiro mexe, a liberação não volta, e o job com PP sem NF não deixa
  de ser Mídia System.
- Gatilho `pp_guarda_sem_nf_na_auditoria`: a marca só liga no envio, com o
  job em auditoria; só sai no reenvio da PP rejeitada.
- RPC `liberar_nfs_midia_system(job)` (administrador ou financeiro;
  devolve quantas PPs entram na prestação). GRANT só para `authenticated`.
- `_pp_da_auditoria_liberada(pp)` e as funções da prestação da verba
  (`_verba_para_prestar`, `enviar_prestacao_verba_salva`,
  `corrigir_documento_prestacao_verba`, `aprovar_prestacao_verba`)
  aceitam a PP da auditoria liberada com as diferenças acima. Os nomes
  continuam "de verba": as telas e as Server Actions já as chamam.

## Código

- Regra comum: `lib/calculos/midia-system.ts` (+ `.test.ts`, 6 testes).
- Abertura: `campo-midia-system.tsx`, `actions-midia-system.ts`.
- Selo e marca da PP: `app/(app)/jobs/_midia-system/midia-system.tsx`.
- Envio sem NF: `realizado/actions-pp.ts` e `pp-a-emitir-ui.tsx`.

## Conferido

No TES-1029/26 (P-0006/26 · Teste), em 26/10/2026: abertura com Mídia
System; PP-00572 enviada sem anexo; "Liberar NFs"; NF 9216 pela gaveta;
aviso "Aprove a PP antes da prestação"; PP aprovada; prestação aprovada
com `valor_devolvido = 0`, sem estorno, NF 9216 no cadastro de notas com
crédito, realizado do item intacto em R$ 3.000,00; pendência do
encerramento saiu.

## Riscos e o que fica de fora

- **A PP paga sem NF sai sem retenção** (ISS, IRRF, CSRF). A NF que chega
  depois entra só no cadastro de notas. Risco fiscal aceito na resposta
  "como a NF da verba".
- **A 194 reservada** (compra de balcão, nota depois do pagamento) pode
  usar o mesmo mecanismo.
