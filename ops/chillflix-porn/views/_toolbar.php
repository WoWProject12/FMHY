<?php
declare(strict_types=1);
/**
 * xvideos-style compact filter bar: all controls are dropdowns.
 * @var array $filters
 * @var array $cats
 * @var string $actionPath
 * @var string|null $activeCatName
 * @var int|null $resultsTotal
 * @var bool $showCatQuick  homepage quick tags strip
 */
$filters = $filters ?? cfp_filters_from_request();
$cats = $cats ?? [];
$actionPath = $actionPath ?? '/';
$activeCatName = $activeCatName ?? null;
$activeCatSlug = (string) ($filters['category'] ?? '');
$q = (string) ($filters['q'] ?? ($q ?? ''));
$showCatQuick = !empty($showCatQuick);

$sortLabels = [
    'new' => 'Newest',
    'views' => 'Most viewed',
    'long' => 'Longest',
    'short' => 'Shortest',
    'az' => 'A–Z',
];
$durationLabels = [
    'any' => 'Any duration',
    'short' => 'Short (<10 min)',
    'medium' => 'Medium (10–20)',
    'long' => 'Long (20+ min)',
];
$periodLabels = [
    'any' => 'All time',
    'day' => 'Last day',
    'week' => 'This week',
    'month' => 'This month',
    'year' => 'This year',
];
$densityLabels = [
    'cozy' => 'Comfortable',
    'compact' => 'Compact grid',
];

$catLabel = $activeCatName ?: ($activeCatSlug !== '' ? $activeCatSlug : 'Categories');
$clearHref = cfp_url($actionPath);
if ($actionPath === '/search' && $q !== '') {
    $clearHref = cfp_url('/search?q=' . rawurlencode($q));
}
$hasFilters = $activeCatSlug !== ''
    || ($filters['sort'] ?? 'new') !== 'new'
    || ($filters['duration'] ?? 'any') !== 'any'
    || ($filters['period'] ?? 'any') !== 'any'
    || ($filters['density'] ?? 'cozy') !== 'cozy';
?>
<?php if ($showCatQuick && $cats): ?>
<nav class="cfp-quickcats" aria-label="Popular categories">
  <a class="cfp-quickcat<?= $activeCatSlug === '' ? ' is-on' : '' ?>" href="<?= cfp_e(cfp_url('/')) ?>">All</a>
  <?php foreach (array_slice($cats, 0, 10) as $c): ?>
    <a class="cfp-quickcat<?= $activeCatSlug === $c['slug'] ? ' is-on' : '' ?>" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($c['slug']))) ?>"><?= cfp_e($c['name']) ?></a>
  <?php endforeach; ?>
  <div class="cfp-dd cfp-quickcat-dd" data-cfp-dd>
    <button type="button" class="cfp-dd-btn cfp-quickcat cfp-quickcat-more" aria-expanded="false">
      <span class="cfp-dd-value">More…</span>
      <span class="cfp-dd-caret" aria-hidden="true"></span>
    </button>
    <div class="cfp-dd-menu" hidden>
      <div class="cfp-dd-search">
        <input type="search" placeholder="Find a category…" data-cfp-dd-filter autocomplete="off">
      </div>
      <div class="cfp-dd-list" role="listbox">
        <?php foreach (array_slice($cats, 10) as $c): ?>
          <a class="cfp-dd-option" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($c['slug']))) ?>" data-label="<?= cfp_e(strtolower($c['name'])) ?>">
            <span><?= cfp_e($c['name']) ?></span>
            <em><?= (int) $c['n'] ?></em>
          </a>
        <?php endforeach; ?>
      </div>
      <div class="cfp-dd-foot"><a href="<?= cfp_e(cfp_url('/categories')) ?>">A–Z category list</a></div>
    </div>
  </div>
</nav>
<?php endif; ?>

