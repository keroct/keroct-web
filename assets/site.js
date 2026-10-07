'use strict';
const themeButton = document.querySelector('.theme-toggle');
try { const savedTheme = localStorage.getItem('keroct-theme'); if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.dataset.theme = savedTheme; } catch {}
function isDark() { return document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
themeButton?.setAttribute('aria-pressed', String(isDark()));
themeButton?.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = next;
  themeButton.setAttribute('aria-pressed', String(next === 'dark'));
  try { localStorage.setItem('keroct-theme', next); } catch {}
});
const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');
menu?.addEventListener('click', () => {
  const expanded = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(expanded));
  navigation.classList.toggle('is-open', expanded);
});
navigation?.querySelectorAll('a,button').forEach(link => link.addEventListener('click', () => {
  navigation.classList.remove('is-open');
  menu.setAttribute('aria-expanded', 'false');
}));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigation?.classList.contains('is-open')) {
    navigation.classList.remove('is-open'); menu.setAttribute('aria-expanded','false'); menu.focus();
  }
});
function filterWorks(category) {
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === category)));
  let count = 0;
  document.querySelectorAll('.work').forEach(work => {
    work.hidden = category !== 'all' && work.dataset.category !== category;
    if (!work.hidden) count++;
  });
  const status = document.querySelector('#filter-status');
  if (status) status.textContent = `${count}件の制作例を表示しています。`;
}
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => filterWorks(button.dataset.filter)));
document.querySelectorAll('[data-category-link]').forEach(link => link.addEventListener('click', () => filterWorks(link.dataset.categoryLink)));
const lightbox = document.querySelector('#lightbox');
document.querySelectorAll('[data-image]').forEach(button => button.addEventListener('click', () => {
  const image = lightbox.querySelector('img');
  image.src = button.dataset.image; image.alt = button.dataset.title;
  lightbox.querySelector('p').textContent = button.dataset.title;
  lightbox.showModal();
}));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }});
});
const config = window.KEROCT_CONFIG || {};
const contactDialog = document.querySelector('#contact-dialog');
const chatConfigured = /^[a-f0-9]{24}$/.test(config.tawkPropertyId || '') && /^[a-zA-Z0-9]+$/.test(config.tawkWidgetId || '');
const chatLauncher = document.createElement('button');
chatLauncher.type = 'button';
chatLauncher.className = 'button chat-launcher';
chatLauncher.dataset.contact = '';
chatLauncher.textContent = '制作を相談する';
document.body.appendChild(chatLauncher);
let chatLoad;
function loadChat() {
  if (chatLoad) return chatLoad;
  chatLoad = new Promise((resolve, reject) => {
    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_API.onLoad = resolve;
    window.Tawk_API.onChatMaximized = () => { chatLauncher.hidden = true; };
    window.Tawk_API.onChatMinimized = () => {
      window.Tawk_API.hideWidget();
      chatLauncher.hidden = false;
      chatLauncher.focus({ preventScroll: true });
    };
    window.Tawk_API.onChatHidden = () => { chatLauncher.hidden = false; };
    window.Tawk_LoadStart = new Date();
    const script = document.createElement('script');
    script.src = `https://embed.tawk.to/${config.tawkPropertyId}/${config.tawkWidgetId}`;
    script.async = true; script.charset = 'UTF-8'; script.crossOrigin = 'anonymous';
    script.onerror = () => { script.remove(); chatLoad = undefined; reject(new Error('chat-load')); };
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('chat-timeout')), 15000);
  });
  return chatLoad;
}
document.querySelectorAll('[data-contact]').forEach(button => button.addEventListener('click', async () => {
  if (!chatConfigured) { contactDialog.showModal(); return; }
  const content = document.querySelector('#contact-content');
  content.textContent = '相談窓口を読み込んでいます。'; contactDialog.showModal();
  try { await loadChat(); contactDialog.close(); window.Tawk_API.showWidget(); window.Tawk_API.maximize(); }
  catch { content.textContent = '相談窓口を読み込めませんでした。時間をおいて再度お試しください。'; }
}));
document.querySelectorAll('.work-image img').forEach(image => image.addEventListener('error', () => {
  image.alt = '画像を読み込めませんでした。'; image.classList.add('image-error');
}));
