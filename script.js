const menu = document.querySelector('[data-mobile-menu]');
const openButton = document.querySelector('[data-menu-open]');
const closeButton = document.querySelector('[data-menu-close]');
const menuLinks = document.querySelectorAll('[data-menu-link]');
const mapModal = document.querySelector('[data-map-modal]');
const mapModalOpenButton = document.querySelector('[data-map-modal-open]');
const mapModalCloseButton = document.querySelector('[data-map-modal-close]');
const embeddedMapFrame = document.querySelector('.map-embed-frame');
const expandedMapFrame = document.querySelector('.map-modal-frame');
const mapNewTabLink = document.querySelector('.map-actions a[href$="crime_map.html"]');

function getMapUrl() {
  return new URL('crime_map.html', window.location.href).toString();
}

function syncMapUrlsToCurrentOrigin() {
  const mapUrl = getMapUrl();
  const mapPath = 'crime_map.html';

  if (embeddedMapFrame) {
    embeddedMapFrame.src = mapUrl;
  }

  // Keep modal iframe unloaded until user opens it.
  expandedMapFrame?.setAttribute('data-map-src', mapPath);

  if (mapNewTabLink) {
    mapNewTabLink.href = mapUrl;
  }
}

function openMenu() {
  if (!menu) {
    return;
  }

  menu.classList.add('is-open');
  document.body.classList.add('menu-open');
  openButton?.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  if (!menu) {
    return;
  }

  menu.classList.remove('is-open');
  document.body.classList.remove('menu-open');
  openButton?.setAttribute('aria-expanded', 'false');
}

function openMapModal() {
  if (!mapModal) {
    return;
  }

  const mapUrl = getMapUrl();

  if (expandedMapFrame && expandedMapFrame.src !== mapUrl) {
    expandedMapFrame.src = mapUrl;
  }

  mapModal.classList.add('is-open');
  mapModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('menu-open');
}

function closeMapModal() {
  if (!mapModal) {
    return;
  }

  mapModal.classList.remove('is-open');
  mapModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('menu-open');
}

openButton?.addEventListener('click', openMenu);
closeButton?.addEventListener('click', closeMenu);
mapModalOpenButton?.addEventListener('click', openMapModal);
mapModalCloseButton?.addEventListener('click', closeMapModal);

menuLinks.forEach((link) => {
  link.addEventListener('click', closeMenu);
});

menu?.addEventListener('click', (event) => {
  if (event.target === menu) {
    closeMenu();
  }
});

mapModal?.addEventListener('click', (event) => {
  if (event.target === mapModal) {
    closeMapModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenu();
    closeMapModal();
  }
});

if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}

syncMapUrlsToCurrentOrigin();