<form class="cfp-toolbar" method="get" action="<?= cfp_e(cfp_url($actionPath)) ?>" data-cfp-toolbar>
  <?php if ($q !== '' && $actionPath === '/search'): ?>
    <input type="hidden" name="q" value="<?= cfp_e($q) ?>">
  <?php endif; ?>
  <input type="hidden" name="category" value="<?= cfp_e($activeCatSlug) ?>" data-cfp-field="category">
  <input type="hidden" name="sort" value="<?= cfp_e($filters['sort']) ?>" data-cfp-field="sort">
  <input type="hidden" name="duration" value="<?= cfp_e($filters['duration']) ?>" data-cfp-field="duration">
  <input type="hidden" name="period" value="<?= cfp_e($filters['period']) ?>" data-cfp-field="period">
  <input type="hidden" name="density" value="<?= cfp_e($filters['density']) ?>" data-cfp-field="density">
  <input type="hidden" name="per" value="<?= (int) $filters['per'] ?>" data-cfp-field="per">

  <div class="cfp-toolbar-row">
    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= $activeCatSlug !== '' ? ' is-active' : '' ?>" aria-expanded="false" aria-haspopup="listbox">
        <span class="cfp-dd-kicker">Category</span>
        <span class="cfp-dd-value"><?= cfp_e($catLabel) ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu" hidden>
        <div class="cfp-dd-search">
          <input type="search" placeholder="Find a category…" data-cfp-dd-filter autocomplete="off">
        </div>
        <div class="cfp-dd-list" role="listbox">
          <button type="button" class="cfp-dd-option<?= $activeCatSlug === '' ? ' is-on' : '' ?>" data-cfp-set="category" data-value="">All categories</button>
          <?php foreach ($cats as $c): ?>
            <button type="button" class="cfp-dd-option<?= $activeCatSlug === $c['slug'] ? ' is-on' : '' ?>" data-cfp-set="category" data-value="<?= cfp_e($c['slug']) ?>" data-label="<?= cfp_e(strtolower($c['name'])) ?>">
              <span><?= cfp_e($c['name']) ?></span>
              <em><?= (int) $c['n'] ?></em>
            </button>
          <?php endforeach; ?>
        </div>
        <div class="cfp-dd-foot"><a href="<?= cfp_e(cfp_url('/categories')) ?>">Full category list</a></div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= ($filters['sort'] ?? 'new') !== 'new' ? ' is-active' : '' ?>" aria-expanded="false">
        <span class="cfp-dd-kicker">Sort</span>
        <span class="cfp-dd-value"><?= cfp_e($sortLabels[$filters['sort']] ?? 'Newest') ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu cfp-dd-menu-sm" hidden>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($sortLabels as $val => $label): ?>
            <button type="button" class="cfp-dd-option<?= $filters['sort'] === $val ? ' is-on' : '' ?>" data-cfp-set="sort" data-value="<?= cfp_e($val) ?>"><?= cfp_e($label) ?></button>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= ($filters['period'] ?? 'any') !== 'any' ? ' is-active' : '' ?>" aria-expanded="false">
        <span class="cfp-dd-kicker">Date</span>
        <span class="cfp-dd-value"><?= cfp_e($periodLabels[$filters['period']] ?? 'All time') ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu cfp-dd-menu-sm" hidden>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($periodLabels as $val => $label): ?>
            <button type="button" class="cfp-dd-option<?= $filters['period'] === $val ? ' is-on' : '' ?>" data-cfp-set="period" data-value="<?= cfp_e($val) ?>"><?= cfp_e($label) ?></button>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= ($filters['duration'] ?? 'any') !== 'any' ? ' is-active' : '' ?>" aria-expanded="false">
        <span class="cfp-dd-kicker">Duration</span>
        <span class="cfp-dd-value"><?= cfp_e($durationLabels[$filters['duration']] ?? 'Any duration') ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu cfp-dd-menu-sm" hidden>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($durationLabels as $val => $label): ?>
            <button type="button" class="cfp-dd-option<?= $filters['duration'] === $val ? ' is-on' : '' ?>" data-cfp-set="duration" data-value="<?= cfp_e($val) ?>"><?= cfp_e($label) ?></button>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= ($filters['density'] ?? 'cozy') !== 'cozy' || (int) $filters['per'] !== 24 ? ' is-active' : '' ?>" aria-expanded="false">
        <span class="cfp-dd-kicker">Display</span>
        <span class="cfp-dd-value"><?= cfp_e($densityLabels[$filters['density']] ?? 'Comfortable') ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu cfp-dd-menu-sm" hidden>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($densityLabels as $val => $label): ?>
            <button type="button" class="cfp-dd-option<?= $filters['density'] === $val ? ' is-on' : '' ?>" data-cfp-set="density" data-value="<?= cfp_e($val) ?>"><?= cfp_e($label) ?></button>
          <?php endforeach; ?>
          <div class="cfp-dd-sep">Per page</div>
          <?php foreach ([12, 24, 36, 48] as $n): ?>
            <button type="button" class="cfp-dd-option<?= (int) $filters['per'] === $n ? ' is-on' : '' ?>" data-cfp-set="per" data-value="<?= $n ?>"><?= $n ?> videos</button>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

    <?php if ($hasFilters): ?>
      <a class="cfp-clear" href="<?= cfp_e($clearHref) ?>">Reset</a>
    <?php endif; ?>

    <div class="cfp-toolbar-meta">
      <?php if (isset($resultsTotal)): ?>
        <span><?= number_format((int) $resultsTotal) ?></span>
      <?php endif; ?>
    </div>
  </div>
</form>
