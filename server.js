import express from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createReadStream, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);
const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

async function ytdlp(args) {
  return execFileAsync('yt-dlp', args, { maxBuffer: 10 * 1024 * 1024 });
}

app.get('/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL nao fornecida' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL invalida' });
  try {
    console.log('[Info]', videoId);
    const { stdout } = await ytdlp([
      '--dump-json', '--no-playlist',
      `https://www.youtube.com/watch?v=${videoId}`
    ]);
    const data = JSON.parse(stdout);
    console.log('[Info] title="' + data.title + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      title: data.title,
      duration: data.duration,
      uploader: data.uploader,
      thumbnail: data.thumbnail,
      formats: (data.formats || []).map(f => ({
        format_id: f.format_id,
        ext: f.ext,
        quality: f.format_note,
        width: f.width,
        height: f.height,
        bitrate: f.tbr
      }))
    });
  } catch (err) {
    console.error('[Info] Erro:', err.message?.substring(0, 200));
    res.status(500).json({ error: 'Erro ao buscar informacoes', message: err.message?.substring(0, 200) });
  }
});

app.get('/video', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL nao fornecida' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL invalida' });
  const outPath = join(tmpdir(), `yt_${videoId}_${Date.now()}.mp4`);
  try {
    console.log('[Video]', videoId);
    // Baixa melhor video+audio ja mesclado em ate 1080p
    await ytdlp([
      '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '-o', outPath,
      `https://www.youtube.com/watch?v=${videoId}`
    ]);
    if (!existsSync(outPath)) throw new Error('Arquivo nao gerado');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${videoId}.mp4"`);
    const stream = createReadStream(outPath);
    stream.pipe(res);
    stream.on('close', () => { try { unlinkSync(outPath); } catch {} });
  } catch (err) {
    console.error('[Video] Erro:', err.message?.substring(0, 200));
    try { if (existsSync(outPath)) unlinkSync(outPath); } catch {}
    if (!res.headersSent) res.status(500).json({ error: err.message?.substring(0, 200) });
  }
});

app.get('/audio', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL nao fornecida' });
  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'URL invalida' });
  const outPath = join(tmpdir(), `yt_${videoId}_${Date.now()}.m4a`);
  try {
    console.log('[Audio]', videoId);
    await ytdlp([
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--no-playlist',
      '-o', outPath,
      `https://www.youtube.com/watch?v=${videoId}`
    ]);
    if (!existsSync(outPath)) throw new Error('Arquivo nao gerado');
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${videoId}.m4a"`);
    const stream = createReadStream(outPath);
    stream.pipe(res);
    stream.on('close', () => { try { unlinkSync(outPath); } catch {}; });
  } catch (err) {
    console.error('[Audio] Erro:', err.message?.substring(0, 200));
    try { if (existsSync(outPath)) unlinkSync(outPath); } catch {}
    if (!res.headersSent) res.status(500).json({ error: err.message?.substring(0, 200) });
  }
});

app.get('/health', (req, res) => res.json({ status: 'OK', port: PORT }));

app.listen(PORT, () => console.log('YouTube Proxy em http://localhost:' + PORT));
