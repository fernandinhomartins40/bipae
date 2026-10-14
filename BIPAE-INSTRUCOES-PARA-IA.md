# Bipae × MercadoFlow: especificação de integração nativa

> Para a IA que implementa o **Bipae** (PDV e ERP: API Node no contêiner `bipae-api`, app desktop Tauri, web em www.bipae.com.br).
> O lado do **MercadoFlow** (plataforma de inteligência de varejo da mesma empresa) já está pronto e em produção depois do próximo deploy. Este documento é o contrato: endpoints, formatos, regras, telas e testes.

## 0. O que você vai entregar

| # | Módulo | Para quem | Resultado para o lojista |
|---|---|---|---|
| 1 | **Catálogo nativo** | **Toda loja Bipae**, com ou sem conta MercadoFlow | Bipou o código ou digitou o nome, e o produto entra cadastrado com nome, marca, fabricante, departamento, unidade, conteúdo, NCM/CEST sugeridos, imagem e ficha técnica |
| 2 | **Contas vinculadas + desconto** | Loja que quer o MercadoFlow | Cria a conta MercadoFlow sem sair do Bipae (ou vincula a que já tem) e ganha desconto no plano por ser cliente Bipae |
| 3 | **Confere no Bipae** | Loja vinculada | Notas de entrada chegam sozinhas da Sefaz (certificado A1). Confere pelo celular ou pelo leitor, e a entrada cai no estoque do Bipae já em unidades, com custo |
| 4 | **Vendas e inteligência** | Loja vinculada | As vendas do caixa vão ao MercadoFlow na hora. O Bipae mostra as decisões do Tino, o preço da região e aplica os encartes no caixa |

Ordem recomendada: 1 → 2 → 4 (vendas) → 3 → 4 (inteligência).

## 1. Princípios (não negociáveis)

1. **Só a API do Bipae fala com o MercadoFlow.** O desktop e o web nunca recebem `client_secret`, token ou certificado do MercadoFlow. Eles chamam a API do Bipae, que repassa.
2. **O caixa nunca espera o MercadoFlow.** A consulta ao catálogo no caixa tem tempo limite (1,5 s). Tudo que o Bipae envia passa por uma **outbox** (tabela de fila com tentativas e espera exponencial). Com o MercadoFlow fora do ar, o Bipae continua funcionando.
3. **Nunca cadastrar nada sozinho.** O catálogo **pré-preenche** o formulário, e o usuário confere e salva. O mesmo vale para preço aprovado e encarte: viram **pendências** que o gerente aplica com um clique (ou automático, se ele ligar a opção).
4. **Consentimento:**
   - o catálogo é da plataforma e vale para todos;
   - vendas, Confere e inteligência só depois que o dono vincula a loja;
   - criar a conta MercadoFlow exige o aceite dos termos do MercadoFlow dentro do Bipae (checkbox com link).
5. **Sem banco compartilhado.** Tudo pela API HTTP.
6. **Idempotência:**
   - venda pela chave da NFC-e;
   - webhook pelo `X-MercadoFlow-Delivery`;
   - lotes com `Idempotency-Key` onde indicado.

## 2. Infraestrutura (mesma VPS)

O Bipae e o MercadoFlow rodam na mesma VPS, em projetos compose diferentes. Em `/root/bipae/deploy/docker-compose.vps.yml`, ligue o serviço `api` também à rede do MercadoFlow:

```yaml
services:
  api:
    # ... o que já existe ...
    environment:
      # ... o que já existe ...
      MERCADOFLOW_API_URL: http://mercadoflow-backend:8080/api/v1/partner
      MERCADOFLOW_INTERNAL_URL: http://mercadoflow-backend:8080
      MERCADOFLOW_PUBLIC_URL: https://mercadoflow.com
      MERCADOFLOW_CLIENT_ID: ${MERCADOFLOW_CLIENT_ID:-}
      MERCADOFLOW_CLIENT_SECRET: ${MERCADOFLOW_CLIENT_SECRET:-}
      MERCADOFLOW_WEBHOOK_SECRET: ${MERCADOFLOW_WEBHOOK_SECRET:-}
    networks:
      internal: {}
      mercadoflow:
        aliases: [bipae-api]

networks:
  internal: {}            # manter como já está
  mercadoflow:
    external: true
    name: mercadoflow-web_default
```

- As credenciais ficam no `/root/bipae/.env` (nunca no repositório). O super admin do MercadoFlow gera em Parceiros → Bipae.
- Sem as variáveis, a integração fica desligada e o Bipae funciona normalmente. O catálogo cai para o cadastro manual.
- Em desenvolvimento: `MERCADOFLOW_API_URL=https://mercadoflow.com/api/v1/partner`, com credenciais de teste.

## 3. Autenticação, limites e erros

```
POST {MERCADOFLOW_API_URL}/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=...&client_secret=...
```
→ `{ "access_token": "mfp_...", "token_type": "Bearer", "expires_in": 3600 }`

