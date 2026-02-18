const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10kb' }));

console.log('🚀 DopaLAN: API starting...');

// Stockage en mémoire (Redis/DB plus tard)
const matches = new Map();
const rateLimit = new Map();

// Rate limiting
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const key = `${ip}:${req.path}`;
  
  if (!rateLimit.has(key)) rateLimit.set(key, []);
  
  const requests = rateLimit.get(key);
  requests.push(now);
  
  const recent = requests.filter(t => now - t < 60000);
  rateLimit.set(key, recent);
  
  if (recent.length > 15) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded. Slow down!' 
    });
  }
  
  next();
});

// 🟢 Enregistrer un nouveau match DopaLAN
app.post('/api/matches/register', (req, res) => {
  const { hostName, proxyAddress, proxyPort, map, maxPlayers = 8 } = req.body;
  
  if (!hostName?.trim() || !proxyAddress?.trim() || !proxyPort || !map?.trim()) {
    return res.status(400).json({ 
      error: 'Missing fields: hostName, proxyAddress, proxyPort, map required' 
    });
  }
  
  const id = crypto.randomUUID();
  const match = {
    id,
    hostName: hostName.trim(),
    proxyAddress: proxyAddress.trim(),
    proxyPort: parseInt(proxyPort),
    map: map.trim(),
    maxPlayers,
    playersConnected: 0,
    createdAt: Date.now(),
    lastHeartbeat: Date.now()
  };
  
  matches.set(id, match);
  
  console.log(`🟢 [DopaLAN] ${hostName} hosted ${map} → ${proxyAddress}:${proxyPort}`);
  res.json({ 
    id, 
    message: `DopaLAN match "${hostName}" registered! Share it! 🎮`,
    proxyUrl: `${proxyAddress}:${proxyPort}`
  });
});

// 💓 Heartbeat (garde le match vivant)
app.post('/api/matches/heartbeat', (req, res) => {
  const { id } = req.body;
  const match = matches.get(id);
  
  if (!match) {
    return res.status(404).json({ error: 'Match not found or expired' });
  }
  
  match.lastHeartbeat = Date.now();
  res.json({ ok: true, message: 'Heartbeat OK' });
});

// 📋 Liste des matchs actifs
app.get('/api/matches/list', (req, res) => {
  const now = Date.now();
  const activeMatches = Array.from(matches.values())
    .filter(m => now - m.lastHeartbeat < 120000) // 2 min max
    .map(m => ({
      id: m.id,
      hostName: m.hostName,
      proxyAddress: m.proxyAddress,
      proxyPort: m.proxyPort,
      proxyUrl: `${m.proxyAddress}:${m.proxyPort}`,
      map: m.map,
      maxPlayers: m.maxPlayers,
      playersConnected: m.playersConnected,
      age: Math.floor((now - m.createdAt) / 1000 / 60), // minutes
      isRecent: (now - m.lastHeartbeat) < 30000 // vert si < 30s
    }))
    .sort((a, b) => b.lastHeartbeat - a.lastHeartbeat) // Plus récents 1er
    .slice(0, 100); // Max 100 matchs
  
  res.json({
    matches: activeMatches,
    total: activeMatches.length,
    timestamp: now
  });
});

// ❌ Unregister (quand l'hôte arrête)
app.post('/api/matches/unregister', (req, res) => {
  const { id } = req.body;
  const match = matches.get(id);
  
  if (matches.delete(id)) {
    console.log(`❌ [DopaLAN] Match ${match?.hostName || id} stopped`);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Match not found' });
  }
});

// 🩺 Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: '🟢 OK', 
    uptime: Math.floor(process.uptime() / 60) + 'min',
    matches: matches.size,
    active: Array.from(matches.values()).filter(m => 
      Date.now() - m.lastHeartbeat < 120000
    ).length
  });
});

// Stats
app.get('/stats', (req, res) => {
  const now = Date.now();
  res.json({
    totalMatchesEver: matches.size,
    activeMatches: Array.from(matches.values()).filter(m => 
      now - m.lastHeartbeat < 120000
    ).length,
    uptime: process.uptime()
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found. Check /health or /api/matches/list' 
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 DopaLAN API shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🎮 DOPALAN API v1.0`);
  console.log(`🌐 Live on http://localhost:${PORT}`);
  console.log(`📋 Browser: http://localhost:${PORT}/api/matches/list`);
  console.log(`🩺 Health:  http://localhost:${PORT}/health`);
  console.log(`📊 Stats:   http://localhost:${PORT}/stats`);
});
