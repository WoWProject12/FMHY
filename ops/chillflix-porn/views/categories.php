<?php
declare(strict_types=1);
/** @var array $cats */

// Group A–Z for xvideos-like browsing (dropdown nav + searchable letter sections)
$groups = [];
foreach ($cats as $c) {
    $name = (string) ($c['name'] ?? '');
    $letter = strtoupper(substr($name, 0, 1));
    if (!preg_match('/[A-Z]/', $letter)) {
        $letter = '#';
    }
    $groups[$letter][] = $c;
}
ksort($groups, SORT_STRING);
$letters = array_keys($groups);
?>
<section class="cfp-section cfp-section-tight">
  <div class="cfp-section-head">
    <h1 class="cfp-page-title">Categories</h1>
    <span><?= count($cats) ?></span>
  </div>

  <div class="cfp-cats-tools">
    <div class="cfp-dd" data-cfp-dd>
      <button type="button" class="cfp-dd-btn" aria-expanded="false" aria-haspopup="listbox">
        <span class="cfp-dd-kicker">Jump to</span>
        <span class="cfp-dd-value">Pick a category</span>
        <span class="cfp-dd-caret" aria-hidden="true"></span>
      </button>
      <div class="cfp-dd-menu" hidden>
        <div class="cfp-dd-search">
          <input type="search" placeholder="Find a category…" data-cfp-dd-filter autocomplete="off">
        </div>
        <div class="cfp-dd-list" role="listbox">
          <?php foreach ($cats as $c): ?>
            <a class="cfp-dd-option" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($c['slug']))) ?>" data-label="<?= cfp_e(strtolower($c['name'])) ?>">
              <span><?= cfp_e($c['name']) ?></span>
              <em><?= (int) $c['n'] ?></em>
            </a>
          <?php endforeach; ?>
        </div>
      </div>
    </div>
    <label class="cfp-cats-search">
      <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Filter categories</span>
      <input type="search" placeholder="Filter categories…" data-cfp-cats-filter autocomplete="off">
    </label>
  </div>

  <?php if ($letters): ?>
  <nav class="cfp-alpha" aria-label="Alphabet">
    <?php foreach ($letters as $L): ?>
      <a href="#cat-<?= cfp_e($L === '#' ? 'num' : $L) ?>"><?= cfp_e($L) ?></a>
    <?php endforeach; ?>
  </nav>
  <?php endif; ?>

  <?php foreach ($groups as $letter => $rows): ?>
    <section class="cfp-cat-letter" data-cfp-cat-letter id="cat-<?= cfp_e($letter === '#' ? 'num' : $letter) ?>">
      <h2><?= cfp_e($letter) ?></h2>
      <div class="cfp-cat-list">
        <?php foreach ($rows as $c): ?>
          <a class="cfp-cat-row" href="<?= cfp_e(cfp_url('/?category=' . rawurlencode($c['slug']))) ?>" data-label="<?= cfp_e(strtolower($c['name'])) ?>">
            <span><?= cfp_e($c['name']) ?></span>
            <em><?= (int) $c['n'] ?></em>
          </a>
        <?php endforeach; ?>
      </div>
    </section>
  <?php endforeach; ?>
</section>
