import { PAYMENT_METHODS } from '@bipae/domain';

/**
 * Contrato da API pública do Bipaê (F6-01.b, ADR-0016), escrito à mão. Toda rota daqui existe e
 * é marcada com @PublicApi() — o teste de conformidade confere. Mudança incompatível exige
 * caminho novo.
 */

const cents = { type: 'integer', description: 'Valor em centavos (R$ 12,34 = 1234).' } as const;
const milli = {
  type: 'integer',
  description: 'Quantidade em milésimos (1 unidade = 1000; 0,250 kg = 250).',
} as const;
const id = { type: 'string', format: 'uuid' } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;
const nullable = <T extends object>(schema: T) => ({ anyOf: [schema, { type: 'null' }] });

const pageParams = [
  {
    name: 'cursor',
    in: 'query',
    required: false,
    description: 'O `nextCursor` da página anterior. Sem ele, começa do início.',
    schema: id,
  },
  {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Itens por página (1 a 200).',
    schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
  },
];

const updatedSince = {
  name: 'updatedSince',
  in: 'query',
  required: false,
  description: 'Só o que mudou a partir deste momento (ISO 8601, com fuso). Bom para sincronizar.',
  schema: dateTime,
};

const errors = {
  '400': { $ref: '#/components/responses/Invalid' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
};

const pageOf = (item: string) => ({
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: { type: 'array', items: { $ref: `#/components/schemas/${item}` } },
    nextCursor: {
      ...nullable(id),
      description: 'Passe em `cursor` para a próxima página; nulo no fim.',
    },
  },
});

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'API pública do Bipaê',
    version: '1.0.0',
    description:
      'Leitura de produtos, estoque, clientes e vendas de uma empresa no Bipaê. Autentique com a chave criada em Integrações (API) na retaguarda: `Authorization: Bearer bpk_...`. A chave só tem as permissões escolhidas e pode ser revogada a qualquer momento. Dinheiro em centavos e quantidades em milésimos, sempre inteiros.',
  },
  servers: [{ url: '/v1' }],
  security: [{ apiKey: [] }],
  tags: [
    { name: 'Chave', description: 'Conferir a chave.' },
    { name: 'Catálogo', description: 'Lojas, produtos e estoque (permissão catalog.read).' },
    { name: 'Clientes', description: 'Clientes (permissão parties.read).' },
    { name: 'Vendas', description: 'Vendas e devoluções do caixa (permissão catalog.read).' },
  ],
  paths: {
    '/public/me': {
      get: {
        tags: ['Chave'],
        operationId: 'getMe',
        summary: 'De quem é a chave e o que ela pode',
        responses: {
          '200': {
            description: 'A empresa, a chave e os escopos que valem agora.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } },
          },
          ...errors,
        },
      },
    },
    '/public/stores': {
      get: {
        tags: ['Catálogo'],
        operationId: 'listStores',
        summary: 'Lojas',
        responses: {
          '200': {
            description: 'As lojas da empresa.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['items'],
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/Store' } },
                  },
                },
              },
            },
          },
          ...errors,
        },
      },
    },
    '/public/products': {
      get: {
        tags: ['Catálogo'],
        operationId: 'listProducts',
        summary: 'Produtos, com preço e códigos de barras',
        parameters: [...pageParams, updatedSince],
        responses: {
          '200': {
            description: 'Uma página de produtos, em ordem de cadastro.',
            content: { 'application/json': { schema: pageOf('Product') } },
          },
          ...errors,
        },
      },
    },
    '/public/stock': {
      get: {
        tags: ['Catálogo'],
        operationId: 'listStock',
        summary: 'Saldo de estoque por produto e loja',
        parameters: [
          {
            name: 'productId',
            in: 'query',
            required: false,
            description: 'Um ou mais produtos (repita o parâmetro, até 200).',
            schema: { type: 'array', items: id, maxItems: 200 },
            style: 'form',
            explode: true,
          },
          { name: 'storeId', in: 'query', required: false, schema: id },
        ],
        responses: {
          '200': {
            description: 'O saldo de cada produto em cada loja.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['items'],
                  properties: {
                    items: { type: 'array', items: { $ref: '#/components/schemas/StockBalance' } },
                  },
                },
              },
            },
          },
          ...errors,
        },
      },
    },
    '/public/customers': {
      get: {
        tags: ['Clientes'],
        operationId: 'listCustomers',
        summary: 'Clientes',
        parameters: [...pageParams, updatedSince],
        responses: {
          '200': {
            description: 'Uma página de clientes, em ordem de cadastro.',
            content: { 'application/json': { schema: pageOf('Customer') } },
          },
          ...errors,
        },
      },
    },
    '/public/sales': {
      get: {
        tags: ['Vendas'],
        operationId: 'listSales',
        summary: 'Vendas e devoluções, com itens e pagamentos',
        parameters: [
          ...pageParams,
          {
            name: 'from',
            in: 'query',
            required: false,
            description: 'Vendas a partir deste momento (inclusive).',
            schema: dateTime,
          },
          {
            name: 'to',
            in: 'query',
            required: false,
            description: 'Vendas antes deste momento.',
            schema: dateTime,
          },
        ],
        responses: {
          '200': {
            description: 'Uma página de vendas.',
            content: { 'application/json': { schema: pageOf('Sale') } },
          },
          ...errors,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'bpk_<empresa>_<segredo>',
        description: 'Chave criada em Integrações (API), na retaguarda do Bipaê.',
      },
    },
    responses: {
      Invalid: {
        description: 'Parâmetro inválido.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Unauthorized: {
        description: 'Chave ausente, inválida ou revogada.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'A chave não tem a permissão desta rota, ou a conta está bloqueada.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string', description: 'Mensagem em português, para mostrar.' },
        },
      },
      Me: {
        type: 'object',
        required: ['tenantId', 'tenantName', 'apiKey', 'scopes'],
        properties: {
          tenantId: id,
          tenantName: nullable({ type: 'string' }),
          apiKey: nullable({
            type: 'object',
            required: ['id', 'name'],
            properties: { id, name: nullable({ type: 'string' }) },
          }),
          scopes: { type: 'array', items: { type: 'string' } },
        },
      },
      Store: {
        type: 'object',
        required: ['id', 'name', 'companyId'],
        properties: { id, name: { type: 'string' }, companyId: id },
      },
      Product: {
        type: 'object',
        required: [
          'id',
          'name',
          'sku',
          'unit',
          'priceCents',
          'active',
          'ncm',
          'cest',
          'parentId',
          'attributes',
          'barcodes',
          'updatedAt',
        ],
        properties: {
          id,
          name: { type: 'string' },
          sku: nullable({ type: 'string' }),
          unit: { type: 'string', description: 'Unidade de venda (UN, KG...).' },
          priceCents: cents,
          active: { type: 'boolean' },
          ncm: nullable({ type: 'string' }),
          cest: nullable({ type: 'string' }),
          parentId: { ...nullable(id), description: 'O modelo, quando é uma variação (grade).' },
          attributes: nullable({ type: 'object', additionalProperties: { type: 'string' } }),
          barcodes: { type: 'array', items: { type: 'string' } },
          updatedAt: dateTime,
        },
      },
      StockBalance: {
        type: 'object',
        required: ['productId', 'storeId', 'quantityMilli'],
        properties: { productId: id, storeId: id, quantityMilli: milli },
      },
      Customer: {
        type: 'object',
        required: ['id', 'name', 'taxId', 'email', 'phone', 'marketingConsent', 'updatedAt'],
        properties: {
          id,
          name: { type: 'string' },
          taxId: { ...nullable({ type: 'string' }), description: 'CPF ou CNPJ, só os dígitos.' },
          email: nullable({ type: 'string' }),
          phone: nullable({ type: 'string' }),
          marketingConsent: {
            type: 'boolean',
            description: 'Aceitou receber ofertas (LGPD). Sem ele, não envie marketing.',
          },
          updatedAt: dateTime,
        },
      },
      Sale: {
        type: 'object',
        required: [
          'id',
          'storeId',
          'terminalId',
          'kind',
          'status',
          'originalSaleId',
          'subtotalCents',
          'discountCents',
          'totalCents',
          'occurredAt',
          'cancelledAt',
          'items',
          'payments',
        ],
        properties: {
          id,
          storeId: id,
          terminalId: id,
          kind: { type: 'string', enum: ['sale', 'return'] },
          status: { type: 'string', enum: ['completed', 'cancelled'] },
          originalSaleId: { ...nullable(id), description: 'Na devolução, a venda de origem.' },
          subtotalCents: cents,
          discountCents: cents,
          totalCents: cents,
          occurredAt: dateTime,
          cancelledAt: nullable(dateTime),
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'line',
                'productId',
                'name',
                'unit',
                'quantityMilli',
                'unitPriceCents',
                'discountCents',
                'totalCents',
              ],
              properties: {
                line: { type: 'integer' },
                productId: id,
                name: { type: 'string' },
                unit: { type: 'string' },
                quantityMilli: milli,
                unitPriceCents: cents,
                discountCents: cents,
                totalCents: cents,
              },
            },
          },
          payments: {
            type: 'array',
            items: {
              type: 'object',
              required: ['method', 'amountCents', 'changeCents'],
              properties: {
                method: { type: 'string', enum: [...PAYMENT_METHODS] },
                amountCents: cents,
                changeCents: cents,
              },
            },
          },
        },
      },
    },
  },
} as const;