- Cache do token em memória. Renove 5 min antes de vencer e também ao receber 401.
- **Limite:** 1.200 requisições por minuto para o Bipae, somando todas as lojas. Ao receber 429, espere e repita.
- **Erros:** `{ "erro": "mensagem em português" }`
  - 400: dado inválido. Mostre a mensagem ao usuário.
  - 403: sem permissão (loja não vinculada ou escopo não autorizado).
  - 404: não encontrado.
  - 409: conflito.
  - 5xx ou rede: tente de novo.
- `GET /me` → o parceiro e as lojas vinculadas: `marketId`, `cnpj`, `externalStoreId`, `scopes`, `customerActive`, `lastSalesAt`, ...
- **Imagens:** `imageUrl` é pública (https). `imagePath` é o caminho relativo, para baixar pela rede interna em `{MERCADOFLOW_INTERNAL_URL}{imagePath}`. **Baixe e guarde a imagem no armazenamento do Bipae** ao salvar o produto, em vez de apontar para a URL do MercadoFlow.

---

## 4. Módulo 1: Catálogo nativo (toda loja Bipae)

Não precisa de loja vinculada. São 267 mil produtos com imagem própria (fundo tratado), nome padronizado, marca, fabricante, departamento e ficha técnica.

### 4.1 Endpoints

| Método | Caminho | Uso |
|---|---|---|
| GET | `/catalog/products/{gtin}` | Um código: cadastro completo **com** ficha técnica |
| POST | `/catalog/products/lookup?spec=false` | `{ "gtins": [...] }`, até 200: vários códigos (importação de planilha ou de XML). `spec=true` inclui a ficha |
| GET | `/catalog/search?q=acucar uniao&limit=20` | Busca por nome (cada palavra em qualquer ordem, sem acento). Só dígitos é tratado como GTIN. Máx. 50. Inclui `genericImages` |
| GET | `/catalog/generic-images?q=banana&group=hortifruti&limit=24` | Fotos genéricas para produto sem código de barras. `group`: `hortifruti` \| `carnes` \| `padaria` \| `frios` \| `outros` |
| POST | `/catalog/contributions` | Devolve ao catálogo o que as lojas cadastram (seção 4.4) |

### 4.2 Produto (resposta de `/catalog/products/{gtin}`, itens de `lookup` e de `search`)
```json
{
  "gtin": "7891910000197",
  "found": true,
  "description": "Açúcar União Refinado 1kg",
  "brand": "União",
  "manufacturer": "Camil",
  "department": "Mercearia",
  "category": "Açúcar e Adoçantes > Açúcar",
  "unit": "UN",
  "weighable": false,
  "packageDescription": "1 kg",
  "content": { "quantity": "1", "unit": "KG", "packs": 1 },
  "ncm": "17019900",
  "ncmConfidence": 0.92,
  "cest": "1710300",
  "packs": [ { "packGtin": "17891910000194", "unitsPerPack": 10 } ],
  "imageUrl": "https://mercadoflow.com/api/v1/catalog/images/products/7891910000197.jpg",
  "imagePath": "/api/v1/catalog/images/products/7891910000197.jpg",
  "source": "PAODEACUCAR_WEB_BR",
  "updatedAt": "2026-10-09T22:11:25",
  "spec": {
    "description": "Texto do fabricante...",
    "ingredients": "Açúcar.",
    "nutritionTableHtml": "<table>...</table>",
    "attributes": [ { "label": "Peso líquido", "value": "1 kg", "group": "MEDIDAS" } ]
  }
}
```

**Não encontrado:** `{ "gtin": "...", "found": false, "reason": "NAO_ENCONTRADO" | "GTIN_INVALIDO" }`

| Campo | Regra |
|---|---|
| `unit` | `UN`, `KG`, `L`, `CX`, `G`, `ML` |
| `weighable` | `true` quando `unit = KG` (produto de balança) |
| `content` | Conteúdo lido do nome (`500g`, `1,5kg`, `12 x 350ml`). Use para o **preço por unidade de medida** na etiqueta (R$/kg, R$/L), exigido por lei. `quantity` vem como texto decimal com ponto |
| `ncm`, `cest` | **Sugestões**: o código mais usado nas notas de todas as lojas e nos cadastros do Bipae. `ncmConfidence` vai de 0 a 1 (fatia dos votos). Mostre como "Sugerido pelo catálogo" e deixe editar. Se vier vazio, o usuário preenche |
| `packs` | Caixa ou fardo vistos nas notas de entrada: GTIN da embalagem e quantas unidades leva. Cadastre como **código de barras adicional / embalagem de compra** do produto |
| `spec` | Só na consulta de 1 código, ou com `spec=true`. Pode vir `null` |
| `source` | Origem dos dados. Não mostre ao lojista; guarde para auditoria |

Na busca por nome, os itens vêm sem `ncm`, `cest`, `packs` e `spec`. Ao escolher um, chame `/catalog/products/{gtin}`.

