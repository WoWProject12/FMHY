<?php
declare(strict_types=1);

$pageTitle = 'Live TV · ' . movy_config('site_name', 'Chillflix');
$nav = 'iptv';
$metaDescription = 'Watch live TV channels on ' . movy_config('site_name', 'Chillflix') . '.';
$bodyClass = 'page-iptv';

movy_render('iptv', compact('pageTitle', 'nav', 'metaDescription', 'bodyClass'));
