<?php
declare(strict_types=1);
/** @var array{items:list<array>,total:int,page:int,per:int,pages:int} $people */
/** @var string $peopleQ */
/** @var string $peopleSort */
/** @var string $peopleRole */
$peopleQ = $peopleQ ?? '';
$peopleSort = (string) ($peopleSort ?? 'popular');
$peopleRole = (string) ($peopleRole ?? 'model');
if (!in_array($peopleSort, ['popular', 'videos', 'az', 'new'], true)) {
    $peopleSort = 'popular';
}
if (!in_array($peopleRole, ['model', 'channel', 'any'], true)) {
    $peopleRole = 'model';
}
$items = $people['items'] ?? [];

$sortOpts = [
    'popular' => 'Popularity',
    'videos' => 'Most videos',
    'new' => 'Recently active',
    'az' => 'A–Z',
];
$roleOpts = [
    'model' => 'People',
    'channel' => 'Channels',
    'any' => 'Everyone',
];

$buildPeopleUrl = static function (array $overrides = []) use ($peopleQ, $peopleSort, $peopleRole): string {
    $qs = array_merge([
        'q' => $peopleQ,
        'sort' => $peopleSort,
        'role' => $peopleRole,
    ], $overrides);
    if (($qs['q'] ?? '') === '') {
        unset($qs['q']);
    }
    if (($qs['sort'] ?? 'popular') === 'popular') {
        unset($qs['sort']);
    }
    if (($qs['role'] ?? 'model') === 'model') {
        unset($qs['role']);
    }
    unset($qs['page']);
    $query = http_build_query($qs);
    return cfp_url('/people' . ($query !== '' ? '?' . $query : ''));
};
?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h1 class="cfp-page-title">People</h1>
    <span><?= (int) ($people['total'] ?? count($items)) ?></span>
  </div>

  <form class="cfp-people-tools" action="<?= cfp_e(cfp_url('/people')) ?>" method="get" role="search">
    <?php if ($peopleSort !== 'popular'): ?>
      <input type="hidden" name="sort" value="<?= cfp_e($peopleSort) ?>">
    <?php endif; ?>
    <?php if ($peopleRole !== 'model'): ?>
      <input type="hidden" name="role" value="<?= cfp_e($peopleRole) ?>">
    <?php endif; ?>
    <label class="cfp-cats-search cfp-people-search">
      <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Find people</span>
      <span class="cfp-people-search-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </span>
      <input type="search" name="q" placeholder="Search people or channels…" value="<?= cfp_e($peopleQ) ?>" autocomplete="off" enterkeyhint="search">
    </label>
    <?php if ($peopleQ !== '' || $peopleSort !== 'popular' || $peopleRole !== 'model'): ?>
      <a class="cfp-chip" href="<?= cfp_e(cfp_url('/people')) ?>">Clear</a>
    <?php endif; ?>
  </form>

  <div class="cfp-people-filters" aria-label="People filters">
    <div class="cfp-seg" role="group" aria-label="Type">
      <?php foreach ($roleOpts as $key => $label): ?>
        <a class="cfp-seg-item<?= $peopleRole === $key ? ' is-on' : '' ?>" href="<?= cfp_e($buildPeopleUrl(['role' => $key])) ?>"><?= cfp_e($label) ?></a>
      <?php endforeach; ?>
    </div>
    <div class="cfp-seg" role="group" aria-label="Sort">
      <?php foreach ($sortOpts as $key => $label): ?>
        <a class="cfp-seg-item<?= $peopleSort === $key ? ' is-on' : '' ?>" href="<?= cfp_e($buildPeopleUrl(['sort' => $key])) ?>"><?= cfp_e($label) ?></a>
      <?php endforeach; ?>
    </div>
  </div>

  <?php if (!$items): ?>
    <p class="cfp-empty">No people found<?= $peopleQ !== '' ? ' for “' . cfp_e($peopleQ) . '”' : '' ?>.</p>
  <?php else: ?>
    <div class="cfp-people-grid">
      <?php foreach ($items as $p):
        $n = (int) ($p['n'] ?? 0);
        $pop = (int) ($p['popularity'] ?? 0);
        $role = (string) ($p['role'] ?? $peopleRole);
      ?>
        <a class="cfp-people-card" href="<?= cfp_e(cfp_url('/people/' . rawurlencode((string) $p['slug']))) ?>">
          <span class="cfp-people-avatar" aria-hidden="true">
            <?php if (!empty($p['thumb'])): ?>
              <img src="<?= cfp_e((string) $p['thumb']) ?>" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
            <?php else: ?>
              <span><?= cfp_e(strtoupper(substr((string) $p['name'], 0, 1))) ?></span>
            <?php endif; ?>
          </span>
          <span class="cfp-people-card-meta">
            <strong><?= cfp_e((string) $p['name']) ?></strong>
            <em>
              <?= $n ?> video<?= $n === 1 ? '' : 's' ?>
              <?php if ($pop > 0): ?> · <?= cfp_e(cfp_fmt_views($pop)) ?> views<?php endif; ?>
              <?php if ($peopleRole === 'any' && $role !== ''): ?> · <?= $role === 'channel' ? 'Channel' : 'Person' ?><?php endif; ?>
            </em>
          </span>
        </a>
      <?php endforeach; ?>
    </div>

    <?php
      $pager = $people;
      $qs = [];
      if ($peopleQ !== '') {
          $qs['q'] = $peopleQ;
      }
      if ($peopleSort !== 'popular') {
          $qs['sort'] = $peopleSort;
      }
      if ($peopleRole !== 'model') {
          $qs['role'] = $peopleRole;
      }
      $basePath = '/people' . ($qs ? '?' . http_build_query($qs) : '');
      require __DIR__ . '/_pager.php';
    ?>
  <?php endif; ?>
</section>
