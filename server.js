import express from 'express';
import cors from 'cors';
import { Innertube, Platform } from 'youtubei.js';

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

let yt = null;
async function getInnertube() {
  if (!yt) {
    console.log('[Innertube] Criando instância ANDROID...');
    yt = await Innertube.create({ client_type: 'ANDROID' });
    console.log('[Innertube] Pronto.');
  }
  return yt;
}

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

// Endpoint de debug — mostra o que o YouTube realmente retorna
app.get('/debug', async (req, res) => {
  const { url } = req.query;
  const videoId = extractVideoId(url || 'https://youtu.be/J555AEinCqA');
  const innertube = await getInnertube();
  const info = await innertube.getBasicInfo(videoId, 'ANDROID');
  res.json({
    title: info.basic_info?.title,
    playability: info.playability_status?.status,
    reason: info.playability_status?.reason,
    has_streaming_data: !!info.streaming_data,
    adaptive_formats_count: info.streaming_data?.adaptive_formats?.length ?? 0,
  });
});

app.get('/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL não fornecida' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL inválida' });
  try {
    console.log(`[Info] ${videoId}`);
    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId, 'ANDROID');
    const { basic_info, streaming_data } = info;
    console.log(`[Info] title="${basic_info?.title}" formats=${streaming_data?.adaptive_formats?.length} playability=${info.playability_status?.status}`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      title: basic_info.title,
      duration: basic_info.duration,
      uploader: basic_info.author,
      thumbnail: basic_info.thumbnail?.[0]?.url,
      formats: streaming_data?.adaptive_formats?.map(f => ({
        itag: f.itag, mime_type: f.mime_type,
        quality: f.quality_label || f.audio_quality,
        bitrate: f.bitrate, width: f.width, height: f.height
      })) || []
    });
  } catch (err) {
    console.error('[Info] Erro:', err.message);
    yt = null;
    res.status(500).json({ error: 'Erro ao buscar informações do vídeo', message: err.message });
  }
});

app.get('/stream-url', async (req, res) => {
  const { url, type = 'video' } = req.query;
  if (!url) return res.status(400).json({ error: 'URL não fornecida' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL inválida' });
  try {
    console.log(`[StreamURL] type=${type} id=${videoId}`);
    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId, 'ANDROID');
    const title = info.basic_info.title?.replace(/[^\w\s-]/g, '_').substring(0, 80).trim() || 'video';
    const { streaming_data } = info;
    if (!streaming_data) throw new Error('Streaming data não disponível');

    const formats = [
      ...(streaming_data.adaptive_formats || []),
      ...(streaming_data.formats || [])
    ];

    const audioFmt = formats
      .filter(f => f.mime_type?.startsWith('audio/mp4') && !f.width)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    if (!audioFmt) throw new Error('Nenhum formato de áudio encontrado');
    const audioUrl = await audioFmt.decipher(innertube.session.player);

    if (type === 'audio') {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ url: audioUrl, title, ext: 'm4a' });
    }

    const videoFmt = formats
      .filter(f => f.mime_type?.startsWith('video/mp4') && f.height && f.height <= 1080)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    if (!videoFmt) throw new Error('Nenhum formato de vídeo encontrado');
    const videoUrl = await videoFmt.decipher(innertube.session.player);

    console.log(`[StreamURL] ${videoFmt.height}p OK`);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ videoUrl, audioUrl, title, ext: 'mp4', height: videoFmt.height });
  } catch (err) {
    console.error('[StreamURL] Erro:', err.message);
    yt = null;
    res.status(500).json({ error: 'Erro ao obter URLs', message: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'OK', port: PORT }));

app.listen(PORT, () => console.log(`🎬 YouTube Proxy em http://localhost:${PORT}`));