### 4.3 Onde usar no Bipae

1. **Cadastro de produto: campo código de barras.**
   - Ao bipar ou sair do campo, chame `GET /catalog/products/{gtin}`.
   - Encontrado: pré-preencha tudo (descrição, marca, fabricante, departamento e categoria, unidade, conteúdo, NCM, CEST, códigos de embalagem, ficha) e mostre a imagem.
   - O usuário só informa **preço de venda** (e custo, se quiser) e salva.
   - Ao salvar, baixe a imagem para o storage do Bipae.
2. **Cadastro de produto: busca por nome** ("Buscar no catálogo").
   - Campo com debounce de 300 ms, mínimo de 2 letras, chamando `GET /catalog/search`.
   - Lista com foto, nome, marca e conteúdo. Ao escolher, vale o fluxo do item 1.
   - Se houver `genericImages`, mostre também "Fotos genéricas" (para produto sem código).
3. **Caixa: produto não cadastrado.**
   - O operador bipa um código desconhecido. Se ele tiver permissão de cadastro rápido, abra o mini-cadastro já preenchido pelo catálogo (com tempo limite de 1,5 s).
   - Sem permissão ou sem resposta, siga o fluxo atual (avisar o gerente).
4. **Produto de balança, granel ou padaria** (sem GTIN):
   - no cadastro, ofereça "Escolher foto genérica" (`/catalog/generic-images`);
   - unidade `KG`.
5. **Importação em massa** (planilha ou XML de NF-e de entrada):
   - junte os GTINs e chame `POST /catalog/products/lookup` em lotes de 200;
   - mostre uma tela de revisão "X produtos encontrados no catálogo" antes de gravar.
6. **Cache no Bipae:**
   - `found: true` por 30 dias;
   - `found: false` por 1 dia;
   - busca por nome por 10 minutos.

### 4.4 Devolver ao catálogo (`POST /catalog/contributions`)
Sempre que uma loja **criar ou alterar** um produto com GTIN válido, ponha na outbox. Envie em lotes de até 500 a cada 5 minutos:
```json
{ "items": [ {
  "gtin": "7891234567895",
  "storeId": "<id da loja no Bipae>",
  "description": "Biscoito Recheado Chocolate Marca X 130g",
  "brand": "Marca X",
  "department": "Mercearia > Biscoitos",
  "unit": "UN",
  "packageDescription": "130 g",
  "ncm": "19053100",
  "cest": "1705700"
} ] }
```
- Resposta por item:
  - `CRIADO`: produto novo no catálogo, que passa a aparecer para as outras lojas;
  - `REGISTRADO`;
  - `RECUSADO` (com `error`).
- O MercadoFlow guarda a loja só como hash. NCM e CEST viram votos. **Não envie preço nem custo aqui.**
- É isso que faz o catálogo do Bipae melhorar com o uso. Explique ao lojista nos termos do Bipae ("os dados cadastrais dos produtos ajudam a melhorar o catálogo").

---

## 5. Módulo 2: Contas vinculadas e desconto no plano

### 5.1 Tela "MercadoFlow" nas configurações da loja (Bipae)
Card **"MercadoFlow: inteligência de compras, preço e o Confere"**, com o desconto em destaque ("Clientes Bipae têm X% de desconto"). Dois botões:

- **"Criar minha conta MercadoFlow"** (recomendado):
  - formulário já preenchido com os dados da loja: CNPJ, nome, responsável, e-mail, telefone;
  - checkbox obrigatório "Autorizo a criação da conta no MercadoFlow e o envio das vendas, do cadastro, dos preços, do estoque e das notas de entrada desta loja para gerar as análises, e aceito os termos de uso do MercadoFlow";
  - o link dos termos fica numa variável `MERCADOFLOW_TERMS_URL`. A página pública ainda vai ser publicada pelo MercadoFlow: enquanto a variável estiver vazia, mostre só o texto acima.
- **"Já tenho conta MercadoFlow"** → fluxo de vínculo (5.3).

### 5.2 Criar a conta: `POST /accounts`
```json
{
  "cnpj": "12345678000199",
  "storeName": "Mercado Exemplo",
  "ownerName": "Maria Souza",
  "ownerEmail": "maria@exemplo.com",
  "phone": "41999990000",
  "externalStoreId": "<id da loja no Bipae>",
  "termsAcceptedAt": "2026-10-12T14:31:05-03:00",
  "customerActive": true,
  "scopes": ["sales:write","catalog:read","insights:read","promotions:read","confere:use","catalog:write","prices:write","costs:write","stock:write","orders:read","prices:read","inbound:read"]
}
```
`scopes` é opcional: sem ele, vão todos.

- **201:**
  - `{ "status": "CRIADA", "marketId": "...", "scopes": [...], "welcomeEmailSent": true, "message": "..." }`
  - A conta nasce no plano grátis, já vinculada, e o webhook `connection.authorized` chega.
  - O dono recebe um e-mail "Criar minha senha", válido por 7 dias. **O Bipae nunca define nem vê a senha.**
  - Mostre: "Conta criada! Enviamos para maria@exemplo.com o link para criar a senha do MercadoFlow."
