'use strict';

const labels = {
  conversation: 'Conversation',
  work: 'Work Mode',
  activity: 'Activity',
  evidence: 'Evidence',
  'system-models': 'System & Models',
};

const navRoot = document.getElementById('nav');
const surfaceRoot = document.getElementById('surface');
const title = document.getElementById('title');
const status = document.getElementById('status');
const composer = document.getElementById('composer');
const send = document.getElementById('send');
let state = null;
let identity = null;

function safeText(value) {
  return String(value == null ? '' : value);
}

function renderNavigation(navigation) {
  navRoot.replaceChildren();
  for (const item of navigation) {
    const button = document.createElement('button');
    button.className = 'nav';
    button.type = 'button';
    button.id = item.id;
    button.dataset.surface = item.surface;
    button.setAttribute('role', item.role || 'tab');
    button.setAttribute('aria-selected', String(Boolean(item.ariaSelected)));
    button.setAttribute('aria-controls', item.ariaControls || `surface-${item.surface}`);
    button.tabIndex = Number(item.tabIndex);
    button.textContent = labels[item.surface] || item.surface;
    button.addEventListener('click', async () => {
      const result = await window.llera.setSurface(item.surface);
      state.navigation = result.navigation;
      render();
    });
    navRoot.appendChild(button);
  }
}

function renderSurface(active) {
  surfaceRoot.replaceChildren();
  const panel = document.createElement('article');
  panel.className = 'panel';
  panel.id = `surface-${active}`;
  const h = document.createElement('h1');
  h.textContent = labels[active] || active;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = active === 'conversation'
    ? 'Desktop packaging is now wired to the reconstructed AURORA interaction contract. Runtime/model/mission wiring remains a separate final-gate task and is not faked in this shell.'
    : `The ${labels[active] || active} surface is registered by the reconstructed AURORA contract.`;
  panel.append(h, p);

  if (!identity?.exactHistoricalV54) {
    const warning = document.createElement('div');
    warning.className = 'warning';
    warning.textContent = 'Reconstructed candidate — not exact historical V5.4 source and not Windows-grade final until physical validation gates pass.';
    panel.appendChild(warning);
  }
  surfaceRoot.appendChild(panel);
}

function render() {
  const active = state.navigation.find((x) => x.active)?.surface || 'conversation';
  renderNavigation(state.navigation);
  title.textContent = labels[active] || active;
  status.textContent = identity?.uiSelfTest?.ok ? 'AURORA contract self-test OK' : 'AURORA contract self-test unavailable';
  renderSurface(active);
}

async function boot() {
  identity = await window.llera.identity();
  state = await window.llera.uiState();
  render();
}

composer.addEventListener('input', async () => {
  const composerState = await window.llera.composer(composer.value);
  send.disabled = Boolean(composerState.sendDisabled);
});

window.addEventListener('resize', () => {
  window.llera.setViewport(window.innerWidth).catch(() => {});
});

window.addEventListener('keydown', async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    const result = await window.llera.shortcut({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      focusOrigin: document.activeElement?.id || 'composer',
    });
    status.textContent = result.open ? 'Command palette open (contract)' : 'Command palette closed';
  }
});

boot().catch((error) => {
  status.textContent = `Boot error: ${safeText(error?.message || error)}`;
});
