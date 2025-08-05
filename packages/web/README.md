# Audio Streaming to Bedrock React App

This is a React application for streaming audio to Amazon Bedrock, built with:

- React 18
- TypeScript
- Vite
- Zustand for state management
- shadcn UI components
- AudioWorkletNode for audio processing

## Features

- Real-time audio streaming to Amazon Bedrock
- Chat interface with user and assistant messages
- Audio playback of responses
- Modern UI with shadcn components

## Development

### Prerequisites

- Node.js 16+
- pnpm

### Installation

```bash
pnpm install
```

### Running the development server

```bash
pnpm dev
```

### Building for production

```bash
pnpm build
```

## Architecture

- **AudioPlayer**: Uses AudioWorkletNode for audio playback
- **AudioProcessor**: Uses AudioWorkletNode for audio input processing
- **Zustand Stores**:
  - `audioStore`: Manages audio state and operations
  - `chatStore`: Manages chat history and UI state
  - `socketStore`: Manages WebSocket communication

## License

ISC
