# Text-to-BPMN 2.0 Node.js Project

**Text-to-BPMN 2.0** is a web-based tool that allows users to generate executable BPMN 2.0 process diagrams from natural language descriptions. By leveraging powerful large language models such as DeepSeek and OpenAI, the application transforms informal text into well-structured BPMN XML, which can be visualized, validated, and edited directly in the browser. It is designed to lower the technical barrier of process modeling and support business analysts, developers, and non-technical users alike in capturing workflows quickly and intuitively.

Built with **Node.js**, **Express**, and the **bpmn-js** toolkit, this project integrates API-based language model inference with client-side BPMN rendering and semantic validation.

---

## 📦 Project Structure

```
Text-to-BPMN 2.0/
├── LICENSE
├── package.json
├── package-lock.json
├── .env                         # where API keys are stored (keep secret)
├── rollup.config.mjs            # bundles app.js into bundle-app.js
├── server.js                    # Node.js backend and API handler
├── system_prompt.txt            # standard visual BPMN prompt
├── system_prompt_camunda.txt    # Camunda 8 (Zeebe) executable BPMN prompt
├── .bpmnlintrc                  # validation rules for BPMN Lint
├── public/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── bundle-app.js        # bundled frontend logic
│   │   └── bundle-app.js.map
│   ├── diagram/
│   │   └── default.bpmn         # default diagram example
│   └── src/
│       └── app.js               # main frontend logic, imports bpmnlint
└── node_modules/
```

---

## 🚀 How to Run Locally

### 1. Clone or download this project folder

```bash
cd text-to-bpmn2.0
```

### 2. Install dependencies

```bash
npm install
```

### 3. Build the frontend

```bash
npm run build
```

### 4. Create `.env` file

At the root level, copy `.env.example` or create a `.env` file:

```bash
cp .env.example .env
```

Configure your chosen provider (Local LLM and/or Cloud):

```bash
# Server Port
PORT=3000

# Local LLM configuration (oMLX, Ollama, LM Studio, vLLM)
LOCAL_LLM_URL=http://127.0.0.1:8000/v1
LOCAL_LLM_API_KEY=
# Leave blank to auto-detect active model, or specify explicitly (e.g., qwen2.5-coder:14b)
LOCAL_LLM_MODEL=

# Cloud Providers (Optional)
DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here
OPENAI_API_KEY=sk-your-chatgpt-api-key-here
```

### 5. Start the server

```bash
npm start
```

Visit:

```
http://localhost:3000
```

✅ Text-to-BPMN2.0 app will be live on your local machine.

---

## 🧠 Local LLM Configuration

The application natively supports local OpenAI-compatible inference servers (**oMLX**, **Ollama**, **LM Studio**, **vLLM**, etc.).

### 1. Common Provider Endpoints

Set `LOCAL_LLM_URL` in `.env` based on your local engine:

| Engine | Default URL | Notes |
|:---|:---|:---|
| **oMLX** (macOS MLX) | `http://127.0.0.1:8000/v1` | Supports active model auto-detection via `/models/status` |
| **Ollama** | `http://127.0.0.1:11434/v1` | Requires `ollama serve` and models pulled via `ollama run` |
| **LM Studio** | `http://127.0.0.1:1234/v1` | Start the local server in LM Studio developer tab |
| **vLLM** / **LocalAI** | `http://127.0.0.1:8000/v1` | Standard OpenAI API compatible endpoint |

### 2. Model Selection & Auto-Detection

* **Automatic Detection**: If `LOCAL_LLM_MODEL` is left empty, the server automatically queries the loaded model via `/models/status` (oMLX) or `/models` (Ollama/LM Studio).
* **Explicit Model**: You can specify an exact model name in `.env`:
  ```bash
  LOCAL_LLM_MODEL=qwen2.5-coder:14b
  ```

### 3. Recommended Models for BPMN Generation

Generating valid BPMN 2.0 XML with precise coordinate layouts requires strong structured output capabilities. We recommend:
* **Qwen 2.5 Coder (7B, 14B, or 32B)**: Excellent XML structure and tag compliance.
* **DeepSeek-R1 / Qwen-based Distills**: Strong logical reasoning for complex process branching and gateways.
* **Llama 3.1 / 3.3 (8B or 70B)**: Good general workflow interpretation.

### 4. Docker & Local Networking

When running the application inside Docker (`docker compose up`), the server automatically maps `127.0.0.1` and `localhost` in `LOCAL_LLM_URL` to `host.docker.internal` so the container can reach your host machine's LLM server without manual configuration.

* Note for **Ollama on Linux/macOS**: Ensure Ollama is configured to listen on all interfaces if necessary (`OLLAMA_HOST=0.0.0.0`).

---

## 🐳 How to Run with Docker

You can run the application containerized using Docker Compose:

```bash
docker compose up -d
```

The application will be accessible at:
```
http://localhost:3000
```

### Docker Commands Summary

| Command | What it does |
|:---|:---|
| `docker compose up -d` | Start the container in background |
| `docker compose logs -f` | View real-time logs |
| `docker compose restart` | Restart the container |
| `docker compose down` | Stop and remove container |
| `docker compose exec text-to-bpmn sh` | Open interactive shell in container |
| `docker compose exec text-to-bpmn npm run convert:drawio` | Convert BPMN diagrams to Draw.io |
| `docker compose up --build -d` | Rebuild image after dependency/config changes |

---

## 🌐 How to Deploy Online

This Node.js project is already production-ready!

You can easily host it using platforms like:

- [Render](https://render.com/)
- [Railway](https://railway.app/)
- [Fly.io](https://fly.io/)
- [Heroku](https://heroku.com/)

### Basic steps to deploy:

1. Push your project to GitHub.
2. Create a new service on your hosting platform.
3. Connect your GitHub repository.
4. Set environment variable `DEEPSEEK_API_KEY` and `OPENAI_API_KEY` in the platform dashboard.
5. Deploy.

That's it — the app will be live with its own URL!

Example:
```
https://your-app-name.onrender.com
```

---

## ⚡ Commands Summary

| Command | What it does |
|:---|:---|
| `npm install` | Install all dependencies |
| `npm run build` | Build the frontend logic |
| `npm start` | Start the Node.js server |
| `npm run dev` | Start server with auto-restart using nodemon |

---

## 🛡️ Security Note

- Never expose your `.env` file to the public.
- Always add `.env` to your `.gitignore` when uploading to GitHub.

---

## License

This project is licensed under the [MIT License](LICENSE). Copyright © 2025 Davide Chen.
