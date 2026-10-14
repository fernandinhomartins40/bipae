<?php
// Demonstração/teste da implementação PHP: php -S 127.0.0.1:4620 server/php/demo/router.php
// Banco SQLite em arquivo (PDV_DB), criado na primeira requisição com produtos de exemplo.
declare(strict_types=1);
require __DIR__ . '/../BipaePdv.php';

$file = getenv('PDV_DB') ?: sys_get_temp_dir() . '/bipae-pdv-demo.sqlite';
$fresh = !file_exists($file);
$pdo = new PDO('sqlite:' . $file);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
if ($fresh) {
    $pdo->exec(file_get_contents(__DIR__ . '/../../../sql/sqlite.sql'));
    $pdo->exec("
        create table demo_products (id text primary key, store_id text not null, name text not null, barcode text, sku text,
          price_cents integer not null, unit text not null, weighable integer not null, stock real, active integer not null default 1);
        create view pdv_products as select store_id, id, name, barcode, sku, price_cents, unit, weighable, stock, active from demo_products;
    ");
    $insert = $pdo->prepare('insert into demo_products (id, store_id, name, barcode, sku, price_cents, unit, weighable, stock) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ([
        ['p1', 'Arroz Tipo 1 5kg', '7891000100103', 'ARZ5', 2890, 'UN', 0, 40],
        ['p2', 'Feijão Carioca 1kg', '7891000200100', 'FJC1', 899, 'UN', 0, 60],
        ['p5', 'Banana Prata', null, 'BAN', 699, 'KG', 1, 30],
    ] as [$id, $name, $barcode, $sku, $price, $unit, $weighable, $stock]) {
        $insert->execute([$id, 'loja-demo', $name, $barcode, $sku, $price, $unit, $weighable, $stock]);
    }
}

$users = [
    'token-ana' => [
        'operator' => ['id' => 'u1', 'name' => 'Ana Souza'],
        'storeId' => 'loja-demo',
        'store' => ['name' => 'Mercadinho Demonstração', 'document' => '11222333000181'],
        'settings' => ['paymentMethods' => ['cash', 'pix', 'credit', 'debit'], 'maxDiscountPercent' => 10, 'canCancelSales' => true],
    ],
];

$auth = function () use ($users): ?array {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    return str_starts_with($header, 'Bearer ') ? ($users[substr($header, 7)] ?? null) : null;
};
$stock = function (PDO $pdo, array $change): void {
    $pdo->prepare('update demo_products set stock = stock + ? / 1000.0 where id = ? and store_id = ?')
        ->execute([$change['deltaMilli'], $change['productId'], $change['storeId']]);
};

// Gerente de demonstração (P-05). Na sua aplicação, confira a senha no seu cadastro.
$manager = fn (string $login, string $password, array $operator): ?array =>
    $login === 'gerente@demo' && $password === 'senha-gerente'
        ? ['id' => 'g1', 'name' => 'Gerente Demonstração', 'maxDiscountPercent' => 100]
        : null;

(new BipaePdv($pdo, $auth, $stock, $manager, 'segredo-da-demonstracao-bipae-pdv'))->serve('/api/pdv');
