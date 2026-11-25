<?php
declare(strict_types=1);
/** @var array{items:list<array>,total:int,page:int,per:int,pages:int} $people */
/** @var string $peopleQ */
/** @var string $peopleLetter */
$peopleQ = $peopleQ ?? '';
$peopleLetter = strtoupper(trim((string) ($peopleLetter ?? '')));
if ($peopleLetter === 'NUM') {
    $peopleLetter = '#';
}
if ($peopleLetter !== '' && $peopleLetter !== '#' && !preg_match('/^[A-Z]$/', $peopleLetter)) {
    $peopleLetter = '';
}
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
    <?php if ($peopleQ !== '' || $peopleLetter !== ''): ?>
      <a class="cfp-chip" href="<?= cfp_e(cfp_url('/people')) ?>">Clear</a>
    <?php endif; ?>
  </form>

  <?php if ($peopleQ === ''): ?>
  <nav class="cfp-alpha" aria-label="Alphabet">
    <a class="<?= $peopleLetter === '' ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/people')) ?>">All</a>
    <?php foreach (range('A', 'Z') as $L): ?>
      <a class="<?= $peopleLetter === $L ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/people?letter=' . $L)) ?>"><?= cfp_e($L) ?></a>
    <?php endforeach; ?>
    <a class="<?= $peopleLetter === '#' ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/people?letter=NUM')) ?>">#</a>
  </nav>
  <?php endif; ?>

  <?php if (!$items): ?>
    <p class="cfp-empty">No people found<?= $peopleQ !== '' ? ' for “' . cfp_e($peopleQ) . '”' : ($peopleLetter !== '' ? ' for “' . cfp_e($peopleLetter) . '”' : '') ?>.</p>
  <?php else: ?>

  <?php foreach ($groups as $letter => $rows): ?>
    <section class="cfp-people-letter" id="people-<?= cfp_e($letter === '#' ? 'num' : $letter) ?>">
      <h2><?= cfp_e($letter) ?></h2>
      <div class="cfp-people-grid">
        <?php foreach ($rows as $p): ?>
          <a class="cfp-people-card" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($p['slug']))) ?>">
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
    </section>
  <?php endforeach; ?>

  <?php
    $pager = $people;
    $qs = [];
    if ($peopleQ !== '') {
        $qs['q'] = $peopleQ;
    }
    if ($peopleLetter !== '') {
        $qs['letter'] = $peopleLetter === '#' ? 'NUM' : $peopleLetter;
    }
    $basePath = '/people' . ($qs ? '?' . http_build_query($qs) : '');
    require __DIR__ . '/_pager.php';
  ?>
  <?php endif; ?>
</section>
