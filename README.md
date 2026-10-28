
# Seeker

A VS Code extension that brings DeepSeek-powered code editing directly into your editor.
Chat with the model, select code, and let it rewrite, refactor, fix, or explain — right where you work.

## Features (planned)

- 💬 **Chat sidebar** — talk to DeepSeek about your code with full file context.
- ✏️ **Inline edit** — select code, press a shortcut, describe the change, and get a diff preview before applying.
- 🐛 **Fix / Explain / Refactor** — one-click actions from the right-click menu.
- 🔍 **Diff preview** — see every change as a VS Code diff before it touches your file.
- 🔑 **Bring your own key** — API key stored securely in VS Code SecretStorage.
- 🌐 **Configurable endpoint** — works with DeepSeek cloud API or a local/compatible endpoint.
- 📦 **Streaming responses** — see output as it is generated.

## Requirements

- VS Code `^1.90.0`
- Node.js `>=18`
- A DeepSeek API key (or any OpenAI-compatible endpoint)

## Getting Started (dev)

```bash
git clone <your-repo>
cd Seeker
npm install
npm run compile