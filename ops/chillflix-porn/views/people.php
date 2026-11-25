<?php
declare(strict_types=1);
/** @var array{items:list<array>,total:int,page:int,per:int,pages:int} $people */
/** @var string $peopleQ */
$peopleQ = $peopleQ ?? '';
$items = $people['items'] ?? [];

$groups = [];
foreach ($items as $p) {
    $name = (string) ($p['name'] ?? '');
    $letter = strtoupper(substr($name, 0, 1));
    if (!preg_match('/[A-Z]/', $letter)) {
        $letter = '#';
    }
    $groups[$letter][] = $p;
}
ksort($groups, SORT_STRING);
$letters = array_keys($groups);
?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h1 class="cfp-page-title">People</h1>
    <span><?= (int) ($people['total'] ?? count($items)) ?></span>
  </div>

  <form class="cfp-people-tools" action="<?= cfp_e(cfp_url('/people')) ?>" method="get" role="search">
    <label class="cfp-cats-search">
      <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Find people</span>
      <input type="search" name="q" placeholder="Find a person…" value="<?= cfp_e($peopleQ) ?>" autocomplete="off">
    </label>
    <?php if ($peopleQ !== ''): ?>
      <a class="cfp-chip" href="<?= cfp_e(cfp_url('/people')) ?>">Clear</a>
    <?php endif; ?>
  </form>

  <?php if (!$items): ?>
    <p class="cfp-empty">No people found<?= $peopleQ !== '' ? ' for “' . cfp_e($peopleQ) . '”' : '' ?>.</p>
  <?php else: ?>

  <?php if ($letters && $peopleQ === ''): ?>
  <nav class="cfp-alpha" aria-label="Alphabet">
    <?php foreach ($letters as $L): ?>
      <a href="#people-<?= cfp_e($L === '#' ? 'num' : $L) ?>"><?= cfp_e($L) ?></a>
    <?php endforeach; ?>
  </nav>
  <?php endif; ?>

  <div class="cfp-people-grid">
    <?php foreach ($items as $p): ?>
      <a class="cfp-people-card" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($p['slug']))) ?>"<?= $peopleQ === '' ? ' data-letter="' . cfp_e(strtoupper(substr((string) $p['name'], 0, 1))) . '"' : '' ?>>
        <span class="cfp-people-avatar" aria-hidden="true">
          <?php if (!empty($p['thumb'])): ?>
            <img src="<?= cfp_e((string) $p['thumb']) ?>" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
          <?php else: ?>
            <span><?= cfp_e(strtoupper(substr((string) $p['name'], 0, 1))) ?></span>
          <?php endif; ?>
        </span>
        <span class="cfp-people-card-meta">
          <strong><?= cfp_e((string) $p['name']) ?></strong>
          <em><?= (int) $p['n'] ?> videos</em>
        </span>
      </a>
    <?php endforeach; ?>
  </div>

  <?php
    $pager = $people;
    $basePath = '/people' . ($peopleQ !== '' ? '?q=' . rawurlencode($peopleQ) : '');
    require __DIR__ . '/_pager.php';
  ?>
  <?php endif; ?>
</section>
