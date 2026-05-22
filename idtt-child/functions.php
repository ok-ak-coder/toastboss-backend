<?php
/**
 * IDTT child theme functions and ToastBoss integration.
 */

function toastboss_member_portal_slug() {
    return 'member-portal';
}

function idtt_child_enqueue_styles() {
    wp_enqueue_style(
        'idtt-child-style',
        get_stylesheet_uri(),
        array('astra-theme-css'),
        wp_get_theme()->get('Version')
    );
}
add_action('wp_enqueue_scripts', 'idtt_child_enqueue_styles', 20);

function toastboss_register_member_portal_rewrite() {
    add_rewrite_tag('%toastboss_member_portal%', '1');
    add_rewrite_rule(
        '^' . preg_quote(toastboss_member_portal_slug(), '/') . '/?$',
        'index.php?toastboss_member_portal=1',
        'top'
    );
}
add_action('init', 'toastboss_register_member_portal_rewrite');

function toastboss_flush_member_portal_rewrite() {
    toastboss_register_member_portal_rewrite();
    flush_rewrite_rules();
}
add_action('after_switch_theme', 'toastboss_flush_member_portal_rewrite');

function toastboss_maybe_flush_member_portal_rewrite() {
    $rewrite_version = (int) get_option('toastboss_member_portal_rewrite_version', 0);
    if ($rewrite_version >= 1) {
        return;
    }

    toastboss_register_member_portal_rewrite();
    flush_rewrite_rules(false);
    update_option('toastboss_member_portal_rewrite_version', 1, false);
}
add_action('admin_init', 'toastboss_maybe_flush_member_portal_rewrite');

function toastboss_is_app_page() {
    return is_page(toastboss_member_portal_slug()) || get_query_var('toastboss_member_portal') === '1';
}

function toastboss_get_manifest() {
    $manifest_path = get_stylesheet_directory() . '/toastboss-app/.vite/manifest.json';
    if (!file_exists($manifest_path)) {
        return null;
    }

    $manifest = json_decode(file_get_contents($manifest_path), true);
    return is_array($manifest) ? $manifest : null;
}

function toastboss_enqueue_assets() {
    if (!toastboss_is_app_page()) {
        return;
    }

    $manifest = toastboss_get_manifest();
    if (!$manifest || empty($manifest['index.html']['file'])) {
        return;
    }

    $theme_dir = get_stylesheet_directory_uri() . '/toastboss-app/';
    $entry = $manifest['index.html'];
    $script_rel_path = $entry['file'];
    $script_abs_path = get_stylesheet_directory() . '/toastboss-app/' . $script_rel_path;

    if (!empty($entry['css']) && is_array($entry['css'])) {
        foreach ($entry['css'] as $index => $css_rel_path) {
            $css_abs_path = get_stylesheet_directory() . '/toastboss-app/' . $css_rel_path;
            if (!file_exists($css_abs_path)) {
                continue;
            }

            wp_enqueue_style(
                'toastboss-style-' . $index,
                $theme_dir . $css_rel_path,
                array(),
                filemtime($css_abs_path)
            );
        }
    }

    if (file_exists($script_abs_path)) {
        wp_enqueue_script(
            'toastboss-script',
            $theme_dir . $script_rel_path,
            array(),
            filemtime($script_abs_path),
            true
        );

        $config = array(
            'apiBaseUrl' => defined('TOASTBOSS_API_BASE_URL')
                ? TOASTBOSS_API_BASE_URL
                : 'https://toastboss-backend.onrender.com/api',
            'appUrl' => home_url('/member-portal'),
        );

        wp_add_inline_script(
            'toastboss-script',
            'window.ToastBossConfig = ' . wp_json_encode($config) . ';',
            'before'
        );
    }
}
add_action('wp_enqueue_scripts', 'toastboss_enqueue_assets');

function toastboss_load_member_portal_template($template) {
    if (!toastboss_is_app_page()) {
        return $template;
    }

    $portal_template = get_stylesheet_directory() . '/toastboss.php';
    if (file_exists($portal_template)) {
        status_header(200);
        return $portal_template;
    }

    return $template;
}
add_filter('template_include', 'toastboss_load_member_portal_template');

function toastboss_mark_script_as_module($tag, $handle, $src) {
    if ($handle !== 'toastboss-script') {
        return $tag;
    }

    return '<script type="module" src="' . esc_url($src) . '"></script>';
}
add_filter('script_loader_tag', 'toastboss_mark_script_as_module', 10, 3);
