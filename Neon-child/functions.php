<?php
/** Meta descriptions belong in the document head, not pasted page-body HTML. */
function idtt_neon_key_page_description() {
    if (is_admin() || is_feed() || is_preview() || is_paged() || post_password_required()) {
        return '';
    }
    if (is_front_page()) {
        return "Visit I'll Drink to That Toastmasters in Las Vegas. Build public speaking confidence and meet new friends. Thursdays at 6:30 PM at Rum Runner Lounge.";
    }
    if (is_page('about')) {
        return "Get to know I'll Drink to That Toastmasters, a Las Vegas club since 1977. Practice public speaking, build confidence, and enjoy good company.";
    }
    if (is_page('visit')) {
        return "Visit I'll Drink to That Toastmasters at Rum Runner Lounge, 1801 E Tropicana Ave, Las Vegas. Thursdays at 6:30 PM in the Lombardi Room. Guests welcome.";
    }
    return '';
}

function idtt_neon_print_meta_description() {
    // Let an installed SEO plugin own the tag instead of emitting a duplicate.
    if (defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION') || function_exists('aioseo')) {
        return;
    }
    $description = idtt_neon_key_page_description();
    if ($description !== '') {
        echo '<meta name="description" content="' . esc_attr($description) . '">' . "\n";
    }
}
add_action('wp_head', 'idtt_neon_print_meta_description', 5);

require_once get_stylesheet_directory() . '/inc/meeting-fallback.php';

/** Apply approved copy replacements to existing WordPress homepage content. */
function idtt_neon_homepage_visit_copy($content) {
    if (is_admin() || !is_front_page()) {
        return $content;
    }
    $content = preg_replace(
        '~Public speaking is a lot more fun when the room feels\s+like a hangout, not a boardroom\.~',
        'Our meetings are a lot of fun!',
        $content,
        1
    );
    return preg_replace(
        '~No sign up, no pressure, no obligation to speak a word\. Guests sit, sip, and watch the\s+first time\. Most come back and try it themselves the second\.~',
        'Join us for a meeting, there is no obligation to speak. You are welcome to participate, or to just watch, whatever feels comfortable to you.',
        $content,
        1
    );
}
add_filter('the_content', 'idtt_neon_homepage_visit_copy', 8);

/** Apply the approved Improv Night popup wording to stored meeting content. */
function idtt_neon_improv_popup_copy($content) {
    if (is_admin() || !is_page('meetings')) {
        return $content;
    }
    return preg_replace(
        '~Once a month, on the first Thursday, we trade the usual agenda for games: no prep, no\s+outline, just quick thinking and a little bit of chaos\.~',
        'Join us for Improv Night on the first Thursday of each month, with games and activities to practice quick thinking and impromptu speaking.',
        $content,
        1
    );
}
add_filter('the_content', 'idtt_neon_improv_popup_copy', 8);

/**
 * Exact retired public URLs only. Do not redirect unknown 404s or member
 * profile subpaths. Speech archives need a confirmed replacement first.
 */
function idtt_neon_retired_paths() {
    return array(
        'calendar' => 'meetings',
        'members' => 'meet-our-members',
        'faq' => 'faqs',
        'frequently-asked-questions' => 'faqs',
    );
}

