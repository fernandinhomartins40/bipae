<?php
/**
 * Bipaê PDV Embed — implementação de referência do contrato (contract/openapi.yaml) em PHP 8.1+.
 * Um arquivo, só PDO (MySQL/MariaDB, PostgreSQL ou SQLite). Copie para o seu projeto.
 *
 * PHP puro (arquivo público api/pdv.php, com rewrite de /api/pdv/* para ele):
 *   $pdv = new BipaePdv($pdo, fn () => usuarioLogadoParaPdv());
 *   $pdv->serve('/api/pdv');
 *
 * Laravel: veja o README (rota Route::any('/api/pdv/{path?}', ...) chamando $pdv->handle()).
 *
 * O banco precisa das tabelas de sql/<seu-banco>.sql e da view pdv_products.
 */

declare(strict_types=1);

final class BipaePdvError extends Exception
{
    public function __construct(public int $status, public string $errorCode, string $message, public ?array $details = null)
    {
        parent::__construct($message);
    }
}

final class BipaePdv
{
    private const METHODS = ['cash', 'pix', 'credit', 'debit', 'voucher', 'store_credit'];
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

    /**
     * @param PDO $pdo conexão do seu sistema (ERRMODE_EXCEPTION é ligado aqui)
     * @param callable():(?array) $auth devolve o operador logado ou null:
     *   ['operator' => ['id' => '1', 'name' => 'Ana'], 'storeId' => '1',
     *    'store' => ['name' => 'Loja', 'document' => null, 'address' => null],
     *    'settings' => ['paymentMethods' => ['cash','pix','credit','debit'], 'maxDiscountPercent' => 10, 'canCancelSales' => true]]
     * @param null|callable(PDO, array):void $onStockChange baixa/devolve estoque na SUA tabela:
     *   recebe ['storeId', 'productId', 'deltaMilli' (negativo na venda), 'saleId'], dentro da transação.
     */
    public function __construct(private PDO $pdo, private $auth, private $onStockChange = null)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    // ------------------------------------------------------------------ HTTP

