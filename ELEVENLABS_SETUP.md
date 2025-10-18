# ElevenLabs Voice Agent Setup

## Prerequisites

- ElevenLabs API key (get one at https://elevenlabs.io/)
- ElevenLabs Conversational AI agent configured with tools

## Environment Variables

Add these to your `.env.local` file:

```bash
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_AGENT_ID=your_agent_id_here
```

## Configure Your ElevenLabs Agent

1. Go to https://elevenlabs.io/ and create a Conversational AI agent
2. Configure the following tools for your agent:

### Tool 1: change_pen_color

```json
{
  "name": "change_pen_color",
  "description": "Change the pen color to a specific color",
  "parameters": {
    "type": "object",
    "properties": {
      "color": {
        "type": "string",
        "description": "The color name (e.g., 'red', 'blue', 'green', 'dark blue', 'light red')"
      }
    },
    "required": ["color"]
  }
}
```

### Tool 2: generate_image

```json
{
  "name": "generate_image",
  "description": "Generate an image based on a selected area of the canvas and a text prompt",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "The generation prompt describing what to create"
      }
    },
    "required": ["prompt"]
  }
}
```

## Usage

1. Enable hand/gesture tracking by clicking "Hands-Off Mode" button
2. Show a **Thumbs Up** 👍 gesture to activate voice control
3. Speak commands like:
   - "Change the pen color to blue"
   - "Generate an abstract painting" (after selecting an area)
4. Show a **Thumbs Down** 👎 gesture to deactivate voice control

## Features

- **Color Change**: Voice agent can change pen color to any supported color name
- **Dynamic Image Generation**: Voice agent can generate images with custom prompts based on selected canvas areas
- **Real-time Feedback**: Microphone icon shows when voice agent is active (red indicator)
- **Automatic Integration**: Works seamlessly with existing gesture controls

## Supported Colors

Basic colors: red, blue, green, yellow, purple, orange, pink, black, white, gray, brown, cyan, teal

Color variations: dark/light prefixes (e.g., "dark red", "light blue")

## Troubleshooting

- **Voice not activating**: Make sure webcam/hand tracking is enabled first
- **Agent not responding**: Check that your ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID are correctly set
- **Tool calls failing**: Verify your agent has the correct tool configurations in the ElevenLabs dashboard
