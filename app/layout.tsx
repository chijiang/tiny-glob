import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'TinyGlob — 点开地球,听见那个时代',
  description: '在 3D 地球上点击一个地点和一段时间,与一位当地的普通人对话。',
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