- **409:**
  - `{ "status": "JA_TEM_CONTA", "reason": "CNPJ_JA_TEM_CONTA" | "EMAIL_JA_TEM_CONTA", "message": "...", "connect": { "code": "mfx_...", "connectUrl": "...", "expiresAt": "..." } }`
  - Leve o usuário direto ao fluxo de vínculo, abrindo o `connectUrl` (5.3, a partir do passo 3).
- **400:** campo faltando ou inválido. Mostre a mensagem.

### 5.3 Vincular conta existente
1. `POST /connect` com `{ cnpj, storeName, ownerEmail, externalStoreId, returnUrl, scopes? }`
   → `{ code, connectUrl, expiresAt, scopes }`. O `returnUrl` precisa ser https (ou `http://localhost` em dev).
2. Grave a conexão `PENDENTE` e abra o `connectUrl`:
   - desktop: navegador do sistema (`shell.open`);
   - web: nova aba.
3. O dono entra no MercadoFlow (ou cria a conta, com os dados pré-preenchidos), confere as permissões e aprova. O navegador volta para `returnUrl?mf_status=ok&mf_market=<id>` (ou `mf_status=recusado`).
4. **A confirmação vale pelo webhook `connection.authorized`.** Enquanto houver conexão pendente, consulte também `GET /connect/{code}` a cada 30 s.
   → `{ status: PENDENTE|APROVADO|RECUSADO|EXPIRADO, marketId, scopes, externalStoreId, decidedAt, expiresAt }`
5. Aprovado:
   - grave `market_id`, `scopes` e `status = ATIVA`;
   - chame `PUT /markets/{id}/customer` (5.4);
   - dispare a carga inicial (seção 7.4).

### 5.4 Cliente ativo e desconto
O desconto só vale enquanto o Bipae disser que a loja é **cliente ativo**. Envie sempre que a assinatura Bipae da loja mudar (ativou, cancelou, inadimplente por mais de N dias) e uma vez por dia para todas as lojas vinculadas:
```
PUT /markets/{marketId}/customer
{ "active": true }
```
→ `{ "active": true, "discount": { "active": true, "partner": "Bipae", "percent": 20 } }`

- `GET /markets/{marketId}/benefit` → `{ "discount": {...} }`. Mostre na tela "MercadoFlow" do Bipae.
- O desconto vale no plano pago pelo **Pix ou boleto**. O MercadoFlow recalcula a assinatura sozinho, e a próxima fatura já vem com o valor novo.
- O percentual é definido pelo super admin do MercadoFlow.

### 5.5 Modelo de dados sugerido (Bipae)
Tabela `mercadoflow_links`:
- `store_id`, `market_id`, `status` (`PENDENTE` | `ATIVA` | `REVOGADA` | `RECUSADA` | `EXPIRADA`);
- `connect_code`, `scopes text[]`, `created_via` (`ACCOUNT` | `CONNECT`);
- `customer_active_sent`, `connected_at`, `revoked_at`;
- `last_sales_sync_at`, `last_error`.

---

## 6. Módulo 3: Confere no Bipae

O **Confere** é o produto de notas de entrada do MercadoFlow. No Bipae, ele aparece como um módulo do Bipae: menu **Compras → Notas de entrada / Conferência**. A leitura na Sefaz, o certificado, o saldo de leituras, a conversão de caixa para unidade e a conferência continuam no MercadoFlow. **O Bipae é a tela e dá entrada no estoque.**

Requisito: loja vinculada com o escopo `confere:use`. Sem vínculo, a tela do Confere mostra o card da seção 5.1 ("Ative o Confere: crie sua conta grátis").

Todas as rotas abaixo ficam em `/markets/{marketId}/confere`. Mande sempre `actor` (nome do usuário do Bipae) nas ações: ele fica registrado como "Bipae: Maria".

### 6.1 Ativação e conta
| Método | Caminho | Corpo / resposta |
|---|---|---|
| GET | `/status` | `{ enabled, termsAccepted, termsVersion, termsText, balance, trialGranted, trialReads, pricePerReadCents, plans:[{id,name,reads,priceCents}], certificate:{cnpj,holder,notAfter,lastSyncAt,lastStatus,expired} \| null, pixAvailable, marketName, marketCnpj, ... }` |
| POST | `/terms` | `{ "version": "<termsVersion>", "actor": "Maria" }`. Mostre `termsText` e um botão "Aceito". O primeiro aceite credita `trialReads` leituras grátis |
| POST | `/certificate` | `{ "pfxBase64": "...", "password": "...", "uf": "PR", "actor": "Maria" }` → `certificate` |
| DELETE | `/certificate` | Remove o certificado |

