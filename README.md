# Lite Chat

A local-first chat workspace. The web app runs as static files. It can load a GGUF model directly in the browser through wllama, or connect to Ollama through a small optional Node bridge. No Docker, cloud AI key, database, or ComfyUI is required.

## Quick start

On Windows, double-click **`start.bat`** in File Explorer. On the first run it installs npm dependencies, then opens the app at `http://127.0.0.1:5173/` and starts the local bridge in a separate window. The opened browser session pairs with the bridge automatically. Double-click **`stop.bat`** to stop the app and bridge launched by `start.bat`. These files run on your Windows computer, not on Netlify.

Alternatively, run `npm install` and `npm run dev` manually. For a production build, use `npm run build` and `npm start`.

### Browser GGUF

Click **Load GGUF** and select a GGUF file. For a vision model, select its matching `mmproj.gguf` file too. The model runs on the browser device. Choose a small quantized model for phones or low-memory PCs. A single GGUF file over 2 GB must be split into smaller GGUF shards before browser loading. The model file must be reopened after a page reload; browsers do not grant permanent file access.

The app reads the loaded runtime's image and audio input support. Tool use and thinking are inferred from the model's chat template, so they are best treated as hints. Text files are included as prompt text. Image and WAV attachments appear only when the selected model advertises the corresponding input capability. A GGUF language model does not become an image-generation model merely because it supports image input.

### Ollama and local commands

Install and start Ollama on the **same computer** as the bridge. Then run:

```powershell
npm run bridge
```

The bridge prints a pairing code. Enter it in **Settings**, then click **Connect & discover Ollama**. Model names and capabilities come from Ollama's `/api/tags` and `/api/show` endpoints. The app lists all local Ollama models alphabetically, including unsupported ones labeled with their reported capability; cloud-tagged Ollama models are excluded. The image generation control appears only when the active runtime reports image generation support.

The model picker loads a selected model and unloads the previous one. The refresh button unloads the selected model and rediscovers available models. Chat replies appear as they stream; image generation and Agent mode show elapsed time and task progress.

If no model is loaded, the current chat shows **Load chat GGUF** for browser chat models, **Load image model** for the local diffusion server, and a local model selector below its history. The chat stays open while you load another model. If a GGUF without text-tokenizer metadata is chosen through the chat file picker, it opens the local image setup screen instead of being advertised as a chat model. The image engine's recipes and reported capabilities determine whether it can actually generate images; a filename or architecture name does not grant that capability.

### Windows image generation with stable-diffusion.cpp

Image diffusion GGUF files use the local bridge and [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp). They do not run in the browser's wllama chat runtime. On Windows, launch Lite Chat with `start.bat` and choose **Image → Add model files**. The bridge downloads the latest Windows CPU release from the [official releases](https://github.com/leejet/stable-diffusion.cpp/releases), verifies its SHA-256 checksum, and starts the server on an available local port. An already running compatible image server is reused. The runtime is stored under `%LOCALAPPDATA%\LiteChat\stable-diffusion.cpp`; model files are stored under `%LOCALAPPDATA%\LiteChat\image-models`. You can override these with `SD_SERVER_DIR`, `SD_SERVER_EXE`, `SD_MODEL_DIR`, or `SD_SERVER_URL` before starting the bridge.

For Qwen Image 2.1, download **all three** components:

