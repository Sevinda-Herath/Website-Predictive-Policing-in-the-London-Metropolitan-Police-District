const menu = document.querySelector('[data-mobile-menu]');
const openButton = document.querySelector('[data-menu-open]');
const closeButton = document.querySelector('[data-menu-close]');
const menuLinks = document.querySelectorAll('[data-menu-link]');

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

openButton?.addEventListener('click', openMenu);
closeButton?.addEventListener('click', closeMenu);

menuLinks.forEach((link) => {
  link.addEventListener('click', closeMenu);
});

menu?.addEventListener('click', (event) => {
  if (event.target === menu) {
    closeMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenu();
  }
});
