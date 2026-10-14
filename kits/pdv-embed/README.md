# Bipaê PDV Embed

O caixa da Bipaê como **uma tag HTML** para qualquer aplicação web, em qualquer linguagem.

```html
<script src="/bipae-pdv.js"></script>
<bipae-pdv api="/api/pdv"></bipae-pdv>
```

A tela vem pronta:
- **abertura de caixa**, bipagem ou busca por nome, multiplicador (`3*código`), produtos por peso;
- **desconto** com limite e **várias formas de pagamento** com troco;
- CPF/CNPJ na nota;
- **sangria, suprimento e fechamento cego**;
- cancelamento e reimpressão.

Do lado do servidor, a sua aplicação só implementa **9 rotas** de um contrato fixo, usando as próprias tabelas de produtos e o próprio login. Implementações prontas: **Node** e **PHP** (Laravel, WordPress, PHP puro). Para outras linguagens, use o prompt da seção "Outras linguagens".

| | |
|---|---|
| Tamanho | 1 arquivo JS de 18 KB (gzip), sem dependências, estilos isolados (Shadow DOM) |
| Navegadores | Chrome, Edge, Firefox e Safari atuais; computador, tablet e celular |
| Contrato | [`contract/openapi.yaml`](contract/openapi.yaml), versão 1 |
| Garantia | [`conformance/run.mjs`](conformance/run.mjs) testa qualquer backend contra o contrato |

---

## Como funciona

```
 Sua aplicação (qualquer linguagem)
 ┌──────────────────────────────────────────────┐
 │ página do painel                             │
 │   <bipae-pdv api="/api/pdv">  ──fetch──┐     │
 │                                        ▼     │
 │ /api/pdv/*  (9 rotas do contrato)  ◄───┘     │
 │   ├─ login: o da sua aplicação (cookie/token)│
 │   ├─ produtos: view pdv_products → SUA tabela│
 │   └─ vendas/caixa: tabelas pdv_* (sql/)      │
 └──────────────────────────────────────────────┘
```

- **Dinheiro em centavos inteiros e quantidade em milésimos.** Mesmas regras de arredondamento do Bipaê, sem erro de centavo.
- **O servidor confere tudo:** preço atual, totais, limite de desconto e soma dos pagamentos. A tela nunca é a fonte da verdade.
- **Vendas idempotentes:** a tela gera o id da venda. Se a rede cair no meio, ela reenvia e o servidor não duplica.
- **A venda baixa o estoque da sua tabela**, por um gancho (`onStockChange`) que você escreve. O cancelamento devolve.

---

## Integrar em 5 passos

### 1. Copie os arquivos

| Copie | Para quê |
|---|---|
| `dist/bipae-pdv.js` | o componente; sirva como arquivo estático (ex.: `public/bipae-pdv.js`) |
| `sql/<seu banco>.sql` | tabelas do caixa (`postgres.sql`, `mysql.sql` ou `sqlite.sql`) |
| `server/node/bipae-pdv.mjs` **ou** `server/php/BipaePdv.php` | backend pronto |
| `conformance/run.mjs` | para testar a sua integração |

### 2. Crie as tabelas e a view de produtos

Rode o `sql/<seu banco>.sql`. Depois crie a view **`pdv_products`** apontando para a sua tabela de produtos, com exatamente estas colunas:

| coluna | tipo | exemplo |
|---|---|---|
| `store_id` | texto | loja/empresa/tenant dono do produto |
| `id` | texto | id do produto |
| `name` | texto | "Arroz 5kg" |
| `barcode` | texto ou nulo | EAN |
| `sku` | texto ou nulo | código interno |
| `price_cents` | inteiro | 2890 (= R$ 28,90) |
| `unit` | texto | `UN`, `KG`, `L`... |
| `weighable` | booleano | vendido por peso |
| `stock` | número ou nulo | só informativo |
| `active` | booleano | aparece no caixa |

