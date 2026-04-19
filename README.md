# YouTube Downloader Proxy

Servidor Node.js que usa `yt-dlp` para buscar informações e baixar vídeos/áudios do YouTube, servindo de proxy para o frontend `chromeMediaPlayer`.

---

## 🌐 Endereços

| Ambiente | URL |
|----------|-----|
| **Produção (Railway)** | https://youtubeproxy-production.up.railway.app |
| **Local** | http://localhost:3001 |

---

## 🚀 Endpoints

### `GET /health`
Verifica se o servidor está rodando.

```bash
curl https://youtubeproxy-production.up.railway.app/health
# {"status":"OK","port":"8080","ytdlp":true}
```

### `GET /info?url=<youtube_url>`
Retorna metadados do vídeo (título, duração, formatos disponíveis).

```bash
curl "https://youtubeproxy-production.up.railway.app/info?url=https://youtu.be/dQw4w9WgXcQ"
```

### `GET /download?url=<youtube_url>&type=video|audio`
Faz o download do vídeo (`.mp4`) ou áudio (`.mp3`).

```bash
# Baixar vídeo
curl "https://youtubeproxy-production.up.railway.app/download?url=https://youtu.be/dQw4w9WgXcQ&type=video" -o video.mp4

# Baixar áudio
curl "https://youtubeproxy-production.up.railway.app/download?url=https://youtu.be/dQw4w9WgXcQ&type=audio" -o audio.mp3
```

---

## 🖥️ Rodando Localmente

### Pré-requisitos
- Node.js
- `yt-dlp` instalado no sistema (`pip install yt-dlp`)
- `ffmpeg` instalado (`sudo apt install ffmpeg`)

### Instalação

```bash
git clone https://github.com/RogerFernandoBR/youtubeProxy.git
cd youtubeProxy
npm install
npm start
```

**Saída esperada:**
```
🎬 YouTube Downloader Proxy rodando em http://localhost:3001
📝 Info: GET /info?url=<youtube_url>
📥 Download: GET /download?url=<youtube_url>&format=<format_id>
❤️  Health: GET /health
```

---

## ☁️ Deploy (Railway)

O projeto está configurado para deploy automático no [Railway](https://railway.app) via `nixpacks.toml`.

O Railway instala automaticamente:
- `python3` + `ffmpeg` via Nix
- `yt-dlp` via `pip install -U yt-dlp`

Qualquer push na branch `master` aciona um novo deploy automaticamente.

---

## 🔧 Como Funciona

```
Frontend (chromeMediaPlayer)
    ↓
Proxy (youtubeProxy)
    ↓  usa yt-dlp
YouTube
    ↓
Arquivo baixado no navegador
```
- ✅ Faz fetch (servidor → servidor, sem CORS)
- ✅ Retorna o conteúdo ao cliente
- ✅ Navegador faz download direto

Sem dependências extras, sem banco de dados, sem configuração complexa.
