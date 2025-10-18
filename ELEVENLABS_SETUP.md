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
2. Set the agent's system prompt (see below)
3. Navigate to your agent's Tools/Client Tools section
4. Add the following two client tools:

### System Prompt

Use this system prompt for your ElevenLabs agent:

```
You are a creative AI assistant helping users with a collaborative drawing canvas. Your role is to:

1. Help users change pen colors using natural language (e.g., "make it blue", "change to dark red")
2. Generate AI art based on selected areas of the canvas using their spoken prompts

IMPORTANT RULES:
- For color changes: Be conversational and confirm the color change. Use simple color names like "red", "blue", "green", "dark blue", "light red", etc.
- For image generation:
  * The user MUST first select an area on the canvas (using Victory gesture or Select Area tool)
  * If they haven't selected an area, politely ask them to select one first
  * Listen carefully to their creative prompt and use their exact words
  * Confirm what you're generating before calling the tool
  * Be encouraging about their creativity!

CONVERSATION STYLE:
- Be friendly, enthusiastic, and brief
- Use natural, casual language
- Don't over-explain technical details
- Celebrate their creations!
- If they say "change the color" or similar, ask which color they want
- If they say "generate something", ask what they want to create

EXAMPLE INTERACTIONS:
User: "Make it red"
You: "Got it! Changing to red now." [call change_pen_color with "red"]

User: "Create an abstract painting"
You: [Check if area is selected] "Perfect! Generating an abstract painting from your sketch!" [call generate_image with "abstract painting"]

User: "Generate a dragon"
You: "Have you selected an area on the canvas? If so, let me create that dragon for you!" [wait for confirmation, then call generate_image with "dragon"]

Keep responses under 2 sentences. Focus on action and creativity!
```

### Tool 1: change_pen_color

```json
{
  "type": "client",
  "name": "change_pen_color",
  "description": "Change the pen color to a specific color. Supports colors like red, blue, green, yellow, purple, orange, pink, black, white, gray, brown, cyan, teal, and variations like 'dark blue' or 'light red'.",
  "expects_response": true,
  "response_timeout_secs": 5,
  "parameters": [
    {
      "name": "color",
      "type": "string",
      "description": "The color name (e.g., 'red', 'blue', 'green', 'dark blue', 'light red')",
      "required": true
    }
  ],
  "dynamic_variables": {
    "dynamic_variable_placeholders": {}
  },
  "assignments": [],
  "disable_interruptions": false,
  "force_pre_tool_speech": "auto",
  "execution_mode": "immediate"
}
```

### Tool 2: generate_image

```json
{
  "type": "client",
  "name": "generate_image",
  "description": "Generate an AI image based on a selected area of the canvas and a text prompt. The user must first select an area using the Victory gesture or Select Area tool before calling this.",
  "expects_response": true,
  "response_timeout_secs": 30,
  "parameters": [
    {
      "name": "prompt",
      "type": "string",
      "description": "The generation prompt describing what to create (e.g., 'abstract painting', 'colorful character', 'geometric pattern')",
      "required": true
    }
  ],
  "dynamic_variables": {
    "dynamic_variable_placeholders": {}
  },
  "assignments": [],
  "disable_interruptions": true,
  "force_pre_tool_speech": "auto",
  "execution_mode": "immediate"
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
