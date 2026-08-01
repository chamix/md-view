const container = document.getElementById('content');

function renderError(message) {
  container.textContent = '';
  const p = document.createElement('p');
  p.className = 'md-view-error';
  p.textContent = 'Could not open file: ' + message;
  container.appendChild(p);
}

function renderHtml(html) {
  container.innerHTML = html;
}

window.mdview.onFileRendered((message) => {
  if (message.ok) {
    renderHtml(message.html);
  } else {
    renderError(message.error);
  }
});

const openButton = document.getElementById('open-file-btn');
if (openButton) {
  openButton.addEventListener('click', () => {
    window.mdview.openFileDialog();
  });
}
