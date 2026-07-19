[![Download](https://img.shields.io/github/v/release/balamurugan-cholas/dosa?label=Download&style=flat-square)](https://github.com/balamurugan-cholas/Dosa/releases/latest) — [Click here to download the latest release](https://github.com/balamurugan-cholas/Dosa/releases/latest)

# Dosa — Real-Time Interview Assistant

A lightweight, Invisible to interviewer, always-on-top desktop app that listens to your interview audio, transcribes it live, and generates AI-powered answers - all without leaving your screen. Free forever, no subscription required.

---

## Features

- **Live Transcription** - Captures system audio in real time via Deepgram and displays a rolling transcript as the interviewer speaks
- **AI Answers** - Sends the latest transcript to OpenRouter and streams a context-aware answer instantly, spoken as you - not as an AI
- **Answer Navigation** - Stores multiple answers as pages; switch between them with `‹ 1/3 ›` buttons or `Alt+Left` / `Alt+Right`
- **Auto-Answer Mode** - Automatically fires an answer 2 seconds after the interviewer stops talking; useful when you can't interact with the app (e.g. hands raised)
- **Screen Analysis** - Takes a screenshot and asks Gemini to analyze it and respond as if you're the candidate
- **Answer Memory** - Remembers past Q&A pairs within a session so answers stay contextually consistent (set to 0 to disable)
- **Resume-Aware** - Upload your resume so the AI draws from your actual background when answering personal or experience questions
- **Candidate Voice** - AI answers are written in first person, directly to the interviewer - no AI-speak, no filler phrases
- **VS Code Bridge** - A companion VS Code extension ("Dosa Bridge") connects Dosa directly to your editor over `localhost`. Every code block in a coding answer gets a "VS Code" button that inserts it straight into your active file at the cursor, and nothing leaves your machine
- **Continue — Smart Code Placement** - For follow-up coding questions, the "Continue" button sends your current file to the model, which works out exactly what's new and where it belongs — no duplicate imports, no re-declared setup code, no code landing in the wrong spot. A line-level diffing engine and block-aware insertion logic keep the rest of your file untouched, and any edit that tries to rewrite existing code (rather than just add to it) is automatically rejected
- **Natural Typing Mode** - Choose between Instant (pastes immediately) or Natural Typing (types code out like a real person, with variable per-character speed, occasional thinking pauses, and correct indentation) — switchable anytime in Settings, no restart needed
- **In-App Auto Update** - When a new version is available, an update icon appears in the topbar; click to download, install, and relaunch instantly
- **Always on Top** - Transparent, frameless overlay that stays visible over any other app
- **Global Shortcuts** - Control everything without clicking into the app
- **Snap Positioning** - Snap the window to the left, center, or right edge of your screen

---

## Screenshots

<img width="49%" alt="Main View" src="https://github.com/user-attachments/assets/57c55448-acff-435c-b093-08e7db4c55a6" />
<img width="49%" alt="Settings View" src="https://github.com/user-attachments/assets/f2440a92-2a28-4d2c-8437-6c81bce619be" />

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron |
| UI | React + TypeScript + Tailwind CSS |
| Transcription | Deepgram Nova-3 (WebSocket streaming) |
| AI Answers | OpenRouter (any model) |
| Screen Analysis | Google Gemini 2.5 Flash |
| Editor Integration | Dosa Bridge (VS Code extension, local WebSocket) |
| Build | Vite |
| Styling | shadcn/ui |

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- API keys for the services you want to use (see below)
- (Optional) VS Code with the Dosa Bridge extension installed, for editor integration

---

## API Keys

The app requires you to bring your own API keys. None are bundled. All keys are stored locally in `localStorage` and never sent anywhere except the respective API endpoints.

| Key | Where to get it | Required for |
|---|---|---|
| Deepgram API Key | [console.deepgram.com](https://console.deepgram.com) | Live transcription |
| OpenRouter API Key | [openrouter.ai/keys](https://openrouter.ai/keys) | AI answers |
| Gemini API Key | [aistudio.google.com](https://aistudio.google.com/app/apikey) | Screen analysis |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/balamurugan-cholas/Dosa.git
cd Dosa
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start in development mode

```bash
npm run dev
```

This starts the Vite dev server and launches the Electron window simultaneously.

### 4. Build for production

```bash
npm run package:win
```

### 5. (Optional) Connect VS Code

Install the Dosa Bridge extension from its `.vsix` file in VS Code (`Extensions → ... → Install from VSIX`). It runs quietly in the background and connects automatically over `localhost` — nothing leaves your machine. Once installed, coding answers in Dosa show "VS Code" and "Continue" buttons for direct insertion.

---

## Global Shortcuts

| Shortcut | Action |
|---|---|
| `Alt + Q` | Start / stop listening |
| `Alt + W` | Generate an AI answer from the transcript |
| `Alt + Enter` | Analyze the current screen with Gemini |
| `Alt + Left` | Switch to previous answer |
| `Alt + Right` | Switch to next answer |
| `Alt + C` | Clear all transcript and answers |
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

When you press **Answer** (or Auto-Answer triggers), the latest transcript is sent to OpenRouter and the response streams back token by token, written as the candidate speaking directly to the interviewer. When you press **Analyze**, a screenshot is captured, encoded as base64, and sent to Gemini.

For coding questions, code blocks in the answer can be sent straight to your active VS Code file via the Dosa Bridge extension — either inserted as-is (**VS Code** button) or merged intelligently against your current file's contents (**Continue** button), using a line-level diff so only genuinely new code is added.

---

## Project Structure

```
├── electron/
│   ├── main.cjs                   # Electron main process, IPC handlers, global shortcuts
│   ├── preload.cjs                # Context bridge (exposes APIs to renderer)
│   └── deepgram-transcription.cjs # Deepgram WebSocket manager
│
├── src/
│   ├── app/
│   │   └── App.tsx                # Root component, all state management
│   ├── components/
│   │   ├── ContentArea.tsx        # Transcript + answer display
│   │   ├── MainView.tsx           # Main layout
│   │   ├── Topbar.tsx             # Controls, answer navigation, auto-answer toggle
│   │   ├── SettingsView.tsx       # Settings panel
│   │   └── settings/              # Individual settings sections
│   └── lib/
│       ├── audio-transcription-deepgram.ts  # Renderer-side audio capture
│       ├── analyze-screen.ts                # Gemini screen analysis
│       ├── openrouter.ts                    # OpenRouter streaming + intent detection
│       ├── openrouter-system-prompt.ts      # Candidate persona system prompt
│       ├── types.ts                         # Shared TypeScript types
│       └── window-controls.ts              # Window IPC helpers
│
├── scripts/
│   └── dev.mjs                    # Dev launcher (Vite + Electron)
└── index.html
```

---

## Settings

All settings are accessible via the gear icon in the topbar.

- **Deepgram API Key** — required for transcription
- **OpenRouter API Key + Model** — required for answers; defaults to a free model
- **Gemini API Key** — required for screen analysis
- **Job Role** — passed to the AI as context (e.g. "Software Engineer")
- **Answer Memory** — how many past Q&A pairs to include per answer (0 to disable; recommended for faster answers)
- **Resume Upload** — upload a PDF, DOCX, TXT, or MD file; extracted text is used for resume-related answers
- **Code Insert Style** — choose Instant or Natural Typing for how code is inserted into VS Code
- **App Width** — adjust the overlay width (760–1000px)
- **App Transparency** — adjust the overlay opacity

---

## Known Limitations

- System audio capture requires granting screen share permission on each session (OS limitation)
- Keep system volume at 50–70% for best transcription accuracy — very high volumes can cause audio clipping
- AirPods and Bluetooth device switching may require restarting the Listen session
- Free OpenRouter models may be rate-limited; bring your own API key for reliability
- On macOS, system audio capture via `getDisplayMedia` may not work without a third-party virtual audio driver
- VS Code integration requires the Dosa Bridge extension to be installed and running

---

## License - MIT