**Certificado A1** (o caminho grátis e automático):
- upload do `.pfx`/`.p12` com a senha;
- o Bipae envia em base64 e **não guarda** o arquivo nem a senha. O MercadoFlow guarda cifrado;
- erros possíveis: senha errada, vencido, CNPJ de outra empresa. Mostre a mensagem;
- mostre o titular e a validade, e avise quando faltarem menos de 30 dias para vencer.

Com o certificado, o MercadoFlow busca **sozinho, a cada hora**, todas as NF-e emitidas contra o CNPJ da loja. Sem ele, cada nota lida pela chave gasta 1 leitura do saldo.

### 6.2 Notas
| Método | Caminho | Uso |
|---|---|---|
| GET | `/documents` | As 100 mais recentes: `{ items: [{ id, accessKey, completeness, source, emitterName, number, issuedAt, totalValue, itemsCount, volumes, checkStatus: null\|OPEN\|DONE, checkedAt }] }` |
| GET | `/documents/{documentId}` | `{ document, entry }`. `document` é a nota para a tela (itens como no DANFE, com nome e foto do catálogo e variação de preço contra a nota anterior do mesmo fornecedor). `entry` é a entrada pronta (6.4) |
| POST | `/read` | `{ "accessKey": "<44 dígitos>", "actor": "Maria" }`. **Ler pela chave**: bipe o código de barras do DANFE. → `{ documentId, accessKey, source: SAVED\|SEFAZ\|MEUDANFE, charged, balance }` |
| POST | `/upload` | `{ "xml": "<nfeProc ...>" }`. Importa o XML (arquivo ou e-mail do fornecedor) |
| POST | `/sync` | "Buscar notas agora". Já roda sozinho a cada hora, então use só no botão. A Sefaz bloqueia excesso: no máximo 1 vez a cada 15 min por loja |

- `completeness = SUMMARY`: a Sefaz entregou só o resumo, e os produtos chegam em minutos. Mostre "Aguardando a Sefaz liberar os produtos".
- Saldo: `/ledger` → `{ items:[{delta, kind, note, createdAt}] }`.
- Compra de leituras: `POST /orders` com `{ "planId": "..." }` → `{ id, planName, reads, amountCents, status, txid, pixPayload, pixQrPng, ... }`. Mostre o Pix copia-e-cola e o QR. Consulte `GET /orders/{id}` até `status = PAID`.

### 6.3 Conferência
```
PUT /documents/{documentId}/check
{
  "counts": { "1": { "counted": 16 }, "2": { "counted": 11, "issue": "AVARIA", "note": "2 caixas amassadas" } },
  "blind": true,
  "finish": false,
  "actor": "João"
}
```
- **`counted` vai na unidade da nota** (caixa, fardo), igual ao que está escrito no DANFE. O MercadoFlow converte para unidades de venda.
- Chave = número do item na nota (`item`).
- `issue`: `AVARIA` | `VALIDADE` | `TROCADO`. Falta e sobra saem da diferença entre `counted` e a quantidade da nota, sem precisar marcar.
- `blind: true` = **conferência cega**: o Bipae esconde as quantidades da nota do conferente.
- Salve a cada item contado (`finish: false`). Assim, a conferência continua de outro aparelho.
- Item não contado ≠ chegou tudo. Não envie item sem contagem.
- **Concluir:** `finish: true` (e `summary` opcional: `{ "faltas": 2, "sobras": 0, ... }`) → `{ check, entry }`.
- Reabrir uma concluída: `"restart": true` cria uma nova.

**Tela de conferência no Bipae** (celular, tablet ou desktop com leitor):
1. Lista de itens com foto do catálogo, descrição, código do fornecedor, quantidade e unidade da nota (escondidas na cega) e o campo **Contei**.
2. **Bipar um produto incrementa a contagem do item correspondente.** Procure pelo `gtin` (unidade) ou pelo `packGtin` (caixa) do `entry.items`. Bipou a caixa: soma 1 na unidade da nota. Bipou a unidade e a nota está em caixa: mostre "Isto é 1 unidade; a nota está em caixa de N".
3. Botões de divergência por item.
4. Resumo antes de concluir: faltas, sobras, avarias, e a variação de preço dos itens que subiram mais de 5%.

