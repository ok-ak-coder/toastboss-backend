<?php
/**
 * IDTT Neon Child theme functions.
 *
 * Hosts the new neon-bar site design, ported in page by page from the
 * standalone practice build at public-site/. Each ported page needs its
 * WP Page slug added to idtt_neon_is_ported_page() below.
 */

function idtt_neon_child_enqueue_parent_style() {
    wp_enqueue_style(
        'idtt-neon-child-style',
        get_stylesheet_uri(),
        array('astra-theme-css'),
        wp_get_theme()->get('Version')
    );
}
add_action('wp_enqueue_scripts', 'idtt_neon_child_enqueue_parent_style', 20);

/**
 * Which WP pages should load the neon site's own CSS/JS. Add more slugs
 * here as more pages get ported (about, meet-our-members, meetings,
 * visit, faqs, contact, ...).
 */
function idtt_neon_is_ported_page() {
    return is_front_page();
}

function idtt_neon_enqueue_assets() {
    if (!idtt_neon_is_ported_page()) {
        return;
    }

    $css_path = get_stylesheet_directory() . '/assets/css/neon-site.css';
    $js_path = get_stylesheet_directory() . '/assets/js/neon-site.js';
    $dir_uri = get_stylesheet_directory_uri() . '/assets';

    if (file_exists($css_path)) {
        wp_enqueue_style(
            'idtt-neon-site',
            $dir_uri . '/css/neon-site.css',
            array('idtt-neon-child-style'),
            filemtime($css_path)
        );
    }

    if (file_exists($js_path)) {
        wp_enqueue_script(
            'idtt-neon-site',
            $dir_uri . '/js/neon-site.js',
            array(),
            filemtime($js_path),
            true
        );

        // Image paths inside neon-site.js are built from this base rather
        // than a hardcoded relative "assets/img/", since a WP page URL
        // (e.g. /meetings/) won't resolve a page-relative path the way the
        // standalone site's own HTML files do.
        wp_add_inline_script(
            'idtt-neon-site',
            'window.IDTTImgBase = ' . wp_json_encode($dir_uri . '/img/') . ';',
            'before'
        );
    }
}
add_action('wp_enqueue_scripts', 'idtt_neon_enqueue_assets', 21);
