// api/upload.js
// Vercel Serverless Function (Node.js)
// Upload image -> GitHub repo (images/...) + update JSON (data/pahlawan_uploads.json)

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
      nama_pahlawan,
      filename,
      mime,
      data_url
    } = req.body || {};

    if (!nama_pahlawan || !data_url) {
      return res.status(400).json({ error: 'nama_pahlawan dan data_url wajib diisi' });
    }

    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo  = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';

    if (!token || !owner || !repo) {
      return res.status(500).json({ error: 'ENV belum lengkap: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO (dan optional GITHUB_BRANCH)' });
    }

    // data_url format: "data:image/png;base64,AAAA..."
    const match = String(data_url).match(/^data:(.+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'data_url tidak valid' });

    const detectedMime = match[1];
    const b64 = match[2];

    const safeMime = mime || detectedMime;
    const ext = mimeToExt(safeMime) || extFromFilename(filename) || 'png';

    const slug = slugify(nama_pahlawan);
    const unique = Date.now().toString(36);
    const imagePath = `images/${slug}-${unique}.${ext}`;

    // 1) Upload image file
    const imagePut = await githubPutFile({
      token, owner, repo, branch,
      path: imagePath,
      message: `Upload image pahlawan: ${nama_pahlawan}`,
      contentBase64: b64
    });

    const imageUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${imagePath}`;

    // 2) Update JSON file: data/pahlawan_uploads.json
    const jsonPath = 'data/pahlawan_uploads.json';
    const nowIso = new Date().toISOString();

    const existing = await githubGetJsonFile({ token, owner, repo, branch, path: jsonPath })
      .catch(() => ({ json: [], sha: null })); // kalau file belum ada

    const arr = Array.isArray(existing.json) ? existing.json : [];

    // replace kalau nama sama (case-insensitive), biar 1 pahlawan = 1 latest image
    const idx = arr.findIndex(x => String(x?.nama_pahlawan || '').toLowerCase() === String(nama_pahlawan).toLowerCase());
    const record = { nama_pahlawan, image_url: imageUrl, uploaded_at: nowIso };

    if (idx >= 0) arr[idx] = record;
    else arr.push(record);

    const jsonContent = Buffer.from(JSON.stringify(arr, null, 2), 'utf8').toString('base64');

    const jsonPut = await githubPutFile({
      token, owner, repo, branch,
      path: jsonPath,
      message: `Update pahlawan_uploads.json: ${nama_pahlawan}`,
      contentBase64: jsonContent,
      sha: existing.sha // wajib saat update
    });

    return res.status(200).json({
      ok: true,
      nama_pahlawan,
      image_url: imageUrl,
      json_path: jsonPath,
      commit_url: jsonPut?.commit?.html_url || null
    });

  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')               // hapus apostrophe
    .replace(/[^a-z0-9]+/g, '-')        // non-alnum -> -
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'pahlawan';
}

function mimeToExt(m) {
  const x = String(m || '').toLowerCase();
  if (x.includes('jpeg')) return 'jpg';
  if (x.includes('jpg')) return 'jpg';
  if (x.includes('png')) return 'png';
  if (x.includes('webp')) return 'webp';
  if (x.includes('gif')) return 'gif';
  return null;
}

function extFromFilename(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : null;
}

async function githubApi(token, url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });

  const text = await resp.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!resp.ok) {
    const msg = data?.message ? `${data.message}` : `HTTP ${resp.status}`;
    throw new Error(`GitHub API error: ${msg}`);
  }
  return data;
}

async function githubPutFile({ token, owner, repo, branch, path, message, contentBase64, sha }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`;
  const body = {
    message,
    content: contentBase64,
    branch
  };
  if (sha) body.sha = sha;

  return githubApi(token, url, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

async function githubGetJsonFile({ token, owner, repo, branch, path }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=${encodeURIComponent(branch)}`;
  const data = await githubApi(token, url, { method: 'GET' });

  // data.content is base64 with newlines sometimes
  const b64 = String(data.content || '').replace(/\n/g, '');
  const jsonText = Buffer.from(b64, 'base64').toString('utf8');
  const json = JSON.parse(jsonText);

  return { json, sha: data.sha };
}