function idtt_neon_redirect_retired_url() {
    if (is_admin() || !is_404() || !in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', array('GET', 'HEAD'), true)) {
        return;
    }

    $request_path = wp_parse_url(wp_unslash($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    foreach (idtt_neon_retired_paths() as $old_slug => $new_slug) {
        $old_path = wp_parse_url(home_url('/' . $old_slug . '/'), PHP_URL_PATH);
        if (untrailingslashit((string) $request_path) !== untrailingslashit($old_path)) {
            continue;
        }

        // Never send a visitor to a replacement page that is missing/private.
        $page = get_page_by_path($new_slug);
        if ($page && $page->post_status === 'publish') {
            wp_safe_redirect(get_permalink($page), 301, 'IDTT retired URL');
            exit;
        }
    }
}
// Run before WordPress attempts to guess a destination for an old slug.
add_action('template_redirect', 'idtt_neon_redirect_retired_url', 1);

/**
 * IDTT Neon Child theme functions.
 *
 * Hosts the new neon-bar site design. The header/menu are Astra's own
 * shared, site-wide elements (not per-page content), so styling them once
 * here affects every page automatically.
 */

/**
 * Which WP pages load the neon design. Applied site-wide, except the
 * member portal — that's a separate React app (the ToastBoss scheduler),
 * and our dark-theme !important overrides on body/headings/paragraphs/
 * links would otherwise bleed straight into its UI regardless of the app
 * having its own styling, since CSS doesn't respect that boundary.
 */
function idtt_neon_is_ported_page() {
    if (function_exists('toastboss_is_app_page') && toastboss_is_app_page()) {
        return false;
    }
    return true;
}

/**
 * style.css holds the theme's real design (not just the WP-required
 * header comment), so it's only enqueued on pages that have actually been
 * ported — otherwise it would put the whole site into the dark neon theme
 * before the rest of the pages are ready for it.
 */
function idtt_neon_enqueue_style() {
    if (!idtt_neon_is_ported_page()) {
        return;
    }

    wp_enqueue_style(
        'idtt-neon-child-style',
        get_stylesheet_uri(),
        array('astra-theme-css'),
        filemtime(get_stylesheet_directory() . '/style.css')
    );
}
add_action('wp_enqueue_scripts', 'idtt_neon_enqueue_style', 20);

function idtt_neon_enqueue_assets() {
    if (!idtt_neon_is_ported_page()) {
        return;
    }

    $js_path = get_stylesheet_directory() . '/assets/js/neon-site.js';
    $dir_uri = get_stylesheet_directory_uri() . '/assets';

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

        // Absolute REST URL for the "Ask Us Anything" form, since a page
        // like /meetings/ can't rely on a relative "/wp-json/..." path
        // matching the site's actual permalink/subdirectory setup.
        wp_add_inline_script(
            'idtt-neon-site',
            'window.IDTTAskEndpoint = ' . wp_json_encode(esc_url_raw(rest_url('idtt-neon/v1/ask'))) . ';',
            'before'
        );
    }
}
add_action('wp_enqueue_scripts', 'idtt_neon_enqueue_assets', 21);

/** REST endpoint backing the "Ask Us Anything" form; emails submissions instead of the old fake-success no-op. */
function idtt_neon_register_ask_form_route() {
    register_rest_route('idtt-neon/v1', '/ask', array(
        'methods' => 'POST',
        'callback' => 'idtt_neon_handle_ask_form',
        'permission_callback' => '__return_true',
    ));
}
add_action('rest_api_init', 'idtt_neon_register_ask_form_route');

function idtt_neon_handle_ask_form(WP_REST_Request $request) {
    $name = sanitize_text_field((string) $request->get_param('name'));
    $email = sanitize_email((string) $request->get_param('email'));
    $message = sanitize_textarea_field((string) $request->get_param('message'));
    $source = sanitize_text_field((string) $request->get_param('source'));

    $brings_raw = $request->get_param('brings');
    $brings = is_array($brings_raw) ? array_map('sanitize_text_field', $brings_raw) : array();

    if ($name === '' || $message === '' || !is_email($email)) {
        return new WP_REST_Response(array('ok' => false, 'error' => 'Missing or invalid fields.'), 400);
    }

    $body_lines = array("Name: $name", "Email: $email");
    if ($source !== '') {
        $body_lines[] = "How they found us: $source";
    }
    if (!empty($brings)) {
        $body_lines[] = 'What brings them in: ' . implode(', ', $brings);
    }
    $body_lines[] = '';
    $body_lines[] = $message;

    $sent = wp_mail(
        array('nolavaavalon@gmail.com', 'akorringa@yahoo.com'),
        "New contact form message from $name",
        implode("\n", $body_lines),
        array('Reply-To: ' . $name . ' <' . $email . '>')
    );

    return new WP_REST_Response(array('ok' => (bool) $sent), $sent ? 200 : 500);
}

/**
 * Site-wide announcement bar for a temporary, unmissable notice — right
 * now, the September 24, 2026 meeting location change (Rum Runner's
 * Lombardi Room is booked for a Green Bay game that night, so that
 * week's meeting is at a private, members-only venue instead). Shows on
 * every ported page, above the header, and auto-hides itself once the
 * cutoff date passes — no manual cleanup needed afterward. Dismissible
 * via the close button (neon-site.js persists that in localStorage,
 * keyed to $dismiss_key below, so it stays closed on future visits). To
 * reuse this for a future announcement, edit the text, $cutoff, and
 * $dismiss_key together (a new key means it shows again even for
 * visitors who dismissed the old one).
 */
function idtt_announcement_banner() {
    if (!idtt_neon_is_ported_page() || toastboss_is_app_page()) {
        return;
    }

    $cutoff = strtotime('2026-09-25 00:00:00'); // banner shows through Sept 24
    if (time() >= $cutoff) {
        return;
    }
    $dismiss_key = '2026-09-24-location-change';
    ?>
    <div class="idtt-announcement-bar" id="idtt-announcement-bar" data-dismiss-key="<?php echo esc_attr($dismiss_key); ?>">
      <div class="wrap">
        <span class="idtt-announcement-text">
          <strong>Guests:</strong>
          No meeting at Rum Runner on Thursday, September 24. We'll be back at our usual location on October 1.
        </span>
        <button type="button" class="idtt-announcement-close" aria-label="Dismiss this announcement">&times;</button>
      </div>
    </div>
    <script>
      // Inline (not neon-site.js, which loads at the very end of the page)
      // so a previously-dismissed banner is hidden before the browser ever
      // paints it, instead of flashing on screen until the footer script runs.
      (function () {
        try {
          if (window.localStorage.getItem('idtt-announcement-dismissed:<?php echo esc_js($dismiss_key); ?>') === '1') {
            document.getElementById('idtt-announcement-bar').hidden = true;
          }
        } catch (e) {}
      })();
    </script>
    <?php
}
add_action('wp_body_open', 'idtt_announcement_banner');

/* ==========================================================================
   ToastBoss member portal — the built React scheduler app, mounted at
   /member-portal. Restored here after switching the active theme from
   idtt-child to idtt-neon-child dropped this wiring entirely (it only
   ever existed in idtt-child's functions.php/toastboss.php/toastboss-app,
   none of which carried over automatically). Login is unchanged: the app
   authenticates against the accounts table (email + password) exactly as
   it always has, via the existing backend API.
   ========================================================================== */

function toastboss_member_portal_slug() {
    return 'member-portal';
}

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
    $rewrite_version = (int) get_option('toastboss_neon_member_portal_rewrite_version', 0);
    if ($rewrite_version >= 1) {
        return;
    }

    toastboss_register_member_portal_rewrite();
    flush_rewrite_rules(false);
    update_option('toastboss_neon_member_portal_rewrite_version', 1, false);
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

/* ==========================================================================
   Member post type: officers + full roster, each with an automatic bio
   page at /members/<slug>/. A plain custom post type (no plugin, no WP
   Users) since this is content — name, role, bio — not a login. Each
   member links to their real ToastBoss member-portal account by name
   (_member_toastboss_name), so their portal photo and current officer
   title show up live via neon-site.js's existing public-members fetch,
   the same mechanism the earlier static bio pages used.
   ========================================================================== */

function idtt_register_member_post_type() {
    register_post_type('idtt_member', array(
        'labels' => array(
            'name' => 'Members',
            'singular_name' => 'Member',
            'add_new_item' => 'Add New Member',
            'edit_item' => 'Edit Member',
            'all_items' => 'All Members',
            'menu_name' => 'Members',
        ),
        'public' => true,
        'has_archive' => false,
        'show_in_menu' => true,
        'menu_icon' => 'dashicons-groups',
        'supports' => array('title', 'editor'),
        'rewrite' => array('slug' => 'members', 'with_front' => false),
    ));
}
add_action('init', 'idtt_register_member_post_type');

function idtt_member_meta_fields() {
    return array(
        '_member_public_visible' => array('label' => 'Show on public Members page', 'type' => 'checkbox'),
        '_member_role' => array('label' => 'Officer title / role', 'type' => 'text'),
        '_member_form_credentials' => array('label' => 'Credentials requested in Google form (leave blank if none)', 'type' => 'text'),
        '_member_since' => array('label' => 'Member since (year)', 'type' => 'text'),
        '_member_is_officer' => array('label' => 'Show in "Meet the Officers" cards', 'type' => 'checkbox'),
        '_member_display_order' => array('label' => 'Officer display order (lower shows first)', 'type' => 'number'),
        '_member_toastboss_name' => array('label' => "ToastBoss member-portal name (for live photo/title sync — defaults to the title above)", 'type' => 'text'),
        '_member_photo_filename' => array('label' => 'Fallback photo filename (in theme assets/img/, shown until the live portal photo loads)', 'type' => 'text'),
    );
}

function idtt_member_add_meta_box() {
    add_meta_box('idtt_member_details', 'Member Details', 'idtt_member_render_meta_box', 'idtt_member', 'side', 'default');
}
add_action('add_meta_boxes', 'idtt_member_add_meta_box');

function idtt_member_render_meta_box($post) {
    wp_nonce_field('idtt_member_save', 'idtt_member_nonce');
    echo '<p>Public visibility only affects the website directory. Paid membership and Member Portal access stay unchanged.</p>';
    echo '<p>Enter credentials only if the member requested them in their Google form submission. Leave blank otherwise. Roster credentials are not used here.</p>';
    echo '<table style="width:100%;">';
    foreach (idtt_member_meta_fields() as $key => $field) {
        $value = get_post_meta($post->ID, $key, true);
        if ($key === '_member_public_visible') {
            $value = idtt_member_is_publicly_visible($post->ID) ? '1' : '';
        }
        echo '<tr><td style="padding:6px 0;"><label for="' . esc_attr($key) . '">' . esc_html($field['label']) . '</label><br>';
        if ($field['type'] === 'checkbox') {
            echo '<input type="checkbox" id="' . esc_attr($key) . '" name="' . esc_attr($key) . '" value="1"' . checked($value, '1', false) . '>';
        } else {
            $input_type = $field['type'] === 'number' ? 'number' : 'text';
            echo '<input type="' . esc_attr($input_type) . '" id="' . esc_attr($key) . '" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '" style="width:100%;">';
        }
        echo '</td></tr>';
    }
    echo '</table>';
}

function idtt_member_save_meta($post_id) {
    if (!isset($_POST['idtt_member_nonce']) || !wp_verify_nonce($_POST['idtt_member_nonce'], 'idtt_member_save')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    foreach (idtt_member_meta_fields() as $key => $field) {
        if ($field['type'] === 'checkbox') {
            update_post_meta($post_id, $key, isset($_POST[$key]) ? '1' : '');
        } elseif (isset($_POST[$key])) {
            update_post_meta($post_id, $key, sanitize_text_field(wp_unslash($_POST[$key])));
        }
    }
}
add_action('save_post_idtt_member', 'idtt_member_save_meta');

function idtt_member_photo_src($post_id) {
    $filename = get_post_meta($post_id, '_member_photo_filename', true);
    if (!$filename) {
        $filename = 'member-placeholder.png';
    }
    return get_stylesheet_directory_uri() . '/assets/img/' . $filename;
}

function idtt_member_toastboss_name($post_id) {
    $override = get_post_meta($post_id, '_member_toastboss_name', true);
    return $override ? $override : get_the_title($post_id);
}

/** Website directory visibility is independent of the paid club roster. */
function idtt_member_is_publicly_visible($post_id) {
    // Explicit choices always win, including turning a hidden member back on.
    if (metadata_exists('post', $post_id, '_member_public_visible')) {
        return get_post_meta($post_id, '_member_public_visible', true) === '1';
    }
    // Requested initial defaults for existing posts and later roster syncs.
    $hidden_names = array('rhoda e. brown', 'liz a. delsignore');
    $name = strtolower(trim(idtt_member_toastboss_name($post_id)));
    $title = strtolower(trim(get_the_title($post_id)));
    return !in_array($name, $hidden_names, true) && !in_array($title, $hidden_names, true);
}

/**
 * [idtt_member_directory] — replaces the old static Custom HTML content
 * on the Members page. Queries idtt_member posts instead of hand-edited
 * markup, but renders the exact same classes (member-grid/member-card,
 * member-mini-grid/member-mini, data-member-name, member-name-live,
 * member-role) so neon-site.css and the live photo/role sync in
 * neon-site.js keep working unchanged.
 */
function idtt_member_directory_shortcode() {
    $officers_query = new WP_Query(array(
        'post_type' => 'idtt_member',
        'posts_per_page' => -1,
        'meta_query' => array(
            'relation' => 'AND',
            'is_officer_clause' => array('key' => '_member_is_officer', 'value' => '1'),
            'order_clause' => array('key' => '_member_display_order', 'type' => 'NUMERIC'),
        ),
        'orderby' => array('order_clause' => 'ASC', 'title' => 'ASC'),
    ));

    $all_query = new WP_Query(array(
        'post_type' => 'idtt_member',
        'posts_per_page' => -1,
        'orderby' => 'title',
        'order' => 'ASC',
    ));

    ob_start();
    ?>
    <div class="page-header">
      <div class="wrap">
        <h1>Meet the Most Fun Toastmasters in Las Vegas</h1>
      </div>
    </div>

    <section style="padding: clamp(1.5rem, 4vw, 2.5rem) 0;">
      <div class="wrap">
        <div class="section-head" style="margin-bottom: 1.25rem;">
          <p class="eyebrow">Meet the officers</p>
          <h2>Who's running the show</h2>
        </div>
        <div class="member-grid">
          <?php if ($officers_query->have_posts()) : while ($officers_query->have_posts()) : $officers_query->the_post();
            $post_id = get_the_ID();
            if (!idtt_member_is_publicly_visible($post_id)) { continue; }
            $name = get_the_title();
            $toastboss_name = idtt_member_toastboss_name($post_id);
            $role = get_post_meta($post_id, '_member_role', true);
            // Only display credentials explicitly requested in the member's Google form.
            $credentials = get_post_meta($post_id, '_member_form_credentials', true);
            $photo = idtt_member_photo_src($post_id);
          ?>
          <a class="member-card" data-member-name="<?php echo esc_attr($toastboss_name); ?>" href="<?php the_permalink(); ?>">
            <div class="member-photo"><img src="<?php echo esc_url($photo); ?>" alt="<?php echo esc_attr($name); ?>"></div>
            <p class="member-name"><span class="member-name-live"><?php echo esc_html($name); ?></span><?php if ($credentials) : ?> <span class="credentials"><?php echo esc_html($credentials); ?></span><?php endif; ?></p>
            <span class="member-role"><?php echo esc_html($role); ?></span>
            <span class="read-more">Read Bio &rarr;</span>
          </a>
          <?php endwhile; wp_reset_postdata(); endif; ?>
        </div>
      </div>
    </section>

    <section class="section-deep" style="padding: clamp(1.5rem, 4vw, 2.5rem) 0;">
      <div class="wrap">
        <div class="section-head" style="margin-bottom: 1.25rem;">
          <p class="eyebrow">The full roster</p>
          <h2>All Members</h2>
        </div>
        <div class="member-mini-grid">
          <?php if ($all_query->have_posts()) : while ($all_query->have_posts()) : $all_query->the_post();
            $post_id = get_the_ID();
            if (!idtt_member_is_publicly_visible($post_id)) { continue; }
            $name = get_the_title();
            $toastboss_name = idtt_member_toastboss_name($post_id);
            $photo = idtt_member_photo_src($post_id);
            $has_bio = trim(get_the_content()) !== '';
          ?>
            <?php if ($has_bio) : ?>
            <a class="member-mini" data-member-name="<?php echo esc_attr($toastboss_name); ?>" href="<?php the_permalink(); ?>">
              <div class="member-photo"><img src="<?php echo esc_url($photo); ?>" alt="<?php echo esc_attr($name); ?>"></div>
              <span class="mini-name"><span class="member-name-live"><?php echo esc_html($name); ?></span></span>
              <span class="mini-bio-link">See bio</span>
            </a>
            <?php else : ?>
            <div class="member-mini" data-member-name="<?php echo esc_attr($toastboss_name); ?>">
              <div class="member-photo"><img class="placeholder-photo" src="<?php echo esc_url($photo); ?>" alt=""></div>
              <span class="mini-name"><span class="member-name-live"><?php echo esc_html($name); ?></span></span>
            </div>
            <?php endif; ?>
          <?php endwhile; wp_reset_postdata(); endif; ?>
        </div>
      </div>
    </section>
    <?php
    return ob_get_clean();
}
add_shortcode('idtt_member_directory', 'idtt_member_directory_shortcode');

/**
 * Auto-builds each member's single bio page: profile header (photo,
 * name, live role, "Member since ...") plus whatever bio content is in
 * the post editor, plus the same footer every other ported page uses.
 * Whoever edits a member's bio in wp-admin just writes the bio body (a
 * <p class="profile-bio">...</p> paragraph, or a full .qa-list block for
 * the question/answer format) — the header and footer are automatic.
 */
function idtt_member_single_content($content) {
    if (!is_singular('idtt_member') || !in_the_loop() || !is_main_query()) {
        return $content;
    }

    $post_id = get_the_ID();
    $name = get_the_title();
    $toastboss_name = idtt_member_toastboss_name($post_id);
    $role = get_post_meta($post_id, '_member_role', true);
    $since = get_post_meta($post_id, '_member_since', true);
    $photo = idtt_member_photo_src($post_id);

    ob_start();
    ?>
    <div class="page-header">
      <div class="wrap">
        <p class="eyebrow"><a href="<?php echo esc_url(home_url('/meet-our-members/')); ?>" style="color:var(--teal)">&larr; Back to Members</a></p>
        <div class="profile-header" style="margin-top:1.5rem;" data-member-name="<?php echo esc_attr($toastboss_name); ?>">
          <div class="profile-photo"><img src="<?php echo esc_url($photo); ?>" alt="<?php echo esc_attr($name); ?>"></div>
          <div>
            <h1><span class="member-name-live"><?php echo esc_html($name); ?></span></h1>
            <?php if ($role || $since) : ?>
            <p class="hero-sub"><?php
              if ($role) { echo '<span class="member-role-live">' . esc_html($role) . '</span>'; }
              if ($role && $since) { echo ' &middot; '; }
              if ($since) { echo 'Member since ' . esc_html($since); }
            ?></p>
            <?php endif; ?>
          </div>
        </div>
      </div>
    </div>

    <section>
      <div class="wrap">
        <?php echo $content; ?>
      </div>
    </section>


    <?php
    return ob_get_clean();
}
add_filter('the_content', 'idtt_member_single_content', 20);

/** Remove the old pasted footer without changing saved page content. */
function idtt_neon_remove_legacy_footer($content) {
    if (is_admin() || !idtt_neon_is_ported_page() || !is_readable(get_stylesheet_directory() . '/template-parts/site-footer.php')) {
        return $content;
    }
    return preg_replace_callback('~<footer\b[^>]*>.*?</footer>~is', function ($match) {
        // Match only our known club footer, leaving unrelated footers alone.
        if (preg_match('~class=["\x27]site-footer["\x27]~i', $match[0])
            && strpos($match[0], 'Around the Club') !== false
            && strpos($match[0], 'Club 3254') !== false) {
            return '';
        }
        return $match[0];
    }, $content);
}
add_filter('the_content', 'idtt_neon_remove_legacy_footer', 30);

/** Astra supplies the shared header; render our footer outside page content. */
function idtt_neon_render_site_footer() {
    if (!is_admin() && idtt_neon_is_ported_page()) {
        get_template_part('template-parts/site-footer');
    }
}
add_action('astra_footer_before', 'idtt_neon_render_site_footer');

/**
 * One-time migration: creates all 11 members that used to be hand-coded
 * static HTML as idtt_member posts, so nothing from the old directory/bio
 * pages is lost. Only ever inserts a member if a post with that exact
 * title doesn't already exist, and only runs once (gated by the
 * idtt_member_seed_version option) — safe to leave in place permanently,
 * same pattern as the member-portal rewrite-flush below.
 */
function idtt_member_seed_data() {
    $qa = function ($pairs) {
        $html = '<div class="qa-list">';
        foreach ($pairs as $pair) {
            $html .= '<div class="qa-item"><span class="q">' . $pair[0] . '</span><p class="a">' . $pair[1] . '</p></div>';
        }
        return $html . '</div>';
    };
    $bio = function ($text) {
        return '<p class="profile-bio">' . $text . '</p>';
    };

    return array(
        array(
            'title' => 'Avalon Korringa',
            'is_officer' => true, 'order' => 1,
            'role' => 'President, VP Education', 'credentials' => '', 'since' => '2019',
            'photo' => 'member-avalon-korringa.png',
            'content' => $qa(array(
                array("What made you want to join I'll Drink to That?", "I had a terrible fear of public speaking, I came across this club by chance. I was so impressed with the flow of the meeting and the people there, I had to join. I knew right away I had found my tribe."),
                array('How has being part of this club helped you?', 'I have overcome my fear of public speaking, plus developed leadership skills that I never knew I had.'),
                array('What keeps you coming back?', 'This club is full of friends! I always leave each meeting with a smile on my face. Great people.'),
                array('Tell us a little about yourself outside of Toastmasters.', "I'm a jack of all trades. I have tons of projects I'm always working on."),
            )),
        ),
        array(
            'title' => 'Michael Gallegos Borresen',
            'is_officer' => true, 'order' => 2,
            'role' => 'VP Public Relations', 'credentials' => '', 'since' => '2008',
            'photo' => 'member-michael-gallegos-borresen.jpg',
            'content' => $qa(array(
                array("What made you want to join I'll Drink to That?", 'Self development and community.'),
                array('How has being part of this club helped you?', 'Emerged from my emotional prison.'),
                array('What keeps you coming back?', 'Community of friends.'),
                array('What is your favorite thing about our club?', 'The beer.'),
                array('Tell us a little about yourself outside of Toastmasters.', 'Aspiring Motivational Speaker, Comedian, and Magician.'),
                array('What is something people might be surprised to learn about you?', 'My sense of humor.'),
                array('Is there anything else you would like to add?', 'Find yourself and your voice in Toastmasters.'),
            )),
        ),
        array(
            'title' => 'Bob Henze',
            'is_officer' => true, 'order' => 3,
            'role' => 'Club Secretary', 'credentials' => '', 'since' => '',
            'photo' => 'member-bob-henze.jpg',
            'content' => $bio("I have been in Toastmasters for over ten years. Competent Communicator, Past District 33 Photographer, Area D2 Toastmaster of the Year (2010&ndash;2011). Glad to be a part of one of the best Toastmaster clubs in Vegas! I'll Drink to That!"),
        ),
        array(
            'title' => 'Tom Maroney',
            'is_officer' => true, 'order' => 4,
            'role' => 'Club Treasurer', 'credentials' => '', 'since' => '1984',
            'photo' => 'member-tom-maroney.jpg',
            'content' => $bio("I joined I'll Drink to That Toastmasters in October of 1984. Throughout my professional life, the speaking and leadership skills I learned in Toastmasters helped me be successful in any endeavor I sought to accomplish. The friends and acquaintances I have made due to my Toastmaster involvement continue to enrich my life even now. I look forward to sharing my Toastmaster experience."),
        ),
        array(
            'title' => 'Bobby Butler',
            'is_officer' => true, 'order' => 5,
            'role' => 'Sergeant at Arms', 'credentials' => '', 'since' => '',
            'photo' => 'member-bobby-butler.jpg',
            'content' => $bio('I joined Toastmasters to overcome my fear of speaking in front of a lot of people. This club has given me a chance to do that and much more. I have served as Sergeant at Arms, and now I am serving as VP of Membership. Thanks for the challenge to grow!'),
        ),
        array(
            'title' => 'J. Kent Hastings',
            'is_officer' => false, 'order' => 0,
            'role' => '', 'credentials' => '', 'since' => '2026',
            'photo' => 'member-kent-hastings.jpg',
            'content' => $qa(array(
                array("What made you want to join I'll Drink to That?", 'To improve business presentations.'),
                array('How has being part of this club helped you?', "It's given me 'stage time' and instruction on timing, structure and vocal variety."),
                array('What keeps you coming back?', 'The opportunity to act in different roles as well as speaking.'),
                array('What is your favorite thing about our club?', 'More levity than a typical business club.'),
                array('Tell us a little about yourself outside of Toastmasters.', "I'm a web developer and ham radio operator."),
                array('What is something people might be surprised to learn about you?', 'I edited video for a gun school and for three low-budget indie feature films.'),
                array('Is there anything else you would like to add?', "I'd like to add a few million dollars to my net worth."),
            )),
        ),
        array(
            'title' => 'Connor Davis', 'is_officer' => false, 'order' => 0,
            'role' => '', 'credentials' => '', 'since' => '',
            'photo' => 'member-connor-davis.jpg', 'content' => '',
        ),
        array(
            'title' => 'Marc H. Goodman', 'is_officer' => false, 'order' => 0,
            'role' => '', 'credentials' => '', 'since' => '',
            'photo' => 'member-marc-goodman.png', 'content' => '',
        ),
        array(
            'title' => 'Anthony M. Rocchio', 'is_officer' => false, 'order' => 0,
            'role' => '', 'credentials' => '', 'since' => '',
            'photo' => '', 'content' => '',
        ),
        array(
            'title' => 'Liz A. DelSignore', 'is_officer' => false, 'order' => 0,
            'role' => '', 'credentials' => '', 'since' => '',
            'photo' => '', 'content' => '',
        ),
        array(
            'title' => 'Rhoda E. Brown', 'is_officer' => false, 'order' => 0,
            'role' => '', 'credentials' => '', 'since' => '',
            'photo' => '', 'content' => '',
        ),
    );
}

function idtt_member_run_seed() {
    if (get_option('idtt_member_seed_version')) {
        return;
    }

    foreach (idtt_member_seed_data() as $data) {
        $existing = get_posts(array(
            'post_type' => 'idtt_member',
            'title' => $data['title'],
            'posts_per_page' => 1,
            'post_status' => 'any',
            'fields' => 'ids',
        ));
        if (!empty($existing)) {
            continue;
        }

        $post_id = wp_insert_post(array(
            'post_type' => 'idtt_member',
            'post_title' => $data['title'],
            'post_content' => $data['content'],
            'post_status' => 'publish',
        ));

        if (!$post_id || is_wp_error($post_id)) {
            continue;
        }

        update_post_meta($post_id, '_member_role', $data['role']);
        update_post_meta($post_id, '_member_form_credentials', $data['credentials']);
        update_post_meta($post_id, '_member_since', $data['since']);
        update_post_meta($post_id, '_member_is_officer', $data['is_officer'] ? '1' : '');
        update_post_meta($post_id, '_member_display_order', $data['order']);
        update_post_meta($post_id, '_member_photo_filename', $data['photo']);
    }

    // The idtt_member post type's rewrite slug ("members") needs a flush
    // before /members/<slug>/ resolves instead of 404ing; safe to run
    // here since this whole function only runs once.
    flush_rewrite_rules();

    update_option('idtt_member_seed_version', 1, false);
}
add_action('admin_init', 'idtt_member_run_seed');

/** Import Michael's approved September 9 biography once into his editable post. */
function idtt_member_update_michael_bio() {
    $matches = get_posts(array(
        'post_type' => 'idtt_member',
        'title' => 'Michael Gallegos Borresen',
        'posts_per_page' => 2,
        'post_status' => array('publish', 'draft', 'pending', 'private', 'future'),
        'fields' => 'ids',
    ));
    if (count($matches) !== 1) {
        return;
    }
    $post_id = $matches[0];
    if (!current_user_can('edit_post', $post_id) || get_post_meta($post_id, '_member_bio_submission_20260909', true)) {
        return;
    }
    foreach (idtt_member_seed_data() as $member) {
        if ($member['title'] !== 'Michael Gallegos Borresen') {
            continue;
        }
        $result = wp_update_post(wp_slash(array(
            'ID' => $post_id,
            'post_content' => $member['content'],
        )), true);
        if ($result && !is_wp_error($result)) {
            update_post_meta($post_id, '_member_since', $member['since']);
            update_post_meta($post_id, '_member_bio_submission_20260909', '1');
        }
        break;
    }
}
add_action('admin_init', 'idtt_member_update_michael_bio', 11);

/**
 * Manual "Sync from ToastBoss Roster" admin action — under Members in
 * wp-admin. Pulls the live public-members API, which is backed by the
 * same roster the club's CSV import keeps current, and creates any
 * missing members plus refreshes everyone's officer title/role.
 *
 * Mirrors the backend's own CSV-import philosophy (see
 * backend/src/index.ts roster/import): structural roster data (name,
 * officer position) re-syncs every run, but bio content, credentials,
 * "member since", and photo are hand-written and never touched here
 * once set.
 */
function idtt_member_add_sync_page() {
    add_submenu_page(
        'edit.php?post_type=idtt_member',
        'Sync from Roster',
        'Sync from Roster',
        'manage_options',
        'idtt-member-sync',
        'idtt_member_render_sync_page'
    );
}
add_action('admin_menu', 'idtt_member_add_sync_page');

function idtt_member_render_sync_page() {
    $result = null;
    if (isset($_POST['idtt_member_sync_nonce']) && wp_verify_nonce($_POST['idtt_member_sync_nonce'], 'idtt_member_sync')) {
        $result = idtt_member_sync_from_roster();
    }
    ?>
    <div class="wrap">
      <h1>Sync Members from ToastBoss Roster</h1>
      <p>Pulls the current club roster (the same one kept up to date by the CSV import in ToastBoss) and creates any missing members, plus refreshes everyone's officer title. Bios, credentials, "member since", and photos you've already set here are never overwritten by this.</p>
      <?php if (is_array($result)) : ?>
        <div class="notice notice-<?php echo $result['error'] ? 'error' : 'success'; ?>">
          <p>
            <?php if ($result['error']) : ?>
              <strong>Error:</strong> <?php echo esc_html($result['error']); ?>
            <?php else : ?>
              <?php echo (int) $result['created']; ?> member(s) created, <?php echo (int) $result['updated']; ?> updated.
            <?php endif; ?>
          </p>
        </div>
      <?php endif; ?>
      <form method="post">
        <?php wp_nonce_field('idtt_member_sync', 'idtt_member_sync_nonce'); ?>
        <?php submit_button('Sync Now'); ?>
      </form>
    </div>
    <?php
}

function idtt_member_sync_from_roster() {
    $response = wp_remote_get('https://toastboss-backend.onrender.com/api/clubs/idtt/public-members', array('timeout' => 15));
    if (is_wp_error($response)) {
        return array('created' => 0, 'updated' => 0, 'error' => $response->get_error_message());
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($body) || empty($body['members'])) {
        return array('created' => 0, 'updated' => 0, 'error' => 'No members returned from the roster API.');
    }

    // Existing members, keyed by whichever name they're matched to
    // ToastBoss by (the override meta if set, otherwise the post title).
    $existing_posts = get_posts(array(
        'post_type' => 'idtt_member',
        'posts_per_page' => -1,
        'post_status' => 'any',
    ));
    $by_name = array();
    foreach ($existing_posts as $existing_post) {
        $key = strtolower(idtt_member_toastboss_name($existing_post->ID));
        $by_name[$key] = $existing_post->ID;
    }

    $created = 0;
    $updated = 0;

    foreach ($body['members'] as $member) {
        $name = isset($member['name']) ? trim((string) $member['name']) : '';
        if ($name === '') {
            continue;
        }
        $role = isset($member['currentPosition']) ? trim((string) $member['currentPosition']) : '';
        $key = strtolower($name);

        if (isset($by_name[$key])) {
            $post_id = $by_name[$key];
            update_post_meta($post_id, '_member_role', $role);
            update_post_meta($post_id, '_member_is_officer', $role !== '' ? '1' : '');
            $updated++;
            continue;
        }

        $post_id = wp_insert_post(array(
            'post_type' => 'idtt_member',
            'post_title' => $name,
            'post_content' => '',
            'post_status' => 'publish',
        ));

        if (!$post_id || is_wp_error($post_id)) {
            continue;
        }

        update_post_meta($post_id, '_member_role', $role);
        update_post_meta($post_id, '_member_is_officer', $role !== '' ? '1' : '');
        update_post_meta($post_id, '_member_display_order', 0);
        $created++;
    }

    if ($created > 0) {
        flush_rewrite_rules();
    }

    return array('created' => $created, 'updated' => $updated, 'error' => null);
}
