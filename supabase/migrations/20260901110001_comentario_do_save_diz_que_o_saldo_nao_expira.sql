-- Save: o comentário da view passa a dizer que o saldo NÃO expira.
--
-- A `20260901100001` acertou a regra (só job enviado para faturamento
-- oferece crédito) mas o comentário só contava metade dela. O Tiago pediu
-- que a outra metade ficasse explícita (01/09/2026): o envio é o ÚNICO
-- gatilho, e depois dele nada tira o crédito da oferta — nem a nota
-- emitida, nem o recebimento, nem o encerramento do job.
--
-- Isso já era verdade no código; é documentação, não mudança de regra.
-- `encerrado` não está entre os status recusados, faturar e receber não
-- mexem em `jobs` nem em `jobs_envio_faturamento`, e o único delete
-- naquela tabela é o rollback de um envio que falhou ao gravar parcelas.
--
-- Só `comment on view`: nenhuma linha e nenhuma coluna se movem.

comment on view public.vw_saves_por_job is
  'Saldo de save por job, para o seletor de consumo. Entra o job que gerou '
  'save, nao foi recusado nem cancelado, e JA FOI ENVIADO para faturamento '
  '- o envio e o unico gatilho (regra de 01/09/2026). Uma vez disponivel, o '
  'saldo NAO expira: segue oferecido depois da nota emitida, depois do '
  'recebimento e depois do encerramento do job. Consumo ja gravado nao e '
  'afetado por esta view, que monta apenas a oferta.';
