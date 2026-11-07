import fs from 'node:fs'

const BASE = 'http://localhost:3111'
const creds = JSON.parse(fs.readFileSync('.qa-credentials.local.json', 'utf8'))
const email = process.env.PROBE_EMAIL || 'qa.female@lokfeel.com'

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email, password: creds.password }),
  redirect: 'manual',
})
console.log('LOGIN', login.status, JSON.stringify(login.headers.getSetCookie?.() ?? []))

const jar = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
console.log('JAR', jar)

const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: jar } })
const csrfJson = await csrfRes.json().catch(() => ({}))
console.log('CSRF', csrfRes.status, JSON.stringify(csrfJson))
const csrfToken = csrfJson.csrfToken

for (const mode of ['form', 'json']) {
  const headers = { Cookie: jar, Origin: BASE }
  let body
  if (mode === 'form') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = `csrfToken=${encodeURIComponent(csrfToken ?? '')}&callbackUrl=${encodeURIComponent(BASE)}`
  } else {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ csrfToken, callbackUrl: BASE })
  }
  const res = await fetch(`${BASE}/api/auth/signout`, { method: 'POST', headers, body, redirect: 'manual' })
  const sc = res.headers.getSetCookie?.() ?? []
  console.log(`\nSIGNOUT[${mode}] status=${res.status} location=${res.headers.get('location')}`)
  console.log('set-cookie count', sc.length)
  for (const c of sc) console.log('  -', c)
}
