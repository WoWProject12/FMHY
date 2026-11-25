<?php
declare(strict_types=1);
/**
 * Compact filter bar — single-line scrollable chips (no tall stacked kickers).
 * @var array $filters
 * @var array $cats
 * @var string $actionPath
 * @var string|null $activeCatName
 * @var int|null $resultsTotal
 */
$filters = $filters ?? cfp_filters_from_request();
$cats = $cats ?? [];
$actionPath = $actionPath ?? '/';
$activeCatName = $activeCatName ?? null;
$activeCatSlugs = $filters['categories'] ?? cfp_parse_category_slugs($filters['category'] ?? '');
$activeCatSlug = $activeCatSlugs ? implode(',', $activeCatSlugs) : '';
$q = (string) ($filters['q'] ?? ($q ?? ''));

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
$durationChip = [
    'any' => 'Duration',
    'short' => '<10 min',
    'medium' => '10–20 min',
    'long' => '20+ min',
];
$periodLabels = [
    'any' => 'All time',
    'day' => 'Last day',
    'week' => 'This week',
    'month' => 'This month',
    'year' => 'This year',
];
$periodChip = [
    'any' => 'Date',
    'day' => 'Last day',
    'week' => 'This week',
    'month' => 'This month',
    'year' => 'This year',
];
$densityLabels = [
    'cozy' => 'Comfortable',
    'compact' => 'Compact grid',
];
$densityChip = [
    'cozy' => 'Display',
    'compact' => 'Compact',
];

if ($activeCatName) {
    $catLabel = (string) $activeCatName;
} elseif (count($activeCatSlugs) > 1) {
    $catLabel = count($activeCatSlugs) . ' categories';
} elseif (count($activeCatSlugs) === 1) {
    $catLabel = $activeCatSlugs[0];
} else {
    $catLabel = 'All categories';
}
$catChip = $activeCatSlugs ? $catLabel : 'Category';
$clearHref = cfp_url($actionPath);
if ($actionPath === '/search' && $q !== '') {
    $clearHref = cfp_url('/search?q=' . rawurlencode($q));
}
$hasFilters = $activeCatSlugs
    || ($filters['sort'] ?? 'new') !== 'new'
    || ($filters['duration'] ?? 'any') !== 'any'
    || ($filters['period'] ?? 'any') !== 'any'
    || ($filters['density'] ?? 'cozy') !== 'cozy'
    || (int) ($filters['per'] ?? 24) !== 24;
