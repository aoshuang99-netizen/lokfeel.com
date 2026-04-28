import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET /api/geo/ip — Get user's approximate location from IP
// Uses free ip-api.com (no key needed, 45 req/min)
export async function GET(request: NextRequest) {
  try {
    // Get client IP from headers (Vercel sets these)
    const forwarded = request.headers.get('x-forwarded-for')
    const realIp = request.headers.get('x-real-ip')
    const clientIp = forwarded?.split(',')[0]?.trim() || realIp || ''

    // Don't geolocate localhost/private IPs
    if (!clientIp || clientIp === '127.0.0.1' || clientIp === '::1' || clientIp.startsWith('10.') || clientIp.startsWith('192.168.')) {
      return NextResponse.json({
        location: null,
        message: 'Unable to determine location from local IP'
      })
    }

    // Use free ip-api.com for geolocation
    const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon`, {
      signal: AbortSignal.timeout(5000),
    })

    if (!geoRes.ok) {
      return NextResponse.json({ location: null, message: 'Geolocation service unavailable' })
    }

    const geoData = await geoRes.json()

    if (geoData.status !== 'success' || geoData.countryCode !== 'US') {
      // Return what we have, let frontend handle non-US
      return NextResponse.json({
        location: {
          country: geoData.countryCode || null,
          region: geoData.regionName || null,
          regionCode: geoData.region || null,
          city: geoData.city || null,
          zip: geoData.zip || null,
          lat: geoData.lat || null,
          lon: geoData.lon || null,
        },
        isUS: geoData.countryCode === 'US',
      })
    }

    return NextResponse.json({
      location: {
        country: 'US',
        region: geoData.regionName,
        regionCode: geoData.region,
        city: geoData.city,
        zip: geoData.zip,
        lat: geoData.lat,
        lon: geoData.lon,
      },
      isUS: true,
    })
  } catch (error) {
    console.error('Geo IP error:', error)
    return NextResponse.json({ location: null, message: 'Geolocation failed' })
  }
}
