# YouTube Stream Proxy

Servidor simples que faz proxy dos streams do YouTube para contornar problemas de CORS e SSL no frontend.

## Como usar

### 1. Iniciar o Proxy

```bash
cd /home/roger/Documentos/projetos/youtubeProxy
npm start
```

**Saída esperada:**
```
🎬 YouTube Stream Proxy rodando em http://localhost:3001
📡 Endpoint: GET /proxy?url=<stream_url>
❤️  Health check: GET /health
```

### 2. O App já está configurado

O `chromeMediaPlayer` já foi atualizado para usar `http://localhost:3001` como proxy.

### 3. Testar

```bash
# Health check
curl http://localhost:3001/health

# Esperado:
# {"status":"OK","port":3001}
```

## Como Funciona

```
Frontend (Chrome Media Player)
    ↓
Proxy (youtubeProxy:3001)
    ↓
Invidious API / YouTube Stream
    ↓
Arquivo baixado no navegador
```

## Isso é Tudo!

Um arquivo (`server.js`) que:
- ✅ Recebe a URL do stream
- ✅ Faz fetch (servidor → servidor, sem CORS)
- ✅ Retorna o conteúdo ao cliente
- ✅ Navegador faz download direto

Sem dependências extras, sem banco de dados, sem configuração complexa.