### 6.4 Entrada pronta para o estoque (`entry`)
Vem em `GET /documents/{id}`, na conclusão da conferência, em `GET /documents/{id}/entry` e no webhook `confere.check.finished`:
```json
{
  "documentId": "...", "accessKey": "4126...", "number": "12345", "series": "1",
  "supplierCnpj": "12345678000199", "supplierName": "Distribuidora X",
  "issuedAt": "2026-10-10T08:00:00", "totalValue": 1834.50, "itemsCount": 12, "volumes": 30,
  "source": "SEFAZ", "complete": true,
  "checkStatus": "CONCLUIDA", "checkId": "...", "checkedAt": "2026-10-12T10:20:00", "checkedBy": "Bipae: João",
  "items": [ {
    "item": 1, "gtin": "7894900010015", "packGtin": "7894900010220", "supplierCode": "55406",
    "invoiceDescription": "REFRIG COCA COLA LT 350ML CX/6", "description": "Refrigerante Coca-Cola Lata 350ml",
    "ncm": "22021000", "cfop": "5401",
    "invoiceUnit": "CX", "invoiceQuantity": 16, "invoiceUnitPrice": 15.10, "total": 241.60, "discount": 0,
    "saleUnit": "LAT", "unitsPerPack": 6,
    "expectedUnits": 96, "receivedUnits": 90, "unitCost": 2.516979,
    "lot": "L123", "expiry": "2027-03-01", "divergence": "AVARIA"
  } ]
}
```
`checkStatus` pode ser `NAO_INICIADA`, `EM_ANDAMENTO` ou `CONCLUIDA`.

**Dar entrada no Bipae** (quando `checkStatus = CONCLUIDA`; ou sem conferência, se a loja configurar "entrada direta pela nota"):
1. **Achar o produto do Bipae, nesta ordem:**
   1. `gtin`;
   2. `packGtin` (código da embalagem);
   3. de-para **fornecedor + supplierCode** (tabela do Bipae, aprendida na primeira vez).
2. **Não achou:** tela "Produtos novos nesta nota", pré-preenchida por `POST /catalog/products/lookup` com os `gtin`. O usuário revisa e cadastra, e o de-para fica gravado.
3. **Quantidade:** `receivedUnits` (já em unidades de venda). Se a conferência foi pulada, `expectedUnits`.
4. **Custo unitário:** `unitCost` (por unidade de venda, da própria nota). Atualize o custo médio e o último custo do produto.
5. Registre lote e validade, se o Bipae controlar.
6. **Idempotência:** use `accessKey` + `checkId`. A mesma conferência nunca dá entrada duas vezes. Uma conferência refeita (outro `checkId`) gera um ajuste da diferença.
7. Fornecedor pelo `supplierCnpj`: crie se não existir.
8. Divergências (falta, avaria, trocado) vão para um relatório "Pendências com fornecedor", para cobrar crédito ou devolução.

Ao dar entrada, **não** é preciso mandar `receipts` ao MercadoFlow: a conferência já registrou a entrada lá.

---

## 7. Módulo 4: Vendas e inteligência (loja vinculada)

### 7.1 Vendas do caixa: `POST /markets/{marketId}/sales` (escopo `sales:write`)
Cada NFC-e autorizada vai para a outbox. Lotes de até 500, a cada 30 a 60 s ou a cada 100 vendas.
```json
{ "items": [ {
  "chaveNFe": "41261012345678000199650010000012341000012345",
  "cnpjEmitente": "12345678000199",
  "dataEmissao": "2026-10-12T14:31:05-03:00",
  "serie": "1", "numero": "1234", "valorTotal": 57.80,
  "cpfCnpjDestinatario": "12345678909",
  "emitente": { "logradouro": "Rua X", "numero": "10", "bairro": "Centro", "municipio": "Curitiba", "codigoMunicipio": "4106902", "uf": "PR", "cep": "80000000" },
  "items": [ {
    "codigoEAN": "7891000100103", "codigoInterno": "1020", "descricao": "LEITE INTEGRAL 1L",
    "ncm": "04012010", "cfop": "5102", "quantidade": 2, "valorUnitario": 5.49, "valorTotal": 10.98,
    "valorDesconto": 0.50, "valorFrete": 0, "valorOutros": 0, "valorLiquido": 10.48,
    "icms": 1.89, "pis": 0.07, "cofins": 0.33
  } ]
} ] }
```
| Campo | Regra |
|---|---|
| Obrigatórios | `chaveNFe` (44 dígitos), `cnpjEmitente`, `dataEmissao` (ISO com fuso = `dhEmi`), `valorTotal`, `items`. Em cada item: `codigoEAN`, `descricao`, `quantidade`, `valorUnitario`, `valorTotal` |
| Sem código de barras | `codigoEAN: "SEM GTIN"` (como na nota) e `codigoInterno` = código do produto no Bipae |
| Balança | `quantidade` em kg; `valorUnitario` = R$/kg |
| `valorLiquido` | Já com o rateio do desconto do cupom |
| Só NFC-e autorizada | Contingência entra quando autorizar |

Status por venda:
| `status` | O que o Bipae faz |
|---|---|
| `GRAVADO`, `JA_RECEBIDA` | Venda sincronizada |
| `RECUSADO` | Dado errado: registre, mostre no painel e não repita |
| `LIMITE_DO_PLANO` | Pause a loja por 6 h e mostre "Limite do plano do MercadoFlow" com link para `/app/planos` |

Também:
- `?dryRun=true` valida sem gravar;
- **cancelamento:** `POST /markets/{id}/sales/cancel` com `{ "items": [ { "chaveNFe": "..." } ] }` → `CANCELADA` ou `NAO_ENCONTRADA` (os dois são sucesso). Na outbox, sempre depois da venda.

