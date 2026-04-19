import express from 'express';
import cors from 'cors';
import { Innertube, Platform } from 'youtubei.js';

// Fornecer interpretador JS para decifrar URLs de stream
Platform.shim.eval = (data, env) => {
  const properties = [];
  if (env.n) properties.push(`n: exportedVars.nFunction("${env.n}")`);
  if (env.sig) properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;
  return Promise.resolve(new Function(code)());
};

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// Instância única reutilizada
let yt = null;
async function getInnertube() {
  if (!yt) {
    console.log('[Innertube] Criando nova instância...');
    yt = await Innertube.create({ client_type: 'ANDROID' });
    console.log('[Innertube] Instância criada.');
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
    const info = await innertube.getBasicInfo(videoId, 'ANDROID');
    const { basic_info, streaming_data } = info;

    console.log(`[Info] title=${basic_info?.title} | formats=${streaming_data?.adaptive_formats?.length} | playability=${info.playability_status?.status}`);

    res.setHeader('Cache-Control', 'no-store');
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
    yt = null; // resetar instância em caso de erro
    res.status(500).json({ error: 'Erro ao buscar informações do vídeo', message: err.message });
  }
});

// GET /stream-url?url=<youtube_url>&type=video|audio
// Retorna a URL direta decifrada para o browser baixar direto da CDN do YouTube
app.get('/stream-url', async (req, res) => {
  const { url, type = 'video' } = req.query;
  if (!url) return res.status(400).json({ error: 'URL não fornecida' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL inválida' });

  try {
    console.log(`[StreamURL] Tipo: ${type} | ID: ${videoId}`);
    const innertube = await getInnertube();

    let format;
    if (type === 'audio') {
      format = await innertube.getStreamingData(videoId, { type: 'audio', quality: 'best', format: 'mp4' });
    } else {
      // Tentar qualidades combinadas; fallback para vídeo puro se necessário
      let found = false;
      for (const quality of ['720p', '480p', '360p', '240p']) {
        try {
          format = await innertube.getStreamingData(videoId, { type: 'video+audio', quality });
          found = true;
          console.log(`[StreamURL] Qualidade video+audio: ${quality}`);
          break;
        } catch { continue; }
      }
      if (!found) {
        // Fallback: vídeo adaptivo sem áudio (pelo menos funciona)
        format = await innertube.getStreamingData(videoId, { type: 'video', quality: 'best', format: 'mp4' });
        console.log('[StreamURL] Fallback: video-only adaptivo');
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({ url: format.url, mime_type: format.mime_type });

  } catch (err) {
    console.error('[StreamURL] Erro:', err.message);
    yt = null;
    res.status(500).json({ error: 'Erro ao obter URL', message: err.message });
  }
});

// GET /download?url=<youtube_url>&type=video|audio (mantido por compatibilidade)
app.get('/download', async (req, res) => {
  const { url, type = 'video' } = req.query;
  if (!url) return res.status(400).json({ error: 'URL não fornecida' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL inválida' });

  try {
    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId);
    const title = info.basic_info.title?.replace(/[^\w\s-]/g, '_').substring(0, 80).trim() || 'video';

    let format;
    if (type === 'audio') {
      format = await innertube.getStreamingData(videoId, { type: 'audio', quality: 'best', format: 'mp4' });
    } else {
      let found = false;
      for (const quality of ['720p', '480p', '360p', '240p']) {
        try {
          format = await innertube.getStreamingData(videoId, { type: 'video+audio', quality });
          found = true;
          break;
        } catch { continue; }
      }
      if (!found) {
        format = await innertube.getStreamingData(videoId, { type: 'video', quality: 'best', format: 'mp4' });
      }
    }

    // Redirecionar para a URL direta — browser baixa da CDN do YouTube
    res.redirect(format.url);

  } catch (err) {
    console.error('[Download] Erro:', err.message);
    yt = null;
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao fazer download', message: err.message });
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
