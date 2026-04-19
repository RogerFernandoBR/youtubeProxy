import express from 'express';
import cors from 'cors';
import { Innertube } from 'youtubei.js';
import { Readable } from 'stream';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// Instância única reutilizada
let yt = null;
async function getInnertube() {
  if (!yt) {
    yt = await Innertube.create({ generate_session_locally: true });
  }
  return yt;
}

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

// GET /info?url=<youtube_url>
app.get('/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL não fornecida' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL inválida' });

  try {
    console.log(`[Info] Buscando info para: ${videoId}`);
    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId);
    const { basic_info, streaming_data } = info;

    res.json({
      title: basic_info.title,
      duration: basic_info.duration,
      uploader: basic_info.author,
      thumbnail: basic_info.thumbnail?.[0]?.url,
      formats: streaming_data?.adaptive_formats?.map(f => ({
        itag: f.itag,
        mime_type: f.mime_type,
        quality: f.quality_label || f.audio_quality,
        bitrate: f.bitrate,
        width: f.width,
        height: f.height,
        filesize: f.content_length
      })) || []
    });
  } catch (err) {
    console.error('[Info] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao buscar informações do vídeo', message: err.message });
  }
});

// GET /download?url=<youtube_url>&type=video|audio
app.get('/download', async (req, res) => {
  const { url, type = 'video' } = req.query;
  if (!url) return res.status(400).json({ error: 'URL não fornecida' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL inválida' });

  try {
    console.log(`[Download] Tipo: ${type} | ID: ${videoId}`);
    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId);
    const title = info.basic_info.title?.replace(/[^\w\s-]/g, '_').substring(0, 80).trim() || 'video';

    let stream, contentType, filename;

    if (type === 'audio') {
      stream = await info.download({ type: 'audio', quality: 'best', format: 'mp4' });
      contentType = 'audio/mp4';
      filename = `${title}.m4a`;
    } else {
      stream = await info.download({ type: 'video+audio', quality: 'best', format: 'mp4' });
      contentType = 'video/mp4';
      filename = `${title}.mp4`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Allow-Origin', '*');

    const nodeStream = Readable.fromWeb(stream);
    nodeStream.pipe(res);
    req.on('close', () => nodeStream.destroy());

  } catch (err) {
    console.error('[Download] Erro:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro ao fazer download', message: err.message });
    }
  }
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'OK', port: PORT });
});

app.listen(PORT, () => {
  console.log(`🎬 YouTube Proxy rodando em http://localhost:${PORT}`);
  console.log(`📝 Info: GET /info?url=<youtube_url>`);
  console.log(`📥 Download: GET /download?url=<youtube_url>&type=video|audio`);
  console.log(`❤️  Health: GET /health`);
});
