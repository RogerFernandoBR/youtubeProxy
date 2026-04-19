const express = require('express');
const cors = require('cors');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

/**
 * GET /info?url=<youtube_url>
 * Busca informações do vídeo usando yt-dlp
 */
app.get('/info', async (req, res) => {
  const youtubeUrl = req.query.url;

  if (!youtubeUrl) {
    return res.status(400).json({ error: 'URL não fornecida' });
  }

  try {
    console.log(`[Info] Buscando info para: ${youtubeUrl}`);

    // Usar yt-dlp para extrair informações em JSON
    const command = `yt-dlp --dump-json --no-warnings "${youtubeUrl}"`;
    const output = execSync(command, { encoding: 'utf-8' });
    const videoData = JSON.parse(output);

    console.log(`[Info] Vídeo encontrado: ${videoData.title}`);

    // Retornar informações essenciais
    res.json({
      title: videoData.title,
      duration: videoData.duration,
      uploader: videoData.uploader,
      thumbnail: videoData.thumbnail,
      formats: videoData.formats.map(f => ({
        format_id: f.format_id,
        format: f.format,
        ext: f.ext,
        resolution: f.format_note || f.height ? `${f.height}p` : 'N/A',
        filesize: f.filesize,
        url: f.url,
        vcodec: f.vcodec,
        acodec: f.acodec
      }))
    });

  } catch (error) {
    console.error('[Info] Erro:', error.message);
    res.status(500).json({ 
      error: 'Erro ao buscar informações do vídeo',
      message: error.message.substring(0, 100)
    });
  }
});

/**
 * GET /download?url=<youtube_url>&format=<format_id>
 * Faz proxy do download do formato específico
 */
app.get('/download', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL não fornecida' });
  }

  const tmpDir = os.tmpdir();
  const tmpId = Date.now() + '_' + Math.random().toString(36).slice(2);

  try {
    const type = req.query.type || 'video'; // 'video' ou 'audio'
    console.log(`[Download] Tipo: ${type} | URL: ${url}`);

    // Buscar título
    const infoCmd = `yt-dlp --dump-json --no-warnings "${url}"`;
    const infoOutput = execSync(infoCmd, { encoding: 'utf-8', timeout: 30000 });
    const videoData = JSON.parse(infoOutput);
    const safeTitle = videoData.title.replace(/[^\w\s-]/g, '_').substring(0, 80).trim();

    let tmpFile, filename, contentType;

    if (type === 'audio') {
      tmpFile = path.join(tmpDir, `${tmpId}.mp3`);
      filename = `${safeTitle}.mp3`;
      contentType = 'audio/mpeg';

      console.log('[Download] Convertendo para mp3...');
      const result = spawnSync('yt-dlp', [
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--no-warnings',
        '-o', tmpFile,
        url
      ], { timeout: 300000 });

      if (result.status !== 0) {
        throw new Error(result.stderr?.toString() || 'Erro ao converter áudio');
      }
    } else {
      tmpFile = path.join(tmpDir, `${tmpId}.mp4`);
      filename = `${safeTitle}.mp4`;
      contentType = 'video/mp4';

      console.log('[Download] Baixando melhor qualidade de vídeo...');
      const result = spawnSync('yt-dlp', [
        '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]',
        '--merge-output-format', 'mp4',
        '--no-warnings',
        '-o', tmpFile,
        url
      ], { timeout: 600000 });

      if (result.status !== 0) {
        throw new Error(result.stderr?.toString() || 'Erro ao baixar vídeo');
      }
    }

    if (!fs.existsSync(tmpFile)) {
      throw new Error('Arquivo temporário não foi criado');
    }

    const stat = fs.statSync(tmpFile);
    console.log(`[Download] Arquivo pronto: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Access-Control-Allow-Origin', '*');

    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);

    stream.on('close', () => {
      fs.unlink(tmpFile, () => {});
    });

    req.on('close', () => {
      stream.destroy();
      fs.unlink(tmpFile, () => {});
    });

  } catch (error) {
    console.error('[Download] Erro:', error.message);
    // Limpar tmp se existir
    ['mp4','mp3'].forEach(ext => {
      const f = path.join(tmpDir, `${tmpId}.${ext}`);
      if (fs.existsSync(f)) fs.unlink(f, () => {});
    });
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Erro ao fazer download',
        message: error.message.substring(0, 300)
      });
    }
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', port: PORT, ytdlp: true });
});

app.listen(PORT, () => {
  console.log(`🎬 YouTube Downloader Proxy rodando em http://localhost:${PORT}`);
  console.log(`📝 Info: GET /info?url=<youtube_url>`);
  console.log(`📥 Download: GET /download?url=<youtube_url>&format=<format_id>`);
  console.log(`❤️  Health: GET /health`);
});