- A diffusion GGUF, such as the requested [`qwen-image-2.1-UC-Q4_K_M.gguf`](https://huggingface.co/god8868/Qwen-Image-2.1-Uncensored-GGUF/blob/main/qwen-image-2.1-UC-Q4_K_M.gguf), or an [upstream-supported GGUF](https://huggingface.co/leejet/Qwen-Image-2.1-GGUF/tree/main).
- A Qwen3-VL-8B text encoder, such as a [GGUF from Qwen](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/tree/main) or a [matching safetensors encoder](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/tree/main/text_encoders).
- The specific [`qwen_image_2.1_vae_bf16.safetensors` VAE](https://huggingface.co/Comfy-Org/Qwen-Image-2.1/tree/main/vae). An older Qwen Image VAE is not interchangeable.

The diffusion GGUF alone cannot generate an image. If you only have the diffusion GGUF, obtain the text encoder and VAE before loading; the app shows the missing components before uploading large files.

Select the files with **Image → Add model files**. The app suggests a recipe from the selected file and the server's catalog, and fills slots only when the match is unambiguous. If the catalog cannot identify the model or components uniquely, choose the appropriate option. Recipes and slots come from the installed server, including custom recipes in its model directory. The bridge streams selected files into `SD_MODEL_DIR`, then asks the image server to load the recipe. Image generation becomes available only if the loaded server reports `img_gen`. Files are copied to the image folder, so allow enough disk space and time for large uploads. A deployed static site still needs the bridge and image server on the device running the model. For this particular community `UC` quantization, compatibility with stable-diffusion.cpp has not been verified; if it fails to initialize, try the upstream-supported GGUF linked above. See the [Qwen Image 2.1 guide](https://github.com/leejet/stable-diffusion.cpp/blob/master/docs/qwen_image_2.1.md).

Z-Image Turbo also works with its [diffusion GGUF](https://huggingface.co/leejet/Z-Image-Turbo-GGUF/tree/main), a [Qwen3-4B encoder](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/tree/main), and [`ae.safetensors`](https://huggingface.co/Comfy-Org/Z-Image-Turbo/tree/main/split_files/vae). For the [Qwen Image Edit 2511 GGUF](https://huggingface.co/ChrisColeTech/qwen-image-edit-uncensored-GGUF?not-for-all-audiences=true), choose the server's Qwen Image Edit 2511 recipe and its matching Qwen2.5-VL encoder, vision projector, and older Qwen Image VAE. Image editing with a source image is not yet available in Lite Chat. CPU generation can be slow and requires enough RAM for the complete pipeline. A phone browser cannot run the Windows image server itself.

Chat responses have a **Copy response** control that copies the original Markdown, including code fences. Each fenced code block has a separate **Copy code** control. The conversation follows new text only while you are near the bottom, so you can scroll up during generation. The context meter shows Ollama's reported prompt and output token count when available; otherwise it shows a rough estimate against the configured context limit.

Agent mode appears only for models that advertise tool use. Each chat gets a persistent local workspace under `%LOCALAPPDATA%\LiteChat\workspaces` on Windows (or `~/.local/share/lite-chat/workspaces` elsewhere). The workspace path appears in the agent's steps. Set `AGENT_WORKSPACES_ROOT` before starting the bridge to choose another parent folder. The agent can list and read files, write complete files, run commands, and build and test code. It continues for up to 30 tool rounds. When code has been written but the model omits a run call, the app runs it and returns the result to the model. A failed run sends its compiler or runtime diagnostic and the relevant source file back to the model for a correction and another run. The runner supports Java, Maven, Gradle, Python, and JavaScript. It uses a Maven or Gradle wrapper when present, otherwise the installed tool; it can build, test, and run a configured main class or task. Install a JDK for plain Java, and Maven or Gradle when the project has no wrapper. CMD and PowerShell are supported on Windows; `/bin/sh` is used elsewhere. The bridge runs locally and requires its pairing code. A tool-capable browser GGUF model can use Agent mode when the bridge is paired, even without Ollama. `WORKSPACE_ROOT` still controls the bridge's legacy command directory for requests without a chat workspace. Separate folders keep chat files out of the app repository, but they do not provide VM security: shell commands have full user-level access, so use Agent mode only with models and tasks you trust.

### Agent skills

Agent mode includes small built-in skills for building and verifying work, Java, web and Node, Python, and debugging. Relevant instructions load automatically; the agent can request others with its `read_skill` tool. Enable or disable skills in Settings. To add a custom skill, create `%LOCALAPPDATA%\LiteChat\skills\your-skill\SKILL.md` (or `~/.local/share/lite-chat/skills/your-skill/SKILL.md` elsewhere). Start the file with `# Skill name` and `Description: When to use it.` Reconnect the bridge to refresh the list. Set `AGENT_SKILLS_ROOT` to use another skills folder. A custom skill is loaded automatically if its folder name appears in the request, or the model can call `read_skill` when it sees a matching description. Skills are local text instructions, so keep them short enough for your model's context window.

To connect a deployed site to the bridge, set `APP_ORIGIN` to its exact HTTPS origin before running `npm run bridge`. Example:

```powershell
$env:APP_ORIGIN='https://your-site.netlify.app'
$env:AGENT_WORKSPACES_ROOT='C:\LiteChatProjects'
npm run bridge
```

Browser private-network and cross-origin rules vary. If a hosted page cannot reach the bridge, open the app locally with `npm start` on the same computer.

For a Netlify page, the bridge must run on the **same device as the browser**. On Windows, copy `bridge-origin.example.txt` to `bridge-origin.txt`, replace the example URL with your exact deployed HTTPS origin, and run `start.bat` again. The bridge window prints the pairing code to enter in the deployed site's Settings. Allow a browser local-network access prompt if shown. Alternatively, set `APP_ORIGIN` before running `npm run bridge` manually. `127.0.0.1` on a phone refers to the phone, so a phone cannot reach a bridge running on a PC through that address. A static Netlify deployment cannot itself run Ollama or operating-system commands.

## Deployment

| Host | Setup |
| --- | --- |
| Netlify | Import this repository; `netlify.toml` builds and publishes `dist`. |
| Vercel | Import this repository; `vercel.json` builds and publishes `dist`. |
| Render | Create a Blueprint from `render.yaml`. |

### Netlify build settings

Push the project to a Git repository with a `main` branch, then import that repository in Netlify. Enter these values when asked:

| Field | Value |
| --- | --- |
| Branch to deploy | `main` |
| Base directory | Leave blank (project is at the repository root) |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | Leave blank |
| Environment variables | None required for the static site |

The included `netlify.toml` already sets the build command, publish directory, and single-page app redirect. After deployment, load a GGUF in the browser, or run the local bridge on your computer with `APP_ORIGIN` set to the deployed site's exact HTTPS origin as shown above. The pairing code belongs in the app's Settings, not in Netlify environment variables.

Hosting serves only the interface and WebAssembly runtime. GGUF inference uses the browser device. Ollama inference and commands use a bridge running on the user's computer. Neither a serverless host nor a phone browser can execute arbitrary OS commands on the user's PC by itself.

Chats are saved in this browser's IndexedDB. New chat starts a fresh conversation on the same page. Settings, including the pairing code, are saved in localStorage on this browser. The default theme is dark, with a light-mode switch.

Image generation is available through a ready stable-diffusion.cpp server or an Ollama model that advertises the `image` capability and whose Ollama version supports its image-generation endpoint. Ollama's official image models currently document macOS support; use stable-diffusion.cpp for Windows. Browser GGUF text models do not generate images. Diffusion GGUF files are loaded through the paired local image server and need their matching encoder and VAE. A light phone may not have enough memory for a separate local image model.
