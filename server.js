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
    res.status(500).json({ error: 'Erro ao buscar informações do vídeo', message: err.message });
  }
});

// GET /stream-url?url=<youtube_url>&type=video|audio
// Decifra a URL do stream e retorna para o cliente baixar diretamente da CDN do YouTube
app.get('/stream-url', async (req, res) => {
  const { url, type = 'video' } = req.query;
  if (!url) return res.status(400).json({ error: 'URL não fornecida' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL inválida' });

  try {
    console.log(`[StreamURL] Tipo: ${type} | ID: ${videoId}`);
    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId, 'ANDROID');
    const title = info.basic_info.title?.replace(/[^\w\s-]/g, '_').substring(0, 80).trim() || 'video';

    const { streaming_data } = info;
    if (!streaming_data) throw new Error('Streaming data não disponível');

    const allFormats = [
      ...(streaming_data.adaptive_formats || []),
      ...(streaming_data.formats || [])
    ];

    let format;
    if (type === 'audio') {
      format = allFormats
        .filter(f => f.mime_type?.startsWith('audio/mp4') && !f.width)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    } else {
      // Tentar video+audio (progressive)
      format = allFormats
        .filter(f => f.mime_type?.startsWith('video/mp4') && f.width && f.has_audio)
        .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      // Fallback: melhor vídeo adaptivo
      if (!format) {
        format = allFormats
          .filter(f => f.mime_type?.startsWith('video/mp4') && f.width)
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      }
    }

    if (!format) throw new Error(`Nenhum formato ${type} encontrado`);

    const streamUrl = await format.decipher(innertube.session.player);
    const ext = type === 'audio' ? 'm4a' : 'mp4';

    res.setHeader('Cache-Control', 'no-store');
    res.json({ url: streamUrl, mime_type: format.mime_type, title, ext });

  } catch (err) {
    console.error('[StreamURL] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao obter URL', message: err.message });
  }
});

// GET /download?url=<youtube_url>&type=video|audio
// Usa innertube.download() para stream direto
app.get('/download', async (req, res) => {
  const { url, type = 'video' } = req.query;
  if (!url) return res.status(400).json({ error: 'URL não fornecida' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL inválida' });

  try {
    console.log(`[Download] Tipo: ${type} | ID: ${videoId}`);
    const innertube = await getInnertube();

    // Buscar título sem afetar streaming_data
    const basicInfo = await innertube.getBasicInfo(videoId, 'ANDROID');
    const title = basicInfo.basic_info.title?.replace(/[^\w\s-]/g, '_').substring(0, 80).trim() || 'video';

    const ext = type === 'audio' ? 'm4a' : 'mp4';
    const dlOptions = type === 'audio'
      ? { type: 'audio', quality: 'best', format: 'mp4' }
      : { type: 'video+audio', quality: '360p', format: 'mp4' };

    console.log(`[Download] Iniciando stream: ${JSON.stringify(dlOptions)}`);

    // innertube.download() retorna ReadableStream nativo
    const stream = await innertube.download(videoId, dlOptions);

    res.setHeader('Content-Type', type === 'audio' ? 'audio/mp4' : 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${title}.${ext}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const { Readable } = await import('stream');
    Readable.fromWeb(stream).pipe(res);
    req.on('close', () => res.destroy());

  } catch (err) {
    console.error('[Download] Erro:', err.message);
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
