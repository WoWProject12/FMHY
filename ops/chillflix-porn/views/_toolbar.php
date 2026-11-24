<?php
declare(strict_types=1);
/**
 * Compact Chillflix-style filter toolbar.
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
$activeCatSlug = (string) ($filters['category'] ?? '');
$q = (string) ($filters['q'] ?? ($q ?? ''));

$sortLabels = [
    'new' => 'Newest',
    'views' => 'Most viewed',
    'long' => 'Longest',
    'short' => 'Shortest',
    'az' => 'A–Z',
];
$durationLabels = [
    'any' => 'Any length',
    'short' => 'Under 10 min',
    'medium' => '10–20 min',
    'long' => '20+ min',
];
$periodLabels = [
    'any' => 'All time',
    'day' => 'Today',
    'week' => 'This week',
    'month' => 'This month',
    'year' => 'This year',
];
$densityLabels = [
    'cozy' => 'Comfortable',
    'compact' => 'Compact',
];

$catLabel = $activeCatName ?: ($activeCatSlug !== '' ? $activeCatSlug : 'All categories');
$hasAdvanced = ($filters['duration'] ?? 'any') !== 'any'
    || ($filters['period'] ?? 'any') !== 'any'
    || ($filters['density'] ?? 'cozy') !== 'cozy'
    || ($filters['sort'] ?? 'new') !== 'new';
$clearHref = cfp_url($actionPath);
if ($actionPath === '/search' && $q !== '') {
    $clearHref = cfp_url('/search?q=' . rawurlencode($q));
}
?>
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
          <input type="search" placeholder="Filter categories…" data-cfp-dd-filter autocomplete="off">
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
        <div class="cfp-dd-foot">
          <a href="<?= cfp_e(cfp_url('/categories')) ?>">Browse all</a>
        </div>
      </div>
    </div>

    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn" aria-expanded="false">
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
      <button type="button" class="cfp-dd-btn<?= ($filters['duration'] ?? 'any') !== 'any' ? ' is-active' : '' ?>" aria-expanded="false">
        <span class="cfp-dd-kicker">Length</span>
        <span class="cfp-dd-value"><?= cfp_e($durationLabels[$filters['duration']] ?? 'Any length') ?></span>
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

    <button type="button" class="cfp-adv-toggle<?= $hasAdvanced ? ' is-on' : '' ?>" data-cfp-adv-toggle aria-expanded="<?= $hasAdvanced ? 'true' : 'false' ?>">
      Advanced
      <span class="cfp-dd-caret" aria-hidden="true"></span>
    </button>

    <?php if ($hasAdvanced || $activeCatSlug !== ''): ?>
      <a class="cfp-clear" href="<?= cfp_e($clearHref) ?>">Clear</a>
    <?php endif; ?>

    <div class="cfp-toolbar-meta" aria-live="polite">
      <?php if (isset($resultsTotal)): ?>
        <span><?= number_format((int) $resultsTotal) ?> videos</span>
      <?php endif; ?>
    </div>
  </div>

  <div class="cfp-adv" data-cfp-adv<?= $hasAdvanced ? '' : ' hidden' ?>>
    <div class="cfp-adv-grid">
      <label class="cfp-field">
        <span>Period</span>
        <select data-cfp-field-select="period">
          <?php foreach ($periodLabels as $val => $label): ?>
            <option value="<?= cfp_e($val) ?>"<?= $filters['period'] === $val ? ' selected' : '' ?>><?= cfp_e($label) ?></option>
          <?php endforeach; ?>
        </select>
      </label>
      <label class="cfp-field">
        <span>Density</span>
        <select data-cfp-field-select="density">
          <?php foreach ($densityLabels as $val => $label): ?>
            <option value="<?= cfp_e($val) ?>"<?= $filters['density'] === $val ? ' selected' : '' ?>><?= cfp_e($label) ?></option>
          <?php endforeach; ?>
        </select>
      </label>
      <label class="cfp-field">
        <span>Per page</span>
        <select data-cfp-field-select="per">
          <?php foreach ([12, 24, 36, 48] as $n): ?>
            <option value="<?= $n ?>"<?= (int) $filters['per'] === $n ? ' selected' : '' ?>><?= $n ?></option>
          <?php endforeach; ?>
        </select>
      </label>
      <div class="cfp-field cfp-field-apply">
        <span>&nbsp;</span>
        <button type="submit" class="cfp-btn cfp-btn-primary cfp-btn-sm">Apply</button>
      </div>
    </div>
  </div>
</form>
