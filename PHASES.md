
---

## 🗺️ Project Phases

### **Phase 0 — Setup (Day 1)**
Goal: a runnable "Hello World" extension.

- [ ] `npm init -y`, add `typescript`, `@types/vscode`, `@types/node`, `esbuild` (or `tsc`).
- [ ] Create `package.json` with `main`, `engines.vscode`, `activationEvents`, `contributes.commands`.
- [ ] `src/extension.ts` with `activate()` / `deactivate()`.
- [ ] Register command `deepcode.hello` that shows a message.
- [ ] Verify `F5` launches and the command works.

**Definition of done:** pressing F5 opens the dev host and the command shows a popup.

---

### **Phase 1 — API Key + DeepSeek Connection**
Goal: prove you can call DeepSeek from the extension.

- [ ] Add `openai` dependency.
- [ ] Command `deepcode.setApiKey` → prompt for key, store in `context.secrets`.
- [ ] Command `deepcode.testConnection` → send a "ping" prompt, show response in an information message.
- [ ] Add config schema for `baseURL`, `model`, `temperature`, `maxTokens`.
- [ ] Write `src/deepseek/client.ts` wrapping `new OpenAI({ baseURL, apiKey })` with a single `chat(messages, stream)` helper.

**Definition of done:** you can set a key and get a real answer from DeepSeek in a VS Code notification.

---

### **Phase 2 — Chat Sidebar**
Goal: persistent chat panel with streaming.

- [ ] Implement a `WebviewViewProvider` for a sidebar view (`deepcode.chatView`).
- [ ] Build minimal HTML/JS UI: message list, input box, send button, "stop" button.
- [ ] Wire messages between webview and extension via `postMessage`.
- [ ] Stream chunks from DeepSeek into the webview as they arrive.
- [ ] Include the **active file path + selection** as system context automatically.
- [ ] Add a token-budget guard (truncate or summarize if too long).

**Definition of done:** you can chat with DeepSeek about the currently open file, watching text stream in.

---

### **Phase 3 — Inline Edit (the "edit code" core)**
Goal: select code → describe a change → get a diff → apply.

- [ ] Command `deepcode.editSelection` bound to a keybinding (`ctrl+alt+e` / `cmd+alt+e`).
- [ ] Capture selection text + surrounding context via `editor.document.getText(range)`.
- [ ] Prompt template: "Return ONLY the modified code, no fences, no explanation."
- [ ] Parse the response safely (strip ``` fences if present).
- [ ] Show a **diff preview**: create a virtual document (`vscode.workspace.openTextDocument({ content })`) and use `vscode.diff` against the original file.
- [ ] Apply with `WorkspaceEdit` when the user confirms; support undo natively.
- [ ] Handle multi-line and full-file replacements.

**Definition of done:** select a function, ask "rewrite with error handling", see a diff, click apply, file changes.

---

### **Phase 4 — Code Actions & Context Menu**
Goal: one-click actions without typing prompts.

- [ ] Register `codeActions` provider contributing:
  - `DeepCode: Explain selection`
  - `DeepCode: Fix selection`
  - `DeepCode: Refactor selection`
  - `DeepCode: Add comments`
  - `DeepCode: Write unit test`
- [ ] Each action reuses the Phase 3 diff flow.
- [ ] Add `DeepCode: Explain File` command (summary in a markdown webview).

**Definition of done:** right-click a selection, pick any action, get a sensible diff or explanation.

---

### **Phase 5 — Polish & Safety**
Goal: make it feel like a real product.

- [ ] Cancellation: `AbortController` wired to a "Stop" button and `vscode.CancellationToken`.
- [ ] Error handling: bad key, rate limits, network errors → friendly messages.
- [ ] Inline status bar item showing "DeepCode: ready / busy".
- [ ] Per-workspace chat history (stored in `context.workspaceState`).
- [ ] Logging via `vscode.window.createOutputChannel('DeepCode')`.
- [ ] Telemetry-free (opt-in only if you ever add it).

**Definition of done:** no crashes on the common edge cases; the busy indicator shows during requests.

---

### **Phase 6 — Advanced (optional, later)**
- [ ] **Local model support**: add a "Ollama" provider (`http://localhost:11434`) behind the same client interface.
- [ ] **Model picker** dropdown in the chat UI.
- [ ] **Multi-file edit**: let the model propose edits to multiple files and apply as one `WorkspaceEdit`.
- [ ] **`@` mentions**: type `@file` in chat to add files to context.
- [ ] **Language Model Chat Provider** integration (`vscode.lm`) so your models appear in VS Code's native model dropdown.
- [ ] Publish to the VS Code Marketplace (needs a publisher ID, PAT, `vsce`).

---

## 📁 Suggested File Structure
