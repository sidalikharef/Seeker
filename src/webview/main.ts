declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type FreeTierClass = 'free-tier' | 'trial-credit' | 'paid' | 'subscription' | 'local' | 'unknown';
type MessageStatus = 'complete' | 'streaming' | 'error' | 'cancelled';
type ErrorAction = 'retry' | 'settings' | 'refreshModels';
type ProviderId = 'openrouter' | 'groq';
type AgentMode = 'ask' | 'plan' | 'review' | 'build' | 'debug';

interface PublicMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  provider?: ProviderId;
  modelId?: string;
  status: MessageStatus;
  error?: string;
}

interface PublicModel {
  id: string;
  name: string;
  freeTierClass: FreeTierClass;
  capabilities: string[];
  available: boolean;
  reason?: string;
}

interface PublicProvider {
  id: ProviderId;
  label: string;
  configured: boolean;
  freeTierClass: FreeTierClass;
  models: PublicModel[];
  error?: string;
}

interface PublicUiState {
  mode: AgentMode;
  providers: PublicProvider[];
  selected?: { provider: ProviderId; modelId: string };
  lastDecision?: {
    provider: ProviderId;
    modelId: string;
    reason: string;
    automatic: boolean;
  };
  policy: string;
  allowPaid: boolean;
  maxCostUsd: number;
  preferredProvider?: ProviderId;
  session: {
    messages: PublicMessage[];
    status: 'idle' | 'streaming' | 'cancelling';
    activeRequestId?: string;
  };
}

type HostMessage =
  | { type: 'init'; state: PublicUiState }
  | { type: 'state'; state: PublicUiState }
  | {
      type: 'assistant.start';
      requestId: string;
      messageId: string;
      provider: ProviderId;
      modelId: string;
    }
  | { type: 'assistant.delta'; requestId: string; messageId: string; text: string }
  | {
      type: 'assistant.end';
      requestId: string;
      messageId: string;
      status: MessageStatus;
      content: string;
      error?: string;
    }
  | {
      type: 'tool.activity';
      id: string;
      requestId?: string;
      label: string;
      status: 'running' | 'ok' | 'error';
    }
  | {
      type: 'error';
      requestId?: string;
      message: string;
      recoverable: boolean;
      actions: ErrorAction[];
    };

