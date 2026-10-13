// Menu do celular: abre e fecha a navegação; fecha ao escolher uma seção ou apertar Esc.
const button = document.querySelector('.menu-btn');
const menu = document.getElementById('menu');

function setOpen(open) {
  menu.classList.toggle('nav--open', open);
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
}

button?.addEventListener('click', () => setOpen(!menu.classList.contains('nav--open')));
menu?.addEventListener('click', (e) => {
  if (e.target instanceof HTMLAnchorElement) setOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.classList.contains('nav--open')) {
    setOpen(false);
    button.focus();
  }
});
