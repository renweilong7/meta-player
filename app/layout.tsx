import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import '@renweilong/electron-ffmpeg-player/style.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'MetaPlayer',
  description: 'MetaPlayer 桌面客户端，支持素材管理和剧情大纲',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
