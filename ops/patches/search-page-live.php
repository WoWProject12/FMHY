<?php
declare(strict_types=1);

/** @var MovyTmdb $movyTmdb */

$q = trim((string) ($_GET['q'] ?? ''));
$items = [];
if ($q !== '') {
    foreach (movy_search_live_channels($q, 8) as $liveCard) {
        $items[] = $liveCard;
    }
    $raw = $movyTmdb->search($q, 1);
    foreach ($raw['results'] ?? [] as $item) {
        $mt = (string) ($item['media_type'] ?? '');
        if ($mt !== 'movie' && $mt !== 'tv') {
            continue;
        }
        $card = movy_normalize_card($item, $mt);
        if ((int) ($card['id'] ?? 0) <= 0) {
            continue;
        }
        $items[] = $card;
    }
}

$pageTitle = ($q !== '' ? ('Search “' . $q . '”') : 'Search') . ' — ' . movy_config('site_name', 'Chillflix');
$nav = '';
$metaDescription = 'Search movies, TV shows, and Live TV channels on ' . movy_config('site_name', 'Chillflix') . '.';

movy_render('search', compact('pageTitle', 'nav', 'metaDescription', 'q', 'items'));
