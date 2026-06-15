/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cho phép hiển thị ảnh hóa đơn lưu ở backend (localhost:8000)
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "8000", pathname: "/static/**" },
    ],
  },
};
export default nextConfig;
