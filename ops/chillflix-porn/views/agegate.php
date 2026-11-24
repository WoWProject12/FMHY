<?php
declare(strict_types=1);
$req = (string) ($_SERVER['REQUEST_URI'] ?? cfp_url('/'));
$next = str_starts_with($req, CFP_BASE) ? $req : cfp_url('/');
?>
<section class="cfp-agegate" aria-labelledby="cfpAgeTitle">
  <div class="cfp-agegate-card">
    <p class="cfp-kicker">Chillflix Porn</p>
    <h1 id="cfpAgeTitle">Are you 18 or older?</h1>
    <p>This section contains adult content. Enter only if you are of legal age in your region.</p>
    <form method="post" action="<?= cfp_e(cfp_url('/age-confirm')) ?>">
      <input type="hidden" name="next" value="<?= cfp_e($next) ?>">
      <button type="submit" class="cfp-btn cfp-btn-primary">I am 18+</button>
      <a class="cfp-btn cfp-btn-ghost" href="<?= cfp_e(CFP_MAIN_SITE) ?>">Leave</a>
    </form>
  </div>
</section>