```sql
-- MySQL, com uma tabela "produtos" que guarda preço em reais (DECIMAL)
create view pdv_products as
select cast(p.loja_id as char) as store_id, cast(p.id as char) as id, p.nome as name,
       p.ean as barcode, p.codigo as sku, cast(round(p.preco * 100) as signed) as price_cents,
       coalesce(p.unidade, 'UN') as unit, p.por_peso as weighable, p.estoque as stock, p.ativo as active
from produtos p;
```

Sem lojas no seu sistema? Use um valor fixo: `select '1' as store_id, ...` e `storeId: '1'` no passo 3.

### 3. Ligue as rotas

O backend recebe duas funções suas:
- **`auth`**: quem está logado, de qual loja e com quais regras;
- **`onStockChange`**: como mexer no estoque da sua tabela.

Opcional: **autorização do gerente** para desconto acima do limite. Passe também
`authorizeManager` (confere login e senha do gerente no SEU cadastro e devolve
`{ id, name, maxDiscountPercent }` ou `null`) e um `secret` forte, guardado fora do código. Com os
dois, o caixa pede a senha do gerente em vez de só recusar. O código de autorização vale 5 minutos,
só para aquela loja e aquele desconto. Sem eles, nada muda.

```js
createPdvHandler({
  db, auth, onStockChange,
  authorizeManager: async (req, { login, password }) => {
    const manager = await meusUsuarios.conferirSenha(login, password);
    return manager?.podeAutorizarDesconto ? { id: manager.id, name: manager.nome, maxDiscountPercent: 50 } : null;
  },
  secret: process.env.PDV_SECRET,
});
```

No PHP: `new BipaePdv($pdo, $auth, $stock, $authorizeManager, getenv('PDV_SECRET'))`, com
`$authorizeManager = fn (string $login, string $senha, array $operador): ?array => ...`.

**Laravel** (`routes/web.php`, usa o login e a sessão do Laravel):

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

