/** @type {import('next').NextConfig} */
const nextConfig = {
  // three / react-globe.gl 是 ESM 且含浏览器专用代码,显式转译避免 SSR/打包问题
  transpilePackages: ['three', 'react-globe.gl'],
  // 容器化:输出独立可运行的 standalone 产物(node server.js),镜像更小
  output: 'standalone',
};

export default nextConfig;
