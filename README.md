# Dosa — Real-Time Interview Assistant

A lightweight, always-on-top desktop app that listens to your interview audio, transcribes it live, and generates AI-powered answers — all without leaving your screen.

---

## Features

- **Live Transcription** — Captures system audio in real time via Deepgram and displays a rolling transcript as you speak
- **AI Answers** — Sends the latest transcript to OpenRouter and streams a context-aware answer instantly
- **Screen Analysis** — Takes a screenshot and asks Gemini to analyze it and respond as if you're the candidate
- **Answer Memory** — Remembers past Q&A pairs within a session so answers stay contextually consistent
- **Resume-Aware** — Upload your resume so the AI can draw from your actual background when answering
- **Always on Top** — Transparent, frameless overlay that stays visible over any other app
- **Global Shortcuts** — Control everything without clicking into the app
- **Snap Positioning** — Snap the window to the left, center, or right edge of your screen

---

## Screenshots

<img width="763" height="631" alt="image" src="https://github.com/user-attachments/assets/1f73166d-321e-41db-838c-9ce70067dad6" />


---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron |
| UI | React + TypeScript + Tailwind CSS |
| Transcription | Deepgram Nova-3 (WebSocket streaming) |
| AI Answers | OpenRouter (any model) |
| Screen Analysis | Google Gemini 2.5 Flash |
| Build | Vite |
| Styling | shadcn/ui |

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- API keys for the services you want to use (see below)

---

## API Keys

The app requires you to bring your own API keys. None are bundled. All keys are stored locally in your browser's `localStorage` and never sent anywhere except the respective API endpoints.

| Key | Where to get it | Required for |
|---|---|---|
| Deepgram API Key | [console.deepgram.com](https://console.deepgram.com) | Live transcription |
| OpenRouter API Key | [openrouter.ai/keys](https://openrouter.ai/keys) | AI answers |
| Gemini API Key | [aistudio.google.com](https://aistudio.google.com/app/apikey) | Screen analysis |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/balamurugan-cholas/dosa.git
cd dosa
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start in development mode

```bash
pnpm dev
```

This starts the Vite dev server and launches the Electron window simultaneously.

### 4. Build for production

```bash
pnpm build
```

---

## Global Shortcuts

| Shortcut | Action |
|---|---|
| `Alt + Q` | Start / stop listening |
| `Alt + W` | Generate an AI answer from the transcript |
| `Alt + Enter` | Analyze the current screen with Gemini |
| `Alt + C` | Clear all transcript and answer blocks |
| `Alt + Down` | Scroll to the bottom of the content |
| `Alt + X` | Show / hide the app window |
| `Ctrl/Cmd + Shift + ←` | Snap window left |
| `Ctrl/Cmd + Shift + →` | Snap window right |

---

## How It Works

```
System Audio
     │
     ▼
getDisplayMedia() ──► ScriptProcessorNode ──► downsample to 16kHz PCM
                                                       │
                                                       ▼
                                            Electron IPC (audio chunk)
                                                       │
                                                       ▼
                                         Deepgram WebSocket (Nova-3)
                                                       │
                                                       ▼
                                            Transcript event over IPC
                                                       │
                                                       ▼
                                             React state → UI display
```

When you press **Answer**, the latest transcript is sent to OpenRouter and the response streams back token by token. When you press **Analyze**, a screenshot is captured, hidden from the frame, encoded as base64, and sent inline to Gemini.

---

## Project Structure

```
├── electron/
│   ├── main.cjs                  # Electron main process, IPC handlers
│   ├── preload.cjs               # Context bridge (exposes APIs to renderer)
│   └── deepgram-transcription.cjs # Deepgram WebSocket manager
│
├── src/
│   ├── app/
│   │   └── App.tsx               # Root component, all state management
│   ├── components/
│   │   ├── ContentArea.tsx       # Transcript + answer display
│   │   ├── BottomBar.tsx         # Listen / Answer / Analyze buttons
│   │   ├── MainView.tsx          # Main layout
│   │   ├── SettingsView.tsx      # Settings panel
│   │   └── settings/             # Individual settings sections
│   └── lib/
│       ├── audio-transcription-deepgram.ts  # Renderer-side audio capture
│       ├── analyze-screen.ts                # Gemini screen analysis
│       ├── openrouter.ts                    # OpenRouter streaming
│       ├── types.ts                         # Shared TypeScript types
│       └── window-controls.ts              # Window IPC helpers
│
├── scripts/
│   └── dev.mjs                   # Dev launcher (Vite + Electron)
└── index.html
```

---

## Settings

All settings are accessible via the gear icon in the top bar.

- **Deepgram API Key** — required for transcription
- **OpenRouter API Key + Model** — required for answers; defaults to a free model
- **Gemini API Key** — required for screen analysis
- **Job Role** — passed to the AI as context (e.g. "Software Engineer")
- **Answer Memory** — how many past Q&A pairs to include in each answer request (0 to disable)
- **Resume Upload** — upload a PDF, DOCX, TXT, or MD file; text is extracted and used in resume-related answers
- **App Width** — adjust the overlay width (760–1000px)
- **App Transparency** — adjust the overlay opacity

---

## Known Limitations

- System audio capture requires granting screen share permission on each session (OS limitation)
- On macOS, system audio capture via `getDisplayMedia` may not work without a third-party virtual audio driver
- `ScriptProcessorNode` is deprecated in modern browsers; a future update will migrate to `AudioWorklet`

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

---

## License

MIT