Route::middleware('auth')->any('/api/pdv/{path?}', function (Request $request, ?string $path = '') {
    require_once base_path('bipae-pdv/server/php/BipaePdv.php');
    $user = $request->user();
    $pdv = new BipaePdv(
        DB::connection()->getPdo(),
        fn () => [
            'operator' => ['id' => (string) $user->id, 'name' => $user->name],
            'storeId' => (string) $user->loja_id,
            'store' => ['name' => $user->loja->nome, 'document' => $user->loja->cnpj],
            'settings' => [
                'paymentMethods' => ['cash', 'pix', 'credit', 'debit'],
                'maxDiscountPercent' => 10,
                'canCancelSales' => $user->can('cancelar-vendas'),
            ],
        ],
        function (PDO $pdo, array $c) {
            $pdo->prepare('update produtos set estoque = estoque + ? / 1000 where id = ? and loja_id = ?')
                ->execute([$c['deltaMilli'], $c['productId'], $c['storeId']]);
        },
    );
    [$status, $body] = $pdv->handle($request->method(), $path ?? '', $request->json()->all(), $request->query());
    return response()->json($body, $status);
})->where('path', '.*');
```

**PHP puro / WordPress**: crie `api/pdv.php`, aponte `/api/pdv/*` para ele no `.htaccess` ou no nginx e chame `(new BipaePdv($pdo, $auth, $onStock))->serve('/api/pdv');`. O exemplo completo está em [`server/php/demo/router.php`](server/php/demo/router.php).

**Node (Express)**:

```js
import { createPdvHandler, expressAdapter, pgDatabase } from './bipae-pdv.mjs';

const pdv = createPdvHandler({
  db: pgDatabase(pool), // pg.Pool; para outro banco, passe { query, transaction } (ver o arquivo)
  auth: (req) =>
    req.user && {
      operator: { id: String(req.user.id), name: req.user.name },
      storeId: String(req.user.storeId),
      store: { name: req.user.storeName, document: req.user.cnpj },
      settings: { paymentMethods: ['cash', 'pix', 'credit', 'debit'], maxDiscountPercent: 10, canCancelSales: true },
    },
  onStockChange: (tx, c) =>
    tx.query('update produtos set estoque = estoque + $1 / 1000.0 where id = $2', [c.deltaMilli, c.productId]),
});
app.use('/api/pdv', express.json(), expressAdapter(pdv));
```

Funciona com qualquer servidor que entregue o `req`/`res` do Node:
- `node:http`;
- Express e Connect;
- NestJS sobre Express, como middleware;
- API routes do Next.js no Pages Router.

Quando o `req.url` chega com o caminho completo (como no Next.js), passe `basePath: '/api/pdv'`.

No Fastify e nos route handlers do App Router do Next.js, use direto as funções de `createPdvRoutes`, como o `createPdvHandler` faz.

### 4. Coloque a tag na página do painel

```html
<script src="/bipae-pdv.js"></script>
<bipae-pdv api="/api/pdv" style="height: calc(100vh - 120px)"></bipae-pdv>
```

**Sem copiar o arquivo:** carregue do site do Bipaê.

- `https://www.bipae.com.br/pdv/1.0.0/bipae-pdv.js`: a versão exata; nunca muda.
- `https://www.bipae.com.br/pdv/1/bipae-pdv.js`: sempre a mais nova do contrato 1, com as correções.

Com a versão exata, use o hash de integridade publicado em
`https://www.bipae.com.br/pdv/versions.json`. Assim, o navegador recusa o arquivo se ele for
alterado:

```html
<script
  src="https://www.bipae.com.br/pdv/1.0.0/bipae-pdv.js"
  integrity="sha384-... (de versions.json)"
  crossorigin="anonymous"
></script>
```

| Framework | Como |
|---|---|
| **Blade (Laravel)** | `<bipae-pdv api="/api/pdv" csrf-token="{{ csrf_token() }}" csrf-header="X-CSRF-TOKEN"></bipae-pdv>` |
| **React / Vite** | script no `index.html`; no JSX, `<bipae-pdv api="/api/pdv" />` (tipos abaixo) |
| **Next.js** | `<Script src="/bipae-pdv.js" />` (de `next/script`) e a tag dentro de um componente `'use client'` |
| **Vue / Nuxt** | `compilerOptions.isCustomElement = (tag) => tag === 'bipae-pdv'` e use a tag no template |
| **Angular** | `schemas: [CUSTOM_ELEMENTS_SCHEMA]` no componente |
| **Django / Rails** | `csrf-token` com o token da página e `csrf-header` = `X-CSRFToken` (Django) ou `X-CSRF-Token` (Rails) |

Tipos para React/TypeScript:

```ts
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'bipae-pdv': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        api: string; token?: string; theme?: 'light' | 'dark' | 'auto';
      };
    }
  }
}
```

### 5. Teste a integração

Use um ambiente de **teste**: o comando abre e fecha caixa e cria vendas.

```bash
node conformance/run.mjs --url http://localhost:8000/api/pdv --cookie "laravel_session=..." --q arroz
node conformance/run.mjs --url http://localhost:3000/api/pdv --token SEU_TOKEN --q arroz
```

`--q` é um texto que encontre um produto vendido por unidade. Com a autorização do gerente ligada, acrescente `--manager login:senha` de um gerente de teste. Quando aparecer "Tudo certo", a integração está pronta.

---

## Referência do componente

**Atributos**

| Atributo | Padrão | |
|---|---|---|
| `api` | obrigatório | endereço base das rotas |
| `token` | — | envia `Authorization: Bearer`; sem ele, usa o cookie da sessão |
| `credentials` | `same-origin` | `include` se a API estiver em outro domínio com cookies |
| `csrf-token` / `csrf-header` | — / `X-CSRF-Token` | proteção CSRF do seu framework |
| `theme` | `light` | `dark` ou `auto` (segue o sistema) |

Propriedades (para não deixar credenciais no HTML): `el.token = '...'`, `el.headers = { ... }` e `el.fetch = minhaFetch`.

**Eventos** (sobem até o `document`; `event.detail` traz os dados):

| Evento | Quando |
|---|---|
| `bipae-pdv:sale` | venda registrada (`detail` = venda) |
| `bipae-pdv:sale-cancelled` | venda cancelada |
| `bipae-pdv:session-opened` / `bipae-pdv:session-closed` | caixa aberto / fechado (fechamento com esperado, contado e diferença) |
| `bipae-pdv:error` | falha ao abrir (ex.: sessão expirada) |

```js
document.addEventListener('bipae-pdv:sale', (e) => console.log('Venda', e.detail.number, e.detail.totalCents));
```

**Visual:** as cores seguem variáveis CSS no próprio elemento:

```css
bipae-pdv { --bipae-primary: #6d28d9; --bipae-primary-hover: #5b21b6; --bipae-radius: 6px; --bipae-font: Inter, sans-serif; }
```

Também dá para trocar `--bipae-bg`, `--bipae-surface`, `--bipae-text`, `--bipae-muted`, `--bipae-border`, `--bipae-accent` e `--bipae-danger`.

**Atalhos:** F2 pagar, F4 desconto, F9 vendas do caixa, Esc fecha janelas, `3*código` multiplica.

---

## Outras linguagens (Python, C#, Java, Go, Ruby...)

Peça a uma IA usando este texto e anexe `contract/openapi.yaml`, `server/node/bipae-pdv.mjs` e `sql/<banco>.sql`:

```text
Implemente no meu projeto <linguagem/framework> as rotas do contrato em contract/openapi.yaml
(Bipaê PDV Embed), sob o prefixo /api/pdv, seguindo a implementação de referência
server/node/bipae-pdv.mjs regra por regra:
- dinheiro em centavos inteiros, quantidade em milésimos, total do item =
  floor((preço × quantidade + 500) / 1000) − desconto;
- venda e movimento de caixa idempotentes pelo id; tudo numa transação; numeração sequencial por loja;
- conferir preço atual, totais, limite de desconto e soma dos pagamentos, com os códigos de erro do contrato
  e mensagens em português para o operador;
- produtos lidos da view pdv_products (crie a view sobre a minha tabela <nome>, colunas no README);
- auth: use o login que o projeto já tem; storeId = <de onde vem a loja do usuário>;
- estoque: na venda subtraia e no cancelamento devolva quantity/1000 em <tabela.coluna>.
No fim, rode: node conformance/run.mjs --url http://localhost:<porta>/api/pdv --cookie/--token ... --q <produto>
e corrija até aparecer "Tudo certo".
```

---

## Segurança

- **Login e permissões são os da sua aplicação.** Proteja a rota `/api/pdv/*` como qualquer outra área do painel.
- **Isolamento:** cada consulta filtra por `store_id`. Garanta que `storeId` venha da sessão do usuário, nunca do navegador.
- O servidor **recalcula** preço, totais e descontos. Alterar o JavaScript no navegador não muda o valor de uma venda.
- **HTTPS em produção.** Com `token`, prefira a propriedade `el.token` a deixar o token no HTML.

## Limites desta versão

- Precisa de internet: venda sem conexão é recurso do Bipaê completo.
- **Não emite nota fiscal (NFC-e).** O comprovante diz "NÃO É DOCUMENTO FISCAL".
- Impressão pelo diálogo do navegador. Impressoras térmicas instaladas no sistema funcionam; não há ESC/POS direto, gaveta nem balança.
- Um caixa aberto por operador. Desconto acima do limite só passa com a autorização do gerente, se a sua aplicação ligar `authorizeManager`; senão, é recusado.

## Atualizar

Substitua o `bipae-pdv.js`. Mudanças que exigem alterar o backend só vêm com uma nova versão do contrato (`X-Bipae-Pdv: 2`), anunciada no CHANGELOG da Bipaê.

## Desenvolvimento (dentro do repositório da Bipaê)

```bash
pnpm --filter @bipae/pdv-embed build    # gera dist/bipae-pdv.js (versione o resultado)
pnpm --filter @bipae/pdv-embed demo     # painel de demonstração em http://127.0.0.1:4600
pnpm --filter @bipae/pdv-embed test     # conformidade das implementações Node e PHP (PHP se instalado)
pnpm --filter @bipae/pdv-embed e2e      # o componente num navegador real
```

As regras de carrinho, pagamento, caixa e comprovante vêm do `@bipae/pdv-core`, o mesmo núcleo do caixa da Bipaê: melhorou lá, melhora aqui no próximo build.