    /** Atende a requisição atual (PHP puro) e encerra. $basePath = prefixo da URL. */
    public function serve(string $basePath = ''): void
    {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $base = rtrim($basePath, '/');
        if ($base !== '' && str_starts_with($path, $base)) {
            $path = substr($path, strlen($base)) ?: '/';
        }
        $raw = file_get_contents('php://input');
        $body = $raw ? json_decode($raw, true) : [];
        [$status, $payload] = $this->handle($_SERVER['REQUEST_METHOD'] ?? 'GET', $path, is_array($body) ? $body : null, $_GET);
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * Núcleo independente de framework.
     * @return array{0:int,1:array} [status HTTP, corpo]
     */
    public function handle(string $method, string $path, ?array $body, array $query): array
    {
        $path = '/' . trim($path, '/');
        try {
            if ($body === null) {
                throw new BipaePdvError(422, 'invalid_request', 'JSON inválido.');
            }
            $routes = [
                ['GET', '#^/me$#', fn ($u) => $this->me($u)],
                ['GET', '#^/products$#', fn ($u) => $this->products($u, $query)],
                ['GET', '#^/cash-session$#', fn ($u) => $this->currentSession($u)],
                ['POST', '#^/cash-session/open$#', fn ($u) => $this->open($u, $body)],
                ['POST', '#^/cash-session/movements$#', fn ($u) => $this->movement($u, $body)],
                ['POST', '#^/cash-session/close$#', fn ($u) => $this->close($u, $body)],
                ['GET', '#^/sales$#', fn ($u) => $this->listSales($u, $query)],
                ['POST', '#^/sales$#', fn ($u) => $this->createSale($u, $body)],
                ['POST', '#^/sales/([^/]+)/cancel$#', fn ($u, $m) => $this->cancelSale($u, rawurldecode($m[1]), $body)],
            ];
            foreach ($routes as [$verb, $pattern, $run]) {
                if (!preg_match($pattern, $path, $m) || $verb !== strtoupper($method)) {
                    continue;
                }
                $user = ($this->auth)();
                if (!$user) {
                    throw new BipaePdvError(401, 'unauthenticated', 'Sua sessão expirou. Entre de novo no sistema.');
                }
                $result = $run($user, $m);
                return isset($result['__status']) ? [$result['__status'], $result['body']] : [200, $result];
            }
            throw new BipaePdvError(404, 'not_found', 'Rota do PDV não encontrada.');
        } catch (BipaePdvError $e) {
            $error = ['code' => $e->errorCode, 'message' => $e->getMessage()];
            if ($e->details) {
                $error['details'] = $e->details;
            }
            return [$e->status, ['error' => $error]];
        } catch (Throwable $e) {
            error_log('[bipae-pdv] ' . $e);
            return [500, ['error' => ['code' => 'internal', 'message' => 'Algo deu errado no servidor. Tente de novo em instantes.']]];
        }
    }

    // ------------------------------------------------------------------ helpers

    public static function brl(int $cents): string
    {
        return ($cents < 0 ? '-' : '') . 'R$ ' . number_format(abs($cents) / 100, 2, ',', '.');
    }

    public static function lineGross(int $unitPriceCents, int $quantityMilli): int
    {
        return intdiv($unitPriceCents * $quantityMilli + 500, 1000);
    }

    private static function now(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }

    private static function isInt(mixed $v, int $min = 0): bool
    {
        return is_int($v) && $v >= $min;
    }

    private static function bad(string $message, string $code = 'invalid_request'): BipaePdvError
    {
        return new BipaePdvError(422, $code, $message);
    }

    private static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    private function rows(string $sql, array $params = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchAll(PDO::FETCH_ASSOC);
    }

    private function row(string $sql, array $params = []): ?array
    {
        return $this->rows($sql, $params)[0] ?? null;
    }

    private function exec(string $sql, array $params = []): void
    {
        $this->pdo->prepare($sql)->execute($params);
    }

    private function transaction(callable $fn): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $result = $fn();
            $this->pdo->commit();
            return $result;
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    private function settings(array $user): array
    {
        $s = $user['settings'] ?? [];
        $methods = array_values(array_intersect($s['paymentMethods'] ?? ['cash', 'pix', 'credit', 'debit'], self::METHODS));
        return [
            'paymentMethods' => $methods,
            'maxDiscountPercent' => $s['maxDiscountPercent'] ?? 10,
            'canCancelSales' => (bool) ($s['canCancelSales'] ?? true),
        ];
    }

    private function openSession(array $user): ?array
    {
        return $this->row(
            'select * from pdv_cash_sessions where store_id = ? and operator_id = ? and closed_at is null order by opened_at desc limit 1',
            [(string) $user['storeId'], (string) $user['operator']['id']],
        );
    }

    private function requireSession(array $user): array
    {
        return $this->openSession($user) ?? throw new BipaePdvError(409, 'no_session', 'Abra o caixa antes de continuar.');
    }

    private function sessionView(array $s): array
    {
        $t = $this->row("select count(*) as n, coalesce(sum(total_cents), 0) as total from pdv_sales where session_id = ? and status = 'completed'", [$s['id']]);
        return [
            'id' => $s['id'],
            'openedAt' => $s['opened_at'],
            'openingCents' => (int) $s['opening_cents'],
            'operator' => ['id' => $s['operator_id'], 'name' => $s['operator_name']],
            'salesCount' => (int) $t['n'],
            'salesTotalCents' => (int) $t['total'],
        ];
    }

    private function expected(array $session): array
    {
        $expected = array_fill_keys(self::METHODS, 0);
        $expected['cash'] += (int) $session['opening_cents'];
        foreach ($this->rows("select p.method, sum(p.amount_cents) as amount from pdv_sale_payments p join pdv_sales s on s.id = p.sale_id where s.session_id = ? and s.status = 'completed' group by p.method", [$session['id']]) as $p) {
            if (isset($expected[$p['method']])) {
                $expected[$p['method']] += (int) $p['amount'];
            }
        }
        foreach ($this->rows('select kind, sum(amount_cents) as amount from pdv_cash_movements where session_id = ? group by kind', [$session['id']]) as $m) {
            $expected['cash'] += $m['kind'] === 'supply' ? (int) $m['amount'] : -(int) $m['amount'];
        }
        return $expected;
    }

    private function loadSale(string $storeId, string $id): ?array
    {
        $sale = $this->row('select * from pdv_sales where id = ? and store_id = ?', [$id, $storeId]);
        if (!$sale) {
            return null;
        }
        $items = $this->rows('select * from pdv_sale_items where sale_id = ? order by line', [$id]);
        $payments = $this->rows('select * from pdv_sale_payments where sale_id = ? order by line', [$id]);
        return [
            'id' => $sale['id'],
            'number' => (int) $sale['number'],
            'status' => $sale['status'],
            'createdAt' => $sale['created_at'],
            'cancelledAt' => $sale['cancelled_at'],
            'items' => array_map(fn ($i) => [
                'productId' => $i['product_id'],
                'name' => $i['name'],
                'unit' => $i['unit'],
                'quantityMilli' => (int) $i['quantity_milli'],
                'unitPriceCents' => (int) $i['unit_price_cents'],
                'discountCents' => (int) $i['discount_cents'],
                'totalCents' => (int) $i['total_cents'],
            ], $items),
            'subtotalCents' => (int) $sale['subtotal_cents'],
            'discountCents' => (int) $sale['discount_cents'],
            'totalCents' => (int) $sale['total_cents'],
            'payments' => array_map(fn ($p) => [
                'method' => $p['method'],
                'amountCents' => (int) $p['amount_cents'],
                'changeCents' => (int) $p['change_cents'],
            ], $payments),
            'customerDocument' => $sale['customer_document'],
            '_sessionId' => $sale['session_id'],
        ];
    }

    private static function publicSale(array $sale): array
    {
        unset($sale['_sessionId']);
        return $sale;
    }

    private static function productView(array $p): array
    {
        $w = $p['weighable'];
        return [
            'id' => (string) $p['id'],
            'name' => $p['name'],
            'barcode' => $p['barcode'] ?? null,
            'sku' => $p['sku'] ?? null,
            'priceCents' => (int) $p['price_cents'],
            'unit' => $p['unit'] ?: 'UN',
            'weighable' => $w === true || $w === 1 || $w === '1' || $w === 't',
            'stock' => $p['stock'] === null ? null : (float) $p['stock'],
        ];
    }

    // ------------------------------------------------------------------ rotas

    private function me(array $u): array
    {
        return [
            'operator' => ['id' => (string) $u['operator']['id'], 'name' => $u['operator']['name']],
            'store' => [
                'name' => $u['store']['name'],
                'document' => $u['store']['document'] ?? null,
                'address' => $u['store']['address'] ?? null,
            ],
            'settings' => $this->settings($u),
        ];
    }

    private function products(array $u, array $q): array
    {
        $limit = min(max((int) ($q['limit'] ?? 20) ?: 20, 1), 50);
        if (!empty($q['barcode'])) {
            $rows = $this->rows("select * from pdv_products where store_id = ? and active = TRUE and barcode = ? limit $limit", [(string) $u['storeId'], (string) $q['barcode']]);
            return ['items' => array_map([self::class, 'productView'], $rows)];
        }
        $text = trim((string) ($q['q'] ?? ''));
        if ($text === '') {
            return ['items' => []];
        }
        $like = '%' . str_replace(['%', '_', '\\'], '', mb_strtolower($text)) . '%';
        $rows = $this->rows(
            "select * from pdv_products where store_id = ? and active = TRUE and (lower(name) like ? or lower(coalesce(sku, '')) like ? or barcode = ?) order by name limit $limit",
            [(string) $u['storeId'], $like, $like, $text],
        );
        return ['items' => array_map([self::class, 'productView'], $rows)];
    }

    private function currentSession(array $u): array
    {
        $s = $this->openSession($u);
        return ['session' => $s ? $this->sessionView($s) : null];
    }

    private function open(array $u, array $body): array
    {
        if (!self::isInt($body['openingCents'] ?? null)) {
            throw self::bad('Informe o troco inicial (pode ser zero).');
        }
        return $this->transaction(function () use ($u, $body) {
            if ($this->openSession($u)) {
                throw new BipaePdvError(409, 'session_open', 'Você já tem um caixa aberto.');
            }
            $this->exec(
                'insert into pdv_cash_sessions (id, store_id, operator_id, operator_name, opened_at, opening_cents) values (?, ?, ?, ?, ?, ?)',
                [self::uuid(), (string) $u['storeId'], (string) $u['operator']['id'], $u['operator']['name'], self::now(), $body['openingCents']],
            );
            return ['__status' => 201, 'body' => ['session' => $this->sessionView($this->openSession($u))]];
        });
    }

    private function movement(array $u, array $body): array
    {
        $id = $body['id'] ?? null;
        if (!is_string($id) || !preg_match(self::UUID, $id)) {
            throw self::bad('Identificador inválido.');
        }
        $kind = $body['kind'] ?? null;
        if (!in_array($kind, ['withdrawal', 'supply'], true)) {
            throw self::bad('Tipo de movimento inválido.');
        }
        if (!self::isInt($body['amountCents'] ?? null, 1)) {
            throw self::bad('Informe um valor maior que zero.');
        }
        $reason = trim((string) ($body['reason'] ?? ''));
        if ($reason === '' || mb_strlen($reason) > 200) {
            throw self::bad('Informe o motivo.');
        }
        $view = fn ($m) => ['id' => $m['id'], 'kind' => $m['kind'], 'amountCents' => (int) $m['amount_cents'], 'reason' => $m['reason'], 'createdAt' => $m['created_at']];
        return $this->transaction(function () use ($u, $body, $id, $kind, $reason, $view) {
            $existing = $this->row('select * from pdv_cash_movements where id = ? and store_id = ?', [$id, (string) $u['storeId']]);
            if ($existing) {
                return ['__status' => 201, 'body' => ['movement' => $view($existing)]];
            }
            $session = $this->requireSession($u);
            if ($kind === 'withdrawal') {
                $cash = $this->expected($session)['cash'];
                if ($body['amountCents'] > $cash) {
                    throw new BipaePdvError(422, 'insufficient_cash', 'A gaveta tem ' . self::brl($cash) . ' em dinheiro. A sangria não pode passar disso.');
                }
            }
            $row = ['id' => $id, 'kind' => $kind, 'amount_cents' => $body['amountCents'], 'reason' => $reason, 'created_at' => self::now()];
            $this->exec(
                'insert into pdv_cash_movements (id, store_id, session_id, kind, amount_cents, reason, created_at) values (?, ?, ?, ?, ?, ?, ?)',
                [$id, (string) $u['storeId'], $session['id'], $kind, $body['amountCents'], $reason, $row['created_at']],
            );
            return ['__status' => 201, 'body' => ['movement' => $view($row)]];
        });
    }

    private function close(array $u, array $body): array
    {
        $counted = array_fill_keys(self::METHODS, 0);
        foreach (($body['countedCents'] ?? []) as $m => $v) {
            if (!in_array($m, self::METHODS, true) || !self::isInt($v)) {
                throw self::bad('Valor contado inválido.');
            }
            $counted[$m] = $v;
        }
        return $this->transaction(function () use ($u, $counted) {
            $session = $this->requireSession($u);
            $expected = $this->expected($session);
            $difference = 0;
            foreach (self::METHODS as $m) {
                $difference += $counted[$m] - $expected[$m];
            }
            $closedAt = self::now();
            $this->exec(
                'update pdv_cash_sessions set closed_at = ?, expected_json = ?, counted_json = ?, difference_cents = ? where id = ?',
                [$closedAt, json_encode($expected), json_encode($counted), $difference, $session['id']],
            );
            return ['closing' => ['closedAt' => $closedAt, 'expectedCents' => $expected, 'countedCents' => $counted, 'differenceCents' => $difference]];
        });
    }

    private function listSales(array $u, array $q): array
    {
        $limit = min(max((int) ($q['limit'] ?? 20) ?: 20, 1), 50);
        $session = $this->openSession($u);
        if (!$session) {
            return ['items' => []];
        }
        $items = [];
        foreach ($this->rows("select id from pdv_sales where session_id = ? order by number desc limit $limit", [$session['id']]) as $r) {
            $items[] = self::publicSale($this->loadSale((string) $u['storeId'], $r['id']));
        }
        return ['items' => $items];
    }

    private function validateSale(array $b, array $settings): void
    {
        if (!is_string($b['id'] ?? null) || !preg_match(self::UUID, $b['id'])) {
            throw self::bad('Identificador da venda inválido.');
        }
        if (!is_array($b['items'] ?? null) || count($b['items']) === 0) {
            throw self::bad('A venda precisa de pelo menos um item.');
        }
        foreach ($b['items'] as $i) {
            if (!is_array($i) || !is_string($i['productId'] ?? null) || !self::isInt($i['quantityMilli'] ?? null, 1)
                || !self::isInt($i['unitPriceCents'] ?? null) || !self::isInt($i['discountCents'] ?? null)) {
                throw self::bad('Item da venda inválido.');
            }
        }
        foreach (['subtotalCents', 'discountCents', 'totalCents'] as $k) {
            if (!self::isInt($b[$k] ?? null)) {
                throw self::bad('Totais da venda inválidos.');
            }
        }
        if (!is_array($b['payments'] ?? null) || count($b['payments']) === 0) {
            throw self::bad('Informe a forma de pagamento.');
        }
        foreach ($b['payments'] as $p) {
            if (!in_array($p['method'] ?? null, $settings['paymentMethods'], true)) {
                throw self::bad('Forma de pagamento não aceita neste caixa.');
            }
            if (!self::isInt($p['amountCents'] ?? null) || !self::isInt($p['changeCents'] ?? null)) {
                throw self::bad('Valor de pagamento inválido.');
            }
            if ($p['changeCents'] > 0 && $p['method'] !== 'cash') {
                throw self::bad('Só pagamento em dinheiro tem troco.');
            }
        }
        $doc = $b['customerDocument'] ?? null;
        if ($doc !== null && !preg_match('/^(\d{11}|\d{14})$/', (string) $doc)) {
            throw self::bad('CPF ou CNPJ do cliente inválido (só números, 11 ou 14 dígitos).');
        }
    }

    private function createSale(array $u, array $b): array
    {
        $settings = $this->settings($u);
        $this->validateSale($b, $settings);
        $storeId = (string) $u['storeId'];
        if ($existing = $this->loadSale($storeId, $b['id'])) {
            return ['sale' => self::publicSale($existing)]; // 200: reenvio
        }
        for ($attempt = 0; ; $attempt++) {
            try {
                return $this->transaction(function () use ($u, $b, $settings, $storeId) {
                    $session = $this->requireSession($u);
                    $ids = array_values(array_unique(array_map(fn ($i) => $i['productId'], $b['items'])));
                    $marks = implode(', ', array_fill(0, count($ids), '?'));
                    $products = [];
                    foreach ($this->rows("select * from pdv_products where store_id = ? and id in ($marks)", [$storeId, ...$ids]) as $p) {
                        $products[(string) $p['id']] = self::productView($p);
                    }
                    $subtotal = 0;
                    $discount = 0;
                    $lines = [];
                    foreach ($b['items'] as $index => $item) {
                        $product = $products[$item['productId']] ?? throw new BipaePdvError(422, 'product_not_found', 'Um dos produtos não existe mais. Remova-o e bipe de novo.');
                        if (!$product['weighable'] && $item['quantityMilli'] % 1000 !== 0) {
                            throw new BipaePdvError(422, 'invalid_quantity', "{$product['name']} é vendido por unidade: use quantidade inteira.");
                        }
                        if ($item['unitPriceCents'] !== $product['priceCents']) {
                            throw new BipaePdvError(422, 'price_changed', "O preço de {$product['name']} mudou para " . self::brl($product['priceCents']) . '. Confira e finalize de novo.', ['productId' => $product['id'], 'priceCents' => $product['priceCents']]);
                        }
                        $gross = self::lineGross($item['unitPriceCents'], $item['quantityMilli']);
                        if ($item['discountCents'] > $gross) {
                            throw self::bad("Desconto maior que o valor de {$product['name']}.");
                        }
                        $subtotal += $gross;
                        $discount += $item['discountCents'];
                        $lines[] = $item + ['line' => $index + 1, 'name' => $product['name'], 'unit' => $product['unit'], 'total' => $gross - $item['discountCents']];
                    }
                    $total = $subtotal - $discount;
                    if ($subtotal !== $b['subtotalCents'] || $discount !== $b['discountCents'] || $total !== $b['totalCents']) {
                        throw new BipaePdvError(422, 'totals_mismatch', 'Os totais da venda não conferem. Atualize a tela e tente de novo.');
                    }
                    if ($discount * 10000 > (int) round($settings['maxDiscountPercent'] * 100) * $subtotal) {
                        throw new BipaePdvError(403, 'discount_not_allowed', "O desconto passa do limite de {$settings['maxDiscountPercent']}% deste caixa.");
                    }
                    $paid = array_sum(array_map(fn ($p) => $p['amountCents'], $b['payments']));
                    if ($paid !== $total) {
                        throw new BipaePdvError(422, 'payments_mismatch', 'Os pagamentos somam ' . self::brl($paid) . ', mas a venda é de ' . self::brl($total) . '.');
                    }
                    $next = (int) $this->row('select coalesce(max(number), 0) + 1 as next from pdv_sales where store_id = ?', [$storeId])['next'];
                    $this->exec(
                        'insert into pdv_sales (id, store_id, session_id, operator_id, number, status, created_at, subtotal_cents, discount_cents, total_cents, customer_document) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [$b['id'], $storeId, $session['id'], (string) $u['operator']['id'], $next, 'completed', self::now(), $subtotal, $discount, $total, $b['customerDocument'] ?? null],
                    );
                    foreach ($lines as $l) {
                        $this->exec(
                            'insert into pdv_sale_items (sale_id, line, product_id, name, unit, quantity_milli, unit_price_cents, discount_cents, total_cents) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [$b['id'], $l['line'], $l['productId'], $l['name'], $l['unit'], $l['quantityMilli'], $l['unitPriceCents'], $l['discountCents'], $l['total']],
                        );
                        if ($this->onStockChange) {
                            ($this->onStockChange)($this->pdo, ['storeId' => $storeId, 'productId' => $l['productId'], 'deltaMilli' => -$l['quantityMilli'], 'saleId' => $b['id']]);
                        }
                    }
                    foreach (array_values($b['payments']) as $n => $p) {
                        $this->exec(
                            'insert into pdv_sale_payments (sale_id, line, method, amount_cents, change_cents) values (?, ?, ?, ?, ?)',
                            [$b['id'], $n + 1, $p['method'], $p['amountCents'], $p['changeCents']],
                        );
                    }
                    return ['__status' => 201, 'body' => ['sale' => self::publicSale($this->loadSale($storeId, $b['id']))]];
                });
            } catch (PDOException $e) {
                // Mesma venda enviada duas vezes ao mesmo tempo, ou dois caixas pegando o mesmo número.
                if ($attempt < 3 && in_array((string) $e->getCode(), ['23000', '23505'], true)) {
                    if ($again = $this->loadSale($storeId, $b['id'])) {
                        return ['sale' => self::publicSale($again)];
                    }
                    continue;
                }
                throw $e;
            }
        }
    }

    private function cancelSale(array $u, string $id, array $body): array
    {
        if (!$this->settings($u)['canCancelSales']) {
            throw new BipaePdvError(403, 'forbidden', 'Você não tem permissão para cancelar vendas.');
        }
        $reason = trim((string) ($body['reason'] ?? ''));
        if (mb_strlen($reason) < 3) {
            throw self::bad('Informe o motivo do cancelamento.');
        }
        $storeId = (string) $u['storeId'];
        return $this->transaction(function () use ($u, $id, $reason, $storeId) {
            $sale = $this->loadSale($storeId, $id) ?? throw new BipaePdvError(404, 'not_found', 'Venda não encontrada.');
            if ($sale['status'] === 'cancelled') {
                return ['sale' => self::publicSale($sale)];
            }
            $session = $this->requireSession($u);
            if ($sale['_sessionId'] !== $session['id']) {
                throw new BipaePdvError(409, 'not_in_session', 'Só dá para cancelar vendas do caixa que está aberto.');
            }
            $this->exec("update pdv_sales set status = 'cancelled', cancelled_at = ?, cancel_reason = ? where id = ?", [self::now(), mb_substr($reason, 0, 200), $id]);
            if ($this->onStockChange) {
                foreach ($sale['items'] as $item) {
                    ($this->onStockChange)($this->pdo, ['storeId' => $storeId, 'productId' => $item['productId'], 'deltaMilli' => $item['quantityMilli'], 'saleId' => $id]);
                }
            }
            return ['sale' => self::publicSale($this->loadSale($storeId, $id))];
        });
    }
}
