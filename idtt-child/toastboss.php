<?php
/**
 * Template Name: ToastBoss App
 */
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <?php wp_head(); ?>
</head>
<body <?php body_class('toastboss-app-body'); ?>>
  <?php wp_body_open(); ?>
  <div id="root">Loading ToastBoss...</div>
  <?php wp_footer(); ?>
</body>
</html>
