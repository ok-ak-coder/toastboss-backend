<?php
/**
 * ToastBoss integration for the WordPress child theme.
 */

function toastboss_is_app_page() {
    return is_page('toastboss');
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
                : home_url('/toastboss-api'),
            'appUrl' => home_url('/toastboss'),
        );

        wp_add_inline_script(
            'toastboss-script',
            'window.ToastBossConfig = ' . wp_json_encode($config) . ';',
            'before'
        );
    }
}
add_action('wp_enqueue_scripts', 'toastboss_enqueue_assets');

function toastboss_mark_script_as_module($tag, $handle, $src) {
    if ($handle !== 'toastboss-script') {
        return $tag;
    }

    return '<script type="module" src="' . esc_url($src) . '"></script>';
}
add_filter('script_loader_tag', 'toastboss_mark_script_as_module', 10, 3);
