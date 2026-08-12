/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` uses dynamic requires that must not be bundled into the server build.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
