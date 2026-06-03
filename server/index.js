import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ── In-memory storage ──────────────────────────────────────────────────────
const tokens = new Map()        // token -> { email }
const stores = new Map()        // email -> SyncPayload

function generateToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

function auth(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7)
  return tokens.get(token) || null
}

// ── Auth endpoints ─────────────────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.json({ ok: false, token: '' })
  if (stores.has(email)) return res.json({ ok: false, token: '' })
  const token = generateToken()
  tokens.set(token, { email })
  stores.set(email, null) // placeholder
  res.json({ ok: true, token })
})

app.post('/api/login', (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.json({ ok: false, token: '' })
  if (!stores.has(email)) return res.json({ ok: false, token: '' })
  const token = generateToken()
  tokens.set(token, { email })
  res.json({ ok: true, token })
})

// ── Sync endpoints ─────────────────────────────────────────────────────────
app.post('/api/sync/push', (req, res) => {
  const user = auth(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  stores.set(user.email, req.body)
  res.json({ ok: true })
})

app.post('/api/sync/pull', (req, res) => {
  const user = auth(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  const data = stores.get(user.email)
  if (!data) return res.json({ apps: [], groups: [], theme: { active: 'dark', custom_themes: [] }, stats: [] })
  res.json(data)
})

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Hubify sync server running on http://localhost:${PORT}`)
  console.log(`Set HUBIFY_SYNC_URL=http://localhost:${PORT}/api to use this server`)
})
