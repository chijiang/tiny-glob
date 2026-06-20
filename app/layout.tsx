import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'TinyGlob — 点开地球,听见那个时代',
  description: '在 3D 地球上点击一个地点和一段时间,与一位当地的普通人对话。',
};

// 关键:没有这个手机浏览器会按 980px 桌面 viewport 渲染,所有元素缩成小图。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
