-- Reserva do envio da nota (PIE ACH-20). A fila, a varredura e o "tentar de novo" podiam mandar a
-- mesma nota à SEFAZ ao mesmo tempo: a segunda volta como duplicidade e podia apagar a autorização
-- da primeira (ou, em contingência, sair uma segunda nota com outra chave). Quem vai enviar trava a
-- linha e grava até quando a nota é dele; quem chega nesse meio-tempo desiste. Reserva abandonada
-- (processo caiu) vence sozinha e a varredura retoma.
alter table fiscal_documents add column sending_until timestamptz;
