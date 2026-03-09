import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Client Acquisition Audit — How Well Does Your Firm Convert Leads?',
  description: 'Free audit that scans your law firm\'s digital presence, reputation signals, and conversion readiness — then scores how well your firm turns potential clients into signed cases.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
