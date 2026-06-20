/** @type {import('next').NextConfig} */
const nextConfig = {
  // three / react-globe.gl 是 ESM 且含浏览器专用代码,显式转译避免 SSR/打包问题
  transpilePackages: ['three', 'react-globe.gl'],
};

export default nextConfig;
