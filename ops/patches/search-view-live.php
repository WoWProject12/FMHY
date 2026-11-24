<?php declare(strict_types=1); ?>
<section class="browse-page search-page">
  <div class="layout-container">
    <header class="browse-head">
      <h1>Search</h1>
      <form class="search-page-form" action="<?= movy_e(movy_url('/search')) ?>" method="get">
        <input type="search" name="q" value="<?= movy_e($q) ?>" placeholder="Search movies, shows &amp; Live TV" autofocus>
        <button class="btn btn-primary" type="submit">Search</button>
      </form>
    </header>
    <?php if ($q === ''): ?>
      <div id="searchPageRecent" class="search-page-recent">
        <p class="empty-soft">Type a title or Live TV channel to start searching.</p>
      </div>
    <?php elseif (!$items): ?>
      <p class="empty-soft">No results for “<?= movy_e($q) ?>”.</p>
    <?php else: ?>
      <div class="browse-grid">
        <?php foreach ($items as $item): ?>
          <?php movy_partial('card', ['item' => $item]); ?>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </div>
</section>
