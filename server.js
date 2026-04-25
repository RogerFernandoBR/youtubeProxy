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
    console.log('[Innertube] Criando instancia ANDROID...');
    yt = await Innertube.create({ client_type: 'ANDROID' });
    console.log('[Innertube] Pronto.');
  }
  return yt;
}

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

async function getFormats(videoId) {
  const innertube = await getInnertube();
  const info = await innertube.getBasicInfo(videoId, 'ANDROID');
  const { basic_info, streaming_data } = info;
  if (!streaming_data) throw new Error('Streaming data nao disponivel');
  const formats = [
    ...(streaming_data.adaptive_formats || []),
    ...(streaming_data.formats || [])
  ];
  return { innertube, info, basic_info, formats };
}

async function proxyStream(cdnUrl, res, contentType) {
  const upstream = await fetch(cdnUrl, {
    headers: { 'User-Agent': 'com.google.android.youtube/17.36.4 (Linux; U; Android 12)' }
  });
  if (!upstream.ok) throw new Error(`CDN retornou ${upstream.status}`);
  res.setHeader('Content-Type', contentType);
  if (upstream.headers.get('content-length')) {
    res.setHeader('Content-Length', upstream.headers.get('content-length'));
  }
  res.setHeader('Cache-Control', 'no-store');
  upstream.body.pipeTo(new WritableStream({
    write(chunk) { res.write(chunk); },
    close() { res.end(); },
    abort(err) { console.error('[Proxy] Stream abortado:', err); res.end(); }
  }));
}

app.get('/debug', async (req, res) => {
  const { url } = req.query;
  const videoId = extractVideoId(url || 'https://youtu.be/J555AEinCqA');
  try {
    const innertube = await getInnertube();
    const info = await innertube.getBasicInfo(videoId, 'ANDROID');
    res.json({
      title: info.basic_info?.title,
      playability: info.playability_status?.status,
      reason: info.playability_status?.reason,
      has_streaming_data: !!info.streaming_data,
      adaptive_formats_count: info.streaming_data?.adaptive_formats?.length ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL nao fornecida' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL invalida' });
  try {
    console.log('[Info]', videoId);
    const { basic_info, formats } = await getFormats(videoId);
    console.log('[Info] title="' + basic_info?.title + '" formats=' + formats.length);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      title: basic_info.title,
      duration: basic_info.duration,
      uploader: basic_info.author,
      thumbnail: basic_info.thumbnail?.[0]?.url,
      formats: formats.map(f => ({
        itag: f.itag, mime_type: f.mime_type,
        quality: f.quality_label || f.audio_quality,
        bitrate: f.bitrate, width: f.width, height: f.height
      }))
    });
  } catch (err) {
    console.error('[Info] Erro:', err.message);
    yt = null;
    res.status(500).json({ error: 'Erro ao buscar informacoes', message: err.message });
  }
});

// Railway decifra a URL e faz proxy dos bytes do video para o browser
app.get('/video', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL nao fornecida' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL invalida' });
  try {
    console.log('[Video]', videoId);
    const { innertube, basic_info, formats } = await getFormats(videoId);
    const videoFmt = formats
      .filter(f => f.mime_type?.startsWith('video/mp4') && f.height && f.height <= 1080)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    if (!videoFmt) throw new Error('Nenhum formato de video encontrado');
    const cdnUrl = await videoFmt.decipher(innertube.session.player);
    const title = basic_info.title?.replace(/[^\w\s-]/g, '_').substring(0, 80).trim() || 'video';
    console.log('[Video]', videoFmt.height + 'p — proxy...');
    res.setHeader('Content-Disposition', 'attachment; filename="' + title + '.mp4"');
    await proxyStream(cdnUrl, res, 'video/mp4');
  } catch (err) {
    console.error('[Video] Erro:', err.message);
    yt = null;
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Railway decifra a URL e faz proxy dos bytes do audio para o browser
app.get('/audio', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL nao fornecida' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL invalida' });
  try {
    console.log('[Audio]', videoId);
    const { innertube, basic_info, formats } = await getFormats(videoId);
    const audioFmt = formats
      .filter(f => f.mime_type?.startsWith('audio/mp4') && !f.width)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    if (!audioFmt) throw new Error('Nenhum formato de audio encontrado');
    const cdnUrl = await audioFmt.decipher(innertube.session.player);
    const title = basic_info.title?.replace(/[^\w\s-]/g, '_').substring(0, 80).trim() || 'audio';
    console.log('[Audio]', audioFmt.bitrate + 'bps — proxy...');
    res.setHeader('Content-Disposition', 'attachment; filename="' + title + '.m4a"');
    await proxyStream(cdnUrl, res, 'audio/mp4');
  } catch (err) {
    console.error('[Audio] Erro:', err.message);
    yt = null;
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'OK', port: PORT }));

app.listen(PORT, () => console.log('YouTube Proxy em http://localhost:' + PORT));