const vscode = acquireVsCodeApi();

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing webview element: ${id}`);
  }
  return element as T;
}

const messagesEl = byId<HTMLElement>('messages');
const emptyStateEl = byId<HTMLElement>('empty-state');
const promptEl = byId<HTMLTextAreaElement>('prompt');
const sendEl = byId<HTMLButtonElement>('send');
const stopEl = byId<HTMLButtonElement>('stop');
const composerEl = byId<HTMLFormElement>('composer');
const modelSelectEl = byId<HTMLSelectElement>('model-select');
const modeSelectEl = byId<HTMLSelectElement>('mode-select');
const providerSummaryEl = byId<HTMLElement>('provider-summary');
const refreshModelsEl = byId<HTMLButtonElement>('refresh-models');
const settingsToggleEl = byId<HTMLButtonElement>('settings-toggle');
const settingsPanelEl = byId<HTMLElement>('settings-panel');
const settingsCloseEl = byId<HTMLButtonElement>('settings-close');
const policySelectEl = byId<HTMLSelectElement>('policy-select');
const preferredProviderEl = byId<HTMLSelectElement>('preferred-provider');
const providerSettingsEl = byId<HTMLElement>('provider-settings');
const openSettingsEl = byId<HTMLButtonElement>('open-settings');
const errorBannerEl = byId<HTMLElement>('error-banner');
const errorTextEl = byId<HTMLElement>('error-text');
const errorActionsEl = byId<HTMLElement>('error-actions');
const errorCloseEl = byId<HTMLButtonElement>('error-close');
const announcerEl = byId<HTMLElement>('announcer');
const toolActivityEl = byId<HTMLElement>('tool-activity');
const toolActivityItems = new Map<string, HTMLElement>();

let state: PublicUiState | undefined;
let currentRequestId: string | undefined;
let currentAssistantId: string | undefined;
let renderFrame: number | undefined;
const contentBuffers = new Map<string, string>();
const messageNodes = new Map<string, { article: HTMLElement; content: HTMLElement }>();
const providerLabels: Record<string, string> = { openrouter: 'OpenRouter', groq: 'Groq' };

const tierLabels: Record<FreeTierClass, string> = {
  'free-tier': 'Free',
  'trial-credit': 'Trial',
  paid: 'Paid',
  subscription: 'Subscribed',
  local: 'Local',
  unknown: 'Unknown tier',
};

function post(message: unknown): void {
  vscode.postMessage(message);
}

function providerLabel(provider: string): string {
  return providerLabels[provider] ?? provider;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isNearBottom(): boolean {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
}

function scrollToBottom(force = false): void {
  if (force || isNearBottom()) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function announce(text: string): void {
  announcerEl.textContent = text;
}

function showError(message: string, actions: ErrorAction[], requestId?: string): void {
  errorTextEl.textContent = message;
  errorActionsEl.replaceChildren();
  const labels: Record<ErrorAction, string> = {
    retry: 'Retry',
    settings: 'Settings',
    refreshModels: 'Refresh models',
  };

  for (const action of actions) {
    if (action === 'retry' && !requestId) {
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary compact';
    button.textContent = labels[action];
    button.addEventListener('click', () => {
      hideError();
      if (action === 'retry' && requestId) {
        currentRequestId = requestId;
        post({ type: 'chat.retry', requestId });
      } else if (action === 'refreshModels') {
        post({ type: 'models.refresh' });
      } else {
        openSettings();
      }
    });
    errorActionsEl.append(button);
  }

  errorBannerEl.hidden = false;
  announce(message);
  syncComposer();
}

function hideError(): void {
  errorBannerEl.hidden = true;
  errorActionsEl.replaceChildren();
}

function renderRichText(container: HTMLElement, text: string, streaming: boolean): void {
  container.replaceChildren();
  if (!text) {
    if (streaming) {
      const thinking = document.createElement('span');
      thinking.className = 'thinking';
      thinking.textContent = 'Waiting for the model...';
      container.append(thinking);
    }
    return;
  }

  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text)) !== null) {
    if (match.index > cursor) {
      appendTextBlock(container, text.slice(cursor, match.index));
    }
    appendCodeBlock(container, match[2].replace(/\n$/, ''), match[1].trim() || 'code');
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    appendTextBlock(container, text.slice(cursor));
  }
}

function appendTextBlock(container: HTMLElement, text: string): void {
  const block = document.createElement('div');
  block.className = 'text-block';
  block.textContent = text;
  container.append(block);
}

function appendCodeBlock(container: HTMLElement, code: string, language: string): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'code-block';
  const header = document.createElement('div');
  header.className = 'code-header';
  const lang = document.createElement('span');
  lang.className = 'code-language';
  lang.textContent = language;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'icon-button compact';
  copy.textContent = 'Copy';
  copy.setAttribute('aria-label', 'Copy code');
  copy.addEventListener('click', () => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        copy.textContent = 'Copied';
        window.setTimeout(() => {
          copy.textContent = 'Copy';
        }, 1500);
      })
      .catch(() => {
        copy.textContent = 'Copy failed';
      });
  });
  header.append(lang, copy);
  const pre = document.createElement('pre');
  const codeEl = document.createElement('code');
  codeEl.textContent = code;
  pre.append(codeEl);
  wrapper.append(header, pre);
  container.append(wrapper);
}

function messageMeta(message: PublicMessage): string {
  if (message.role === 'user') {
    return `You · ${formatTime(message.createdAt)}`;
  }
  const provider = message.provider ? providerLabel(message.provider) : 'Assistant';
  const model = message.modelId ? ` · ${message.modelId}` : '';
  return `${provider}${model} · ${formatTime(message.createdAt)}`;
}

function renderMessage(message: PublicMessage): HTMLElement {
  const article = document.createElement('article');
  article.className = `message ${message.role}`;
  article.dataset.messageId = message.id;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = messageMeta(message);

  const content = document.createElement('div');
  content.className = 'message-content';
  if (message.role === 'assistant') {
    if (
      !contentBuffers.has(message.id) ||
      message.content.length > (contentBuffers.get(message.id)?.length ?? 0)
    ) {
      contentBuffers.set(message.id, message.content);
    }
    renderRichText(content, contentBuffers.get(message.id) ?? '', message.status === 'streaming');
  } else {
    const block = document.createElement('div');
    block.className = 'text-block';
    block.textContent = message.content;
    content.append(block);
  }

  article.append(meta, content);

  if (message.role === 'assistant' && message.status !== 'complete') {
    const status = document.createElement('div');
    status.className = `message-status ${message.status}`;
    status.textContent =
      message.status === 'streaming'
        ? 'Streaming'
        : message.status === 'cancelled'
          ? (message.error ?? 'Cancelled')
          : (message.error ?? 'Failed');
    article.append(status);
  }

  messageNodes.set(message.id, { article, content });
  return article;
}

function renderMessages(): void {
  const messages = state?.session.messages ?? [];
  const nearBottom = isNearBottom();
  messageNodes.clear();
  messagesEl.replaceChildren();

  if (messages.length === 0) {
    emptyStateEl.hidden = false;
    messagesEl.append(emptyStateEl);
    return;
  }

  emptyStateEl.hidden = true;
  for (const message of messages) {
    const buffered = contentBuffers.get(message.id) ?? '';
    contentBuffers.set(
      message.id,
      message.content.length >= buffered.length ? message.content : buffered,
    );
    messagesEl.append(renderMessage(message));
  }
  if (nearBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function updateStreamingMessage(messageId: string): void {
  const node = messageNodes.get(messageId);
  if (!node) {
    renderMessages();
    return;
  }
  const content = contentBuffers.get(messageId) ?? '';
  const nearBottom = isNearBottom();
  renderRichText(node.content, content, true);
  if (nearBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function scheduleStreamingRender(): void {
  if (renderFrame !== undefined) {
    return;
  }
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = undefined;
    if (currentAssistantId) {
      updateStreamingMessage(currentAssistantId);
    }
  });
}

function syncComposer(): void {
  const streaming = Boolean(currentRequestId || (state && state.session.status !== 'idle'));
  sendEl.disabled = streaming || promptEl.value.trim().length === 0;
  stopEl.hidden = !streaming;
  stopEl.disabled = state?.session.status === 'cancelling';
  promptEl.setAttribute('aria-busy', streaming ? 'true' : 'false');
}

function modelOptionValue(provider: ProviderId, modelId: string): string {
  return `${provider}:${encodeURIComponent(modelId)}`;
}

function syncModelSelect(): void {
  modelSelectEl.replaceChildren();
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = 'Auto (free-first)';
  modelSelectEl.append(auto);

  for (const provider of state?.providers ?? []) {
    if (provider.models.length === 0) {
      continue;
    }
    const group = document.createElement('optgroup');
    group.label = `${provider.label} (${tierLabels[provider.freeTierClass]})`;
    for (const model of provider.models) {
      const option = document.createElement('option');
      option.value = modelOptionValue(provider.id, model.id);
      option.dataset.provider = provider.id;
      option.dataset.modelId = model.id;
      const capabilities =
        model.capabilities.length > 0 ? ` · ${model.capabilities.join(', ')}` : '';
      option.textContent = `${model.name} · ${tierLabels[model.freeTierClass]}${capabilities}${
        model.available ? '' : ` — ${model.reason ?? 'unavailable'}`
      }`;
      option.disabled = !model.available;
      option.title = model.reason ?? model.name;
      group.append(option);
    }
    modelSelectEl.append(group);
  }

  const selected = state?.selected;
  modelSelectEl.value = selected ? modelOptionValue(selected.provider, selected.modelId) : 'auto';
  if (modelSelectEl.value === '') {
    modelSelectEl.value = 'auto';
  }
}

function syncProviderSummary(): void {
  const providers = state?.providers ?? [];
  const configured = providers.filter((provider) => provider.configured);
  if (configured.length === 0) {
    providerSummaryEl.textContent = 'No provider configured';
    providerSummaryEl.title = 'Open Settings and add a free OpenRouter or Groq API key.';
    providerSummaryEl.classList.add('attention');
    return;
  }

  providerSummaryEl.classList.remove('attention');
  const decision = state?.lastDecision;
  if (decision) {
    const provider = providers.find((item) => item.id === decision.provider);
    const model = provider?.models.find((item) => item.id === decision.modelId);
    providerSummaryEl.textContent = `${providerLabel(decision.provider)} · ${
      model?.name ?? decision.modelId
    } · ${tierLabels[model?.freeTierClass ?? provider?.freeTierClass ?? 'unknown']}`;
    providerSummaryEl.title = decision.reason;
    return;
  }

  const selected = state?.selected;
  if (selected) {
    const provider = providers.find((item) => item.id === selected.provider);
    const model = provider?.models.find((item) => item.id === selected.modelId);
    providerSummaryEl.textContent = `${providerLabel(selected.provider)} · ${
      model?.name ?? selected.modelId
    }`;
    providerSummaryEl.title = 'Explicit model selection';
    return;
  }

  providerSummaryEl.textContent = `${configured.map((provider) => provider.label).join(' + ')} · Auto`;
  providerSummaryEl.title = 'Seeker will select an eligible free streaming model.';
}

function renderProviderSettings(): void {
  providerSettingsEl.replaceChildren();
  const providers = state?.providers ?? [];
  if (providers.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent =
      'No providers are enabled. Update the provider settings and reload the window.';
    providerSettingsEl.append(empty);
    return;
  }

  for (const provider of providers) {
    const row = document.createElement('div');
    row.className = 'provider-row';

    const info = document.createElement('div');
    info.className = 'provider-info';
    const name = document.createElement('strong');
    name.textContent = provider.label;
    const status = document.createElement('span');
    status.className = provider.configured ? 'status ok' : 'status';
    status.textContent = provider.configured ? 'API key configured' : 'No API key';
    const tier = document.createElement('span');
    tier.className = 'status';
    tier.textContent = tierLabels[provider.freeTierClass];
    info.append(name, status, tier);

    if (provider.error) {
      const error = document.createElement('span');
      error.className = 'status error-text';
      error.textContent = provider.error;
      info.append(error);
    }

    const actions = document.createElement('div');
    actions.className = 'provider-actions';
    const setButton = document.createElement('button');
    setButton.type = 'button';
    setButton.className = 'secondary compact';
    setButton.textContent = provider.configured ? 'Replace key' : 'Set key';
    setButton.addEventListener('click', () => {
      post({ type: 'credentials.manage', provider: provider.id, action: 'set' });
    });
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'secondary compact danger';
    deleteButton.textContent = 'Remove key';
    deleteButton.disabled = !provider.configured;
    deleteButton.addEventListener('click', () => {
      post({ type: 'credentials.manage', provider: provider.id, action: 'delete' });
    });
    actions.append(setButton, deleteButton);
    row.append(info, actions);
    providerSettingsEl.append(row);
  }
}

function syncSettings(): void {
  if (!state) {
    return;
  }
  policySelectEl.value = state.policy;
  preferredProviderEl.replaceChildren();
  const anyProvider = document.createElement('option');
  anyProvider.value = '';
  anyProvider.textContent = 'Any provider';
  preferredProviderEl.append(anyProvider);
  for (const provider of state.providers) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = `${provider.label}${provider.configured ? '' : ' (no key)'}`;
    preferredProviderEl.append(option);
  }
  preferredProviderEl.value = state.preferredProvider ?? '';
  renderProviderSettings();
}

function syncState(): void {
  if (!state) {
    return;
  }
  modeSelectEl.value = state.mode;
  syncModelSelect();
  syncProviderSummary();
  syncSettings();
  renderMessages();
  currentRequestId =
    state.session.status === 'streaming' || state.session.status === 'cancelling'
      ? state.session.activeRequestId
      : undefined;
  currentAssistantId =
    currentRequestId === undefined
      ? undefined
      : state.session.messages.find(
          (message) => message.role === 'assistant' && message.status === 'streaming',
        )?.id;
  syncComposer();
  if (state.session.status !== 'idle') {
    scrollToBottom(true);
  }
}

function openSettings(): void {
  settingsPanelEl.hidden = false;
  settingsToggleEl.setAttribute('aria-expanded', 'true');
  policySelectEl.focus();
}

function closeSettings(): void {
  settingsPanelEl.hidden = true;
  settingsToggleEl.setAttribute('aria-expanded', 'false');
  settingsToggleEl.focus();
}

function handleHostMessage(message: HostMessage): void {
  switch (message.type) {
    case 'init':
    case 'state':
      state = message.state;
      syncState();
      if (message.type === 'init') {
        announce('Seeker ready.');
      }
      return;
    case 'assistant.start': {
      currentRequestId = message.requestId;
      currentAssistantId = message.messageId;
      hideError();
      if (state) {
        const existing = state.session.messages.find((item) => item.id === message.messageId);
        if (!existing) {
          state.session.messages.push({
            id: message.messageId,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            provider: message.provider,
            modelId: message.modelId,
            status: 'streaming',
          });
        }
        state.session.status = 'streaming';
        state.session.activeRequestId = message.requestId;
        contentBuffers.set(message.messageId, existing?.content ?? '');
        renderMessages();
        scrollToBottom(true);
      }
      syncComposer();
      return;
    }
    case 'assistant.delta':
      if (message.requestId !== currentRequestId) {
        return;
      }
      contentBuffers.set(
        message.messageId,
        `${contentBuffers.get(message.messageId) ?? ''}${message.text}`,
      );
      currentAssistantId = message.messageId;
      scheduleStreamingRender();
      return;
    case 'assistant.end': {
      if (message.requestId !== currentRequestId) {
        return;
      }
      contentBuffers.set(message.messageId, message.content);
      const target = state?.session.messages.find((item) => item.id === message.messageId);
      if (target) {
        target.content = message.content;
        target.status = message.status;
        target.error = message.error;
      }
      currentRequestId = undefined;
      currentAssistantId = undefined;
      if (state) {
        state.session.status = 'idle';
        state.session.activeRequestId = undefined;
      }
      renderMessages();
      scrollToBottom(true);
      syncComposer();
      announce(
        message.status === 'complete'
          ? 'Response complete.'
          : message.status === 'cancelled'
            ? 'Response cancelled.'
            : `Response failed: ${message.error ?? 'unknown error'}`,
      );
      return;
    }
    case 'error':
      showError(message.message, message.actions, message.requestId);
      if (message.requestId && message.requestId === currentRequestId) {
        currentRequestId = undefined;
        currentAssistantId = undefined;
        if (state && state.session.status !== 'streaming') {
          state.session.status = 'idle';
        }
        syncComposer();
      }
      return;
    case 'tool.activity':
      renderToolActivity(message);
      return;
  }
}

function renderToolActivity(message: Extract<HostMessage, { type: 'tool.activity' }>): void {
  toolActivityEl.hidden = false;
  let item = toolActivityItems.get(message.id);
  if (!item) {
    item = document.createElement('div');
    item.className = 'tool-item';
    toolActivityItems.set(message.id, item);
    toolActivityEl.append(item);
  }
  item.textContent = `${message.label}${message.status === 'running' ? '...' : ''}`;
  item.dataset.status = message.status;
}

function submitPrompt(): void {
  const text = promptEl.value.trim();
  if (!text || currentRequestId) {
    return;
  }
  hideError();
  const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  currentRequestId = requestId;
  promptEl.value = '';
  resizePrompt();
  post({ type: 'chat.send', requestId, message: text });
  syncComposer();
}

function resizePrompt(): void {
  promptEl.style.height = 'auto';
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 220)}px`;
}