$sortVal = (string) ($filters['sort'] ?? 'new');
$periodVal = (string) ($filters['period'] ?? 'any');
$durationVal = (string) ($filters['duration'] ?? 'any');
$densityVal = (string) ($filters['density'] ?? 'cozy');
?>
<div class="cfp-filters-wrap">
<form class="cfp-toolbar" method="get" action="<?= cfp_e(cfp_url($actionPath)) ?>" data-cfp-toolbar>
  <?php if ($q !== '' && $actionPath === '/search'): ?>
    <input type="hidden" name="q" value="<?= cfp_e($q) ?>">
  <?php endif; ?>
  <input type="hidden" name="category" value="<?= cfp_e($activeCatSlug) ?>" data-cfp-field="category">
  <input type="hidden" name="sort" value="<?= cfp_e($sortVal) ?>" data-cfp-field="sort">
  <input type="hidden" name="duration" value="<?= cfp_e($durationVal) ?>" data-cfp-field="duration">
  <input type="hidden" name="period" value="<?= cfp_e($periodVal) ?>" data-cfp-field="period">
  <input type="hidden" name="density" value="<?= cfp_e($densityVal) ?>" data-cfp-field="density">
  <input type="hidden" name="per" value="<?= (int) $filters['per'] ?>" data-cfp-field="per">

  <div class="cfp-toolbar-row">
    <?php if ($hasFilters): ?>
      <a class="cfp-clear" href="<?= cfp_e($clearHref) ?>">Reset</a>
    <?php endif; ?>
    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= $activeCatSlug !== '' ? ' is-active' : '' ?>" aria-expanded="false" aria-haspopup="listbox" aria-label="Category">
        <span class="cfp-dd-kicker">Category</span>
        <span class="cfp-dd-value"><?= cfp_e($catChip) ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu" hidden>
        <div class="cfp-dd-search">
          <input type="search" placeholder="Find a category…" data-cfp-dd-filter autocomplete="off">
        </div>
        <div class="cfp-dd-list" role="listbox">
          <button type="button" class="cfp-dd-option<?= !$activeCatSlugs ? ' is-on' : '' ?>" data-cfp-set="category" data-value="" data-label="all categories">All categories</button>
          <?php foreach ($cats as $c): ?>
            <button type="button" class="cfp-dd-option<?= in_array($c['slug'], $activeCatSlugs, true) ? ' is-on' : '' ?>" data-cfp-set="category" data-value="<?= cfp_e($c['slug']) ?>" data-label="<?= cfp_e(strtolower($c['name'])) ?>">
              <span><?= cfp_e($c['name']) ?></span>
              <em><?= (int) $c['n'] ?></em>
            </button>
          <?php endforeach; ?>
        </div>
        <div class="cfp-dd-foot"><span class="cfp-muted">Use navbar Categories to pick several</span></div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= $sortVal !== 'new' ? ' is-active' : '' ?>" aria-expanded="false" aria-label="Sort">
        <span class="cfp-dd-kicker">Sort</span>
        <span class="cfp-dd-value"><?= cfp_e($sortLabels[$sortVal] ?? 'Newest') ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu cfp-dd-menu-sm" hidden>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($sortLabels as $val => $label): ?>
            <button type="button" class="cfp-dd-option<?= $sortVal === $val ? ' is-on' : '' ?>" data-cfp-set="sort" data-value="<?= cfp_e($val) ?>"><?= cfp_e($label) ?></button>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= $periodVal !== 'any' ? ' is-active' : '' ?>" aria-expanded="false" aria-label="Date">
        <span class="cfp-dd-kicker">Date</span>
        <span class="cfp-dd-value"><?= cfp_e($periodChip[$periodVal] ?? 'Date') ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu cfp-dd-menu-sm" hidden>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($periodLabels as $val => $label): ?>
            <button type="button" class="cfp-dd-option<?= $periodVal === $val ? ' is-on' : '' ?>" data-cfp-set="period" data-value="<?= cfp_e($val) ?>"><?= cfp_e($label) ?></button>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= $durationVal !== 'any' ? ' is-active' : '' ?>" aria-expanded="false" aria-label="Duration">
        <span class="cfp-dd-kicker">Duration</span>
        <span class="cfp-dd-value"><?= cfp_e($durationChip[$durationVal] ?? 'Duration') ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu cfp-dd-menu-sm" hidden>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($durationLabels as $val => $label): ?>
            <button type="button" class="cfp-dd-option<?= $durationVal === $val ? ' is-on' : '' ?>" data-cfp-set="duration" data-value="<?= cfp_e($val) ?>"><?= cfp_e($label) ?></button>
          <?php endforeach; ?>
        </div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn<?= $densityVal !== 'cozy' || (int) $filters['per'] !== 24 ? ' is-active' : '' ?>" aria-expanded="false" aria-label="Display">
        <span class="cfp-dd-kicker">Display</span>
        <span class="cfp-dd-value"><?= cfp_e($densityChip[$densityVal] ?? 'Display') ?></span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu cfp-dd-menu-sm" hidden>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($densityLabels as $val => $label): ?>
            <button type="button" class="cfp-dd-option<?= $densityVal === $val ? ' is-on' : '' ?>" data-cfp-set="density" data-value="<?= cfp_e($val) ?>"><?= cfp_e($label) ?></button>
          <?php endforeach; ?>
          <div class="cfp-dd-sep">Per page</div>
          <?php foreach ([12, 24, 36, 48] as $n): ?>
            <button type="button" class="cfp-dd-option<?= (int) $filters['per'] === $n ? ' is-on' : '' ?>" data-cfp-set="per" data-value="<?= $n ?>"><?= $n ?> videos</button>
          <?php endforeach; ?>
        </div>
      </div>
    </div>
  </div>
</form>
</div>
