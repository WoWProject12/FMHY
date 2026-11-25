<?php
declare(strict_types=1);
/** @var array $person */
/** @var array $results */
/** @var array $filters */
$sort = (string) ($filters['sort'] ?? 'views');
?>
<section class="cfp-section cfp-section-tight">
  <header class="cfp-person-head">
    <a class="cfp-person-back" href="<?= cfp_e(cfp_url('/people')) ?>">← People</a>
    <div class="cfp-person-hero">
      <span class="cfp-people-avatar cfp-people-avatar-lg" aria-hidden="true">
        <?php if (!empty($person['thumb'])): ?>
          <img src="<?= cfp_e((string) $person['thumb']) ?>" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
        <?php else: ?>
          <span><?= cfp_e(strtoupper(substr((string) $person['name'], 0, 1))) ?></span>
        <?php endif; ?>
      </span>
      <div>
        <h1 class="cfp-page-title"><?= cfp_e((string) $person['name']) ?></h1>
        <p class="cfp-person-count"><?= (int) $person['n'] ?> videos</p>
      </div>
    </div>
  </header>

  <div class="cfp-person-sort">
    <a class="<?= $sort !== 'new' ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($person['slug']))) ?>">Popular</a>
    <a class="<?= $sort === 'new' ? 'is-on' : '' ?>" href="<?= cfp_e(cfp_url('/people/' . rawurlencode($person['slug']) . '?sort=new')) ?>">Newest</a>
  </div>

  <?php if (empty($results['items'])): ?>
    <p class="cfp-empty">No videos yet.</p>
  <?php else: ?>
    <?php $items = $results['items']; require __DIR__ . '/_grid.php'; ?>
    <?php
      $pager = $results;
      $basePath = '/people/' . $person['slug'] . ($sort === 'new' ? '?sort=new' : '');
      require __DIR__ . '/_pager.php';
    ?>
  <?php endif; ?>
</section>