### 7.2 Cadastro, preço, custo e estoque da loja (`catalog:write`, `prices:write`, `costs:write`, `stock:write`)
Lotes de até 1.000, com `Idempotency-Key`.

| Recurso | Quando | Item |
|---|---|---|
| `POST /markets/{id}/products` | Carga inicial e produto novo | `gtin`, `description`, `department`, `brand`, `unit` |
| `POST /markets/{id}/suppliers` | Carga inicial e fornecedor novo | `cnpj`, `legalName`, `tradeName`, `email`, `phone` |
| `POST /markets/{id}/prices` | Carga inicial e cada alteração | `gtin`, `price`, `promoPrice`, `promoStart`, `promoEnd` (AAAA-MM-DD) |
| `POST /markets/{id}/costs` | Entrada fora do Confere e mudança de custo | `gtin`, `unitCost`, `at` |
| `POST /markets/{id}/stock` | 1 vez por dia (madrugada) e depois de inventário | `gtin`, `units` (unidade de venda), `at` |
| `POST /markets/{id}/receipts` | Entrada lançada **fora** do Confere | `supplierCnpj`, `supplierName`, `number`, `receivedAt`, `items[]` (`gtin`, `quantity`, `unitCost`) |

### 7.3 Inteligência (`insights:read`, `promotions:read`, `catalog:read`)
| Endpoint | Onde mostrar no Bipae |
|---|---|
| `GET /markets/{id}/decisions?limit=20&actionType=COMPRAR` → `{ total, byActionType, expectedImpactValue, lockedByPlan, url, items:[{ id, actionType, title, rationale, gtin, productName, imageUrl, expectedImpactValue, confidence, suggestion, url }] }` | **Painel inicial:** "Tino: X decisões (R$ Y em jogo)". **Pedido de compra:** "Sugestão do Tino" (`suggestion.quantidade`). Cada item abre `url` no MercadoFlow; **a decisão é tomada lá**. Cache de 15 min |
| `GET /markets/{id}/local-prices?gtins=a,b` → mediana, faixa (p25 a p75), menor preço e loja, raio | Tela de alterar preço e ficha do produto. Cache de 24 h |
| `GET /markets/{id}/promotions` → encartes publicados com `validFrom`, `validUntil` e `items[{ gtin, promoPrice, regularPrice, unit, deal }]` | Viram **promoção pendente** no Bipae (ou automática, se configurado), aplicada no caixa na vigência. Depois, mande o preço em `/prices` |
| `GET /markets/{id}/catalog/{gtin}` | Versão por loja do catálogo, com o NCM das notas dessa loja. **Prefira o catálogo global** (seção 4) |

### 7.4 Carga inicial depois de vincular
Em background, respeitando o limite, nesta ordem:
1. `suppliers`;
2. `products`;
3. `prices`;
4. `costs`;
5. `stock`;
6. `sales` dos últimos 90 dias, do mais antigo para o mais novo (o histórico não gasta a cota do plano).

Mostre o progresso.

---

## 8. Webhooks (avisos do MercadoFlow ao Bipae)

Registre uma vez, num script de setup:
```
PUT /webhook   { "url": "http://bipae-api:3333/v1/integrations/mercadoflow/webhook" }
```
→ `{ "secret": "whsec_..." }`. Guarde em `MERCADOFLOW_WEBHOOK_SECRET`; **só aparece nessa resposta.**

Implemente `POST /v1/integrations/mercadoflow/webhook`:
- Header `X-MercadoFlow-Signature: sha256=<hex>` = HMAC-SHA256 do **corpo cru** com o secret. Compare em tempo constante; inválido → 401.
- `X-MercadoFlow-Delivery`: id único da entrega. Ignore repetidos.
- Responda 2xx em até 15 s e processe de forma assíncrona. Fora disso, o MercadoFlow tenta de novo até 8 vezes.
- Envelope: `{ "event", "marketId", "occurredAt", "data" }`. Datas em ISO-8601.

| Evento | `data` | Ação no Bipae |
|---|---|---|
| `connection.authorized` | `externalStoreId`, `scopes`, `authorizedBy` | Ativa o vínculo, envia `PUT /customer` e começa a carga inicial |
| `connection.revoked` | `revokedBy` | Marca revogado, para tudo e mostra o motivo |
| `confere.document.received` | Cabeçalho da nota (`documentId`, `accessKey`, `supplierName`, `number`, `issuedAt`, `totalValue`, `itemsCount`, ...) | Notificação "Chegou nota de Distribuidora X (R$ 1.834,50) para conferir" e badge no menu Notas de entrada |
| `confere.check.finished` | `entry` completo (6.4) | Dá entrada no estoque (6.4) |
| `price.approved` | `gtin`, `price`, `approvedBy` | Alteração de preço pendente ("Preços aprovados no MercadoFlow") |
| `order.sent` | `orderNumber`, `supplierCnpj`, `supplierName`, `totalValue`, `items[]` | Pedido de compra "Enviado ao fornecedor" no Bipae |

