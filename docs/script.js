document.addEventListener('DOMContentLoaded', function () {
  var navLinks = document.querySelectorAll('.nav-link[data-section]');
  var sections = document.querySelectorAll('.section');
  var sidebar = document.querySelector('.sidebar');
  var overlay = document.querySelector('.sidebar-overlay');
  var mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  var breadcrumbCurrent = document.querySelector('.breadcrumb-current');

  // ===== Markdown rendering configuration =====
  var markdownCache = {};

  // Map of markdown file references to section IDs (for link rewriting)
  var fileToSection = {
    'WHAT_IS_TURUMBA.md': 'what-is-turumba',
    'TURUMBA_ARCHITECTURE.md': 'architecture',
    'TURUMBA_MESSAGING.md': 'messaging',
    'TURUMBA_DELIVERY_CHANNELS.md': 'channels',
    'PROJECT_STATUS.md': 'project-status',
    'GITHUB_ISSUES.md': 'issues',
    'ROADMAP.md': 'roadmap',
    'ARCHITECTURE_FULL.md': 'full-spec',
    'guidelines/ISSUE_GUIDELINES.md': 'issue-guidelines',
    'tasks/messaging/BE-001-messages-crud.md': 'be-001',
    'tasks/delivery-channels/BE-002-delivery-channels-crud.md': 'be-002',
    'tasks/messaging/BE-003-template-messages-crud.md': 'be-003',
    'tasks/messaging/BE-004-group-messages-crud.md': 'be-004',
    'tasks/messaging/BE-005-scheduled-messages-crud.md': 'be-005',
    'tasks/messaging/BE-006-event-outbox-rabbitmq.md': 'be-006',
    'tasks/messaging/FE-001-create-new-message.md': 'fe-001',
    'tasks/delivery-channels/FE-002-delivery-channels-table.md': 'fe-002',
    'tasks/delivery-channels/FE-003-create-delivery-channel.md': 'fe-003',
    'tasks/messaging/FE-004-messages-table.md': 'fe-004',
    'tasks/messaging/FE-005-template-messages-table.md': 'fe-005',
    'tasks/messaging/FE-006-create-edit-template.md': 'fe-006',
    'tasks/messaging/FE-007-group-messages-table.md': 'fe-007',
    'tasks/messaging/FE-008-create-group-message.md': 'fe-008',
    'tasks/messaging/FE-009-scheduled-messages-table.md': 'fe-009',
    'tasks/messaging/FE-010-create-edit-scheduled-message.md': 'fe-010',
    'plans/turumba_messaging_api/core-architecture-setup.md': 'plan-core-arch',
    'plans/turumba_messaging_api/dual-database-setup.md': 'plan-dual-db',
    'plans/turumba_messaging_api/alembic-precommit-pytest-setup.md': 'plan-alembic',
    'research/chatwoot-comparison.md': 'research-chatwoot',
    'research/erxes-comparison.md': 'research-erxes',
    'research/freescout-comparison.md': 'research-freescout',
    'research/papercups-comparison.md': 'research-papercups',
    'research/rocket-chat-comparison.md': 'research-rocket-chat',
    'research/tiledesk-comparison.md': 'research-tiledesk',
    'research/zammad-comparison.md': 'research-zammad',
  };

  // Also map bare filenames (without path) for relative links like ./TURUMBA_MESSAGING.md
  var bareFileToSection = {};
  Object.keys(fileToSection).forEach(function (path) {
    var bare = path.split('/').pop();
    bareFileToSection[bare] = fileToSection[path];
  });

  // Configure marked (GFM mode)
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      gfm: true,
      breaks: false,
    });
  }

  // Section titles for breadcrumb
  var sectionTitles = {
    home: 'Overview',
    'what-is-turumba': 'What is Turumba?',
    architecture: 'Architecture',
    messaging: 'Messaging System',
    channels: 'Delivery Channels',
    'project-status': 'Project Status',
    issues: 'GitHub Issues',
    roadmap: 'Roadmap',
    'full-spec': 'Full Specification',
    'issue-guidelines': 'Issue Guidelines',
    'be-001': 'BE-001: Messages CRUD',
    'be-002': 'BE-002: Delivery Channels CRUD',
    'be-003': 'BE-003: Template Messages CRUD',
    'be-004': 'BE-004: Group Messages CRUD',
    'be-005': 'BE-005: Scheduled Messages CRUD',
    'be-006': 'BE-006: Event Outbox + RabbitMQ',
    'fe-001': 'FE-001: Create New Message',
    'fe-002': 'FE-002: Delivery Channels Table',
    'fe-003': 'FE-003: Create Delivery Channel',
    'fe-004': 'FE-004: Messages Table',
    'fe-005': 'FE-005: Template Messages Table',
    'fe-006': 'FE-006: Create/Edit Template',
    'fe-007': 'FE-007: Group Messages Table',
    'fe-008': 'FE-008: Create Group Message',
    'fe-009': 'FE-009: Scheduled Messages Table',
    'fe-010': 'FE-010: Create/Edit Scheduled Message',
    'plan-core-arch': 'Plan: Core Architecture',
    'plan-dual-db': 'Plan: Dual Database',
    'plan-alembic': 'Plan: Alembic & Pytest',
    'research-chatwoot': 'Research: Chatwoot',
    'research-erxes': 'Research: Erxes',
    'research-freescout': 'Research: FreeScout',
    'research-papercups': 'Research: Papercups',
    'research-rocket-chat': 'Research: Rocket.Chat',
    'research-tiledesk': 'Research: Tiledesk',
    'research-zammad': 'Research: Zammad',
  };

  // ===== Markdown loading =====

  function loadMarkdown(sectionId) {
    var section = document.getElementById(sectionId);
    if (!section) return;

    var mdFile = section.getAttribute('data-markdown');
    if (!mdFile) return;

    // Already loaded
    if (markdownCache[sectionId]) return;

    // Mark as loading to prevent double-fetch
    markdownCache[sectionId] = 'loading';

    fetch(mdFile)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
      })
      .then(function (text) {
        markdownCache[sectionId] = text;
        renderMarkdown(section, text);
      })
      .catch(function (err) {
        markdownCache[sectionId] = null; // Allow retry
        section.innerHTML =
          '<div class="markdown-error">' +
          '<p>Failed to load <code>' + mdFile + '</code></p>' +
          '<p class="error-detail">' + err.message + '</p>' +
          '<button class="retry-btn" onclick="window.__retryMarkdown(\'' + sectionId + '\')">Retry</button>' +
          '</div>';
      });
  }

  function renderMarkdown(section, text) {
    var html;
    if (typeof marked !== 'undefined') {
      html = marked.parse(text);
    } else {
      // Fallback: show raw markdown in a pre block
      html = '<pre>' + text.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
    }

    section.innerHTML = '<div class="markdown-content">' + html + '</div>';

    // Apply syntax highlighting to any code blocks missed by marked config
    if (typeof hljs !== 'undefined') {
      section.querySelectorAll('pre code').forEach(function (block) {
        if (!block.classList.contains('hljs')) {
          hljs.highlightElement(block);
        }
      });
    }

    fixMarkdownLinks(section);
  }

  function fixMarkdownLinks(section) {
    var links = section.querySelectorAll('a[href]');
    links.forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href) return;

      // Skip external links and anchors
      if (href.startsWith('http') || href.startsWith('#')) return;

      // Strip leading ./ or ../
      var cleanHref = href.replace(/^\.\//, '').replace(/^\.\.\//, '');

      // Try exact match first, then bare filename
      var targetSection = fileToSection[cleanHref] || bareFileToSection[cleanHref.split('/').pop()];

      if (targetSection) {
        link.setAttribute('href', '#' + targetSection);
        link.addEventListener('click', function (e) {
          e.preventDefault();
          window.location.hash = targetSection;
          showSection(targetSection);
        });
      }
    });
  }

  // Expose retry function globally
  window.__retryMarkdown = function (sectionId) {
    markdownCache[sectionId] = null;
    var section = document.getElementById(sectionId);
    if (section) {
      section.innerHTML = '<div class="markdown-loading"><div class="loading-spinner"></div>Loading...</div>';
      loadMarkdown(sectionId);
    }
  };

  // ===== Section navigation =====

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

      // Lazy-load markdown if needed
      if (target.getAttribute('data-markdown') && !markdownCache[sectionId]) {
        loadMarkdown(sectionId);
      }
    }

    navLinks.forEach(function (l) {
      if (l.getAttribute('data-section') === sectionId) {
        l.classList.add('active');

        // Auto-expand parent nav group if collapsed
        var parentGroup = l.closest('.nav-group-items');
        if (parentGroup && !parentGroup.classList.contains('open')) {
          parentGroup.classList.add('open');
          var groupName = parentGroup.getAttribute('data-group');
          var toggle = document.querySelector('.nav-group-toggle[data-group="' + groupName + '"]');
          if (toggle) toggle.classList.add('open');
        }
      }
    });

    // Update breadcrumb
    if (breadcrumbCurrent) {
      breadcrumbCurrent.textContent = sectionTitles[sectionId] || 'Documentation';
    }

    // Close mobile sidebar
    closeMobileSidebar();

    // Scroll to top
    document.querySelector('.content').scrollTop = 0;
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

  // ===== Mobile menu =====

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

  // ===== Collapsible sidebar groups =====

  document.querySelectorAll('.nav-group-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      var groupName = this.getAttribute('data-group');
      var items = document.querySelector('.nav-group-items[data-group="' + groupName + '"]');
      if (items) {
        this.classList.toggle('open');
        items.classList.toggle('open');
      }
    });
  });

  // ===== Collapsible sections (legacy, for home page) =====

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