composerEl.addEventListener('submit', (event) => {
  event.preventDefault();
  submitPrompt();
});

promptEl.addEventListener('input', () => {
  resizePrompt();
  syncComposer();
});

promptEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitPrompt();
  } else if (event.key === 'Escape' && currentRequestId) {
    post({ type: 'chat.cancel', requestId: currentRequestId });
  }
});

stopEl.addEventListener('click', () => {
  if (currentRequestId) {
    stopEl.disabled = true;
    post({ type: 'chat.cancel', requestId: currentRequestId });
  }
});

modeSelectEl.addEventListener('change', () => {
  const mode = modeSelectEl.value;
  if (
    mode === 'ask' ||
    mode === 'plan' ||
    mode === 'review' ||
    mode === 'build' ||
    mode === 'debug'
  ) {
    post({ type: 'mode.set', mode });
  }
});

modelSelectEl.addEventListener('change', () => {
  if (modelSelectEl.value === 'auto') {
    post({ type: 'model.auto' });
    return;
  }
  const option = modelSelectEl.selectedOptions[0];
  const provider = option?.dataset.provider;
  const modelId = option?.dataset.modelId;
  if (provider && modelId) {
    post({ type: 'model.select', provider, modelId });
  }
});

refreshModelsEl.addEventListener('click', () => {
  post({ type: 'models.refresh' });
});

settingsToggleEl.addEventListener('click', () => {
  if (settingsPanelEl.hidden) {
    openSettings();
  } else {
    closeSettings();
  }
});

settingsCloseEl.addEventListener('click', closeSettings);
errorCloseEl.addEventListener('click', hideError);
openSettingsEl.addEventListener('click', () => {
  post({ type: 'settings.open' });
});

policySelectEl.addEventListener('change', () => {
  post({ type: 'settings.update', key: 'policy', value: policySelectEl.value });
});

preferredProviderEl.addEventListener('change', () => {
  post({
    type: 'settings.update',
    key: 'preferredProvider',
    value: preferredProviderEl.value,
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsPanelEl.hidden) {
    closeSettings();
  }
});

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  handleHostMessage(event.data);
});

renderMessages();
syncComposer();
post({ type: 'ready' });
