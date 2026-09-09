(function () {
  // Dismissible announcement bar: closing it persists in localStorage,
  // keyed per-announcement via data-dismiss-key, so a future different
  // announcement isn't accidentally suppressed by an old dismissal, and
  // reopening the site later respects a still-active dismissal.
  var announcementBar = document.getElementById('idtt-announcement-bar');
  if (announcementBar) {
    var dismissKey = announcementBar.getAttribute('data-dismiss-key');
    var storageKey = dismissKey ? 'idtt-announcement-dismissed:' + dismissKey : null;
    var isDismissed = false;
    try {
      isDismissed = !!(storageKey && window.localStorage.getItem(storageKey) === '1');
    } catch (e) {}

    if (isDismissed) {
      announcementBar.hidden = true;
    } else {
      var announcementClose = announcementBar.querySelector('.idtt-announcement-close');
      if (announcementClose) {
        announcementClose.addEventListener('click', function () {
          announcementBar.hidden = true;
          try {
            if (storageKey) { window.localStorage.setItem(storageKey, '1'); }
          } catch (e) {}
        });
      }
    }
  }

  // Astra's real header lives outside .above-fold now (it's the theme's
  // native header, not the custom one that used to be pasted in here), so
  // neon-site.css can't just use 100vh for the hero without double-counting
  // the header's own height. Measure it and expose it as --header-h so the
  // CSS can subtract it.
  var setHeaderHeightVar = function () {
    var header = document.querySelector('#masthead.site-header') || document.querySelector('.site-header');
    var height = header ? header.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--header-h', height + 'px');
  };
  setHeaderHeightVar();
  window.addEventListener('resize', setHeaderHeightVar);
  window.addEventListener('load', setHeaderHeightVar);
  // Google Fonts (Montserrat) loads async and can swap in after the header
  // is first measured, growing the nav/logo text slightly and making the
  // header taller than what was recorded — re-measure once fonts settle so
  // the hero doesn't end up sized a few pixels short.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(setHeaderHeightVar);
  }
  setTimeout(setHeaderHeightVar, 400);

  // Fade in below-the-fold sections as they scroll into view. Triggers
  // early (large bottom rootMargin) so the fade is done, or nearly done,
  // by the time the section is actually in view, not something you wait on.
  var revealTargets = document.querySelectorAll('.reveal');
  if (revealTargets.length && 'IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });
    revealTargets.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add('is-visible'); });
  }

  // Mobile nav toggle.
  var toggle = document.getElementById('nav-toggle');
  var mobileNav = document.getElementById('mobile-nav');
  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var isOpen = mobileNav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileNav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
      });
    });
  }

  // "Ask Us Anything" modal.
  var askModal = document.getElementById('ask-modal');
  var openAskModal = document.getElementById('open-ask-modal');
  var closeAskModal = document.getElementById('ask-modal-close');
  var askForm = document.getElementById('ask-form');
  var askSuccess = document.getElementById('ask-success');
  if (askModal && openAskModal && closeAskModal) {
    openAskModal.addEventListener('click', function () { askModal.showModal(); });
    closeAskModal.addEventListener('click', function () { askModal.close(); });
    askModal.addEventListener('click', function (event) {
      if (event.target === askModal) { askModal.close(); }
    });
    askModal.addEventListener('close', function () {
      if (askForm) { askForm.classList.remove('is-hidden'); askForm.reset(); }
      if (askSuccess) { askSuccess.classList.remove('is-visible'); }
    });
  }
  if (askForm && askSuccess) {
    askForm.addEventListener('submit', function (event) {
      event.preventDefault();
      askForm.classList.add('is-hidden');
      askSuccess.classList.add('is-visible');
    });
  }

  // Base path for images. On the static practice site this is a relative
  // "assets/img/" next to each HTML page; on WordPress, functions.php sets
  // window.IDTTImgBase to the theme's own asset directory before this file
  // loads, since the same page-relative path won't resolve on WP page URLs.
  var IMG_BASE = window.IDTTImgBase || 'assets/img/';

  // Known member bio photos, matched against the assignment's memberName by
  // surname (case-insensitive substring). Add more as more members get real
  // photos on the members page.
  var MEMBER_PHOTOS = [
    { match: 'korringa', src: IMG_BASE + 'member-avalon-korringa.png', position: '75% 35%' },
    { match: 'henze', src: IMG_BASE + 'member-bob-henze.jpg', position: 'center' },
    { match: 'butler', src: IMG_BASE + 'member-bobby-butler.jpg', position: '50% 15%' },
    { match: 'maroney', src: IMG_BASE + 'member-tom-maroney.jpg', position: 'center' },
    { match: 'borresen', src: IMG_BASE + 'member-michael-gallegos-borresen.jpg', position: '80% center' },
    { match: 'hastings', src: IMG_BASE + 'member-kent-hastings.jpg', position: 'center' },
    { match: 'goodman', src: IMG_BASE + 'member-marc-goodman.png', position: '50% 15%' },
    { match: 'davis', src: IMG_BASE + 'member-connor-davis.jpg', position: '50% 25%' },
  ];
  var findMemberPhoto = function (memberName) {
    if (!memberName) { return null; }
    var lower = memberName.toLowerCase();
    for (var i = 0; i < MEMBER_PHOTOS.length; i++) {
      if (lower.indexOf(MEMBER_PHOTOS[i].match) !== -1) { return MEMBER_PHOTOS[i]; }
    }
    return null;
  };

  // Builds one role/name row for the guest agenda and the meetings list,
  // with a small bio photo next to the name when one is on file.
  var buildAgendaRow = function (role, memberName) {
    var row = document.createElement('div');
    row.className = 'agenda-row';

    var roleEl = document.createElement('span');
    roleEl.className = 'agenda-role';
    roleEl.textContent = role;
    row.appendChild(roleEl);

    var nameGroup = document.createElement('span');
    nameGroup.className = 'agenda-name-group';

    var photo = findMemberPhoto(memberName);
    if (photo) {
      var img = document.createElement('img');
      img.className = 'agenda-avatar';
      img.src = photo.src;
      img.alt = '';
      img.style.objectPosition = photo.position;
      nameGroup.appendChild(img);
    }

    var nameEl = document.createElement('span');
    nameEl.className = 'agenda-name';
    nameEl.textContent = memberName || 'Open';
    nameGroup.appendChild(nameEl);

    row.appendChild(nameGroup);
    return row;
  };

  // Guest agenda: pull next week's real lineup from the scheduler.
  // The scheduler backend and this site are separate projects, so the API
  // base URL is hardcoded here rather than shared.
  var AGENDA_API = 'https://toastboss-backend.onrender.com/api/clubs/idtt/public-agenda';
  var agendaList = document.getElementById('agenda-list');
  var agendaHeading = document.getElementById('agenda-heading');
  var agendaSub = document.getElementById('agenda-sub');

  if (agendaList) {
    fetch(AGENDA_API)
      .then(function (response) {
        if (!response.ok) { throw new Error('not ok'); }
        return response.json();
      })
      .then(function (data) {
        // Only the roles guests actually care about, in a fixed order.
        var featuredRoles = ['Toastmaster', 'Speaker', 'Barroom Topics', 'General Evaluator'];
        var isFeatured = function (role) {
          return featuredRoles.some(function (featured) { return role.indexOf(featured) === 0; });
        };
        var roleRank = function (role) {
          for (var i = 0; i < featuredRoles.length; i++) {
            if (role.indexOf(featuredRoles[i]) === 0) { return i; }
          }
          return featuredRoles.length;
        };
        var assignments = (data.assignments || [])
          .filter(function (item) { return item.memberName !== 'Round Robin' && isFeatured(item.role); })
          .sort(function (a, b) { return roleRank(a.role) - roleRank(b.role); });

        if (assignments.length === 0) {
          return;
        }
        if (agendaHeading && data.meetingDate) {
          var meetingDate = new Date(data.meetingDate + 'T12:00:00');
          var formatted = meetingDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
          agendaHeading.textContent = "This week's lineup, " + formatted + ' ';
          if (isVenueChangeMeeting(data.meetingDate)) {
            var venueBadge = document.createElement('span');
            venueBadge.className = 'meeting-card-badge meeting-card-badge--venue';
            venueBadge.textContent = 'Private Venue';
            attachVenueBadge(venueBadge);
            agendaHeading.appendChild(venueBadge);
          }
        }
        if (agendaSub && data.theme) {
          agendaSub.textContent = 'Theme: ' + data.theme;
          agendaSub.style.display = '';
        }
        agendaList.innerHTML = '';
        assignments.forEach(function (item) {
          agendaList.appendChild(buildAgendaRow(item.role, item.memberName));
        });
      })
      .catch(function () {});
  }

  // Meetings page: pull the full upcoming schedule from the scheduler.
  // Only the next meeting gets the full role-by-role card; everything
  // after that is just a simple list of dates.
  var MEETINGS_API = 'https://toastboss-backend.onrender.com/api/clubs/idtt/public-meetings?weeks=8';
  var meetingsList = document.getElementById('meetings-list');
  var meetingsUpcoming = document.getElementById('meetings-upcoming');
  var meetingsUpcomingList = document.getElementById('meetings-upcoming-list');

  var formatMeetingDate = function (dateString) {
    var dateObj = new Date(dateString + 'T12:00:00');
    return dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  };

  // First Thursday of the month is always Improv Night, same rule the
  // scheduler backend uses to swap the agenda for that week.
  var isImprovNight = function (dateString) {
    var dateObj = new Date(dateString + 'T12:00:00');
    return dateObj.getDate() <= 7;
  };

  // One-off notice: no meeting at Rum Runner on Sept 24, 2026 (Lombardi
  // Room is booked for a Green Bay game), so that week is at a private,
  // members-only venue instead. Remove this check (and the venue-popover
  // markup it points at) once that date has passed.
  var isVenueChangeMeeting = function (dateString) {
    return dateString === '2026-09-24';
  };

  // Badge popovers: hover or click a badge to open its matching popover,
  // close with its own X button, a click outside, or (if opened by hover)
  // by moving the mouse away. Shared by the "Improv Night" badge and the
  // one-off "Private Venue" badge above.
  var makeBadgePopover = function (popoverEl) {
    if (!popoverEl) { return function () {}; }
    var openedBy = null;

    var position = function (anchor) {
      var rect = anchor.getBoundingClientRect();
      var popoverWidth = 260;
      var left = rect.left;
      var maxLeft = document.documentElement.clientWidth - popoverWidth - 16;
      if (left > maxLeft) { left = Math.max(8, maxLeft); }
      popoverEl.style.top = (rect.bottom + 8) + 'px';
      popoverEl.style.left = left + 'px';
    };

    var show = function (anchor, mode) {
      position(anchor);
      popoverEl.hidden = false;
      openedBy = mode;
    };

    var hide = function () {
      popoverEl.hidden = true;
      openedBy = null;
    };

    var closeBtn = popoverEl.querySelector('.improv-popover-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hide);
    }

    document.addEventListener('click', function (event) {
      if (popoverEl.hidden) { return; }
      if (popoverEl.contains(event.target)) { return; }
      if (event.target.classList && event.target.classList.contains('meeting-card-badge')) { return; }
      hide();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { hide(); }
    });

    return function attachBadge(badgeEl) {
      badgeEl.addEventListener('mouseenter', function () {
        show(badgeEl, 'hover');
      });
      badgeEl.addEventListener('mouseleave', function (event) {
        if (openedBy !== 'hover') { return; }
        var to = event.relatedTarget;
        if (to && popoverEl.contains(to)) { return; }
        hide();
      });
      badgeEl.addEventListener('click', function (event) {
        event.stopPropagation();
        // Always pin it open on click, even if hover already showed it —
        // mouseenter fires right before click, so without this a click
        // would just re-close what hover had only just opened.
        show(badgeEl, 'click');
      });
    };
  };

  var attachImprovBadge = makeBadgePopover(document.getElementById('improv-popover'));
  var attachVenueBadge = makeBadgePopover(document.getElementById('venue-popover'));

  var buildMeetingCard = function (meeting) {
    var card = document.createElement('div');
    card.className = 'meeting-card';

    var head = document.createElement('div');
    head.className = 'meeting-card-head';
    var dateEl2 = document.createElement('span');
    dateEl2.className = 'meeting-card-date';
    dateEl2.textContent = formatMeetingDate(meeting.date);
    head.appendChild(dateEl2);
    if (isImprovNight(meeting.date)) {
      var improvEl = document.createElement('span');
      improvEl.className = 'meeting-card-badge meeting-card-badge--improv';
      improvEl.textContent = 'Improv Night';
      attachImprovBadge(improvEl);
      head.appendChild(improvEl);
    }
    if (isVenueChangeMeeting(meeting.date)) {
      var venueEl = document.createElement('span');
      venueEl.className = 'meeting-card-badge meeting-card-badge--venue';
      venueEl.textContent = 'Private Venue';
      attachVenueBadge(venueEl);
      head.appendChild(venueEl);
    }
    if (meeting.theme) {
      var themeEl = document.createElement('span');
      themeEl.className = 'meeting-card-theme';
      themeEl.textContent = 'Theme: ' + meeting.theme;
      head.appendChild(themeEl);
    }
    card.appendChild(head);

    var meetingAssignments = (meeting.assignments || []).filter(function (item) {
      return item.memberName !== 'Round Robin';
    });

    if (meeting.locked && meetingAssignments.length > 0) {
      var list = document.createElement('div');
      list.className = 'agenda-list';
      meetingAssignments.forEach(function (item) {
        list.appendChild(buildAgendaRow(item.role, item.memberName));
      });
      card.appendChild(list);
    } else {
      var pending = document.createElement('p');
      pending.className = 'meeting-card-pending';
      pending.textContent = "Lineup not finalized yet. Come see who's up Thursday!";
      card.appendChild(pending);
    }

    return card;
  };

  if (meetingsList) {
    fetch(MEETINGS_API)
      .then(function (response) {
        if (!response.ok) { throw new Error('not ok'); }
        return response.json();
      })
      .then(function (data) {
        var meetings = data.meetings || [];
        if (meetings.length === 0) {
          return;
        }

        meetingsList.innerHTML = '';
        meetingsList.appendChild(buildMeetingCard(meetings[0]));

        var laterMeetings = meetings.slice(1);
        if (laterMeetings.length > 0 && meetingsUpcoming && meetingsUpcomingList) {
          meetingsUpcomingList.innerHTML = '';
          laterMeetings.forEach(function (meeting) {
            var row = document.createElement('div');
            row.className = 'meeting-date-row';
            var dateSpan = document.createElement('span');
            dateSpan.className = 'meeting-date-row-date';
            dateSpan.textContent = formatMeetingDate(meeting.date);
            row.appendChild(dateSpan);
            if (isImprovNight(meeting.date)) {
              var improvSpan = document.createElement('span');
              improvSpan.className = 'meeting-card-badge meeting-card-badge--improv';
              improvSpan.textContent = 'Improv Night';
              attachImprovBadge(improvSpan);
              row.appendChild(improvSpan);
            }
            if (isVenueChangeMeeting(meeting.date)) {
              var venueSpan = document.createElement('span');
              venueSpan.className = 'meeting-card-badge meeting-card-badge--venue';
              venueSpan.textContent = 'Private Venue';
              attachVenueBadge(venueSpan);
              row.appendChild(venueSpan);
            }
            if (meeting.theme) {
              var themeSpan = document.createElement('span');
              themeSpan.className = 'meeting-date-row-theme';
              themeSpan.textContent = 'Theme: ' + meeting.theme;
              row.appendChild(themeSpan);
            }
            meetingsUpcomingList.appendChild(row);
          });
          meetingsUpcoming.style.display = '';
        }
      })
      .catch(function () {});
  }

  // Member directory + bio pages: photo and officer title come live from
  // the same accounts/roster data members manage themselves in the member
  // portal, matched to the static markup by name via data-member-name.
  // The Q&A bio text itself stays static/hand-written. Only runs the fetch
  // if the current page actually has a matching element, so pages without
  // member markup don't make the request for nothing.
  // The roster's raw "Current Position" (e.g. "Club VP Education,Club
  // President") carries a "Club " prefix on every role and lists them in
  // whatever order the CSV export happens to use. Strip the prefix and
  // put President first, since that's how these titles read naturally.
  var formatOfficerRole = function (raw) {
    var parts = raw.split(',')
      .map(function (part) { return part.trim().replace(/^club\s+/i, ''); })
      .filter(Boolean);
    parts.sort(function (a, b) {
      var aIsPresident = /^president$/i.test(a) ? 0 : 1;
      var bIsPresident = /^president$/i.test(b) ? 0 : 1;
      return aIsPresident - bIsPresident;
    });
    return parts.join(', ');
  };

  var memberTargets = document.querySelectorAll('[data-member-name]');
  if (memberTargets.length) {
    var PUBLIC_MEMBERS_API = 'https://toastboss-backend.onrender.com/api/clubs/idtt/public-members';
    fetch(PUBLIC_MEMBERS_API)
      .then(function (response) {
        if (!response.ok) { throw new Error('not ok'); }
        return response.json();
      })
      .then(function (data) {
        var byName = {};
        (data.members || []).forEach(function (member) {
          if (member.name) { byName[member.name.toLowerCase()] = member; }
        });

        memberTargets.forEach(function (target) {
          var name = target.getAttribute('data-member-name');
          var record = name ? byName[name.toLowerCase()] : null;
          if (!record) { return; }

          if (record.profileImageUrl) {
            var img = target.querySelector('img');
            if (img) { img.src = record.profileImageUrl; }
          }

          var nameEl = target.querySelector('.member-name-live');
          if (nameEl && record.name) { nameEl.textContent = record.name; }

          var roleEl = target.querySelector('.member-role-live, .member-role');
          if (roleEl && record.currentPosition) { roleEl.textContent = formatOfficerRole(record.currentPosition); }
        });
      })
      .catch(function () {});
  }

  // Chalkboard: always show the next Thursday, 6:30 PM.
  var dateEl = document.getElementById('next-meeting-date');
  if (dateEl) {
    var now = new Date();
    var day = now.getDay(); // 0=Sun ... 4=Thu
    var daysUntilThursday = (4 - day + 7) % 7;
    // If it's Thursday but past 6:30 PM, roll to next week's meeting.
    if (daysUntilThursday === 0 && (now.getHours() > 18 || (now.getHours() === 18 && now.getMinutes() >= 30))) {
      daysUntilThursday = 7;
    }
    var next = new Date(now);
    next.setDate(now.getDate() + daysUntilThursday);
    var formatted = next.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    dateEl.textContent = formatted + ', 6:30 PM';
  }

  // RSVP: sandbox has no backend yet — confirm locally instead of submitting.
  var form = document.getElementById('rsvp-form');
  var success = document.getElementById('rsvp-success');
  if (form && success) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      form.classList.add('is-hidden');
      success.classList.add('is-visible');
    });
  }

  var yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
})();
