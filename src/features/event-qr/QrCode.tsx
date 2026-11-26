import { useMemo } from 'react'
import { encodeQr, qrPath } from './qr'

/** Inline SVG QR code: black modules on a white quiet zone, so it scans in either theme and in print. */
export function QrCode({ value, label, className = '' }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const matrix = encodeQr(value, 'M')
    return { size: matrix.size + 8, path: qrPath(matrix, 4) }
  }, [value])
  return <svg className={`qr-code ${className}`} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}
    shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
    <rect width={size} height={size} fill="#fff" />
    <path d={path} fill="#000" />
  </svg>
}
