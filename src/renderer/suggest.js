const list = document.querySelector('#list');

window.suggest.onUpdate(({ items, selected }) => {
  list.replaceChildren();
  items.forEach((item, index) => {
    const row = document.createElement('li');
    row.className = index === selected ? 'row selected' : 'row';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === selected));
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title || item.display;
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = item.title ? item.display : '';
    row.append(title, url);
    // mousedown fires before the address bar loses focus and hides this list.
    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      window.suggest.choose(index);
    });
    list.append(row);
  });
});
