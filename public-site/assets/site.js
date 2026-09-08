(function () {
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

  // Guest agenda: pull next week's real lineup from the scheduler.
  // The scheduler backend and this practice site are separate projects,
  // so the API base URL is hardcoded here rather than shared.
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
          .filter(function (item) { return isFeatured(item.role); })
          .sort(function (a, b) { return roleRank(a.role) - roleRank(b.role); });

        if (assignments.length === 0) {
          return;
        }
        if (agendaHeading && data.meetingDate) {
          var meetingDate = new Date(data.meetingDate + 'T12:00:00');
          var formatted = meetingDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
          agendaHeading.textContent = "This week's lineup, " + formatted;
        }
        if (agendaSub && data.theme) {
          agendaSub.textContent = 'Theme: ' + data.theme;
        }
        agendaList.innerHTML = '';
        assignments.forEach(function (item) {
          var row = document.createElement('div');
          row.className = 'agenda-row';
          var role = document.createElement('span');
          role.className = 'agenda-role';
          role.textContent = item.role;
          var name = document.createElement('span');
          name.className = 'agenda-name';
          name.textContent = item.memberName || 'Open';
          row.appendChild(role);
          row.appendChild(name);
          agendaList.appendChild(row);
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