Um aviso pode se perder (o Bipae fora do ar por horas). Por isso:
- quando a tela de notas abrir, compare `GET /confere/documents` com o que o Bipae já tem;
- sincronize `/me` uma vez por dia.

---

## 9. Telas a construir no Bipae (resumo)

1. **Configurações → MercadoFlow:**
   - criar ou vincular conta (com o desconto em destaque);
   - situação, permissões, desconto, última venda enviada, fila e erros;
   - "Abrir o MercadoFlow" e "Gerenciar permissões" (`/app/integracoes`).
2. **Cadastro de produto:**
   - código de barras preenche tudo;
   - "Buscar no catálogo" por nome;
   - "Foto genérica" para balança;
   - imagem baixada para o Bipae.
3. **Caixa:** cadastro rápido de código desconhecido (com permissão) e consulta com tempo limite.
4. **Importar produtos:** revisão do lote pelo catálogo.
5. **Compras → Notas de entrada (Confere):**
   - lista, ler pela chave ou importar XML;
   - certificado A1, saldo e compra de leituras;
   - conferência (cega ou aberta, bipando);
   - entrada no estoque, produtos novos e pendências com fornecedor.
6. **Painel inicial:** card do Tino.
7. **Preço:** preço da região e preços aprovados pendentes.
8. **Promoções:** encartes do MercadoFlow pendentes ou automáticos.

## 10. Testes obrigatórios

- Token: cache, renovação e 401 → renova uma vez.
- Catálogo:
  - GTIN encontrado, não encontrado e inválido;
  - tempo limite no caixa;
  - busca com acento;
  - lote de 200;
  - imagem baixada.
- Contribuição: `RECUSADO` não entra em loop.
- `POST /accounts`: 201, 409 com `connect` e 400.
- Vínculo: webhook antes e depois do redirecionamento; polling; expirado.
- `PUT /customer` ao mudar a assinatura Bipae.
- Webhook: assinatura válida e inválida, entrega repetida.
- Confere:
  - certificado com senha errada e vencido;
  - leitura pela chave;
  - nota `SUMMARY`;
  - contagem salva e retomada;
  - conferência cega;
  - entrada idempotente (mesmo `checkId` duas vezes = 1 entrada);
  - produto achado por `packGtin` e por de-para de fornecedor;
  - item sem produto → cadastro pelo catálogo.
- Vendas:
  - `SEM GTIN`, balança e desconto rateado;
  - outbox com o MercadoFlow fora do ar;
  - `LIMITE_DO_PLANO` pausa;
  - cancelamento antes e depois do envio.
- Contra o MercadoFlow real: vendas com `?dryRun=true`.

## 11. Referência rápida (prefixo `{MERCADOFLOW_API_URL}`)

| Método | Caminho | Escopo / requisito |
|---|---|---|
| POST | `/oauth/token` | — |
| GET | `/me` | — |
| PUT | `/webhook` | — |
| GET | `/catalog/products/{gtin}` | parceiro da casa |
| POST | `/catalog/products/lookup` | parceiro da casa |
| GET | `/catalog/search` | parceiro da casa |
| GET | `/catalog/generic-images` | parceiro da casa |
| POST | `/catalog/contributions` | parceiro da casa |
| POST | `/accounts` | parceiro da casa |
| POST | `/connect` · GET `/connect/{code}` | — |
| PUT | `/markets/{id}/customer` · GET `/markets/{id}/benefit` | loja vinculada |
| POST | `/markets/{id}/sales` · `/sales/cancel` | `sales:write` |
| GET | `/markets/{id}/confere/status` · `/ledger` · `/documents` · `/documents/{d}` · `/documents/{d}/entry` · `/orders/{o}` | `confere:use` |
| POST | `/markets/{id}/confere/terms` · `/certificate` · `/read` · `/upload` · `/sync` · `/orders` | `confere:use` |
| PUT | `/markets/{id}/confere/documents/{d}/check` | `confere:use` |
| DELETE | `/markets/{id}/confere/certificate` | `confere:use` |
| GET | `/markets/{id}/decisions` · `/local-prices` | `insights:read` |
| GET | `/markets/{id}/promotions` | `promotions:read` |
| GET | `/markets/{id}/catalog/{gtin}` · POST `/catalog/lookup` | `catalog:read` |
| POST | `/markets/{id}/products` · `/suppliers` | `catalog:write` |
| POST | `/markets/{id}/prices` | `prices:write` |
| POST | `/markets/{id}/costs` | `costs:write` |
| POST | `/markets/{id}/stock` | `stock:write` |
| POST | `/markets/{id}/receipts` | `receipts:write` |
| GET | `/markets/{id}/inbound-products` · `/inbound-receipts` | `inbound:read` |

Cada chamada aparece para o dono da loja em MercadoFlow → Integrações.
