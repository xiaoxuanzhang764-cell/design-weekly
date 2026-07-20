import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '设计周刊',
  description: '一份由所有人实时共同编辑的设计周刊',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
