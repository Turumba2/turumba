document.addEventListener('DOMContentLoaded', function () {
  const navLinks = document.querySelectorAll('.nav-link[data-section]');
  const sections = document.querySelectorAll('.section');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const breadcrumbCurrent = document.querySelector('.breadcrumb-current');

  // Section titles for breadcrumb
  const sectionTitles = {
    home: 'Overview',
    architecture: 'Architecture',
    messaging: 'Messaging System',
    channels: 'Delivery Channels',
    'full-spec': 'Full Specification',
    roadmap: 'Roadmap',
  };

  // Switch active section
  function showSection(sectionId) {
    sections.forEach(function (s) {
      s.classList.remove('active');
    });
    navLinks.forEach(function (l) {
      l.classList.remove('active');
    });

    var target = document.getElementById(sectionId);
    if (target) {
      target.classList.add('active');
    }

    navLinks.forEach(function (l) {
      if (l.getAttribute('data-section') === sectionId) {
        l.classList.add('active');
      }
    });

    // Update breadcrumb
    if (breadcrumbCurrent) {
      breadcrumbCurrent.textContent = sectionTitles[sectionId] || 'Documentation';
    }

    // Close mobile sidebar
    closeMobileSidebar();

    // Scroll to top
    window.scrollTo(0, 0);
  }

  // Nav link click handlers
  navLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var sectionId = this.getAttribute('data-section');
      window.location.hash = sectionId;
      showSection(sectionId);
    });
  });

  // Hash navigation
  function handleHash() {
    var hash = window.location.hash.replace('#', '');
    if (hash && document.getElementById(hash)) {
      showSection(hash);
    } else {
      showSection('home');
    }
  }

  window.addEventListener('hashchange', handleHash);
  handleHash();

  // Mobile menu
  function closeMobileSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    document.body.style.overflow = '';
  }

  function openMobileSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
  }

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeMobileSidebar);
  }

  // Collapsible sections
  document.querySelectorAll('.collapsible-header').forEach(function (header) {
    header.addEventListener('click', function () {
      var parent = this.parentElement;
      parent.classList.toggle('open');
    });
  });

  // Close mobile sidebar on escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeMobileSidebar();
    }
  });
});
