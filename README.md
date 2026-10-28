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

The bridge prints a pairing code. Enter it in **Settings**, then click **Connect & discover Ollama**. Model names and capabilities come from Ollama's `/api/tags` and `/api/show` endpoints. The app lists local chat and image models; cloud-tagged Ollama models are excluded. Small local models appear first.

The model picker loads a selected model and unloads the previous one. The refresh button unloads the selected model and rediscovers available models. Chat replies appear as they stream; image generation and Agent mode show elapsed time and task progress.

Agent mode appears only for models that advertise tool use. In that mode the model plans, asks the bridge to run commands, reads command output, and continues for up to 12 rounds. CMD and PowerShell are supported on Windows; `/bin/sh` is used elsewhere. The bridge runs locally and requires its pairing code. Commands have a 60-second timeout, and output is capped to 20 KB. Set `WORKSPACE_ROOT` before starting the bridge to choose its initial working directory. Shell commands themselves have full user-level access, so use Agent mode only with models and tasks you trust.

To connect a deployed site to the bridge, set `APP_ORIGIN` to its exact HTTPS origin before running `npm run bridge`. Example:

```powershell
$env:APP_ORIGIN='https://your-site.netlify.app'
$env:WORKSPACE_ROOT='C:\projects'
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

Chats are saved in this browser's IndexedDB. New chat opens a new tab or window. Settings, including the pairing code, are saved in localStorage on this browser. The default theme is dark, with a light-mode switch.

Image generation is available only when an installed Ollama model advertises the `image` capability and the user's Ollama version supports its image-generation endpoint. Browser GGUF text models do not generate images, and a light phone may not have enough memory for a separate local image model.
